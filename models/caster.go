package models

import (
	"sync/atomic"
	"time"

	"github.com/ethanrous/weblens/fileTree"
	"github.com/ethanrous/weblens/internal/log"
	"github.com/ethanrous/weblens/internal/werror"
	"github.com/ethanrous/weblens/task"
)

var _ Broadcaster = (*SimpleCaster)(nil)

// var _ Broadcaster = (*BufferedCaster)(nil)

type SimpleCaster struct {
	enabled atomic.Bool
	cm      ClientManager
	msgChan chan WsResponseInfo
}

func (c *SimpleCaster) DisableAutoFlush() {
	// no-op
}

func (c *SimpleCaster) AutoFlushEnable() {
	// no-op
}

func (c *SimpleCaster) Flush() {
	// no-op
}

func (c *SimpleCaster) Close() {
	if !c.enabled.Load() {
		panic(werror.Errorf("Caster double close"))
	}
	c.enabled.Store(false)
	c.msgChan <- WsResponseInfo{}
}

func NewSimpleCaster(cm ClientManager) *SimpleCaster {
	newCaster := &SimpleCaster{
		cm:      cm,
		msgChan: make(chan WsResponseInfo, 100),
	}

	newCaster.enabled.Store(true)

	go newCaster.msgWorker(cm)

	return newCaster
}

func (c *SimpleCaster) Enable() {
	c.enabled.Store(true)
}

func (c *SimpleCaster) Disable() {
	c.enabled.Store(false)
}

func (c *SimpleCaster) IsBuffered() bool {
	return false
}

func (c *SimpleCaster) IsEnabled() bool {
	return c.enabled.Load()
}

func (c *SimpleCaster) msgWorker(cm ClientManager) {
	for msg := range c.msgChan {
		if !c.enabled.Load() && msg.EventTag == "" {
			break
		}

		cm.Send(msg)
	}

	log.Trace.Println("Caster message worker exiting")

	close(c.msgChan)
}

func (c *SimpleCaster) PushWeblensEvent(eventTag string, content ...WsC) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      eventTag,
		SubscribeKey:  "WEBLENS",
		BroadcastType: ServerEvent,
		SentTime:      time.Now().Unix(),
	}

	if len(content) != 0 {
		msg.Content = content[0]
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) PushTaskUpdate(task *task.Task, event string, result task.TaskResult) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      event,
		SubscribeKey:  task.TaskId(),
		Content:       WsC(result),
		TaskType:      task.JobName(),
		BroadcastType: TaskSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) PushPoolUpdate(
	pool task.Pool, event string, result task.TaskResult,
) {
	if !c.enabled.Load() {
		return
	}

	if pool.IsGlobal() {
		log.Warning.Println("Not pushing update on global pool")
		return
	}

	parentTask := pool.CreatedInTask()

	msg := WsResponseInfo{
		EventTag:      event,
		SubscribeKey:  parentTask.TaskId(),
		Content:       WsC(result),
		TaskType:      parentTask.JobName(),
		BroadcastType: TaskSubscribe,
		SentTime:      time.Now().Unix(),
	}

	// c.c.cm.Send(string(event), types.SubId(taskId), []types.WsC{types.WsC(result)})
	c.msgChan <- msg
}

func (c *SimpleCaster) PushShareUpdate(username Username, newShareInfo Share) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      "share_updated",
		SubscribeKey:  username,
		Content:       WsC{"newShareInfo": newShareInfo},
		BroadcastType: UserSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) PushFileCreate(newFile *fileTree.WeblensFileImpl) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:     FileCreatedEvent,
		SubscribeKey: newFile.GetParentId(),
		Content:      WsC{"fileInfo": newFile},

		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) PushFileUpdate(updatedFile *fileTree.WeblensFileImpl, media *Media) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      FileUpdatedEvent,
		SubscribeKey:  updatedFile.ID(),
		Content:       WsC{"fileInfo": updatedFile, "mediaData": media},
		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg

	if updatedFile.GetParent() == nil || updatedFile.GetParent().ID() == "ROOT" {
		return
	}

	msg = WsResponseInfo{
		EventTag:      FileUpdatedEvent,
		SubscribeKey:  updatedFile.GetParentId(),
		Content:       WsC{"fileInfo": updatedFile, "mediaData": media},
		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) PushFileMove(preMoveFile *fileTree.WeblensFileImpl, postMoveFile *fileTree.WeblensFileImpl) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      FileMovedEvent,
		SubscribeKey:  preMoveFile.GetParentId(),
		Content:       WsC{"fileInfo": postMoveFile},
		Error:         "",
		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}
	c.msgChan <- msg

	msg = WsResponseInfo{
		EventTag:      FileMovedEvent,
		SubscribeKey:  postMoveFile.GetParentId(),
		Content:       WsC{"fileInfo": postMoveFile},
		Error:         "",
		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}
	c.msgChan <- msg
}

