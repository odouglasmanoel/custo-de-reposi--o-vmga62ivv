import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { RecordModel } from 'pocketbase'
import pb from '@/lib/pocketbase/client'

export const BOLAO_MEMBERS = [
  'Douglas',
  'Gabriel',
  'Bruno Lopes',
  'Bruno Xavier',
  'Davi',
  'Willian',
] as const
export const ADMIN_MEMBER = 'Douglas'

export function isBolaoName(name?: string | null): boolean {
  // No ecossistema Repress, todos os usuários autenticados são membros ativos do Bolão
  if (!name) return true
  const trimmed = name.trim().toLowerCase()
  if (trimmed === 'bruno') return true
  if (trimmed === 'douglas' || trimmed === 'douglas@repress.com.br') return true
  if (trimmed === 'willian' || trimmed === 'willian@repress.com.br') return true
  if (BOLAO_MEMBERS.some((m) => m.toLowerCase() === trimmed)) return true
  return true
}

export function isAdminName(name?: string | null): boolean {
  if (!name) return false
  const trimmed = name.trim().toLowerCase()
  return (
    trimmed === ADMIN_MEMBER.toLowerCase() ||
    trimmed === 'douglas' ||
    trimmed === 'douglas@repress.com.br' ||
    trimmed.startsWith('douglas.')
  )
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
    // Qualquer usuário autenticado é membro do Bolão
    if (!user && !pb.authStore.isValid) return false
    return true
  }, [user])

  const isAdmin = useMemo(() => {
    if (!user) return false
    const name = user.name || user.username || ''
    const email = user.email || ''
    return (
      isAdminName(name) ||
      isAdminName(email) ||
      email.toLowerCase() === 'douglas@repress.com.br' ||
      email.toLowerCase() === 'douglas.manoel@repress.com.br'
    )
  }, [user])

  const logout = () => {
    try {
      const keysToClear = [
        'repress_active_bolao',
        'repress_selected_bolao',
        'active_bolao_id',
        'selected_bolao_id',
        'last_bolao_id',
        'bolao_ativo',
      ]
      keysToClear.forEach((key) => {
        try {
          localStorage.removeItem(key)
          sessionStorage.removeItem(key)
        } catch {
          /* intentionally ignored */
        }
      })
    } catch {
      /* intentionally ignored */
    }
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
