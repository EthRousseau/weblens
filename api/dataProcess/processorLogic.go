package dataProcess

import (
	"context"
	"errors"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ethrousseau/weblens/api/dataStore"
	"github.com/ethrousseau/weblens/api/types"
	"github.com/ethrousseau/weblens/api/util"
	"github.com/saracen/fastzip"
)

func scanFile(t *task) {
	meta := t.metadata.(ScanMetadata)

	displayable, err := meta.file.IsDisplayable()
	if err != nil && !errors.Is(err, dataStore.ErrNoMedia) {
		t.ErrorAndExit(err)
	}
	if !displayable {
		t.ErrorAndExit(ErrNonDisplayable)
	}

	if meta.partialMedia == nil {
		meta.partialMedia = dataStore.NewMedia()
	}

	t.CheckExit()

	t.SetErrorCleanup(func() {
		media, err := meta.file.GetMedia()
		if err != nil && err != dataStore.ErrNoMedia {
			util.ErrTrace(err)
		}
		if media != nil {
			media.Clean()
		}

		meta.file.ClearMedia()
	})

	t.metadata = meta

	t.CheckExit()
	processMediaFile(t)
}

func createZipFromPaths(t *task) {
	zipMeta := t.metadata.(ZipMetadata)

	if len(zipMeta.files) == 0 {
		t.ErrorAndExit(ErrEmptyZip)
	}

	filesInfoMap := map[string]os.FileInfo{}

	util.Map(zipMeta.files,
		func(file types.WeblensFile) error {
			file.RecursiveMap(func(f types.WeblensFile) {
				stat, err := os.Stat(f.GetAbsPath())
				if err != nil {
					t.ErrorAndExit(err)
				}
				filesInfoMap[f.GetAbsPath()] = stat
			})
			return nil
		},
	)

	paths := util.MapToKeys(filesInfoMap)
	slices.Sort(paths)
	takeoutHash := util.GlobbyHash(8, strings.Join(paths, ""))
	zipFile, zipExists, err := dataStore.NewTakeoutZip(takeoutHash, zipMeta.username)
	if err != nil {
		t.ErrorAndExit(err)
	}
	if zipExists {
		t.setResult(types.TaskResult{"takeoutId": zipFile.Id().String()})
		t.caster.PushTaskUpdate(t.taskId, "zip_complete", t.result) // Let any client subscribers know we are done
		t.success()
		return
	}

	if zipMeta.shareId != "" {
		s, err := dataStore.GetShare(zipMeta.shareId, dataStore.FileShare)
		if err != nil {
			t.ErrorAndExit(err)
		}
		zipFile.AppendShare(s)
	}

	fp, err := os.Create(zipFile.GetAbsPath())
	if err != nil {
		t.ErrorAndExit(err)
	}
	defer fp.Close()

	a, err := fastzip.NewArchiver(fp, zipMeta.files[0].GetParent().GetAbsPath(), fastzip.WithStageDirectory(zipFile.GetParent().GetAbsPath()), fastzip.WithArchiverBufferSize(32))
	util.FailOnError(err, "Filed to create new zip archiver")
	defer a.Close()

	var archiveErr *error

	// Shove archive to child thread so we can send updates with main thread
	go func() {
		err := a.Archive(context.Background(), filesInfoMap)
		if err != nil {
			archiveErr = &err
		}
	}()

	var entries int64
	var bytes int64
	var prevBytes int64 = -1
	var sinceUpdate int64 = 0
	totalFiles := len(filesInfoMap)

	const UPDATE_INTERVAL int64 = 500 * int64(time.Millisecond)

	// Update client over websocket until entire archive has been written, or an error is thrown
	for int64(totalFiles) > entries {
		if archiveErr != nil {
			break
		}
		sinceUpdate++
		bytes, entries = a.Written()
		if bytes != prevBytes {
			byteDiff := bytes - prevBytes
			timeNs := UPDATE_INTERVAL * sinceUpdate

			t.caster.PushTaskUpdate(t.taskId, "create_zip_progress", types.TaskResult{"completedFiles": int(entries), "totalFiles": totalFiles, "speedBytes": int((float64(byteDiff) / float64(timeNs)) * float64(time.Second))})
			prevBytes = bytes
			sinceUpdate = 0
		}

		time.Sleep(time.Duration(UPDATE_INTERVAL))
	}
	if archiveErr != nil {
		t.ErrorAndExit(*archiveErr)
	}

	t.setResult(types.TaskResult{"takeoutId": zipFile.Id()})
	t.caster.PushTaskUpdate(t.taskId, "zip_complete", t.result) // Let any client subscribers know we are done
	t.success()
}

func moveFile(t *task) {
	moveMeta := t.metadata.(MoveMeta)

	file := dataStore.FsTreeGet(moveMeta.fileId)
	if file == nil {
		t.ErrorAndExit(errors.New("could not find existing file"))
	}

	destinationFolder := dataStore.FsTreeGet(moveMeta.destinationFolderId)
	if destinationFolder == destinationFolder.Owner().GetTrashFolder() {
		err := dataStore.MoveFileToTrash(file, t.caster)
		if err != nil {
			t.ErrorAndExit(err, "Failed while assuming move file was to trash")
		}
		return
	} else if dataStore.IsFileInTrash(file) {
		err := dataStore.ReturnFileFromTrash(file, t.caster)
		if err != nil {
			t.ErrorAndExit(err, "Failed while assuming move file was out of trash")
		}
		return
	}
	err := dataStore.FsTreeMove(file, destinationFolder, moveMeta.newFilename, false, t.caster)
	if err != nil {
		t.ErrorAndExit(err)
	}
	t.success()
}

