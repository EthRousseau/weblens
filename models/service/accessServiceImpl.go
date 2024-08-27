package service

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/ethrousseau/weblens/fileTree"
	"github.com/ethrousseau/weblens/internal"
	"github.com/ethrousseau/weblens/internal/werror"
	"github.com/ethrousseau/weblens/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

var _ models.AccessService = (*AccessServiceImpl)(nil)

type AccessServiceImpl struct {
	keyMap   map[models.WeblensApiKey]models.ApiKeyInfo
	keyMapMu *sync.RWMutex

	fileService models.FileService
	collection  *mongo.Collection
}

func NewAccessService(fileService models.FileService, col *mongo.Collection) *AccessServiceImpl {
	return &AccessServiceImpl{
		keyMap:      map[models.WeblensApiKey]models.ApiKeyInfo{},
		keyMapMu:    &sync.RWMutex{},
		fileService: fileService,
		collection:  col,
	}
}

func (accSrv *AccessServiceImpl) CanUserAccessFile(
	user *models.User, file *fileTree.WeblensFile, share *models.FileShare,
) bool {
	if accSrv.fileService.GetFileOwner(file) == user {
		return true
	}
	
	if user.GetUsername() == "WEBLENS" {
		return true
	}

	if share == nil || !share.Enabled || !slices.Contains(share.Accessors, user.GetUsername()) {
		return false
	}

	tmpFile := file
	for tmpFile.ID() != "ROOT" {
		if tmpFile.ID() == share.FileId {
			return true
		}
		tmpFile = tmpFile.GetParent()
	}
	return false
}

func (accSrv *AccessServiceImpl) CanUserModifyShare(user *models.User, share models.Share) bool {
	return user.GetUsername() == share.GetOwner()
}

func (accSrv *AccessServiceImpl) CanUserAccessAlbum(
	user *models.User, album *models.Album,
	share *models.AlbumShare,
) bool {
	if album.Owner == user.GetUsername() {
		return true
	}

	if share == nil || !share.Enabled || !slices.Contains(share.Accessors, user.GetUsername()) {
		return false
	}

	return false
}

func (accSrv *AccessServiceImpl) Init() error {
	ret, err := accSrv.collection.Find(context.Background(), bson.M{})
	if err != nil {
		return err
	}

	var target []models.ApiKeyInfo
	err = ret.All(context.Background(), &target)
	if err != nil {
		return err
	}

	accSrv.keyMapMu.Lock()
	defer accSrv.keyMapMu.Unlock()

	for _, key := range target {
		accSrv.keyMap[key.Key] = key
	}

	return nil
}

func (accSrv *AccessServiceImpl) Get(key models.WeblensApiKey) (models.ApiKeyInfo, error) {
	accSrv.keyMapMu.RLock()
	defer accSrv.keyMapMu.RUnlock()
	if keyInfo, ok := accSrv.keyMap[key]; !ok {
		return models.ApiKeyInfo{}, errors.New("Could not find api key")
	} else {
		return keyInfo, nil
	}
}

func (accSrv *AccessServiceImpl) Del(key models.WeblensApiKey) error {
	accSrv.keyMapMu.RLock()
	_, ok := accSrv.keyMap[key]
	accSrv.keyMapMu.RUnlock()
	if !ok {
		return errors.New("could not find api key to delete")
	}

	_, err := accSrv.collection.DeleteOne(context.Background(), bson.M{"key": key})
	if err != nil {
		return err
	}

	accSrv.keyMapMu.Lock()
	defer accSrv.keyMapMu.Unlock()
	delete(accSrv.keyMap, key)

	return nil
}

func (accSrv *AccessServiceImpl) Size() int {
	accSrv.keyMapMu.RLock()
	defer accSrv.keyMapMu.RUnlock()
	return len(accSrv.keyMap)
}

func (accSrv *AccessServiceImpl) GenerateApiKey(creator *models.User) (models.ApiKeyInfo, error) {
	if !creator.IsAdmin() {
		return models.ApiKeyInfo{}, werror.ErrUserNotAuthorized
	}

	createTime := time.Now()
	hash := models.WeblensApiKey(internal.GlobbyHash(0, creator.GetUsername(), strconv.Itoa(int(createTime.Unix()))))

	newKey := models.ApiKeyInfo{
		Id:          primitive.NewObjectID(),
		Key:         hash,
		Owner:       creator.GetUsername(),
		CreatedTime: createTime,
	}

	_, err := accSrv.collection.InsertOne(context.Background(), newKey)
	if err != nil {
		return models.ApiKeyInfo{}, err
	}

	accSrv.keyMapMu.Lock()
	defer accSrv.keyMapMu.Unlock()
	accSrv.keyMap[newKey.Key] = newKey

	return newKey, nil
}

func (accSrv *AccessServiceImpl) SetKeyUsedBy(key models.WeblensApiKey, server *models.Instance) error {
	return werror.NotImplemented("accessService setKeyUsedBy")
	return werror.ErrKeyInUse
}

func (accSrv *AccessServiceImpl) GetAllKeys(accessor *models.User) ([]models.ApiKeyInfo, error) {
	if !accessor.IsAdmin() {
		return nil, errors.New("non-admin attempting to get api keys")
	}

	accSrv.keyMapMu.RLock()
	defer accSrv.keyMapMu.RUnlock()

	return slices.Collect(maps.Values(accSrv.keyMap)), nil
}
