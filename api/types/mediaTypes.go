package types

import (
	"time"

	"github.com/barasher/go-exiftool"
)

type MediaRepo interface {
	BaseService[ContentId, Media]

	TypeService() MediaTypeService
	FetchCacheImg(m Media, q Quality, pageNum int, tree FileTree) ([]byte, error)
	GetFilteredMedia(requester User, sort string, sortDirection int, albumFilter []AlbumId, raw bool) ([]Media, error)
	RunExif(path string) ([]exiftool.FileMetadata, error)
}

type Media interface {
	ID() ContentId
	IsImported() bool
	IsCached(FileTree) bool
	IsFilledOut() (bool, string)
	IsHidden() bool
	IsEnabled() bool
	GetOwner() User

	SetOwner(User)
	SetImported(bool)
	SetEnabled(bool)
	SetContentId(id ContentId)

	GetMediaType() MediaType
	GetCreateDate() time.Time
	SetCreateDate(time.Time) error

	Hide() error

	Clean()
	AddFile(WeblensFile) error
	RemoveFile(file WeblensFile) error
	GetFiles() []FileId

	LoadFromFile(WeblensFile, []byte, Task) (Media, error)

	ReadDisplayable(Quality, FileTree, ...int) ([]byte, error)
	GetPageCount() int

	GetCacheFile(q Quality, generateIfMissing bool, pageNum int, ft FileTree) (WeblensFile, error)
	// SetPageCount(int)
}

type ContentId string
type Quality string

type MediaType interface {
	IsRaw() bool
	IsDisplayable() bool
	FriendlyName() string
	GetMime() string
	IsMime(string) bool
	IsMultiPage() bool
	GetThumbExifKey() string
	SupportsImgRecog() bool
}

type MediaTypeService interface {
	ParseExtension(ext string) MediaType
	ParseMime(mime string) MediaType
	Generic() MediaType
	Size() int
}

// Error

var ErrNoMedia = NewWeblensError("no media found")
var ErrNoExiftool = NewWeblensError("exiftool not initialized")
