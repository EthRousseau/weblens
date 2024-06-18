package dataProcess

import (
	"errors"
	"fmt"
	"math"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethrousseau/weblens/api/types"
	"github.com/ethrousseau/weblens/api/util"
)

type taskPool struct {
	treatAsGlobal  bool
	hasQueueThread bool

	totalTasks     *atomic.Int64
	completedTasks *atomic.Int64
	waiterCount    *atomic.Int32
	waiterGate     *sync.Mutex
	exitLock       *sync.Mutex

	workerPool     *workerPool
	parentTaskPool *taskPool
	createdBy      types.Task

	allQueuedFlag bool

	erroredTasks []*task
}

// NewTaskPool `replace` spawns a temporary replacement thread on the parent worker pool.
// This prevents a deadlock when the queue fills up while adding many tasks, and none are being executed
//
// `parent` allows chaining of task pools for floating updates to the top. This makes
// it possible for clients to subscribe to a single task, and get notified about
// all of the sub-updates of that task
func (wp *workerPool) NewTaskPool(replace bool, createdBy types.Task) types.TaskPool {
	tp := wp.NewVirtualTaskPool().(*taskPool)
	if createdBy != nil {
		tp.createdBy = createdBy
		if !createdBy.GetTaskPool().IsGlobal() {
			tp.createdBy = createdBy
		}
	}
	if replace {
		wp.addReplacementWorker()
		tp.hasQueueThread = true
	}
	return tp
}

func (tp *taskPool) IsRoot() bool {
	if tp == nil {
		return false
	}
	return tp.parentTaskPool == nil || tp.parentTaskPool.IsGlobal()
}

func (tp *taskPool) GetWorkerPool() types.WorkerPool {
	return tp.workerPool
}

// NewTask passes params to create new task, and return the task to the caller.
// If the task already exists, the existing task will be returned, and a new one will not be created
func (tp *taskPool) NewTask(taskType types.TaskType, taskMeta taskMetadata, caster types.BroadcasterAgent,
	requester types.Requester) types.Task {

	var taskId types.TaskId
	if taskMeta == nil {
		taskId = types.TaskId(util.GlobbyHash(8, time.Now().String()))
	} else {
		taskId = types.TaskId(util.GlobbyHash(8, taskMeta.MetaString(), taskType))
	}

	existingTask := tp.GetWorkerPool().GetTask(taskId)
	if existingTask != nil {
		if taskType == "write_file" {
			existingTask.ClearAndRecompute()
		}
		return existingTask
	}

	newTask := &task{
		taskId:    taskId,
		taskType:  taskType,
		metadata:  taskMeta,
		waitMu:    &sync.Mutex{},
		timerLock: &sync.Mutex{},

		queueState: PreQueued,

		// signal chan must be buffered so caller doesn't block trying to close many tasks
		signalChan: make(chan int, 1),

		sw:        util.NewStopwatch("Task " + taskId.String()),
		caster:    caster,
		requester: requester,
	}

	// Lock the waiter gate immediately. The task cleanup routine will clear
	// this lock when the task exits, which will allow any thread waiting on
	// the task to return
	newTask.waitMu.Lock()

	switch newTask.taskType {
	case ScanDirectoryTask:
		newTask.work = scanDirectory
	case CreateZipTask:
		// don't remove task when finished since we can just return the name of the already made zip
		// file if asked for the same files again
		newTask.persistent = true
		newTask.work = createZipFromPaths
	case ScanFileTask:
		newTask.work = scanFile
	case MoveFileTask:
		newTask.work = moveFile
	case WriteFileTask:
		newTask.work = handleFileUploads
	case GatherFsStatsTask:
		newTask.work = gatherFilesystemStats
	case BackupTask:
		newTask.work = doBackup
	case HashFile:
		newTask.work = hashFile
	}

	tp.workerPool.addTask(newTask)

	return newTask
}

func (tp *taskPool) ScanDirectory(directory types.WeblensFile, caster types.BroadcasterAgent) types.Task {
	// Partial media means nothing for a directory scan, so it's always nil
	scanMeta := scanMetadata{file: directory}
	t := tp.NewTask(ScanDirectoryTask, scanMeta, caster, nil)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	if caster != nil {
		caster.PushTaskUpdate(t.TaskId(), TaskCreated, types.TaskResult{
			"taskType":      ScanDirectoryTask,
			"directoryName": directory.Filename(),
		})
	}

	return t
}

func (tp *taskPool) ScanFile(file types.WeblensFile, caster types.BroadcasterAgent) types.Task {
	scanMeta := scanMetadata{file: file}
	t := tp.NewTask(ScanFileTask, scanMeta, caster, nil)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	return t
}

