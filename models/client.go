package models

import (
	"iter"
	"slices"
	"sync"
	"sync/atomic"

	"github.com/ethrousseau/weblens/fileTree"
	"github.com/ethrousseau/weblens/internal"
	"github.com/ethrousseau/weblens/internal/log"
	"github.com/ethrousseau/weblens/internal/werror"
	"github.com/ethrousseau/weblens/task"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type ClientId string

var _ Client = (*WsClient)(nil)

type WsClient struct {
	Active atomic.Bool
	connId        ClientId
	conn          *websocket.Conn
	updateMu sync.Mutex
	subsMu   sync.Mutex
	subscriptions []Subscription
	user   *User
	remote *Instance
}

func NewClient(conn *websocket.Conn, socketUser SocketUser) *WsClient {
	newClient := &WsClient{
		connId:   ClientId(uuid.New().String()),
		conn:     conn,
		updateMu: sync.Mutex{},
		subsMu:   sync.Mutex{},
	}
	newClient.Active.Store(true)

	if socketUser.SocketType() == "webClient" {
		newClient.user = socketUser.(*User)
	} else if socketUser.SocketType() == "serverClient" {
		newClient.remote = socketUser.(*Instance)
	}

	return newClient
}

func (wsc *WsClient) IsOpen() bool {
	return wsc.Active.Load()
}

func (wsc *WsClient) GetClientId() ClientId {
	return wsc.connId
}

func (wsc *WsClient) ClientType() ClientType {
	return WebClient
}

func (wsc *WsClient) GetShortId() ClientId {
	if wsc.connId == "" {
		return ""
	}
	return wsc.connId[28:]
}

func (wsc *WsClient) GetUser() *User {
	return wsc.user
}

func (wsc *WsClient) GetRemote() *Instance {
	return wsc.remote
}

func (wsc *WsClient) ReadOne() (int, []byte, error) {
	return wsc.conn.ReadMessage()
}

func (wsc *WsClient) Error(err error) {
	safe, _ := werror.TrySafeErr(err)
	err = wsc.Send(WsResponseInfo{EventTag: "error", Error: safe.Error()})
	if err != nil {
		log.ErrTrace(err)
	}
}

func (wsc *WsClient) PushWeblensEvent(eventTag string) {
	msg := WsResponseInfo{
		EventTag:      eventTag,
		SubscribeKey:  SubId("WEBLENS"),
		BroadcastType: ServerEvent,
	}

	log.ErrTrace(wsc.Send(msg))
}

func (wsc *WsClient) PushFileUpdate(updatedFile *fileTree.WeblensFileImpl, media *Media) {
	msg := WsResponseInfo{
		EventTag:      "file_updated",
		SubscribeKey:  SubId(updatedFile.ID()),
		Content: WsC{"fileInfo": updatedFile, "mediaData": media},
		BroadcastType: FolderSubscribe,
	}

	log.ErrTrace(wsc.Send(msg))
}

func (wsc *WsClient) PushTaskUpdate(task *task.Task, event string, result task.TaskResult) {
	msg := WsResponseInfo{
		EventTag: event,
		SubscribeKey:  SubId(task.TaskId()),
		Content:       WsC(result),
		TaskType:      task.JobName(),
		BroadcastType: TaskSubscribe,
	}

	log.ErrTrace(wsc.Send(msg))
}

func (wsc *WsClient) PushPoolUpdate(pool task.Pool, event string, result task.TaskResult) {
	if pool.IsGlobal() {
		log.Warning.Println("Not pushing update on global pool")
		return
	}

	msg := WsResponseInfo{
		EventTag: event,
		SubscribeKey:  SubId(pool.ID()),
		Content:       WsC(result),
		TaskType:      pool.CreatedInTask().JobName(),
		BroadcastType: TaskSubscribe,
	}

	log.ErrTrace(wsc.Send(msg))
}

func (wsc *WsClient) GetSubscriptions() iter.Seq[Subscription] {
	wsc.updateMu.Lock()
	defer wsc.updateMu.Unlock()
	return slices.Values(wsc.subscriptions)
}

func (wsc *WsClient) AddSubscription(sub Subscription) {
	wsc.updateMu.Lock()
	defer wsc.updateMu.Unlock()
	wsc.subscriptions = append(wsc.subscriptions, sub)
}

func (wsc *WsClient) Raw(msg any) error {
	return wsc.conn.WriteJSON(msg)
}

func (wsc *WsClient) SubLock() {
	wsc.subsMu.Lock()
}

func (wsc *WsClient) SubUnlock() {
	wsc.subsMu.Unlock()
}

func (wsc *WsClient) Send(msg WsResponseInfo) error {
	if wsc != nil && wsc.Active.Load() {
		wsc.updateMu.Lock()
		defer wsc.updateMu.Unlock()
		err := wsc.conn.WriteJSON(msg)
		if err != nil {
			log.ErrTrace(err)
		}
	} else {
		return werror.Errorf("trying to send to closed client")
	}

	return nil
}

func (wsc *WsClient) unsubscribe(key SubId) {
	wsc.updateMu.Lock()
	subIndex := slices.IndexFunc(wsc.subscriptions, func(s Subscription) bool { return s.Key == key })
	if subIndex == -1 {
		wsc.updateMu.Unlock()
		return
	}
	var subToRemove Subscription
	wsc.subscriptions, subToRemove = internal.Yoink(wsc.subscriptions, subIndex)
	wsc.updateMu.Unlock()

	log.Debug.Printf("[%s] unsubscribing from %s", wsc.user.GetUsername(), subToRemove)
}

func (wsc *WsClient) Disconnect() {
	wsc.Active.Store(false)

	wsc.updateMu.Lock()
	err := wsc.conn.Close()
	if err != nil {
		log.ShowErr(err)
		return
	}
	wsc.updateMu.Unlock()
	log.Debug.Printf("Disconnected [%s]", wsc.user.GetUsername())
}

type Client interface {
	BasicCaster

	IsOpen() bool

	ReadOne() (int, []byte, error)

	GetSubscriptions() iter.Seq[Subscription]
	GetClientId() ClientId
	GetShortId() ClientId

	SubLock()
	SubUnlock()

	AddSubscription(sub Subscription)

	GetUser() *User
	GetRemote() *Instance

	Error(error)
}

type SocketUser interface {
	SocketType() string
}
