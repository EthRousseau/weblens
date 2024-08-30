package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/ethrousseau/weblens/fileTree"
	"github.com/ethrousseau/weblens/internal"
	"github.com/ethrousseau/weblens/internal/log"
	"github.com/ethrousseau/weblens/internal/werror"
	"github.com/ethrousseau/weblens/models"
	"github.com/ethrousseau/weblens/task"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var _ models.FileService = (*FileServiceImpl)(nil)

type FileServiceImpl struct {
	mediaTree  fileTree.FileTree
	cachesTree fileTree.FileTree

	userService     models.UserService
	accessService   models.AccessService
	mediaService    models.MediaService
	instanceService models.InstanceService

	fileTaskLink map[fileTree.FileId][]*task.Task
	fileTaskLock sync.RWMutex
	trashCol     *mongo.Collection
}

func NewFileService(
	mediaTree, cacheTree fileTree.FileTree, userService models.UserService,
	accessService models.AccessService, mediaService models.MediaService, trashCol *mongo.Collection,
) (*FileServiceImpl, error) {
	fs := &FileServiceImpl{
		mediaTree:     mediaTree,
		userService:   userService,
		cachesTree:    cacheTree,
		accessService: accessService,
		mediaService: mediaService,
		trashCol:      trashCol,
		fileTaskLink: make(map[fileTree.FileId][]*task.Task),
	}

	sw := internal.NewStopwatch("File Service Init")

	_, err := cacheTree.MkDir(cacheTree.GetRoot(), "thumbs", nil)
	if err != nil && !errors.Is(err, werror.ErrDirAlreadyExists) {
		return nil, werror.WithStack(err)
	}
	sw.Lap("Make thumbs dir")

	event := mediaTree.GetJournal().NewEvent()

	sw.Lap("Make journal event dir")

	users, err := userService.GetAll()
	if err != nil {
		return nil, werror.WithStack(err)
	}
	sw.Lap("Get users iter")

	for u := range users {
		if u.IsSystemUser() {
			continue
		}

		home, err := mediaTree.MkDir(mediaTree.GetRoot(), string(u.GetUsername()), event)
		if err != nil && !errors.Is(err, werror.ErrDirAlreadyExists) {
			return nil, err
		}
		u.SetHomeFolder(home)

		trash, err := mediaTree.MkDir(home, ".user_trash", event)
		if err != nil && !errors.Is(err, werror.ErrDirAlreadyExists) {
			return nil, err
		}
		u.SetTrashFolder(trash)
	}
	sw.Lap("Find or create user directories")

	mediaTree.GetJournal().LogEvent(event)

	sw.Lap("Log file event")

	err = fs.ResizeDown(mediaTree.GetRoot(), nil)
	if err != nil {
		return nil, err
	}

	sw.Lap("Resize tree")
	sw.Stop()
	sw.PrintResults(false)

	return fs, nil
}

func (fs *FileServiceImpl) Size() int {
	return fs.mediaTree.Size()
}

func (fs *FileServiceImpl) SetAccessService(accessService *AccessServiceImpl) {
	fs.accessService = accessService
}

func (fs *FileServiceImpl) SetMediaService(mediaService *MediaServiceImpl) {
	fs.mediaService = mediaService
}

func (fs *FileServiceImpl) GetFile(id fileTree.FileId) (*fileTree.WeblensFileImpl, error) {
	return fs.getFileByIdAndRoot(id, "MEDIA")
}