func (tp *taskPool) WriteToFile(rootFolderId types.FileId, chunkSize, totalUploadSize int64, caster types.BroadcasterAgent) types.Task {
	numChunks := totalUploadSize / chunkSize
	numChunks = int64(math.Max(float64(numChunks), 10))
	writeMeta := writeFileMeta{rootFolderId: rootFolderId, chunkSize: chunkSize, totalSize: totalUploadSize, chunkStream: make(chan fileChunk, numChunks)}
	t := tp.NewTask(WriteFileTask, writeMeta, caster, nil)

	// We don't queue upload tasks right away, once the first chunk comes through,
	// we will add it to the buffer, and then load the task onto the queue.
	t.(*task).taskPool = tp

	return t
}

func (tp *taskPool) MoveFile(fileId, destinationFolderId types.FileId, newFilename string, caster types.BroadcasterAgent) types.Task {
	moveMeta := moveMeta{fileId: fileId, destinationFolderId: destinationFolderId, newFilename: newFilename}
	t := tp.NewTask(MoveFileTask, moveMeta, caster, nil)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	return t
}

func (tp *taskPool) CreateZip(files []types.WeblensFile, username types.Username, shareId types.ShareId,
	ft types.FileTree, casters types.BroadcasterAgent) types.Task {
	meta := zipMetadata{files: files, username: username, shareId: shareId, fileTree: ft}
	t := tp.NewTask(CreateZipTask, meta, casters, nil)
	if c, _ := t.Status(); !c {
		err := tp.QueueTask(t)
		if err != nil {
			util.ErrTrace(err)
			return nil
		}
	}

	return t
}

func (tp *taskPool) GatherFsStats(rootDir types.WeblensFile, caster types.BroadcasterAgent) types.Task {
	t := tp.NewTask(GatherFsStatsTask, fsStatMeta{rootDir: rootDir}, caster, nil)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	return t
}

func (tp *taskPool) Backup(remoteId types.InstanceId, requester types.Requester, tree types.FileTree) types.Task {
	t := tp.NewTask(BackupTask, backupMeta{remoteId: remoteId, tree: tree}, nil, requester)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	return t
}

func (tp *taskPool) HashFile(f types.WeblensFile, caster types.BroadcasterAgent) types.Task {
	t := tp.NewTask(HashFile, hashFileMeta{file: f}, caster, nil)
	err := tp.QueueTask(t)
	if err != nil {
		util.ErrTrace(err)
		return nil
	}

	return t
}

func (tp *taskPool) handleTaskExit(replacementThread bool) (canContinue bool) {

	tp.completedTasks.Add(1)

	// Global queues do not finish and cannot be waited on. If this is NOT a global queue,
	// we check if we are empty and finished, and if so wake any waiters.
	if !tp.treatAsGlobal {
		uncompletedTasks := tp.totalTasks.Load() - tp.completedTasks.Load()

		// Even if we are out of tasks, if we have not been told all tasks
		// were queued, we do not wake the waiters
		if uncompletedTasks == 0 && tp.waiterCount.Load() != 0 && tp.allQueuedFlag {
			util.Debug.Println("Waking sleepers!")
			tp.waiterGate.Unlock()

			// Check if all waiters have awoken before closing the queue, spin and sleep for 10ms if not
			// Should only loop a handful of times, if at all, we just need to wait for the waiters to
			// lock and then release immediately, should take nanoseconds each
			for tp.waiterCount.Load() != 0 {
				time.Sleep(time.Millisecond * 10)
			}
		}
	}
	// If this is a replacement task, and we have more workers than the target for the pool, we exit
	if replacementThread && tp.workerPool.currentWorkers.Load() > tp.workerPool.maxWorkers.Load() {
		// Important to decrement alive workers inside the exitLock, so
		// we don't have multiple workers exiting when we only need the 1
		tp.workerPool.currentWorkers.Add(-1)

		return false
	}

	// If we have already began running the task,
	// we must finish and clean up before checking exitFlag again here.
	// The task *could* be cancelled to speed things up, but that
	// is not our job.
	if tp.workerPool.exitFlag == 1 {
		// Dec alive workers
		tp.workerPool.currentWorkers.Add(-1)
		return false
	}

	return true
}

func (tp *taskPool) GetRootPool() types.TaskPool {
	// if tp == nil || tp.treatAsGlobal {
	// 	return nil
	// }

	if tp.IsRoot() {
		return tp
	}

	tmpTp := tp
	for !tmpTp.parentTaskPool.IsRoot() {
		tmpTp = tmpTp.parentTaskPool
	}
	return tmpTp
}

func (tp *taskPool) Status() (int, int, float64) {
	complete := tp.completedTasks.Load() + 1
	total := tp.totalTasks.Load()
	progress := (float64(complete * 100)) / float64(total)

	return int(complete), int(total), progress
}

func (tp *taskPool) ClearAllQueued() {
	if tp.waiterCount.Load() != 0 {
		util.Warning.Println("Clearing all queued flag on work queue that still has sleepers")
	}
	tp.allQueuedFlag = false
}

