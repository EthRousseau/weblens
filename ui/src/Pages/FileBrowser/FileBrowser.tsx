// React
import { useState, useEffect, useReducer, useMemo, useRef, useContext, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

// Icons
import { IconCloud, IconDownload, IconExternalLink, IconFolder, IconFolderPlus, IconHome, IconPhotoPlus, IconPlus, IconRefresh, IconShare, IconTrash, IconUpload, IconUsers, IconUsersGroup } from "@tabler/icons-react"

// Mantine
import { Box, Button, Text, Space, FileButton, Paper, Card, Divider, Popover, ScrollArea, Loader, TextInput, Tooltip, ActionIcon, LoadingOverlay, TooltipFloating, Progress } from '@mantine/core'

// Local
import Presentation from '../../components/Presentation'
import HeaderBar from "../../components/HeaderBar"
import Crumbs, { StyledBreadcrumb } from '../../components/Crumbs'
import { GetFolderData, ShareFiles } from '../../api/FileBrowserApi'
import { fileData, FileBrowserStateType, AlbumData } from '../../types/Types'
import useWeblensSocket, { dispatchSync } from '../../api/Websocket'
import { deleteSelected, GetDirFiles, HandleDrop, HandleWebsocketMessage, downloadSelected, fileBrowserReducer, useKeyDown, useMousePosition, moveSelected, HandleUploadButton } from './FileBrowserLogic'
import { DirViewWrapper, FlexColumnBox, FlexRowBox } from './FilebrowserStyles'
import { userContext } from '../../Context'
import UploadStatus, { useUploadStatus } from '../../components/UploadStatus'
import { useDebouncedValue } from '@mantine/hooks'
import { FilesWrapper } from '../../types/Styles'
import { AddMediaToAlbum, CreateAlbum, GetAlbums } from '../../api/GalleryApi'
import { MediaImage } from '../../components/PhotoContainer'
import { notifications } from '@mantine/notifications'
import { ShareInput } from '../../components/Share'
import { humanFileSize } from '../../util'
import NotFound from '../../components/NotFound'

function NewAlbum({ refreshAlbums }: { refreshAlbums: (doLoading) => Promise<void> }) {
    const { authHeader } = useContext(userContext)
    const [hovered, setHovered] = useState(false)
    const [newAlbumName, setNewAlbumName] = useState(null)
    const [loading, setLoading] = useState(false)

    if (newAlbumName == null) {
        return (
            <FlexColumnBox
                style={{ height: '100%', width: '100%', minHeight: '260px', cursor: 'pointer', padding: '5px', borderRadius: '5px', backgroundColor: hovered ? '#3333ee' : "", justifyContent: 'center' }}
                onClick={_ => setNewAlbumName("")}
                onMouseOver={() => { setHovered(true) }}
                onMouseLeave={() => { setHovered(false) }}
            >
                <IconPlus />
                <Text>New Album</Text>
            </FlexColumnBox>
        )
    } else {
        return (
            <FlexColumnBox style={{justifyContent: 'center', height: '100%', minHeight: '260px'}}>
                <FlexColumnBox style={{ height: '85px', width: '100%', padding: '5px'}}>
                    <TextInput autoFocus onBlur={() => { if (!newAlbumName) { setHovered(false); setNewAlbumName(null) } }} placeholder="New Album Name" value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)} style={{width: '100%'}}/>
                    <Space h={10} />
                    <Button fullWidth color='#4444ff' onClick={() => {setHovered(false); setLoading(true); CreateAlbum(newAlbumName, authHeader).then(() => { refreshAlbums(false).then(() => setNewAlbumName(null)); setLoading(false) })}}>Create</Button>
                </FlexColumnBox>
                <LoadingOverlay visible={loading}/>
            </FlexColumnBox>
        )
    }
}

