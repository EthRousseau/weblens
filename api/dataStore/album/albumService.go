package album

import (
	"github.com/ethrousseau/weblens/api/types"
)

type albumService struct {
	repo map[types.AlbumId]types.Album
	db   types.AlbumsDB
}

func NewService() types.AlbumService {
	return &albumService{
		repo: make(map[types.AlbumId]types.Album),
	}
}

func (as *albumService) Init(db types.DatabaseService) error {
	as.db = db
	albs, err := db.GetAllAlbums()
	if err != nil {
		return err
	}

	for _, a := range albs {
		as.repo[a.ID()] = a
	}

	return nil
}

func (as *albumService) Size() int {
	return len(as.repo)
}

func (as *albumService) Get(aId types.AlbumId) types.Album {
	return as.repo[aId]
}

func (as *albumService) Add(a types.Album) error {
	as.repo[a.ID()] = a
	return nil
}

func (as *albumService) Del(aId types.AlbumId) error {
	if _, ok := as.repo[aId]; ok {
		delete(as.repo, aId)
		return nil
	} else {
		return ErrNoAlbum
	}
}

func (as *albumService) RemoveMediaFromAny(mediaId types.ContentId) error {
	albums, err := as.db.GetAlbumsByMedia(mediaId)
	if err != nil {
		return err
	}

	for _, album := range albums {
		a := as.repo[album.ID()]
		err = a.RemoveMedia(mediaId)
		if err != nil {
			return err
		}
	}

	return nil
}

// Error

var ErrNoAlbum = types.NewWeblensError("album not found")
