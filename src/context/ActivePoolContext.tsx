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
  const activeBolao = boloes.find((b) => b.id === selectedBolaoId) || null

  // Fetch corresponding participant record for the active bolão and current user
  useEffect(() => {
    let cancelled = false
    const loadParticipante = async () => {
      if (!user || !activeBolao || !isBolaoMember || !participantName) {
        setCurrentParticipante(null)
        return
      }

      try {
        const parts = await pb.collection('participantes').getFullList<Participante>({
          filter: `bolao = '${activeBolao.id}' && nome ~ '${participantName}'`,
        })

        if (!cancelled && parts.length > 0) {
          const exact = parts.find((p) => p.nome.toLowerCase() === participantName.toLowerCase())
          setCurrentParticipante(exact || parts[0])
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
  }, [user, activeBolao, isBolaoMember, participantName])

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
