package routes

import (
	"encoding/json"

	"github.com/ethrousseau/weblens/api/dataProcess"
	"github.com/ethrousseau/weblens/api/dataStore"
	"github.com/ethrousseau/weblens/api/util"
	"github.com/gin-gonic/gin"
)

func wsConnect(ctx *gin.Context) {

	conn, err := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	util.FailOnError(err, "Failed to upgrade http request to websocket")

	client := cmInstance.ClientConnect(conn)
	defer client.Disconnect()
	client.SetUser(ctx.GetString("username"))
	client.log("Connected", client.Username())

	for {
		_, buf, err := client.conn.ReadMessage()
		if err != nil {
			break
		}
		go wsReqSwitchboard(buf, client)
	}
}

func wsReqSwitchboard(msgBuf []byte, client *Client) {
	defer util.RecoverPanic("[WS] Client %d panicked: %v", client.GetClientId())
	var msg wsRequest
	err := json.Unmarshal(msgBuf, &msg)
	if err != nil {
		util.DisplayError(err)
		return
	}

	switch msg.Action {
	case Subscribe:
		{
			var subInfo subscribeInfo
			json.Unmarshal([]byte(msg.Content), &subInfo)

			if subInfo.SubType == "" || subInfo.Key == "" {
				util.Error.Printf("Bad subscribe request: %v", msg.Content)
				return
			}

			complete, result := client.Subscribe(subInfo.SubType, subInfo.Key, subInfo.Meta)
			if complete {
				client.Send("zip_complete", subInfo.Key, gin.H{"takeoutId": result})
			}
		}

	case Unsubscribe:
		{
			var unsubInfo unsubscribeInfo
			json.Unmarshal([]byte(msg.Content), &unsubInfo)
			client.Unsubscribe(unsubInfo.Key)
		}

	case ScanDirectory:
		{
			var scanInfo scanInfo
			err := json.Unmarshal([]byte(msg.Content), &scanInfo)
			if err != nil {
				util.DisplayError(err)
				return
			}
			folder := dataStore.FsTreeGet(scanInfo.FolderId)
			if folder == nil {
				util.Error.Println("Failed to get dir to scan:", scanInfo.FolderId)
				return
			}

			meta := dataProcess.ScanMetadata{File: folder, Recursive: scanInfo.Recursive, DeepScan: scanInfo.DeepScan}

			t := dataProcess.NewTask(string(ScanDirectory), meta)
			dataProcess.QueueGlobalTask(t)

			client.Subscribe(Task, subId(t.TaskId), nil)
		}

	default:
		{
			util.Error.Printf("Could not parse websocket request type: %s", string(msg.Action))
		}
	}
}
