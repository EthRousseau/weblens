import { Divider } from '@mantine/core'
import { IconFile, IconFolder, IconX } from '@tabler/icons-react'
import WeblensButton from '@weblens/lib/WeblensButton'
import WeblensProgress from '@weblens/lib/WeblensProgress'
import { humanFileSize } from '@weblens/util'
import { CSSProperties, useEffect, useMemo, useRef } from 'react'
import { VariableSizeList } from 'react-window'

import { SingleUpload, useUploadStatus } from './UploadStateControl'
import './style/uploadStatusStyle.scss'

type UploadCardData = {
    uploads: SingleUpload[]
    childrenMap: Map<string, SingleUpload[]>
}

function UploadCardWrapper({
    data,
    index,
    style,
}: {
    data: UploadCardData
    index: number
    style: CSSProperties
}) {
    const { uploads, childrenMap } = data
    const uploadMeta = uploads[index]
    return (
        <div style={style}>
            <UploadCard
                uploadMetadata={uploadMeta}
                subUploads={childrenMap.get(uploadMeta.key) ?? []}
            />
        </div>
    )
}

function UploadCard({
    uploadMetadata,
    subUploads,
}: {
    uploadMetadata: SingleUpload
    subUploads: SingleUpload[]
}) {
    const { prog, statusText, speedStr, speedUnits } = useMemo(() => {
        let prog = 0
        let statusText = ''
        let speed = 0
        if (uploadMetadata.isDir) {
            if (uploadMetadata.files === -1) {
                prog = -1
            } else {
                prog = (uploadMetadata.files / uploadMetadata.total) * 100
            }

            if (uploadMetadata.total === 0) {
                statusText = 'Starting upload ...'
            } else if (uploadMetadata.complete) {
                statusText = `${uploadMetadata.total} files`
            } else {
                statusText = `${uploadMetadata.files} of ${uploadMetadata.total} files`
            }
            speed = subUploads.reduce((acc, f) => f.getSpeed() + acc, 0)
        } else if (uploadMetadata.complete) {
            const [totalString, totalUnits] = humanFileSize(
                uploadMetadata.total
            )
            statusText = `${totalString}${totalUnits}`
        } else if (uploadMetadata.chunks.length !== 0) {
            const soFar = uploadMetadata.chunks.reduce(
                (acc, chunk) => acc + (chunk ? chunk.bytesSoFar : 0),
                0
            )

            prog = Math.min((soFar / uploadMetadata.total) * 100, 100)
            const [soFarString, soFarUnits] = humanFileSize(soFar)
            const [totalString, totalUnits] = humanFileSize(
                uploadMetadata.total
            )
            statusText = `${soFarString}${soFarUnits} of ${totalString}${totalUnits}`
            speed = uploadMetadata.getSpeed()
        }

        const [speedStr, speedUnits] = humanFileSize(speed)

        return { prog, statusText, speedStr, speedUnits }
    }, [
        uploadMetadata.chunks,
        uploadMetadata.complete,
        uploadMetadata.total,
        uploadMetadata.files,
    ])

    return (
        <div className="flex w-full flex-col p-2 gap-2">
            <div className="flex flex-row h-max min-h-[40px] shrink-0 m-[1px] items-center">
                <div className="flex flex-col h-max w-0 items-start justify-center grow">
                    <p className="truncate font-semibold w-full">
                        {uploadMetadata.friendlyName}
                    </p>
                    {/* {statusText && prog !== 100 && prog !== -1 && ( */}
                    <div>
                        <p className="text-[--wl-text-color] text-nowrap pr-[4px] text-sm my-1">
                            {statusText}
                        </p>
                        {!uploadMetadata.isDir && !uploadMetadata.complete && (
                            <p className="text-[--wl-text-color] text-nowrap pr-[4px] text-sm mt-1">
                                {speedStr} {speedUnits}/s
                            </p>
                        )}
                    </div>
                    {/* )} */}
                </div>
                {uploadMetadata.isDir && (
                    <IconFolder
                        className="text-[--wl-text-color]"
                        style={{ minHeight: '25px', minWidth: '25px' }}
                    />
                )}
                {!uploadMetadata.isDir && (
                    <IconFile
                        className="text-[--wl-text-color]"
                        style={{ minHeight: '25px', minWidth: '25px' }}
                    />
                )}
            </div>

            {!uploadMetadata.complete && (
                <WeblensProgress
                    value={prog}
                    failure={Boolean(uploadMetadata.error)}
                    loading={uploadMetadata.total === 0}
                />
            )}
        </div>
    )
}

const UploadStatus = () => {
    const uploadsMap = useUploadStatus((state) => state.uploads)
    const clearUploads = useUploadStatus((state) => state.clearUploads)
    const listRef = useRef<VariableSizeList>()

    const { uploads, childrenMap } = useMemo(() => {
        const uploads: SingleUpload[] = []
        const childrenMap = new Map<string, SingleUpload[]>()
        for (const upload of Array.from(uploadsMap.values())) {
            if (upload.parent) {
                if (childrenMap.get(upload.parent)) {
                    childrenMap.get(upload.parent).push(upload)
                } else {
                    childrenMap.set(upload.parent, [upload])
                }
            } else {
                uploads.push(upload)
            }
        }
        uploads.sort((a, b) => {
            if (a.complete && !b.complete) {
                return 1
            } else if (!a.complete && b.complete) {
                return -1
            }

            const aVal = a.bytes / a.total
            const bVal = b.bytes / b.total
            if (aVal === bVal) {
                return 0
            } else if (aVal !== 1 && bVal === 1) {
                return -1
            } else if (bVal !== 1 && aVal === 1) {
                return 1
            } else if (aVal >= 0 && aVal <= 1) {
                return 1
            }

            return 0
        })

        return { uploads, childrenMap }
    }, [uploadsMap])

    useEffect(() => {
        listRef.current?.resetAfterIndex(0)
    }, [uploads])

    if (uploads.length === 0) {
        return null
    }

    const topLevelCount = Array.from(uploadsMap.values()).filter(
        (val) => !val.parent
    ).length

    let height = 0
    for (const upload of uploads) {
        if (upload.complete) {
            height += 70
        } else if (upload.isDir) {
            height += 105
        } else {
            height += 120
        }
        if (height > 250) {
            height = 250
            break
        }
    }

    return (
        <div className="upload-status-container">
            <div className="flex flex-col h-max max-h-full w-full bg-[--wl-card-background] p-2 pb-0 mb-1 rounded overflow-hidden">
                <div className="flex h-max min-h-[50px]">
                    <div className="h-max min-h-max w-full">
                        <VariableSizeList
                            ref={listRef}
                            itemCount={uploads.length}
                            height={height}
                            width={'100%'}
                            itemSize={(index) => {
                                const upload = uploads[index]
                                if (upload.complete) {
                                    return 70
                                } else if (upload.isDir) {
                                    return 105
                                }
                                return 120
                            }}
                            itemData={{ uploads, childrenMap }}
                            overscanCount={5}
                        >
                            {UploadCardWrapper}
                        </VariableSizeList>
                    </div>
                </div>

                <Divider h={2} w={'100%'} />
                <div className="flex flex-row justify-center w-full h-max p-2">
                    <div className="flex flex-row h-full w-full items-center justify-between">
                        <p className="text-[--wl-text-color] font-semibold text-lg">
                            Uploading {topLevelCount} item
                            {topLevelCount !== 1 ? 's' : ''}
                        </p>
                        <WeblensButton
                            Left={IconX}
                            squareSize={30}
                            onClick={clearUploads}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default UploadStatus
