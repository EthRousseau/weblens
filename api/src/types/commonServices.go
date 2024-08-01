package types

import (
	"context"
	"net/http"
	"sync"
	"time"
)

type weblensServicePackage struct {
	serviceLock *sync.Mutex

	InstanceService InstanceService
	UserService     UserService

	StoreService   StoreService
	FileTree       FileTree
	MediaRepo      MediaRepo
	Caster         BroadcasterAgent
	ClientManager  ClientManager
	WorkerPool     WorkerPool
	TaskDispatcher TaskPool
	Requester      Requester
	AlbumManager   AlbumService
	ShareService   ShareService
	AccessService  AccessService

	router     *http.Server
	RouterLock *sync.Mutex
}

var SERV *weblensServicePackage

func init() {
	SERV = &weblensServicePackage{
		serviceLock: &sync.Mutex{},
		RouterLock:  &sync.Mutex{},
	}
}

func (srv *weblensServicePackage) MinimallyReady() bool {
	srv.serviceLock.Lock()
	defer srv.serviceLock.Unlock()
	return srv.InstanceService != nil && srv.UserService != nil && srv.ClientManager != nil
}

func (srv *weblensServicePackage) SetInstance(instSrv InstanceService) {
	srv.serviceLock.Lock()
	defer srv.serviceLock.Unlock()
	if SERV.InstanceService == nil {
		SERV.InstanceService = instSrv
	}
}

func (srv *weblensServicePackage) SetRouter(router *http.Server) {
	SERV.router = router
}

func (srv *weblensServicePackage) RestartRouter() error {
	for SERV.router == nil {
		time.Sleep(200 * time.Millisecond)
	}

	SERV.RouterLock.Lock()
	SERV.RouterLock.Unlock()
	err := SERV.router.Shutdown(context.TODO())
	if err != nil {
		return WeblensErrorFromError(err)
	}

	return nil
}

func (srv *weblensServicePackage) SetStore(db StoreService) {
	SERV.StoreService = db
}

func (srv *weblensServicePackage) SetFileTree(ft FileTree) {
	if SERV.FileTree == nil {
		SERV.FileTree = ft
	}
}

func (srv *weblensServicePackage) SetMediaRepo(mediaRepo MediaRepo) {
	if SERV.MediaRepo == nil {
		SERV.MediaRepo = mediaRepo
	}
}

func (srv *weblensServicePackage) SetAccessService(accessService AccessService) {
	if SERV.AccessService == nil {
		SERV.AccessService = accessService
	}
}

func (srv *weblensServicePackage) SetClientService(clientService ClientManager) {
	srv.serviceLock.Lock()
	defer srv.serviceLock.Unlock()
	if srv.ClientManager == nil {
		srv.ClientManager = clientService
	}
}

func (srv *weblensServicePackage) GetClientServiceSafely() ClientManager {
	srv.serviceLock.Lock()
	defer srv.serviceLock.Unlock()
	if srv.ClientManager != nil {
		return srv.ClientManager
	}
	return nil
}

func (srv *weblensServicePackage) SetCaster(c BroadcasterAgent) {
	if SERV.Caster == nil {
		SERV.Caster = c
	}
}

func (srv *weblensServicePackage) SetUserService(us UserService) {
	srv.serviceLock.Lock()
	defer srv.serviceLock.Unlock()
	if SERV.UserService == nil {
		SERV.UserService = us
	}
}

func (srv *weblensServicePackage) SetAlbumService(albumService AlbumService) {
	if SERV.AlbumManager == nil {
		SERV.AlbumManager = albumService
	}
}

func (srv *weblensServicePackage) SetShareService(share ShareService) {
	if SERV.ShareService == nil {
		SERV.ShareService = share
	}
}

func (srv *weblensServicePackage) SetTaskDispatcher(tasker TaskPool) {
	if SERV.TaskDispatcher == nil {
		SERV.TaskDispatcher = tasker
	}
}

func (srv *weblensServicePackage) SetRequester(rq Requester) {
	if SERV.Requester == nil {
		SERV.Requester = rq
	}
}

func (srv *weblensServicePackage) SetWorkerPool(wp WorkerPool) {
	if SERV.WorkerPool == nil {
		SERV.WorkerPool = wp
	}
}
