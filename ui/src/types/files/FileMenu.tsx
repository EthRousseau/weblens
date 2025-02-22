import {
    IconArrowLeft,
    IconDownload,
    IconFileExport,
    IconFolderPlus,
    IconLink,
    IconMinus,
    IconPencil,
    IconPhotoMinus,
    IconPhotoUp,
    IconPlus,
    IconRestore,
    IconScan,
    IconTrash,
    IconUser,
    IconUsers,
    IconUsersPlus,
} from '@tabler/icons-react'
import { FileApi, FolderApi } from '@weblens/api/FileBrowserApi'
import SharesApi from '@weblens/api/SharesApi'
import UsersApi from '@weblens/api/UserApi'
import { useWebsocketStore } from '@weblens/api/Websocket'
import { UserInfo } from '@weblens/api/swag'
import { FileFmt } from '@weblens/components/filebrowser/filename'
import SearchDialogue from '@weblens/components/filebrowser/searchDialogue'
import WeblensButton from '@weblens/lib/WeblensButton'
import WeblensInput from '@weblens/lib/WeblensInput'
import { downloadSelected } from '@weblens/pages/FileBrowser/FileBrowserLogic'
import '@weblens/pages/FileBrowser/style/fileBrowserMenuStyle.scss'
import { FbModeT, useFileBrowserStore } from '@weblens/store/FBStateControl'
import WeblensFile, {
    FbMenuModeT,
    SelectedState,
} from '@weblens/types/files/File'
import { PhotoQuality } from '@weblens/types/media/Media'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import { WeblensShare } from '@weblens/types/share/share'
import { clamp } from '@weblens/util'
import { useSessionStore } from 'components/UserInfo'
import {
    useClick,
    useKeyDown,
    useResize,
    useWindowSize,
} from 'components/hooks'
import React, {
    ReactElement,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorHandler } from 'types/Types'

import { MediaImage } from '../media/PhotoContainer'
import { activeItemsFromState } from './FileDragLogic'

type footerNote = {
    hint: string
    danger: boolean
}

const MenuTitle = () => {
    const [targetItem, setTargetItem] = useState<WeblensFile>(null)
    const menuTarget = useFileBrowserStore((state) => state.menuTargetId)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const filesMap = useFileBrowserStore((state) => state.filesMap)
    const selected = useFileBrowserStore((state) => state.selected)
    const menuMode = useFileBrowserStore((state) => state.menuMode)

    const setMenu = useFileBrowserStore((state) => state.setMenu)

    useEffect(() => {
        if (menuTarget === '') {
            setTargetItem(folderInfo)
        } else {
            setTargetItem(filesMap.get(menuTarget))
        }
    }, [menuTarget, folderInfo])

    const extrasText = useMemo(() => {
        if (selected.get(targetItem?.Id()) && selected.size > 1) {
            return `+${selected.size - 1}`
        } else {
            return ''
        }
    }, [targetItem, selected])

    return (
        <div className="file-menu-title">
            {menuMode === FbMenuModeT.NameFolder && (
                <div className="flex flex-grow absolute w-full">
                    <WeblensButton
                        Left={IconArrowLeft}
                        onClick={(e) => {
                            e.stopPropagation()
                            setMenu({ menuState: FbMenuModeT.Default })
                        }}
                    />
                </div>
            )}

            <div className="flex flex-row items-center justify-center w-full h-8 gap-1">
                <FileFmt pathName={targetItem?.portablePath} />

                {extrasText && (
                    <p className="flex w-max items-center justify-end text-xs select-none h-3">
                        {extrasText}
                    </p>
                )}
            </div>
        </div>
    )
}

const MenuFooter = ({
    footerNote,
    menuMode,
}: {
    footerNote: { hint: string; danger: boolean }
    menuMode: FbMenuModeT
}) => {
    if (!footerNote.hint || menuMode === FbMenuModeT.Closed) {
        return <></>
    }

    return (
        <div className="flex absolute flex-grow w-full justify-center h-max bottom-0 z-[100] translate-y-[120%]">
            <div
                className="footer-wrapper animate-fade"
                data-danger={footerNote.danger}
            >
                <p className="theme-text-dark-bg text-nowrap">
                    {footerNote.hint}
                </p>
            </div>
        </div>
    )
}

