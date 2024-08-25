package backup

import (
	"errors"
	"time"

	"github.com/ethrousseau/weblens/internal/log"
	"github.com/ethrousseau/weblens/models"
	"github.com/ethrousseau/weblens/task"
)

func BackupD(interval time.Duration, instanceService models.InstanceService, taskService task.TaskService) {
	if instanceService.GetLocal().ServerRole() != models.BackupServer {
		log.Error.Println("Backup service cannot be run on non-backup instance")
		return
	}
	for {
		for _, remote := range instanceService.GetRemotes() {
			if remote.IsLocal() {
				continue
			}
			meta := models.BackupMeta{
				RemoteId:        remote.ServerId(),
				InstanceService: instanceService,
			}
			_, err := taskService.DispatchJob(models.BackupTask, meta, nil)
			if err != nil {
				log.ErrTrace(err)
			}
		}
		time.Sleep(interval)
	}
}

func DoBackup(t *task.Task) {
	t.ErrorAndExit(errors.New("backup task not implemented"))
	// meta := t.GetMeta().(BackupMeta)
	// localRole := meta.InstanceService.GetLocal().ServerRole()
	//
	// pool := t.GetTaskPool().GetWorkerPool().NewTaskPool(true, t)
	// t.SetChildTaskPool(pool)
	//
	// if localRole == InitServer {
	// 	t.ErrorAndExit(types.ErrServerNotInit)
	// } else if localRole != BackupServer {
	// 	t.ErrorAndExit(errors.New("cannot run backup task on a core server"))
	// }
	//
	// var proxyService types.ProxyStore
	// var ok bool
	// if proxyService, ok = types.SERV.StoreService.(types.ProxyStore); !ok {
	// 	t.ErrorAndExit(errors.New("cannot run backup task without proxy service initialized"))
	// }
	// localStore := proxyService.GetLocalStore()
	//
	// coreClient := types.SERV.ClientManager.GetClientByInstanceId(meta.remoteId)
	// if coreClient == nil {
	// 	t.ErrorAndExit(errors.New("Core websocket not connected"))
	// }
	//
	// users, err := proxyService.GetAllUsers()
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	// for _, user := range users {
	// 	err = t.taskPool.workerPool.userService.Add(user)
	// 	if err != nil {
	// 		t.ErrorAndExit(err)
	// 	}
	// }
	//
	// latest, err := types.SERV.StoreService.GetLatestAction()
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	//
	// // Get new history updates
	// updatedLifetimes, err := types.SERV.StoreService.GetLifetimesSince(latest.GetTimestamp())
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	//
	// slices.SortFunc(
	// 	updatedLifetimes, func(a, b types.Lifetime) int {
	// 		aActions := a.GetActions()
	// 		bActions := b.GetActions()
	// 		return len(aActions[len(aActions)-1].GetDestinationPath()) - len(bActions[len(bActions)-1].GetDestinationPath())
	// 	},
	// )
	//
	// if len(updatedLifetimes) > 0 {
	// 	for _, lt := range updatedLifetimes {
	// 		exist := types.SERV.FileTree.GetJournal().Get(lt.ID())
	// 		if exist == nil && types.SERV.FileTree.Get(lt.GetLatestFileId()) == nil {
	// 			_, err = proxyService.GetFile(lt.GetLatestFileId())
	// 			if err != nil {
	// 				t.ErrorAndExit(err)
	// 			}
	// 		}
	// 		err = types.SERV.FileTree.GetJournal().Add(lt)
	// 		if err != nil {
	// 			t.ErrorAndExit(err)
	// 		}
	// 	}
	// }
	//
	// files := internal.FilterMap(
	// 	types.SERV.FileTree.GetJournal().GetActiveLifetimes(), func(lt types.Lifetime) (*fileTree.WeblensFile, bool) {
	// 		f := types.SERV.FileTree.Get(lt.GetLatestFileId())
	// 		if f == nil && lt.GetLatestAction().GetActionType() != types.FileDelete {
	// 			f, err = proxyService.GetFile(lt.GetLatestFileId())
	// 			if err != nil {
	// 				wlog.ShowErr(err)
	// 				wlog.Debug.Println("Failed to get file at", lt.GetLatestAction().GetDestinationPath())
	// 				return nil, false
	// 			}
	// 			err = types.SERV.FileTree.Add(f)
	// 			if err != nil {
	// 				t.ErrorAndExit(err)
	// 			}
	// 		}
	//
	// 		return f, true
	// 	},
	// )
	//
	// slices.SortFunc(
	// 	files, func(a, b *fileTree.WeblensFile) int {
	// 		return len(a.GetAbsPath()) - len(b.GetAbsPath())
	// 	},
	// )
	//
	// for _, f := range files {
	// 	if f == nil || f.IsDir() {
	// 		continue
	// 	}
	// 	stat, _ := localStore.StatFile(f)
	// 	if !stat.Exists {
	// 		if !coreClient.IsOpen() {
	// 			coreClient = types.SERV.ClientManager.GetClientByInstanceId(meta.remoteId)
	// 		}
	// 		pool.CopyFileFromCore(f, coreClient, t.caster)
	// 	}
	// }
	//
	// pool.SignalAllQueued()
	// pool.Wait(true)
	//
	// if len(pool.Errors()) != 0 {
	// 	t.ErrorAndExit(errors.New(fmt.Sprintf("%d backup file copies have failed", len(pool.Errors()))))
	// }
	//
	// t.Success()
}

func CopyFileFromCore(t *task.Task) {
	// meta := t.metadata.(backupCoreFileMeta)
	// f := meta.file
	//
	// var proxyService types.ProxyStore
	// var ok bool
	// if proxyService, ok = types.SERV.StoreService.(types.ProxyStore); !ok {
	// 	t.ErrorAndExit(errors.New("cannot run copy core file task without proxy service initialized"))
	// }
	//
	// sw := internal.NewStopwatch("Write file")
	//
	// writeFile, err := f.Writeable()
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	// defer writeFile.Close()
	// sw.Lap("Get Writeable")
	//
	// fileReader, err := proxyService.StreamFile(f)
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	// defer fileReader.Close()
	// sw.Lap("Get File Stream")
	//
	// _, err = io.Copy(writeFile, fileReader)
	// if err != nil {
	// 	t.ErrorAndExit(err)
	// }
	// sw.Lap("DO COPY")
	//
	// poolProgress := getScanResult(t)
	// poolProgress["filename"] = f.Filename()
	// t.caster.PushPoolUpdate(t.taskPool, websocket.SubTaskCompleteEvent, poolProgress)
	// if meta.core.IsOpen() {
	// 	meta.core.PushPoolUpdate(t.taskPool, websocket.SubTaskCompleteEvent, poolProgress)
	// }
	// t.Success()
	// sw.Lap("Success")
	// sw.Stop()
	// sw.PrintResults(false)
}