function SingleAlbum({ album, loading, PartialApiCall }: { album: AlbumData, loading: boolean, PartialApiCall: (albumId: string) => void }) {
    const [hovered, setHovered] = useState(false)
    const {userInfo} = useContext(userContext)

    return (
        <Box pos={'relative'}>
            <FlexColumnBox
                style={{  cursor: 'pointer', padding: '5px', borderRadius: '5px', backgroundColor: hovered ? '#3333ee' : "#ffffff21", justifyContent: 'space-between' }}
                onClick={() => { PartialApiCall(album.Id) }}
                onMouseOver={() => { setHovered(true) }}
                onMouseLeave={() => { setHovered(false) }}
            >
                {album.Owner !== userInfo.username && (
                    <Tooltip label={`Shared by ${album.Owner}`}>
                        <IconUsersGroup color="white" style={{ position: "absolute", alignSelf: 'flex-start', margin: 10, zIndex: 1 }} />
                    </Tooltip>
                )}
                <MediaImage mediaId={album.Cover} quality='thumbnail' expectFailure containerStyle={{ borderRadius: '6px', overflow: 'hidden', width: '200px', height: '200px' }} />
                <FlexRowBox style={{height: '50px', justifyContent: 'space-between', paddingLeft: 4}}>
                    <FlexColumnBox style={{height: 'max-content', alignItems: 'flex-start', width: '175px'}}>
                        <TooltipFloating position='top' label={album.Name}>
                            <Text c='white' fw={500} truncate='end' w={'100%'}>{album.Name}</Text>
                        </TooltipFloating>
                        <Text size='12px'>{album.Medias.length}</Text>
                    </FlexColumnBox>
                    <TooltipFloating position='right' label='Open Album'>
                        <IconExternalLink onClick={(e) => {e.stopPropagation(); window.open(`/albums/${album.Id}`,'_blank')}} onMouseOver={(e) => {e.stopPropagation(); setHovered(false) }}/>
                    </TooltipFloating>
                </FlexRowBox>
            </FlexColumnBox>
            <LoadingOverlay visible={loading} overlayProps={{radius: 'sm'}}/>
        </Box>
    )
}

function AlbumScoller({ getSelected, authHeader }: {
    getSelected: () => {media: string[], folders: string[]},
    authHeader
}) {
    const [albums, setAlbums]: [albums: AlbumData[], setAlbums: any] = useState(null)
    // This is for the state if we are waiting for the list of albums
    const [loading, setLoading] = useState(false)

    // This is for tracking which album(s) are waiting
    // for results of adding media... naming is hard
    const [loadingAlbums, setLoadingAlbums] = useState([])

    const fetchAlbums = useCallback((doLoading) => {
        if (authHeader.Authorization === "") {
            return
        }
        if (doLoading) {
            setLoading(true)
        }
        return GetAlbums(authHeader).then(ret => {setAlbums(ret); setLoading(false)})
    }, [authHeader])

    const addMediaApiCall = useCallback((albumId) => {
        const {media, folders} = getSelected()
        setLoadingAlbums(cur => [...cur, albumId])
        AddMediaToAlbum(albumId, media, folders, authHeader)
            .then((res) => {
                if (res.errors.length === 0) {
                    setLoadingAlbums(cur => cur.filter(v => v !== albumId))
                    fetchAlbums(false)
                    if (res.addedCount === 0) {
                        notifications.show({message: `No new media to add to album`, color: 'orange'})
                    } else {
                        notifications.show({message: `Added ${res.addedCount} medias to album`, color: 'green'})
                    }
                } else {
                    Promise.reject(res.errors)
                }
            })
            .catch((r) => { notifications.show({ title: "Could not add media to album", message: String(r), color: 'red' }) })
    }, [getSelected, authHeader, fetchAlbums])

    useEffect(() => {
        fetchAlbums(true)
    }, [fetchAlbums])

    const albumElements = useMemo(() => {
        if (!albums || !addMediaApiCall) {
            return []
        }
        const albumElements = albums.map((val) => {
            return (
                <SingleAlbum key={val.Name} album={val} loading={loadingAlbums.includes(val.Id)} PartialApiCall={addMediaApiCall} />
            )
        })
        return albumElements
    }, [albums, addMediaApiCall, loadingAlbums])

    const columns = useMemo(() => {return Math.min(albumElements.length + 1, 4)}, [albumElements.length])

    if (loading || !albumElements) {
        return (
            <Loader />
        )
    }
    return (
        <ScrollArea.Autosize type='never' mah={1000} maw={1000}>
            <Box style={{display: 'grid', gap: 16, gridTemplateColumns: `repeat(${columns}, 210px)`}}>
                {albumElements}
                <NewAlbum refreshAlbums={fetchAlbums} />
            </Box>
            {albumElements.length === 0 && (
                <Text style={{ textAlign: 'center' }}>No Albums</Text>
            )}
        </ScrollArea.Autosize>
    )
}

