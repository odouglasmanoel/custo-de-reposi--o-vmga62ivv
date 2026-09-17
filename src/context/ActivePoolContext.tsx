import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react'
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

  // Quando o usuário muda (login/logout), resetar estado estritamente para 'geral'
  useEffect(() => {
    try {
      // Limpar chaves legadas ou possíveis persistências em storage
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

    setSelectedBolaoId('geral')
    setCurrentParticipante(null)
  }, [user?.id])

  const refreshBoloes = useCallback(async () => {
    if (!user) {
      setBoloes([])
      setSelectedBolaoId('geral')
      setCurrentParticipante(null)
      setLoading(false)
      return
    }

    try {
      const records = await pb.collection('boloes').getFullList<Bolao>({
        sort: '-ativo,nome',
      })
      setBoloes(records)

      setSelectedBolaoId((prev) => {
        // Se já houver uma seleção válida e explicitamente setada nesta sessão
        if (prev === 'geral' || (prev && records.some((b) => b.id === prev))) {
          return prev
        }
        // Padrão do app: SEMPRE 'geral' (Todas as Copas)
        return 'geral'
      })
    } catch (err) {
      console.error('Erro ao carregar bolões:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refreshBoloes()
  }, [refreshBoloes])

  // Resolve current active bolao record with memoization to prevent recreating object on every render
  const activeBolao = useMemo(() => {
    if (selectedBolaoId === 'geral') {
      return {
        id: 'geral',
        nome: 'Geral (Todas as Copas)',
        ativo: true,
        foco: 'Ranking Geral Unificado',
        collectionId: '',
        collectionName: 'boloes',
        created: '',
        updated: '',
      } as Bolao
    }
    return boloes.find((b) => b.id === selectedBolaoId) || null
  }, [selectedBolaoId, boloes])

  // Guard ref para evitar disparos redundantes de busca de participante
  const lastParticipantQueryRef = useRef<string>('')

  // Fetch corresponding participant record for the active bolão and current user
  useEffect(() => {
    let cancelled = false
    const activeId = activeBolao?.id || ''
    const userId = user?.id || ''
    const searchName =
      participantName ||
      (user?.name as string) ||
      (user?.email ? (user.email as string).split('@')[0] : '')

    if (!user || !activeBolao) {
      lastParticipantQueryRef.current = ''
      setCurrentParticipante(null)
      return
    }

    const querySignature = `${userId}_${activeId}_${searchName}`
    if (lastParticipantQueryRef.current === querySignature) {
      return
    }

    const loadParticipante = async () => {
      // If active bolao is general, resolve participant using any available bolão or member list
      if (activeBolao.id === 'geral') {
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
              const resolved = exact || partial || parts[0]
              lastParticipantQueryRef.current = querySignature
              setCurrentParticipante(resolved)
              return
            }
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) {
          lastParticipantQueryRef.current = querySignature
          setCurrentParticipante(null)
        }
        return
      }

      if (!searchName) {
        lastParticipantQueryRef.current = querySignature
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
            lastParticipantQueryRef.current = querySignature
            setCurrentParticipante(exact)
            return
          }

          // Contains match
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          lastParticipantQueryRef.current = querySignature
          setCurrentParticipante(partial || null)
        } else if (!cancelled) {
          lastParticipantQueryRef.current = querySignature
          setCurrentParticipante(null)
        }
      } catch (err) {
        if (!cancelled) {
          lastParticipantQueryRef.current = querySignature
          setCurrentParticipante(null)
        }
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
        activeBolaoId: activeBolao?.id || 'geral',
        currentParticipante,
        loading,
        setActiveBolaoId: (id: string) => {
          setSelectedBolaoId(id)
        },
        refreshBoloes,
      }}
    >
      {children}
    </ActivePoolContext.Provider>
  )
}

export const useActivePool = () => useContext(ActivePoolContext)