export function FileContextMenu() {
    const user = useSessionStore((state) => state.user)
    const [menuRef, setMenuRef] = useState<HTMLDivElement>(null)
    const [footerNote, setFooterNote] = useState<footerNote>({} as footerNote)

    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const menuPos = useFileBrowserStore((state) => state.menuPos)
    const menuTarget = useFileBrowserStore((state) => state.menuTargetId)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const pastTime = useFileBrowserStore((state) => state.pastTime)
    const activeItems = useFileBrowserStore((state) =>
        activeItemsFromState(state.filesMap, state.selected, state.menuTargetId)
    )
    const filesMap = useFileBrowserStore((state) => state.filesMap)

    const setMenu = useFileBrowserStore((state) => state.setMenu)

    useKeyDown(
        'Escape',
        (e) => {
            if (menuMode !== FbMenuModeT.Closed) {
                e.stopPropagation()
                setMenu({ menuState: FbMenuModeT.Closed })
            }
        },
        menuMode === FbMenuModeT.Closed
    )

    useClick((e: MouseEvent) => {
        if (menuMode !== FbMenuModeT.Closed && e.button === 0) {
            e.stopPropagation()
            setMenu({ menuState: FbMenuModeT.Closed })
        }
    }, menuRef)

    useEffect(() => {
        if (menuMode === FbMenuModeT.Closed) {
            setFooterNote({ hint: '', danger: false })
        }
    }, [menuMode])

    const { width, height } = useWindowSize()
    const { height: menuHeight, width: menuWidth } = useResize(menuRef)

    const menuPosStyle = useMemo(() => {
        return {
            top: clamp(
                menuPos.y,
                8 + menuHeight / 2,
                height - menuHeight / 2 - 8
            ),
            left: clamp(
                menuPos.x,
                8 + menuWidth / 2,
                width - menuWidth / 2 - 8
            ),
        }
    }, [menuPos, menuHeight, menuWidth, width, height])

    if (!folderInfo) {
        return null
    }

    const targetFile = filesMap.get(menuTarget)
    const targetMedia = useMediaStore
        .getState()
        .mediaMap.get(targetFile?.GetContentId())

    let menuBody: ReactElement
    if (user?.trashId === folderInfo.Id()) {
        menuBody = (
            <InTrashMenu
                activeItems={activeItems.items}
                setFooterNote={setFooterNote}
            />
        )
    } else if (menuMode === FbMenuModeT.Default) {
        if (pastTime.getTime() !== 0) {
            menuBody = (
                <PastFileMenu
                    setFooterNote={setFooterNote}
                    activeItems={activeItems.items}
                />
            )
        } else if (menuTarget === '') {
            menuBody = <BackdropDefaultItems setFooterNote={setFooterNote} />
        } else {
            menuBody = (
                <StandardFileMenu
                    setFooterNote={setFooterNote}
                    activeItems={activeItems}
                />
            )
        }
    } else if (menuMode === FbMenuModeT.NameFolder) {
        menuBody = <NewFolderName items={activeItems.items} />
    } else if (menuMode === FbMenuModeT.Sharing) {
        menuBody = <FileShareMenu targetFile={targetFile} />
    } else if (menuMode === FbMenuModeT.AddToAlbum) {
        // menuBody = <AddToAlbum activeItems={activeItems.items} />
    } else if (menuMode === FbMenuModeT.RenameFile) {
        menuBody = <FileRenameInput />
    } else if (menuMode === FbMenuModeT.SearchForFile) {
        const text =
            '~' +
            targetFile.portablePath.slice(
                targetFile.portablePath.indexOf('/'),
                targetFile.portablePath.lastIndexOf('/')
            )
        menuBody = (
            <div className="flex w-[50vw] h-[40vh] p-2 gap-2 menu-body-below-header items-center">
                <div className="flex grow rounded-md h-[39vh]">
                    <MediaImage
                        media={targetMedia}
                        quality={PhotoQuality.LowRes}
                    />
                </div>
                <div className="flex w-[50%] h-[39vh]">
                    <SearchDialogue
                        text={text}
                        visitFunc={(folderId: string) => {
                            FolderApi.setFolderCover(folderId, targetMedia.Id())
                                .then(() =>
                                    setMenu({ menuState: FbMenuModeT.Closed })
                                )
                                .catch((err) => {
                                    console.error(err)
                                })
                        }}
                    />
                </div>
            </div>
        )
    }

    return (
        <div
            className="backdrop-menu-wrapper"
            data-mode={menuMode}
            style={menuPosStyle}
        >
            <div
                className={'backdrop-menu'}
                data-mode={menuMode}
                ref={setMenuRef}
                onClick={(e) => {
                    e.stopPropagation()
                    setMenu({ menuState: FbMenuModeT.Closed })
                }}
            >
                <MenuTitle />
                {/* {viewingPast !== null && <div />} */}
                {menuBody}
            </div>
            <MenuFooter footerNote={footerNote} menuMode={menuMode} />
        </div>
    )
}

