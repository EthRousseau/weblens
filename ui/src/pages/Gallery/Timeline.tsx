import { IconLayersIntersect, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import MediaApi from '@weblens/api/MediaApi'
import WeblensButton from '@weblens/lib/WeblensButton'
import WeblensInput from '@weblens/lib/WeblensInput'
import WeblensProgress from '@weblens/lib/WeblensProgress'
import { GalleryFilters } from '@weblens/pages/Gallery/Gallery'
import WeblensMedia from '@weblens/types/media/Media'
import { PhotoGallery } from '@weblens/types/media/MediaDisplay'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import { useState } from 'react'

import { useGalleryStore } from './GalleryLogic'

function TimelineControls({ setSearch }: { setSearch: (v: string) => void }) {
    const selecting = useGalleryStore((state) => state.selecting)
    const imageSize = useGalleryStore((state) => state.imageSize)
    const setSelecting = useGalleryStore((state) => state.setSelecting)
    const setImageSize = useGalleryStore((state) => state.setImageSize)

    const hasMedia = useMediaStore((state) => state.mediaMap.size !== 0)

    return (
        <div className="timeline-controls">
            <div className="relative h-10 w-56 shrink-0">
                <WeblensProgress
                    height={40}
                    value={((imageSize - 150) / 350) * 100}
                    disabled={selecting}
                    seekCallback={(s) => {
                        if (s === 0) {
                            s = 1
                        }
                        const newSize = (s / 100) * 350 + 150
                        setImageSize(newSize)
                    }}
                />
            </div>

            <GalleryFilters />

            <div className="flex grow w-0 justify-end">
                <WeblensInput
                    Icon={IconSearch}
                    fillWidth={false}
                    valueCallback={setSearch}
                />
                <WeblensButton
                    label="Select"
                    allowRepeat
                    squareSize={40}
                    centerContent
                    Left={IconLayersIntersect}
                    toggleOn={selecting}
                    onClick={() => setSelecting(!selecting)}
                    disabled={!hasMedia}
                />
            </div>
        </div>
    )
}

export function Timeline() {
    const showRaw = useMediaStore((state) => state.showRaw)
    const showHidden = useMediaStore((state) => state.showHidden)
    const addMedias = useMediaStore((state) => state.addMedias)
    const [search, setSearch] = useState<string>()

    const {
        data: medias,
        isLoading,
        error,
    } = useQuery<WeblensMedia[]>({
        queryKey: ['media', showRaw, showHidden, search],
        initialData: [],
        queryFn: async () => {
            const res = await MediaApi.getMedia(
                showRaw,
                showHidden,
                undefined,
                search,
                0,
                10000
            ).then((res) => {
                return res.data.Media.map((info) => new WeblensMedia(info))
            })

            addMedias(res)
            return res
        },
    })

    return (
        <div className="flex flex-col items-center h-1/2 w-full relative grow">
            <TimelineControls setSearch={setSearch} />
            <PhotoGallery medias={medias} loading={isLoading} error={error} />
        </div>
    )
}
