import { CSSProperties, Loader } from '@mantine/core';
import { IconExclamationCircle, IconMaximize, IconPhoto, IconPlayerPauseFilled, IconPlayerPlayFilled, IconVolume, IconVolume3 } from '@tabler/icons-react';
import WeblensProgress from '@weblens/lib/WeblensProgress';
import WeblensMedia, { PhotoQuality } from '@weblens/types/media/Media';
import { secondsToVideoTime } from '@weblens/util';
import { useKeyDown, useResize, useVideo } from 'components/hooks';
import Hls from 'hls.js';
import { MouseEvent, memo, useCallback, useEffect, useMemo, useState } from 'react';



import { ErrorHandler } from '../Types';
import mediaStyle from './photoContainerStyle.module.scss';


export const MediaImage = memo(
    ({
        media,
        quality,
        fitLogic = 'cover',
        pageNumber = 0,
        expectFailure = false,
        preventClick = false,
        doFetch = true,
        imgStyle,
        containerStyle,
        containerClass = '',

        disabled = false,
    }: {
        media: WeblensMedia
        quality: PhotoQuality
        fitLogic?: 'contain' | 'cover'
        pageNumber?: number
        expectFailure?: boolean
        preventClick?: boolean
        doFetch?: boolean
        imgStyle?: CSSProperties
        containerStyle?: CSSProperties
        containerClass?: string

        disabled?: boolean
    }) => {
        if (!media) {
            media = new WeblensMedia({ contentId: '' })
        }

        const [loadError, setLoadErr] = useState('')
        const [src, setUrl] = useState({ url: '', id: media.Id() })
        const [videoRef, setVideoRef] = useState<HTMLVideoElement>()
        const { playtime, isPlaying, isWaiting } = useVideo(videoRef)

        useEffect(() => {
            if (
                media.GetMediaType() &&
                doFetch &&
                media.Id() &&
                !media.HasQualityLoaded(quality)
            ) {
                media
                    .LoadBytes(
                        quality,
                        pageNumber,
                        () => {
                            setUrl({
                                url: media.GetObjectUrl(quality, pageNumber),
                                id: media.Id(),
                            })
                            setLoadErr(media.HasLoadError())
                        },
                        () => {
                            setUrl({
                                url: media.GetObjectUrl(quality, pageNumber),
                                id: media.Id(),
                            })
                            setLoadErr(media.HasLoadError())
                        }
                    )
                    .catch((e) => {
                        console.error('Failed to get media bytes', e)
                    })
            }

            if (!doFetch) {
                media.CancelLoad()
            } else if (
                (media.HasQualityLoaded(quality) && src.url === '') ||
                src.id !== media.Id()
            ) {
                setUrl({
                    url: media.GetObjectUrl(quality, pageNumber),
                    id: media.Id(),
                })
            } else if (
                media.HighestQualityLoaded() !== '' &&
                src.url === '' &&
                pageNumber === 0
            ) {
                setUrl({
                    url: media.GetObjectUrl(PhotoQuality.LowRes),
                    id: media.Id(),
                })
            }
            return () => {
                media.CancelLoad()
            }
        }, [media, quality, doFetch, media.GetMediaType()])

        const containerClick = useCallback(
            (e: MouseEvent) => {
                if (preventClick) {
                    e.stopPropagation()
                }
            },
            [preventClick]
        )

        const shouldShowVideo =
            media.GetMediaType()?.IsVideo && quality === PhotoQuality.HighRes

        return (
            <div
                className={`photo-container ${containerClass}`}
                style={containerStyle}
                onClick={containerClick}
            >
                {loadError && !expectFailure && (
                    <IconExclamationCircle color="red" />
                )}
                {((loadError && expectFailure) ||
                    !media.Id() ||
                    !media.HighestQualityLoaded()) && <IconPhoto />}
                {media.Id() !== '' &&
                    media.GetMediaType() &&
                    quality === PhotoQuality.HighRes &&
                    media.HighestQualityLoaded() !== PhotoQuality.HighRes &&
                    !loadError &&
                    (!media.GetMediaType().IsVideo || isWaiting) && (
                        <Loader
                            color="white"
                            bottom={40}
                            right={40}
                            size={20}
                            style={{ position: 'absolute' }}
                        />
                    )}

                <img
                    className="media-image"
                    data-fit-logic={fitLogic}
                    data-disabled={disabled}
                    data-hide={
                        src.url === '' ||
                        media.HasLoadError() ||
                        shouldShowVideo ||
                        !media.HighestQualityLoaded()
                    }
                    draggable={false}
                    src={src.url}
                    style={imgStyle}
                    data-id={media.Id()}
                />

                <VideoWrapper
                    url={src.url}
                    shouldShowVideo={shouldShowVideo}
                    media={media}
                    fitLogic={fitLogic}
                    imgStyle={imgStyle}
                    videoRef={videoRef}
                    setVideoRef={setVideoRef}
                    isPlaying={isPlaying}
                    playtime={playtime}
                />
            </div>
        )
    },
    (last, next) => {
        if (last.doFetch !== next.doFetch) {
            return false
        } else if (last.disabled !== next.disabled) {
            return false
        } else if (last.media?.Id() !== next.media?.Id()) {
            return false
        } else if (last.containerStyle !== next.containerStyle) {
            return false
        } else if (
            last.media?.HighestQualityLoaded() !==
            next.media?.HighestQualityLoaded()
        ) {
            return false
        } else if (last.quality !== next.quality) {
            return false
        }
        return true
    }
)