func (tp *taskPool) NotifyTaskComplete(t types.Task, c types.BroadcasterAgent, note ...any) {
	realT := t.(*task)
	rootPool := realT.taskPool.GetRootPool()
	var rootTask types.Task
	if rootPool != nil && rootPool.CreatedInTask() != nil {
		rootTask = rootPool.CreatedInTask()
	} else {
		rootTask = t.(*task)
	}

	var result types.TaskResult
	switch realT.taskType {
	case ScanDirectoryTask, ScanFileTask:
		result = getScanResult(realT)
	default:
		return
	}

	if len(note) != 0 {
		result["note"] = fmt.Sprint(note...)
	}

	c.PushTaskUpdate(rootTask.TaskId(), SubTaskComplete, result)

}

// Wait Parks the thread on the work queue until all the tasks have been queued and finish.
// **If you never call tp.SignalAllQueued(), the waiters will never wake up**
// Make sure that you SignalAllQueued before parking here if it is the only thread
// loading tasks
func (tp *taskPool) Wait(supplementWorker bool) {
	// Waiting on global queues does not make sense, they are not meant to end
	// or
	// All the tasks were queued, and they have all finished,
	// so no need to wait, we can "wake up" instantly.
	if tp.treatAsGlobal || (tp.allQueuedFlag && tp.totalTasks.Load()-tp.completedTasks.Load() == 0) {
		return
	}

	// If we want to park another thread that is currently executing a task,
	// e.g a directory scan waiting for the child file scans to complete,
	// we want to add a worker to the pool temporarily to supplement this one
	if supplementWorker {
		tp.workerPool.addReplacementWorker()
	}

	_, file, line, _ := runtime.Caller(1)
	util.Debug.Printf("Parking on worker pool from %s:%d\n", file, line)

	tp.workerPool.busyCount.Add(-1)
	tp.waiterCount.Add(1)
	tp.waiterGate.Lock()
	//lint:ignore SA2001 We want to wake up when the task is finished, and then signal other waiters to do the same
	tp.waiterGate.Unlock()
	tp.waiterCount.Add(-1)
	tp.workerPool.busyCount.Add(1)

	util.Debug.Printf("Woke up, returning to %s:%d\n", file, line)

	if supplementWorker {
		tp.workerPool.removeWorker()
	}
}

func (tp *taskPool) LockExit() {
	tp.exitLock.Lock()
}

func (tp *taskPool) UnlockExit() {
	tp.exitLock.Unlock()
}

func (tp *taskPool) AddError(t types.Task) {
	tp.erroredTasks = append(tp.erroredTasks, t.(*task))
}

func (tp *taskPool) Errors() []types.Task {
	return util.SliceConvert[types.Task](tp.erroredTasks)
}

func (tp *taskPool) Cancel() {
	// TODO - not impl
}

func (tp *taskPool) QueueTask(Task types.Task) (err error) {
	t := Task.(*task)
	if tp.workerPool.exitFlag == 1 {
		util.Warning.Println("Not queuing task while worker pool is going down")
		return
	}

	if t.err != nil {
		// Tasks that have failed will not be re-tried. If the errored task is removed from the
		// task map, then it will be re-tried because the previous error was lost. This can be
		// sometimes be useful, some tasks auto-remove themselves after they finish.
		util.Warning.Println("Not re-queueing task that has error set, please restart weblens to try again")
		return
	}

	if t.taskPool != nil && (t.taskPool != tp || t.queueState != PreQueued) {
		// Task is already queued, we are not allowed to move it to another queue.
		// We can call .ClearAndRecompute() on the task and it will queue it
		// again, but it cannot be transferred
		if t.taskPool != tp {
			util.Warning.Println("Attempted to re-queue task that is already in a queue")
		}
		return
	}

	if tp.allQueuedFlag {
		// We cannot add tasks to a queue that has been closed
		return errors.New("attempting to add task to closed task queue")
	}

	tp.totalTasks.Add(1)

	if tp.parentTaskPool != nil {
		tmpTp := tp
		for tmpTp.parentTaskPool != nil {
			tmpTp = tmpTp.parentTaskPool
		}
		tmpTp.totalTasks.Add(1)
	}

	// Set the tasks queue
	t.taskPool = tp

	tp.workerPool.lifetimeQueuedCount.Add(1)

	// Put the task in the queue
	t.queueState = InQueue
	tp.workerPool.taskStream <- t

	return
}

// Specify the work queue as being a "global" one
func (tp *taskPool) MarkGlobal() {
	tp.treatAsGlobal = true
}

func (tp *taskPool) IsGlobal() bool {
	return tp.treatAsGlobal
}

func (tp *taskPool) CreatedInTask() types.Task {
	return tp.createdBy
}

func (tp *taskPool) SignalAllQueued() {
	if tp.treatAsGlobal {
		util.Error.Println("Attempt to signal all queued for global queue")
	}

	tp.exitLock.Lock()
	// If all tasks finish (e.g. early failure, etc.) before we signal that they are all queued,
	// the final exiting task will not let the waiters out, so we must do it here
	if tp.completedTasks.Load() == tp.totalTasks.Load() {
		tp.waiterGate.Unlock()
	}
	tp.allQueuedFlag = true
	tp.exitLock.Unlock()

	if tp.hasQueueThread {
		tp.workerPool.removeWorker()
		tp.hasQueueThread = false
	}
}
