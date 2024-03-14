import { useParams } from "react-router-dom";
import { ColumnBox, RowBox, WormholeWrapper } from "./FilebrowserStyles";
import { useContext, useEffect, useState } from "react";
import { GetWormholeInfo } from "../../api/FileBrowserApi";
import { userContext } from "../../Context";
import { fileData, shareData } from "../../types/Types";
import { Box, FileButton, Space, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import UploadStatus, { useUploadStatus } from "../../components/UploadStatus";
import { IconFolder, IconUpload } from "@tabler/icons-react";
import { HandleUploadButton } from "./FileBrowserLogic";

const UploadPlaque = ({ wormholeId, uploadDispatch }: { wormholeId: string, uploadDispatch }) => {
    return (
        <ColumnBox style={{ height: '45vh' }}>
            <FileButton onChange={(files) => { HandleUploadButton(files, wormholeId, true, wormholeId, {}, uploadDispatch, () => { }) }} accept="file" multiple>
                {(props) => {
                    return (
                        <ColumnBox style={{ backgroundColor: '#111111', height: '20vh', width: '20vw', padding: 10, borderRadius: 4, justifyContent: 'center' }}>
                            <ColumnBox onClick={() => { props.onClick() }} style={{ cursor: 'pointer', height: 'max-content', width: 'max-content' }}>
                                <IconUpload size={100} style={{ padding: "10px" }} />
                                <Text size='20px' fw={600}>
                                    Upload
                                </Text>
                                <Space h={4}></Space>
                                <Text size='12px'>Click or Drop</Text>
                            </ColumnBox>
                        </ColumnBox>
                    )
                }}
            </FileButton>
        </ColumnBox>
    )
}

export default function Wormhole() {
    const wormholeId = useParams()["*"]
    const { authHeader } = useContext(userContext)
    const [wormholeInfo, setWormholeInfo]: [wormholeInfo: shareData, setWormholeInfo: any] = useState(null)
    const { uploadState, uploadDispatch } = useUploadStatus()

    console.log(wormholeInfo)

    useEffect(() => {
        if (wormholeId !== "" && authHeader.Authorization !== "") {
            GetWormholeInfo(wormholeId, authHeader)
                .then(v => { if (v.status !== 200) { return Promise.reject(v.statusText) }; return v.json() })
                .then(v => { console.log(v); setWormholeInfo(v) })
                .catch(r => { notifications.show({ title: "Failed to get wormhole info", message: String(r), color: "red" }) })
        }
    }, [wormholeId, authHeader])
    const valid = Boolean(wormholeInfo)

    return (
        <Box>
            <UploadStatus uploadState={uploadState} uploadDispatch={uploadDispatch} />
            <WormholeWrapper wormholeId={wormholeId} wormholeName={wormholeInfo?.ShareName} fileId={wormholeInfo?.fileId} validWormhole={valid} uploadDispatch={uploadDispatch}>
                <RowBox style={{ height: '20vh', width: 'max-content' }}>
                    <ColumnBox style={{ height: 'max-content', width: 'max-content' }}>
                        <Text size="40" style={{ lineHeight: "40px" }}>
                            {valid ? "Wormhole to" : "Wormhole not found"}
                        </Text>
                        {!valid && (
                            <Text size="20" style={{ lineHeight: "40px" }}>
                                {"Wormhole does not exist or was closed"}
                            </Text>
                        )}
                    </ColumnBox>
                    {valid && (
                        <IconFolder size={40} style={{ marginLeft: '7px' }} />
                    )}
                    <Text fw={700} size="40" style={{ lineHeight: "40px", marginLeft: 3 }}>
                        {wormholeInfo?.ShareName}
                    </Text>
                </RowBox>
                {valid && (
                    <UploadPlaque wormholeId={wormholeId} uploadDispatch={uploadDispatch} />
                )}
            </WormholeWrapper>
        </Box>
    )
}