import {
    IconClipboard,
    IconLock,
    IconLogout,
    IconTrash,
    IconUser,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import AccessApi from '@weblens/api/AccessApi'
import { ServersApi } from '@weblens/api/ServersApi'
import UsersApi from '@weblens/api/UserApi'
import { ApiKeyInfo, ServerInfo } from '@weblens/api/swag'
import HeaderBar from '@weblens/components/HeaderBar'
import WeblensLoader from '@weblens/components/Loading'
import { useSessionStore } from '@weblens/components/UserInfo'
import { useKeyDown } from '@weblens/components/hooks'
import WeblensButton from '@weblens/lib/WeblensButton'
import WeblensInput from '@weblens/lib/WeblensInput'
import { ErrorHandler } from '@weblens/types/Types'
import { useMediaStore } from '@weblens/types/media/MediaStateControl'
import User from '@weblens/types/user/User'
import { FC, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import settingsStyle from './settingsStyle.module.scss'

type settingsTab = {
    id: string
    name: string
    icon: FC<{ size: number }>
    pageComp: FC
}

const tabs: settingsTab[] = [
    {
        id: 'account',
        name: 'Account',
        icon: IconUser,
        pageComp: AccountTab,
    },
    {
        id: 'security',
        name: 'Securty',
        icon: IconLock,
        pageComp: SecurityTab,
    },
]

export function SettingsMenu() {
    const user = useSessionStore((state) => state.user)
    const setUser = useSessionStore((state) => state.setUser)
    const nav = useNavigate()
    window.location.pathname.replace('/settings', '')
    const [activeTab, setActiveTab] = useState(
        window.location.pathname.replace('/settings', '')
    )

    const ActivePage = tabs.find((val) => val.id === activeTab)?.pageComp

    useEffect(() => {
        if (!ActivePage) {
            setActiveTab('account')
            nav('/settings/account')
        }
    }, [])

    return (
        <div className={settingsStyle['settings-menu']}>
            <HeaderBar />
            <div className="flex flex-col grow p-8">
                <div className="flex h-max items-center gap-2 w-full mb-4">
                    <IconUser size={25} />
                    <h3>{user.username}</h3>
                </div>
                <div className="flex grow">
                    <div className={settingsStyle['sidebar']}>
                        <ul className="flex flex-col h-full">
                            {tabs.map((tab) => {
                                return (
                                    <li key={tab.id}>
                                        <a
                                            data-active={activeTab === tab.id}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                e.preventDefault()
                                                setActiveTab(tab.id)
                                            }}
                                        >
                                            <span
                                                className={
                                                    settingsStyle['tab-icon']
                                                }
                                            >
                                                <tab.icon size={16} />
                                            </span>
                                            <span>{tab.name}</span>
                                        </a>
                                    </li>
                                )
                            })}
                            <li className="mt-auto">
                                <WeblensButton
                                    label={'Logout'}
                                    Left={IconLogout}
                                    danger
                                    centerContent
                                    squareSize={32}
                                    onClick={async () => {
                                        useMediaStore.getState().clear()
                                        await UsersApi.logoutUser()
                                        const loggedOut = new User()
                                        loggedOut.isLoggedIn = false
                                        setUser(loggedOut)
                                        nav('/login')
                                    }}
                                />
                            </li>
                        </ul>
                    </div>
                    {ActivePage && <ActivePage />}
                </div>
            </div>
        </div>
    )
}

function AccountTab() {
    return (
        <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold p-2 w-max text-nowrap">
                Account
            </p>
        </div>
    )
}

