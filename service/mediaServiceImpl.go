package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/EdlinOrg/prominentcolor"
	"github.com/barasher/go-exiftool"
	"github.com/ethanrous/weblens/fileTree"
	"github.com/ethanrous/weblens/internal"
	"github.com/ethanrous/weblens/internal/log"
	"github.com/ethanrous/weblens/internal/werror"
	"github.com/ethanrous/weblens/models"
	ffmpeg "github.com/u2takey/ffmpeg-go"
	"github.com/viccon/sturdyc"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/image/webp"

	ollama "github.com/ollama/ollama/api"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"gopkg.in/gographics/imagick.v3/imagick"
)

var _ models.MediaService = (*MediaServiceImpl)(nil)

type MediaServiceImpl struct {
	filesBuffer sync.Pool

	typeService models.MediaTypeService
	fileService models.FileService

	AlbumService models.AlbumService
	mediaMap     map[models.ContentId]*models.Media

	streamerMap map[models.ContentId]*models.VideoStreamer

	mediaCache *sturdyc.Client[[]byte]

	collection *mongo.Collection

	ollama *ollama.Client

	doImageRecog bool

	log log.Bundle

	mediaLock sync.RWMutex

	streamerLock sync.RWMutex
}

var exif *exiftool.Exiftool

type cacheKey string

const (
	CacheIdKey      cacheKey = "cacheId"
	CacheQualityKey cacheKey = "cacheQuality"
	CachePageKey    cacheKey = "cachePageNum"
	CacheMediaKey   cacheKey = "cacheMedia"

	HighresSize = 2500
	ThumbSize   = 500
)

func init() {
	var err error
	exif, err = exiftool.NewExiftool(
		exiftool.Api("largefilesupport"),
		exiftool.Buffer([]byte{}, 1000*100),
	)
	if err != nil {
		panic(err)
	}

	imagick.Initialize()
}

func NewMediaService(
	fileService models.FileService, mediaTypeServ models.MediaTypeService, albumService models.AlbumService,
	col *mongo.Collection, logger log.Bundle,
) (*MediaServiceImpl, error) {
	ms := &MediaServiceImpl{
		mediaMap:     make(map[models.ContentId]*models.Media),
		streamerMap:  make(map[models.ContentId]*models.VideoStreamer),
		typeService:  mediaTypeServ,
		mediaCache:   sturdyc.New[[]byte](1500, 10, time.Hour, 10),
		fileService:  fileService,
		collection:   col,
		AlbumService: albumService,
		filesBuffer:  sync.Pool{New: func() any { return &[]byte{} }},
		log:          logger,
		doImageRecog: os.Getenv("OLLAMA_HOST") != "",
	}

	client, err := ollama.ClientFromEnvironment()
	if err != nil {
		return nil, err
	}

	ms.ollama = client

	indexModel := mongo.IndexModel{
		Keys:    bson.D{{Key: "contentId", Value: 1}},
		Options: (&options.IndexOptions{}).SetUnique(true),
	}
	_, err = col.Indexes().CreateOne(context.Background(), indexModel)
	if err != nil {
		return nil, err
	}

	ret, err := ms.collection.Find(context.Background(), bson.M{})
	if err != nil {
		return nil, werror.WithStack(err)
	}

	ms.mediaLock.Lock()
	defer ms.mediaLock.Unlock()

	cursorContext := context.Background()
	for ret.Next(cursorContext) {
		m := &models.Media{}
		err = ret.Decode(m)
		if err != nil {
			return nil, werror.WithStack(err)
		}
		ms.mediaMap[m.ID()] = m
	}

	return ms, nil
}

func (ms *MediaServiceImpl) Size() int {
	return len(ms.mediaMap)
}