function StandardFileMenu({
    setFooterNote,
    activeItems,
}: {
    setFooterNote: (n: footerNote) => void
    activeItems: { items: WeblensFile[] }
}) {
    const user = useSessionStore((state) => state.user)
    const wsSend = useWebsocketStore((state) => state.wsSend)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const menuTarget = useFileBrowserStore((state) => state.menuTargetId)
    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const shareId = useFileBrowserStore((state) => state.shareId)
    const mode = useFileBrowserStore((state) => state.fbMode)

    const setMenu = useFileBrowserStore((state) => state.setMenu)
    const removeLoading = useFileBrowserStore((state) => state.removeLoading)
    const filesMap = useFileBrowserStore((state) => state.filesMap)

    const targetFile = filesMap.get(menuTarget)

    if (user.trashId === folderInfo.Id()) {
        return null
    }

    if (menuMode === FbMenuModeT.Closed) {
        return null
    }

    return (
        <div
            className={'default-grid'}
            data-visible={menuMode === FbMenuModeT.Default && menuTarget !== ''}
        >
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconPencil}
                    disabled={activeItems.items.length > 1}
                    squareSize={100}
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Rename', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        setFooterNote({ hint: '', danger: false })
                        setMenu({ menuState: FbMenuModeT.RenameFile })
                    }}
                />
            </div>
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconUsersPlus}
                    disabled={activeItems.items.length > 1}
                    squareSize={100}
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Share', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        setFooterNote({ hint: '', danger: false })
                        setMenu({ menuState: FbMenuModeT.Sharing })
                    }}
                />
            </div>
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconDownload}
                    squareSize={100}
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Download', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={async (e) => {
                        e.stopPropagation()
                        return await downloadSelected(
                            activeItems.items,
                            removeLoading,
                            wsSend,
                            shareId
                        )
                            .then(() => true)
                            .catch(() => false)
                    }}
                />
            </div>
            {/* <div className="default-menu-icon"> */}
            {/*     <WeblensButton */}
            {/*         Left={IconPhotoShare} */}
            {/*         squareSize={100} */}
            {/*         centerContent */}
            {/*         onMouseOver={() => */}
            {/*             setFooterNote({ */}
            {/*                 hint: 'Add Medias to Album', */}
            {/*                 danger: false, */}
            {/*             }) */}
            {/*         } */}
            {/*         onMouseLeave={() => */}
            {/*             setFooterNote({ hint: '', danger: false }) */}
            {/*         } */}
            {/*         onClick={(e) => { */}
            {/*             e.stopPropagation() */}
            {/*             setFooterNote({ hint: '', danger: false }) */}
            {/*             setMenu({ menuState: FbMenuModeT.AddToAlbum }) */}
            {/*         }} */}
            {/*     /> */}
            {/* </div> */}
            {folderInfo.IsModifiable() && (
                <div className="default-menu-icon">
                    <WeblensButton
                        Left={IconFolderPlus}
                        squareSize={100}
                        centerContent
                        onMouseOver={() =>
                            setFooterNote({
                                hint: 'New Folder From Selection',
                                danger: false,
                            })
                        }
                        onMouseLeave={() =>
                            setFooterNote({ hint: '', danger: false })
                        }
                        onClick={(e) => {
                            e.stopPropagation()
                            setMenu({ menuState: FbMenuModeT.NameFolder })
                        }}
                    />
                </div>
            )}
            {targetFile &&
                (!targetFile.IsFolder() || targetFile.GetContentId()) && (
                    <div className="default-menu-icon">
                        {targetFile.IsFolder() &&
                            targetFile.GetContentId() !== '' && (
                                <WeblensButton
                                    Left={IconPhotoMinus}
                                    squareSize={100}
                                    centerContent
                                    onMouseOver={() =>
                                        setFooterNote({
                                            hint: 'Remove Folder Image',
                                            danger: false,
                                        })
                                    }
                                    onMouseLeave={() =>
                                        setFooterNote({
                                            hint: '',
                                            danger: false,
                                        })
                                    }
                                    onClick={async (e) => {
                                        e.stopPropagation()
                                        return FolderApi.setFolderCover(
                                            targetFile.Id(),
                                            ''
                                        ).then(() => {
                                            setMenu({
                                                menuState: FbMenuModeT.Closed,
                                            })
                                            return true
                                        })
                                    }}
                                />
                            )}
                        {!targetFile.IsFolder() && (
                            <WeblensButton
                                Left={IconPhotoUp}
                                squareSize={100}
                                centerContent
                                disabled={targetFile.owner !== user?.username}
                                onMouseOver={() =>
                                    setFooterNote({
                                        hint: 'Set Folder Image',
                                        danger: false,
                                    })
                                }
                                onMouseLeave={() =>
                                    setFooterNote({ hint: '', danger: false })
                                }
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setMenu({
                                        menuState: FbMenuModeT.SearchForFile,
                                    })
                                }}
                            />
                        )}
                    </div>
                )}
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconScan}
                    squareSize={100}
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Scan Folder', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        activeItems.items.forEach((i) =>
                            wsSend('scanDirectory', { folderId: i.Id() })
                        )
                        setMenu({ menuState: FbMenuModeT.Closed })
                    }}
                />
            </div>
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconTrash}
                    danger
                    squareSize={100}
                    centerContent
                    disabled={
                        !folderInfo.IsModifiable() || mode === FbModeT.share
                    }
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Delete', danger: true })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={async (e) => {
                        e.stopPropagation()
                        activeItems.items.forEach((f) =>
                            f.SetSelected(SelectedState.Moved)
                        )
                        setMenu({ menuState: FbMenuModeT.Closed })
                        return FileApi.moveFiles({
                            fileIds: activeItems.items.map((f) => f.Id()),
                            newParentId: user.trashId,
                        })
                    }}
                />
            </div>
        </div>
    )
}