func (c *SimpleCaster) PushFileDelete(deletedFile *fileTree.WeblensFileImpl) {
	if !c.enabled.Load() {
		return
	}

	msg := WsResponseInfo{
		EventTag:      FileDeletedEvent,
		SubscribeKey:  deletedFile.GetParent().ID(),
		Content:       WsC{"fileId": deletedFile.ID()},
		BroadcastType: FolderSubscribe,
		SentTime:      time.Now().Unix(),
	}

	c.msgChan <- msg
}

func (c *SimpleCaster) FolderSubToTask(folder fileTree.FileId, taskId task.Id) {
	if !c.enabled.Load() {
		return
	}

	subs := c.cm.GetSubscribers(FolderSubscribe, folder)

	for _, s := range subs {
		_, _, err := c.cm.Subscribe(s, taskId, TaskSubscribe, time.Now(), nil)
		if err != nil {
			log.ShowErr(err)
		}
	}
}

func (c *SimpleCaster) Relay(msg WsResponseInfo) {
	if !c.enabled.Load() {
		return
	}

	c.msgChan <- msg
}

type BasicCaster interface {
	PushWeblensEvent(eventTag string, content ...WsC)

	PushFileUpdate(updatedFile *fileTree.WeblensFileImpl, media *Media)
	PushTaskUpdate(task *task.Task, event string, result task.TaskResult)
	PushPoolUpdate(pool task.Pool, event string, result task.TaskResult)
}

type Broadcaster interface {
	BasicCaster
	PushFileCreate(newFile *fileTree.WeblensFileImpl)
	PushFileMove(preMoveFile *fileTree.WeblensFileImpl, postMoveFile *fileTree.WeblensFileImpl)
	PushFileDelete(deletedFile *fileTree.WeblensFileImpl)
	PushShareUpdate(username Username, newShareInfo Share)
	Enable()
	Disable()
	IsEnabled() bool
	IsBuffered() bool

	FolderSubToTask(folder fileTree.FileId, taskId task.Id)
	// UnsubTask(task *task.Task)
	DisableAutoFlush()
	AutoFlushEnable()
	Flush()

	Relay(msg WsResponseInfo)

	// Close flush, release the auto-flusher, and disable the caster
	Close()
}

// WsC is the generic WebSocket Content container
type WsC map[string]any
type SubId = string
type WsAction string
type ClientType string

const (
	// UserSubscribe does not actually get "subscribed" to, it is automatically tracked for every websocket
	// connection made, and only sends updates to that specific user when needed
	UserSubscribe WsAction = "user_subscribe"

	FolderSubscribe WsAction = "folder_subscribe"
	ServerEvent     WsAction = "server_event"
	TaskSubscribe   WsAction = "task_subscribe"
	// PoolSubscribe     WsAction = "pool_subscribe"
	TaskTypeSubscribe WsAction = "task_type_subscribe"
	Unsubscribe       WsAction = "unsubscribe"
	ScanDirectory     WsAction = "scan_directory"
	CancelTask        WsAction = "cancel_task"
	ReportError       WsAction = "show_web_error"
)

const (
	WebClient    ClientType = "webClient"
	RemoteClient ClientType = "remoteClient"
)

type Subscription struct {
	Type WsAction
	Key  SubId
	When time.Time
}

type WsResponseInfo struct {
	EventTag      string     `json:"eventTag"`
	SubscribeKey  SubId      `json:"subscribeKey"`
	TaskType      string     `json:"taskType,omitempty"`
	Content       WsC        `json:"content"`
	Error         string     `json:"error,omitempty"`
	BroadcastType WsAction   `json:"broadcastType,omitempty"`
	RelaySource   InstanceId `json:"relaySource,omitempty"`
	SentTime      int64      `json:"sentTime,omitempty"`
}

type WsRequestInfo struct {
	Action  WsAction `json:"action"`
	SentAt  int64    `json:"sentAt"`
	Content string   `json:"content"`
}

// WsR WebSocket Request interface
type WsR interface {
	GetKey() SubId
	Action() WsAction
}

const (
	StartupProgressEvent         = "startup_progress"
	TaskCreatedEvent             = "task_created"
	TaskCompleteEvent            = "task_complete"
	BackupCompleteEvent          = "backup_complete"
	TaskFailedEvent              = "task_failure"
	TaskCanceledEvent            = "task_canceled"
	PoolCreatedEvent             = "pool_created"
	PoolCompleteEvent            = "pool_complete"
	PoolCancelledEvent           = "pool_cancelled"
	FolderScanCompleteEvent      = "folder_scan_complete"
	FileScanCompleteEvent        = "file_scan_complete"
	ScanDirectoryProgressEvent   = "scan_directory_progress"
	FileCreatedEvent             = "file_created"
	FileUpdatedEvent             = "file_updated"
	FileMovedEvent               = "file_moved"
	FileDeletedEvent             = "file_deleted"
	ZipProgressEvent             = "create_zip_progress"
	ZipCompleteEvent             = "zip_complete"
	ServerGoingDownEvent         = "going_down"
	RestoreStartedEvent          = "restore_started"
	WeblensLoadedEvent           = "weblens_loaded"
	ErrorEvent                   = "error"
	RemoteConnectionChangedEvent = "remote_connection_changed"
	BackupProgressEvent          = "backup_progress"
	CopyFileCompleteEvent        = "copy_file_complete"
)