func (ms *MediaServiceImpl) Add(m *models.Media) error {
	if m == nil {
		return werror.ErrMediaNil
	}

	if m.ID() == "" {
		return werror.ErrMediaNoId
	}

	if m.GetPageCount() == 0 {
		return werror.ErrMediaNoPages
	}

	if m.Width == 0 || m.Height == 0 {
		log.Debug.Printf("Media %s has height %d and width %d", m.ID(), m.Height, m.Width)
		return werror.ErrMediaNoDimensions
	}

	if len(m.FileIDs) == 0 {
		return werror.ErrMediaNoFiles
	}

	mt := ms.GetMediaType(m)
	if mt.Mime == "" || mt.Mime == "generic" {
		return werror.ErrMediaBadMime
	}

	isVideo := mt.Video
	if isVideo && m.Duration == 0 {
		return werror.ErrMediaNoDuration
	}

	if !isVideo && m.Duration != 0 {
		return werror.ErrMediaHasDuration
	}

	ms.mediaLock.Lock()
	defer ms.mediaLock.Unlock()

	if ms.mediaMap[m.ID()] != nil {
		return werror.ErrMediaAlreadyExists
	}

	if !m.IsImported() {
		m.SetImported(true)
		m.MediaID = primitive.NewObjectID()
		_, err := ms.collection.InsertOne(context.Background(), m)
		if err != nil {
			return werror.WithStack(err)
		}
	}

	ms.mediaMap[m.ID()] = m

	return nil
}

func (ms *MediaServiceImpl) TypeService() models.MediaTypeService {
	return ms.typeService
}

func (ms *MediaServiceImpl) Get(mId models.ContentId) *models.Media {
	if mId == "" {
		return nil
	}

	ms.mediaLock.RLock()
	defer ms.mediaLock.RUnlock()
	m := ms.mediaMap[mId]

	return m
}

func (ms *MediaServiceImpl) GetAll() []*models.Media {
	ms.mediaLock.RLock()
	defer ms.mediaLock.RUnlock()
	medias := internal.MapToValues(ms.mediaMap)
	return internal.SliceConvert[*models.Media](medias)
}

func (ms *MediaServiceImpl) Del(cId models.ContentId) error {
	m := ms.Get(cId)
	err := ms.removeCacheFiles(m)
	if err != nil && !errors.Is(err, werror.ErrNoCache) {
		return err
	}

	err = ms.AlbumService.RemoveMediaFromAny(m.ID())
	if err != nil {
		return err
	}

	filter := bson.M{"contentId": m.ID()}
	_, err = ms.collection.DeleteOne(context.Background(), filter)
	if err != nil {
		return werror.WithStack(err)
	}

	ms.mediaLock.Lock()
	defer ms.mediaLock.Unlock()
	delete(ms.mediaMap, m.ID())

	return nil
}

func (ms *MediaServiceImpl) HideMedia(m *models.Media, hidden bool) error {
	filter := bson.M{"contentId": m.ID()}
	_, err := ms.collection.UpdateOne(context.Background(), filter, bson.M{"$set": bson.M{"hidden": hidden}})
	if err != nil {
		return werror.WithStack(err)
	}

	m.Hidden = hidden

	return nil
}

func (ms *MediaServiceImpl) FetchCacheImg(m *models.Media, q models.MediaQuality, pageNum int) ([]byte, error) {
	cacheId := m.ID() + string(q) + strconv.Itoa(pageNum)

	ctx := context.Background()
	ctx = context.WithValue(ctx, CacheIdKey, cacheId)
	ctx = context.WithValue(ctx, CacheQualityKey, q)
	ctx = context.WithValue(ctx, CachePageKey, pageNum)
	ctx = context.WithValue(ctx, CacheMediaKey, m)

	cache, err := ms.mediaCache.GetOrFetch(ctx, cacheId, ms.getFetchMediaCacheImage)
	if err != nil {
		return nil, werror.WithStack(err)
	}
	return cache, nil
}

func (ms *MediaServiceImpl) StreamCacheVideo(m *models.Media, startByte, endByte int) ([]byte, error) {
	return nil, werror.NotImplemented("StreamCacheVideo")
	// cacheKey := fmt.Sprintf("%s-STREAM %d-%d", m.ID(), startByte, endByte)

	// ctx := context.Background()
	// ctx = context.WithValue(ctx, "cacheKey", cacheKey)
	// ctx = context.WithValue(ctx, "startByte", startByte)
	// ctx = context.WithValue(ctx, "endByte", endByte)
	// ctx = context.WithValue(ctx, "Media", m)

	// video, err := fetchAndCacheVideo(m.(*Media), startByte, endByte)
	// if err != nil {
	// 	return nil, err
	// }
	// cache, err := mr.mediaCache.GetFetch(ctx, cacheKey, fetchAndCacheVideo)
	// if err != nil {
	// 	return nil, err
	// }
	// return cache, nil
}

type justContentId struct {
	Cid string `bson:"contentId"`
}

