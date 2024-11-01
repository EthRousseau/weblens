import {
    IconCalendar,
    IconColumns,
    IconFileAnalytics,
    IconLayoutGrid,
    IconLayoutList,
    IconSortAscending2,
    IconSortAZ,
    IconSortDescending2,
    TablerIconsProps,
} from '@tabler/icons-react'
import WeblensButton from '@weblens/lib/WeblensButton'
import { useFileBrowserStore } from './FBStateControl'
import { DirViewModeT } from './FileBrowserTypes'

const fileSortTypes = [
    { Name: 'Name', Icon: IconSortAZ },
    { Name: 'Date Modified', Icon: IconCalendar },
    { Name: 'Size', Icon: IconFileAnalytics },
]

const dirViewModes: {
    Mode: DirViewModeT
    Icon: (props: TablerIconsProps) => JSX.Element
}[] = [
    { Mode: DirViewModeT.Grid, Icon: IconLayoutGrid },
    { Mode: DirViewModeT.List, Icon: IconLayoutList },
    { Mode: DirViewModeT.Columns, Icon: IconColumns },
]

function FileSortBox() {
    const viewOpts = useFileBrowserStore((state) => state.viewOpts)
    const setViewOpts = useFileBrowserStore((state) => state.setViewOptions)

    return (
        <div className="file-sort-box">
            <WeblensButton
                Left={
                    viewOpts.sortDirection === 1
                        ? IconSortDescending2
                        : IconSortAscending2
                }
                tooltip={
                    viewOpts.sortDirection === 1 ? 'Descending' : 'Ascending'
                }
                onClick={() =>
                    setViewOpts({ sortDirection: viewOpts.sortDirection * -1 })
                }
            />

            <div className="h-full w-[1px] pt-1 pb-1 bg-[#333333] m-1" />

            <div className="flex flex-row items-center">
                {fileSortTypes.map((v) => {
                    return (
                        <WeblensButton
                            key={v.Name}
                            squareSize={40}
                            Left={v.Icon}
                            toggleOn={v.Name === viewOpts.sortFunc}
                            tooltip={v.Name}
                            onClick={(e) => {
                                e.stopPropagation()
                                setViewOpts({ sortKey: v.Name })
                            }}
                        />
                    )
                })}
            </div>

            <div className="h-full w-[1px] pt-1 pb-1 bg-[#333333] m-1" />

            <div className="flex flex-row items-center">
                {dirViewModes.map((v) => {
                    return (
                        <WeblensButton
                            key={v.Mode}
                            squareSize={40}
                            Left={v.Icon}
                            toggleOn={v.Mode === viewOpts.dirViewMode}
                            tooltip={String(DirViewModeT[v.Mode])}
                            onClick={(e) => {
                                e.stopPropagation()
                                setViewOpts({ dirViewMode: v.Mode })
                            }}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default FileSortBox
