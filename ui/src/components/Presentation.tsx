import { Divider } from '@mantine/core'
import {
    IconChevronLeft,
    IconChevronRight,
    IconDownload,
    IconFolder,
    IconHeart,
    IconPhoto,
    IconUser,
    IconX,
} from '@tabler/icons-react'
import ReactCodeMirror from '@uiw/react-codemirror'
import { FileApi } from '@weblens/api/FileBrowserApi'
import MediaApi from '@weblens/api/MediaApi'
import { useWebsocketStore } from '@weblens/api/Websocket'
import WeblensButton from '@weblens/lib/WeblensButton'
import { downloadSelected } from '@weblens/pages/FileBrowser/FileBrowserLogic'
import { useFileBrowserStore } from '@weblens/store/FBStateControl'
import { ErrorHandler } from '@weblens/types/Types'
import WeblensFile from '@weblens/types/files/File'
import WeblensMedia, { PhotoQuality } from '@weblens/types/media/Media'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import { MediaImage } from '@weblens/types/media/PhotoContainer'
import {
    Dispatch,
    MouseEventHandler,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { humanFileSize } from '../util'
import { useSessionStore } from './UserInfo'
import { useKeyDown, useResize, useResizeDrag } from './hooks'
import presentationStyle from './presentationStyle.module.scss'

export const PresentationContainer = ({
    onMouseMove,
    onClick,
    children,
}: {
    onMouseMove?: MouseEventHandler<HTMLDivElement>
    onClick?: MouseEventHandler<HTMLDivElement>
    children?: ReactNode
}) => {
    return (
        <div
            className="flex justify-center items-center top-0 left-0 p-6 h-full 
                        w-full z-50 bg-bottom-grey bg-opacity-90 backdrop-blur absolute gap-6"
            onMouseMove={onMouseMove}
            onClick={onClick}
            children={children}
        />
    )
}

export const ContainerMedia = ({
    mediaData,
    containerRef,
}: {
    mediaData: WeblensMedia
    containerRef: HTMLDivElement
}) => {
    const [boxSize, setBoxSize] = useState({
        height: 0,
        width: 0,
    })
    const { width: containerWidth, height: containerHeight } =
        useResize(containerRef)

    useEffect(() => {
        let newWidth: number
        if (!containerRef) {
            newWidth = 0
        } else if (containerWidth < 150 && mediaData.GetPageCount() > 1) {
            newWidth = 150
        } else {
            newWidth = containerWidth
        }
        setBoxSize({ height: containerHeight, width: newWidth })
    }, [containerWidth, containerHeight])

    const style = useMemo(() => {
        if (
            !mediaData ||
            !mediaData.GetHeight() ||
            !mediaData.GetWidth() ||
            !boxSize.height ||
            !boxSize.width
        ) {
            return { height: 0, width: 0 }
        }
        const mediaRatio = mediaData.GetWidth() / mediaData.GetHeight()
        const windowRatio = boxSize.width / boxSize.height
        let absHeight = 0
        let absWidth = 0
        if (mediaRatio > windowRatio) {
            absWidth = boxSize.width
            absHeight =
                (absWidth / mediaData.GetWidth()) * mediaData.GetHeight()
        } else {
            absHeight = boxSize.height
            absWidth =
                (absHeight / mediaData.GetHeight()) * mediaData.GetWidth()
        }
        return { height: absHeight, width: absWidth }
    }, [mediaData, mediaData.GetHeight(), mediaData.GetWidth(), boxSize])

    if (!mediaData || !containerRef) {
        return <></>
    }

    if (mediaData.GetPageCount() > 1) {
        const pages: ReactNode[] = []
        for (let i = 0; i < mediaData.GetPageCount(); i++) {
            pages.push(
                <MediaImage
                    key={mediaData.Id() + i}
                    media={mediaData}
                    quality={PhotoQuality.HighRes}
                    pageNumber={i}
                    containerStyle={style}
                    preventClick
                />
            )
        }
        return (
            <div className="flex flex-col no-scrollbar gap-1 h-full">
                {pages.map((p) => p)}
            </div>
        )
    } else {
        return (
            <MediaImage
                key={mediaData.Id()}
                media={mediaData}
                quality={PhotoQuality.HighRes}
                containerStyle={{
                    ...style,
                    borderRadius: 8,
                    overflow: 'hidden',
                }}
                preventClick
            />
        )
    }
}

function TextDisplay({
    file,
    shareId,
}: {
    file: WeblensFile
    shareId: string
}) {
    const setBlockFocus = useFileBrowserStore((state) => state.setBlockFocus)
    const [content, setContent] = useState('')

    if (!file) {
        return null
    }

    useEffect(() => {
        setBlockFocus(true)
        FileApi.getFileText(file.Id(), shareId)
            .then((r) => {
                setContent(r.data)
            })
            .catch(ErrorHandler)

        return () => setBlockFocus(false)
    }, [])

    if (content.length == 0) {
        return null
    }

    return (
        <div
            className="p-8 bg-[#282c34] rounded"
            onClick={(e) => e.stopPropagation()}
        >
            <ReactCodeMirror
                value={content}
                theme={'dark'}
                basicSetup={{ lineNumbers: false, foldGutter: false }}
                minHeight={'100%'}
                minWidth={'100%'}
                editable={false}
            />
        </div>
    )
}

function MediaHeart({ mediaData }: { mediaData: WeblensMedia }) {
    const user = useSessionStore((state) => state.user)
    const shareId = useFileBrowserStore((state) => state.shareId)
    const setMediaLiked = useMediaStore((state) => state.setLiked)
    const [likedHover, setLikedHover] = useState(false)

    const { isLiked, otherLikes } = useMemo(() => {
        if (!mediaData) {
            return { isLiked: false, otherLikes: null }
        }

        const isLiked = mediaData.GetLikedBy()?.includes(user.username)

        const otherLikes =
            (!isLiked && mediaData.GetLikedBy()?.length > 0) ||
            (isLiked && mediaData.GetLikedBy()?.length > 1)

        return { isLiked, otherLikes }
    }, [mediaData?.GetLikedBy().length])

    return (
        <div
            className="cursor-pointer"
            data-shown={true}
            onClick={(e) => {
                e.stopPropagation()
                MediaApi.setMediaLiked(mediaData.Id(), !isLiked, shareId)
                    .then(() => {
                        setMediaLiked(mediaData.Id(), user.username)
                    })
                    .catch(ErrorHandler)
            }}
            onMouseOver={() => {
                setLikedHover(true)
            }}
            onMouseLeave={() => {
                setLikedHover(false)
            }}
        >
            <div className="flex flex-row h-max items-center justify-center relative">
                <IconHeart
                    size={30}
                    fill={isLiked ? 'red' : ''}
                    color={isLiked ? 'red' : 'white'}
                />
                {mediaData.GetLikedBy()?.length !== 0 && (
                    <p className="text-xs mt-auto">
                        {mediaData.GetLikedBy()?.length}
                    </p>
                )}
            </div>
            {likedHover && otherLikes && (
                <div className="flex flex-col bg-bottom-grey p-2 rounded items-center absolute bottom-7 right-0 w-max">
                    <p>Likes</p>
                    <div className="bg-raised-grey h-[1px] w-full m-1" />
                    {mediaData.GetLikedBy().map((username: string) => {
                        return (
                            <p className="text-lg" key={username}>
                                {username}
                            </p>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export const FileInfo = ({ file }: { file: WeblensFile }) => {
    const mediaData = useMediaStore((state) =>
        state.mediaMap.get(file.GetContentId())
    )
    const user = useSessionStore((state) => state.user)
    const shareId = useFileBrowserStore((state) => state.shareId)

    const wsSend = useWebsocketStore((state) => state.wsSend)
    const removeLoading = useFileBrowserStore((state) => state.removeLoading)
    const nav = useNavigate()

    if (!file) {
        return null
    }
    const [size, units] = humanFileSize(file.GetSize())
    return (
        <div
            className={presentationStyle['file-info-box']}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex flex-col justify-center h-max max-w-full gap-2">
                {file.IsFolder() && <IconFolder size={'1em'} />}
                <h3 className="truncate font-bold">{file.GetFilename()}</h3>
                <div className="flex flex-row text-white items-center">
                    <h4>{size}</h4>
                    <h4>{units}</h4>
                </div>
                <div className="flex gap-1">
                    <h4>
                        {file.GetModified().toLocaleDateString('en-us', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                        })}
                    </h4>
                </div>
                <WeblensButton
                    label={'Download'}
                    Left={IconDownload}
                    onClick={() => {
                        downloadSelected(
                            [file],
                            removeLoading,
                            wsSend,
                            shareId
                        ).catch(ErrorHandler)
                    }}
                />
                {mediaData && (
                    <div>
                        <Divider className="p-1" />
                        {!user.isLoggedIn && (
                            <div className="flex items-center">
                                <WeblensButton
                                    squareSize={40}
                                    label="Login"
                                    subtle
                                    Left={IconUser}
                                    onClick={() => {
                                        const path = window.location.pathname
                                        nav('/login', {
                                            state: { returnTo: path },
                                        })
                                    }}
                                />
                                <p>To Like and Edit Media</p>
                            </div>
                        )}
                        {user.isLoggedIn && (
                            <div className="flex gap-1 items-center text-white">
                                <IconPhoto className="shrink-0" />
                                <p className="text-xl text-nowrap mr-4">
                                    {mediaData
                                        .GetCreateDate()
                                        .toLocaleDateString('en-us', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                </p>
                                <MediaHeart mediaData={mediaData} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export const PresentationVisual = ({
    mediaData,
    Element,
}: {
    mediaData: WeblensMedia
    Element: () => ReactNode
}) => {
    const [screenRef, setScreenRef] = useState<HTMLDivElement>(null)
    const [containerRef, setContainerRef] = useState<HTMLDivElement>(null)
    const [splitSize, setSplitSize] = useState(-1)
    const [dragging, setDragging] = useState(false)
    const screenSize = useResize(screenRef)
    const splitCalc = useCallback(
        (o: number) => {
            if (screenSize.width === -1) {
                return
            }
            setSplitSize(
                (o - screenRef.getBoundingClientRect().left - 56) /
                    screenSize.width
            )
        },
        [screenSize.width]
    )

    useResizeDrag(dragging, setDragging, splitCalc)

    const imgStyle = useMemo(() => {
        if (splitSize === -1) {
            return { width: Element ? '50%' : '100%' }
        } else {
            return { width: splitSize * screenSize.width }
        }
    }, [Element, splitSize, screenSize])

    return (
        <div ref={setScreenRef} className="flex items-center h-full w-full">
            {mediaData && (
                <div
                    className="flex items-center justify-center h-full"
                    style={imgStyle}
                    ref={setContainerRef}
                >
                    <ContainerMedia
                        mediaData={mediaData}
                        containerRef={containerRef}
                    />
                </div>
            )}
            {mediaData && Element && (
                <div
                    className="flex h-1/6 w-4 cursor-pointer justify-center m-12"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={() => setDragging(true)}
                >
                    <div className="h-full w-1/12 bg-[#666666] rounded" />
                </div>
            )}
            {Element && <Element />}
        </div>
    )
}

function useKeyDownPresentation(
    contentId: string,
    setTarget: (targetId: string) => void
) {
    const mediaData = useMediaStore((state) => state.mediaMap.get(contentId))

    const keyDownHandler = useCallback(
        (event: KeyboardEvent) => {
            if (!contentId) {
                return
            } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setTarget('')
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                if (!mediaData.Prev()) {
                    return
                }
                setTarget(mediaData.Prev()?.Id())
            } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                if (!mediaData.Next()) {
                    return
                }
                setTarget(mediaData.Next()?.Id())
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
            }
        },
        [contentId, mediaData]
    )
    useEffect(() => {
        window.addEventListener('keydown', keyDownHandler)
        return () => {
            window.removeEventListener('keydown', keyDownHandler)
        }
    }, [keyDownHandler])
}

function handleTimeout(
    to: NodeJS.Timeout,
    setTo: Dispatch<NodeJS.Timeout>,
    setGuiShown: (b: boolean) => void
) {
    if (to) {
        clearTimeout(to)
    }
    setTo(setTimeout(() => setGuiShown(false), 1000))
}

export function PresentationFile({ file }: { file: WeblensFile }) {
    const [to, setTo] = useState<NodeJS.Timeout>()
    const [guiShown, setGuiShown] = useState(false)
    const [fileInfoOpen, setFileInfoOpen] = useState(true)
    const [containerRef, setContainerRef] = useState<HTMLDivElement>()

    const contentId = file?.GetContentId()
    const mediaMap = useMediaStore((state) => state.mediaMap)
    const mediaData = mediaMap.get(contentId)

    const shareId = useFileBrowserStore((state) => state.shareId)

    const setPresTarget = useFileBrowserStore(
        (state) => state.setPresentationTarget
    )

    useKeyDown('Escape', () => {
        if (file) {
            setPresTarget('')
        }
    })

    if (!file) {
        return null
    }

    let Visual = null
    if (mediaData && mediaData.Id() !== '') {
        Visual = (
            <ContainerMedia mediaData={mediaData} containerRef={containerRef} />
        )
    } else if (file.IsFolder()) {
        Visual = <IconFolder className="w-[50%] h-[50%]" />
    } else {
        Visual = <TextDisplay file={file} shareId={shareId} />
    }

    const ToggleInfoIcon = fileInfoOpen ? IconChevronRight : IconChevronLeft

    return (
        <PresentationContainer
            onMouseMove={() => {
                setGuiShown(true)
                handleTimeout(to, setTo, setGuiShown)
            }}
            onClick={() => setPresTarget('')}
        >
            <div
                className="presentation-icon top-4 left-4"
                data-shown={guiShown}
            >
                <WeblensButton
                    subtle
                    Left={IconX}
                    onClick={() => setPresTarget('')}
                />
            </div>

            <div
                ref={setContainerRef}
                className="flex grow justify-center items-center h-full"
                style={{ maxWidth: fileInfoOpen ? '45%' : '98%' }}
            >
                {Visual}
            </div>
            <ToggleInfoIcon
                className="cursor-pointer text-white shrink-0 max-4-[4%]"
                onClick={(e) => {
                    e.stopPropagation()
                    setFileInfoOpen(!fileInfoOpen)
                }}
            />
            {fileInfoOpen && (
                <div className="flex max-w-[48%] relative items-center grow">
                    <FileInfo file={file} />
                </div>
            )}
        </PresentationContainer>
    )
}

interface PresentationProps {
    mediaId: string
    setTarget: (targetId: string) => void
    element?: () => ReactNode
}

function Presentation({ mediaId, element, setTarget }: PresentationProps) {
    useKeyDownPresentation(mediaId, setTarget)

    const [to, setTo] = useState<NodeJS.Timeout>(null)
    const [guiShown, setGuiShown] = useState(false)
    const [likedHover, setLikedHover] = useState(false)
    const { user } = useSessionStore()

    const mediaData = useMediaStore((state) => state.mediaMap.get(mediaId))
    const isLiked = useMediaStore((state) => {
        const m = state.mediaMap.get(mediaId)
        return m ? m.GetLikedBy().includes(user.username) : false
    })
    const setMediaLiked = useMediaStore((state) => state.setLiked)

    if (!mediaId || !mediaData) {
        return null
    }

    const otherLikes =
        (!isLiked && mediaData.GetLikedBy()?.length > 0) ||
        (isLiked && mediaData.GetLikedBy()?.length > 1)

    return (
        <PresentationContainer
            onMouseMove={() => {
                setGuiShown(true)
                handleTimeout(to, setTo, setGuiShown)
            }}
            onClick={() => setTarget('')}
        >
            <PresentationVisual
                key={mediaId}
                mediaData={mediaData}
                Element={element}
            />

            <div
                className="presentation-icon top-4 left-4"
                data-shown={guiShown}
            >
                <WeblensButton
                    subtle
                    Left={IconX}
                    onClick={() => setTarget('')}
                />
            </div>
            <div
                className="presentation-icon bottom-4 right-4"
                data-shown={guiShown || isLiked}
                onClick={(e) => {
                    e.stopPropagation()
                    MediaApi.setMediaLiked(mediaData.Id(), !isLiked)
                        .then(() => {
                            setMediaLiked(mediaData.Id(), user.username)
                        })
                        .catch(ErrorHandler)
                }}
                onMouseOver={() => {
                    setLikedHover(true)
                }}
                onMouseLeave={() => {
                    setLikedHover(false)
                }}
            >
                <div className="flex flex-col h-max items-center justify-center">
                    {mediaData.GetLikedBy()?.length !== 0 && (
                        <p className="absolute text-xs right-0 -bottom-1">
                            {mediaData.GetLikedBy()?.length}
                        </p>
                    )}
                    <IconHeart
                        size={30}
                        fill={isLiked ? 'red' : ''}
                        color={isLiked ? 'red' : 'white'}
                    />
                </div>
                {likedHover && otherLikes && (
                    <div className="flex flex-col bg-bottom-grey p-2 rounded items-center absolute bottom-7 right-0 w-max">
                        <p>Likes</p>
                        <div className="bg-raised-grey h-[1px] w-full m-1" />
                        {mediaData.GetLikedBy().map((username: string) => {
                            return (
                                <p className="text-lg" key={username}>
                                    {username}
                                </p>
                            )
                        })}
                    </div>
                )}
            </div>
        </PresentationContainer>
    )
}

export default Presentation