function PastFileMenu({
    setFooterNote,
    activeItems,
}: {
    setFooterNote: (n: footerNote) => void
    activeItems: WeblensFile[]
}) {
    const nav = useNavigate()

    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const folderId = useFileBrowserStore((state) => state.folderInfo.Id())
    const restoreTime = useFileBrowserStore((state) => state.pastTime)
    const setMenu = useFileBrowserStore((state) => state.setMenu)
    const setPastTime = useFileBrowserStore((state) => state.setPastTime)

    const canRestore = activeItems.find((f) => !f.hasRestoreMedia) === undefined

    return (
        <div
            className={'default-grid no-scrollbar'}
            data-visible={menuMode === FbMenuModeT.Default}
        >
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconRestore}
                    squareSize={100}
                    centerContent
                    disabled={!canRestore}
                    tooltip={
                        canRestore
                            ? ''
                            : 'One or more selected files are missing restore media, and cannot be recovered'
                    }
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Restore', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={async (e) => {
                        e.stopPropagation()
                        return FileApi.restoreFiles({
                            fileIds: activeItems.map((f) => f.Id()),
                            newParentId: folderId,
                            timestamp: restoreTime.getTime(),
                        }).then((res) => {
                            setFooterNote({ hint: '', danger: false })
                            setMenu({ menuState: FbMenuModeT.Closed })
                            setPastTime(new Date(0))
                            nav(`/files/${res.data.newParentId}`)
                        })
                    }}
                />
            </div>
        </div>
    )
}

