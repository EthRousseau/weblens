package dataStore

import (
	"errors"
	"sync"
	"time"

	"github.com/barasher/go-exiftool"
	"github.com/ethanrous/bimg"
	"github.com/go-redis/redis"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type Weblensdb struct {
	mongo    *mongo.Database
	useRedis bool
	redis    *redis.Client
}

type WeblensFile struct {
	id           string
	absolutePath string
	filename     string
	owner        string
	size         int64
	isDir        *bool
	media        *Media
	parent       *WeblensFile

	childLock *sync.Mutex
	children  map[string]*WeblensFile

	tasksLock  *sync.Mutex
	tasksUsing []Task

	shares []*fileShareData
}

type Media struct {
	MediaId          string               `bson:"fileHash" json:"fileHash"`
	FileIds          []string             `bson:"fileIds" json:"fileIds"`
	ThumbnailCacheId string               `bson:"thumbnailCacheId" json:"thumbnailCacheId"`
	FullresCacheIds  []string             `bson:"fullresCacheIds" json:"fullresCacheIds"`
	BlurHash         string               `bson:"blurHash" json:"blurHash"`
	Owner            string               `bson:"owner" json:"owner"`
	MediaWidth       int                  `bson:"width" json:"mediaWidth"`
	MediaHeight      int                  `bson:"height" json:"mediaHeight"`
	ThumbWidth       int                  `bson:"thumbWidth" json:"thumbWidth"`
	ThumbHeight      int                  `bson:"thumbHeight" json:"thumbHeight"`
	ThumbLength      int                  `bson:"thumbLength" json:"thumbLength"`
	FullresLength    int                  `bson:"fullresLength" json:"fullresLength"`
	CreateDate       time.Time            `bson:"createDate" json:"createDate"`
	MediaType        *mediaType           `bson:"mediaType" json:"mediaType"`
	SharedWith       []primitive.ObjectID `bson:"sharedWith" json:"sharedWith"`
	RecognitionTags  []string             `bson:"recognitionTags" json:"recognitionTags"`

	PageCount int `bson:"pageCount" json:"pageCount"` // for pdfs, etc.

	imported bool
	rotate   string
	imgBytes []byte
	image    *bimg.Image
	images   []*bimg.Image

	rawExif           map[string]any
	thumbCacheFile    *WeblensFile
	fullresCacheFiles []*WeblensFile
}

type Quality string

const (
	Thumbnail Quality = "thumbnail"
	Fullres   Quality = "fullres"
)

var gexift *exiftool.Exiftool

func SetExiftool(et *exiftool.Exiftool) {
	gexift = et
}

type marshalableWF struct {
	Id             string
	AbsolutePath   string
	Filename       string
	Owner          string
	ParentFolderId string
	Guests         []string
	Size           int64
	IsDir          bool
}

// Structure for safely sending file information to the client
type FileInfo struct {
	Id string `json:"id"`

	// If the media has been loaded into the database, only if it should be.
	// If media is not required to be imported, this will be set true
	Imported bool `json:"imported"`

	// If the content of the file can be displayed visually.
	// Say the file is a jpg, mov, arw, etc. and not a zip,
	// txt, doc, directory etc.
	Displayable bool `json:"displayable"`

	IsDir            bool             `json:"isDir"`
	Modifiable       bool             `json:"modifiable"`
	Size             int64            `json:"size"`
	ModTime          time.Time        `json:"modTime"`
	Filename         string           `json:"filename"`
	ParentFolderId   string           `json:"parentFolderId"`
	FileFriendlyName string           `json:"fileFriendlyName"`
	Owner            string           `json:"owner"`
	PathFromHome     string           `json:"pathFromHome"`
	MediaData        *Media           `json:"mediaData"`
	Shares           []*fileShareData `json:"shares"`
	Children         []string         `json:"children"`
}

type folderData struct {
	FolderId       string          `bson:"_id" json:"folderId"`
	ParentFolderId string          `bson:"parentFolderId" json:"parentFolderId"`
	RelPath        string          `bson:"relPath" json:"relPath"`
	SharedWith     []string        `bson:"sharedWith" json:"sharedWith"`
	Shares         []fileShareData `bson:"shares"`
}

type shareType string

const (
	FileShare  shareType = "file"
	AlbumShare shareType = "album"
)

type Share interface {
	GetShareId() string
	GetShareType() shareType
	GetContentId() string
	SetContentId(string)
	IsPublic() bool
	SetPublic(bool)
	IsEnabled() bool
	SetEnabled(bool)
	GetAccessors() []string
	AddAccessors([]string)
	GetOwner() string
}

type fileShareData struct {
	ShareId   string    `bson:"_id" json:"shareId"`
	FileId    string    `bson:"fileId" json:"fileId"`
	ShareName string    `bson:"shareName"`
	Owner     string    `bson:"owner"`
	Accessors []string  `bson:"accessors"`
	Public    bool      `bson:"public"`
	Wormhole  bool      `bson:"wormhole"`
	Enabled   bool      `bson:"enabled"`
	Expires   time.Time `bson:"expires"`
	ShareType shareType `bson:"shareType"`
}

type AlbumData struct {
	Id             string   `bson:"_id"`
	Name           string   `bson:"name"`
	Owner          string   `bson:"owner"`
	Cover          string   `bson:"cover"`
	PrimaryColor   string   `bson:"primaryColor"`
	SecondaryColor string   `bson:"secondaryColor"`
	Medias         []string `bson:"medias"`
	SharedWith     []string `bson:"sharedWith"`
	ShowOnTimeline bool     `bson:"showOnTimeline"`
}

type Task interface {
	TaskId() string
	TaskType() string
	Status() (bool, string)
	GetResult(string) string
	Wait()
	Cancel()
	SwLap(string)
	// SetCaster(BroadcasterAgent)

	ReadError() any
}

// Tasker interface for queueing tasks in the task pool
type TaskerAgent interface {

	// Parameters:
	//
	//	- `directory` : the weblens file descriptor representing the directory to scan
	//
	//	- `recursive` : if true, scan all children of directory recursively
	//
	//	- `deep` : query and sync with the real underlying filesystem for changes not reflected in the current fileTree
	ScanDirectory(directory *WeblensFile, recursive, deep bool, caster BroadcasterAgent) Task

	ScanFile(file *WeblensFile, m *Media, caster BroadcasterAgent) Task
}

type BroadcasterAgent interface {
	PushFileCreate(newFile *WeblensFile)
	PushFileUpdate(updatedFile *WeblensFile)
	PushFileMove(preMoveFile *WeblensFile, postMoveFile *WeblensFile)
	PushFileDelete(deletedFile *WeblensFile)
	PushTaskUpdate(taskId string, status string, result any)
}

var tasker TaskerAgent
var globalCaster BroadcasterAgent
var voidCaster BroadcasterAgent

func SetTasker(d TaskerAgent) {
	tasker = d
}

func SetCaster(b BroadcasterAgent) {
	globalCaster = b
}

func SetVoidCaster(b BroadcasterAgent) {
	voidCaster = b
}

// Errors
type alreadyExists error

var ErrNotUsingRedis = errors.New("not using redis")
var ErrDirNotAllowed = errors.New("directory not allowed")
var ErrFileAlreadyExists = errors.New("file already exists")
var ErrDirAlreadyExists = errors.New("directory already exists")
var ErrNoFile = errors.New("no file found")
var ErrNoMedia = errors.New("no media found")
var ErrNoShare = errors.New("no share found")
var ErrBadShareType = errors.New("expected share type does not match given share type")
var ErrUnsupportedImgType error = errors.New("image type is not supported by weblens")
var ErrPageOutOfRange = errors.New("page number does not exist on media")
