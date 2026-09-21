import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  Sparkles,
  AlertCircle,
  Edit3,
  Lock,
  Globe,
  Filter,
  ArrowLeft,
  Users,
  RefreshCcw,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/AuthContext'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Jogo, Palpite, Participante, Bolao } from '@/types/bolao'
import { GERAL_BOLAO_ID } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import {
  formatDataBR,
  formatHoraBR,
  isPalpiteEncerrado,
  formatHoraEncerramento,
  normalizeDataISO,
  getJogoSortTimestamp,
  sortJogosCrescente,
  sortJogosDecrescente,
} from '@/lib/dateUtils'
import { getScoreBreakdownBadges } from '@/lib/scoreBadgeUtils'
import {
  formatPalpiteMarcadoresSummary,
  getPalpiteMarcadoresPorTime,
  formatScorersDisplayText,
} from '@/lib/scorerUtils'
import { buscarEscudoTime, readEscudoCache } from '@/services/enquetes'
import { GameLineupAccordion } from '@/components/GameLineupAccordion'
import { checkPlayerInLineup, LineupResponse } from '@/services/escalacoes'

interface PalpiteFormData {
  placar_a: number | string
  placar_b: number | string
  goleadores_a: string[]
  goleadores_b: string[]
  goleadores_contra_a?: boolean[]
  goleadores_contra_b?: boolean[]
  vencedor_penaltis: 'A' | 'B' | 'N' | string
}

interface PalpitesLocalCache {
  version: number
  timestamp: number
  jogos: Jogo[]
  palpites: Record<string, Palpite>
  formData: Record<string, PalpiteFormData>
  currentPage: number
  totalPages: number
  totalItems: number
  userParticipantsMap: Record<string, Participante>
}

const CACHE_PREFIX = 'cr_palpites_cache_v1'

function getLocalCacheKey(userId: string, targetBolao: string, filterPendentes: boolean): string {
  return `${CACHE_PREFIX}_${userId || 'anon'}_${targetBolao || 'all'}_${filterPendentes ? 'p1' : 'p0'}`
}

