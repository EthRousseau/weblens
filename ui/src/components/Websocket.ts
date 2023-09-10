import { useEffect, useState } from 'react'
import useWebSocket from 'react-use-websocket'
import { EnqueueSnackbar, closeSnackbar } from 'notistack';

export default function GetWebsocket(snacky: EnqueueSnackbar) {
    const WS_URL = 'ws://localhost:4000/api/ws';
    const [dcTimeout, setDcTimeout] = useState(null)
    const [dcSnack, setDcSnack] = useState(null)

    const { sendMessage, lastMessage, readyState } = useWebSocket(WS_URL, {
        onOpen: () => {
            clearTimeout(dcTimeout)
            if (dcSnack) {
                console.log("HERE")
                closeSnackbar(dcSnack)
                snacky("Websocket reconnected", { variant: "success" })
                setDcSnack(null)
            }
            console.log('WebSocket connection established.')
        },
        onClose: () => {
            if (!dcSnack && !dcTimeout) {
                setDcTimeout(setTimeout(() => {
                    setDcSnack(snacky("No connection to websocket, retrying...", { variant: "error", persist: true, preventDuplicate: true }))
                }, 2000))
            }
        },
        reconnectAttempts: 10,
        reconnectInterval: (attemptNumber) => {
            return Math.min(Math.pow(2, attemptNumber) * 1000, 60000)
        },
        shouldReconnect: () => true,
        onReconnectStop: () => {
            clearTimeout(dcTimeout)
            closeSnackbar(dcSnack)
            setDcSnack(snacky("Unable to connect websocket. Please refresh your page", { variant: "error", persist: true, preventDuplicate: true }))
        }
    })

    return { sendMessage, lastMessage, readyState }
}

