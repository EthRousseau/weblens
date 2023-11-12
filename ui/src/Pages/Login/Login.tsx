import { Box, Button, Input, Sheet, Typography, useTheme } from '@mui/joy'
import { useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EnqueueSnackbar, useSnackbar } from 'notistack'
import { login } from '../../api/ApiFetch'
import { userContext } from '../../Context'

function useKeyDown(doLogin) {
    const keyDownHandler = event => {
        if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            doLogin()
        }
    }
    useEffect(() => {
        window.addEventListener('keydown', keyDownHandler)
        return () => {
            window.removeEventListener('keydown', keyDownHandler)
        }
    }, [keyDownHandler])
}

function CheckCreds(username, password, setCookie, nav, snack: EnqueueSnackbar) {
    login(username, password)
        .then(res => { if (res.status == 401) { return Promise.reject("Incorrect username or password") } else { return res.json() } })
        .then(data => {
            console.log("Setting username cookie to ", username)
            setCookie('weblens-username', username, { sameSite: "strict" })
            console.log("Setting session token to ", data.token)
            setCookie('weblens-login-token', data.token, { sameSite: "strict" })
            console.log("Bouta nav")
            nav("/")
            console.log("Nav'd")
        })
        .catch((r) => { snack(r, { variant: "error" }) })
}

const Login = () => {
    const [userInput, setUserInput] = useState("")
    const [passInput, setPassInput] = useState("")
    const nav = useNavigate()
    const loc = useLocation()
    const theme = useTheme()
    const { enqueueSnackbar } = useSnackbar()
    const { authHeader, setCookie } = useContext(userContext)

    const doLogin = useMemo(() => {
        return () => { CheckCreds(userInput, passInput, setCookie, nav, enqueueSnackbar) }
    }, [userInput, passInput])

    useEffect(() => {
        if (loc.state == null && authHeader.Authorization != "") {
            nav("/")
        }
    }, [authHeader])

    return (
        <Box height={"100vh"} width={"100vw"} display={"flex"} justifyContent={"center"} alignItems={"center"}
            sx={{ background: "linear-gradient(45deg, rgba(2,0,36,1) 0%, rgba(94,43,173,1) 50%, rgba(0,212,255,1) 100%);" }}
        >
            <Sheet
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    padding: "20px",
                    bgcolor: `rgba(${theme.colorSchemes.dark.palette.primary.solidBg} / 0.5)`,
                    backdropFilter: "blur(8px)",
                    borderRadius: "8px"
                }}
            >
                <Typography color={'primary'} component={'h1'} fontSize={30} style={{ marginTop: -100, marginBottom: 50 }}>
                    Weblens
                </Typography>
                <Input
                    sx={{ backgroundColor: '#00000000' }}
                    placeholder='Username'
                    onChange={(e) => setUserInput(e.target.value)}
                />
                <Input
                    sx={{ backgroundColor: '#00000000' }}
                    placeholder='Password'
                    type="password"
                    onChange={(e) => setPassInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { doLogin() } }}
                />
                <Button
                    sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, ":hover": { backgroundColor: (theme) => theme.palette.primary.solidActiveBg } }}
                    style={{ height: "40px", width: "150px", margin: 10 }}
                    onClick={doLogin}
                >
                    Log in
                </Button>
                <Typography textColor={'white'} > or </Typography>
                <Button
                    sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, ":hover": { backgroundColor: (theme) => theme.palette.primary.solidActiveBg } }}
                    style={{ height: "40px", width: "150px", margin: 10 }}
                    onClick={() => nav("/signup")}
                >
                    Sign Up
                </Button>
            </Sheet>
        </Box>
    )
}

export default Login