function selectedMediaIds(dirMap: Map<string, fileData>, selectedMap: Map<string, boolean>): string[] {
    let selectedObjs = Array.from(selectedMap.keys()).map((key) => {
        const file: fileData = dirMap.get(key)
        return file.mediaData.fileHash
    })
    selectedObjs = selectedObjs.filter((val) => {
        return val !== ""
    })
    return selectedObjs
}

function selectedFolderIds(dirMap: Map<string, fileData>, selectedMap: Map<string, boolean>): string[] {
    let selectedObjs = Array.from(selectedMap.keys()).map((key) => {
        const file: fileData = dirMap.get(key)
        if (file.isDir) {
            return file.id
        }
        return ""
    })
    selectedObjs = selectedObjs.filter((val) => {
        return val !== ""
    })
    return selectedObjs
}

function ShareBox({ open, setOpen, fileIds, fetchFiles, dragging, numFilesIOwn }: { open: boolean, setOpen, fileIds: string[], fetchFiles, dragging, numFilesIOwn }) {
    const { authHeader } = useContext(userContext)
    const [value, setValue] = useState([])

    return (
        <Popover opened={open} position='right' onClose={() => setOpen(false)} closeOnClickOutside>
            <Popover.Target>
                <Button fullWidth variant='subtle' color='#eeeeee' m={3} disabled={dragging || numFilesIOwn === 0} justify='space-between' rightSection={<Text>{numFilesIOwn}</Text>} leftSection={<IconShare />} onClick={(e) => { e.stopPropagation(); setOpen(true) }} >
                    Share
                </Button>
            </Popover.Target>
            <Popover.Dropdown>
                <ShareInput valueSetCallback={setValue} initValues={[]} />
                <Space h={10} />
                <Button fullWidth disabled={JSON.stringify(value) === JSON.stringify([])} color="#4444ff" onClick={() => { ShareFiles(fileIds, value, authHeader).then(() => { notifications.show({ message: "File(s) shared", color: 'green' }); setOpen(false) }).catch((r) => notifications.show({ title: "Failed to share files", message: String(r), color: 'red' })) }}>
                    Update
                </Button>
            </Popover.Dropdown>
        </Popover>
    )
}

