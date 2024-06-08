package routes

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/ethrousseau/weblens/api/dataProcess"
	"github.com/ethrousseau/weblens/api/dataStore"
	"github.com/ethrousseau/weblens/api/types"
	"github.com/ethrousseau/weblens/api/util"
	"github.com/gin-gonic/gin"
)

func wsConnect(ctx *gin.Context) {
	ctx.Status(http.StatusSwitchingProtocols)
	conn, err := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		util.ErrTrace(err)
		return
	}

	_, buf, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var auth wsAuthorize
	err = json.Unmarshal(buf, &auth)
	if err != nil {
		util.ErrTrace(err)
		// ctx.Status(http.StatusBadRequest)
		return
	}
	user, err := WebsocketAuth(ctx, []string{auth.Auth})
	if err != nil {
		util.ShowErr(err)
		return
	}

	client := cmInstance.ClientConnect(conn, user)
	go wsMain(client)
}

func wsMain(client *Client) {
	defer client.Disconnect()

	for {
		_, buf, err := client.conn.ReadMessage()
		if err != nil {
			break
		}
		go wsReqSwitchboard(buf, client)
	}
}

func wsReqSwitchboard(msgBuf []byte, client *Client) {
	defer wsRecover(client)
	// defer util.RecoverPanic("[WS] Client %d panicked: %v", client.GetClientId())

	var msg wsRequest
	err := json.Unmarshal(msgBuf, &msg)
	if err != nil {
		util.ErrTrace(err)
		return
	}

	switch msg.Action {
	case Subscribe:
		{
			var subInfo subscribeBody
			err = json.Unmarshal([]byte(msg.Content), &subInfo)
			if err != nil {
				util.ErrTrace(err)
				client.Error(errors.New("failed to parse subscribe request"))
			}

			if subInfo.SubType == "" || subInfo.Key == "" {
				client.Error(fmt.Errorf("bad subscribe request: %s", msg.Content))
				return
			}

			acc := dataStore.NewAccessMeta(client.user)
			if subInfo.ShareId != "" {
				share, err := dataStore.GetShare(subInfo.ShareId, dataStore.FileShare)
				if err != nil || share == nil {
					util.ErrTrace(err)
					client.Error(errors.New("share not found"))
					return
				}

				err = acc.AddShare(share)
				if err != nil {
					util.ErrTrace(err)
					client.Error(errors.New("failed to add share"))
					return
				}
			}

			complete, result := client.Subscribe(subInfo.SubType, subInfo.Key, subInfo.Meta, acc)
			if complete {
				Caster.PushTaskUpdate(types.TaskId(subInfo.Key), dataProcess.TaskComplete, types.TaskResult{"takeoutId": result["takeoutId"]})
			}
		}

	case Unsubscribe:
		{
			var unsubInfo unsubscribeBody
			err := json.Unmarshal([]byte(msg.Content), &unsubInfo)
			if err != nil {
				util.ErrTrace(err)
				return
			}
			client.Unsubscribe(unsubInfo.Key)
		}

	case ScanDirectory:
		{
			var scanInfo scanBody
			err := json.Unmarshal([]byte(msg.Content), &scanInfo)
			if err != nil {
				util.ErrTrace(err)
				return
			}
			folder := dataStore.FsTreeGet(scanInfo.FolderId)
			if folder == nil {
				client.Error(errors.New("could not find directory to scan"))
				return
			}

			client.debug("Got scan directory for", folder.GetAbsPath(), "Recursive: ", scanInfo.Recursive, "Deep: ", scanInfo.DeepScan)

			t := dataProcess.GetGlobalQueue().ScanDirectory(folder, scanInfo.Recursive, scanInfo.DeepScan, Caster)
			acc := dataStore.NewAccessMeta(client.user)
			client.Subscribe(SubTask, subId(t.TaskId()), nil, acc)
		}

	default:
		{
			client.Error(fmt.Errorf("unknown websocket request type: %s", string(msg.Action)))
		}
	}
}

func wsRecover(c *Client) {
	err := recover()
	if err != nil {
		c.err(err, string(debug.Stack()))
	}
}
