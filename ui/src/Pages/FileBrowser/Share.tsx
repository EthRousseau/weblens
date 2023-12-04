import { Button, Combobox, Loader, Modal, Pill, PillsInput, Space, useCombobox } from "@mantine/core"
import useR from "../../components/UserInfo"
import { useEffect, useState } from "react"
import { AutocompleteUsers, ShareFiles } from "../../api/FileBrowserApi"
import { itemData } from "../../types/Types"


function ShareDialogue({ sharing, selectedMap, dirMap, dispatch, authHeader }) {
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    })
    const { userInfo } = useR()
    const [userSearch, setUserSearch] = useState(null)
    const [empty, setEmpty] = useState(false)
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [value, setValue] = useState([])

    const searchUsers = async (query: string) => {
        if (query.length < 2) {
            setUserSearch([])
            setEmpty(true)
        }

        setLoading(true)
        const users: string[] = await AutocompleteUsers(query, authHeader)
        const selfIndex = users.indexOf(userInfo.username)
        if (selfIndex !== -1) {
            users.splice(selfIndex, 1)
        }
        setUserSearch(users)
        setLoading(false)
        setEmpty(users.length === 0)
    }

    const options = (userSearch || []).map((item) => (
        <Combobox.Option value={item} key={item}>
            {item}
        </Combobox.Option>
    ))

    useEffect(() => {
        combobox.selectFirstOption()
    }, [userSearch])

    const handleValueSelect = (val: string) =>
        setValue((current) => { searchUsers(""); return current.includes(val) ? current.filter((v) => v !== val) : [...current, val] })

    const handleValueRemove = (val: string) =>
        setValue((current) => current.filter((v) => v !== val))

    const values = value.map((item) => (
        <Pill key={item} withRemoveButton onRemove={() => handleValueRemove(item)}>
            {item}
        </Pill>
    ))

    return (
        <Modal opened={sharing} onClose={() => { dispatch({ type: "close_share" }) }} title={`Share ${selectedMap.size} Files`} centered>
            <Combobox
                onOptionSubmit={str => { setSearch(''); handleValueSelect(str) }}
                withinPortal={false}
                store={combobox}
            >
                <Combobox.DropdownTarget>
                    <PillsInput
                        onClick={() => combobox.openDropdown()}
                        rightSection={loading && <Loader size={18} />}
                        placeholder='Search users to share with'
                    >
                        {values}
                        <Combobox.EventsTarget>
                            <PillsInput.Field
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.currentTarget.value)
                                    searchUsers(e.currentTarget.value)
                                    combobox.updateSelectedOptionIndex()
                                    combobox.openDropdown()
                                }}
                                onClick={() => combobox.openDropdown()}
                                onFocus={() => {
                                    combobox.openDropdown()
                                    if (userSearch === null) {
                                        searchUsers(search)
                                    }
                                }}
                                onBlur={() => combobox.closeDropdown()}
                                onKeyDown={(event) => {
                                    if (event.key === 'Backspace' && search.length === 0) {
                                        event.preventDefault()
                                        handleValueRemove(value[value.length - 1])
                                    }
                                }}
                            />

                        </Combobox.EventsTarget>
                    </PillsInput>
                </Combobox.DropdownTarget>
                <Combobox.Dropdown hidden={search === "" || search === null}>
                    <Combobox.Options>
                        {options}
                        {(empty && !loading) && <Combobox.Empty>No results found</Combobox.Empty>}
                    </Combobox.Options>
                </Combobox.Dropdown>
            </Combobox>
            <Space h={'md'} />
            <Button onClick={() => ShareFiles(Array.from(selectedMap.keys()).map((key: string) => { const item: itemData = dirMap.get(key); return { parentFolderId: item.parentFolderId, filename: item.filename } }), value, authHeader)}>Share</Button>
        </Modal>
    )
}

export default ShareDialogue