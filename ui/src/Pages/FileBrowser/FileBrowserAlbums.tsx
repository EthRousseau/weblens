import {
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import {
    Box,
    Divider,
    Input,
    Loader,
    Text,
    TextInput,
    Tooltip,
    TooltipFloating,
} from '@mantine/core'
import {
    IconExternalLink,
    IconPhoto,
    IconPlus,
    IconSearch,
    IconUsersGroup,
} from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'

import { AddMediaToAlbum, CreateAlbum, GetAlbums } from '../../api/GalleryApi'
import { MediaImage } from '../../components/PhotoContainer'
import { AlbumData, AuthHeaderT, UserContextT } from '../../types/Types'
import { RowBox } from './FileBrowserStyles'
import { UserContext } from '../../Context'
import { VariableSizeList } from 'react-window'
import { GetMediasByFolder } from '../../api/FileBrowserApi'
import WeblensMedia from '../../classes/Media'

const useEnter = (cb) => {
    const onEnter = useCallback(
        (e) => {
            if (e.key === 'Enter') {
                cb()
            }
        },
        [cb]
    )

    useEffect(() => {
        document.addEventListener('keydown', onEnter)
        return () => {
            document.removeEventListener('keydown', onEnter)
        }
    }, [onEnter])
}

function NewAlbum({
    refreshAlbums,
}: {
    refreshAlbums: (doLoading: boolean) => Promise<void>
}) {
    const { authHeader }: UserContextT = useContext(UserContext)

    const [newAlbumName, setNewAlbumName] = useState(null)
    const [loading, setLoading] = useState(false)

    const create = useCallback(() => {
        setLoading(true)
        CreateAlbum(newAlbumName, authHeader).then(() => {
            refreshAlbums(false).then(() => setNewAlbumName(null))
            setLoading(false)
        })
    }, [newAlbumName, authHeader, refreshAlbums])

    useEnter(create)

    return (
        <Box
            className="album-preview-row"
            style={{ height: '40px', margin: 0 }}
            onClick={() => {
                if (newAlbumName === null) {
                    setNewAlbumName('')
                }
            }}
        >
            {loading && (
                <Box
                    className="album-preview-loading"
                    onClick={(e) => {
                        e.stopPropagation()
                    }}
                />
            )}
            {(newAlbumName == null && (
                <div className="flex flex-row w-full justify-center">
                    <IconPlus />
                    <Text size="16px" style={{ paddingLeft: 10 }}>
                        New Album
                    </Text>
                </div>
            )) || (
                <div className="flex flex-row w-full justify-center">
                    <div
                        className="media-placeholder"
                        style={{ height: '50px', width: '50px' }}
                    >
                        <IconPhoto />
                    </div>
                    <TextInput
                        variant="unstyled"
                        size="16px"
                        autoFocus
                        onBlur={() => {
                            if (!newAlbumName) {
                                setNewAlbumName(null)
                            }
                        }}
                        placeholder="Album name"
                        value={newAlbumName}
                        onChange={(e) => setNewAlbumName(e.target.value)}
                        styles={{ input: { height: '30px' } }}
                        style={{ lineHeight: 20, width: '100%' }}
                    />
                </div>
            )}
        </Box>
    )
}

const SingleAlbum = memo(
    ({
        album,
        setMediaCallback,
        PartialApiCall,
        disabled = false,
    }: {
        album: AlbumData
        setMediaCallback: (
            mediaId: string,
            quality: 'thumbnail' | 'fullres',
            data: ArrayBuffer
        ) => void
        PartialApiCall: (albumId: string) => void
        disabled?: boolean
    }) => {
        const { usr }: UserContextT = useContext(UserContext)
        return (
            <Box
                className="album-preview-row"
                style={{
                    cursor: disabled ? 'default' : 'pointer',
                    backgroundColor: disabled ? '#00000000' : '',
                }}
                onClick={(e) => {
                    if (disabled) {
                        e.stopPropagation()
                        return
                    }
                    PartialApiCall(album.Id)
                }}
            >
                <MediaImage
                    media={album.CoverMedia}
                    quality="thumbnail"
                    expectFailure={album.Cover === ''}
                    containerStyle={{
                        borderRadius: '5px',
                        overflow: 'hidden',
                        width: '65px',
                        height: '65px',
                    }}
                    disabled={disabled}
                />
                <RowBox
                    style={{
                        width: '235px',
                        justifyContent: 'space-evenly',
                        flexGrow: 0,
                    }}
                >
                    <Box
                        style={{
                            height: 'max-content',
                            width: '50%',
                            alignItems: 'flex-start',
                            flexGrow: 1,
                        }}
                    >
                        <Box
                            style={{
                                display: 'flex',
                                flexGrow: 0,
                                width: 'max-content',
                                maxWidth: '100%',
                                alignItems: 'center',
                                paddingBottom: '10px',
                            }}
                        >
                            <Tooltip
                                disabled={disabled}
                                openDelay={200}
                                label={album.Name}
                            >
                                <Text
                                    c={disabled ? '#777777' : 'white'}
                                    size="16px"
                                    fw={disabled ? 450 : 550}
                                    truncate="end"
                                    styles={{ root: { width: '100%' } }}
                                >
                                    {album.Name}
                                </Text>
                            </Tooltip>
                            {album.Owner !== usr.username && (
                                <Tooltip label={`Shared by ${album.Owner}`}>
                                    <IconUsersGroup
                                        color={disabled ? '#777777' : 'white'}
                                        size={'20px'}
                                        style={{ marginLeft: 10 }}
                                    />
                                </Tooltip>
                            )}
                        </Box>
                        <RowBox>
                            <RowBox>
                                <IconPhoto
                                    color={disabled ? '#777777' : 'white'}
                                    size={'15px'}
                                />
                                <Text
                                    size="15px"
                                    c={disabled ? '#777777' : 'white'}
                                    style={{ paddingLeft: 5 }}
                                >
                                    {album.Medias.length}
                                </Text>
                            </RowBox>
                        </RowBox>
                    </Box>
                    <RowBox
                        style={{
                            position: 'absolute',
                            width: 'max-content',
                            alignItems: 'flex-end',
                            justifyContent: 'flex-end',
                            padding: 4,
                            right: 0,
                            cursor: 'pointer',
                        }}
                    >
                        <TooltipFloating position="right" label="Open Album">
                            <IconExternalLink
                                size={'15px'}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.open(`/albums/${album.Id}`, '_blank')
                                }}
                                onMouseOver={(e) => {
                                    e.stopPropagation()
                                }}
                            />
                        </TooltipFloating>
                    </RowBox>
                </RowBox>
            </Box>
        )
    },
    (prev, next) => {
        if (prev.disabled !== next.disabled) {
            return false
        }

        return false
    }
)

