import { Divider, Loader, Text } from '@mantine/core'
import { IconFolder, IconPhoto } from '@tabler/icons-react'
import React, {
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

import '../components/itemDisplayStyle.css'
import { MediaImage } from '../Media/PhotoContainer'
import { FbMenuModeT, WeblensFile } from './File'
import { DraggingStateT, FbContext } from './filesContext'
import { useMedia } from '../components/hooks'

export type GlobalContextType = {
    setDragging: (d: DraggingStateT) => void
    blockFocus: (b: boolean) => void
    rename: (itemId: string, newName: string) => void

    setMenuOpen: (m: FbMenuModeT) => void
    setMenuPos: ({ x, y }: { x: number; y: number }) => void
    setMenuTarget: (itemId: string) => void

    setHovering?: (itemId: string) => void
    setSelected?: (itemId: string, selected?: boolean) => void
    selectAll?: (itemId: string, selected?: boolean) => void
    moveSelected?: (itemId: string) => void
    doSelectMany?: () => void
    setMoveDest?: (itemName) => void

    dragging?: number
    numCols?: number
    itemWidth?: number
    initialScrollIndex?: number
    hoveringIndex?: number
    lastSelectedIndex?: number
    doMediaFetch?: boolean
    allowEditing?: boolean
}

type WrapperProps = {
    itemInfo: WeblensFile
    fileRef

    editing: boolean

    selected: SelectedState

    width: number

    dragging: DraggingStateT

    setSelected: (itemId: string, selected?: boolean) => void
    doSelectMany: () => void
    moveSelected: (entryId: string) => void
    setMoveDest: (itemName: string) => void

    setDragging: (d: DraggingStateT) => void
    setHovering: (i: string) => void

    setMenuMode: (m: FbMenuModeT) => void
    setMenuPos: ({ x, y }: { x: number; y: number }) => void
    setMenuTarget: (itemId: string) => void

    children
}

type TitleProps = {
    itemId: string
    itemTitle: string
    secondaryInfo?: string
    editing: boolean
    setEditing: (e: boolean) => void
    allowEditing: boolean
    height: number
    blockFocus: (b: boolean) => void
    rename: (itemId: string, newName: string) => void
}

const MARGIN = 6

function selectedStyles(selected: SelectedState): {
    backgroundColor: string
    outline: string
} {
    let backgroundColor = '#222222'
    let outline
    if (selected & SelectedState.Hovering) {
        backgroundColor = '#333333'
    }

    if (selected & SelectedState.InRange) {
        backgroundColor = '#373365'
    }

    if (selected & SelectedState.Selected) {
        backgroundColor = '#331177bb'
    }

    if (selected & SelectedState.LastSelected) {
        outline = '2px solid #442299'
    }

    if (selected & SelectedState.Droppable) {
        // $dark-paper
        backgroundColor = '#1c1049'
        outline = '2px solid #4444ff'
    }

    return { backgroundColor, outline }
}

const ItemWrapper = memo(
    ({
        itemInfo: file,
        fileRef,
        width,
        selected,
        setSelected,
        doSelectMany,
        dragging = DraggingStateT.NoDrag,
        setDragging,
        setHovering,
        moveSelected,
        setMenuMode,
        setMenuPos,
        setMenuTarget,
        setMoveDest,
        children,
    }: WrapperProps) => {
        const [mouseDown, setMouseDown] = useState(null)
        const nav = useNavigate()
        const { fbState, fbDispatch } = useContext(FbContext)

        const { outline, backgroundColor } = useMemo(() => {
            return selectedStyles(selected)
        }, [selected])

        return (
            <div
                className="animate-fade"
                ref={fileRef}
                style={{ margin: MARGIN }}
                onMouseOver={(e) => {
                    e.stopPropagation()
                    file.SetHovering(true)
                    setHovering(file.Id())
                    if (dragging && !file.IsSelected() && file.IsFolder()) {
                        setMoveDest(file.GetFilename())
                    }
                }}
                onMouseDown={(e) => {
                    setMouseDown({ x: e.clientX, y: e.clientY })
                }}
                onMouseMove={(e) => {
                    if (
                        mouseDown &&
                        !dragging &&
                        (Math.abs(mouseDown.x - e.clientX) > 20 ||
                            Math.abs(mouseDown.y - e.clientY) > 20)
                    ) {
                        setSelected(file.Id(), true)
                        setDragging(DraggingStateT.InternalDrag)
                    }
                }}
                onClick={(e) => {
                    e.stopPropagation()
                    if (e.shiftKey) {
                        doSelectMany()
                    } else {
                        setSelected(file.Id())
                    }
                }}
                onMouseUp={(e) => {
                    if (dragging !== 0) {
                        if (!file.IsSelected() && file.IsFolder()) {
                            moveSelected(file.Id())
                        }
                        setMoveDest('')
                        setDragging(DraggingStateT.NoDrag)
                    }
                    setMouseDown(null)
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation()
                    const jump = file.GetVisitRoute(
                        fbState.fbMode,
                        fbState.shareId,
                        fbDispatch
                    )
                    if (jump) {
                        nav(jump)
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()

                    setMenuTarget(file.Id())
                    setMenuPos({ x: e.clientX, y: e.clientY })
                    if (fbState.menuMode === FbMenuModeT.Closed) {
                        setMenuMode(FbMenuModeT.Default)
                    }
                }}
                onMouseLeave={(e) => {
                    file.SetHovering(false)
                    setHovering('')
                    if (dragging && file.IsFolder()) {
                        setMoveDest('')
                    }
                    if (mouseDown) {
                        setMouseDown(null)
                    }
                }}
            >
                <div
                    className="flex flex-col items-center justify-center overflow-hidden rounded-md transition-colors"
                    children={children}
                    style={{
                        outline: outline,
                        backgroundColor: backgroundColor,
                        height: (width - MARGIN * 2) * 1.1,
                        width: width - MARGIN * 2,
                        cursor:
                            dragging !== 0 && !file.IsFolder()
                                ? 'default'
                                : 'pointer',
                    }}
                />
                {(file.IsSelected() || !file.IsFolder()) && dragging !== 0 && (
                    <div
                        className="no-drop-cover"
                        style={{
                            height: (width - MARGIN * 2) * 1.1,
                            width: width - MARGIN * 2,
                        }}
                        onMouseLeave={(e) => {
                            file.SetHovering(false)
                            setHovering('')
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>
        )
    },
    (prev, next) => {
        if (prev.itemInfo !== next.itemInfo) {
            return false
        } else if (prev.selected !== next.selected) {
            return false
        } else if (prev.editing !== next.editing) {
            return false
        } else if (prev.dragging !== next.dragging) {
            return false
        } else if (prev.width !== next.width) {
            return false
        } else if (prev.children !== next.children) {
            return false
        }
        return true
    }
)

const FileVisualWrapper = ({ children }) => {
    return (
        <div className="w-full p-2 aspect-square overflow-hidden">
            <div
                className="w-full h-full overflow-hidden rounded-md flex justify-center items-center"
                children={children}
            />
        </div>
    )
}

const FileVisual = memo(
    ({ file, doFetch }: { file: WeblensFile; doFetch: boolean }) => {
        const mediaData = useMedia(file.GetMediaId())

        if (file.IsFolder()) {
            return <IconFolder size={150} />
        }

        if (mediaData) {
            return (
                <MediaImage
                    media={mediaData}
                    quality="thumbnail"
                    doFetch={doFetch}
                />
            )
        } else if (file.IsImage()) {
            return <IconPhoto />
        }

        return null
    },
    (prev, next) => {
        if (prev.file.GetMediaId() !== next.file.GetMediaId()) {
            return false
        } else if (prev.doFetch !== next.doFetch) {
            return false
        }
        return true
    }
)

const useKeyDown = (
    itemId: string,
    oldName: string,
    newName: string,
    editing: boolean,
    setEditing: (b: boolean) => void,
    rename: (itemId: string, newName: string) => void
) => {
    const onKeyDown = useCallback(
        (event) => {
            if (!editing) {
                return
            }
            if (event.key === 'Enter') {
                if (oldName !== newName) {
                    rename(itemId, newName)
                }
                setEditing(false)
            } else if (event.key === 'Escape') {
                setEditing(false)
                // Rename with empty name is a "cancel" to the rename
                rename(itemId, '')
            }
        },
        [itemId, oldName, newName, editing, setEditing, rename]
    )

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [onKeyDown])
}

const TextBox = memo(
    ({
        itemId,
        itemTitle,
        secondaryInfo,
        editing,
        setEditing,
        allowEditing,
        height,
        blockFocus,
        rename,
    }: TitleProps) => {
        const editRef: React.Ref<HTMLInputElement> = useRef()
        const [renameVal, setRenameVal] = useState(itemTitle)

        const setEditingPlus = useCallback(
            (b: boolean) => {
                setEditing(b)
                setRenameVal((cur) => {
                    if (cur === '') {
                        return itemTitle
                    } else {
                        return cur
                    }
                })
                blockFocus(b)
            },
            [itemTitle, setEditing, blockFocus]
        )
        useKeyDown(
            itemId,
            itemTitle,
            renameVal,
            editing,
            setEditingPlus,
            rename
        )

        useEffect(() => {
            if (editing && editRef.current) {
                editRef.current.select()
            }
        }, [editing, editRef])

        useEffect(() => {
            if (itemId === 'NEW_DIR') {
                setEditingPlus(true)
            }
        }, [itemId, setEditingPlus])

        if (editing) {
            return (
                <div
                    className="item-info-box"
                    style={{
                        height: height,
                    }}
                    onBlur={() => {
                        setEditingPlus(false)
                        rename(itemId, '')
                    }}
                >
                    <input
                        ref={editRef}
                        defaultValue={itemTitle}
                        onClick={(e) => {
                            e.stopPropagation()
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation()
                        }}
                        onChange={(e) => {
                            setRenameVal(e.target.value)
                        }}
                        style={{
                            width: '90%',
                            backgroundColor: '#00000000',
                            border: 0,
                            outline: 0,
                        }}
                    />
                </div>
            )
        } else {
            return (
                <div
                    className="item-info-box"
                    style={{
                        height: height,
                        cursor: allowEditing ? 'text' : 'default',
                        paddingBottom: MARGIN / 2,
                    }}
                    onClick={(e) => {
                        if (!allowEditing) {
                            return
                        }
                        e.stopPropagation()
                        setEditingPlus(true)
                    }}
                >
                    <div className="title-box">
                        <Text
                            size={`${height - MARGIN * 2}px`}
                            truncate={'end'}
                            style={{
                                color: 'white',
                                userSelect: 'none',
                                lineHeight: 1.5,
                            }}
                        >
                            {itemTitle}
                        </Text>
                        <Divider orientation="vertical" my={1} mx={6} />
                        <div className="w-max justify-center">
                            <Text
                                size={`${height - (MARGIN * 2 + 4)}px`}
                                lineClamp={1}
                                className="text-white overflow-visible select-none w-max"
                            >
                                {' '}
                                {secondaryInfo}{' '}
                            </Text>
                        </div>
                    </div>
                </div>
            )
        }
    },
    (prev, next) => {
        if (prev.secondaryInfo !== next.secondaryInfo) {
            return false
        } else if (prev.editing !== next.editing) {
            return false
        } else if (prev.itemTitle !== next.itemTitle) {
            return false
        } else if (prev.height !== next.height) {
            return false
        }
        return true
    }
)

export enum SelectedState {
    NotSelected = 0x0,
    Hovering = 0x1,
    InRange = 0x10,
    Selected = 0x100,
    LastSelected = 0x1000,
    Droppable = 0x10000,
}

export const FileDisplay = memo(
    ({
        file,
        selected,
        index,
        context,
    }: {
        file: WeblensFile
        selected: SelectedState
        index: number
        context: GlobalContextType
    }) => {
        const wrapRef = useRef()
        const [editing, setEditing] = useState(false)

        return (
            <ItemWrapper
                itemInfo={file}
                fileRef={wrapRef}
                selected={selected}
                setSelected={context.setSelected}
                doSelectMany={context.doSelectMany}
                width={context.itemWidth}
                moveSelected={context.moveSelected}
                dragging={context.dragging}
                setDragging={context.setDragging}
                setHovering={context.setHovering}
                setMoveDest={context.setMoveDest}
                setMenuMode={context.setMenuOpen}
                setMenuPos={context.setMenuPos}
                setMenuTarget={context.setMenuTarget}
                editing={editing}
            >
                <FileVisualWrapper>
                    <FileVisual file={file} doFetch={context.doMediaFetch} />
                </FileVisualWrapper>

                <TextBox
                    itemId={file.Id()}
                    itemTitle={file.GetFilename()}
                    secondaryInfo={file.FormatSize()}
                    editing={editing}
                    setEditing={(e) => {
                        if (!context.allowEditing) {
                            return
                        }
                        setEditing(e)
                    }}
                    allowEditing={context.allowEditing}
                    height={context.itemWidth * 0.1}
                    blockFocus={context.blockFocus}
                    rename={(id, newName) => {
                        if (
                            newName === file.GetFilename() ||
                            (newName === '' && file.Id() !== 'NEW_DIR')
                        ) {
                            return
                        }
                        context.rename(id, newName)
                    }}
                />

                {file.Id() === 'NEW_DIR' && !editing && (
                    <Loader
                        color="white"
                        size={20}
                        style={{ position: 'absolute', top: 20, right: 20 }}
                    />
                )}
            </ItemWrapper>
        )
    },
    (prev, next) => {
        if (prev.file.Id() !== next.file.Id()) {
            return false
        } else if (prev.context !== next.context) {
            return false
        } else if (prev.context.itemWidth !== next.context.itemWidth) {
            return false
        } else if (prev.context.dragging !== next.context.dragging) {
            return false
        } else if (prev.selected !== next.selected) {
            return false
        } else if (prev.file.IsHovering() !== next.file.IsHovering()) {
            return false
        }
        return true
    }
)
