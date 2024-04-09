import { useCallback, useContext, useState } from "react";
import useWebSocket from "react-use-websocket";
import { API_WS_ENDPOINT } from "./ApiEndpoint";
import { userContext } from "../Context";
import { notifications } from "@mantine/notifications";
import { UserContextT } from "../types/Types";

export default function useWeblensSocket() {
    const [dcTimeout, setDcTimeout] = useState(null);
    const { usr, authHeader }: UserContextT = useContext(userContext);
    const { sendMessage, lastMessage, readyState } = useWebSocket(API_WS_ENDPOINT, {
        // queryParams: authHeader.Authorization ? authHeader : null,
        onOpen: () => {
            clearTimeout(dcTimeout);
            notifications.clean();
            sendMessage(JSON.stringify({auth: authHeader.Authorization}))
        },
        onClose: (event) => {
            if (!event.wasClean && authHeader && !dcTimeout && usr.username !== "") {
                setDcTimeout(
                    setTimeout(() => {
                        notifications.show({
                            id: "wsdc",
                            message: "Lost websocket connection, retrying...",
                            color: "red",
                            // icon: <IconCheck style={{ width: rem(18), height: rem(18) }} />,
                            loading: false,
                        });
                    }, 2000),
                );
            }
        },
        reconnectAttempts: 5,
        reconnectInterval: (last) => {
            return ((last + 1) ^ 2) * 1000;
        },
        shouldReconnect: () => usr.username !== "",
        onReconnectStop: () => {
            clearTimeout(dcTimeout);
            notifications.show({
                id: "wsdc",
                message: "Websocket connection lost, please refresh your page",
                autoClose: false,
                color: "red",
            });
        },
    });
    const wsSend = useCallback(
        (action: string, content: any) => {
            const msg = {
                action: action,
                content: JSON.stringify(content),
            };
            // console.log("WSSend", msg);
            sendMessage(JSON.stringify(msg));
        },
        [sendMessage],
    );

    return {
        wsSend,
        lastMessage,
        readyState,
    };
}

export function dispatchSync(
    folderIds: string | string[],
    wsSend: (action: string, content: any) => void,
    recursive: boolean,
    full: boolean,
) {
    folderIds = folderIds instanceof Array ? folderIds : [folderIds];
    for (const folderId of folderIds) {
        wsSend("scan_directory", {
            folderId: folderId,
            recursive: recursive,
            full: full,
        });
    }
}
