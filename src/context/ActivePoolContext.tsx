import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Participante } from '@/types/bolao'
import { useAuth } from './AuthContext'

interface ActivePoolContextType {
  boloes: Bolao[]
  activeBolao: Bolao | null
  activeBolaoId: string | null
  currentParticipante: Participante | null
  loading: boolean
  setActiveBolaoId: (id: string) => void
  refreshBoloes: () => Promise<void>
}

const ActivePoolContext = createContext<ActivePoolContextType>({
  boloes: [],
  activeBolao: null,
  activeBolaoId: null,
  currentParticipante: null,
  loading: true,
  setActiveBolaoId: () => {},
  refreshBoloes: async () => {},
})

export const ActivePoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isBolaoMember, participantName } = useAuth()
  const [boloes, setBoloes] = useState<Bolao[]>([])
  const [selectedBolaoId, setSelectedBolaoId] = useState<string | null>(null)
  const [currentParticipante, setCurrentParticipante] = useState<Participante | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const refreshBoloes = useCallback(async () => {
    if (!user) {
      setBoloes([])
      setSelectedBolaoId(null)
      setCurrentParticipante(null)
      setLoading(false)
      return
    }

    try {
      const records = await pb.collection('boloes').getFullList<Bolao>({
        sort: '-ativo,nome',
      })
      setBoloes(records)

      if (records.length > 0) {
        setSelectedBolaoId((prev) => {
          if (prev && records.some((b) => b.id === prev)) return prev
          const active = records.find((b) => b.ativo)
          return active ? active.id : records[0].id
        })
      }
    } catch (err) {
      console.error('Erro ao carregar bolões:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refreshBoloes()
  }, [refreshBoloes])

  // Resolve current active bolao record
  const activeBolao =
    selectedBolaoId === 'geral'
      ? ({
          id: 'geral',
          nome: 'Geral (Todas as Copas)',
          ativo: true,
          foco: 'Ranking Geral Unificado',
          collectionId: '',
          collectionName: 'boloes',
          created: '',
          updated: '',
        } as Bolao)
      : boloes.find((b) => b.id === selectedBolaoId) || null

  // Fetch corresponding participant record for the active bolão and current user
  useEffect(() => {
    let cancelled = false
    const loadParticipante = async () => {
      if (!user || !activeBolao) {
        setCurrentParticipante(null)
        return
      }

      // If active bolao is general, resolve participant using any available bolão or member list
      if (activeBolao.id === 'geral') {
        const searchName =
          participantName ||
          (user.name as string) ||
          (user.email ? (user.email as string).split('@')[0] : '')
        if (searchName) {
          try {
            const parts = await pb.collection('participantes').getFullList<Participante>({
              sort: '-created',
            })
            if (!cancelled && parts.length > 0) {
              const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
              const partial = parts.find(
                (p) =>
                  p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
                  searchName.toLowerCase().includes(p.nome.toLowerCase()),
              )
              setCurrentParticipante(exact || partial || parts[0])
              return
            }
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) setCurrentParticipante(null)
        return
      }

      // Name to search: prioritize resolved participantName, fallback to user.name or user.email prefix
      const searchName =
        participantName ||
        (user.name as string) ||
        (user.email ? (user.email as string).split('@')[0] : '')

      if (!searchName) {
        setCurrentParticipante(null)
        return
      }

      try {
        const parts = await pb.collection('participantes').getFullList<Participante>({
          filter: `bolao = '${activeBolao.id}'`,
        })

        if (!cancelled && parts.length > 0) {
          // Exact match case-insensitive
          const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
          if (exact) {
            setCurrentParticipante(exact)
            return
          }

          // Contains match
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          setCurrentParticipante(partial || null)
        } else if (!cancelled) {
          setCurrentParticipante(null)
        }
      } catch (err) {
        if (!cancelled) setCurrentParticipante(null)
      }
    }

    loadParticipante()
    return () => {
      cancelled = true
    }
  }, [user, activeBolao, participantName])

  return (
    <ActivePoolContext.Provider
      value={{
        boloes,
        activeBolao,
        activeBolaoId: activeBolao?.id || null,
        currentParticipante,
        loading,
        setActiveBolaoId: setSelectedBolaoId,
        refreshBoloes,
      }}
    >
      {children}
    </ActivePoolContext.Provider>
  )
}

export const useActivePool = () => useContext(ActivePoolContext)