function FileShareMenu({ targetFile }: { targetFile: WeblensFile }) {
    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const setMenu = useFileBrowserStore((state) => state.setMenu)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)

    const [accessors, setAccessors] = useState<string[]>([])
    const [isPublic, setIsPublic] = useState(false)
    const [share, setShare] = useState<WeblensShare>(null)

    if (!targetFile) {
        targetFile = folderInfo
    }

    useEffect(() => {
        if (!targetFile) {
            return
        }
        const setShareData = async () => {
            const share = await targetFile.GetShare()
            if (share) {
                setShare(share)
                if (share.IsPublic() !== undefined) {
                    setIsPublic(share.IsPublic())
                }
                setAccessors(share.GetAccessors())
            } else {
                setIsPublic(false)
            }
        }
        setShareData().catch((err) => {
            console.error('Failed to set share data', err)
        })
    }, [targetFile])

    const [userSearch, setUserSearch] = useState('')
    const [searchMenuOpen, setSearchMenuOpen] = useState(false)
    const [userSearchResults, setUserSearchResults] = useState<UserInfo[]>([])
    useEffect(() => {
        if (userSearch.length < 2) {
            setUserSearchResults([])
            return
        }
        UsersApi.searchUsers(userSearch)
            .then((res) => {
                setUserSearchResults(res.data ?? [])
            })
            .catch((err) => {
                console.error('Failed to search users', err)
            })
    }, [userSearch])

    useEffect(() => {
        if (menuMode !== FbMenuModeT.Sharing) {
            setUserSearch('')
            setUserSearchResults([])
        }
    }, [menuMode])

    const updateShare = useCallback(
        async (e: React.MouseEvent<HTMLElement>) => {
            e.stopPropagation()
            const share = await targetFile.GetShare()
            if (share?.Id()) {
                return await share
                    .UpdateShare(isPublic, accessors)
                    .then(() => share)
                    .catch(ErrorHandler)
            } else {
                return await SharesApi.createFileShare({
                    fileId: targetFile.Id(),
                    public: isPublic,
                    users: accessors,
                })
                    .then(async (res) => {
                        targetFile.SetShare(new WeblensShare(res.data))
                        const sh = await targetFile.GetShare()
                        return sh
                    })
                    .catch(ErrorHandler)
            }
        },
        [targetFile, isPublic, accessors, folderInfo]
    )

    if (menuMode === FbMenuModeT.Closed) {
        return <></>
    }

    return (
        <div
            className="file-share-menu"
            data-visible={menuMode === FbMenuModeT.Sharing}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex flex-row w-full">
                <div className="flex justify-center w-1/4 m-1 grow">
                    <WeblensButton
                        squareSize={40}
                        label={isPublic ? 'Public' : 'Private'}
                        allowRepeat
                        fillWidth
                        centerContent
                        toggleOn={isPublic}
                        Left={isPublic ? IconUsers : IconUser}
                        onClick={(e) => {
                            e.stopPropagation()
                            setIsPublic((p) => !p)
                        }}
                    />
                </div>
                <div className="flex justify-center w-1/4 m-1 grow">
                    <WeblensButton
                        squareSize={40}
                        label={'Copy Link'}
                        fillWidth
                        centerContent
                        Left={IconLink}
                        disabled={!isPublic && accessors.length === 0}
                        onClick={async (e) => {
                            e.stopPropagation()
                            return await updateShare(e)
                                .then(async (share) => {
                                    if (!share) {
                                        console.error('No Shares!')
                                        return false
                                    }
                                    return navigator.clipboard
                                        .writeText(share.GetPublicLink())
                                        .then(() => true)
                                        .catch((r) => {
                                            console.error(r)
                                            return false
                                        })
                                })
                                .catch((r) => {
                                    console.error(r)
                                    return false
                                })
                        }}
                    />
                </div>
            </div>
            <div className="flex flex-col w-full gap-1 items-center">
                <div className="h-10 w-full mt-3 mb-3 z-20">
                    <WeblensInput
                        value={userSearch}
                        valueCallback={setUserSearch}
                        placeholder="Add users"
                        onComplete={null}
                        Icon={IconUsersPlus}
                        openInput={() => setSearchMenuOpen(true)}
                        closeInput={() => setSearchMenuOpen(false)}
                    />
                </div>
                {userSearchResults.length !== 0 && searchMenuOpen && (
                    <div
                        className="flex flex-col w-full bg-raised-grey absolute gap-1 rounded
                                    p-1 z-10 mt-14 max-h-32 overflow-y-scroll drop-shadow-xl"
                    >
                        {userSearchResults.map((u) => {
                            return (
                                <div
                                    className="user-autocomplete-row"
                                    key={u.username}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setAccessors((p) => {
                                            const newP = [...p]
                                            newP.push(u.username)
                                            return newP
                                        })
                                        setUserSearchResults((p) => {
                                            const newP = [...p]
                                            newP.splice(newP.indexOf(u), 1)
                                            return newP
                                        })
                                    }}
                                >
                                    <p>{u.username}</p>
                                    <IconPlus />
                                </div>
                            )
                        })}
                    </div>
                )}
                <p className="text-white">Shared With</p>
            </div>
            <div
                className="flex flex-row w-full h-full p-2 m-2 mt-0 rounded
                            outline outline-main-accent justify-center"
            >
                {accessors.length === 0 && <p>Not Shared</p>}
                {accessors.length !== 0 &&
                    accessors.map((u: string) => {
                        return (
                            <div key={u} className="user-autocomplete-row">
                                <p>{u}</p>
                                <div className="user-minus-button">
                                    <WeblensButton
                                        squareSize={40}
                                        Left={IconMinus}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setAccessors((p) => {
                                                const newP = [...p]
                                                newP.splice(newP.indexOf(u), 1)
                                                return newP
                                            })
                                        }}
                                    />
                                </div>
                            </div>
                        )
                    })}
            </div>
            <div className="flex flex-row w-full">
                <div className="flex justify-center w-1/4 m-1 grow">
                    <WeblensButton
                        squareSize={40}
                        centerContent
                        label="Back"
                        fillWidth
                        Left={IconArrowLeft}
                        onClick={(e) => {
                            e.stopPropagation()
                            setMenu({ menuState: FbMenuModeT.Default })
                        }}
                    />
                </div>
                <div className="flex justify-center w-1/4 m-1 grow">
                    <WeblensButton
                        squareSize={40}
                        centerContent
                        fillWidth
                        label="Save"
                        disabled={
                            share &&
                            share.IsPublic() === isPublic &&
                            accessors === share.GetAccessors()
                        }
                        onClick={(e) =>
                            updateShare(e)
                                .then(() => true)
                                .catch(ErrorHandler)
                        }
                    />
                </div>
            </div>
        </div>
    )
}