func (fs *FileServiceImpl) GetFiles(ids []fileTree.FileId) ([]*fileTree.WeblensFileImpl, error) {
	var files []*fileTree.WeblensFileImpl
	for _, id := range ids {
		f, err := fs.getFileByIdAndRoot(id, "MEDIA")
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

func (fs *FileServiceImpl) GetFileSafe(id fileTree.FileId, user *models.User, share *models.FileShare) (
	*fileTree.WeblensFileImpl,
	error,
) {
	f := fs.mediaTree.Get(id)
	if f == nil {
		return nil, werror.WithStack(werror.ErrNoFile)
	}

	if !fs.accessService.CanUserAccessFile(user, f, share) {
		log.Warning.Printf(
			"User [%s] attempted to access file at %s [%s], but they do not have access",
			user.GetUsername(), f.GetPortablePath(), f.ID(),
		)
		return nil, werror.WithStack(werror.ErrNoFileAccess)
	}

	return f, nil
}

func (fs *FileServiceImpl) GetThumbFileName(thumbFileName string) (*fileTree.WeblensFileImpl, error) {
	thumbsDir, err := fs.cachesTree.GetRoot().GetChild("thumbs")
	if err != nil {
		return nil, err
	}
	return thumbsDir.GetChild(thumbFileName)
}

func (fs *FileServiceImpl) GetThumbFileId(id fileTree.FileId) (*fileTree.WeblensFileImpl, error) {
	f := fs.cachesTree.Get(id)
	if f == nil {
		return nil, werror.ErrNoFile
	}
	return f, nil
}

func (fs *FileServiceImpl) IsFileInTrash(f *fileTree.WeblensFileImpl) bool {
	return strings.Contains(f.GetAbsPath(), ".user_trash")
}

func (fs *FileServiceImpl) ImportFile(f *fileTree.WeblensFileImpl) error {
	return fs.mediaTree.Add(f)
}

func (fs *FileServiceImpl) NewCacheFile(contentId string, quality models.MediaQuality, pageNum int) (
	fileTree.WeblensFile,
	error,
) {
	var pageNumStr string
	if pageNum != 0 {
		pageNumStr = fmt.Sprintf("_%d", pageNum)
	}
	filename := fmt.Sprintf("%s-%s%s.cache", contentId, quality, pageNumStr)
	thumbsDir, err := fs.cachesTree.GetRoot().GetChild("thumbs")
	if err != nil {
		return nil, err
	}

	return fs.cachesTree.Touch(thumbsDir, filename, false)
}

func (fs *FileServiceImpl) DeleteCacheFile(f fileTree.WeblensFile) error {
	_, err := fs.cachesTree.Del(f.ID(), nil)
	if err != nil {
		return err
	}
	return nil
}

func (fs *FileServiceImpl) CreateFile(parent *fileTree.WeblensFileImpl, fileName string) (
	*fileTree.WeblensFileImpl, error,
) {
	newF, err := fs.mediaTree.Touch(parent, fileName, false)
	if err != nil {
		return nil, err
	}

	return newF, nil
}

func (fs *FileServiceImpl) CreateFolder(parent *fileTree.WeblensFileImpl, folderName string, caster models.FileCaster) (
	*fileTree.WeblensFileImpl,
	error,
) {

	newF, err := fs.mediaTree.MkDir(parent, folderName, nil)
	if err != nil {
		return nil, err
	}

	caster.PushFileCreate(newF)

	return newF, nil
}

func (fs *FileServiceImpl) GetFileOwner(file *fileTree.WeblensFileImpl) *models.User {
	// if fileTree.FileTree(file.GetTree()) != fs.mediaTree {
	// 	return fs.userService.Get("WEBLENS")
	// }
	portable := file.GetPortablePath()
	if portable.RootName() != "MEDIA" {
		panic(errors.New("trying to get owner of file not in MEDIA tree"))
	}
	slashIndex := strings.Index(portable.RelativePath(), "/")
	var username models.Username
	if slashIndex == -1 {
		username = models.Username(portable.RelativePath())
	} else {
		username = models.Username(portable.RelativePath()[:slashIndex])
	}
	u := fs.userService.Get(username)
	if u == nil {
		return fs.userService.GetRootUser()
	}
	return u
}

func (fs *FileServiceImpl) MoveFileToTrash(
	file *fileTree.WeblensFileImpl, user *models.User, share *models.FileShare, caster models.FileCaster,
) error {
	if !file.Exists() {
		return werror.Errorf("Cannot with id [%s] (%s) does not exist", file.ID(), file.GetAbsPath())
	}
	if fs.IsFileInTrash(file) {
		return werror.Errorf("Cannot move file (%s) to trash because it is already in trash", file.GetAbsPath())
	}

	if !fs.accessService.CanUserAccessFile(user, file, share) {
		return werror.WithStack(werror.ErrNoFileAccess)
	}

	te := TrashEntry{
		OrigParent:   file.GetParentId(),
		OrigFilename: file.Filename(),
	}

	trashId := fs.GetFileOwner(file).TrashId
	trash, err := fs.getFileByIdAndRoot(trashId, "MEDIA")
	newFilename := MakeUniqueChildName(trash, file.Filename())

	preMoveFile := file.Freeze()

	event := fs.mediaTree.GetJournal().NewEvent()
	_, err = fs.mediaTree.Move(file, trash, newFilename, false, event)
	if err != nil {
		return err
	}

	te.FileId = file.ID()
	_, err = fs.trashCol.InsertOne(context.Background(), te)
	if err != nil {
		return err
	}

	err = fs.ResizeUp(preMoveFile.GetParent(), caster)
	if err != nil {
		log.ErrTrace(err)
	}

	err = fs.ResizeUp(trash, caster)
	if err != nil {
		log.ErrTrace(err)
	}

	caster.PushFileMove(preMoveFile, file)

	return nil
}

func (fs *FileServiceImpl) ReturnFilesFromTrash(
	trashFiles []*fileTree.WeblensFileImpl, c models.FileCaster,
) error {
	fileIds := make([]fileTree.FileId, 0, len(trashFiles))
	for _, file := range trashFiles {
		fileIds = append(fileIds, file.ID())
	}
	filter := bson.D{{"fileId", bson.M{"$in": fileIds}}}
	ret, err := fs.trashCol.Find(context.Background(), filter)
	if err != nil {
		return werror.WithStack(err)
	}

	var trashEntries []TrashEntry
	err = ret.All(context.Background(), &trashEntries)
	if err != nil {
		return werror.WithStack(err)
	}

	if len(trashEntries) != len(trashFiles) {
		return werror.Errorf("ReturnFilesFromTrash: trashEntries count does not match trashFiles")
	}

	event := fs.mediaTree.GetJournal().NewEvent()
	for i, trashEntry := range trashEntries {

		oldParent := fs.mediaTree.Get(trashEntry.OrigParent)
		if oldParent == nil {
			homeId := fs.GetFileOwner(trashFiles[i]).HomeId
			oldParent = fs.mediaTree.Get(homeId)
		}

		_, err = fs.mediaTree.Move(trashFiles[i], oldParent, trashEntry.OrigFilename, false, event)

		if err != nil {
			return err
		}
	}

	res, err := fs.trashCol.DeleteMany(context.Background(), filter)
	if res.DeletedCount != int64(len(trashEntries)) {
		return errors.New("delete trash entry did not get expected delete count")
	}
	if err != nil {
		return err
	}

	return nil
}

// PermanentlyDeleteFiles removes files being pointed to from the tree and deletes it from the real filesystem
func (fs *FileServiceImpl) PermanentlyDeleteFiles(files []*fileTree.WeblensFileImpl, caster models.FileCaster) error {
	deleteEvent := fs.mediaTree.GetJournal().NewEvent()

	var deletedIds []fileTree.FileId
	var delErr error
	for _, file := range files {
		if !fs.IsFileInTrash(file) {
			delErr = errors.New("cannot delete file not in trash")
			break
		}

		var delFiles []*fileTree.WeblensFileImpl
		delFiles, delErr = fs.mediaTree.Del(file.ID(), deleteEvent)
		if delErr != nil {
			break
		}

		deletedIds = append(deletedIds, file.ID())

		for _, delFile := range delFiles {
			if delFile.IsDir() {
				continue
			}
			media := fs.mediaService.Get(models.ContentId(delFile.GetContentId()))
			if media != nil {
				err := fs.mediaService.RemoveFileFromMedia(media, delFile.ID())
				if err != nil {
					log.ErrTrace(err)
				}
			}
		}
		caster.PushFileDelete(file)
	}

	fs.mediaTree.GetJournal().LogEvent(deleteEvent)

	_, err := fs.trashCol.DeleteMany(context.Background(), bson.M{"fileId": bson.M{"$in": deletedIds}})
	if err != nil {
		return err
	}

	// All files *should* share the same parent: the trash folder
	err = fs.ResizeUp(files[0].GetParent(), caster)
	if err != nil {
		return err
	}

	if delErr != nil {
		return delErr
	}

	return nil
}

func (fs *FileServiceImpl) ReadFile(f *fileTree.WeblensFileImpl) (io.ReadCloser, error) {
	panic("not implemented")
}

func (fs *FileServiceImpl) NewZip(zipName string, owner *models.User) (*fileTree.WeblensFileImpl, error) {
	panic("not implemented")
}

func (fs *FileServiceImpl) MoveFiles(
	files []*fileTree.WeblensFileImpl, destFolder *fileTree.WeblensFileImpl, caster models.FileCaster,
) error {
	if len(files) == 0 {
		return nil
	}

	event := fs.mediaTree.GetJournal().NewEvent()
	prevParent := files[0].GetParent()

	for _, file := range files {
		preFile := file.Freeze()
		newFilename := MakeUniqueChildName(destFolder, file.Filename())

		_, err := fs.mediaTree.Move(file, destFolder, newFilename, false, event)
		if err != nil {
			return err
		}

		caster.PushFileMove(preFile, file)
	}

	fs.mediaTree.GetJournal().LogEvent(event)

	err := fs.ResizeUp(destFolder, caster)
	if err != nil {
		return err
	}

	err = fs.ResizeUp(prevParent, caster)
	if err != nil {
		return err
	}

	return nil
}

func (fs *FileServiceImpl) RenameFile(file *fileTree.WeblensFileImpl, newName string, caster models.FileCaster) error {
	preFile := file.Freeze()
	_, err := fs.mediaTree.Move(file, file.GetParent(), newName, false, nil)
	if err != nil {
		return err
	}

	caster.PushFileMove(preFile, file)

	return nil
}

func (fs *FileServiceImpl) GetMediaRoot() *fileTree.WeblensFileImpl {
	return fs.mediaTree.GetRoot()
}

func (fs *FileServiceImpl) GetMediaJournal() fileTree.JournalService {
	return fs.mediaTree.GetJournal()
}

func (fs *FileServiceImpl) PathToFile(searchPath string, u *models.User, share *models.FileShare) (
	*fileTree.WeblensFileImpl, []*fileTree.WeblensFileImpl, error,
) {
	return nil, nil, werror.NotImplemented("PathToFile")
	// if strings.HasPrefix(searchPath, "~/") {
	// 	searchPath = "MEDIA:" + string(u.GetUsername()) + "/" + searchPath[2:]
	// } else if searchPath[:1] == "/" && u.IsAdmin() {
	// 	searchPath = "MEDIA:" + searchPath[1:]
	// } else {
	// 	return nil, nil, werror.Errorf("Bad search path: %s", searchPath)
	// }
	//
	// lastSlashIndex := strings.LastIndex(searchPath, "/")
	// if lastSlashIndex == -1 {
	// 	if !strings.HasSuffix(searchPath, "/") {
	// 		searchPath += "/"
	// 	}
	// 	lastSlashIndex = len(searchPath) - 1
	// }
	// folderId := fs.mediaTree.GenerateFileId()
	//
	// folder, err := fs.GetFileSafe(folderId, u, share)
	// if err != nil {
	// 	// ctx.JSON(http.StatusOK, gin.H{"children": []string{}, "folder": nil})
	// 	return nil, nil, err
	// }
	//
	// postFix := searchPath[lastSlashIndex+1:]
	// allChildren := folder.GetChildren()
	// childNames := internal.Map(
	// 	allChildren, func(c *fileTree.WeblensFileImpl) string {
	// 		return c.Filename()
	// 	},
	// )
	//
	// matches := fuzzy.RankFindFold(postFix, childNames)
	// slices.SortFunc(
	// 	matches, func(a, b fuzzy.Rank) int {
	// 		diff := a.Distance - b.Distance
	// 		if diff != 0 {
	// 			return diff
	// 		}
	//
	// 		return allChildren[a.OriginalIndex].ModTime().Compare(allChildren[b.OriginalIndex].ModTime())
	// 	},
	// )
	//
	// children := internal.FilterMap(
	// 	matches, func(match fuzzy.Rank) (*fileTree.WeblensFileImpl, bool) {
	// 		f := allChildren[match.OriginalIndex]
	// 		if f.ID() == u.TrashId {
	// 			return nil, false
	// 		}
	// 		return f, true
	// 	},
	// )
	//
	// return folder, children, nil
}

func (fs *FileServiceImpl) AddTask(f *fileTree.WeblensFileImpl, t *task.Task) error {
	fs.fileTaskLock.Lock()
	defer fs.fileTaskLock.Unlock()
	tasks, ok := fs.fileTaskLink[f.ID()]
	if !ok {
		tasks = []*task.Task{}
	} else if slices.Contains(tasks, t) {
		return werror.ErrFileAlreadyHasTask
	}

	fs.fileTaskLink[f.ID()] = append(tasks, t)
	return nil
}

func (fs *FileServiceImpl) RemoveTask(f *fileTree.WeblensFileImpl, t *task.Task) error {
	fs.fileTaskLock.Lock()
	defer fs.fileTaskLock.Unlock()
	tasks, ok := fs.fileTaskLink[f.ID()]
	if !ok {
		return werror.ErrFileNoTask
	}

	i := slices.Index(tasks, t)
	if i == -1 {
		return werror.ErrFileNoTask
	}

	fs.fileTaskLink[f.ID()] = internal.Banish(tasks, i)
	return nil
}

func (fs *FileServiceImpl) GetTasks(f *fileTree.WeblensFileImpl) []*task.Task {
	fs.fileTaskLock.RLock()
	defer fs.fileTaskLock.RUnlock()
	return fs.fileTaskLink[f.ID()]
}

func GenerateContentId(f *fileTree.WeblensFileImpl) (models.ContentId, error) {
	if f.IsDir() {
		return "", nil
	}

	if f.GetContentId() != "" {
		return models.ContentId(f.GetContentId()), nil
	}

	fileSize, err := f.Size()
	if err != nil {
		return "", err
	}

	// Read up to 1MB at a time
	bufSize := math.Min(float64(fileSize), 1000*1000)
	buf := make([]byte, int64(bufSize))
	newHash := sha256.New()
	fp, err := f.Readable()
	if err != nil {
		return "", err
	}

	defer func(fp *os.File) {
		err := fp.Close()
		if err != nil {
			log.ShowErr(err)
		}
	}(fp)

	_, err = io.CopyBuffer(newHash, fp, buf)
	if err != nil {
		return "", err
	}

	contentId := base64.URLEncoding.EncodeToString(newHash.Sum(nil))[:20]
	f.SetContentId(contentId)

	return models.ContentId(contentId), nil
}

func MakeUniqueChildName(parent *fileTree.WeblensFileImpl, childName string) string {
	dupeCount := 0
	_, e := parent.GetChild(childName)
	for e == nil {
		dupeCount++
		tmp := fmt.Sprintf("%s (%d)", childName, dupeCount)
		_, e = parent.GetChild(tmp)
	}

	newFilename := childName
	if dupeCount != 0 {
		newFilename = fmt.Sprintf("%s (%d)", newFilename, dupeCount)
	}

	return newFilename
}

func (fs *FileServiceImpl) resizeMultiple(old, new *fileTree.WeblensFileImpl, caster models.FileCaster) (err error) {
	// Check if either of the files are a parent of the other
	oldIsParent := strings.HasPrefix(old.GetAbsPath(), new.GetAbsPath())
	newIsParent := strings.HasPrefix(new.GetAbsPath(), old.GetAbsPath())

	if oldIsParent || !newIsParent {
		err = fs.ResizeUp(old, caster)
		if err != nil {
			return
		}
	}

	if newIsParent || !oldIsParent {
		err = fs.ResizeUp(new, caster)
		if err != nil {
			return
		}
	}

	return
}

func (fs *FileServiceImpl) ResizeUp(f *fileTree.WeblensFileImpl, caster models.FileCaster) error {
	return f.BubbleMap(
		func(w *fileTree.WeblensFileImpl) error {
			newSize, err := w.LoadStat()
			if err != nil {
				return err
			}
			if newSize != -1 {
				caster.PushFileUpdate(w, nil)
			}

			return nil
		},
	)
}

func (fs *FileServiceImpl) ResizeDown(f *fileTree.WeblensFileImpl, caster models.FileCaster) error {
	return f.LeafMap(
		func(w *fileTree.WeblensFileImpl) error {
			_, err := w.LoadStat()
			return err
		},
	)
}

func (fs *FileServiceImpl) getFileByIdAndRoot(id fileTree.FileId, rootAlias string) (*fileTree.WeblensFileImpl, error) {
	var f *fileTree.WeblensFileImpl
	switch rootAlias {
	case "MEDIA":
		f = fs.mediaTree.Get(id)
	case "CACHES":
		f = fs.cachesTree.Get(id)
	default:
		return nil, werror.Errorf("Trying to get file on non-existant tree [%s]", rootAlias)
	}

	if f == nil {
		return nil, werror.ErrNoFile
	}

	return f, nil
}

func (fs *FileServiceImpl) clearTempDir() (err error) {
	tmpRoot := fs.cachesTree.Get("TMP")
	err = os.MkdirAll(tmpRoot.GetAbsPath(), os.ModePerm)
	if err != nil {
		return
	}

	files, err := os.ReadDir(tmpRoot.GetAbsPath())
	if err != nil {
		return
	}

	for _, file := range files {
		err := os.RemoveAll(filepath.Join(internal.GetTmpDir(), file.Name()))
		if err != nil {
			return err
		}
	}

	return nil
}

func (fs *FileServiceImpl) clearTakeoutDir() error {
	takeoutRoot := fs.cachesTree.Get("TAKEOUT")
	err := os.MkdirAll(takeoutRoot.GetAbsPath(), os.ModePerm)
	if err != nil {
		return err
	}

	files, err := os.ReadDir(takeoutRoot.GetAbsPath())
	if err != nil {
		return err
	}

	for _, file := range files {
		err := os.Remove(filepath.Join(takeoutRoot.GetAbsPath(), file.Name()))
		if err != nil {
			return err
		}
	}

	return nil
}

func (fs *FileServiceImpl) clearThumbsDir() error {
	_, err := fs.cachesTree.Del("THUMBS", nil)
	if err != nil {
		return err
	}

	_, err = fs.cachesTree.MkDir(fs.cachesTree.GetRoot(), "thumbs", nil)
	if err != nil {
		return err
	}

	return nil
}

type TrashEntry struct {
	OrigParent   fileTree.FileId `bson:"originalParentId"`
	OrigFilename string          `bson:"originalFilename"`
	FileId fileTree.FileId `bson:"fileId"`
}
