import '../styles/global.css'
import type { AppProps } from 'next/app'
import { useEffect } from 'react'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    console.log('App starting - clearing authentication token')
    localStorage.removeItem('token')
    localStorage.removeItem('username')
  }, [])
  return <Component {...pageProps} />
}