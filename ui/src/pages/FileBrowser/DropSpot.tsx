import { useMouse } from '@mantine/hooks'
import { IconFile, IconFolder, IconFolderCancel } from '@tabler/icons-react'
import { ErrorHandler } from '@weblens/types/Types'
import { DraggingStateT } from '@weblens/types/files/FBTypes'
import { WeblensFile } from '@weblens/types/files/File'
import { useMemo } from 'react'

import { useFileBrowserStore } from './FBStateControl'
import { HandleDrop } from './FileBrowserLogic'
import { FileFmt } from './FileBrowserMiscComponents'
import fbStyle from './style/fileBrowserStyle.module.scss'

export const TransferCard = ({
    action,
    destination,
    boundRef,
}: {
    action: string
    destination: string
    boundRef?: HTMLDivElement
}) => {
    let width: number
    let left: number
    if (boundRef) {
        width = boundRef.clientWidth
        left = boundRef.getBoundingClientRect()['left']
    }
    const dragState = useFileBrowserStore((state) => state.draggingState)

    const destFile = useMemo(() => {
        if (!destination) {
            return null
        }
        return useFileBrowserStore.getState().filesMap.get(destination)
    }, [destination])

    if (
        !destFile ||
        dragState === DraggingStateT.NoDrag ||
        dragState === DraggingStateT.InterfaceDrag
    ) {
        return null
    }

    return (
        <div
            className={fbStyle['transfer-info-wrapper']}
            style={{
                width: width ? width : '100%',
                left: left ? left : 0,
            }}
        >
            <div className={fbStyle['transfer-info-box']}>
                <p className="select-none">{action} to</p>
                <FileFmt pathName={destFile.portablePath} />
            </div>
        </div>
    )
}

export const DropSpot = ({ parent }: { parent: WeblensFile }) => {
    const draggingState = useFileBrowserStore((state) => state.draggingState)
    const shareId = useFileBrowserStore((state) => state.shareId)
    const setDragging = useFileBrowserStore((state) => state.setDragging)

    if (!parent) {
        return null
    }

    return (
        <div
            draggable={false}
            className={fbStyle['dropspot-wrapper']}
            style={{
                // pointerEvents:
                //     draggingState === DraggingStateT.ExternalDrag
                //         ? 'all'
                //         : 'none',
                cursor:
                    !parent.modifiable &&
                    draggingState === DraggingStateT.ExternalDrag
                        ? 'no-drop'
                        : 'auto',
                // height: wrapperSize ? wrapperSize.height - 2 : '100%',
                // width: wrapperSize ? wrapperSize.width - 2 : '100%',
            }}
        >
            {draggingState === DraggingStateT.ExternalDrag && (
                <div
                    className={fbStyle['dropbox']}
                    onMouseLeave={() => {
                        if (draggingState === DraggingStateT.ExternalDrag) {
                            setDragging(DraggingStateT.NoDrag)
                        }
                    }}
                    onDragLeave={() => {
                        setTimeout(
                            () => setDragging(DraggingStateT.NoDrag),
                            100
                        )
                    }}
                    onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (parent.modifiable) {
                            HandleDrop(
                                e.dataTransfer.items,
                                parent.Id(),
                                [],
                                false,
                                shareId
                            ).catch(ErrorHandler)

                            setDragging(DraggingStateT.NoDrag)
                        } else {
                            if (draggingState === DraggingStateT.ExternalDrag) {
                                setDragging(DraggingStateT.NoDrag)
                            }
                        }
                    }}
                    // required for onDrop to work
                    // https://stackoverflow.com/questions/50230048/react-ondrop-is-not-firing
                    onDragOver={(e) => e.preventDefault()}
                    style={{
                        outlineColor: `${parent.modifiable ? '#ffffff' : '#dd2222'}`,
                        cursor: !parent.modifiable ? 'no-drop' : 'auto',
                    }}
                >
                    {!parent.modifiable && (
                        <div className="flex justify-center items-center relative cursor-no-drop w-max pointer-events-none">
                            <IconFolderCancel
                                className="pointer-events-none"
                                size={100}
                                color="#dd2222"
                            />
                        </div>
                    )}
                    {parent.modifiable && (
                        <TransferCard
                            action="Upload"
                            destination={parent.portablePath}
                        />
                    )}
                </div>
            )}
        </div>
    )
}

export function DraggingCounter() {
    const drag = useFileBrowserStore((state) => state.draggingState)
    const setDrag = useFileBrowserStore((state) => state.setDragging)
    const selected = useFileBrowserStore((state) => state.selected)
    const filesMap = useFileBrowserStore((state) => state.filesMap)

    const position = useMouse()
    const { files, folders } = useMemo(() => {
        const selectedKeys = Array.from(selected.keys())
        let files = 0
        let folders = 0

        selectedKeys.forEach((k: string) => {
            if (filesMap.get(k)?.IsFolder()) {
                folders++
            } else {
                files++
            }
        })
        return { files, folders }
    }, [selected])

    if (drag !== DraggingStateT.InternalDrag) {
        return null
    }

    return (
        <div
            className="fixed z-10 bg-wl-barely-visible wl-outline p-2"
            style={{
                top: position.y + 8,
                left: position.x + 8,
            }}
            onMouseUp={() => {
                setDrag(DraggingStateT.NoDrag)
            }}
        >
            {Boolean(files) && (
                <div className="flex flex-row h-max text-[--wl-text-color] items-center">
                    <IconFile size={30} />
                    <p>{files}</p>
                </div>
            )}
            {Boolean(folders) && (
                <div className="flex flex-row h-max text-[--wl-text-color] items-center">
                    <IconFolder size={30} />
                    <p>{folders}</p>
                </div>
            )}
        </div>
    )
}