function toggleFullScreen(div: HTMLDivElement) {
    if (!document.fullscreenElement) {
        div.requestFullscreen?.call(div)
    } else {
        document.exitFullscreen?.call(document)
    }
}

const VideoInterface = memo(
    ({
        videoLength,
        volume,
        setVolume,
        playtime,
        setPlaytime,
        isPlaying,
        showUi,
        videoRef,
        containerRef,
    }: {
        videoLength: number
        volume: number
        setVolume: (v: number) => void
        playtime: number
        setPlaytime: (v: number) => void
        isPlaying: boolean
        showUi: boolean
        videoRef: HTMLVideoElement
        containerRef: HTMLDivElement
    }) => {
        const size = useResize(containerRef)
        const [wasPlaying, setWasPlaying] = useState(false)

        const VolumeIcon = useMemo(() => {
            if (volume === 0) {
                return IconVolume3
            } else {
                return IconVolume
            }
        }, [volume])

        const buffered = useMemo(() => {
            const buffered = videoRef?.buffered.length
                ? (videoRef.buffered.end(videoRef.buffered.length - 1) /
                      videoRef.duration) *
                  100
                : 0

            return buffered
        }, [videoRef?.buffered])

        const PlayIcon = isPlaying
            ? IconPlayerPauseFilled
            : IconPlayerPlayFilled

        return (
            <div
                className="flex absolute justify-center items-end p-2"
                style={{
                    width: size.width,
                    height: size.height,
                    opacity: showUi ? 1 : 0,
                }}
            >
                <div className="flex justify-center items-center relative h-full w-full">
                    <PlayIcon
                        className="absolute text-white w-6 h-6 z-50 cursor-pointer"
                        onClick={(e) => {
                            e.stopPropagation()
                            if (isPlaying) {
                                videoRef.pause()
                            } else {
                                videoRef
                                    .play()
                                    .catch((e) =>
                                        console.error('Failed to play video', e)
                                    )
                            }
                        }}
                    />
                </div>
                <div
                    className="flex flex-row h-max w-full justify-around items-center absolute p-2 z-10 gap-2"
                    onClick={(e) => {
                        e.stopPropagation()
                    }}
                >
                    <div
                        className="flex w-max justify-center h-max text-nowrap gap-1 select-none"
                        style={{
                            minWidth: `${videoLength < 3600 ? 6.5 : 10}rem`,
                        }}
                    >
                        <span className={mediaStyle['video-time-text']}>
                            {secondsToVideoTime(playtime, videoLength > 3600)}
                        </span>
                        <span className={mediaStyle['video-time-text']}>
                            {' / '}
                        </span>
                        <span className={mediaStyle['video-time-text']}>
                            {secondsToVideoTime(videoLength)}
                        </span>
                    </div>
                    <div className="relative grow">
                        <WeblensProgress
                            height={12}
                            value={(playtime * 100) / videoLength}
                            secondaryValue={buffered}
                            seekCallback={(v, seeking) => {
                                if (videoRef) {
                                    const newTime = videoLength * (v / 100)

                                    if (!videoRef.paused && !wasPlaying) {
                                        videoRef.pause()
                                        if (seeking) {
                                            setWasPlaying(true)
                                        }
                                    }

                                    videoRef.currentTime = newTime
                                    setPlaytime(newTime)

                                    if (!seeking && (wasPlaying || isPlaying)) {
                                        videoRef.play().catch(ErrorHandler)
                                        setWasPlaying(false)
                                    }
                                }
                            }}
                        />
                    </div>
                    <div className="flex justify-center items-center relative w-[12%] gap-2 mx-4">
                        <VolumeIcon
                            className="w-4 h-4 cursor-pointer text-white z-10 shrink-0"
                            onClick={() => {
                                if (volume === 0) {
                                    const volume =
                                        localStorage.getItem('volume')
                                    if (volume) {
                                        setVolume(Number(volume))
                                    } else {
                                        setVolume(100)
                                    }
                                } else {
                                    setVolume(0)
                                }
                            }}
                        />
                        <WeblensProgress
                            height={12}
                            value={volume}
                            seekCallback={(v) => {
                                setVolume(v)
                            }}
                        />
                    </div>
                    <IconMaximize
                        className="relative w-5 h-5 cursor-pointer text-white z-100 pointer-events-auto"
                        onClick={(e) => {
                            e.stopPropagation()
                            toggleFullScreen(containerRef)
                        }}
                    />
                </div>
            </div>
        )
    },
    (prev, next) => {
        if (!prev.containerRef) {
            return false
        }

        if (
            !next.showUi &&
            !prev.showUi &&
            prev.containerRef === next.containerRef
        ) {
            return true
        }

        if (prev.showUi !== next.showUi) {
            return false
        } else if (prev.playtime !== next.playtime) {
            return false
        } else if (prev.volume !== next.volume) {
            return false
        } else if (prev.isPlaying !== next.isPlaying) {
            return false
        } else if (prev.videoRef !== next.videoRef) {
            return false
        } else if (prev.containerRef !== next.containerRef) {
            return false
        }
        return true
    }
)