function NewFolderName({ items }: { items: WeblensFile[] }) {
    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const shareId = useFileBrowserStore((state) => state.shareId)
    const [newName, setNewName] = useState('')

    const setMenu = useFileBrowserStore((state) => state.setMenu)
    const setMoved = useFileBrowserStore((state) => state.setSelectedMoved)

    const badName = useMemo(() => {
        if (newName.includes('/')) {
            return true
        }

        return false
    }, [newName])

    if (menuMode !== FbMenuModeT.NameFolder) {
        return <></>
    }

    return (
        <div className="new-folder-menu">
            <WeblensInput
                placeholder="New Folder Name"
                autoFocus
                fillWidth
                squareSize={60}
                buttonIcon={IconPlus}
                failed={badName}
                valueCallback={setNewName}
                onComplete={async (newName) => {
                    const itemIds = items.map((f) => f.Id())
                    setMoved(itemIds)
                    await FolderApi.createFolder(
                        {
                            parentFolderId: folderInfo.Id(),
                            newFolderName: newName,
                            children: itemIds,
                        },
                        shareId
                    )
                    setMenu({ menuState: FbMenuModeT.Closed })
                }}
            />
        </div>
    )
}

function FileRenameInput() {
    const menuTarget = useFileBrowserStore((state) =>
        state.filesMap.get(state.menuTargetId)
    )
    const shareId = useFileBrowserStore((state) => state.shareId)

    const setMenu = useFileBrowserStore((state) => state.setMenu)

    return (
        <div className="new-folder-menu">
            <WeblensInput
                value={menuTarget.GetFilename()}
                placeholder="Rename File"
                autoFocus
                fillWidth
                squareSize={50}
                buttonIcon={IconPlus}
                onComplete={async (newName) => {
                    return FileApi.updateFile(
                        menuTarget.Id(),
                        {
                            newName: newName,
                        },
                        shareId
                    ).then(() => {
                        setMenu({ menuState: FbMenuModeT.Closed })
                        return true
                    })
                }}
            />
            <div className="w-[220px]"></div>
        </div>
    )
}

// function AlbumCover({
//     a,
//     medias,
//     refetch,
// }: {
//     a: AlbumInfo
//     medias: string[]
//     refetch: () => Promise<QueryObserverResult<MediaInfo[], Error>>
// }) {
//     const hasAll = medias?.filter((v) => !a.medias?.includes(v)).length === 0
//
//     return (
//         <div
//             className="h-max w-max"
//             key={a.id}
//             onClick={(e) => {
//                 e.stopPropagation()
//                 if (hasAll) {
//                     return
//                 }
//                 AlbumsApi.updateAlbum(a.id, undefined, undefined, medias)
//                     .then(() => refetch())
//                     .catch(ErrorHandler)
//             }}
//         >
//             <MiniAlbumCover
//                 album={a}
//                 disabled={!medias || medias.length === 0 || hasAll}
//             />
//         </div>
//     )
// }

