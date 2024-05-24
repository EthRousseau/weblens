package dataStore

import (
	"errors"
	"sync"
	"time"

	"github.com/barasher/go-exiftool"
	"github.com/ethanrous/bimg"
	"github.com/ethrousseau/weblens/api/types"
	"github.com/go-redis/redis"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// type initStore struct {
// }

type coreStore struct {
}

type backupStore struct {
	req types.Requester
}

func NewStore(req types.Requester) types.Store {
	if thisServer == nil || thisServer.Role == types.Core || thisServer.Role == types.Initialization {
		return &coreStore{}
	} else {
		return &backupStore{
			req: req,
		}
	}
}

type srvInfo struct {
	Id   string `json:"id" bson:"_id"`
	Name string `json:"name" bson:"name"`

	// apiKey that remote server is using to connect to local, if local is core. Empty otherwise
	UsingKey types.WeblensApiKey `json:"-" bson:"usingKey"`

	// Core or Backup
	Role types.ServerRole `json:"role" bson:"serverRole"`

	// If this server info represents this local server
	IsThisServer bool `json:"-" bson:"isThisServer"`

	// Address of the remote server, only if the remote is a core.
	// Not set for any remotes/backups on core server, as it IS the core
	CoreAddress string `json:"coreAddress" bson:"coreAddress"`

	UserCount int `json:"userCount" bson:"-"`
}

type WeblensDB struct {
	mongo    *mongo.Database
	useRedis bool
	redis    *redis.Client
}

type weblensFile struct {
	// the main way to identify a file. A file id is generated via a hash of its relative filepath
	id types.FileId

	// The absolute path of the real file on disk
	absolutePath string

	// Base of the filepath, the actual name of the file.
	filename string

	// The user to whom the file belongs.
	owner types.User

	// size in bytes of the file on the disk
	size int64

	// is the real file on disk a directory or regular file
	isDir *bool

	// The most recent time that this file was changes on the real filesystem
	modifyDate time.Time

	// media        types.Media
	// This is the file id of the file in the .content folder that either holds
	// or points to the real bytes on disk content that this file should read from
	contentId types.ContentId

	// Pointer to the directory that this file belongs
	parent *weblensFile

	// If we already have added the file to the watcher
	// See fileWatch.go
	watching bool

	// If this file is a directory, these are the files that are housed by this directory.
	childLock *sync.Mutex
	children  []*weblensFile

	// array of tasks that currently claim are using this file.
	// TODO: allow single task-claiming of a file for file
	// operations required to be "atomic"
	taskUsing types.Task
	tasksLock *sync.Mutex

	// the shares that this file belongs to
	shares []types.Share

	// Mark file as read-only internally.
	// This should be checked before any write action is to be taken
	// this should not be changed during run-time, only set in FsInit.
	// If a directory is `readOnly`, all children are as well
	readOnly bool

	// this file represents a file possibly not on the filesystem
	// anymore, but was at some point in the past
	pastFile bool

	// If the file is a past file, and existed at the real id above, this
	// current fileId is the location of the content right now, not in the past.
	currentId types.FileId

	// this file is currently existing outside of the file tree, most likely
	// in the /tmp directory
	detached bool
}

// Way of storing paths to have the prefix translated to an absolute
// path if needed, per the config of the specific system.
// When sending as a string (as JSON, etc.) format will be
// PREFIX:POSTFIX - where postfix does not have a leading slash.
// The prefix should have a trailing slash (as the prefix will always
// be a directory) when translated back to an absolute path.
// e.g. MEDIA:gary/photos/italy2018 -> /data/media/gary/italy2018
type portablePath struct {
	prefix  string // i.e. MEDIA or EXTERNAL
	postfix string // i.e. gary/photos/italy2018
}

type media struct {
	MediaId          primitive.ObjectID `json:"-" bson:"_id"`
	ContentId        types.ContentId    `json:"mediaId" bson:"mediaId"`
	FileIds          []types.FileId     `json:"fileIds" bson:"fileIds"`
	FullresCacheIds  []types.FileId     `json:"fullresCacheIds" bson:"fullresCacheIds"`
	ThumbnailCacheId types.FileId       `json:"thumbnailCacheId" bson:"thumbnailCacheId"`
	CreateDate       time.Time          `json:"createDate" bson:"createDate"`
	Owner            *user              `json:"owner" bson:"owner"`
	MediaWidth       int                `json:"mediaWidth" bson:"mediaWidth"`
	MediaHeight      int                `json:"mediaHeight" bson:"mediaHeight"`
	PageCount        int                `json:"pageCount" bson:"pageCount"`
	BlurHash         string             `json:"blurHash" bson:"blurHash"`
	MimeType         string             `json:"mimeType" bson:"mimeType"`
	RecognitionTags  []string           `json:"recognitionTags" bson:"recognitionTags"`
	Hidden           bool               `json:"hidden" bson:"hidden"`
	Enabled          bool               `json:"enabled" bson:"enabled"`

	mediaType *mediaType
	imported  bool

	rotate string
	image  *bimg.Image
	images []*bimg.Image

	rawExif           map[string]any
	thumbCacheFile    types.WeblensFile
	fullresCacheFiles []types.WeblensFile
}

type mediaType struct {
	mimeType         string
	friendlyName     string
	fileExtension    []string
	isDisplayable    bool
	isRaw            bool
	isVideo          bool
	supportsImgRecog bool
	multiPage        bool
	rawThumbExifKey  string
}

type marshalableMediaType struct {
	MimeType         string
	FriendlyName     string
	FileExtension    []string
	IsDisplayable    bool
	IsRaw            bool
	IsVideo          bool
	SupportsImgRecog bool
	MultiPage        bool
	RawThumbExifKey  string
}

const (
	Thumbnail types.Quality = "thumbnail"
	Fullres   types.Quality = "fullres"
)

var gexift *exiftool.Exiftool

func SetExiftool(et *exiftool.Exiftool) {
	gexift = et
}

// type folderData struct {
// 	FolderId       types.FileId     `bson:"_id" json:"folderId"`
// 	ParentFolderId types.FileId     `bson:"parentFolderId" json:"parentFolderId"`
// 	RelPath        string           `bson:"relPath" json:"relPath"`
// 	SharedWith     []types.Username `bson:"sharedWith" json:"sharedWith"`
// 	Shares         []fileShareData  `bson:"shares"`
// }

const (
	FileShare  types.ShareType = "file"
	AlbumShare types.ShareType = "album"
)

type fileShareData struct {
	ShareId   types.ShareId    `bson:"_id" json:"shareId"`
	FileId    types.FileId     `bson:"fileId" json:"fileId"`
	ShareName string           `bson:"shareName"`
	Owner     types.Username   `bson:"owner"`
	Accessors []types.Username `bson:"accessors"`
	Public    bool             `bson:"public"`
	Wormhole  bool             `bson:"wormhole"`
	Enabled   bool             `bson:"enabled"`
	Expires   time.Time        `bson:"expires"`
	ShareType types.ShareType  `bson:"shareType"`
}

type accessMeta struct {
	shares      []types.Share
	user        types.User
	usingShare  types.Share
	requestMode types.RequestMode
	accessAt    time.Time
}

const (
	FileGet types.RequestMode = "fileGet"

	// Grant access unconditionally. This is for sending
	// out updates where the user has already subscribed
	// elsewhere, and we just need to format the data for them
	WebsocketFileUpdate types.RequestMode = "wsFileUpdate"
	MarshalFile         types.RequestMode = "marshalFile"

	FileSubscribeRequest types.RequestMode = "fileSub"

	ApiKeyCreate types.RequestMode = "apiKeyCreate"
	ApiKeyGet    types.RequestMode = "apiKeyGet"

	BackupFileScan types.RequestMode = "backupFileScan"
)

type trashEntry struct {
	OrigParent   types.FileId `bson:"originalParentId"`
	OrigFilename string       `bson:"originalFilename"`
	TrashFileId  types.FileId `bson:"trashFileId"`
}

type AlbumData struct {
	Id             types.AlbumId     `bson:"_id"`
	Name           string            `bson:"name"`
	Owner          types.Username    `bson:"owner"`
	Cover          types.ContentId   `bson:"cover"`
	PrimaryColor   string            `bson:"primaryColor"`
	SecondaryColor string            `bson:"secondaryColor"`
	Medias         []types.ContentId `bson:"medias"`
	SharedWith     []types.Username  `bson:"sharedWith"`
	ShowOnTimeline bool              `bson:"showOnTimeline"`
}

type ApiKeyInfo struct {
	Id          primitive.ObjectID  `bson:"_id"`
	Key         types.WeblensApiKey `bson:"key"`
	Owner       types.Username      `bson:"owner"`
	CreatedTime time.Time           `bson:"createdTime"`
	RemoteUsing string              `bson:"remoteUsing"`
}

var tasker types.TaskPool
var globalCaster types.BroadcasterAgent
var voidCaster types.BroadcasterAgent

func SetTasker(d types.TaskPool) {
	tasker = d
}

func SetCaster(b types.BroadcasterAgent) {
	globalCaster = b
}

func SetVoidCaster(b types.BroadcasterAgent) {
	voidCaster = b
}

type JournalResp struct {
	Journal []*fileJournalEntry `json:"journal"`
}

// Errors
type WeblensUserError types.WeblensError
type WeblensFileError types.WeblensError
type AlreadyExistsError WeblensFileError

var ErrNotUsingRedis = errors.New("not using redis")

var ErrDirNotAllowed WeblensFileError = errors.New("attempted to perform action using a directory, where the action does not support directories")
var ErrDirectoryRequired WeblensFileError = errors.New("attempted to perform an action that requires a directory, but found regular file")
var ErrDirAlreadyExists AlreadyExistsError = errors.New("directory already exists in destination location")

var ErrFileAlreadyExists AlreadyExistsError = errors.New("file already exists in destination location")
var ErrNoFile WeblensFileError = errors.New("file does not exist")
var ErrNoCache WeblensFileError = errors.New("media references cache file that does not exist")
var ErrIllegalFileMove WeblensFileError = errors.New("tried to perform illegal file move")
var ErrWriteOnReadOnly WeblensFileError = errors.New("tried to write to read-only file")

var ErrReadOff WeblensFileError = errors.New("did not read expected number of bytes from file")

var ErrNoUser WeblensUserError = errors.New("user does not exist")
var ErrUserAlreadyExists WeblensUserError = errors.New("cannot create two users with the same username")
var ErrUserNotAuthorized WeblensUserError = errors.New("user does not have access the requested resource")
var ErrUserNotAuthenticated WeblensUserError = errors.New("user credentials are invalid")
var ErrNoFileAccess WeblensUserError = errors.New("user does not have access to file")
var ErrBadPassword WeblensUserError = errors.New("password provided does not authenticate user")

var ErrBadRequestMode = errors.New("access struct does not have correct request mode set for the given function")

var ErrNoMedia = errors.New("no media found")
var ErrNoImage = errors.New("media is missing required image")

var ErrNoShare = errors.New("no share found")
var ErrBadShareType = errors.New("expected share type does not match given share type")

var ErrUnsupportedImgType error = errors.New("image type is not supported by weblens")
var ErrPageOutOfRange = errors.New("page number does not exist on media")

var ErrNoKey = errors.New("api key is does not exist")
var ErrKeyInUse = errors.New("api key is already being used to identify another remote server")

var ErrAlreadyCore = errors.New("core server cannot have a remote core")
var ErrNotCore = errors.New("tried to perform core only action on non-core server")
var ErrNotBackup = errors.New("tried to perform backup only action on non-backup server")
var ErrAlreadyInit = errors.New("server is already initialized, cannot re-initialize server")

var ErrNoBackup = errors.New("no prior backups exist")
var ErrBadJournalAction = errors.New("unknown journal action type")

var ErrAlreadyWatching = errors.New("trying to watch directory that is already being watched")

var ErrBadTask = errors.New("did not get expected task id while trying to unlock file")