function VideoWrapper({
    url,
    shouldShowVideo,
    fitLogic,
    media,
    imgStyle,
    videoRef,
    setVideoRef,
    isPlaying,
    playtime,
}: {
    url: string
    shouldShowVideo: boolean
    fitLogic: string
    media: WeblensMedia
    imgStyle: CSSProperties
    videoRef: HTMLVideoElement
    setVideoRef: (r: HTMLVideoElement) => void
    isPlaying: boolean
    playtime: number
}) {
    const [containerRef, setContainerRef] = useState<HTMLDivElement>()

    const [showUi, setShowUi] = useState<NodeJS.Timeout>()
    const [volume, setVolume] = useState<number>()
    const [playtimeInternal, setPlaytime] = useState(0)

    useEffect(() => {
        const muted = localStorage.getItem('volume-muted') === 'true'
        if (muted) {
            setVolume(0)
            return
        }
        setVolume(Number(localStorage.getItem('volume')) || 50)
        setShowUi(setTimeout(() => setShowUi(null), 2000))
    }, [])

    useEffect(() => {
        setPlaytime(playtime)
    }, [playtime])

    useEffect(() => {
        if (!videoRef) {
            return
        }

        if (videoRef.canPlayType('application/vnd.apple.mpegurl')) {
            console.debug('Not Using HLS')
            videoRef.src = media.StreamVideoUrl()
        } else if (Hls.isSupported()) {
            Hls.DefaultConfig.debug = true
            console.debug('Using HLS')
            const hls = new Hls()
            hls.loadSource(media.StreamVideoUrl())
            hls.attachMedia(videoRef)
            return () => {
                hls.destroy()
            }
        }
    }, [videoRef, media.StreamVideoUrl()])

    const togglePlayState = useCallback(() => {
        if (!videoRef) {
            return
        }
        if (isPlaying) {
            videoRef.pause()
        } else {
            videoRef.play().catch((e) => {
                console.error('Failed to play video', e)
            })
        }
    }, [isPlaying, videoRef])

    useKeyDown(' ', togglePlayState, !shouldShowVideo)

    useEffect(() => {
        if (volume === undefined) {
            return
        }
        if (videoRef) {
            videoRef.volume = volume / 100
        }
        if (volume === 0) {
            localStorage.setItem('volume-muted', 'true')
        } else {
            localStorage.setItem('volume-muted', 'false')
            localStorage.setItem('volume', volume.toString())
        }
    }, [volume])

    if (!shouldShowVideo) {
        return null
    }

    const lenInSec = media.GetVideoLength() / 1000

    return (
        <div
            ref={setContainerRef}
            className="flex relative items-center justify-center"
            onMouseMove={() => {
                setShowUi((prev) => {
                    if (prev) {
                        clearTimeout(prev)
                    }
                    return setTimeout(() => setShowUi(null), 2000)
                })
            }}
        >
            <video
                ref={setVideoRef}
                autoPlay
                muted={volume === 0}
                preload="metadata"
                className="media-image animate-fade"
                poster={media.GetObjectUrl(PhotoQuality.LowRes)}
                data-fit-logic={fitLogic}
                data-hide={
                    url === '' || media.HasLoadError() || !shouldShowVideo
                }
                style={{ ...imgStyle, borderRadius: '0', zIndex: 1 }}
                onClick={togglePlayState}
            />
            <VideoInterface
                videoLength={lenInSec}
                volume={volume}
                setVolume={setVolume}
                playtime={playtimeInternal}
                setPlaytime={setPlaytime}
                isPlaying={isPlaying}
                showUi={!!showUi || !isPlaying}
                videoRef={videoRef}
                containerRef={containerRef}
            />
        </div>
    )
}