// function AddToAlbum({ activeItems }: { activeItems: WeblensFile[] }) {
//     const [newAlbum, setNewAlbum] = useState(false)
//
//     const { data: albums } = useQuery<AlbumInfo[]>({
//         queryKey: ['albums'],
//         initialData: [],
//         queryFn: () =>
//             AlbumsApi.getAlbums().then((res) =>
//                 res.data.sort((a, b) => {
//                     return a.name.localeCompare(b.name)
//                 })
//             ),
//     })
//
//     const menuMode = useFileBrowserStore((state) => state.menuMode)
//     const setMenu = useFileBrowserStore((state) => state.setMenu)
//     const addMedias = useMediaStore((state) => state.addMedias)
//     const getMedia = useMediaStore((state) => state.getMedia)
//
//     useEffect(() => {
//         setNewAlbum(false)
//     }, [menuMode])
//
//     useEffect(() => {
//         const newMediaIds: string[] = []
//         for (const album of albums) {
//             if (album.cover && !getMedia(album.cover)) {
//                 newMediaIds.push(album.cover)
//             }
//         }
//         if (newMediaIds) {
//             MediaApi.getMedia(
//                 true,
//                 true,
//                 undefined,
//                 undefined,
//                 undefined,
//                 undefined,
//                 JSON.stringify(newMediaIds)
//             )
//                 .then((res) => {
//                     const medias = res.data.Media.map(
//                         (mediaParam) => new WeblensMedia(mediaParam)
//                     )
//                     addMedias(medias)
//                 })
//                 .catch((err) => {
//                     console.error(err)
//                 })
//         }
//     }, [albums.length])
//
//     const {
//         data: medias,
//         isLoading,
//         refetch,
//     } = useQuery<MediaInfo[]>({
//         queryKey: ['selected-medias', activeItems.map((i) => i.Id()), menuMode],
//         initialData: [],
//         queryFn: () => {
//             if (menuMode !== FbMenuModeT.AddToAlbum) {
//                 return [] as MediaInfo[]
//             }
//             return MediaApi.getMedia(
//                 true,
//                 true,
//                 undefined,
//                 undefined,
//                 undefined,
//                 JSON.stringify(activeItems.map((i) => i.Id()))
//             ).then((res) => res.data.Media)
//         },
//     })
//
//     if (menuMode !== FbMenuModeT.AddToAlbum) {
//         return <></>
//     }
//
//     return (
//         <div className="add-to-album-menu">
//             {medias && medias.length !== 0 && (
//                 <p className="animate-fade">
//                     Add {medias.length} media to Albums
//                 </p>
//             )}
//             {medias && medias.length === 0 && (
//                 <p className="animate-fade">No valid media selected</p>
//             )}
//             {isLoading && <p className="animate-fade">Loading media...</p>}
//             <div className="no-scrollbar grid grid-cols-2 gap-3 h-max max-h-[350px] overflow-y-scroll pt-1">
//                 {albums.map((a) => {
//                     return (
//                         <AlbumCover
//                             key={a.name}
//                             a={a}
//                             medias={medias.map((m) => m.contentId)}
//                             refetch={refetch}
//                         />
//                     )
//                 })}
//             </div>
//             {newAlbum && (
//                 <WeblensInput
//                     squareSize={40}
//                     autoFocus
//                     closeInput={() => setNewAlbum(false)}
//                     onComplete={async (v: string) =>
//                         AlbumsApi.createAlbum(v)
//                             .then(() => refetch())
//                             .then(() => {
//                                 setNewAlbum(false)
//                             })
//                     }
//                 />
//             )}
//             {!newAlbum && (
//                 <WeblensButton
//                     fillWidth
//                     label={'New Album'}
//                     Left={IconLibraryPlus}
//                     centerContent
//                     onClick={(e) => {
//                         e.stopPropagation()
//                         setNewAlbum(true)
//                     }}
//                 />
//             )}
//             <WeblensButton
//                 fillWidth
//                 label={'Back'}
//                 Left={IconArrowLeft}
//                 centerContent
//                 onClick={(e) => {
//                     e.stopPropagation()
//                     setMenu({ menuState: FbMenuModeT.Default })
//                 }}
//             />
//         </div>
//     )
// }