function GlobalActions({ fbState, dispatch, wsSend, uploadDispatch }: { fbState: FileBrowserStateType, dispatch, wsSend: (action: string, content: any) => void, uploadDispatch }) {
    const nav = useNavigate()
    const { userInfo, authHeader } = useContext(userContext)
    const [sharing, setSharing] = useState(false)
    const [adding, setAdding] = useState(false)
    const amHome = fbState.folderInfo.id === userInfo?.homeFolderId
    const numFilesIOwn = useMemo(() => Array.from(fbState.selected.keys()).filter((key) => fbState.dirMap.get(key)?.owner === userInfo.username).length, [fbState.selected.size, fbState.dirMap, fbState.selected, userInfo?.username])

    return (
        <FlexColumnBox style={{ marginLeft: "16px", marginTop: 125, width: '200px' }} >
            <Button fullWidth variant={amHome ? 'light' : 'subtle'} color={'#4444ff'} m={3} disabled={fbState.draggingState !== 0} justify='flex-start' leftSection={<IconHome />} onClick={() => { nav('/files/home') }} >
                My Files
            </Button>
            <Button fullWidth variant={fbState.folderInfo.id === "shared" ? 'light' : 'subtle'} color={'#4444ff'} m={3} disabled={fbState.draggingState !== 0} justify='flex-start' leftSection={<IconUsers />} onClick={() => { nav('/files/shared') }} >
                Shared With Me
            </Button>
            <Button fullWidth variant={fbState.folderInfo.id === userInfo?.trashFolderId ? 'light' : 'subtle'} color={'#4444ff'} m={3} disabled={fbState.draggingState !== 0} justify='flex-start' leftSection={<IconTrash />} onClick={() => { nav('/files/trash') }} >
                Trash
            </Button>
            <Space h={"md"} />
            <Button fullWidth variant='subtle' color='#eeeeee' disabled={fbState.draggingState !== 0 || !fbState.folderInfo.modifiable} m={3} justify='flex-start' leftSection={<IconFolderPlus />} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'new_dir' }) }}>
                New Folder
            </Button>
            <FileButton onChange={(files) => { HandleUploadButton(files, fbState.folderInfo.id, authHeader, uploadDispatch, dispatch, wsSend) }} accept="file" multiple>
                {(props) => {
                    return (
                        <Button fullWidth variant='subtle' color='#eeeeee' disabled={fbState.draggingState !== 0 || !fbState.folderInfo.modifiable} m={3} justify='flex-start' leftSection={<IconUpload />} onClick={() => props.onClick()}>
                            Upload
                        </Button>
                    )
                }}
            </FileButton>
            <Space h={"md"} />
            <ShareBox open={sharing} setOpen={(open) => {setSharing(open); dispatch({type: 'set_block_focus', block: open})}} fileIds={Array.from(fbState.selected.keys())} fetchFiles={() => { }} dragging={fbState.draggingState} numFilesIOwn={numFilesIOwn} />
            <Popover opened={adding} trapFocus position="right-end" onClose={() => {setAdding(false); dispatch({type: 'set_block_focus', block: false})}} styles={{dropdown: {marginTop: 100}}}>
                <Popover.Target>
                    <Button fullWidth variant='subtle' color='#eeeeee' m={3} disabled={fbState.draggingState !== 0 || fbState.selected.size === 0} justify='space-between' rightSection={<Text>{fbState.selected.size}</Text>} leftSection={<IconPhotoPlus />} onClick={(e) => { e.stopPropagation(); setAdding(true); dispatch({type: 'set_block_focus', block: true}) }}>
                        Add to
                    </Button>
                </Popover.Target>
                <Popover.Dropdown style={{ width: 'max-content' }}>
                    <AlbumScoller getSelected={() => {return {media: selectedMediaIds(fbState.dirMap, fbState.selected), folders: selectedFolderIds(fbState.dirMap, fbState.selected)}}} authHeader={authHeader} />
                </Popover.Dropdown>
            </Popover>

            <Button fullWidth variant='subtle' color='#eeeeee' m={3} disabled={fbState.draggingState !== 0 || fbState.selected.size === 0} justify='space-between' rightSection={<Text>{fbState.selected.size}</Text>} leftSection={<IconDownload />} onClick={(e) => { e.stopPropagation(); downloadSelected(fbState.selected, fbState.dirMap, dispatch, wsSend, authHeader) }} >
                Download
            </Button>
            <Space h={"md"} />
            <Button fullWidth variant='subtle' color='red' m={3} disabled={fbState.draggingState !== 0 || numFilesIOwn === 0} justify='space-between' rightSection={<Text>{numFilesIOwn}</Text>} leftSection={<IconTrash />} onClick={(e) => { e.stopPropagation(); deleteSelected(fbState.selected, fbState.dirMap, authHeader) }} >
                {(fbState.folderInfo.id === userInfo.trashFolderId || fbState.parents.map(v => v.id).includes(userInfo?.trashFolderId)) ? "Delete" : "Trash"}
            </Button>

            <Divider w={'100%'} my='lg' size={1.5}/>

            <UsageInfo homeDirSize={fbState.homeDirSize} currentFolderSize={fbState.folderInfo.size} displayCurrent={fbState.folderInfo.id !== "shared"} trashSize={fbState.folderInfo.id === userInfo.homeFolderId ? fbState.dirMap.get(userInfo.trashFolderId)?.size : 0}/>
        </FlexColumnBox>
    )
}