const fetchAlbums = (doLoading, setLoading, setAlbums, authHeader) => {
    if (authHeader.Authorization === '') {
        return
    }
    if (doLoading) {
        setLoading(true)
    }

    return GetAlbums(authHeader).then((ret) => {
        setAlbums((prev: AlbumData[]) => {
            if (!prev) {
                ret = ret.map((a) => {
                    a.CoverMedia = new WeblensMedia({ mediaId: a.Cover })
                    return a
                })
                return ret
            }
            const prevIds = prev.map((v) => v.Id)
            for (const album of ret) {
                const i = prevIds.indexOf(album.Id)
                if (i !== -1) {
                    const mediaSave = prev[i].CoverMedia
                    prev[i] = album
                    prev[i].CoverMedia = mediaSave
                    prev[i].CoverMedia = new WeblensMedia({
                        mediaId: album.Cover,
                    })
                } else {
                    if (!album.CoverMedia) {
                        album.CoverMedia = new WeblensMedia({
                            mediaId: album.Cover,
                        })
                    }
                    prev.push(album)
                }
            }
            return [...prev]
        })
        setLoading(false)
    })
}

const AlbumsHeader = ({ allMedias }) => {
    if (allMedias.length === 0) {
        return (
            <Text size="20px" style={{ padding: 10 }}>
                No valid media selected
            </Text>
        )
    } else {
        return (
            <Text size="20px" style={{ paddingBottom: 10 }}>
                Add {allMedias.length} item
                {allMedias.length === 1 ? '' : 's'} to albums
            </Text>
        )
    }
}

