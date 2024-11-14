import {
    downloadSingleFile,
    FileApi,
    FolderApi,
    SubToTask,
} from '@weblens/api/FileBrowserApi'

import Upload, { fileUploadMetadata } from '@weblens/api/Upload'
import { DraggingStateT } from '@weblens/types/files/FBTypes'
import { FbMenuModeT, WeblensFile } from '@weblens/types/files/File'
import { DragEvent, useCallback, useEffect } from 'react'

import {
    FbModeT,
    useFileBrowserStore,
} from '@weblens/pages/FileBrowser/FBStateControl'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import { PhotoQuality } from '@weblens/types/media/Media'
import { DirViewModeT } from './FileBrowserTypes'
import User from '@weblens/types/user/User'
import { ErrorHandler } from '@weblens/types/Types'
import { WsSendT } from '@weblens/api/Websocket'

export function getRealId(contentId: string, mode: FbModeT, usr: User) {
    if (mode === FbModeT.stats && contentId === 'external') {
        return 'EXTERNAL'
    }

    if (contentId === 'home') {
        return usr.homeId
    } else if (contentId === 'trash') {
        return usr.trashId
    } else if (!contentId) {
        return ''
    } else {
        return contentId
    }
}

export const handleDragOver = (
    event: DragEvent,
    setDragging: (dragging: DraggingStateT) => void,
    dragging: number
) => {
    event.preventDefault()
    event.stopPropagation()

    if (event.type === 'dragenter' || event.type === 'dragover') {
        if (!dragging) {
            setDragging(DraggingStateT.ExternalDrag)
        }
    } else {
        setDragging(DraggingStateT.NoDrag)
    }
}

export const handleRename = (
    itemId: string,
    newName: string,
    addLoading: (loading: string) => void,
    removeLoading: (loading: string) => void
) => {
    addLoading('renameFile')
    FileApi.updateFile(itemId, { newName: newName })
        .then(() => removeLoading('renameFile'))
        .catch(ErrorHandler)
}

async function addDir(
    fsEntry: FileSystemEntry,
    parentFolderId: string,
    topFolderKey: string,
    rootFolderId: string,
    isPublic: boolean,
    shareId: string
): Promise<fileUploadMetadata[]> {
    if (fsEntry instanceof FileSystemDirectoryEntry) {
        const res = await FolderApi.createFolder(
            {
                parentFolderId: parentFolderId,
                newFolderName: fsEntry.name,
            },
            shareId
        )
        const folderId = res.data.id
        if (!folderId) {
            return Promise.reject(
                new Error('Failed to create folder: no folderId')
            )
        }
        let e: fileUploadMetadata = null
        if (!topFolderKey) {
            topFolderKey = folderId
            e = {
                entry: fsEntry,
                isDir: true,
                folderId: folderId,
                parentId: rootFolderId,
                isTopLevel: true,
                topLevelParentKey: null,
            }
        }

        const dirReader = fsEntry.createReader()
        const allEntries: FileSystemEntry[] = []
        dirReader.readEntries((entries) => {
            allEntries.push(...entries)
        })
        // const entriesPromise = new Promise((resolve: (value) => void) => {
        //     const allEntries = []
        //
        //     const reader = (callback) => (entries) => {
        //         if (entries.length === 0) {
        //             resolve(allEntries)
        //             return
        //         }
        //
        //         for (const entry of entries) {
        //             allEntries.push(entry)
        //         }
        //
        //         if (entries.length !== 100) {
        //             resolve(allEntries)
        //             return
        //         }
        //         const entries = []
        //         dirReader.readEntries(callback(callback))
        //     }
        //
        //     dirReader.readEntries(reader(reader))
        // })

        const allResults: fileUploadMetadata[] = []
        if (e !== null) {
            allResults.push(e)
        }
        for (const entry of allEntries) {
            allResults.push(
                ...(await addDir(
                    entry,
                    folderId,
                    topFolderKey,
                    rootFolderId,
                    isPublic,
                    shareId
                ))
            )
        }
        return allResults
    } else if (fsEntry instanceof FileSystemFileEntry) {
        if (fsEntry.name === '.DS_Store') {
            return []
        }
        const e: fileUploadMetadata = {
            entry: fsEntry,
            parentId: parentFolderId,
            isDir: false,
            isTopLevel: parentFolderId === rootFolderId,
            topLevelParentKey: topFolderKey,
        }
        return [e]
    } else {
        console.error('Entry is not a file or directory')
        return []
    }
}