function UsageInfo({homeDirSize, currentFolderSize, displayCurrent, trashSize}) {
    if (!displayCurrent) {
        currentFolderSize = homeDirSize
    }
    if (!trashSize) {
        trashSize = 0
    }

    return (
        <FlexColumnBox style={{height: 'max-content', width: '100%', alignItems: 'flex-start'}}>
            <Text fw={600}>Usage</Text>
            <Space h={10}/>
            <Progress radius={'xs'} color='#4444ff' value={((currentFolderSize - trashSize)/homeDirSize) * 100} style={{height: 20, width: '100%'}}/>
            <FlexRowBox>
                {displayCurrent && (
                    <FlexRowBox>
                        <IconFolder size={20} />
                        <Text size='14px' pl={3}>{humanFileSize(currentFolderSize - trashSize)}</Text>
                    </FlexRowBox>
                )}
                <FlexRowBox style={{justifyContent: 'right'}}>
                    <Text size='14px' pr={3}>{humanFileSize(homeDirSize)}</Text>
                    <IconCloud size={20} />
                </FlexRowBox>
            </FlexRowBox>
        </FlexColumnBox>
    )
}

function DraggingCounter({ dragging, numSelected, dispatch }) {
    const position = useMousePosition()
    if (dragging !== 1) {
        return null
    }
    return (
        <Box
            style={{
                position: 'fixed',
                top: position.y + 8,
                left: position.x + 8,
                zIndex: 10
            }}
            onMouseUp={() => { dispatch({ type: 'set_dragging', dragging: false }) }}
        >
            <StyledBreadcrumb label={numSelected.toString()} />
        </Box>
    )
}

function Files({ filebrowserState, folderId, notFound, setNotFound, alreadyScanned, setAlreadyScanned, dispatch, wsSend, uploadDispatch, authHeader }:
    { filebrowserState: FileBrowserStateType, folderId, notFound, setNotFound, alreadyScanned, setAlreadyScanned, dispatch, wsSend: (action: string, content: any) => void, uploadDispatch, authHeader }) {
    const gridRef = useRef(null)
    const {userInfo} = useContext(userContext)
    const nav = useNavigate()
    const [debouncedSearch] = useDebouncedValue(filebrowserState.searchContent, 200)

    const { files, scanRequired } = useMemo(() => {
        return GetDirFiles(filebrowserState, userInfo, dispatch, authHeader, gridRef)
    }, [debouncedSearch, filebrowserState, dispatch, authHeader, gridRef])

    useEffect(() => {
        if (scanRequired && !alreadyScanned) { setAlreadyScanned(true); dispatchSync(filebrowserState.folderInfo.id, wsSend, false, false) }
    }, [scanRequired, alreadyScanned, filebrowserState.folderInfo.id, wsSend, setAlreadyScanned])

    if (notFound) {
        return (
            <NotFound resourceType='Folder' link='/files/home' setNotFound={setNotFound}/>
        )
    }

    if (files.length !== 0) {
        return (
            <FilesWrapper reff={gridRef}>
                {files}
            </FilesWrapper>
        )
    } else if (!filebrowserState.loading && folderId !== "shared") {
        return (
            <FlexRowBox style={{ overflow: 'hidden', justifyContent: 'center' }}>
                <Card variant="solid" style={{ height: 'max-content', top: '40vh', position: 'fixed', padding: '50px' }}>
                    <Text size='25px' ta={'center'} fw={800}>
                        This folder is empty
                    </Text>

                    {filebrowserState.folderInfo.modifiable && (
                        <Card.Section style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingTop: 15 }}>
                            <FileButton onChange={(files) => { HandleDrop(files, folderId, filebrowserState.dirMap, authHeader, uploadDispatch, dispatch, wsSend) }} accept="file" multiple>
                                {(props) => {
                                    return (
                                        <FlexColumnBox onClick={() => { props.onClick() }} style={{ cursor: 'pointer', marginTop: '0px' }}>
                                            <IconUpload size={100} style={{ padding: "10px" }} />
                                            <Text size='20px' fw={600}>
                                                Upload
                                            </Text>
                                            <Space h={4}></Space>
                                            <Text size='12px'>Click or Drop</Text>
                                        </FlexColumnBox>
                                    )
                                }}
                            </FileButton>
                            <Divider orientation='vertical' m={20} />

                            <FlexColumnBox onClick={(e) => { e.stopPropagation(); dispatch({ type: 'new_dir' }) }} style={{ cursor: 'pointer' }}>
                                <IconFolderPlus size={100} style={{ padding: "10px" }} />
                                <Text size='20px' fw={600}>
                                    New Folder
                                </Text>

                            </FlexColumnBox>
                        </Card.Section>
                    )}
                </Card>
            </FlexRowBox>
        )
    } else if (!filebrowserState.loading && filebrowserState.folderInfo.id === "shared") {
        return (
            <Paper variant="solid" style={{ height: 'max-content', top: '40vh', position: 'fixed', padding: 40 }}>
                <FlexColumnBox style={{ alignItems: 'center' }}>
                    <Text display={'flex'} style={{ flexDirection: 'column', alignItems: 'center', padding: 2 }}>
                        You have no files shared with you
                    </Text>
                    <Space h={'lg'} />
                    <Button color={'#4444ff'} fullWidth onClick={() => nav('/files/home')}>Return Home</Button>
                </FlexColumnBox>
            </Paper>
        )
    } else {
        return null
    }
}