function SecurityTab() {
    const user = useSessionStore((state) => state.user)
    const [oldP, setOldP] = useState('')
    const [newP, setNewP] = useState('')
    const [buttonRef, setButtonRef] = useState<HTMLDivElement>()

    const updatePass = useCallback(async () => {
        if (oldP == '' || newP == '' || oldP === newP) {
            return Promise.reject(
                new Error('Old and new password cannot be empty or match')
            )
        }
        return UsersApi.updateUserPassword(user.username, {
            oldPassword: oldP,
            newPassword: newP,
        }).then(() => {
            setNewP('')
            setOldP('')
        })
    }, [user.username, String(oldP), String(newP)])

    const {
        data: keys,
        refetch: refetchKeys,
        isLoading,
    } = useQuery<ApiKeyInfo[]>({
        queryKey: ['apiKeys'],
        initialData: [],
        queryFn: () => AccessApi.getApiKeys().then((res) => res.data),
        retry: false,
    })

    const { data: remotes, refetch: refetchRemotes } = useQuery<ServerInfo[]>({
        queryKey: ['remotes'],
        initialData: [],
        queryFn: async () =>
            (await ServersApi.getRemotes().then((res) => res.data)) || [],
        retry: false,
    })

    useKeyDown('Enter', () => {
        if (buttonRef) {
            buttonRef.click()
        }
    })

    return (
        <div className="flex flex-col w-full gap-2">
            <div className={settingsStyle['settings-section']}>
                <div className={settingsStyle['settings-header']}>
                    <h4>API Keys</h4>
                    <WeblensButton
                        squareSize={32}
                        label="New Api Key"
                        onClick={() => {
                            AccessApi.createApiKey()
                                .then(() => refetchKeys())
                                .catch(ErrorHandler)
                        }}
                    />
                </div>
                {!isLoading &&
                    keys?.map((val) => {
                        return (
                            <ApiKeyRow
                                keyInfo={val}
                                refetch={() => {
                                    refetchRemotes().catch(ErrorHandler)
                                    refetchKeys().catch(ErrorHandler)
                                }}
                                remotes={remotes}
                            />
                        )
                    })}
                {!isLoading && !keys && (
                    <p className="w-full text-center text-[#cccccc]">
                        You have no API keys
                    </p>
                )}
                {isLoading && <WeblensLoader />}
            </div>

            <div className={settingsStyle['settings-header']}>
                <h4>Change Password</h4>
            </div>
            <WeblensInput
                value={oldP}
                placeholder="Old Password"
                password
                valueCallback={setOldP}
                squareSize={50}
            />
            <WeblensInput
                value={newP}
                placeholder="New Password"
                valueCallback={setNewP}
                squareSize={50}
                password
            />
            <div className="p2" />
            <WeblensButton
                label="Update Password"
                squareSize={40}
                fillWidth
                showSuccess
                disabled={oldP == '' || newP == '' || oldP === newP}
                onClick={updatePass}
                setButtonRef={setButtonRef}
            />
        </div>
    )
}

function ApiKeyRow({
    keyInfo,
    refetch,
    remotes,
}: {
    keyInfo: ApiKeyInfo
    refetch: () => void
    remotes: ServerInfo[]
}) {
    return (
        <div key={keyInfo.id} className={settingsStyle['settings-content-row']}>
            <div className="flex flex-col grow w-1/2">
                <p className="theme-text font-bold text-nowrap w-full truncate select-none">
                    {keyInfo.key}
                </p>
                {keyInfo.remoteUsing !== '' && (
                    <p className="select-none">
                        Used by:{' '}
                        {
                            remotes.find((r) => r.id === keyInfo.remoteUsing)
                                ?.name
                        }
                    </p>
                )}
                {keyInfo.remoteUsing === '' && (
                    <p className="select-none">Unused</p>
                )}
            </div>
            <WeblensButton
                Left={IconClipboard}
                tooltip="Copy Key"
                onClick={async () => {
                    if (!window.isSecureContext) {
                        return
                    }
                    await navigator.clipboard.writeText(keyInfo.key)
                    return true
                }}
            />
            <WeblensButton
                Left={IconTrash}
                danger
                requireConfirm
                tooltip="Delete Key"
                onClick={() => {
                    AccessApi.deleteApiKey(keyInfo.key)
                        .then(() => refetch())
                        .catch(ErrorHandler)
                }}
            />
        </div>
    )
}
