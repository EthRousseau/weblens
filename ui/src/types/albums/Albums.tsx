import { Divider, Space } from '@mantine/core'
import {
    IconArrowLeft,
    IconFolder,
    IconInputX,
    IconLibraryPlus,
    IconPlus,
    IconSearch,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import WeblensButton from '@weblens/lib/WeblensButton'
import WeblensInput from '@weblens/lib/WeblensInput'
import WeblensProgress from '@weblens/lib/WeblensProgress'
import { GalleryFilters } from '@weblens/pages/Gallery/Gallery'
import {
    GalleryContext,
    GalleryContextT,
} from '@weblens/pages/Gallery/GalleryLogic'

import { AlbumScroller } from '@weblens/types/albums/AlbumDisplay'
import {
    createAlbum,
    getAlbumMedia,
    getAlbums,
} from '@weblens/types/albums/AlbumQuery'
import WeblensMedia from '@weblens/types/media/Media'
import { PhotoGallery } from '@weblens/types/media/MediaDisplay'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import FilesErrorDisplay from 'components/NotFound'
import React, {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

export function AlbumNoContent({ hasContent }: { hasContent: boolean }) {
    const nav = useNavigate()
    return (
        <div className="flex flex-col w-full items-center">
            <div className="flex flex-col pt-40 w-max items-center">
                {hasContent && (
                    <div className="flex flex-col items-center">
                        <p className="font-extrabold text-3xl mb-10">
                            No media in current filters
                        </p>
                        <Space h={5} />
                        <p className="font-medium text-xl">
                            Adjust the filters
                        </p>
                        <Space h={5} />
                        <Divider label="or" mx={30} />
                    </div>
                )}
                {!hasContent && (
                    <p className="font-extrabold text-3xl m-2">No Media</p>
                )}
                <Space h={10} />
                <WeblensButton
                    squareSize={40}
                    centerContent
                    label="Upload"
                    Left={IconFolder}
                    onClick={() => nav('/files/home')}
                />
            </div>
        </div>
    )
}

const AlbumTitle = ({ startColor, endColor, title }) => {
    const sc = startColor ? `#${startColor}` : '#447bff'
    const ec = endColor ? `#${endColor}` : '#6700ff'
    const style = {
        background: `linear-gradient(to right, ${sc}, ${ec}) text`,
    }
    return (
        <div className="flex h-max w-full justify-center">
            <h1
                className={`text-7xl font-extrabold select-none inline-block text-transparent `}
                style={style}
            >
                {title}
            </h1>
        </div>
    )
}

function AlbumContent({ albumId }: { albumId: string }) {
    const { galleryState } = useContext(GalleryContext)
    const [notFound, setNotFound] = useState(false)

    const showRaw = useMediaStore((state) => state.showRaw)
    const addMedias = useMediaStore((state) => state.addMedias)

    const albumContentRes = useQuery({
        queryKey: ['albumContent', albumId, showRaw],
        queryFn: async () => {
            const data = await getAlbumMedia(albumId, showRaw).catch((r) => {
                console.error(r)
                setNotFound(true)
            })
            if (!data) {
                return
            }

            const medias = data.mediaInfos
                ? data.mediaInfos.map((m) => new WeblensMedia(m))
                : []
            addMedias(medias)
            return { albumMeta: data.albumMeta, medias: medias }
        },
    })

    const media = useMemo(() => {
        if (!albumContentRes.data) {
            return []
        }
        if (albumContentRes.data.medias) {
            const media = albumContentRes.data.medias
                ?.filter((v) => {
                    if (galleryState.searchContent === '') {
                        return true
                    }
                    return v.MatchRecogTag(galleryState.searchContent)
                })
                .reverse()
            media?.unshift()
            return media
        }

        return []
    }, [albumContentRes.data?.medias, galleryState.searchContent])

    if (notFound || albumContentRes.error) {
        console.error(albumContentRes.error)
        return (
            <FilesErrorDisplay
                resourceType="Album"
                link="/albums"
                setNotFound={setNotFound}
            />
        )
    }

    if (!albumContentRes.data) {
        return null
    }

    return (
        <div className="flex flex-col items-center h-1/2 w-full relative grow">
            <AlbumTitle
                title={albumContentRes.data.albumMeta.name}
                endColor={albumContentRes.data.albumMeta.secondaryColor}
                startColor={albumContentRes.data.albumMeta.primaryColor}
            />
            {media.length === 0 && (
                <AlbumNoContent
                    hasContent={
                        albumContentRes.data.albumMeta.medias?.length !== 0
                    }
                />
            )}

            {media.length !== 0 && (
                <PhotoGallery
                    medias={media}
                    album={albumContentRes.data.albumMeta}
                />
            )}
        </div>
    )
}

function NewAlbum({ fetchAlbums }: { fetchAlbums: () => void }) {
    const [newAlbumName, setNewAlbumName] = useState(null)

    return (
        <div className="flex items-center h-14 w-40">
            {newAlbumName === null && (
                <WeblensButton
                    squareSize={40}
                    label="New Album"
                    centerContent
                    Left={IconLibraryPlus}
                    onClick={() => {
                        setNewAlbumName('')
                    }}
                />
            )}
            {newAlbumName !== null && (
                // <div className="flex flex-row w-10 items-center justify-center bg-dark-paper rounded p-2">
                <WeblensInput
                    value={newAlbumName}
                    squareSize={40}
                    autoFocus
                    onComplete={(val) =>
                        createAlbum(val)
                            .then(() => {
                                setNewAlbumName(null)
                                fetchAlbums()
                            })
                            .catch((r) => {
                                console.error(r)
                            })
                    }
                    closeInput={() => setNewAlbumName(null)}
                    buttonIcon={IconPlus}
                />
                // </div>
            )}
        </div>
    )
}

const AlbumsControls = ({ albumId, fetchAlbums }) => {
    const nav = useNavigate()
    const { galleryState, galleryDispatch }: GalleryContextT =
        useContext(GalleryContext)

    if (albumId === '') {
        return (
            <div className="flex items-center justify-between p-2 ml-3">
                <NewAlbum fetchAlbums={fetchAlbums} />
                <div className="flex items-center h-[40px] w-60 pr-6">
                    <WeblensInput
                        value={galleryState.searchContent}
                        Icon={IconSearch}
                        stealFocus={!galleryState.blockSearchFocus}
                        squareSize={40}
                        valueCallback={(v) =>
                            galleryDispatch({ type: 'set_search', search: v })
                        }
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-row w-full h-14 items-center m-2 gap-4 ml-3">
            <div className="mr-5">
                <WeblensButton
                    squareSize={40}
                    centerContent
                    Left={IconArrowLeft}
                    onClick={() => nav('/albums')}
                />
            </div>

            <Divider orientation="vertical" className="mr-5 my-1" />

            <div className="h-10 w-56">
                <div className="relative h-10 w-56 shrink-0">
                    <WeblensProgress
                        height={40}
                        value={((galleryState.imageSize - 150) / 350) * 100}
                        disabled={galleryState.selecting}
                        seekCallback={(s) => {
                            if (s === 0) {
                                s = 1
                            }
                            galleryDispatch({
                                type: 'set_image_size',
                                size: (s / 100) * 350 + 150,
                            })
                        }}
                    />
                </div>
            </div>

            <GalleryFilters />
        </div>
    )
}

function AlbumsHomeView({ fetchAlbums }: { fetchAlbums: () => void }) {
    const { galleryState, galleryDispatch } = useContext(GalleryContext)

    const albums = useMemo(() => {
        if (!galleryState) {
            return []
        }

        return Array.from(galleryState.albumsMap.values()).filter((a) =>
            a.name
                .toLowerCase()
                .includes(galleryState.searchContent.toLowerCase())
        )
        // .map((a) => {
        // if (!a.CoverMedia) {
        //     a.CoverMedia = new WeblensMedia({ contentId: a.Cover })
        // }
        //
        // return a
        // })
    }, [galleryState?.albumsMap, galleryState.searchContent])

    if (albums.length === 0 && galleryState.searchContent === '') {
        return (
            <div className="flex justify-center items-center w-full h-80 select-none">
                <div className="flex flex-col items-center w-52 gap-1">
                    <p className="w-max text-xl"> You have no albums </p>
                    <NewAlbum fetchAlbums={fetchAlbums} />
                </div>
            </div>
        )
    } else if (albums.length === 0 && galleryState.searchContent !== '') {
        return (
            <div className="flex flex-col justify-center items-center w-full h-80 select-none gap-2">
                <div className="flex items-center w-max gap-1">
                    <p className="w-max text-xl text-nowrap">
                        No albums found with
                    </p>
                    <div className="flex flex-row items-center bg-dark-paper rounded pl-1 pr-1 pt-[1px] pb-[1px] gap-1">
                        <IconSearch size={18} />
                        <p className="w-max text-xl text-nowrap">
                            {galleryState.searchContent}
                        </p>
                    </div>
                    <p className="w-max text-xl text-nowrap">in their name</p>
                </div>
                <div className="flex items-center">
                    <WeblensButton
                        label={'Clear Search'}
                        Left={IconInputX}
                        onClick={() => {
                            galleryDispatch({ type: 'set_search', search: '' })
                        }}
                    />
                    <NewAlbum fetchAlbums={fetchAlbums} />
                </div>
            </div>
        )
    } else {
        return (
            <div style={{ width: '100%', height: '100%', padding: 10 }}>
                <AlbumScroller albums={albums} />
            </div>
        )
    }
}

export function Albums({ selectedAlbum }: { selectedAlbum: string }) {
    const { galleryDispatch } = useContext(GalleryContext)

    const fetchAlbums = useCallback(() => {
        galleryDispatch({ type: 'add_loading', loading: 'albums' })
        getAlbums(true).then((val) => {
            galleryDispatch({ type: 'set_albums', albums: val })
            galleryDispatch({ type: 'remove_loading', loading: 'albums' })
        })
    }, [galleryDispatch])

    useEffect(() => {
        fetchAlbums()
    }, [])

    return (
        <>
            <AlbumsControls albumId={selectedAlbum} fetchAlbums={fetchAlbums} />
            {selectedAlbum === '' && (
                <AlbumsHomeView fetchAlbums={fetchAlbums} />
            )}
            {selectedAlbum !== '' && <AlbumContent albumId={selectedAlbum} />}
        </>
    )
}