const FileBrowser = () => {
    const folderId = useParams()["*"]
    const navigate = useNavigate()
    const { authHeader, userInfo } = useContext(userContext)
    const searchRef = useRef()
    const { wsSend, lastMessage, readyState } = useWeblensSocket()
    const [alreadyScanned, setAlreadyScanned] = useState(false)
    const [notFound, setNotFound] = useState(false)
    const { uploadState, uploadDispatch } = useUploadStatus()

    const [filebrowserState, dispatch]: [FileBrowserStateType, React.Dispatch<any>] = useReducer(fileBrowserReducer, {
        dirMap: new Map<string, fileData>(),
        selected: new Map<string, boolean>(),
        uploadMap: new Map<string, boolean>(),
        folderInfo: {},
        parents: [],
        draggingState: 0,
        scanProgress: 0,
        homeDirSize: 0,
        presentingId: "",
        searchContent: "",
        lastSelected: "",
        hovering: "",
        loading: true,
        holdingShift: false,
        blockFocus: false,
    })

    useKeyDown(filebrowserState.blockFocus, dispatch, searchRef)

    const realId = useMemo(() => {
        let realId
        if (userInfo) {
            if (folderId === "home") {
                realId = userInfo.homeFolderId
            } else if (folderId === "trash") {
                realId = userInfo.trashFolderId
            } else {
                realId = folderId
            }
        }
        return realId
    }, [folderId, userInfo])

    // Subscribe to the current folder to get updates about size, children, etc.
    useEffect(() => {
        if (readyState === 1 && realId != null && realId !== "shared") {
            if (filebrowserState.folderInfo.id !== realId) {
                return
            }
            if (realId === "trash") {
                wsSend("subscribe", { subscribeType: "folder", subscribeKey: userInfo.trashFolderId, subscribeMeta: JSON.stringify({recursive: false}) })
                return (
                    () => wsSend("unsubscribe", { subscribeKey: userInfo.trashFolderId })
                )
            } else {
                wsSend("subscribe", { subscribeType: "folder", subscribeKey: realId, subscribeMeta: JSON.stringify({recursive: false}) })
                return (
                    () => wsSend("unsubscribe", { subscribeKey: realId })
                )
            }
        }
    }, [readyState, filebrowserState.folderInfo.id, realId, userInfo?.trashFolderId, wsSend])

    // Subscribe to the home folder even if we aren't in it, to be able to update the total disk usage
    useEffect(() => {
        if (!userInfo || userInfo.homeFolderId === realId) {
            return
        }
        wsSend("subscribe", { subscribeType: "folder", subscribeKey: userInfo.homeFolderId, subscribeMeta: JSON.stringify({recursive: false}) })
        return (
            () => wsSend("unsubscribe", { subscribeKey: userInfo.homeFolderId })
        )
    }, [userInfo, userInfo?.homeFolderId, realId, wsSend])

    useEffect(() => {
        if (!userInfo) {
            return
        }
        HandleWebsocketMessage(lastMessage, userInfo, dispatch, authHeader)
    }, [lastMessage, userInfo, authHeader])

    useEffect(() => {
        if (!folderId || folderId === userInfo?.homeFolderId || folderId === "undefined") {
            navigate('/files/home')
        }
        if (!userInfo || authHeader.Authorization === '' || !realId) {
            return
        }
        // Kinda just reset everything...
        setAlreadyScanned(false)
        dispatch({ type: "clear_files" })
        dispatch({ type: "set_search", search: "" })
        dispatch({ type: "set_scan_progress", progress: 0 })
        dispatch({ type: "set_loading", loading: true })
        GetFolderData(realId, userInfo.username, dispatch, authHeader)
        .then(() => dispatch({ type: "set_loading", loading: false }))
        .catch((r) => {
            dispatch({ type: "set_loading", loading: false })
            if (r === 404) {
                setNotFound(true)
                return
            }
            notifications.show({ title: "Could not get folder info", message: String(r), color: 'red', autoClose: 5000 })
        })
    }, [folderId, userInfo, authHeader, navigate, realId])

    const moveSelectedTo = useCallback(folderId => {moveSelected(filebrowserState.selected, folderId, authHeader); dispatch({type: 'clear_selected'})}, [filebrowserState.selected.size, authHeader])
    const doScan = useCallback(() => { dispatch({ type: 'set_loading', loading: true }); dispatchSync(realId, wsSend, filebrowserState.holdingShift, filebrowserState.holdingShift) }, [realId, wsSend, filebrowserState.holdingShift])

    if (!userInfo) {
        return null
    }

    return (
        <FlexColumnBox style={{ height: '100vh', backgroundColor: "#111418" }} >
            <HeaderBar
                searchContent={filebrowserState.searchContent}
                dispatch={dispatch}
                page={"files"}
                searchRef={searchRef}
                loading={filebrowserState.loading}
                progress={filebrowserState.scanProgress}
            />
            <DraggingCounter dragging={filebrowserState.draggingState} numSelected={filebrowserState.selected.size} dispatch={dispatch} />
            <Presentation mediaData={filebrowserState.dirMap.get(filebrowserState.presentingId)?.mediaData} parents={[...filebrowserState.parents, filebrowserState.folderInfo]} dispatch={dispatch} />
            <UploadStatus uploadState={uploadState} uploadDispatch={uploadDispatch} count={uploadState.uploadsMap.size} />
            <FlexRowBox style={{ alignItems: 'flex-start' }}>
                <GlobalActions fbState={filebrowserState} dispatch={dispatch} wsSend={wsSend} uploadDispatch={uploadDispatch} />
                <DirViewWrapper
                    folderId={realId}
                    folderName={filebrowserState.folderInfo?.filename}
                    dragging={filebrowserState.draggingState}
                    hoverTarget={filebrowserState.hovering}
                    onDrop={(e => HandleDrop(e.dataTransfer.items, realId, filebrowserState.dirMap, authHeader, uploadDispatch, dispatch, wsSend) )}
                    dispatch={dispatch}
                    onMouseOver={() => dispatch({ type: 'set_hovering', filepath: "" })}
                >
                    <FlexRowBox style={{height: 78}}>
                        {realId !== "shared" && realId !== "trash" && (
                            <Tooltip label={filebrowserState.holdingShift ? "Deep scan folder" : "Scan folder"}>
                                <ActionIcon color='#00000000' size={35} onClick={doScan}>
                                    <IconRefresh color={filebrowserState.holdingShift ? '#4444ff' : 'white'} size={35} />
                                </ActionIcon>
                            </Tooltip>
                        )}
                        {(realId === "shared" || realId === "trash") && (
                            <Space w={35}/>
                        )}
                        <Crumbs finalFile={filebrowserState.folderInfo} parents={filebrowserState.parents} navOnLast={false} dragging={filebrowserState.draggingState} moveSelectedTo={moveSelectedTo} />
                    </FlexRowBox>
                    <Files filebrowserState={filebrowserState} folderId={realId} notFound={notFound} setNotFound={setNotFound} alreadyScanned={alreadyScanned} setAlreadyScanned={setAlreadyScanned} dispatch={dispatch} wsSend={wsSend} uploadDispatch={uploadDispatch} authHeader={authHeader} />
            </DirViewWrapper>
            </FlexRowBox>
        </FlexColumnBox>
    )
}

export default FileBrowser