function InTrashMenu({
    activeItems,
    setFooterNote,
}: {
    activeItems: WeblensFile[]
    setFooterNote: (n: footerNote) => void
}) {
    const user = useSessionStore((state) => state.user)

    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const menuTarget = useFileBrowserStore((state) => state.menuTargetId)
    const filesList = useFileBrowserStore((state) => state.filesLists)

    const setMenu = useFileBrowserStore((state) => state.setMenu)
    const setSelectedMoved = useFileBrowserStore(
        (state) => state.setSelectedMoved
    )

    if (user.trashId !== folderInfo.Id()) {
        return <></>
    }

    return (
        <div className="default-grid no-scrollbar">
            <WeblensButton
                squareSize={100}
                Left={IconFileExport}
                centerContent
                disabled={menuTarget === ''}
                onMouseOver={() =>
                    setFooterNote({ hint: 'Put Back', danger: false })
                }
                onMouseLeave={() => setFooterNote({ hint: '', danger: false })}
                onClick={async (e) => {
                    e.stopPropagation()
                    const ids = activeItems.map((f) => f.Id())
                    setSelectedMoved(ids)
                    setMenu({ menuState: FbMenuModeT.Closed })
                    return FileApi.unTrashFiles({
                        fileIds: ids,
                    })
                }}
            />
            <WeblensButton
                squareSize={100}
                Left={IconTrash}
                centerContent
                danger
                disabled={menuTarget === '' && filesList.size === 0}
                onMouseOver={() =>
                    setFooterNote({
                        hint:
                            menuTarget === ''
                                ? 'Empty Trash'
                                : 'Delete Permanently',
                        danger: true,
                    })
                }
                onMouseLeave={() => setFooterNote({ hint: '', danger: false })}
                onClick={async (e) => {
                    e.stopPropagation()
                    let toDeleteIds: string[]
                    if (menuTarget === '') {
                        toDeleteIds = filesList
                            .get(user.trashId)
                            .map((f) => f.Id())
                    } else {
                        toDeleteIds = activeItems.map((f) => f.Id())
                    }
                    setSelectedMoved(toDeleteIds)
                    setMenu({ menuState: FbMenuModeT.Closed })
                    return FileApi.deleteFiles({
                        fileIds: toDeleteIds,
                    })
                }}
            />
        </div>
    )
}

function BackdropDefaultItems({
    setFooterNote,
}: {
    setFooterNote: (n: footerNote) => void
}) {
    const user = useSessionStore((state) => state.user)

    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const menuTarget = useFileBrowserStore((state) => state.menuTargetId)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const shareId = useFileBrowserStore((state) => state.shareId)
    const wsSend = useWebsocketStore((state) => state.wsSend)

    const setMenu = useFileBrowserStore((state) => state.setMenu)

    if (menuMode === FbMenuModeT.Closed) {
        return <></>
    }

    return (
        <div
            className="default-grid"
            data-visible={menuMode === FbMenuModeT.Default && menuTarget === ''}
        >
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconFolderPlus}
                    squareSize={100}
                    centerContent
                    disabled={!folderInfo.IsModifiable()}
                    onMouseOver={() =>
                        setFooterNote({ hint: 'New Folder', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        setFooterNote({ hint: '', danger: false })
                        setMenu({ menuState: FbMenuModeT.NameFolder })
                    }}
                />
            </div>
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconUsersPlus}
                    squareSize={100}
                    disabled={
                        folderInfo.Id() === user.homeId ||
                        folderInfo.Id() === user.trashId
                    }
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Share', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        setMenu({ menuState: FbMenuModeT.Sharing })
                        setFooterNote({ hint: '', danger: false })
                    }}
                />
            </div>
            <div className="default-menu-icon">
                <WeblensButton
                    Left={IconScan}
                    squareSize={100}
                    centerContent
                    onMouseOver={() =>
                        setFooterNote({ hint: 'Scan Folder', danger: false })
                    }
                    onMouseLeave={() =>
                        setFooterNote({ hint: '', danger: false })
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        wsSend('scanDirectory', {
                            folderId: folderInfo.Id(),
                            shareId: shareId,
                        })
                    }}
                />
            </div>
        </div>
    )
}
