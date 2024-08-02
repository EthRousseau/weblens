package types

type Username string

func (u Username) String() string {
	return string(u)
}

type User interface {
	GetUsername() Username
	IsAdmin() bool
	IsActive() bool
	IsOwner() bool
	IsSystemUser() bool
	GetToken() string
	GetHomeFolder() WeblensFile
	SetHomeFolder(WeblensFile) error
	CreateHomeFolder() (WeblensFile, error)
	GetTrashFolder() WeblensFile
	SetTrashFolder(WeblensFile) error

	CheckLogin(password string) bool
	UpdatePassword(oldPass, newPass string) error
	Activate() error

	FormatArchive() (map[string]any, error)
	UnmarshalJSON(data []byte) error
}

type UserService interface {
	WeblensService[Username, User, UserStore]
	GetAll() ([]User, error)
	GetPublicUser() User
	SearchByUsername(searchString string) ([]User, error)
	SetUserAdmin(User, bool) error
}

var ErrUserNotAuthenticated = NewWeblensError("user credentials are invalid")
var ErrBadPassword = NewWeblensError("password provided does not authenticate user")
var ErrUserAlreadyExists = NewWeblensError("cannot create two users with the same username")