func (ms *MediaServiceImpl) GetFilteredMedia(
	requester *models.User, sort string, sortDirection int, excludeIds []models.ContentId,
	allowRaw bool, allowHidden bool, search string,
) ([]*models.Media, error) {
	slices.Sort(excludeIds)

	pipe := bson.A{
		bson.D{
			{Key: "$match", Value: bson.D{
				{Key: "owner", Value: requester.GetUsername()},
				{Key: "fileIds", Value: bson.D{
					{Key: "$exists", Value: true}, {Key: "$ne", Value: bson.A{}},
				}}},
			},
		},
	}

	if !allowHidden {
		pipe = append(pipe, bson.D{{Key: "$match", Value: bson.D{{Key: "hidden", Value: false}}}})
	}

	if search != "" {
		search = strings.ToLower(search)
		pipe = append(pipe, bson.D{{Key: "$match", Value: bson.D{{Key: "recognitionTags", Value: bson.D{{Key: "$regex", Value: search}}}}}})
	}

	pipe = append(pipe, bson.D{{Key: "$sort", Value: bson.D{{Key: sort, Value: sortDirection}}}})
	pipe = append(pipe, bson.D{{Key: "$project", Value: bson.D{{Key: "_id", Value: false}, {Key: "contentId", Value: true}}}})

	cur, err := ms.collection.Aggregate(context.Background(), pipe)
	if err != nil {
		return nil, werror.WithStack(err)
	}

	allIds := []justContentId{}
	err = cur.All(context.Background(), &allIds)
	if err != nil {
		return nil, werror.WithStack(err)
	}

	medias := make([]*models.Media, 0, len(allIds))
	for _, id := range allIds {
		m := ms.Get(id.Cid)
		if m != nil {
			if m.MimeType == "application/pdf" {
				continue
			}
			if !allowRaw {
				mt := ms.GetMediaType(m)
				if mt.Raw {
					continue
				}
			}
			medias = append(medias, m)
		}
	}

	return medias, nil
}

func (ms *MediaServiceImpl) AdjustMediaDates(
	anchor *models.Media, newTime time.Time, extraMedias []*models.Media,
) error {
	offset := newTime.Sub(anchor.GetCreateDate())

	anchor.SetCreateDate(anchor.GetCreateDate().Add(offset))

	for _, m := range extraMedias {
		m.SetCreateDate(m.GetCreateDate().Add(offset))
	}

	// TODO - update media date in DB

	return nil
}

func (ms *MediaServiceImpl) IsCached(m *models.Media) bool {
	cacheFile, err := ms.getCacheFile(m, models.LowRes, 0)
	return cacheFile != nil && err == nil
}

func (ms *MediaServiceImpl) IsFileDisplayable(f *fileTree.WeblensFileImpl) bool {
	ext := filepath.Ext(f.Filename())
	return ms.typeService.ParseExtension(ext).Displayable
}

func (ms *MediaServiceImpl) AddFileToMedia(m *models.Media, f *fileTree.WeblensFileImpl) error {
	if slices.ContainsFunc(
		m.FileIDs, func(fId fileTree.FileId) bool {
			return fId == f.ID()
		},
	) {
		return nil
	}

	filter := bson.M{"contentId": m.ID()}
	update := bson.M{"$addToSet": bson.M{"fileIds": f.ID()}}
	_, err := ms.collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		return err
	}

	m.AddFile(f)

	return nil
}

func (ms *MediaServiceImpl) RemoveFileFromMedia(media *models.Media, fileId fileTree.FileId) error {
	filter := bson.M{"contentId": media.ID()}
	update := bson.M{"$pull": bson.M{"fileIds": fileId}}
	_, err := ms.collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		return err
	}

	media.RemoveFile(fileId)

	if len(media.FileIDs) == 1 && media.FileIDs[0] == fileId {
		return ms.Del(media.ID())
	}

	return nil
}

