import { Box, useTheme } from '@mui/joy'
import { useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../../api/ApiFetch'
import { userContext } from '../../Context'
import { notifications } from '@mantine/notifications'
import { Button, Fieldset, Space, Tabs, TextInput } from '@mantine/core'

function CheckCreds(username, password, setCookie, nav) {
    login(username, password)
        .then(res => { if (res.status == 401) { return Promise.reject("Incorrect username or password") } else { return res.json() } })
        .then(data => {
            console.log("Setting username cookie to ", username)
            setCookie('weblens-username', username, { sameSite: "strict" })
            console.log("Setting session token to ", data.token)
            setCookie('weblens-login-token', data.token, { sameSite: "strict" })
            nav("/")
        })
        .catch((r) => { notifications.show({ message: r, color: "red" }) })
}

const Login = () => {
    const [userInput, setUserInput] = useState("")
    const [passInput, setPassInput] = useState("")
    const [tab, setTab] = useState("login")
    const nav = useNavigate()
    const loc = useLocation()
    const { authHeader, setCookie } = useContext(userContext)

    useEffect(() => {
        if (loc.state == null && authHeader.Authorization != "") {
            nav("/")
        }
    }, [authHeader])

    return (
        <Box height={"100vh"} width={"100vw"} display={"flex"} justifyContent={"center"} alignItems={"center"}
            sx={{ background: "linear-gradient(45deg, rgba(2,0,36,1) 0%, rgba(94,43,173,1) 50%, rgba(0,212,255,1) 100%);" }}
        >
            <Tabs value={tab} onChange={setTab} variant="pills">
                <Tabs.List grow>
                    <Tabs.Tab value="login" >
                        Login
                    </Tabs.Tab>
                    <Tabs.Tab value="signup" >
                        Sign Up
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="login">
                    <Fieldset>
                        <TextInput value={userInput} label='Username' placeholder='Username' onChange={(event) => setUserInput(event.currentTarget.value)} />
                        <TextInput value={passInput} label='Password' placeholder='Password' onChange={(event) => setPassInput(event.currentTarget.value)} />
                        <Space h={'md'} />
                        <Button fullWidth onClick={() => CheckCreds(userInput, passInput, setCookie, nav)}>Login</Button>
                    </Fieldset >
                </Tabs.Panel>
                <Tabs.Panel value="signup">
                    <Fieldset>
                        <TextInput value={userInput} label='Username' placeholder='Username' onChange={(event) => setUserInput(event.currentTarget.value)} />
                        <TextInput value={passInput} label='Password' placeholder='Password' onChange={(event) => setPassInput(event.currentTarget.value)} />
                        <Space h={'md'} />
                        <Button fullWidth>Sign Up</Button>
                    </Fieldset >
                </Tabs.Panel>
            </Tabs>
        </Box>
    )
}

export default Login