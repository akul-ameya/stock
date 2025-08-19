import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { isAuthenticated, isAdmin } from '../lib/auth'

export function useAdminProtection() {
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/user/login')
      return
    }
    if (!isAdmin()) {
      router.push('/user/query')
      return
    }
  }, [router])
}

export function useUserProtection() {
  const router = useRouter()
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/user/login')
      return
    }
  }, [router])
}