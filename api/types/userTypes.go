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
	GetToken() string
	GetHomeFolder() WeblensFile
	CreateHomeFolder(ft FileTree) (WeblensFile, error)
	GetTrashFolder() WeblensFile

	MarshalJSON() ([]byte, error)
	UnmarshalJSON(data []byte) error
}