function readLocalCache(
  userId: string,
  targetBolao: string,
  filterPendentes: boolean,
): PalpitesLocalCache | null {
  try {
    const key = getLocalCacheKey(userId, targetBolao, filterPendentes)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PalpitesLocalCache
    if (!parsed || !Array.isArray(parsed.jogos)) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocalCache(
  userId: string,
  targetBolao: string,
  filterPendentes: boolean,
  data: Omit<PalpitesLocalCache, 'version' | 'timestamp'>,
) {
  try {
    const key = getLocalCacheKey(userId, targetBolao, filterPendentes)
    const payload: PalpitesLocalCache = {
      ...data,
      version: 1,
      timestamp: Date.now(),
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // localStorage pode estar indisponível ou cheio; ignora falhas de gravação de cache
  }
}

function normalizeScorersArray(
  raw: any,
  goalCount: number,
): { names: string[]; contraFlags: boolean[] } {
  let rawList: any[] = []
  if (Array.isArray(raw)) {
    rawList = raw
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        rawList = parsed
      } else {
        rawList = raw.split(',').map((s) => s.trim())
      }
    } catch (_) {
      rawList = raw.split(',').map((s) => s.trim())
    }
  }

  const names: string[] = []
  const contraFlags: boolean[] = []

  if (goalCount <= 0) {
    return { names: [], contraFlags: [] }
  }

  for (let i = 0; i < goalCount; i++) {
    const item = rawList[i]
    if (item && typeof item === 'object') {
      const nome = String(item.nome || '').trim()
      const isContra = Boolean(item.gol_contra || item.posicao === 'Gol Contra')
      names.push(nome)
      contraFlags.push(isContra)
    } else {
      const str = String(item || '').trim()
      const isContra = /\(gol contra\)|\(contra\)/i.test(str)
      const clean = str.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
      names.push(clean)
      contraFlags.push(isContra)
    }
  }

  return { names, contraFlags }
}

export default function Palpites() {
  const { user, participantName, isAdmin } = useAuth()
  const { boloes, activeBolao, activeBolaoId, currentParticipante } = useActivePool()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const isGeralParam = searchParams.get('geral') === '1' || activeBolaoId === GERAL_BOLAO_ID
  const pendentesRaw = searchParams.get('pendentes')
  // Padrão: true (Apenas Pendentes ativado por padrão em todas as copas e na visão geral)
  // Caso o usuário acesse explicitamente ?pendentes=0, desativa; se ?pendentes=1 ou omitido, inicia ativado (true)
  const initialPendentes = pendentesRaw === null ? true : pendentesRaw !== '0'

  const currentScopeKey = isGeralParam ? GERAL_BOLAO_ID : activeBolaoId || 'default'

  // Leitura inicial síncrona do cache local para renderização INSTANTÂNEA (SWR: stale-while-revalidate)
  const initialCache = useMemo(() => {
    const uid = (user?.id as string) || (user?.email as string) || ''
    return readLocalCache(uid, currentScopeKey, initialPendentes)
  }, [user?.id, user?.email, currentScopeKey, initialPendentes])

  const [jogos, setJogos] = useState<Jogo[]>(() => initialCache?.jogos || [])
  const [currentPage, setCurrentPage] = useState<number>(() => initialCache?.currentPage || 1)
  const [totalPages, setTotalPages] = useState<number>(() => initialCache?.totalPages || 1)
  const [totalItems, setTotalItems] = useState<number>(() => initialCache?.totalItems || 0)
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false)
  const [escudosMap, setEscudosMap] = useState<Record<string, string>>(() => {
    const initialMap: Record<string, string> = {}
    if (initialCache?.jogos) {
      for (const j of initialCache.jogos) {
        if (j.time_a) {
          const cA = readEscudoCache(j.time_a.trim())
          if (cA) initialMap[j.time_a.trim()] = cA
        }
        if (j.time_b) {
          const cB = readEscudoCache(j.time_b.trim())
          if (cB) initialMap[j.time_b.trim()] = cB
        }
      }
    }
    return initialMap
  })
  const [allBoloes, setAllBoloes] = useState<Bolao[]>([])
  const [participantesList, setParticipantesList] = useState<Participante[]>([])
  const [allGroupPalpites, setAllGroupPalpites] = useState<Palpite[]>([])
  const [userParticipantsMap, setUserParticipantsMap] = useState<Record<string, Participante>>(
    () => initialCache?.userParticipantsMap || {},
  )
  const [palpites, setPalpites] = useState<Record<string, Palpite>>(
    () => initialCache?.palpites || {},
  )
  const [formData, setFormData] = useState<Record<string, PalpiteFormData>>(
    () => initialCache?.formData || {},
  )
  const [editingGames, setEditingGames] = useState<Record<string, boolean>>({})
  const [savingGameId, setSavingGameId] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({})
  const [loadedLineups, setLoadedLineups] = useState<Record<string, LineupResponse>>({})
  const [adminEditingPalpite, setAdminEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
    timeA: string
    timeB: string
  } | null>(null)
  const [filterPendentes, setFilterPendentes] = useState<boolean>(initialPendentes)
  const [selectedCompeticao, setSelectedCompeticao] = useState<string>('todas')
  const [manualSort, setManualSort] = useState<'asc' | 'desc' | null>(null)
  const [loadingGroupBets, setLoadingGroupBets] = useState(false)
  const [loadedGroupBets, setLoadedGroupBets] = useState(false)
  const [expandedGroupBets, setExpandedGroupBets] = useState<Record<string, boolean>>({})
  const [selectedBetByGame, setSelectedBetByGame] = useState<Record<string, string>>({})
  // Se houver cache inicial para este escopo, a tela NÃO bloqueia em spinner, entra revalidando em background
  const [loading, setLoading] = useState(() => !initialCache || initialCache.jogos.length === 0)
  const [isBackgroundRevalidating, setIsBackgroundRevalidating] = useState(
    () => !!(initialCache && initialCache.jogos.length > 0),
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(Date.now())

  // Referências para deduplicação e controle de concorrência
  const activeLoadPromiseRef = useRef<Promise<void> | null>(null)
  const activeGroupBetsPromiseRef = useRef<Promise<void> | null>(null)
  const lastLoadTimeRef = useRef<number>(0)
  // Referência para chave de contexto anterior para carregar cache na troca de copa/filtro
  const prevScopeRef = useRef<string>(`${currentScopeKey}_${initialPendentes}`)

  // Atualiza periodicamente o horário atual para sincronizar o bloqueio de encerramento em tempo real
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  // Carregamento de escudos para os times exibidos nos cards
  useEffect(() => {
    if (!jogos || jogos.length === 0) return

    const teamNames = new Set<string>()
    for (const j of jogos) {
      if (j.time_a && j.time_a.trim()) teamNames.add(j.time_a.trim())
      if (j.time_b && j.time_b.trim()) teamNames.add(j.time_b.trim())
    }

    const missingTeams: string[] = []
    const initialFound: Record<string, string> = {}

    teamNames.forEach((t) => {
      const cached = readEscudoCache(t)
      if (cached) {
        initialFound[t] = cached
      } else {
        missingTeams.push(t)
      }
    })

    if (Object.keys(initialFound).length > 0) {
      setEscudosMap((prev) => ({ ...prev, ...initialFound }))
    }

    if (missingTeams.length > 0) {
      let isMounted = true
      Promise.all(
        missingTeams.map(async (time) => {
          try {
            const url = await buscarEscudoTime(time)
            return { time, url }
          } catch {
            return { time, url: '' }
          }
        }),
      ).then((results) => {
        if (!isMounted) return
        setEscudosMap((prev) => {
          const next = { ...prev }
          for (const res of results) {
            if (res.url) {
              next[res.time] = res.url
            }
          }
          return next
        })
      })

      return () => {
        isMounted = false
      }
    }
  }, [jogos])

  // Sincronizar filtro se a query string mudar na navegação
  useEffect(() => {
    if (pendentesRaw !== null) {
      setFilterPendentes(pendentesRaw !== '0')
    }
  }, [pendentesRaw])

  // Hidratação instantânea do cache local ao trocar de bolão ou filtro (SWR local)
  useEffect(() => {
    const scopeKey = `${currentScopeKey}_${filterPendentes}`
    if (scopeKey !== prevScopeRef.current) {
      prevScopeRef.current = scopeKey
      setCurrentPage(1)
      setLoadedGroupBets(false)
      setExpandedGroupBets({})
      setSelectedBetByGame({})
      setAllGroupPalpites([])

      const uid = (user?.id as string) || (user?.email as string) || ''
      const cached = readLocalCache(uid, currentScopeKey, filterPendentes)
      if (cached && cached.jogos.length > 0) {
        setJogos(cached.jogos)
        setPalpites(cached.palpites || {})
        setFormData(cached.formData || {})
        setUserParticipantsMap(cached.userParticipantsMap || {})
        setCurrentPage(cached.currentPage || 1)
        setTotalPages(cached.totalPages || 1)
        setTotalItems(cached.totalItems || cached.jogos.length)
        const cachedShields: Record<string, string> = {}
        for (const j of cached.jogos) {
          if (j.time_a) {
            const cA = readEscudoCache(j.time_a.trim())
            if (cA) cachedShields[j.time_a.trim()] = cA
          }
          if (j.time_b) {
            const cB = readEscudoCache(j.time_b.trim())
            if (cB) cachedShields[j.time_b.trim()] = cB
          }
        }
        if (Object.keys(cachedShields).length > 0) {
          setEscudosMap((prev) => ({ ...prev, ...cachedShields }))
        }
        setLoading(false)
        setIsBackgroundRevalidating(true)
      } else {
        // Sem cache para a nova copa/filtro: exibe skeleton/loading enquanto busca
        setJogos([])
        setLoading(true)
        setIsBackgroundRevalidating(false)
      }
    }
  }, [currentScopeKey, filterPendentes, user?.id, user?.email])

  // Carregamento SOB DEMANDA dos palpites do grupo (apenas quando solicitado pelo usuário)
  // Deduplicado para nunca disparar chamadas concorrentes repetidas
  const loadGroupBetsOnDemand = useCallback(async () => {
    if (loadedGroupBets) return
    if (activeGroupBetsPromiseRef.current) {
      return activeGroupBetsPromiseRef.current
    }

    setLoadingGroupBets(true)

    const fetchTask = async () => {
      try {
        if (isGeralParam) {
          const [allParts, allGroupBets] = await Promise.all([
            pb.collection('participantes').getFullList<Participante>({
              sort: 'nome',
              fields: 'id,nome,bolao',
            }),
            pb.collection('palpites').getFullList<Palpite>({
              fields:
                'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,pontuacao_jogo,vencedor_penaltis,detalhamento',
            }),
          ])
          setParticipantesList(allParts)
          setAllGroupPalpites(allGroupBets)
        } else {
          const currentTargetBolaoId =
            activeBolaoId && activeBolaoId !== GERAL_BOLAO_ID
              ? activeBolaoId
              : boloes.find((b) => b.ativo)?.id || boloes[0]?.id
          if (currentTargetBolaoId) {
            const [parts, bets] = await Promise.all([
              pb.collection('participantes').getFullList<Participante>({
                filter: `bolao = '${currentTargetBolaoId}'`,
                sort: 'nome',
                fields: 'id,nome,bolao',
              }),
              pb.collection('palpites').getFullList<Palpite>({
                filter: `bolao = '${currentTargetBolaoId}'`,
                fields:
                  'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,pontuacao_jogo,vencedor_penaltis,detalhamento',
              }),
            ])
            setParticipantesList(parts)
            setAllGroupPalpites(bets)
          }
        }
        setLoadedGroupBets(true)
      } catch (err) {
        console.warn('Erro ao carregar palpites do grupo sob demanda:', err)
      } finally {
        setLoadingGroupBets(false)
        activeGroupBetsPromiseRef.current = null
      }
    }

    const promise = fetchTask()
    activeGroupBetsPromiseRef.current = promise
    return promise
  }, [loadedGroupBets, isGeralParam, activeBolaoId, boloes])

  const handleToggleGroupBets = useCallback(
    async (jogoId: string) => {
      const isCurrentlyExpanded = Boolean(expandedGroupBets[jogoId])
      const willBeExpanded = !isCurrentlyExpanded

      setExpandedGroupBets((prev) => ({
        ...prev,
        [jogoId]: willBeExpanded,
      }))

      if (willBeExpanded && !loadedGroupBets) {
        await loadGroupBetsOnDemand()
      }
    },
    [expandedGroupBets, loadedGroupBets, loadGroupBetsOnDemand],
  )

  // Carregamento principal dos jogos e palpites do usuário logado
  // Com LIMIT 20 real na query (getList(page, 20)), filtro de pendentes no backend
  // e projeção de campos estritamente necessários via `fields`.
  const loadData = useCallback(
    async (pageToLoad: number = 1, isManualRefresh: boolean = false, append: boolean = false) => {
      if (!user) return

      const now = Date.now()
      if (!isManualRefresh && !append && now - lastLoadTimeRef.current < 2500) {
        return
      }

      if (activeLoadPromiseRef.current) {
        return activeLoadPromiseRef.current
      }

      // Se já temos jogos em tela (ex: via cache local), não exibe spinner de tela inteira:
      // apenas sinaliza revalidação discreta em background
      const hasExistingData = !append && jogos.length > 0

      if (isManualRefresh) {
        setIsRefreshing(true)
      } else if (append) {
        setIsLoadingMore(true)
      } else if (hasExistingData) {
        setIsBackgroundRevalidating(true)
      } else {
        setLoading(true)
      }

      const fetchTask = async () => {
        lastLoadTimeRef.current = Date.now()
        setLoadError(null)

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Tempo de resposta excedido ao buscar palpites')),
            10000,
          ),
        )

        try {
          const searchName =
            participantName ||
            (user.name as string) ||
            (user.email ? (user.email as string).split('@')[0] : '')

          // Buscar lista de bolões com campos essenciais para exibir nome e tema
          const loadedBoloes =
            boloes.length > 0
              ? boloes
              : await pb.collection('boloes').getFullList<Bolao>({
                  sort: 'nome',
                  fields: 'id,nome,foco,ativo',
                })
          setAllBoloes(loadedBoloes)

          // Montar filtro de consulta de jogos:
          // Se filterPendentes estiver ativo, busca apenas resultado_finalizado = false
          // Se MODO BOLÃO ESPECÍFICO, filtra pelo bolao selecionado
          let gamesFilter = ''
          if (filterPendentes) {
            gamesFilter = 'resultado_finalizado = false'
          }

          if (isGeralParam) {
            // MODO GERAL: Carregamento completo de todos os jogos do bolão geral (sem corte de 20 que oculta datas futuras)
            const gamesListPromise = pb.collection('jogos').getFullList<Jogo>({
              filter: gamesFilter || undefined,
              sort: 'data,hora',
              fields:
                'id,bolao,time_a,time_b,data,hora,competicao,resultado_finalizado,placar_a,placar_b,tem_penaltis,vencedor_penaltis,fixture_id',
            })

            // Buscar registros de participante deste usuário
            const myPartsPromise = pb.collection('participantes').getFullList<Participante>({
              filter: `nome ~ '${searchName.replace(/'/g, "\\'")}'`,
              fields: 'id,nome,bolao',
            })

            const [gamesResult, myParts] = await Promise.race([
              Promise.all([gamesListPromise, myPartsPromise]),
              timeoutPromise,
            ])

            const myPartMapByBolao: Record<string, Participante> = {}
            for (const p of myParts) {
              myPartMapByBolao[p.bolao] = p
            }
            setUserParticipantsMap(myPartMapByBolao)

            // Buscar palpites do usuário logado para as partidas retornadas (usando índice idx_palpites_participante direto)
            const loadedGameIds = gamesResult.map((j) => j.id)
            let myPalpites: Palpite[] = []

            if (loadedGameIds.length > 0 && myParts.length > 0) {
              const filterUserPartIds = myParts.map((p) => `participante = '${p.id}'`).join(' || ')

              myPalpites = await Promise.race([
                pb.collection('palpites').getFullList<Palpite>({
                  filter: filterUserPartIds,
                  fields:
                    'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento',
                }),
                timeoutPromise,
              ])
            }

            setCurrentPage(1)
            setTotalPages(1)
            setTotalItems(gamesResult.length)

            if (append) {
              setJogos((prev) => {
                const existingMap = new Map(prev.map((j) => [j.id, j]))
                for (const item of gamesResult) {
                  existingMap.set(item.id, item)
                }
                return Array.from(existingMap.values())
              })
            } else {
              setJogos(gamesResult)
            }

            const nextPalpitesMap: Record<string, Palpite> = append ? { ...palpites } : {}
            for (const p of myPalpites) {
              nextPalpitesMap[p.jogo] = p
            }
            setPalpites(nextPalpitesMap)

            const nextFormDataMap: Record<string, PalpiteFormData> = append ? { ...formData } : {}
            for (const p of myPalpites) {
              const gA = p.placar_a !== null && p.placar_a !== undefined ? Number(p.placar_a) : 0
              const gB = p.placar_b !== null && p.placar_b !== undefined ? Number(p.placar_b) : 0
              const normA = normalizeScorersArray(p.goleadores_a, gA)
              const normB = normalizeScorersArray(p.goleadores_b, gB)
              nextFormDataMap[p.jogo] = {
                placar_a: p.placar_a ?? '',
                placar_b: p.placar_b ?? '',
                goleadores_a: normA.names,
                goleadores_b: normB.names,
                goleadores_contra_a: normA.contraFlags,
                goleadores_contra_b: normB.contraFlags,
                vencedor_penaltis: p.vencedor_penaltis || 'N',
              }
            }
            setFormData(nextFormDataMap)

            // Grava no cache local para renderização instantânea nas próximas visitas (SWR)
            const uid = (user.id as string) || (user.email as string) || ''
            writeLocalCache(uid, GERAL_BOLAO_ID, filterPendentes, {
              jogos: gamesResult,
              palpites: nextPalpitesMap,
              formData: nextFormDataMap,
              currentPage: 1,
              totalPages: 1,
              totalItems: gamesResult.length,
              userParticipantsMap: myPartMapByBolao,
            })
          } else {
            // MODO BOLÃO ESPECÍFICO: Buscar conjunto completo de jogos do bolão selecionado
            const currentTargetBolaoId =
              activeBolaoId && activeBolaoId !== GERAL_BOLAO_ID
                ? activeBolaoId
                : loadedBoloes.find((b) => b.ativo)?.id || loadedBoloes[0]?.id

            if (!currentTargetBolaoId) {
              setLoading(false)
              setIsRefreshing(false)
              setIsLoadingMore(false)
              return
            }

            let participanteId = currentParticipante?.id
            if (!participanteId || currentParticipante?.bolao !== currentTargetBolaoId) {
              if (searchName) {
                try {
                  const parts = await pb.collection('participantes').getFullList<Participante>({
                    filter: `bolao = '${currentTargetBolaoId}' && (nome ~ '${searchName.replace(/'/g, "\\'")}')`,
                    fields: 'id,nome,bolao',
                  })
                  const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
                  const partial = parts.find(
                    (p) =>
                      p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
                      searchName.toLowerCase().includes(p.nome.toLowerCase()),
                  )
                  const resolved = exact || partial || parts[0]
                  if (resolved) {
                    participanteId = resolved.id
                    setUserParticipantsMap({ [currentTargetBolaoId]: resolved })
                  }
                } catch {
                  /* ignore */
                }
              }
            } else if (currentParticipante) {
              setUserParticipantsMap({ [currentTargetBolaoId]: currentParticipante })
            }

            const specificFilter = gamesFilter
              ? `bolao = '${currentTargetBolaoId}' && ${gamesFilter}`
              : `bolao = '${currentTargetBolaoId}'`

            const gamesListPromise = pb.collection('jogos').getFullList<Jogo>({
              filter: specificFilter,
              sort: 'data,hora',
              fields:
                'id,bolao,time_a,time_b,data,hora,competicao,resultado_finalizado,placar_a,placar_b,tem_penaltis,vencedor_penaltis,fixture_id',
            })

            const [gamesResult] = await Promise.race([
              Promise.all([gamesListPromise]),
              timeoutPromise,
            ])

            const loadedGameIds = gamesResult.map((j) => j.id)
            let myPalpites: Palpite[] = []

            if (participanteId && loadedGameIds.length > 0) {
              myPalpites = await Promise.race([
                pb.collection('palpites').getFullList<Palpite>({
                  filter: `bolao = '${currentTargetBolaoId}' && participante = '${participanteId}'`,
                  fields:
                    'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento',
                }),
                timeoutPromise,
              ])
            }

            setCurrentPage(1)
            setTotalPages(1)
            setTotalItems(gamesResult.length)

            if (append) {
              setJogos((prev) => {
                const existingMap = new Map(prev.map((j) => [j.id, j]))
                for (const item of gamesResult) {
                  existingMap.set(item.id, item)
                }
                return Array.from(existingMap.values())
              })
            } else {
              setJogos(gamesResult)
            }

            const nextPalpitesMap: Record<string, Palpite> = append ? { ...palpites } : {}
            for (const p of myPalpites) {
              nextPalpitesMap[p.jogo] = p
            }
            setPalpites(nextPalpitesMap)

            const nextFormDataMap: Record<string, PalpiteFormData> = append ? { ...formData } : {}
            for (const p of myPalpites) {
              const gA = p.placar_a !== null && p.placar_a !== undefined ? Number(p.placar_a) : 0
              const gB = p.placar_b !== null && p.placar_b !== undefined ? Number(p.placar_b) : 0
              const normA = normalizeScorersArray(p.goleadores_a, gA)
              const normB = normalizeScorersArray(p.goleadores_b, gB)
              nextFormDataMap[p.jogo] = {
                placar_a: p.placar_a ?? '',
                placar_b: p.placar_b ?? '',
                goleadores_a: normA.names,
                goleadores_b: normB.names,
                goleadores_contra_a: normA.contraFlags,
                goleadores_contra_b: normB.contraFlags,
                vencedor_penaltis: p.vencedor_penaltis || 'N',
              }
            }
            setFormData(nextFormDataMap)

            // Grava no cache local para renderização instantânea nas próximas visitas (SWR)
            const uid = (user.id as string) || (user.email as string) || ''
            writeLocalCache(uid, currentTargetBolaoId, filterPendentes, {
              jogos: gamesResult,
              palpites: nextPalpitesMap,
              formData: nextFormDataMap,
              currentPage: 1,
              totalPages: 1,
              totalItems: gamesResult.length,
              userParticipantsMap: userParticipantsMap,
            })
          }
        } catch (err) {
          console.warn('Alerta ao carregar palpites (preservando estado atual):', err)
          // Servido instantaneamente e silenciosamente — sem banner de lentidão
        } finally {
          setLoading(false)
          setIsRefreshing(false)
          setIsBackgroundRevalidating(false)
          setIsLoadingMore(false)
          activeLoadPromiseRef.current = null
        }
      }

      const promise = fetchTask()
      activeLoadPromiseRef.current = promise
      return promise
    },
    [
      user,
      participantName,
      boloes,
      isGeralParam,
      activeBolaoId,
      currentParticipante,
      filterPendentes,
    ],
  )

  useRealtime<Jogo>('jogos', () => {
    loadData(1, false, false)
  })

  useRealtime<Palpite>('palpites', () => {
    loadData(1, false, false)
  })

  useEffect(() => {
    loadData(1, false, false)
  }, [activeBolaoId, isGeralParam, filterPendentes, currentParticipante, loadData])

  const handleLoadMore = () => {
    if (currentPage < totalPages && !isLoadingMore) {
      loadData(currentPage + 1, false, true)
    }
  }

  const handleScoreChange = (jogoId: string, team: 'a' | 'b', rawVal: string) => {
    const valNum = rawVal === '' ? '' : Math.max(0, parseInt(rawVal, 10) || 0)
    setFormData((prev) => {
      const cur = prev[jogoId] || {
        placar_a: '',
        placar_b: '',
        goleadores_a: [],
        goleadores_b: [],
        vencedor_penaltis: 'N',
      }

      if (team === 'a') {
        const goalCount = typeof valNum === 'number' ? valNum : 0
        const updated = normalizeScorersArray(cur.goleadores_a, goalCount)
        // Preserva flags existentes se houver
        const nextContraFlags = Array.from({ length: goalCount }).map(
          (_, i) => cur.goleadores_contra_a?.[i] ?? updated.contraFlags[i] ?? false,
        )
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            placar_a: valNum,
            goleadores_a: updated.names,
            goleadores_contra_a: nextContraFlags,
          },
        }
      } else {
        const goalCount = typeof valNum === 'number' ? valNum : 0
        const updated = normalizeScorersArray(cur.goleadores_b, goalCount)
        const nextContraFlags = Array.from({ length: goalCount }).map(
          (_, i) => cur.goleadores_contra_b?.[i] ?? updated.contraFlags[i] ?? false,
        )
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            placar_b: valNum,
            goleadores_b: updated.names,
            goleadores_contra_b: nextContraFlags,
          },
        }
      }
    })
  }

  const handleScorerLineChange = (
    jogoId: string,
    team: 'a' | 'b',
    index: number,
    nameValue: string,
  ) => {
    setFormData((prev) => {
      const cur = prev[jogoId] || {
        placar_a: '',
        placar_b: '',
        goleadores_a: [],
        goleadores_b: [],
        vencedor_penaltis: 'N',
      }

      if (team === 'a') {
        const list = [...(cur.goleadores_a || [])]
        list[index] = nameValue
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_a: list,
          },
        }
      } else {
        const list = [...(cur.goleadores_b || [])]
        list[index] = nameValue
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_b: list,
          },
        }
      }
    })
  }

  const handleScorerContraChange = (
    jogoId: string,
    team: 'a' | 'b',
    index: number,
    checked: boolean,
  ) => {
    setFormData((prev) => {
      const cur = prev[jogoId] || {
        placar_a: '',
        placar_b: '',
        goleadores_a: [],
        goleadores_b: [],
        vencedor_penaltis: 'N',
      }

      if (team === 'a') {
        const flags = [...(cur.goleadores_contra_a || [])]
        flags[index] = checked
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_contra_a: flags,
          },
        }
      } else {
        const flags = [...(cur.goleadores_contra_b || [])]
        flags[index] = checked
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_contra_b: flags,
          },
        }
      }
    })
  }

  const handlePenaltisChange = (jogoId: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [jogoId]: {
        ...(prev[jogoId] || {
          placar_a: '',
          placar_b: '',
          goleadores_a: [],
          goleadores_b: [],
          vencedor_penaltis: 'N',
        }),
        vencedor_penaltis: value,
      },
    }))
  }

  const handleSavePalpite = async (jogo: Jogo) => {
    // Validação preventiva no frontend: verificar se o horário do jogo já foi atingido (Fuso Brasília UTC-3)
    if (isPalpiteEncerrado(jogo.data, jogo.hora, Date.now())) {
      const horaEncerramento = formatHoraEncerramento(jogo.hora)
      toast({
        title: 'Palpites encerrados',
        description: `Não foi possível salvar: os palpites para este jogo foram encerrados às ${horaEncerramento}`,
        variant: 'destructive',
      })
      // Desabilita modo de edição
      setEditingGames((prev) => ({
        ...prev,
        [jogo.id]: false,
      }))
      return
    }

    const jogoBolaoId = jogo.bolao || activeBolaoId
    if (!jogoBolaoId) return

    // Resolve participante específico para o bolão deste jogo
    let participanteToUse = userParticipantsMap[jogoBolaoId] || currentParticipante
    if (!participanteToUse || participanteToUse.bolao !== jogoBolaoId) {
      const searchName =
        participantName ||
        (user?.name as string) ||
        (user?.email ? (user.email as string).split('@')[0] : '')
      if (searchName) {
        try {
          const parts = await pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${jogoBolaoId}'`,
          })
          const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          participanteToUse = exact || partial || parts[0] || null
        } catch {
          /* intentionally ignored */
        }
      }
    }

    if (!participanteToUse) {
      toast({
        title: 'Participante não identificado',
        description: 'Não foi possível encontrar seu cadastro de participante neste bolão.',
        variant: 'destructive',
      })
      return
    }

    const currentForm = formData[jogo.id]

    if (
      currentForm?.placar_a === '' ||
      currentForm?.placar_a === undefined ||
      currentForm?.placar_b === '' ||
      currentForm?.placar_b === undefined
    ) {
      toast({
        title: 'Preencha o placar',
        description: 'Informe os gols previstos para os dois times.',
        variant: 'destructive',
      })
      return
    }

    setSavingGameId(jogo.id)
    try {
      const numA = Number(currentForm.placar_a)
      const numB = Number(currentForm.placar_b)

      // Regras de marcadores com suporte a "Gol Contra":
      // Se o marcador estiver marcado como gol contra, formata com "Nome (gol contra)"
      const gA: string[] = []
      if (numA > 0 && Array.isArray(currentForm.goleadores_a)) {
        for (let i = 0; i < numA; i++) {
          const rawName = (currentForm.goleadores_a[i] || '').trim()
          if (!rawName) continue
          const isContra = Boolean(currentForm.goleadores_contra_a?.[i])
          const cleanName = rawName.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
          gA.push(isContra ? `${cleanName} (gol contra)` : cleanName)
        }
      }

      const gB: string[] = []
      if (numB > 0 && Array.isArray(currentForm.goleadores_b)) {
        for (let i = 0; i < numB; i++) {
          const rawName = (currentForm.goleadores_b[i] || '').trim()
          if (!rawName) continue
          const isContra = Boolean(currentForm.goleadores_contra_b?.[i])
          const cleanName = rawName.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
          gB.push(isContra ? `${cleanName} (gol contra)` : cleanName)
        }
      }

      // Marcadores time A e B: texto simples separado por vírgulas ("" ou null quando o time fez 0 gols, incluindo o caso 0x0)
      const marcadoresTimeA = numA > 0 ? gA.join(', ') : ''
      const marcadoresTimeB = numB > 0 ? gB.join(', ') : ''
      const vencedorPenaltis = currentForm.vencedor_penaltis || 'N'

      // Payload explícito enviado para o endpoint server-side /backend/v1/salvar-palpite:
      // - jogo_id (ID do jogo)
      // - usuario_email ou usuario_id (identificação do usuário)
      // - gols_time_a e gols_time_b (inteiros)
      // - marcadores_time_a e marcadores_time_b (texto simples separado por vírgulas, "" ou null para 0 gols)
      // - vencedor_penaltis
      const userEmail = (user?.email as string) || ''
      const userId = (user?.id as string) || ''

      const response = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/salvar-palpite`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: pb.authStore.token,
          },
          body: JSON.stringify({
            jogo_id: jogo.id,
            bolao_id: jogoBolaoId,
            participante_id: participanteToUse.id,
            usuario_email: userEmail,
            usuario_id: userId,
            gols_time_a: numA,
            gols_time_b: numB,
            marcadores_time_a: numA > 0 ? marcadoresTimeA : '',
            marcadores_time_b: numB > 0 ? marcadoresTimeB : '',
            vencedor_penaltis: vencedorPenaltis,
            placar_a: numA,
            placar_b: numB,
            goleadores_a: gA,
            goleadores_b: gB,
          }),
        },
      )

      if (!response.ok) {
        const resJson = await response.json().catch(() => ({}))
        throw new Error(resJson.error || 'Erro ao salvar palpite no servidor')
      }

      toast({
        title: 'Palpite salvo com sucesso!',
        description: `Palpite para ${jogo.time_a} x ${jogo.time_b} registrado.`,
      })
      setEditingGames((prev) => ({
        ...prev,
        [jogo.id]: false,
      }))
      await loadData(1, false, false)
    } catch (err: unknown) {
      console.error('Erro ao salvar palpite:', err)
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as any).message)
            : 'Falha na comunicação com o servidor'
      toast({
        title: 'Erro ao registrar palpite',
        description: errorMsg,
        variant: 'destructive',
      })
    } finally {
      setSavingGameId(null)
    }
  }

  const toggleDetails = useCallback((jogoId: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [jogoId]: !prev[jogoId],
    }))
  }, [])

  // Mapear id do bolão para o objeto do bolão para rótulos fáceis
  const bolaoMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of allBoloes) {
      map.set(b.id, b)
    }
    return map
  }, [allBoloes])

  // Mapear id do participante para o objeto Participante
  const participanteMap = useMemo(() => {
    const map = new Map<string, Participante>()
    for (const p of participantesList) {
      map.set(p.id, p)
    }
    return map
  }, [participantesList])

  // Opções fixas de filtragem por Copa interna do sistema
  const FIXED_COPAS = useMemo(
    () => ['Copa Coni', 'Copa Genilton', 'Copa Sormani', 'Copa do Mundo'],
    [],
  )

  // Lista filtrada por Copa interna (tag/categoria vinculada ao bolão do jogo) antes da ordenação
  const filteredJogos = useMemo(() => {
    if (!selectedCompeticao || selectedCompeticao === 'todas') {
      return jogos
    }

    const targetCopaNormalized = selectedCompeticao.trim().toLowerCase()
    return jogos.filter((j) => {
      // 1. Verifica se o bolão vinculado ao jogo tem o nome da copa
      const bolao = bolaoMap.get(j.bolao)
      const nomeBolao = (bolao?.nome || '').trim().toLowerCase()
      if (nomeBolao === targetCopaNormalized) {
        return true
      }

      // 2. Fallback caso a tag da copa interna esteja preenchida no campo competicao do jogo
      const compJogo = (j.competicao || '').trim().toLowerCase()
      if (compJogo.startsWith(targetCopaNormalized) || compJogo.includes(targetCopaNormalized)) {
        return true
      }

      return false
    })
  }, [jogos, selectedCompeticao, bolaoMap])

  // Quando manualSort for null: se filterPendentes estiver ativo, o padrão é 'asc' (jogos mais próximos no tempo primeiro);
  // se filterPendentes estiver desativado (ver todos os jogos), o padrão permanece 'desc' (mais recente primeiro).
  const defaultSortOrder: 'asc' | 'desc' = filterPendentes ? 'asc' : 'desc'
  const sortOrder: 'asc' | 'desc' = manualSort !== null ? manualSort : defaultSortOrder

  const displayedJogos = useMemo(() => {
    const copy = [...filteredJogos]
    return copy.sort((a, b) => {
      const tsA = getJogoSortTimestamp(a.data, a.hora)
      const tsB = getJogoSortTimestamp(b.data, b.hora)
      if (sortOrder === 'desc') {
        return tsB - tsA // Do mais recente/distante/futuro para o mais antigo
      } else {
        return tsA - tsB // Do mais antigo/próximo para o mais distante
      }
    })
  }, [filteredJogos, sortOrder])
  const hasMore = currentPage < totalPages

  function TeamShield({
    escudo,
    nomeTime,
    sigla,
    sizeClass = 'h-10 w-10 sm:h-12 sm:w-12',
    textClass = 'text-xs font-bold text-slate-700',
  }: {
    escudo: string | undefined
    nomeTime: string
    sigla: string
    sizeClass?: string
    textClass?: string
  }) {
    const [hasError, setHasError] = useState(false)
    if (!escudo || hasError) {
      return (
        <div
          className={`${sizeClass} rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center ${textClass}`}
        >
          {sigla}
        </div>
      )
    }
    return (
      <img
        src={escudo}
        alt={nomeTime}
        className={`${sizeClass} object-contain drop-shadow-xs`}
        loading="eager"
        decoding="async"
        onError={() => setHasError(true)}
      />
    )
  }

  // Subcomponente de Card de Palpite individual memoizado com React.memo
  const PalpiteItemCard = useMemo(() => {
    return React.memo(
      function PalpiteItemCard({
        jogo,
        bolaoOrigem,
        palpite,
        form,
        finalizado,
        pontos,
        detalhamento,
        escudoA,
        escudoB,
        initialsA,
        initialsB,
        isEditing,
        isExpired,
        isSaved,
        isLocked,
        nowMs,
        savingGameId,
        loadedGroupBets,
        loadingGroupBets,
        isGroupBetsExpanded,
        selectedBetId,
        onSelectBet,
        betsForGame,
        participanteMap,
        participantName,
        isAdmin,
        expandedDetails,
        currentLineup,
        onLineupLoaded,
        onToggleDetails,
        onToggleGroupBets,
        onSetEditing,
        onCancelEditing,
        onScoreChange,
        onScorerLineChange,
        onScorerContraChange,
        onPenaltisChange,
        onSavePalpite,
        onAdminEdit,
      }: {
        jogo: Jogo
        bolaoOrigem: Bolao | undefined
        palpite: Palpite | undefined
        form: PalpiteFormData
        finalizado: boolean | undefined
        pontos: number
        detalhamento: string[]
        escudoA: string | undefined
        escudoB: string | undefined
        initialsA: string
        initialsB: string
        isEditing: boolean
        isExpired: boolean
        isSaved: boolean
        isLocked: boolean
        nowMs: number
        savingGameId: string | null
        loadedGroupBets: boolean
        loadingGroupBets: boolean
        isGroupBetsExpanded: boolean
        selectedBetId: string | undefined
        onSelectBet: (betId: string) => void
        betsForGame: Palpite[]
        participanteMap: Map<string, Participante>
        participantName: string
        isAdmin: boolean
        expandedDetails: boolean
        currentLineup: LineupResponse | undefined
        onLineupLoaded: (lineup: LineupResponse) => void
        onToggleDetails: (id: string) => void
        onToggleGroupBets: () => void
        onSetEditing: (id: string, editing: boolean) => void
        onCancelEditing: (id: string, palpite: Palpite | undefined) => void
        onScoreChange: (jogoId: string, side: 'a' | 'b', val: string) => void
        onScorerLineChange: (jogoId: string, side: 'a' | 'b', index: number, val: string) => void
        onScorerContraChange: (
          jogoId: string,
          side: 'a' | 'b',
          index: number,
          checked: boolean,
        ) => void
        onPenaltisChange: (jogoId: string, val: string) => void
        onSavePalpite: (jogo: Jogo) => void
        onAdminEdit: (data: {
          palpite: Palpite
          participanteNome: string
          timeA: string
          timeB: string
        }) => void
      }) {
        const horaEncerramento = formatHoraEncerramento(jogo.hora)

        return (
          <Card className="overflow-hidden rounded-[14px] border-[#E2E8F0] bg-white shadow-xs transition hover:shadow-sm flex flex-col justify-between w-full">
            {/* Match meta bar (copa, data, hora e status de registro do palpite) */}
            <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3.5 py-1.5 gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                {bolaoOrigem && (
                  <Badge
                    variant="secondary"
                    className="border border-[#CBD5E1] bg-white text-[#0F2A43] font-bold text-[10px] px-1.5 py-0 shadow-2xs"
                  >
                    🏆 {bolaoOrigem.nome}
                  </Badge>
                )}
                {jogo.competicao && (
                  <Badge
                    variant="secondary"
                    className="border border-indigo-200 bg-indigo-50 text-[10px] font-semibold text-indigo-700 px-1.5 py-0"
                  >
                    {jogo.competicao}
                  </Badge>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-400" />
                  <span>{formatDataBR(jogo.data)}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-slate-400" />
                  <span>{formatHoraBR(jogo.hora)}</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isExpired ? (
                  <Badge
                    variant="outline"
                    className="border-rose-300 bg-rose-50 text-rose-800 text-[10px] font-semibold gap-1 px-1.5 py-0"
                  >
                    <Lock className="h-2.5 w-2.5 text-rose-600" />
                    Encerrado
                  </Badge>
                ) : palpite && !isEditing ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px] font-semibold gap-1 px-1.5 py-0"
                  >
                    <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                    Registrado
                  </Badge>
                ) : palpite && isEditing ? (
                  <Badge
                    variant="outline"
                    className="border-blue-300 bg-blue-50 text-blue-800 text-[10px] font-semibold gap-1 px-1.5 py-0"
                  >
                    <Edit3 className="h-2.5 w-2.5 text-blue-600" />
                    Editando
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0"
                  >
                    Aberto
                  </Badge>
                )}
                {finalizado && (
                  <span
                    className={`rounded-full px-2 py-0.2 text-[10px] font-bold ${
                      pontos > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {pontos > 0 ? `+${pontos} pts` : '0 pts'}
                  </span>
                )}
              </div>
            </div>

            <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between">
              {/* Placar centralizado estilo Google em 3 colunas:
                  Esquerda: escudo do mandante acima do nome
                  Centro: placar oficial em destaque (ou vs) com status/tempo abaixo
                  Direita: escudo do visitante acima do nome */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1 mb-1">
                {/* Mandante */}
                <div className="flex flex-col items-center text-center min-w-0">
                  <div className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center shrink-0 mb-1">
                    <TeamShield
                      escudo={escudoA}
                      nomeTime={jogo.time_a}
                      sigla={initialsA}
                      sizeClass="h-9 w-9 sm:h-10 sm:w-10"
                      textClass="text-xs font-bold text-slate-700"
                    />
                  </div>
                  <span
                    className="text-xs font-bold text-[#0F172A] leading-tight line-clamp-2 w-full px-1"
                    title={jogo.time_a}
                  >
                    {jogo.time_a}
                  </span>
                </div>

                {/* Centro: Placar e Status */}
                <div className="flex flex-col items-center justify-center text-center px-2 shrink-0">
                  {finalizado ? (
                    <>
                      <div className="text-lg sm:text-xl font-black text-[#0F2A43] tracking-tight whitespace-nowrap">
                        {jogo.placar_a != null ? Number(jogo.placar_a) : 0} -{' '}
                        {jogo.placar_b != null ? Number(jogo.placar_b) : 0}
                      </div>
                      <span className="mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 border border-slate-200">
                        Encerrado
                      </span>
                    </>
                  ) : isExpired ? (
                    <>
                      {jogo.placar_a != null && jogo.placar_b != null ? (
                        <div className="text-lg sm:text-xl font-black text-[#0F2A43] tracking-tight whitespace-nowrap">
                          {Number(jogo.placar_a)} - {Number(jogo.placar_b)}
                        </div>
                      ) : (
                        <div className="text-sm sm:text-base font-extrabold text-slate-400">VS</div>
                      )}
                      <span className="mt-0.5 inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                        Encerrado
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="text-base sm:text-lg font-extrabold text-slate-400 tracking-wider">
                        VS
                      </div>
                      <span className="mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200">
                        Em Breve
                      </span>
                    </>
                  )}
                </div>

                {/* Visitante */}
                <div className="flex flex-col items-center text-center min-w-0">
                  <div className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center shrink-0 mb-1">
                    <TeamShield
                      escudo={escudoB}
                      nomeTime={jogo.time_b}
                      sigla={initialsB}
                      sizeClass="h-9 w-9 sm:h-10 sm:w-10"
                      textClass="text-xs font-bold text-slate-700"
                    />
                  </div>
                  <span
                    className="text-xs font-bold text-[#0F172A] leading-tight line-clamp-2 w-full px-1"
                    title={jogo.time_b}
                  >
                    {jogo.time_b}
                  </span>
                </div>
              </div>

              {/* Grupo de palpites liberados para partidas encerradas ou com horário de kickoff atingido */}
              {(() => {
                const isExpiredOrFinalized =
                  finalizado || isPalpiteEncerrado(jogo.data, jogo.hora, nowMs)
                if (!isExpiredOrFinalized) return null

                return (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-[#0F2A43]" />
                        <span className="text-xs font-bold text-[#0F172A]">Palpites do Grupo</span>
                        {loadedGroupBets && (
                          <Badge
                            variant="outline"
                            className="border-slate-300 bg-white text-[10px] font-semibold text-slate-700 ml-1"
                          >
                            {betsForGame.length}
                          </Badge>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loadingGroupBets}
                        onClick={onToggleGroupBets}
                        className="h-7 text-xs font-semibold border-slate-300 text-[#0F2A43] hover:bg-white"
                      >
                        {loadingGroupBets ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Carregando...
                          </>
                        ) : isGroupBetsExpanded ? (
                          <>
                            <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                            Recolher palpites do grupo
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                            Carregar palpites do grupo
                          </>
                        )}
                      </Button>
                    </div>

                    {isGroupBetsExpanded && loadedGroupBets && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        {betsForGame.length === 0 ? (
                          <p className="text-center py-2 text-xs italic text-slate-400">
                            Nenhum participante registrou palpite para esta partida antes do
                            encerramento.
                          </p>
                        ) : (
                          <div className="flex flex-col space-y-2.5">
                            {betsForGame.map((bet) => {
                              const part = participanteMap.get(bet.participante)
                              const nomeParticipante = part?.nome || 'Participante'
                              const isCurrentUser =
                                participantName &&
                                nomeParticipante.trim().toLowerCase() ===
                                  participantName.trim().toLowerCase()
                              const isSelected = selectedBetId === bet.id

                              const splitPalpite = getPalpiteMarcadoresPorTime(bet)
                              const is0x0 = splitPalpite.placarA === 0 && splitPalpite.placarB === 0

                              return (
                                <div
                                  key={bet.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onSelectBet(bet.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      onSelectBet(bet.id)
                                    }
                                  }}
                                  className={`rounded-lg border p-3 text-xs transition duration-150 shadow-2xs cursor-pointer select-none ${
                                    isSelected
                                      ? 'ring-2 ring-[#0F2A43] border-[#0F2A43] bg-slate-50'
                                      : isCurrentUser
                                        ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-300 hover:border-emerald-400'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                  }`}
                                >
                                  {/* Linha superior: Nome do Participante + Ações / Badges */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span
                                        className="font-bold text-sm text-[#0F172A] break-words"
                                        title={nomeParticipante}
                                      >
                                        {nomeParticipante}
                                      </span>
                                      {isCurrentUser && (
                                        <Badge className="bg-[#10B981] px-1.5 py-0 text-[10px] font-bold text-white hover:bg-[#10B981] shrink-0">
                                          Você
                                        </Badge>
                                      )}
                                      {isSelected && (
                                        <Badge className="bg-[#0F2A43] px-1.5 py-0 text-[10px] font-bold text-white hover:bg-[#0F2A43] shrink-0">
                                          Selecionado
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {isAdmin && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onAdminEdit({
                                              palpite: bet,
                                              participanteNome: nomeParticipante,
                                              timeA: jogo.time_a,
                                              timeB: jogo.time_b,
                                            })
                                          }}
                                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition"
                                          title="Editar marcadores deste palpite (Admin)"
                                        >
                                          <Edit3 className="h-3 w-3" />
                                          <span>Editar</span>
                                        </button>
                                      )}
                                      {finalizado && (
                                        <span
                                          className={`rounded-md px-2 py-0.5 font-bold text-xs ${
                                            bet.pontuacao_jogo > 0
                                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                                          }`}
                                        >
                                          +{bet.pontuacao_jogo} pts
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Linha intermediária: Palpite do Placar com destaque */}
                                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-xs text-slate-700">
                                      <span className="font-medium text-slate-500">Palpite:</span>{' '}
                                      <strong className="text-sm font-black text-[#0F2A43]">
                                        {bet.placar_a} x {bet.placar_b}
                                      </strong>
                                    </div>
                                  </div>

                                  {/* Linha de Marcadores / Goleadores indicados */}
                                  {is0x0 ? (
                                    <div className="mt-1 text-[11px] text-slate-400 italic">
                                      Sem marcadores (0x0)
                                    </div>
                                  ) : (
                                    <div className="mt-2 space-y-1 bg-slate-50/70 rounded p-2 border border-slate-100 text-[11px] leading-snug">
                                      <div className="text-slate-700">
                                        <span className="font-semibold text-slate-800">
                                          Gols Mandante ({jogo.time_a}):
                                        </span>{' '}
                                        <span
                                          className={
                                            splitPalpite.labelA === '-'
                                              ? 'text-slate-400'
                                              : 'text-slate-900 font-medium'
                                          }
                                        >
                                          {splitPalpite.labelA}
                                        </span>
                                      </div>
                                      <div className="text-slate-700">
                                        <span className="font-semibold text-slate-800">
                                          Gols Visitante ({jogo.time_b}):
                                        </span>{' '}
                                        <span
                                          className={
                                            splitPalpite.labelB === '-'
                                              ? 'text-slate-400'
                                              : 'text-slate-900 font-medium'
                                          }
                                        >
                                          {splitPalpite.labelB}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Form or Read-only view */}
              {finalizado ? (
                (() => {
                  // Resolve o palpite do participante selecionado ou padrão do usuário logado
                  const activeSelectedBet =
                    (selectedBetId && betsForGame.find((b) => b.id === selectedBetId)) ||
                    palpite ||
                    betsForGame[0]
                  const selectedPart = activeSelectedBet
                    ? participanteMap.get(activeSelectedBet.participante)
                    : null
                  const activeParticipantLabel = selectedPart
                    ? selectedPart.nome
                    : activeSelectedBet === palpite
                      ? 'Seu palpite'
                      : 'Participante'

                  const activeDetalhamento = activeSelectedBet
                    ? getScoreBreakdownBadges(activeSelectedBet, jogo).map((b) =>
                        b.pointsText ? `${b.label} (${b.pointsText} pts)` : b.label,
                      )
                    : detalhamento

                  return (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-slate-700">
                          {activeSelectedBet && (
                            <span className="font-semibold text-slate-700">
                              Exibindo:{' '}
                              <strong className="text-slate-900">{activeParticipantLabel}</strong>
                            </span>
                          )}
                        </div>

                        {activeSelectedBet && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onToggleDetails(jogo.id)}
                            className="h-7 text-xs font-semibold text-[#0F2A43] hover:bg-slate-200"
                          >
                            <span>Detalhar pontuação</span>
                            {expandedDetails ? (
                              <ChevronUp className="ml-1 h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="ml-1 h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>

                      {activeSelectedBet && (
                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded bg-white p-2 border border-slate-200">
                            <span className="text-[11px] font-medium text-slate-500">
                              Goleadores indicados ({jogo.time_a}):
                            </span>
                            <p className="font-medium text-slate-800">
                              {formatScorersDisplayText(activeSelectedBet.goleadores_a)}
                            </p>
                          </div>
                          <div className="rounded bg-white p-2 border border-slate-200">
                            <span className="text-[11px] font-medium text-slate-500">
                              Goleadores indicados ({jogo.time_b}):
                            </span>
                            <p className="font-medium text-slate-800">
                              {formatScorersDisplayText(activeSelectedBet.goleadores_b)}
                            </p>
                          </div>
                        </div>
                      )}

                      {expandedDetails && (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 animate-in fade-in duration-200">
                          <p className="font-bold text-emerald-950 mb-1">
                            Critérios de pontuação atendidos ({activeParticipantLabel}):
                          </p>
                          {activeDetalhamento.length > 0 ? (
                            <ul className="list-inside list-disc space-y-1">
                              {activeDetalhamento.map((item, idx) => (
                                <li key={idx} className="font-medium">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-600 italic">
                              Nenhum critério de pontuação atingido (+0 pts)
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()
              ) : (
                <div className="mt-3 space-y-3">
                  {isExpired && (
                    <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-900">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-rose-700 shrink-0" />
                        <span>
                          <strong>Palpites encerrados para esta partida</strong> (encerramento às{' '}
                          {horaEncerramento}).
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-rose-300 bg-white text-rose-800 text-[11px] font-bold"
                      >
                        Encerrado
                      </Badge>
                    </div>
                  )}

                  {isLocked && !isExpired && (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-xs text-emerald-900">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-emerald-700 shrink-0" />
                        <span>
                          <strong>Palpite Registrado.</strong> Os campos estão travados para
                          leitura.
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onSetEditing(jogo.id, true)}
                        className="h-7 gap-1 rounded bg-[#0F2A43] px-3 text-[11px] font-semibold text-white hover:bg-[#1B3A5C]"
                      >
                        <Edit3 className="h-3 w-3" />
                        Editar Palpite
                      </Button>
                    </div>
                  )}

                  {isEditing && !isExpired && (
                    <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/70 px-3.5 py-2 text-xs text-blue-900">
                      <div className="flex items-center gap-2">
                        <Edit3 className="h-4 w-4 text-blue-700 shrink-0" />
                        <span>
                          Modo de edição ativo. Atualize seus palpites e clique em{' '}
                          <strong>Salvar Palpite</strong>.
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelEditing(jogo.id, palpite)}
                        className="h-7 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}

                  {/* Botão retrátil [ Ver Escalações ] */}
                  <GameLineupAccordion
                    jogoId={jogo.id}
                    fixtureId={jogo.fixture_id}
                    timeA={jogo.time_a}
                    timeB={jogo.time_b}
                    data={jogo.data}
                    onLineupLoaded={onLineupLoaded}
                  />

                  {/* Score inputs with compact team shields: [Escudo A] [input placar A] x [input placar B] [Escudo B] */}
                  <div className="flex items-center justify-center gap-2 py-0.5">
                    {' '}
                    <div className="flex flex-col items-center shrink-0">
                      <TeamShield
                        escudo={escudoA}
                        nomeTime={jogo.time_a}
                        sigla={initialsA}
                        sizeClass="h-7 w-7"
                        textClass="text-[10px] font-bold text-slate-700 bg-slate-200"
                      />
                    </div>
                    <Input
                      type="number"
                      min="0"
                      disabled={isLocked}
                      placeholder="0"
                      value={form.placar_a ?? ''}
                      onChange={(e) => onScoreChange(jogo.id, 'a', e.target.value)}
                      className={`h-9 w-12 p-0 text-center text-base font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                        isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-400 px-0.5">X</span>
                    <Input
                      type="number"
                      min="0"
                      disabled={isLocked}
                      placeholder="0"
                      value={form.placar_b ?? ''}
                      onChange={(e) => onScoreChange(jogo.id, 'b', e.target.value)}
                      className={`h-9 w-12 p-0 text-center text-base font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                        isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                      }`}
                    />
                    <div className="flex flex-col items-center shrink-0">
                      <TeamShield
                        escudo={escudoB}
                        nomeTime={jogo.time_b}
                        sigla={initialsB}
                        sizeClass="h-7 w-7"
                        textClass="text-[10px] font-bold text-slate-700 bg-slate-200"
                      />
                    </div>
                  </div>

                  {/* Goal scorers dynamic line inputs: 1 input per goal entered in score */}
                  {(() => {
                    const numGolsA =
                      form.placar_a === '' || form.placar_a === undefined
                        ? 0
                        : Math.max(0, Number(form.placar_a) || 0)
                    const numGolsB =
                      form.placar_b === '' || form.placar_b === undefined
                        ? 0
                        : Math.max(0, Number(form.placar_b) || 0)
                    const isZeroA = numGolsA === 0
                    const isZeroB = numGolsB === 0

                    return (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {/* Team A Scorers */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 sm:p-3">
                          <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                            <Label className="text-xs font-bold text-slate-800">
                              Marcadores de gols — {jogo.time_a}
                            </Label>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                isZeroA
                                  ? 'border-slate-300 text-slate-400 bg-slate-100'
                                  : 'border-emerald-300 text-emerald-800 bg-emerald-50'
                              }`}
                            >
                              {isZeroA
                                ? '0 gols (bloqueado)'
                                : `${numGolsA} gol${numGolsA > 1 ? 's' : ''} previsto${numGolsA > 1 ? 's' : ''}`}
                            </Badge>
                          </div>

                          {isZeroA ? (
                            <p className="py-2 text-center text-xs italic text-slate-400">
                              Placar zero (0): campo de marcadores bloqueado.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {Array.from({ length: numGolsA }).map((_, idx) => {
                                const currentScorer = form.goleadores_a?.[idx] || ''
                                const isContra = Boolean(form.goleadores_contra_a?.[idx])
                                const lineupCheck = checkPlayerInLineup(
                                  currentScorer,
                                  currentLineup?.teams?.[0],
                                )
                                const isStarter = lineupCheck.role === 'titular'
                                const isSub = lineupCheck.role === 'reserva'

                                return (
                                  <div key={idx} className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                                        {idx + 1}º
                                      </span>
                                      <div className="relative flex-1">
                                        <Input
                                          disabled={isLocked}
                                          placeholder={`Nome do autor do ${idx + 1}º gol (ex: Pedro Raul)`}
                                          value={currentScorer}
                                          onChange={(e) =>
                                            onScorerLineChange(jogo.id, 'a', idx, e.target.value)
                                          }
                                          className={`h-8 border-[#CBD5E1] bg-white text-xs pr-7 focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                            isLocked
                                              ? 'bg-slate-100 cursor-not-allowed opacity-90'
                                              : ''
                                          } ${
                                            isStarter
                                              ? 'border-emerald-400 bg-emerald-50/20'
                                              : isSub
                                                ? 'border-amber-400 bg-amber-50/20'
                                                : ''
                                          }`}
                                        />
                                        {/* Indicador visual quando o jogador está na escalação */}
                                        {isStarter && (
                                          <div
                                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
                                            title="Titular confirmado na escalação!"
                                          >
                                            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                                          </div>
                                        )}
                                        {isSub && (
                                          <div
                                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
                                            title="No banco de reservas!"
                                          >
                                            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-200" />
                                          </div>
                                        )}
                                      </div>
                                      <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-[11px] font-medium text-slate-700 hover:text-slate-950">
                                        <Checkbox
                                          disabled={isLocked}
                                          checked={isContra}
                                          onCheckedChange={(checked) =>
                                            onScorerContraChange(
                                              jogo.id,
                                              'a',
                                              idx,
                                              Boolean(checked),
                                            )
                                          }
                                          className="h-3.5 w-3.5 rounded border-slate-300 data-[state=checked]:bg-rose-600 data-[state=checked]:border-rose-600"
                                        />
                                        <span className="text-[10px] text-slate-600">
                                          Gol Contra
                                        </span>
                                      </label>
                                    </div>
                                    {/* Badge explicativa discreta se houver match */}
                                    {isStarter && (
                                      <div className="ml-8 flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                                        <CheckCircle2 className="h-2.5 w-2.5" />
                                        <span>
                                          Titular na escalação ({lineupCheck.matchedPlayer?.name})
                                        </span>
                                      </div>
                                    )}
                                    {isSub && (
                                      <div className="ml-8 flex items-center gap-1 text-[10px] font-medium text-amber-700">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        <span>
                                          Banco de reservas ({lineupCheck.matchedPlayer?.name})
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                              <p className="mt-1 text-[10px] text-slate-500">
                                Pode repetir o mesmo jogador caso aposte em múltiplos gols dele.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Team B Scorers */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 sm:p-3">
                          <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                            <Label className="text-xs font-bold text-slate-800">
                              Marcadores de gols — {jogo.time_b}
                            </Label>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                isZeroB
                                  ? 'border-slate-300 text-slate-400 bg-slate-100'
                                  : 'border-emerald-300 text-emerald-800 bg-emerald-50'
                              }`}
                            >
                              {isZeroB
                                ? '0 gols (bloqueado)'
                                : `${numGolsB} gol${numGolsB > 1 ? 's' : ''} previsto${numGolsB > 1 ? 's' : ''}`}
                            </Badge>
                          </div>

                          {isZeroB ? (
                            <p className="py-2 text-center text-xs italic text-slate-400">
                              Placar zero (0): campo de marcadores bloqueado.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {Array.from({ length: numGolsB }).map((_, idx) => {
                                const currentScorer = form.goleadores_b?.[idx] || ''
                                const isContra = Boolean(form.goleadores_contra_b?.[idx])
                                const lineupCheck = checkPlayerInLineup(
                                  currentScorer,
                                  currentLineup?.teams?.[1],
                                )
                                const isStarter = lineupCheck.role === 'titular'
                                const isSub = lineupCheck.role === 'reserva'

                                return (
                                  <div key={idx} className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                                        {idx + 1}º
                                      </span>
                                      <div className="relative flex-1">
                                        <Input
                                          disabled={isLocked}
                                          placeholder={`Nome do autor do ${idx + 1}º gol (ex: Veiga)`}
                                          value={currentScorer}
                                          onChange={(e) =>
                                            onScorerLineChange(jogo.id, 'b', idx, e.target.value)
                                          }
                                          className={`h-8 border-[#CBD5E1] bg-white text-xs pr-7 focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                            isLocked
                                              ? 'bg-slate-100 cursor-not-allowed opacity-90'
                                              : ''
                                          } ${
                                            isStarter
                                              ? 'border-emerald-400 bg-emerald-50/20'
                                              : isSub
                                                ? 'border-amber-400 bg-amber-50/20'
                                                : ''
                                          }`}
                                        />
                                        {/* Indicador visual quando o jogador está na escalação */}
                                        {isStarter && (
                                          <div
                                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
                                            title="Titular confirmado na escalação!"
                                          >
                                            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                                          </div>
                                        )}
                                        {isSub && (
                                          <div
                                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
                                            title="No banco de reservas!"
                                          >
                                            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-200" />
                                          </div>
                                        )}
                                      </div>
                                      <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-[11px] font-medium text-slate-700 hover:text-slate-950">
                                        <Checkbox
                                          disabled={isLocked}
                                          checked={isContra}
                                          onCheckedChange={(checked) =>
                                            onScorerContraChange(
                                              jogo.id,
                                              'b',
                                              idx,
                                              Boolean(checked),
                                            )
                                          }
                                          className="h-3.5 w-3.5 rounded border-slate-300 data-[state=checked]:bg-rose-600 data-[state=checked]:border-rose-600"
                                        />
                                        <span className="text-[10px] text-slate-600">
                                          Gol Contra
                                        </span>
                                      </label>
                                    </div>
                                    {/* Badge explicativa discreta se houver match */}
                                    {isStarter && (
                                      <div className="ml-8 flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                                        <CheckCircle2 className="h-2.5 w-2.5" />
                                        <span>
                                          Titular na escalação ({lineupCheck.matchedPlayer?.name})
                                        </span>
                                      </div>
                                    )}
                                    {isSub && (
                                      <div className="ml-8 flex items-center gap-1 text-[10px] font-medium text-amber-700">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        <span>
                                          Banco de reservas ({lineupCheck.matchedPlayer?.name})
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                              <p className="mt-1 text-[10px] text-slate-500">
                                Pode repetir o mesmo jogador caso aposte em múltiplos gols dele.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Penalties select (when game has tem_penaltis) */}
                  {jogo.tem_penaltis && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 sm:p-3">
                      <Label className="text-xs font-bold text-amber-900">
                        Vencedor nos pênaltis (+2 pontos caso haja disputa):
                      </Label>
                      <select
                        disabled={isLocked}
                        value={form.vencedor_penaltis || 'N'}
                        onChange={(e) => onPenaltisChange(jogo.id, e.target.value)}
                        className={`mt-1.5 h-8 w-full sm:w-64 rounded-md border border-amber-300 bg-white px-2 text-xs font-medium text-slate-800 ${
                          isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                        }`}
                      >
                        <option value="N">Não haverá pênaltis (vitória no tempo normal)</option>
                        <option value="A">{jogo.time_a} passa nos pênaltis</option>
                        <option value="B">{jogo.time_b} passa nos pênaltis</option>
                      </select>
                    </div>
                  )}

                  {/* Action buttons footer */}
                  <div className="flex justify-end pt-1">
                    {' '}
                    {isExpired ? (
                      <Button
                        type="button"
                        disabled
                        className="h-9 cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-5 text-xs font-bold text-slate-400 shadow-none"
                      >
                        <Lock className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                        Palpites Encerrados
                      </Button>
                    ) : isLocked ? (
                      <Button
                        type="button"
                        onClick={() => onSetEditing(jogo.id, true)}
                        className="h-9 rounded-lg border border-[#0F2A43] bg-white px-5 text-xs font-bold text-[#0F2A43] shadow-xs hover:bg-slate-100"
                      >
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                        Editar Palpite
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => onSavePalpite(jogo)}
                        disabled={savingGameId === jogo.id}
                        className="h-9 rounded-lg bg-[#0F2A43] px-5 text-xs font-bold text-white shadow-xs hover:bg-[#1B3A5C]"
                      >
                        {savingGameId === jogo.id ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          <>
                            <Save className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                            Salvar Palpite
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )
      },
      (prev, next) => {
        return (
          prev.escudoA === next.escudoA &&
          prev.escudoB === next.escudoB &&
          prev.initialsA === next.initialsA &&
          prev.initialsB === next.initialsB &&
          prev.jogo.id === next.jogo.id &&
          prev.finalizado === next.finalizado &&
          prev.isEditing === next.isEditing &&
          prev.isExpired === next.isExpired &&
          prev.isSaved === next.isSaved &&
          prev.isLocked === next.isLocked &&
          prev.savingGameId === next.savingGameId &&
          prev.form.placar_a === next.form.placar_a &&
          prev.form.placar_b === next.form.placar_b &&
          prev.form.vencedor_penaltis === next.form.vencedor_penaltis &&
          prev.form.goleadores_a?.join(',') === next.form.goleadores_a?.join(',') &&
          prev.form.goleadores_b?.join(',') === next.form.goleadores_b?.join(',') &&
          prev.form.goleadores_contra_a?.join(',') === next.form.goleadores_contra_a?.join(',') &&
          prev.form.goleadores_contra_b?.join(',') === next.form.goleadores_contra_b?.join(',') &&
          prev.expandedDetails === next.expandedDetails &&
          prev.selectedBetId === next.selectedBetId &&
          prev.isGroupBetsExpanded === next.isGroupBetsExpanded &&
          prev.betsForGame.length === next.betsForGame.length &&
          prev.loadedGroupBets === next.loadedGroupBets &&
          prev.loadingGroupBets === next.loadingGroupBets &&
          prev.currentLineup === next.currentLineup
        )
      },
    )
  }, [])
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              Meus Palpites — {participantName || 'Participante'}
            </h1>
            {isGeralParam ? (
              <Badge
                variant="secondary"
                className="border border-amber-300 bg-amber-50 font-bold text-amber-900 shadow-xs text-xs px-2.5 py-0.5 flex items-center gap-1"
              >
                <Globe className="h-3 w-3 text-amber-600" />
                Tema: Ranking Geral Unificado
              </Badge>
            ) : (
              activeBolao?.foco && (
                <Badge
                  variant="secondary"
                  className="border border-indigo-200 bg-indigo-50 font-bold text-indigo-800 shadow-xs text-xs px-2.5 py-0.5"
                >
                  Tema: {activeBolao.foco}
                </Badge>
              )
            )}
          </div>
          <p className="text-xs text-[#64748B]">
            {isGeralParam ? (
              <span>
                Listagem unificada:{' '}
                <span className="font-semibold text-[#0F2A43]">Todas as Copas e Competições</span>
              </span>
            ) : (
              <span>
                Competição:{' '}
                <span className="font-semibold text-[#0F2A43]">
                  {activeBolao?.nome || 'Bolão do Grupo'}
                </span>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Indicador discreto de revalidação em background (SWR) */}
          {isBackgroundRevalidating && !isRefreshing && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md animate-pulse">
              <RefreshCcw className="h-3 w-3 animate-spin text-emerald-600" />
              Sincronizando dados...
            </span>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData(1, true, false)}
            disabled={isRefreshing || isBackgroundRevalidating}
            className="h-8 gap-1.5 text-xs font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
            title="Atualizar palpites"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 text-[#0F2A43] ${isRefreshing || isBackgroundRevalidating ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </Button>

          {/* Botão de filtro para alternar entre todos e apenas pendentes */}
          <Button
            type="button"
            variant={filterPendentes ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const nextState = !filterPendentes
              setFilterPendentes(nextState)
              setManualSort(null)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                if (nextState) {
                  updated.set('pendentes', '1')
                } else {
                  updated.set('pendentes', '0')
                }
                return updated
              })
            }}
            className={`h-8 gap-1.5 text-xs font-semibold ${
              filterPendentes
                ? 'bg-[#F59E0B] text-slate-950 hover:bg-amber-400 font-bold'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>{filterPendentes ? 'Filtrando: Jogos Pendentes' : 'Apenas Pendentes'}</span>
          </Button>

          {/* Seletor de Filtro por Copa */}
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="select-competicao-palpites"
              className="text-xs font-medium text-slate-600"
            >
              Filtrar por Copa:
            </label>
            <select
              id="select-competicao-palpites"
              value={selectedCompeticao}
              onChange={(e) => setSelectedCompeticao(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:border-[#0F2A43] focus:outline-hidden"
            >
              <option value="todas">Todas as Copas</option>
              {FIXED_COPAS.map((copa) => (
                <option key={copa} value={copa}>
                  {copa}
                </option>
              ))}
            </select>
          </div>

          {/* Segmented control para ordenação manual Crescente / Decrescente */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setManualSort('asc')}
              title="Ordenar por data/hora crescente (jogos mais antigos primeiro)"
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                sortOrder === 'asc'
                  ? 'bg-[#0F2A43] text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Crescente ⬆️
            </button>
            <button
              type="button"
              onClick={() => setManualSort('desc')}
              title="Ordenar por data/hora decrescente (jogos mais futuros/recentes primeiro)"
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                sortOrder === 'desc'
                  ? 'bg-[#0F2A43] text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Decrescente ⬇️
            </button>
          </div>

          <Badge variant="outline" className="border-slate-300 text-xs text-slate-700 py-1">
            {displayedJogos.length} jogo(s) {filterPendentes ? 'pendente(s)' : 'total'}
          </Badge>
        </div>
      </div>

      {filterPendentes ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-700 shrink-0" />
            <span>Exibindo apenas jogos pendentes para registrar ou editar seus palpites.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFilterPendentes(false)
              setManualSort(null)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                updated.set('pendentes', '0')
                return updated
              })
            }}
            className="text-xs font-bold text-amber-900 underline hover:text-amber-950"
          >
            Ver todos os jogos
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          <span>Exibindo todos os jogos (encerrados e pendentes).</span>
          <button
            type="button"
            onClick={() => {
              setFilterPendentes(true)
              setManualSort(null)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                updated.set('pendentes', '1')
                return updated
              })
            }}
            className="text-xs font-bold text-[#0F2A43] underline hover:text-slate-950"
          >
            Apenas pendentes
          </button>
        </div>
      )}

      {loading && displayedJogos.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto w-full">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <Card
              key={idx}
              className="overflow-hidden rounded-[14px] border-[#E2E8F0] bg-white p-3.5 shadow-xs"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <div className="py-2.5 flex justify-center items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-8 w-12 rounded-lg" />
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-8 w-12 rounded-lg" />
                <Skeleton className="h-7 w-7 rounded-full" />
              </div>
              <div className="pt-2 flex justify-end">
                <Skeleton className="h-7 w-24 rounded-lg" />
              </div>
            </Card>
          ))}
        </div>
      ) : displayedJogos.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500 max-w-4xl mx-auto w-full">
          {filterPendentes
            ? 'Não há jogos pendentes no momento para os critérios selecionados.'
            : 'Nenhuma partida disponível. Os jogos serão cadastrados pelo administrador Douglas.'}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto w-full">
          {displayedJogos.map((jogo) => {
            const bolaoOrigem = bolaoMap.get(jogo.bolao)
            const palpite = palpites[jogo.id]
            const form = formData[jogo.id] || {
              placar_a: '',
              placar_b: '',
              goleadores_a: [],
              goleadores_b: [],
              vencedor_penaltis: 'N',
            }

            const finalizado = jogo.resultado_finalizado
            const pontos = palpite ? palpite.pontuacao_jogo : 0
            const detalhamento = palpite?.detalhamento || []

            const escudoA = escudosMap[jogo.time_a?.trim()]
            const escudoB = escudosMap[jogo.time_b?.trim()]
            const initialsA = (jogo.time_a || '').slice(0, 2).toUpperCase()
            const initialsB = (jogo.time_b || '').slice(0, 2).toUpperCase()

            const isSaved = Boolean(palpite)
            const isExpired = isPalpiteEncerrado(jogo.data, jogo.hora, nowMs)
            const isEditing = Boolean(editingGames[jogo.id]) && !isExpired
            const isLocked = (isSaved && !isEditing) || isExpired
            const betsForGame = allGroupPalpites.filter((p) => p.jogo === jogo.id)
            const currentLineup = loadedLineups[jogo.id]
            const isGroupBetsExpanded = Boolean(expandedGroupBets[jogo.id])
            const selectedBetId = selectedBetByGame[jogo.id] || palpite?.id

            return (
              <PalpiteItemCard
                key={jogo.id}
                jogo={jogo}
                bolaoOrigem={bolaoOrigem}
                palpite={palpite}
                form={form}
                finalizado={finalizado}
                pontos={pontos}
                detalhamento={detalhamento}
                escudoA={escudoA}
                escudoB={escudoB}
                initialsA={initialsA}
                initialsB={initialsB}
                isEditing={isEditing}
                isExpired={isExpired}
                isSaved={isSaved}
                isLocked={isLocked}
                nowMs={nowMs}
                savingGameId={savingGameId}
                loadedGroupBets={loadedGroupBets}
                loadingGroupBets={loadingGroupBets}
                isGroupBetsExpanded={isGroupBetsExpanded}
                selectedBetId={selectedBetId}
                onSelectBet={(betId) => {
                  setSelectedBetByGame((prev) => ({
                    ...prev,
                    [jogo.id]: betId,
                  }))
                }}
                betsForGame={betsForGame}
                participanteMap={participanteMap}
                participantName={participantName}
                isAdmin={isAdmin}
                expandedDetails={Boolean(expandedDetails[jogo.id])}
                currentLineup={currentLineup}
                onLineupLoaded={(ln) => {
                  setLoadedLineups((prev) => ({
                    ...prev,
                    [jogo.id]: ln,
                  }))
                }}
                onToggleDetails={toggleDetails}
                onToggleGroupBets={() => handleToggleGroupBets(jogo.id)}
                onSetEditing={(id, editing) =>
                  setEditingGames((prev) => ({
                    ...prev,
                    [id]: editing,
                  }))
                }
                onCancelEditing={(id, p) => {
                  if (p) {
                    const gA =
                      p.placar_a !== null && p.placar_a !== undefined ? Number(p.placar_a) : 0
                    const gB =
                      p.placar_b !== null && p.placar_b !== undefined ? Number(p.placar_b) : 0
                    const normA = normalizeScorersArray(p.goleadores_a, gA)
                    const normB = normalizeScorersArray(p.goleadores_b, gB)
                    setFormData((prev) => ({
                      ...prev,
                      [id]: {
                        placar_a: p.placar_a ?? '',
                        placar_b: p.placar_b ?? '',
                        goleadores_a: normA.names,
                        goleadores_b: normB.names,
                        goleadores_contra_a: normA.contraFlags,
                        goleadores_contra_b: normB.contraFlags,
                        vencedor_penaltis: p.vencedor_penaltis || 'N',
                      },
                    }))
                  }
                  setEditingGames((prev) => ({
                    ...prev,
                    [id]: false,
                  }))
                }}
                onScoreChange={handleScoreChange}
                onScorerLineChange={handleScorerLineChange}
                onScorerContraChange={handleScorerContraChange}
                onPenaltisChange={handlePenaltisChange}
                onSavePalpite={handleSavePalpite}
                onAdminEdit={setAdminEditingPalpite}
              />
            )
          })}
        </div>
      )}

      {/* Paginação incremental com limite real de 20 por página no backend */}
      {!loading && hasMore && (
        <div className="flex flex-col items-center justify-center gap-2 pt-4 pb-8">
          <p className="text-xs text-slate-500">
            Exibindo <strong>{displayedJogos.length}</strong> de <strong>{totalItems}</strong>{' '}
            partidas (Página {currentPage} de {totalPages})
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isLoadingMore}
            onClick={handleLoadMore}
            className="h-10 px-6 font-bold text-xs border-[#0F2A43] text-[#0F2A43] hover:bg-slate-50 transition shadow-2xs"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#0F2A43]" />
                Carregando mais partidas...
              </>
            ) : (
              `Carregar mais 20 partidas (${totalItems - displayedJogos.length} restantes)`
            )}
          </Button>
        </div>
      )}

      {/* Modal de Edição de Marcadores para o Admin */}
      <AdminEditMarcadoresModal
        open={Boolean(adminEditingPalpite)}
        onOpenChange={(open) => {
          if (!open) setAdminEditingPalpite(null)
        }}
        palpite={adminEditingPalpite?.palpite || null}
        nomeParticipante={adminEditingPalpite?.participanteNome}
        timeA={adminEditingPalpite?.timeA}
        timeB={adminEditingPalpite?.timeB}
        onSuccess={(updatedRecord) => {
          setAdminEditingPalpite((prev) => (prev ? { ...prev, palpite: updatedRecord } : null))
          setAllGroupPalpites((prev) =>
            prev.map((p) => (p.id === updatedRecord.id ? updatedRecord : p)),
          )
          setPalpites((prev) => {
            if (prev[updatedRecord.jogo]) {
              return { ...prev, [updatedRecord.jogo]: updatedRecord }
            }
            return prev
          })
          loadData(1, true, false)
        }}
      />
    </div>
  )
}