export async function HandleDrop(
    items: DataTransferItemList,
    rootFolderId: string,
    conflictNames: string[],
    isPublic: boolean,
    shareId: string
) {
    const files: fileUploadMetadata[] = []
    const topLevels = []
    if (items) {
        // Handle Directory
        for (const entry of items) {
            if (!entry) {
                console.error('Upload entry does not exist or is not a file')
                continue
            }
            const file = entry.webkitGetAsEntry()
            if (!file) {
                console.error('Drop is not a file')
                continue
            }
            if (conflictNames.includes(file.name)) {
                continue
            }
            topLevels.push(
                addDir(
                    file,
                    rootFolderId,
                    null,
                    rootFolderId,
                    isPublic,
                    shareId
                )
                    .then((newFiles) => {
                        files.push(...newFiles)
                    })
                    .catch((r) => {
                        console.error(r)
                    })
            )
        }
    }

    await Promise.all(topLevels)

    if (files.length !== 0) {
        Upload(files, isPublic, shareId, rootFolderId).catch(ErrorHandler)
    }
}

export function HandleUploadButton(
    files: File[],
    parentFolderId: string,
    isPublic: boolean,
    shareId: string
) {
    const uploads: fileUploadMetadata[] = []
    for (const f of files) {
        uploads.push({
            file: f,
            parentId: parentFolderId,
            isDir: false,
            isTopLevel: true,
            topLevelParentKey: parentFolderId,
        })
    }

    if (uploads.length !== 0) {
        Upload(uploads, isPublic, shareId, parentFolderId).catch(ErrorHandler)
    }
}

export async function downloadSelected(
    files: WeblensFile[],
    removeLoading: (loading: string) => void,
    wsSend: WsSendT,
    shareId?: string
) {
    if (files.length === 1 && !files[0].IsFolder()) {
        return downloadSingleFile(
            files[0].Id(),
            files[0].GetFilename(),
            false,
            shareId
        )
    }

    return FileApi.createTakeout(
        { fileIds: files.map((f) => f.Id()) },
        shareId
    ).then((res) => {
        if (res.status === 200) {
            downloadSingleFile(
                res.data.takeoutId,
                res.data.filename,
                true,
                shareId
            ).catch(ErrorHandler)
        } else if (res.status === 202) {
            SubToTask(res.data.taskId, ['takeoutId'], wsSend)
        }
        removeLoading('zipCreate')
    })
}

export const useKeyDownFileBrowser = () => {
    const blockFocus = useFileBrowserStore((state) => state.blockFocus)
    const presentingId = useFileBrowserStore((state) => state.presentingId)
    const setPresentationTarget = useFileBrowserStore(
        (state) => state.setPresentationTarget
    )
    const lastSelected = useFileBrowserStore((state) => state.lastSelectedId)
    const searchContent = useFileBrowserStore((state) => state.searchContent)
    const isSearching = useFileBrowserStore((state) => state.isSearching)
    const menuMode = useFileBrowserStore((state) => state.menuMode)
    const viewMode = useFileBrowserStore((state) => state.viewOpts.dirViewMode)
    const folderInfo = useFileBrowserStore((state) => state.folderInfo)
    const filesMap = useFileBrowserStore((state) => state.filesMap)
    const filesLists = useFileBrowserStore((state) => state.filesLists)
    const mediaMap = useMediaStore((state) => state.mediaMap)

    const presentingTarget = filesMap.get(presentingId)

    const selectAll = useFileBrowserStore((state) => state.selectAll)
    const setIsSearching = useFileBrowserStore((state) => state.setIsSearching)
    const clearSelected = useFileBrowserStore((state) => state.clearSelected)
    const setHoldingShift = useFileBrowserStore(
        (state) => state.setHoldingShift
    )
    const setPresentation = useFileBrowserStore(
        (state) => state.setPresentationTarget
    )

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault()
                event.stopPropagation()
                setIsSearching(!isSearching)
            }
            if (!blockFocus) {
                if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
                    event.preventDefault()
                    selectAll()
                } else if (
                    !event.metaKey &&
                    (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                ) {
                    event.preventDefault()
                    if (
                        viewMode === DirViewModeT.Columns ||
                        !presentingTarget
                    ) {
                        return
                    }
                    let direction = 0
                    if (event.key === 'ArrowLeft') {
                        direction = -1
                    } else if (event.key === 'ArrowRight') {
                        direction = 1
                    }
                    const newTarget = filesLists.get(folderInfo.Id())[
                        presentingTarget.GetIndex() + direction
                    ]
                    if (!newTarget) {
                        return
                    }
                    setPresentationTarget(newTarget.Id())

                    const onDeck = filesLists.get(folderInfo.Id())[
                        presentingTarget.GetIndex() + direction * 2
                    ]
                    if (onDeck) {
                        const m = mediaMap.get(onDeck.GetContentId())
                        if (m && !m.HasQualityLoaded(PhotoQuality.HighRes)) {
                            m.LoadBytes(PhotoQuality.HighRes).catch(
                                ErrorHandler
                            )
                        }
                    }
                } else if (
                    event.key === 'Escape' &&
                    menuMode === FbMenuModeT.Closed &&
                    presentingId === ''
                ) {
                    event.preventDefault()
                    clearSelected()
                } else if (event.key === 'Shift') {
                    setHoldingShift(true)
                } else if (event.key === 'Enter') {
                    if (!folderInfo.IsModifiable()) {
                        console.error(
                            'This folder does not allow paste-to-upload'
                        )
                        return
                    }
                    // uploadViaUrl(
                    //     fbState.pasteImg,
                    //     folderInfo.Id(),
                    //     filesList,
                    //     auth,
                    //     wsSend
                    // )
                } else if (event.key === ' ') {
                    event.preventDefault()
                    if (lastSelected && !presentingId) {
                        setPresentation(lastSelected)
                    } else if (presentingId) {
                        setPresentation('')
                    }
                }
            }
        }

        const onKeyUp = (event: KeyboardEvent) => {
            if (!blockFocus) {
                if (event.key === 'Shift') {
                    setHoldingShift(false)
                }
            }
        }

        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('keyup', onKeyUp)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
        }
    }, [
        blockFocus,
        searchContent,
        presentingId,
        lastSelected,
        isSearching,
        menuMode,
    ])
}