export const AlbumScoller = memo(
    ({
        selectedMedia,
        selectedFolders,
        authHeader,
    }: {
        selectedMedia: string[]
        selectedFolders: string[]
        authHeader: AuthHeaderT
    }) => {
        const [albums, setAlbums]: [albums: AlbumData[], setAlbums: any] =
            useState(null)
        const scrollBoxRef = useRef(null)
        // This is for the state if we are waiting for the list of albums
        const [loading, setLoading] = useState(false)
        const [searchStr, setSearchStr] = useState('')
        const [allMedias, setAllMedias] = useState([])

        // This is for tracking which album(s) are waiting
        // for results of adding media... naming is hard
        const [loadingAlbums, setLoadingAlbums] = useState([])

        const addMediaApiCall = useCallback(
            (albumId: string) => {
                setLoadingAlbums((cur) => [...cur, albumId])
                AddMediaToAlbum(
                    albumId,
                    selectedMedia,
                    selectedFolders,
                    authHeader
                )
                    .then((res) => {
                        if (res.errors.length === 0) {
                            setLoadingAlbums((cur) =>
                                cur.filter((v) => v !== albumId)
                            )
                            fetchAlbums(
                                false,
                                setLoading,
                                setAlbums,
                                authHeader
                            )
                            if (res.addedCount === 0) {
                                notifications.show({
                                    message: `No new media to add to album`,
                                    color: 'orange',
                                })
                            } else {
                                notifications.show({
                                    message: `Added ${res.addedCount} medias to album`,
                                    color: 'green',
                                })
                            }
                        } else {
                            Promise.reject(res.errors)
                        }
                    })
                    .catch((r) => {
                        notifications.show({
                            title: 'Could not add media to album',
                            message: String(r),
                            color: 'red',
                        })
                    })
            },
            [selectedMedia, authHeader]
        )

        const setMediaCallback = useCallback(
            (
                mediaId: string,
                quality: 'thumbnail' | 'fullres',
                data: ArrayBuffer
            ) => {
                setAlbums((prev: AlbumData[]) => {
                    const mediaIds = prev.map((a) => a.Cover)
                    const i = mediaIds.indexOf(mediaId)
                    if (i === -1) {
                        return prev
                    }

                    if (!prev[i].CoverMedia) {
                        prev[i].CoverMedia = new WeblensMedia({
                            mediaId: mediaId,
                        })
                    }
                    prev[i].CoverMedia[quality] = data
                    return [...prev]
                })
            },
            []
        )

        useEffect(() => {
            fetchAlbums(true, setLoading, setAlbums, authHeader)
        }, [authHeader])

        useEffect(() => {
            const tmpMs = []
            selectedFolders.forEach((f) =>
                GetMediasByFolder(f, authHeader).then((v) =>
                    setAllMedias((p) => [...p, ...v.medias])
                )
            )
            tmpMs.push(...selectedMedia)
            setAllMedias(tmpMs)
        }, [selectedMedia, selectedFolders, authHeader])

        const filteredAlbums = useMemo(
            () =>
                albums?.filter((a) => a.Name.toLowerCase().includes(searchStr)),
            [albums, searchStr]
        )

        return (
            <Box style={{ maxHeight: 660, height: 'max-content', width: 320 }}>
                <AlbumsHeader allMedias={allMedias} />
                <Input
                    className="weblens-input-wrapper"
                    variant="unstyled"
                    value={searchStr}
                    onChange={(e) => setSearchStr(e.target.value.toLowerCase())}
                    placeholder="Find an album"
                    leftSection={
                        <IconSearch
                            color="#cccccc"
                            size={'18px'}
                            // style={{ marginLeft: 8 }}
                        />
                    }
                    classNames={{ input: 'album-search' }}
                    style={{
                        width: '100%',
                        paddingLeft: '0px',
                        boxShadow: '0px 0px 0px 0px #00000000',
                        backgroundColor: '#00000000',
                    }}
                />
                <NewAlbum
                    refreshAlbums={(l: boolean) =>
                        fetchAlbums(l, setLoading, setAlbums, authHeader)
                    }
                />
                <Divider my={10} w={'100%'} />
                {loading && (
                    <Loader
                        color="white"
                        style={{ height: 'max-content', padding: 20 }}
                    />
                )}
                <VariableSizeList
                    className="no-scrollbar"
                    ref={scrollBoxRef}
                    itemCount={
                        filteredAlbums?.length ? filteredAlbums.length : 0
                    }
                    itemSize={(i) => 75}
                    itemData={filteredAlbums}
                    height={
                        75 * filteredAlbums?.length < 500
                            ? 75 * filteredAlbums.length
                            : 500
                    }
                    width={'100%'}
                    itemKey={(index: number, data: AlbumData[]) =>
                        data[index]?.Id
                    }
                >
                    {({ data, index, style }) =>
                        AlbumRowWrap(
                            data,
                            index,
                            style,
                            allMedias,
                            loadingAlbums,
                            setMediaCallback,
                            addMediaApiCall,
                            authHeader
                        )
                    }
                </VariableSizeList>
            </Box>
        )
    },
    (prev, next) => {
        if (prev.selectedMedia !== next.selectedMedia) {
            return false
        }
        if (prev.selectedFolders !== next.selectedFolders) {
            return false
        }

        return true
    }
)

const AlbumRowWrap = (
    data: AlbumData[],
    index: number,
    style,
    allMedias: string[],
    loadingAlbums,
    setMediaCallback,
    create,
    authHeader: AuthHeaderT
) => {
    const disabled = allMedias.every((m) => data[index].Medias.includes(m))
    return (
        <Box style={style}>
            <SingleAlbum
                setMediaCallback={setMediaCallback}
                album={data[index]}
                PartialApiCall={create}
                disabled={disabled || loadingAlbums.includes(data[index].Id)}
            />
        </Box>
    )
}
