package dataStore

import (
	"fmt"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/ethrousseau/weblens/api/types"
	"github.com/ethrousseau/weblens/api/util"
)

var apiKeyMap map[types.WeblensApiKey]*ApiKeyInfo = map[types.WeblensApiKey]*ApiKeyInfo{}
var keyMapMu = &sync.Mutex{}

func (a *accessMeta) Shares() []types.Share {
	return a.shares
}

func (a *accessMeta) User() types.User {
	return a.user
}

func NewAccessMeta(u types.User) types.AccessMeta {
	return &accessMeta{
		user: u,
	}
}

func (a *accessMeta) AddShare(s types.Share) error {
	if !CanAccessShare(s, a) {
		return ErrUserNotAuthorized
	}
	a.shares = append(a.shares, s)
	return nil
}

func (a *accessMeta) SetRequestMode(r types.RequestMode) types.AccessMeta {
	if a.requestMode != "" {
		util.Warning.Printf("Overriding request mode from %s to %s", a.requestMode, r)
	}
	a.requestMode = r

	return a
}

func (acc *accessMeta) SetTime(t time.Time) types.AccessMeta {
	acc.accessAt = t
	return acc
}

func (acc *accessMeta) GetTime() time.Time {
	return acc.accessAt
}

func (acc *accessMeta) RequestMode() types.RequestMode {
	return acc.requestMode
}

func (acc *accessMeta) AddShareId(sId types.ShareId, st types.ShareType) types.AccessMeta {
	if sId == "" {
		return acc
	}

	s, _ := GetShare(sId, st)
	if s == nil {
		return acc
	}
	acc.shares = append(acc.shares, s)

	return acc
}

func (acc *accessMeta) UsingShare() types.Share {
	return acc.usingShare
}

func (acc *accessMeta) SetUsingShare(s types.Share) {
	acc.usingShare = s
}

func GetRelevantShare(file types.WeblensFile, acc types.AccessMeta) types.Share {
	if len(acc.Shares()) == 0 {
		return nil
	}

	var ancestors []types.FileId
	err := file.BubbleMap(func(wf types.WeblensFile) error {
		ancestors = append(ancestors, wf.Id())
		return nil
	})

	if err != nil {
		util.ErrTrace(err)
	}

	var foundShare types.Share
	if len(ancestors) != 0 {
		for _, s := range acc.Shares() {
			s.GetAccessors()
			if slices.Contains(ancestors, types.FileId(s.GetContentId())) && (s.IsPublic() || slices.Contains(s.GetAccessors(), acc.User())) {
				foundShare = s
				break
			}
		}
	}

	if foundShare != nil {
		acc.(*accessMeta).SetUsingShare(foundShare)
	}
	return foundShare
}

func CanAccessFile(file types.WeblensFile, acc types.AccessMeta) bool {
	if file == nil {
		return false
	}

	switch acc.RequestMode() {
	case WebsocketFileUpdate, MarshalFile:
		return true
	}

	if file.Owner() == acc.User() {
		return true
	} else if file.Owner() == ExternalRootUser {
		return acc.User().IsAdmin()
	}

	shares := acc.Shares()
	if len(shares) == 0 {
		return false
	}

	using := acc.UsingShare()
	if using != nil {
		if types.FileId(using.GetContentId()) == file.Id() {
			return true
		}
	}
	return GetRelevantShare(file, acc) != nil
}

func CanAccessShare(s types.Share, acc types.AccessMeta) bool {
	if s == nil {
		err := fmt.Errorf("canAccessShare nil share")
		util.ErrTrace(err)
		return false
	}

	if !s.IsEnabled() {
		return false
	}

	if s.IsPublic() {
		return true
	}

	if s.GetOwner() == acc.User() {
		return true
	}

	if slices.Contains(s.GetAccessors(), acc.User()) {
		return true
	}

	return false
}

func InitApiKeyMap() {
	keys := fddb.getApiKeys()
	keyMapMu.Lock()
	defer keyMapMu.Unlock()
	for _, keyInfo := range keys {
		apiKeyMap[keyInfo.Key] = &keyInfo
	}
}

func GetApiKeyInfo(key types.WeblensApiKey) *ApiKeyInfo {
	keyMapMu.Lock()
	defer keyMapMu.Unlock()
	return apiKeyMap[key]
}

func GenerateApiKey(acc types.AccessMeta) (key *ApiKeyInfo, err error) {
	if !acc.User().IsAdmin() {
		err = ErrUserNotAuthorized
		return
	} else if acc.RequestMode() != ApiKeyCreate {
		err = ErrBadRequestMode
		return
	}

	createTime := time.Now()
	hash := types.WeblensApiKey(util.GlobbyHash(0, acc.User().GetUsername(), strconv.Itoa(int(createTime.Unix()))))

	newKey := &ApiKeyInfo{
		Key:         hash,
		Owner:       acc.User().GetUsername(),
		CreatedTime: createTime,
	}

	err = fddb.newApiKey(*newKey)
	if err != nil {
		return nil, err
	}
	keyMapMu.Lock()
	apiKeyMap[hash] = newKey
	keyMapMu.Unlock()

	return newKey, nil
}

func GetApiKeys(acc types.AccessMeta) ([]ApiKeyInfo, error) {
	if acc.RequestMode() != ApiKeyGet {
		return nil, ErrBadRequestMode
	}
	keys := fddb.getApiKeysByUser(acc.User().GetUsername())
	if keys == nil {
		keys = []ApiKeyInfo{}
	}
	return keys, nil
}

func CheckApiKey(key types.WeblensApiKey) bool {
	keyInfo := GetApiKeyInfo(key)
	return keyInfo != nil
}

func DeleteApiKey(key types.WeblensApiKey) {
	keyMapMu.Lock()
	delete(apiKeyMap, key)
	keyMapMu.Unlock()
	fddb.removeApiKey(key)
}

func SetKeyRemote(key types.WeblensApiKey, remoteId string) error {
	// kInfo := GetApiKeyInfo(key)
	// if kInfo == nil {
	// 	return ErrNoKey
	// }
	// kInfo.RemoteUsing = remoteId
	err := fddb.updateUsingKey(key, remoteId)

	return err
}