export const usePaste = (folderId: string, usr: User, blockFocus: boolean) => {
    const setSearch = useFileBrowserStore((state) => state.setSearch)
    const setPaste = useFileBrowserStore((state) => state.setPasteImgBytes)

    const handlePaste = useCallback(
        (e: ClipboardEvent) => {
            if (blockFocus) {
                return
            }
            e.preventDefault()
            e.stopPropagation()
            if (typeof navigator?.clipboard?.read === 'function') {
                navigator.clipboard
                    .read()
                    .then(async (items) => {
                        for (const item of items) {
                            for (const mime of item.types) {
                                if (mime.startsWith('image/')) {
                                    if (
                                        folderId === 'shared' ||
                                        folderId === usr.trashId
                                    ) {
                                        console.error(
                                            'This folder does not allow paste-to-upload'
                                        )
                                        return
                                    }
                                    const img: ArrayBuffer = await (
                                        await item.getType(mime)
                                    ).arrayBuffer()
                                    setPaste(img)
                                } else if (mime === 'text/plain') {
                                    const text = await (
                                        await item.getType('text/plain')
                                    )?.text()
                                    if (!text) {
                                        continue
                                    }
                                    setSearch(text)
                                } else {
                                    console.error('Unknown mime', mime)
                                }
                            }
                        }
                    })
                    .catch(ErrorHandler)
            } else {
                console.error('Unknown navigator clipboard type')
                // clipboardItems = e.clipboardData.files
            }
        },
        [folderId, blockFocus]
    )

    useEffect(() => {
        window.addEventListener('paste', handlePaste)
        return () => {
            window.removeEventListener('paste', handlePaste)
        }
    }, [handlePaste])
}

export async function uploadViaUrl(
    img: ArrayBuffer,
    folderId: string,
    dirMap: Map<string, WeblensFile>
) {
    const names = Array.from(dirMap.values()).map((v) => v.GetFilename())
    let imgNumber = 1
    let imgName = `image${imgNumber}.jpg`
    while (names.includes(imgName)) {
        imgNumber++
        imgName = `image${imgNumber}.jpg`
    }

    const meta: fileUploadMetadata = {
        file: new File([img], imgName),
        isDir: false,
        parentId: folderId,
        topLevelParentKey: '',
        isTopLevel: true,
    }
    await Upload([meta], false, '', folderId)
}

export const historyDate = (timestamp: number) => {
    if (timestamp < 10000000000) {
        timestamp = timestamp * 1000
    }
    const dateObj = new Date(timestamp)
    const options: Intl.DateTimeFormatOptions = {
        month: 'long',
        day: 'numeric',
        minute: 'numeric',
        hour: 'numeric',
    }
    if (dateObj.getFullYear() !== new Date().getFullYear()) {
        options.year = 'numeric'
    }
    return dateObj.toLocaleDateString('en-US', options)
}