func (ms *MediaServiceImpl) Cleanup() error {
	for _, m := range ms.mediaMap {
		fs, missing, err := ms.fileService.GetFiles(m.FileIDs)
		if err != nil {
			return err
		}
		for _, f := range fs {
			if f.GetPortablePath().RootName() != "USERS" {
				missing = append(missing, f.ID())
			}
		}

		for _, fId := range missing {
			err = ms.RemoveFileFromMedia(m, fId)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func (ms *MediaServiceImpl) GetProminentColors(media *models.Media) (prom []string, err error) {
	var i image.Image
	thumbBytes, err := ms.FetchCacheImg(media, models.LowRes, 0)
	if err != nil {
		return
	}

	i, err = webp.Decode(bytes.NewBuffer(thumbBytes))
	if err != nil {
		return
	}

	promColors, err := prominentcolor.Kmeans(i)
	prom = internal.Map(promColors, func(p prominentcolor.ColorItem) string { return p.AsString() })
	return
}

func (ms *MediaServiceImpl) StreamVideo(
	m *models.Media, u *models.User, share *models.FileShare,
) (*models.VideoStreamer, error) {
	if !ms.GetMediaType(m).Video {
		return nil, werror.WithStack(werror.ErrMediaNotVideo)
	}

	ms.streamerLock.Lock()
	defer ms.streamerLock.Unlock()

	var streamer *models.VideoStreamer
	var ok bool
	if streamer, ok = ms.streamerMap[m.ID()]; !ok {
		f, err := ms.fileService.GetFileByContentId(m.ContentID)
		if err != nil {
			return nil, err
		}

		thumbs, err := ms.fileService.GetThumbsDir()
		if err != nil {
			return nil, err
		}
		streamer = models.NewVideoStreamer(f, thumbs.AbsPath())
		ms.streamerMap[m.ID()] = streamer
	}

	return streamer, nil
}

func (ms *MediaServiceImpl) SetMediaLiked(mediaId models.ContentId, liked bool, username models.Username) error {
	m := ms.Get(mediaId)
	if m == nil {
		return werror.Errorf("Could not find media with id [%s] while trying to update liked array", mediaId)
	}

	filter := bson.M{"contentId": mediaId}
	var update bson.M
	if liked && len(m.LikedBy) == 0 {
		update = bson.M{"$set": bson.M{"likedBy": []models.Username{username}}}
	} else if liked && len(m.LikedBy) == 0 {
		update = bson.M{"$addToSet": bson.M{"likedBy": username}}
	} else {
		update = bson.M{"$pull": bson.M{"likedBy": username}}
	}

	_, err := ms.collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		return err
	}

	if liked {
		m.LikedBy = internal.AddToSet(m.LikedBy, username)
	} else {
		m.LikedBy = internal.Filter(
			m.LikedBy, func(u models.Username) bool {
				return u != username
			},
		)
	}

	return nil
}

func (ms *MediaServiceImpl) removeCacheFiles(media *models.Media) error {
	thumbCache, err := ms.getCacheFile(media, models.LowRes, 0)
	if err != nil && !errors.Is(err, werror.ErrNoFile) {
		return err
	}

	if thumbCache != nil {
		err = ms.fileService.DeleteCacheFile(thumbCache)
		if err != nil {
			return err
		}
	}

	highresCacheFile, err := ms.getCacheFile(media, models.HighRes, 0)
	if err != nil && !errors.Is(err, werror.ErrNoFile) {
		return err
	}

	if highresCacheFile != nil {
		err = ms.fileService.DeleteCacheFile(highresCacheFile)
		if err != nil {
			return err
		}
	}

	return nil
}

func (ms *MediaServiceImpl) LoadMediaFromFile(m *models.Media, file *fileTree.WeblensFileImpl) error {
	fileMetas := exif.ExtractMetadata(file.AbsPath())

	for _, fileMeta := range fileMetas {
		if fileMeta.Err != nil {
			return fileMeta.Err
		}
	}

	var err error
	if m.CreateDate.Unix() <= 0 {
		r, ok := fileMetas[0].Fields["SubSecCreateDate"]
		if !ok {
			r, ok = fileMetas[0].Fields["MediaCreateDate"]
		}
		if ok {
			m.CreateDate, err = time.Parse("2006:01:02 15:04:05.000-07:00", r.(string))
			if err != nil {
				m.CreateDate, err = time.Parse("2006:01:02 15:04:05.00-07:00", r.(string))
			}
			if err != nil {
				m.CreateDate, err = time.Parse("2006:01:02 15:04:05", r.(string))
			}
			if err != nil {
				m.CreateDate, err = time.Parse("2006:01:02 15:04:05-07:00", r.(string))
			}
			if err != nil {
				m.CreateDate = file.ModTime()
			}
		} else {
			m.CreateDate = file.ModTime()
		}
	}

	if m.MimeType == "" {
		mimeType, ok := fileMetas[0].Fields["MIMEType"].(string)
		if !ok {
			ext := filepath.Ext(file.Filename())
			mType := ms.typeService.ParseExtension(ext)
			m.MimeType = mType.Mime
		} else {
			m.MimeType = mimeType
		}

		if ms.typeService.ParseMime(m.MimeType).Video {
			probeJson, err := ffmpeg.Probe(file.AbsPath())
			if err != nil {
				return err
			}
			probeResult := map[string]any{}
			err = json.Unmarshal([]byte(probeJson), &probeResult)
			if err != nil {
				return err
			}

			formatChunk, ok := probeResult["format"].(map[string]any)
			if !ok {
				return errors.New("invalid movie format")
			}
			duration, err := strconv.ParseFloat(formatChunk["duration"].(string), 32)
			if err != nil {
				return err
			}
			m.Duration = int(duration * 1000)

			m.Height = int(fileMetas[0].Fields["ImageHeight"].(float64))
			m.Width = int(fileMetas[0].Fields["ImageWidth"].(float64))
		}
	}

	mType := ms.GetMediaType(m)
	if !mType.IsSupported() {
		return werror.ErrMediaBadMime
	}

	if mType.IsMultiPage() {
		m.PageCount = int(fileMetas[0].Fields["PageCount"].(float64))
	} else {
		m.PageCount = 1
	}

	if m.Rotate == "" {
		rotate := fileMetas[0].Fields["Orientation"]
		if rotate != nil {
			m.Rotate = rotate.(string)
		}
	}

	buf := *ms.filesBuffer.Get().(*[]byte)
	log.Trace.Func(func(l log.Logger) {
		if len(buf) > 0 {
			l.Printf("Re-using buffer of %d bytes", len(buf))
		}
	})

	thumb, err := ms.handleCacheCreation(m, file)
	if err != nil {
		return err
	}

	if !mType.Video && ms.doImageRecog {
		go func() {
			err := ms.GetImageTags(m, thumb)
			if err != nil {
				ms.log.ErrTrace(err)
			}
		}()
	}

	return nil
}

func (ms *MediaServiceImpl) GetMediaType(m *models.Media) models.MediaType {
	return ms.typeService.ParseMime(m.MimeType)
}

func (ms *MediaServiceImpl) GetMediaTypes() models.MediaTypeService {
	return ms.typeService
}

func (ms *MediaServiceImpl) RecursiveGetMedia(folders ...*fileTree.WeblensFileImpl) []*models.Media {
	var medias []*models.Media

	for _, f := range folders {
		if f == nil {
			log.Warning.Println("Skipping recursive media lookup for non-existent folder")
			continue
		}
		if !f.IsDir() {
			if ms.IsFileDisplayable(f) {
				m := ms.Get(f.GetContentId())
				if m != nil {
					medias = append(medias, m)
				}
			}
			continue
		}
		err := f.RecursiveMap(
			func(f *fileTree.WeblensFileImpl) error {
				if !f.IsDir() && ms.IsFileDisplayable(f) {
					m := ms.Get(f.GetContentId())
					if m != nil {
						medias = append(medias, m)
					}
				}
				return nil
			},
		)
		if err != nil {
			log.ShowErr(err)
		}
	}

	return medias
}

func (ms *MediaServiceImpl) handleCacheCreation(m *models.Media, file *fileTree.WeblensFileImpl) (thumbBytes []byte, err error) {
	sw := internal.NewStopwatch("Cache Create")

	mType := ms.GetMediaType(m)
	sw.Lap("Get media type")

	if !mType.Video {
		// Setup magick wand
		mw := imagick.NewMagickWand()
		// defer mw.Destroy()
		sw.Lap("New MagickWand")

		err := mw.SetCompressionQuality(100)
		if err != nil {
			return nil, werror.WithStack(err)
		}

		// Make sure PDFs are read with enough fidelity to be recreated
		// this should not affect images that already have dimensions
		err = mw.SetResolution(300, 300)
		if err != nil {
			return nil, err
		}

		// Load image into magick wand buffer
		err = mw.ReadImage(file.AbsPath())
		if err != nil {
			return nil, werror.WithStack(err)
		}
		sw.Lap("Read image")

		if !mType.IsMultiPage() {
			// Rotate image based on exif data
			err = mw.AutoOrientImage()
			if err != nil {
				return nil, werror.WithStack(err)
			}
			sw.Lap("Image orientation")
		}

		// Read image dimensions
		width := mw.GetImageWidth()
		height := mw.GetImageHeight()
		m.Height = int(height)
		m.Width = int(width)
		sw.Lap("Read image dimensions")

		mw.SetIteratorIndex(0)
		thumbImage := mw.GetImage()

		for page := range m.PageCount {
			mw.SetIteratorIndex(page)
			tmpMw := mw.GetImage()

			// Make sure that transparent background PDFs are white
			tmpMw = tmpMw.MergeImageLayers(imagick.IMAGE_LAYER_FLATTEN)

			// Convert image to webp format for effecient transfer
			err = tmpMw.SetImageFormat("webp")
			if err != nil {
				return nil, werror.WithStack(err)
			}
			sw.Lap("Image convert to webp")

			// Resize highres image if too big
			if width > HighresSize || height > HighresSize {
				var fullWidth, fullHeight uint
				if width > height {
					fullWidth = HighresSize
					fullHeight = HighresSize * uint(height) / uint(width)
				} else {
					fullHeight = HighresSize
					fullWidth = HighresSize * uint(width) / uint(height)
				}
				log.Trace.Printf("Resizing %s highres image to %dx%d", file.Filename(), fullWidth, fullHeight)

				err = tmpMw.ScaleImage(fullWidth, fullHeight)
				if err != nil {
					return nil, werror.WithStack(err)
				}
				sw.Lap("Image resize for fullres")
			}

			// Create and write highres cache file
			highres, err := ms.fileService.NewCacheFile(m, models.HighRes, page)
			if err != nil && !errors.Is(err, werror.ErrFileAlreadyExists) {
				return nil, werror.WithStack(err)
			} else if err == nil {
				blob, err := tmpMw.GetImageBlob()
				if err != nil {
					return nil, werror.WithStack(err)
				}
				_, err = highres.Write(blob)
				if err != nil {
					return nil, werror.WithStack(err)
				}
				m.SetHighresCacheFiles(highres, page)
				sw.Lap("Write highres cache file")
			}
		}

		// return to first page if this is a PDF, so the thumbnail will be the cover page
		// mw.SetIteratorIndex(0)
		mw = thumbImage.MergeImageLayers(imagick.IMAGE_LAYER_FLATTEN)
		err = mw.SetImageFormat("webp")
		if err != nil {
			return nil, werror.WithStack(err)
		}

		// Resize thumb image if too big
		if width > ThumbSize || height > ThumbSize {
			var thumbWidth, thumbHeight uint
			if width > height {
				thumbWidth = ThumbSize
				thumbHeight = uint(float64(ThumbSize) / float64(width) * float64(height))
			} else {
				thumbHeight = ThumbSize
				thumbWidth = uint(float64(ThumbSize) / float64(height) * float64(width))
			}
			log.Trace.Printf("Resizing %s thumb image to %dx%d", file.Filename(), thumbWidth, thumbHeight)
			err = mw.ScaleImage(thumbWidth, thumbHeight)
			if err != nil {
				return nil, werror.WithStack(err)
			}
			sw.Lap("Image resize for thumb")
		}

		// Create and write thumb cache file
		thumb, err := ms.fileService.NewCacheFile(m, models.LowRes, 0)
		if err != nil && !errors.Is(err, werror.ErrFileAlreadyExists) {
			return nil, werror.WithStack(err)
		} else if err == nil {
			blob, err := mw.GetImageBlob()
			if err != nil {
				return nil, werror.WithStack(err)
			}
			_, err = thumb.Write(blob)
			if err != nil {
				return nil, werror.WithStack(err)
			}
			m.SetLowresCacheFile(thumb)

			thumbBytes = blob
		}

		sw.Lap("Write thumb")
	} else {
		const frameNum = 10

		buf := bytes.NewBuffer(nil)
		errOut := bytes.NewBuffer(nil)

		thumb, err := ms.fileService.NewCacheFile(m, models.LowRes, 0)
		if err != nil && !errors.Is(err, werror.ErrFileAlreadyExists) {
			return nil, werror.WithStack(err)
		} else if err == nil {
			// Get the 10th frame of the video and save it to the cache as the thumbnail
			// "Highres" for video is the video itself
			err := ffmpeg.Input(file.AbsPath()).Filter(
				"select", ffmpeg.Args{fmt.Sprintf("gte(n,%d)", frameNum)},
			).Output(
				"pipe:", ffmpeg.KwArgs{"frames:v": 1, "format": "image2", "vcodec": "mjpeg"},
			).WithOutput(buf).WithErrorOutput(errOut).Run()
			if err != nil {
				ms.log.Error.Println(errOut)
				return nil, werror.WithStack(err)
			}
			_, err = thumb.Write(buf.Bytes())
			if err != nil {
				return nil, werror.WithStack(err)
			}
			m.SetLowresCacheFile(thumb)

			thumbBytes = buf.Bytes()
		}

		sw.Lap("Read video")
	}

	return thumbBytes, nil
}

func (ms *MediaServiceImpl) getFetchMediaCacheImage(ctx context.Context) (data []byte, err error) {
	defer internal.RecoverPanic("Fetching media image had panic")

	m := ctx.Value(CacheMediaKey).(*models.Media)
	q := ctx.Value(CacheQualityKey).(models.MediaQuality)
	pageNum, _ := ctx.Value(CachePageKey).(int)

	f, err := ms.getCacheFile(m, q, pageNum)
	if err != nil {
		return nil, err
	}

	if f == nil {
		return nil, werror.Errorf("This should never happen... file is nil in GetFetchMediaCacheImage")
	}

	log.Trace.Printf("Reading image cache for media [%s]", m.ID())

	data, err = f.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		err = werror.Errorf("displayable bytes empty")
		return nil, err
	}

	return data, nil
}

func (ms *MediaServiceImpl) getCacheFile(
	m *models.Media, quality models.MediaQuality, pageNum int,
) (*fileTree.WeblensFileImpl, error) {
	if quality == models.LowRes && m.GetLowresCacheFile() != nil {
		return m.GetLowresCacheFile(), nil
	} else if quality == models.HighRes && m.GetHighresCacheFiles(pageNum) != nil {
		return m.GetHighresCacheFiles(pageNum), nil
	}

	filename := m.FmtCacheFileName(quality, pageNum)
	cacheFile, err := ms.fileService.GetMediaCacheByFilename(filename)
	if err != nil {
		return nil, werror.WithStack(werror.ErrNoCache)
	}

	if quality == models.LowRes {
		m.SetLowresCacheFile(cacheFile)
	} else if quality == models.HighRes {
		m.SetHighresCacheFiles(cacheFile, pageNum)
	} else {
		return nil, werror.Errorf("Unknown media quality [%s]", quality)
	}

	return cacheFile, nil
}

var recogLock sync.Mutex

func (ms *MediaServiceImpl) GetImageTags(m *models.Media, imageBytes []byte) error {
	if !ms.doImageRecog {
		return nil
	}

	recogLock.Lock()
	defer recogLock.Unlock()
	mw := imagick.NewMagickWand()

	err := mw.ReadImageBlob(imageBytes)
	if err != nil {
		return werror.WithStack(err)
	}
	err = mw.SetImageFormat("jpeg")
	if err != nil {
		return werror.WithStack(err)
	}
	blob, err := mw.GetImageBlob()
	if err != nil {
		return werror.WithStack(err)
	}

	stream := false

	req := &ollama.GenerateRequest{
		Model:  "llava:13b",
		Prompt: "describe this image using a list of single words seperated only by commas. do not include any text other than these words",
		Images: []ollama.ImageData{blob},
		Stream: &stream,
		Options: map[string]any{
			"n_ctx":       1024,
			"num_predict": 25,
		},
	}

	tagsString := ""
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*60)
	defer cancel()
	doneChan := make(chan struct{})
	err = ms.ollama.Generate(ctx, req, func(resp ollama.GenerateResponse) error {
		ms.log.Trace.Println("Got recognition response", resp.Response)
		tagsString = resp.Response

		if resp.Done {
			close(doneChan)
		}

		return nil
	})

	if err != nil {
		return werror.WithStack(err)
	}

	select {
	case <-doneChan:
	case <-ctx.Done():
	}

	if ctx.Err() != nil {
		return werror.WithStack(ctx.Err())
	}

	tags := strings.Split(tagsString, ",")
	for i, tag := range tags {
		tags[i] = strings.ToLower(strings.ReplaceAll(tag, " ", ""))
	}

	_, err = ms.collection.UpdateOne(context.Background(), bson.M{"contentId": m.ID()}, bson.M{"$set": bson.M{"recognitionTags": tags}})
	if err != nil {
		return err
	}
	m.SetRecognitionTags(tags)

	return nil
}
