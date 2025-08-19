import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { isAuthenticated, isAdmin } from '../lib/auth'

interface AuthRedirectProps {
  loadingText?: string
}

export default function AuthRedirect({ loadingText = 'Loading...' }: AuthRedirectProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isAuthenticated()) {
        if (isAdmin()) {
          router.push('/admin/create-user')
        } else {
          router.push('/user/query')
        }
      } else {
        router.push('/user/login')
      }
      setIsLoading(false)
    }, 100)
    return () => clearTimeout(timer)
  }, [router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 font-sans flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">{loadingText}</p>
        </div>
      </div>
    )
  }

  return null
}
