import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { RecordModel } from 'pocketbase'
import pb from '@/lib/pocketbase/client'

export const BOLAO_MEMBERS = ['Douglas', 'Gabriel', 'Bruno', 'Davi'] as const
export const ADMIN_MEMBER = 'Douglas'

export function isBolaoName(name?: string | null): boolean {
  if (!name) return false
  const trimmed = name.trim().toLowerCase()
  return BOLAO_MEMBERS.some((m) => m.toLowerCase() === trimmed)
}

export function isAdminName(name?: string | null): boolean {
  if (!name) return false
  return name.trim().toLowerCase() === ADMIN_MEMBER.toLowerCase()
}

interface AuthContextType {
  user: RecordModel | null
  token: string
  loading: boolean
  isBolaoMember: boolean
  isAdmin: boolean
  participantName: string | null
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: '',
  loading: true,
  isBolaoMember: false,
  isAdmin: false,
  participantName: null,
  logout: () => {},
  refreshUser: async () => {},
})

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<RecordModel | null>(pb.authStore.record)
  const [token, setToken] = useState<string>(pb.authStore.token)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    // Initial sync
    setUser(pb.authStore.record)
    setToken(pb.authStore.token)
    setLoading(false)

    // Listen to auth changes
    const unsubscribe = pb.authStore.onChange((newToken, newModel) => {
      setToken(newToken)
      setUser(newModel)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const participantName = useMemo(() => {
    if (!user) return null
    const name = (user.name || user.username || '').trim()
    const matched = BOLAO_MEMBERS.find((m) => m.toLowerCase() === name.toLowerCase())
    return matched ?? name
  }, [user])

  const isBolaoMember = useMemo(() => {
    return isBolaoName(user?.name)
  }, [user])

  const isAdmin = useMemo(() => {
    return isAdminName(user?.name)
  }, [user])

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
    setToken('')
  }

  const refreshUser = async () => {
    if (pb.authStore.isValid) {
      try {
        const refreshed = await pb.collection('users').authRefresh()
        setUser(refreshed.record)
        setToken(refreshed.token)
      } catch (_) {
        logout()
      }
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isBolaoMember,
        isAdmin,
        participantName,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