func parseRangeHeader(contentRange string) (min, max, total int64, err error) {
	rangeAndSize := strings.Split(contentRange, "/")
	rangeParts := strings.Split(rangeAndSize[0], "-")

	min, err = strconv.ParseInt(rangeParts[0], 10, 64)
	if err != nil {
		return
	}

	max, err = strconv.ParseInt(rangeParts[1], 10, 64)
	if err != nil {
		return
	}

	total, err = strconv.ParseInt(rangeAndSize[1], 10, 64)
	if err != nil {
		return
	}
	return
}

func writeToFile(t *task) {
	meta := t.metadata.(WriteFileMeta)

	t.CheckExit()

	var min, max, total int64
	// var min int
	var err error

	// This map will only be accessed by this task and by this 1 thread,
	// so we do not need any synchronization here
	fileMap := map[types.FileId]*fileUploadProgress{}

	var bufCaster types.BufferedBroadcasterAgent
	switch t.caster.(type) {
	case types.BufferedBroadcasterAgent:
		bufCaster = t.caster.(types.BufferedBroadcasterAgent)
	default:
		t.ErrorAndExit(ErrBadCaster)
	}

	bufCaster.DisableAutoflush()

WriterLoop:
	for {
		t.setTimeout(time.Now().Add(time.Second * 10))
		select {
		case signal := <-t.signalChan: // Listen for cancellation
			if signal == 1 {
				return
			}
		case chunk := <-meta.chunkStream:
			t.ClearTimeout()

			min, max, total, err = parseRangeHeader(chunk.ContentRange)
			if err != nil {
				t.ErrorAndExit(err)
			}

			// We use `0-0/SIZE` as a fake "range header" to init the file into the map.
			// This is so we can load them in quickly to avoid a premature exit due to the writer
			// thinking its finished
			if min == 0 && max == 0 {
				fileMap[chunk.FileId] = &fileUploadProgress{file: dataStore.FsTreeGet(chunk.FileId), bytesWritten: 0, fileSizeTotal: total}
				fileMap[chunk.FileId].file.AddTask(t)
				fileMap[chunk.FileId].file.GetParent().AddTask(t)
				continue WriterLoop
			} else {
				fileMap[chunk.FileId].bytesWritten += (max - min) + 1
			}

			fileMap[chunk.FileId].file.WriteAt(chunk.Chunk, int64(min))

			// Uploading an entire 100 byte file would have the content range header
			// 0-99/100, so max is 99 and total is 100, so we -1.

			// util.Debug.Println(fileMap)

			if fileMap[chunk.FileId].bytesWritten >= fileMap[chunk.FileId].fileSizeTotal {
				bufCaster.PushFileCreate(fileMap[chunk.FileId].file)
				fileMap[chunk.FileId].file.RemoveTask(t.TaskId())
				fileMap[chunk.FileId].file.GetParent().RemoveTask(t.TaskId())
				delete(fileMap, chunk.FileId)
			}
			if len(fileMap) == 0 && len(meta.chunkStream) == 0 {
				break WriterLoop
			}

			t.CheckExit()

			continue WriterLoop

		}
	}

	t.CheckExit()
	rootFile := dataStore.FsTreeGet(meta.rootFolderId)
	dataStore.ResizeDown(rootFile, bufCaster)
	bufCaster.Flush()
	t.success()
}

func (t *task) AddChunkToStream(fileId types.FileId, chunk []byte, contentRange string) error {
	switch t.metadata.(type) {
	case WriteFileMeta:
	default:
		return ErrBadTaskMetaType
	}
	chunkData := FileChunk{FileId: fileId, Chunk: chunk, ContentRange: contentRange}
	t.metadata.(WriteFileMeta).chunkStream <- chunkData

	if t.taskPool == nil {
		GetGlobalQueue().QueueTask(t)
	}

	return nil
}

type extSize struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

func gatherFilesystemStats(t *task) {
	meta := t.metadata.(FsStatMeta)

	filetypeSizeMap := map[string]int64{}
	folderCount := 0

	// media := dataStore.GetMediaDir()
	// external := dataStore.GetExternalDir()
	// dataStore.ResizeDown(media)

	sizeFunc := func(wf types.WeblensFile) {
		if wf.IsDir() {
			folderCount++
			return
		}
		index := strings.LastIndex(wf.Filename(), ".")
		size, err := wf.Size()
		if err != nil {
			util.ErrTrace(err)
			return
		}
		if index == -1 {
			filetypeSizeMap["other"] += size
		} else {
			filetypeSizeMap[wf.Filename()[index+1:]] += size
		}
	}

	// media.RecursiveMap(sizeFunc)
	// external.RecursiveMap(sizeFunc)
	meta.rootDir.RecursiveMap(sizeFunc)

	ret := util.MapToSliceMutate(filetypeSizeMap, func(name string, value int64) extSize { return extSize{Name: name, Value: value} })

	freeSpace := dataStore.GetFreeSpace(meta.rootDir.GetAbsPath())

	t.setResult(types.TaskResult{"sizesByExtension": ret, "bytesFree": freeSpace})
	t.success()
}
