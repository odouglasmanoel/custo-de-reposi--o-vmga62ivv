import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Trophy,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MessageSquare,
  History,
  Shield,
  ArrowRight,
  Sparkles,
  BarChart2,
  Globe,
  Radio,
  Edit3,
  RefreshCcw,
  AlertCircle,
  Vote,
  XCircle,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth, BOLAO_MEMBERS } from '@/context/AuthContext'
import { normalizeMemberName } from '@/lib/statsCalculator'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Bolao, Participante, Jogo, Palpite } from '@/types/bolao'
import { formatBolaoLabel, GERAL_BOLAO_ID } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  formatDataBR,
  formatHoraBR,
  formatDateTimeBR,
  isPalpiteEncerrado,
  isJogoHoje,
  isJogoHojeNaoIniciado,
  getJogoKickoffTimestamp,
  getHojeDataSaoPaulo,
  normalizeDataISO,
} from '@/lib/dateUtils'
import { purgeObsoleteCaches, setWithBoundedCapacity } from '@/lib/cacheManager'
import {
  formatPalpiteMarcadoresSummary,
  getPalpiteMarcadoresPorTime,
  splitMatchScorersByTeam,
} from '@/lib/scorerUtils'
import { calculateLiveMatchScoreBreakdown } from '@/lib/scoreBadgeUtils'
import {
  resolveLiveScoreForGame,
  isFixtureLive,
  type ApiFootballFixture,
  type MatchedLiveScore,
} from '@/lib/apiFootballMatcher'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'
import { ParticipantScorersView } from '@/components/ParticipantScorersView'
import { Users } from 'lucide-react'
import { buscarEscudoTime, readEscudoCache } from '@/services/enquetes'

function TeamShield({
  escudo,
  nomeTime,
  sigla,
  sizeClass = 'h-6 w-6',
  textClass = 'text-[10px] font-bold text-slate-700',
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
        className={`${sizeClass} rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 ${textClass}`}
      >
        {sigla}
      </div>
    )
  }
  return (
    <img
      src={escudo}
      alt={nomeTime}
      className={`${sizeClass} object-contain shrink-0 drop-shadow-xs`}
      loading="eager"
      decoding="async"
      onError={() => setHasError(true)}
    />
  )
}

interface DashboardCachePayload {
  participantes: Participante[]
  allParticipantes: Participante[]
  allJogos: Jogo[]
  jogos: Jogo[]
  palpites: Palpite[]
  stats: { registrados: number; pendentes: number } | null
  timestamp: number
}

const DASHBOARD_CACHE_PREFIX = 'cr_dashboard_cache_v3'
const dashboardMemoryCache = new Map<string, DashboardCachePayload>()

function readDashboardCache(bolaoId: string): DashboardCachePayload | null {
  const key = bolaoId || GERAL_BOLAO_ID
  const mem = dashboardMemoryCache.get(key)
  if (mem && (mem.jogos.length > 0 || mem.allJogos.length > 0)) {
    return mem
  }
  try {
    const raw = localStorage.getItem(`${DASHBOARD_CACHE_PREFIX}_${key}`)
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardCachePayload
      if (parsed && (Array.isArray(parsed.jogos) || Array.isArray(parsed.allJogos))) {
        dashboardMemoryCache.set(key, parsed)
        return parsed
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const rawSession = sessionStorage.getItem(`bolao_cache_jogos_${key}`)
    if (rawSession) {
      const sessionJogos = JSON.parse(rawSession)
      if (Array.isArray(sessionJogos) && sessionJogos.length > 0) {
        const payload: DashboardCachePayload = {
          participantes: [],
          allParticipantes: [],
          allJogos: sessionJogos,
          jogos: sessionJogos,
          palpites: [],
          stats: null,
          timestamp: Date.now(),
        }
        return payload
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeDashboardCache(bolaoId: string, data: Omit<DashboardCachePayload, 'timestamp'>) {
  const key = bolaoId || GERAL_BOLAO_ID
  const payload: DashboardCachePayload = {
    ...data,
    timestamp: Date.now(),
  }
  setWithBoundedCapacity(dashboardMemoryCache, key, payload, 50)
  try {
    localStorage.setItem(`${DASHBOARD_CACHE_PREFIX}_${key}`, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

export default function BolaoDashboard() {
  const { user, isAdmin, participantName } = useAuth()
  const { boloes, activeBolao, activeBolaoId, setActiveBolaoId } = useActivePool()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const bolaoQueryParam = searchParams.get('bolao')

  // Ao abrir /inicio ou /bolao: se houver ?bolao=..., respeitar com prioridade;
  // caso contrário, na montagem do componente, garantir 'geral' (ou o ID correspondente ao Ranking Geral Unificado)
  useEffect(() => {
    if (bolaoQueryParam) {
      if (activeBolaoId !== bolaoQueryParam) {
        setActiveBolaoId(bolaoQueryParam)
      }
    } else {
      // Força 'geral' na montagem e em qualquer navegação sem ?bolao=
      if (activeBolaoId !== GERAL_BOLAO_ID) {
        setActiveBolaoId(GERAL_BOLAO_ID)
      }
    }
  }, [bolaoQueryParam])

  // Cache de dois níveis (memória + localStorage + sessionStorage) para inicialização instantânea (SWR)
  const currentTargetKey = activeBolaoId || GERAL_BOLAO_ID
  const initialDashboardCache = useMemo(() => {
    return readDashboardCache(currentTargetKey)
  }, [currentTargetKey])

  const [participantes, setParticipantes] = useState<Participante[]>(
    () => initialDashboardCache?.participantes || [],
  )
  const [allParticipantes, setAllParticipantes] = useState<Participante[]>(
    () => initialDashboardCache?.allParticipantes || [],
  )
  const [allJogos, setAllJogos] = useState<Jogo[]>(() => initialDashboardCache?.allJogos || [])
  const [jogos, setJogos] = useState<Jogo[]>(() => initialDashboardCache?.jogos || [])
  const [palpites, setPalpites] = useState<Palpite[]>(() => initialDashboardCache?.palpites || [])
  // Preservação do último valor válido de estatísticas para NUNCA zerar os contadores por timeout/erro
  const [lastValidStats, setLastValidStats] = useState<{
    registrados: number
    pendentes: number
  } | null>(() => initialDashboardCache?.stats || null)

  const hasInitialCache = !!(
    initialDashboardCache &&
    (initialDashboardCache.jogos.length > 0 || initialDashboardCache.allJogos.length > 0)
  )

  const [loading, setLoading] = useState(!hasInitialCache)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRevalidating, setIsRevalidating] = useState(hasInitialCache)

  const [nowMs, setNowMs] = useState<number>(Date.now())

  // Refs para dados de jogos e requisição em voo de live scores (evita loops e re-render infinito)
  const gamesRef = useRef<{ allJogos: Jogo[]; jogos: Jogo[] }>({ allJogos: [], jogos: [] })
  gamesRef.current = { allJogos, jogos }

  const liveScoresAbortControllerRef = useRef<AbortController | null>(null)
  const isFetchingLiveScoresRef = useRef<boolean>(false)

  // Controle de concorrência e deduplicação de requisições ativas do loadData
  const activeFetchPromiseRef = useRef<Promise<void> | null>(null)
  const lastFetchTimeRef = useRef<number>(0)
  const prevDashboardScopeRef = useRef<string>(currentTargetKey)

  // Live score state via API de futebol (API-Football exclusiva)
  const [apiFixtures, setApiFixtures] = useState<ApiFootballFixture[]>([])
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null)
  const [apiProvider, setApiProvider] = useState<string>('api_football')

  // Mapa de escudos dos times em cache / sob demanda
  const [escudosMap, setEscudosMap] = useState<Record<string, string>>(() => {
    const initialMap: Record<string, string> = {}
    const games = initialDashboardCache?.allJogos || initialDashboardCache?.jogos || []
    for (const j of games) {
      if (j.time_a) {
        const cA = readEscudoCache(j.time_a.trim())
        if (cA) initialMap[j.time_a.trim()] = cA
      }
      if (j.time_b) {
        const cB = readEscudoCache(j.time_b.trim())
        if (cB) initialMap[j.time_b.trim()] = cB
      }
    }
    return initialMap
  })

  // Sobrescritas manuais de partidas em andamento salvas pelo Admin Douglas
  const [sobrescritasAdmin, setSobrescritasAdmin] = useState<
    Record<
      string,
      {
        jogo_id: string
        placar_a: number
        placar_b: number
        marcadores: string[]
        marcadores_a?: string[]
        marcadores_b?: string[]
        status?: string
        updated_at?: string
      }
    >
  >({})

  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)

  // Estado para feedback do botão "Cobrar WhatsApp"
  const [copiado, setCopiado] = useState(false)

  // Modal de sobrescrita manual de partida em andamento pelo Admin Douglas
  const [adminSobrescritaJogo, setAdminSobrescritaJogo] = useState<{
    jogo: Jogo
    placarA: number | string
    placarB: number | string
    golsA: Array<{ nome: string; minuto: string }>
    golsB: Array<{ nome: string; minuto: string }>
    isSaving?: boolean
  } | null>(null)

  // Edição de marcadores pelo Admin
  const [adminEditingPalpite, setAdminEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
    timeA: string
    timeB: string
  } | null>(null)

  // Atualiza periodicamente o timestamp atual para destravar os palpites do grupo no minuto exato do jogo
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  // Consulta de placar ao vivo com cancelamento de requisição em voo e uso de refs estáveis
  // para evitar recriação de funções e loops contínuos de requisições de rede.
  const fetchLiveScores = useCallback(async () => {
    if (isFetchingLiveScoresRef.current) {
      return
    }

    if (liveScoresAbortControllerRef.current) {
      liveScoresAbortControllerRef.current.abort()
    }
    const controller = new AbortController()
    liveScoresAbortControllerRef.current = controller
    isFetchingLiveScoresRef.current = true

    try {
      const headers: Record<string, string> = {}
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }
      const hojeSP = getHojeDataSaoPaulo(Date.now())
      const baseUrl = `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo`

      // Usa gamesRef para ler a versão mais recente dos jogos sem colocar os arrays como dependência do callback
      const currentGames = gamesRef.current
      const relevantGames =
        currentGames.allJogos && currentGames.allJogos.length > 0
          ? currentGames.allJogos
          : currentGames.jogos
      const fixtureIdsFromGames = Array.from(
        new Set(
          relevantGames
            .filter((j) => !j.resultado_finalizado && j.fixture_id && j.fixture_id.trim())
            .map((j) => j.fixture_id!.trim()),
        ),
      )

      // Adiciona fixture_ids de jogos do dia atual mesmo que já tenham sido gravados erroneamente
      const hojeJogosFixtureIds = relevantGames
        .filter((j) => isJogoHoje(j.data, Date.now()) && j.fixture_id && j.fixture_id.trim())
        .map((j) => j.fixture_id!.trim())
      for (const fid of hojeJogosFixtureIds) {
        if (!fixtureIdsFromGames.includes(fid)) {
          fixtureIdsFromGames.push(fid)
        }
      }

      let url = `${baseUrl}?date=${encodeURIComponent(hojeSP)}`
      if (fixtureIdsFromGames.length > 0) {
        url += `&ids=${encodeURIComponent(fixtureIdsFromGames.join(','))}`
      }

      // Controller com timeout de 10s para estabilidade total
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      let res: Response
      try {
        res = await fetch(url, { headers, signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }

      if (res.ok) {
        const data = await res.json()
        setApiConfigured(Boolean(data.configured))
        if (data.rate_limited) {
          setIsRateLimited(true)
          // Se for rate limited e vier com fixtures vazias (ou sem dados novos), PRESERVA a lista anterior
          // NUNCA zera apiFixtures quando receber rate_limited!
          const hasNewData =
            (Array.isArray(data.directFixtures) && data.directFixtures.length > 0) ||
            (Array.isArray(data.live) && data.live.length > 0) ||
            (Array.isArray(data.dateFixtures) && data.dateFixtures.length > 0)
          if (!hasNewData) {
            if (data.sobrescritas && typeof data.sobrescritas === 'object') {
              setSobrescritasAdmin(data.sobrescritas)
            }
            return
          }
        } else {
          setIsRateLimited(false)
        }
        if (data.provider) {
          setApiProvider(data.provider)
        }
        if (data.sobrescritas && typeof data.sobrescritas === 'object') {
          setSobrescritasAdmin(data.sobrescritas)
        }

        // Combina fixtures diretas (por ID), ao vivo e da data sem duplicatas por ID
        const combinedMap = new Map<string | number, ApiFootballFixture>()

        // 1. Inserir fixtures diretas requisitadas por fixture_id
        if (Array.isArray(data.directFixtures)) {
          for (const item of data.directFixtures) {
            const fid = item.fixture?.id ?? `${item.teams?.home?.name}-${item.teams?.away?.name}`
            combinedMap.set(fid, item)
          }
        }

        // 2. Inserir live se ainda não tiver direta
        if (Array.isArray(data.live)) {
          for (const item of data.live) {
            const fid = item.fixture?.id ?? `${item.teams?.home?.name}-${item.teams?.away?.name}`
            if (!combinedMap.has(fid)) {
              combinedMap.set(fid, item)
            }
          }
        }

        // 3. Inserir dateFixtures
        if (Array.isArray(data.dateFixtures)) {
          for (const item of data.dateFixtures) {
            const fid = item.fixture?.id ?? `${item.teams?.home?.name}-${item.teams?.away?.name}`
            if (!combinedMap.has(fid)) {
              combinedMap.set(fid, item)
            }
          }
        }
        setApiFixtures(Array.from(combinedMap.values()))
      } else if (res.status === 429) {
        setIsRateLimited(true)
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('Polling de placar ao vivo indisponível:', err)
      }
    } finally {
      isFetchingLiveScoresRef.current = false
    }
  }, [])

  // Carga inicial leve das fixtures ao montar o dashboard (executa apenas uma vez na montagem)
  useEffect(() => {
    fetchLiveScores()
    return () => {
      if (liveScoresAbortControllerRef.current) {
        liveScoresAbortControllerRef.current.abort()
      }
    }
  }, [fetchLiveScores])

  const isGeral = activeBolaoId === GERAL_BOLAO_ID

  const handleSalvarSobrescritaAdmin = async () => {
    if (!adminSobrescritaJogo) return
    const { jogo, placarA, placarB, golsA, golsB } = adminSobrescritaJogo
    setAdminSobrescritaJogo((prev) => (prev ? { ...prev, isSaving: true } : null))

    try {
      const parsedA = placarA === '' ? 0 : Number(placarA)
      const parsedB = placarB === '' ? 0 : Number(placarB)

      const marcListA = (golsA || [])
        .map((item) => {
          const nome = (item.nome || '').trim()
          const min = (item.minuto || '').trim()
          if (!nome) return ''
          return min ? `${nome} ${min}` : nome
        })
        .filter(Boolean)

      const marcListB = (golsB || [])
        .map((item) => {
          const nome = (item.nome || '').trim()
          const min = (item.minuto || '').trim()
          if (!nome) return ''
          return min ? `${nome} ${min}` : nome
        })
        .filter(Boolean)

      const combinedMarcadores = [...marcListA, ...marcListB]

      // Atualiza estado local de imediato
      const novaSobrescrita = {
        jogo_id: jogo.id,
        placar_a: parsedA,
        placar_b: parsedB,
        marcadores: combinedMarcadores,
        marcadores_a: marcListA,
        marcadores_b: marcListB,
        status: 'Ao Vivo (Manual)',
        updated_at: new Date().toISOString(),
      }

      setSobrescritasAdmin((prev) => ({
        ...prev,
        [jogo.id]: novaSobrescrita,
      }))

      // Persiste via endpoint autenticado ou direto no PocketBase
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/sobrescrever`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jogo_id: jogo.id,
            placar_a: parsedA,
            placar_b: parsedB,
            marcadores: combinedMarcadores,
            marcadores_a: marcListA,
            marcadores_b: marcListB,
            status: 'Ao Vivo (Manual)',
          }),
        },
      )

      if (!res.ok) {
        // Fallback direto via SDK do PocketBase
        let rec
        try {
          rec = await pb
            .collection('config_integracoes')
            .getFirstListItem("chave = 'sobrescrita_jogos'")
        } catch {
          rec = null
        }

        let map: Record<string, unknown> = {}
        if (rec && rec.api_key) {
          try {
            map = JSON.parse(rec.api_key)
          } catch {
            map = {}
          }
        }
        map[jogo.id] = novaSobrescrita

        if (rec) {
          await pb.collection('config_integracoes').update(rec.id, {
            api_key: JSON.stringify(map),
          })
        } else {
          await pb.collection('config_integracoes').create({
            chave: 'sobrescrita_jogos',
            provedor: 'api_football',
            ativo: true,
            api_key: JSON.stringify(map),
          })
        }
      }

      setAdminSobrescritaJogo(null)
    } catch (err) {
      console.error('Erro ao salvar sobrescrita manual:', err)
      alert('Erro ao salvar sobrescrita manual. Verifique sua conexão.')
      setAdminSobrescritaJogo((prev) => (prev ? { ...prev, isSaving: false } : null))
    }
  }

  const handleRemoverSobrescritaAdmin = async (jogoId: string) => {
    if (!confirm('Deseja remover a sobrescrita manual e voltar para a API / banco?')) {
      return
    }

    setSobrescritasAdmin((prev) => {
      const copy = { ...prev }
      delete copy[jogoId]
      return copy
    })

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/sobrescrever`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jogo_id: jogoId,
            remover: true,
          }),
        },
      )

      if (!res.ok) {
        const rec = await pb
          .collection('config_integracoes')
          .getFirstListItem("chave = 'sobrescrita_jogos'")
        if (rec && rec.api_key) {
          const map = JSON.parse(rec.api_key)
          delete map[jogoId]
          await pb.collection('config_integracoes').update(rec.id, {
            api_key: JSON.stringify(map),
          })
        }
      }
    } catch (err) {
      console.error('Erro ao remover sobrescrita:', err)
    }
  }

  // Limpeza de caches temporários corrompidos ou legados (inclui versões legadas de prefixos)
  useEffect(() => {
    purgeObsoleteCaches()
  }, [])

  // Carrega sobrescritas também do banco como fallback direto
  const loadSobrescritasFromDb = async () => {
    try {
      const rec = await pb
        .collection('config_integracoes')
        .getFirstListItem("chave = 'sobrescrita_jogos'")
      if (rec && rec.api_key) {
        const parsed = JSON.parse(rec.api_key)
        if (parsed && typeof parsed === 'object') {
          setSobrescritasAdmin(parsed)
        }
      }
    } catch {
      /* fallback sem erro */
    }
  }

  useEffect(() => {
    loadSobrescritasFromDb()
  }, [])

  // Carregamento resiliente com tolerância a timeout (10s), deduplicação de chamadas paralelas e cache SWR
  const loadData = useCallback(
    async (isManualRefresh: boolean = false) => {
      if (!activeBolaoId) return

      // Evita refetches redundantes em menos de 2.5s a não ser que seja refresh manual
      const now = Date.now()
      if (!isManualRefresh && now - lastFetchTimeRef.current < 2500) {
        return
      }

      // Se já houver uma requisição em andamento, retorna a promise existente (deduplicação)
      if (activeFetchPromiseRef.current) {
        return activeFetchPromiseRef.current
      }

      const currentHasData =
        gamesRef.current.jogos.length > 0 || gamesRef.current.allJogos.length > 0

      if (isManualRefresh) {
        setIsRefreshing(true)
      } else if (currentHasData) {
        setIsRevalidating(true)
      } else {
        setLoading(true)
      }

      // Promise com timeout de 10s para que NUNCA trave o dashboard infinitamente
      const fetchWithTimeout = async () => {
        lastFetchTimeRef.current = Date.now()

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tempo de resposta excedido (timeout)')), 10000),
        )

        try {
          if (activeBolaoId === GERAL_BOLAO_ID) {
            const dataPromise = Promise.all([
              pb.collection('participantes').getFullList<Participante>({ sort: 'nome' }),
              pb.collection('jogos').getFullList<Jogo>({ sort: 'data,hora' }),
              pb.collection('palpites').getFullList<Palpite>(),
            ])

            const [allParts, allGames, allPredictions] = await Promise.race([
              dataPromise,
              timeoutPromise,
            ])

            if (Array.isArray(allGames)) {
              setAllParticipantes(allParts)
              setAllJogos(allGames)
              setParticipantes(allParts)
              setJogos(allGames)
              setPalpites(allPredictions)

              // Atualiza o último valor válido de estatísticas
              const reg = allGames.filter((j) => j.resultado_finalizado).length
              const pend = allGames.filter((j) => !j.resultado_finalizado).length
              const newStats = { registrados: reg, pendentes: pend }
              setLastValidStats(newStats)

              // Nunca auto-finalizar jogos em background silenciosamente por placar default ou tempo

              // Grava em cache de 2 níveis para renderização instantânea nas próximas visitas
              writeDashboardCache(GERAL_BOLAO_ID, {
                participantes: allParts,
                allParticipantes: allParts,
                allJogos: allGames,
                jogos: allGames,
                palpites: allPredictions,
                stats: newStats,
              })

              try {
                sessionStorage.setItem('bolao_cache_all_parts', JSON.stringify(allParts))
                sessionStorage.setItem('bolao_cache_all_jogos', JSON.stringify(allGames))
                sessionStorage.setItem(
                  `bolao_cache_parts_${GERAL_BOLAO_ID}`,
                  JSON.stringify(allParts),
                )
                sessionStorage.setItem(
                  `bolao_cache_jogos_${GERAL_BOLAO_ID}`,
                  JSON.stringify(allGames),
                )
                sessionStorage.setItem(
                  `bolao_cache_palpites_${GERAL_BOLAO_ID}`,
                  JSON.stringify(allPredictions),
                )
                sessionStorage.setItem(
                  `bolao_cache_stats_${GERAL_BOLAO_ID}`,
                  JSON.stringify(newStats),
                )
              } catch {
                /* ignore */
              }
            }
          } else {
            const dataPromise = Promise.all([
              pb.collection('participantes').getFullList<Participante>({ sort: 'nome' }),
              pb.collection('jogos').getFullList<Jogo>({ sort: 'data,hora' }),
              pb.collection('palpites').getFullList<Palpite>({
                filter: `bolao = '${activeBolaoId}'`,
              }),
            ])

            const [globalParts, globalGames, palpitesList] = await Promise.race([
              dataPromise,
              timeoutPromise,
            ])

            if (Array.isArray(globalGames)) {
              const partList = globalParts.filter((p) => p.bolao === activeBolaoId)
              const jogosList = globalGames.filter((j) => j.bolao === activeBolaoId)

              setParticipantes(partList)
              setJogos(jogosList)
              setPalpites(palpitesList)
              setAllParticipantes(globalParts)
              setAllJogos(globalGames)

              const reg = jogosList.filter((j) => j.resultado_finalizado).length
              const pend = jogosList.filter((j) => !j.resultado_finalizado).length
              const newStats = { registrados: reg, pendentes: pend }
              setLastValidStats(newStats)

              // Nunca auto-finalizar jogos em background silenciosamente por placar default ou tempo

              // Grava no cache de 2 níveis
              writeDashboardCache(activeBolaoId, {
                participantes: partList,
                allParticipantes: globalParts,
                allJogos: globalGames,
                jogos: jogosList,
                palpites: palpitesList,
                stats: newStats,
              })

              try {
                sessionStorage.setItem('bolao_cache_all_parts', JSON.stringify(globalParts))
                sessionStorage.setItem('bolao_cache_all_jogos', JSON.stringify(globalGames))
                sessionStorage.setItem(
                  `bolao_cache_parts_${activeBolaoId}`,
                  JSON.stringify(partList),
                )
                sessionStorage.setItem(
                  `bolao_cache_jogos_${activeBolaoId}`,
                  JSON.stringify(jogosList),
                )
                sessionStorage.setItem(
                  `bolao_cache_palpites_${activeBolaoId}`,
                  JSON.stringify(palpitesList),
                )
                sessionStorage.setItem(
                  `bolao_cache_stats_${activeBolaoId}`,
                  JSON.stringify(newStats),
                )
              } catch {
                /* ignore */
              }
            }
          }
        } catch (err: any) {
          console.warn('Alerta no carregamento do dashboard (mantendo último cache válido):', err)
          // Transição cache->dados novos silenciosa (sem setLoadError para tempo de resposta lento)
          // NUNCA esvazia os arrays nem zera lastValidStats! Preserva o que já está na tela
        } finally {
          setLoading(false)
          setIsRefreshing(false)
          setIsRevalidating(false)
          activeFetchPromiseRef.current = null
        }
      }

      const promise = fetchWithTimeout()
      activeFetchPromiseRef.current = promise
      return promise
    },
    [activeBolaoId],
  )

  // Real-time updates com debounce natural
  useRealtime<Participante>('participantes', () => {
    loadData()
  })

  useRealtime<Jogo>('jogos', () => {
    loadData()
  })

  useRealtime<Palpite>('palpites', () => {
    loadData()
  })

  // Hidratação e revalidação SWR instantânea ao mudar de bolão
  useEffect(() => {
    if (activeBolaoId) {
      if (prevDashboardScopeRef.current !== activeBolaoId) {
        prevDashboardScopeRef.current = activeBolaoId
        const cached = readDashboardCache(activeBolaoId)
        if (cached && (cached.jogos.length > 0 || cached.allJogos.length > 0)) {
          setParticipantes(cached.participantes)
          setAllParticipantes(cached.allParticipantes)
          setAllJogos(cached.allJogos)
          setJogos(cached.jogos)
          setPalpites(cached.palpites)
          if (cached.stats) setLastValidStats(cached.stats)
          setLoading(false)
          setIsRevalidating(true)
        } else {
          setLoading(true)
          setIsRevalidating(false)
        }
      }
      loadData()
    }
  }, [activeBolaoId, loadData])

  // Mapa de pontuação ao vivo acumulada por participanteId para jogos em andamento
  // (kickoff já iniciado e !resultado_finalizado com placar válido na API, sobrescrita ou banco)
  const liveScoresBreakdownByBetId = useMemo(() => {
    const map = new Map<
      string,
      {
        pontos: number
        badges: any[]
        resumoTexto: string
        resumoItens: string[]
        hasScore: boolean
      }
    >()

    const targetGames = isGeral ? allJogos : jogos

    for (const jogo of targetGames) {
      const jogoDataISO = normalizeDataISO(jogo.data)
      const matchedLive = resolveLiveScoreForGame(jogo, apiFixtures, 0.55, jogoDataISO)
      const sobrescrita = sobrescritasAdmin[jogo.id]

      const placarA =
        sobrescrita != null
          ? sobrescrita.placar_a
          : matchedLive?.placarA != null
            ? matchedLive.placarA
            : jogo.placar_a != null
              ? Number(jogo.placar_a)
              : null

      const placarB =
        sobrescrita != null
          ? sobrescrita.placar_b
          : matchedLive?.placarB != null
            ? matchedLive.placarB
            : jogo.placar_b != null
              ? Number(jogo.placar_b)
              : null

      const splitScorers = splitMatchScorersByTeam({
        teamAName: jogo.time_a,
        teamBName: jogo.time_b,
        placarA,
        placarB,
        sobrescritaMarcadoresA: sobrescrita?.marcadores_a ?? null,
        sobrescritaMarcadoresB: sobrescrita?.marcadores_b ?? null,
        sobrescritaMarcadores: sobrescrita?.marcadores ?? null,
        liveScorers: matchedLive?.scorers ?? null,
        golsBancoA: (jogo as any).gols_time_a ?? null,
        golsBancoB: (jogo as any).gols_time_b ?? null,
        marcadoresBancoLegado: jogo.marcadores ?? null,
      })

      const liveScorersUnified: Array<{
        nome: string
        posicao?: string
        quantidade?: number
        points?: number
      }> = [
        ...splitScorers.scorersA.map((rawStr) => {
          const str = String(rawStr || '').trim()
          const posMatch = str.match(/\(([^)]+)\)$/)
          const rawPos = posMatch ? posMatch[1].toLowerCase() : ''
          const nomeClean = str.replace(/\s*\([^)]+\)$/, '').trim()
          let pts = 1
          if (rawPos.includes('contra')) pts = 5
          else if (rawPos.includes('goleiro')) pts = 10
          else if (
            rawPos.includes('defensor') ||
            rawPos.includes('zagueiro') ||
            rawPos.includes('lateral')
          )
            pts = 3
          return {
            nome: nomeClean,
            posicao: rawPos || 'Atacante',
            quantidade: 1,
            points: pts,
          }
        }),
        ...splitScorers.scorersB.map((rawStr) => {
          const str = String(rawStr || '').trim()
          const posMatch = str.match(/\(([^)]+)\)$/)
          const rawPos = posMatch ? posMatch[1].toLowerCase() : ''
          const nomeClean = str.replace(/\s*\([^)]+\)$/, '').trim()
          let pts = 1
          if (rawPos.includes('contra')) pts = 5
          else if (rawPos.includes('goleiro')) pts = 10
          else if (
            rawPos.includes('defensor') ||
            rawPos.includes('zagueiro') ||
            rawPos.includes('lateral')
          )
            pts = 3
          return {
            nome: nomeClean,
            posicao: rawPos || 'Atacante',
            quantidade: 1,
            points: pts,
          }
        }),
      ]

      const gameBets = palpites.filter((p) => p.jogo === jogo.id)
      for (const bet of gameBets) {
        if (placarA === null || placarB === null) {
          map.set(bet.id, {
            pontos: 0,
            badges: [],
            resumoTexto: '',
            resumoItens: [],
            hasScore: false,
          })
        } else {
          const breakdown = calculateLiveMatchScoreBreakdown(
            bet,
            placarA,
            placarB,
            liveScorersUnified,
            jogo.tem_penaltis,
            (jogo as any).vencedor_penaltis,
          )
          map.set(bet.id, {
            ...breakdown,
            hasScore: true,
          })
        }
      }
    }

    return map
  }, [isGeral, allJogos, jogos, palpites, apiFixtures, sobrescritasAdmin])

  // Dynamic leaderboard calculation (SUM of valid finished games + imported points + PONTUAÇÃO AO VIVO)
  // Otimizado com pré-indexação por participante em O(N) para SUM e COUNT instantâneos
  const rankingParticipantes = useMemo(() => {
    // Jogos atualmente em andamento: kickoff já iniciado e !resultado_finalizado
    const targetGames = isGeral ? allJogos : jogos
    const liveGameIds = new Set(
      targetGames
        .filter((j) => !j.resultado_finalizado && isPalpiteEncerrado(j.data, j.hora, nowMs))
        .map((j) => j.id),
    )

    if (isGeral) {
      // Visão Geral: agregar os 4 participantes em todas as copas
      const finishedGameIds = new Set(
        allJogos.filter((j) => j.resultado_finalizado).map((j) => j.id),
      )

      // Pré-agrega palpites finalizados por participante: Map<participanteId, sumPontos> em O(P)
      const pointsByParticipantId = new Map<string, number>()
      const livePointsByParticipantId = new Map<string, number>()

      for (const p of palpites) {
        if (finishedGameIds.has(p.jogo)) {
          const current = pointsByParticipantId.get(p.participante) || 0
          pointsByParticipantId.set(p.participante, current + (Number(p.pontuacao_jogo) || 0))
        } else if (liveGameIds.has(p.jogo)) {
          const liveBreakdown = liveScoresBreakdownByBetId.get(p.id)
          const livePts = liveBreakdown?.pontos || 0
          const currentLive = livePointsByParticipantId.get(p.participante) || 0
          livePointsByParticipantId.set(p.participante, currentLive + livePts)
        }
      }

      // Identificar os 4 membros oficiais
      const memberNames = [...BOLAO_MEMBERS]

      return memberNames
        .map((memberName) => {
          // Encontrar todos os registros de participantes deste membro em todos os bolões
          const memberPartRecords = allParticipantes.filter(
            (p) => p.nome.trim().toLowerCase() === memberName.toLowerCase(),
          )

          // Soma de pontos importados de todas as copas para este membro
          let totalImportados = 0
          let sumPalpites = 0
          let sumAoVivo = 0

          for (const rec of memberPartRecords) {
            totalImportados += Number(rec.pontos_importados) || 0
            sumPalpites += pointsByParticipantId.get(rec.id) || 0
            sumAoVivo += livePointsByParticipantId.get(rec.id) || 0
          }

          const pontuacaoBase = totalImportados + sumPalpites
          const pontuacaoConsolidada = pontuacaoBase + sumAoVivo

          return {
            id: memberPartRecords[0]?.id || `geral-${memberName}`,
            bolao: GERAL_BOLAO_ID,
            nome: memberName,
            pontos_importados: totalImportados,
            pontuacao_total: pontuacaoConsolidada,
            pontos_ao_vivo: sumAoVivo,
            pontuacao_base: pontuacaoBase,
            collectionId: '',
            collectionName: 'participantes',
            created: '',
            updated: '',
          } as Participante & { pontos_ao_vivo?: number; pontuacao_base?: number }
        })
        .sort((a, b) => {
          if (b.pontuacao_total !== a.pontuacao_total) {
            return b.pontuacao_total - a.pontuacao_total
          }
          return a.nome.localeCompare(b.nome)
        })
    }

    // Visão de bolão específico: consolidação e deduplicação estrita por participante oficial
    const finishedGameIds = new Set(jogos.filter((j) => j.resultado_finalizado).map((j) => j.id))

    // Pré-agrega palpites finalizados por participante em O(P)
    const pointsByParticipantId = new Map<string, number>()
    const livePointsByParticipantId = new Map<string, number>()

    for (const p of palpites) {
      if (finishedGameIds.has(p.jogo)) {
        const current = pointsByParticipantId.get(p.participante) || 0
        pointsByParticipantId.set(p.participante, current + (Number(p.pontuacao_jogo) || 0))
      } else if (liveGameIds.has(p.jogo)) {
        const liveBreakdown = liveScoresBreakdownByBetId.get(p.id)
        const livePts = liveBreakdown?.pontos || 0
        const currentLive = livePointsByParticipantId.get(p.participante) || 0
        livePointsByParticipantId.set(p.participante, currentLive + livePts)
      }
    }

    // Agrupar registros de participantes por nome normalizado (ex: Douglas, Davi, Gabriel, Bruno)
    const groupedByMember = new Map<
      string,
      {
        primaryPart: Participante
        totalImported: number
        allPartIds: Set<string>
      }
    >()

    for (const part of participantes) {
      const norm = normalizeMemberName(part.nome)
      const existing = groupedByMember.get(norm)
      const imp = Number(part.pontos_importados) || 0
      if (!existing) {
        groupedByMember.set(norm, {
          primaryPart: part,
          totalImported: imp,
          allPartIds: new Set([part.id]),
        })
      } else {
        existing.totalImported += imp
        existing.allPartIds.add(part.id)
      }
    }

    const consolidated: Array<Participante & { pontos_ao_vivo?: number; pontuacao_base?: number }> =
      []
    for (const [normName, group] of groupedByMember.entries()) {
      let sumPalpites = 0
      let sumAoVivo = 0
      for (const pId of group.allPartIds) {
        sumPalpites += pointsByParticipantId.get(pId) || 0
        sumAoVivo += livePointsByParticipantId.get(pId) || 0
      }

      const pontuacaoBase = group.totalImported + sumPalpites
      const pontuacaoDinamica = pontuacaoBase + sumAoVivo

      consolidated.push({
        ...group.primaryPart,
        nome: normName,
        pontos_importados: group.totalImported,
        pontuacao_total: pontuacaoDinamica,
        pontos_ao_vivo: sumAoVivo,
        pontuacao_base: pontuacaoBase,
      })
    }

    return consolidated.sort((a, b) => {
      if (b.pontuacao_total !== a.pontuacao_total) {
        return b.pontuacao_total - a.pontuacao_total
      }
      return a.nome.localeCompare(b.nome)
    })
  }, [
    isGeral,
    participantes,
    jogos,
    palpites,
    allJogos,
    allParticipantes,
    nowMs,
    liveScoresBreakdownByBetId,
  ])

  // Mapa de bolões para nomes rápidos
  const bolaoMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of boloes) {
      map.set(b.id, b)
    }
    return map
  }, [boloes])

  // Mapa de participantes por ID
  const participantesMap = useMemo(() => {
    const map = new Map<string, Participante>()
    for (const p of allParticipantes) {
      map.set(p.id, p)
    }
    return map
  }, [allParticipantes])

  // Função unificada que determina se o jogo já foi concluído/finalizado
  // Regra antifalha estrita:
  // Saída SOMENTE quando resultado_finalizado === true (Admin via /admin/jogos OU status terminal confirmado da API: FT/AET/PEN/"Match Finished")
  // Nunca encerra antecipadamente por 0x0 default ou por expiração de tempo dentro da janela de 24h.
  const isJogoConcluido = useCallback((j: Jogo, matchedLive?: MatchedLiveScore | null): boolean => {
    if (j.resultado_finalizado) return true
    if (matchedLive && matchedLive.isFinished) return true
    if (
      j.status &&
      ['ft', 'aet', 'pen', 'finished', 'encerrado', 'finalizado', 'match finished'].includes(
        j.status.toLowerCase().trim(),
      )
    ) {
      return true
    }

    return false
  }, [])

  // Jogos cujos palpites foram liberados:
  // SOMENTE jogos pendentes (não concluídos) cujo horário de início já passou (dataHoraAtual >= dataHoraJogo)
  // E que pertençam ao dia de hoje ou tenham kickoff há menos de 24 horas (kickoffMs >= nowMs - 24*60*60*1000)
  // Exclui qualquer jogo concluído (no banco, no status ou já encerrado na API de futebol)
  const jogosLiberados = useMemo(() => {
    const targetGames = isGeral ? allJogos : jogos
    return targetGames
      .filter((j) => {
        const jogoDataISO = normalizeDataISO(j.data)
        const matchedLive = resolveLiveScoreForGame(j, apiFixtures, 0.55, jogoDataISO)
        const concluido = isJogoConcluido(j, matchedLive)
        if (concluido) return false
        if (!isPalpiteEncerrado(j.data, j.hora, nowMs)) return false

        const kickoffMs = getJogoKickoffTimestamp(j.data, j.hora)
        const isHoje = isJogoHoje(j.data, nowMs)
        const recentKickoff = kickoffMs !== null && kickoffMs >= nowMs - 24 * 60 * 60 * 1000
        return isHoje || recentKickoff
      })
      .sort((a, b) => {
        // Ordenar por horário de kickoff decrescente (mais recentes primeiro)
        const kickA = getJogoKickoffTimestamp(a.data, a.hora) ?? new Date(a.data).getTime()
        const kickB = getJogoKickoffTimestamp(b.data, b.hora) ?? new Date(b.data).getTime()
        return kickB - kickA
      })
  }, [isGeral, allJogos, jogos, nowMs, apiFixtures, isJogoConcluido])

  // Jogos de Hoje (fuso America/Sao_Paulo)
  // Regra dinâmica: APENAS jogos do dia atual que ainda NÃO iniciaram (dataHoraJogo > dataHoraAtual)
  const jogosDeHoje = useMemo(() => {
    const gamesToUse = isGeral ? allJogos : jogos
    return gamesToUse
      .filter((j) => isJogoHojeNaoIniciado(j.data, j.hora, nowMs))
      .sort((a, b) => {
        const kickA = getJogoKickoffTimestamp(a.data, a.hora) ?? 0
        const kickB = getJogoKickoffTimestamp(b.data, b.hora) ?? 0
        if (kickA !== kickB) return kickA - kickB
        const horaA = a.hora || ''
        const horaB = b.hora || ''
        return horaA.localeCompare(horaB)
      })
  }, [isGeral, allJogos, jogos, nowMs])

  // Assinatura estável dos jogos para evitar re-execução desnecessária do efeito de kickoff
  const gamesKickoffSignature = useMemo(() => {
    const targetGames = isGeral ? allJogos : jogos
    return targetGames
      .filter((j) => !j.resultado_finalizado)
      .map((j) => `${j.id}_${j.data}_${j.hora}`)
      .join('|')
  }, [isGeral, allJogos, jogos])

  // 1. REGRA DO KICKOFF ("rola a bola"): Dispara a API APENAS 1 única vez quando o horário de um jogo iniciar
  useEffect(() => {
    const targetGames = isGeral ? allJogos : jogos
    const timers: NodeJS.Timeout[] = []
    const now = Date.now()

    for (const j of targetGames) {
      if (j.resultado_finalizado) continue

      const kickoffMs = getJogoKickoffTimestamp(j.data, j.hora)
      if (!kickoffMs) continue

      const delay = kickoffMs - now
      // Se o jogo começa no futuro próximo (até 24h), programa disparo exato de 1 única consulta
      if (delay > 0 && delay <= 24 * 60 * 60 * 1000) {
        const t = setTimeout(() => {
          // Kickoff atingido: aciona a API uma única vez para conferir o início do jogo
          fetchLiveScores()
        }, delay + 1000) // +1s após o horário previsto
        timers.push(t)
      }
    }

    return () => {
      timers.forEach((t) => clearTimeout(t))
    }
  }, [gamesKickoffSignature, isGeral, fetchLiveScores])

  // 2. REGRA DO POLLING: APENAS quando há jogos realmente em andamento (ao vivo)
  // Requisitos estritos para habilitar polling:
  // - j.resultado_finalizado !== true
  // - Horário atual entre kickoff e kickoff + 150 min
  // - Status não terminal (não é FT/AET/PEN/CANC/PST/ABD/FINISHED)
  // Intervalo elevado de 2 min para 12 min (720_000 ms) para proteção rigorosa da cota de API.
  // Jogos futuros e encerrados = polling desativado (clearInterval), consulta única no carregamento.
  useEffect(() => {
    if (isRateLimited) {
      return
    }

    const TERMINAL_STATUSES = new Set([
      'FT',
      'AET',
      'PEN',
      'CANC',
      'CANCELLED',
      'PST',
      'POSTPONED',
      'ABD',
      'ABANDONED',
      'FINISHED',
    ])

    const now = Date.now()
    const targetGames = isGeral ? allJogos : jogos

    // 1. Verifica se há algum jogo do bolão que esteja realmente em andamento agora
    const hasLiveBolaoGame = targetGames.some((j) => {
      if (j.resultado_finalizado === true) return false
      const kickoff = getJogoKickoffTimestamp(j.data, j.hora)
      if (!kickoff) return false
      // Horário atual entre kickoff e kickoff + 150 min (duração típica de uma partida de futebol)
      if (now < kickoff || now > kickoff + 150 * 60 * 1000) return false

      // Verifica status associado na API de futebol se existir
      const jogoDataISO = normalizeDataISO(j.data)
      const matched = resolveLiveScoreForGame(j, apiFixtures, 0.55, jogoDataISO)
      if (matched) {
        const stUpper = (matched.statusShort || matched.statusLong || '').trim().toUpperCase()
        if (TERMINAL_STATUSES.has(stUpper)) return false
        if (matched.isFinished) return false
      }
      return true
    })

    // 2. Ou se há alguma fixture explicitamente em status ao vivo não terminal na API
    const hasLiveApiFixture = apiFixtures.some((f) => {
      const st = (f.fixture?.status?.short || '').trim().toUpperCase()
      if (TERMINAL_STATUSES.has(st)) return false
      return isFixtureLive(st)
    })

    const hasReallyLiveGame = hasLiveBolaoGame || hasLiveApiFixture

    if (!hasReallyLiveGame) {
      // Jogos futuros e encerrados = polling desativado (clearInterval)
      return
    }

    // Sincronização periódica realizada exclusivamente pelo cron backend placar_ao_vivo_sync.
    // O frontend não realiza polling automático via setInterval para poupar cota da API.
  }, [isGeral, allJogos, jogos, apiFixtures, isRateLimited, fetchLiveScores])

  // Carregamento de escudos para os times dos Jogos de Hoje / Jogos Liberados
  useEffect(() => {
    const relevant = isGeral ? allJogos : jogos
    if (!relevant || relevant.length === 0) return

    const teamNames = new Set<string>()
    for (const j of relevant) {
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
          let changed = false
          const next = { ...prev }
          for (const res of results) {
            if (res.url && next[res.time] !== res.url) {
              next[res.time] = res.url
              changed = true
            }
          }
          return changed ? next : prev
        })
      })

      return () => {
        isMounted = false
      }
    }
  }, [isGeral, allJogos, jogos])

  // Deduplicação dos participantes oficiais a partir de allParticipantes/participantes
  const membrosAtivos = useMemo<{ nome: string; ids: string[] }[]>(() => {
    const sourceParts = allParticipantes.length > 0 ? allParticipantes : participantes
    const map = new Map<string, { nome: string; ids: Set<string> }>()

    for (const part of sourceParts) {
      if (!part.nome) continue
      const normName = normalizeMemberName(part.nome)
      if (!map.has(normName)) {
        map.set(normName, { nome: normName, ids: new Set<string>() })
      }
      map.get(normName)!.ids.add(part.id)
    }

    return Array.from(map.values())
      .map((item) => ({
        nome: item.nome,
        ids: Array.from(item.ids),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [allParticipantes, participantes])

  // Função auxiliar: checa se um determinado membro já registrou palpite para o jogo
  const checarPalpiteRegistrado = useCallback(
    (jogoId: string, nome: string, ids: string[]): boolean => {
      const idsSet = new Set(ids)
      const normMembro = nome.toLowerCase()

      return palpites.some((p) => {
        if (p.jogo !== jogoId) return false
        if (p.placar_a == null || p.placar_b == null) return false

        if (idsSet.has(p.participante)) return true

        const partObj = participantesMap.get(p.participante)
        if (partObj && normalizeMemberName(partObj.nome).toLowerCase() === normMembro) {
          return true
        }

        return false
      })
    },
    [palpites, participantesMap],
  )

  // Geração do texto de cobrança para WhatsApp
  const gerarTextoCobrancaWhatsApp = useCallback((): string => {
    const hojeSP = getHojeDataSaoPaulo(nowMs)
    const dataFormatada = formatDataBR(hojeSP) || hojeSP

    const linhasJogos = jogosDeHoje.map((jogo) => {
      const horario = formatHoraBR(jogo.hora) || '—'
      const pendentes: string[] = []

      for (const membro of membrosAtivos) {
        if (!checarPalpiteRegistrado(jogo.id, membro.nome, membro.ids)) {
          pendentes.push(membro.nome)
        }
      }

      const tituloJogo = `⚽ *${jogo.time_a} x ${jogo.time_b}* (${horario})`
      const statusJogo =
        pendentes.length > 0
          ? `   ❌ Pendentes: ${pendentes.join(', ')}`
          : '   ✅ Todos os palpites foram registrados!'

      return `${tituloJogo}\n${statusJogo}`
    })

    return [
      `⏰ *Cobrança de Palpites — Bolão (${dataFormatada})*`,
      '',
      ...linhasJogos,
      '',
      '👉 Acesse o app para registrar o seu palpite.',
    ].join('\n')
  }, [jogosDeHoje, membrosAtivos, checarPalpiteRegistrado, nowMs])

  // Ação de copiar texto de cobrança com fallback robusto
  const handleCopiarWhatsApp = useCallback(async () => {
    const texto = gerarTextoCobrancaWhatsApp()
    let copiou = false

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(texto)
        copiou = true
      } catch {
        copiou = false
      }
    }

    if (!copiou) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = texto
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.top = '0'
        textarea.setAttribute('readonly', '')
        document.body.appendChild(textarea)
        textarea.select()
        copiou = document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        copiou = false
      }
    }

    if (copiou) {
      setCopiado(true)
      setTimeout(() => {
        setCopiado(false)
      }, 2000)
    }
  }, [gerarTextoCobrancaWhatsApp])

  // Quick stats com fallback para o último valor válido conhecido
  // NUNCA zera as estatísticas por falta de tempo de resposta ou carregamento
  // Jogos com isJogoConcluido=true são contabilizados como Jogos Encerrados (registrados)
  const stats: { registrados: number; pendentes: number } | null = useMemo(() => {
    const gamesToUse = isGeral ? allJogos : jogos
    if (gamesToUse.length > 0) {
      const registrados = gamesToUse.filter((j) => {
        const jogoDataISO = normalizeDataISO(j.data)
        const matchedLive = resolveLiveScoreForGame(j, apiFixtures, 0.55, jogoDataISO)
        return isJogoConcluido(j, matchedLive)
      }).length

      // 1. Jogo aberto: não concluído e com horário de encerramento ainda não atingido
      const jogosAbertos = gamesToUse.filter((j) => {
        const jogoDataISO = normalizeDataISO(j.data)
        const matchedLive = resolveLiveScoreForGame(j, apiFixtures, 0.55, jogoDataISO)
        const concluido = isJogoConcluido(j, matchedLive)
        return !concluido && !isPalpiteEncerrado(j.data, j.hora, nowMs)
      })

      // Identificar os IDs dos participantes que pertencem ao usuário logado
      const targetParts = isGeral ? allParticipantes : participantes
      const userPartIds = new Set<string>()

      if (participantName) {
        const normTarget = normalizeMemberName(participantName).toLowerCase()
        const lowerRaw = participantName.trim().toLowerCase()

        for (const p of targetParts) {
          const normP = normalizeMemberName(p.nome).toLowerCase()
          const rawP = p.nome.trim().toLowerCase()
          if (normP === normTarget || rawP === lowerRaw) {
            userPartIds.add(p.id)
          }
        }
      }

      // Palpites salvos válidos do usuário com placar_a != null && placar_b != null
      const userPalpitesGameIds = new Set<string>()
      for (const palpite of palpites) {
        if (
          userPartIds.has(palpite.participante) &&
          palpite.placar_a != null &&
          palpite.placar_b != null
        ) {
          userPalpitesGameIds.add(palpite.jogo)
        }
      }

      // 3. pendentes = jogos abertos − jogos abertos já palpitados pelo usuário
      const abertosPalpitados = jogosAbertos.filter((j) => userPalpitesGameIds.has(j.id)).length
      const pendentes = Math.max(0, jogosAbertos.length - abertosPalpitados)

      return {
        registrados,
        pendentes,
      }
    }
    if (lastValidStats) {
      return lastValidStats
    }
    return null
  }, [
    isGeral,
    allJogos,
    jogos,
    lastValidStats,
    nowMs,
    allParticipantes,
    participantes,
    participantName,
    palpites,
    apiFixtures,
    isJogoConcluido,
  ])

  const handleCardPendentesClick = () => {
    if (isGeral) {
      navigate('/bolao/meus-palpites?geral=1&pendentes=1')
    } else {
      navigate('/bolao/meus-palpites?pendentes=1')
    }
  }

  // Ranking tier badge style
  const getPositionBadge = (index: number) => {
    if (index === 0) {
      return {
        bg: 'bg-[#F59E0B] text-slate-950 font-bold',
        text: '1º',
        trophy: '🏆',
      }
    }
    if (index === 1) {
      return {
        bg: 'bg-[#94A3B8] text-white font-bold',
        text: '2º',
        trophy: '🥈',
      }
    }
    if (index === 2) {
      return {
        bg: 'bg-[#B45309] text-white font-bold',
        text: '3º',
        trophy: '🥉',
      }
    }
    return {
      bg: 'bg-[#0F2A43] text-white font-semibold',
      text: `${index + 1}º`,
      trophy: '',
    }
  }

  return (
    <div className="space-y-6">
      {/* Header section with active pool info */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-emerald-100 p-2 text-[#10B981]">
              <Trophy className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
                  Bolão do Grupo
                </h1>
                {isGeral ? (
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
                {isGeral ? (
                  <span>
                    Visão Consolidada:{' '}
                    <span className="font-semibold text-[#0F2A43]">
                      Todas as Copas (Ativas e Encerradas)
                    </span>
                  </span>
                ) : (
                  <span>
                    Competição ativa:{' '}
                    <span className="font-semibold text-[#0F2A43]">
                      {activeBolao?.nome || 'Carregando...'}
                    </span>
                  </span>
                )}
                {!isGeral && activeBolao?.ultima_atualizacao && (
                  <span className="ml-2 text-[11px] text-slate-400">
                    • Atualizado em: {formatDateTimeBR(activeBolao.ultima_atualizacao)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Pool switcher dropdown & manual refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {isRevalidating && !isRefreshing && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#64748B] bg-slate-100 px-2 py-1 rounded-md animate-pulse">
              <RefreshCcw className="h-3 w-3 animate-spin text-[#0F2A43]" />
              Sincronizando...
            </span>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
            title="Atualizar dados do bolão"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 text-[#0F2A43] ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </Button>

          <label htmlFor="pool-select" className="text-xs font-semibold text-slate-500">
            Trocar Bolão:
          </label>
          <select
            id="pool-select"
            value={activeBolaoId || ''}
            onChange={(e) => setActiveBolaoId(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F2A43] shadow-xs focus:border-[#10B981] focus:outline-none"
          >
            {/* Opção Geral (Todas as Copas) NO TOPO do dropdown */}
            <option value={GERAL_BOLAO_ID}>Geral (Todas as Copas)</option>
            {boloes.map((b) => (
              <option key={b.id} value={b.id}>
                {formatBolaoLabel(b)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Banner de Rate Limit no Dashboard com mensagem exata solicitada */}
      {isRateLimited && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
            <span className="font-semibold">
              Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente
              novamente mais tarde.
            </span>
          </div>
          <span className="text-[11px] text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded font-medium">
            Placares protegidos
          </span>
        </div>
      )}

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[#64748B]">Jogos Encerrados</p>
              {stats === null && loading ? (
                <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-1 text-2xl font-black text-[#0F172A]">{stats?.registrados ?? 0}</p>
              )}
            </div>
            <div className="rounded-lg bg-emerald-50 p-2.5 text-[#10B981]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </Card>

        {stats && stats.pendentes === 0 ? (
          <Card
            tabIndex={-1}
            className="cursor-default opacity-80 pointer-events-none rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs"
            title="Jogos pendentes em Meus Palpites"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-[#64748B]">Jogos Pendentes</p>
                </div>
                {stats === null && loading ? (
                  <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-200" />
                ) : (
                  <p className="mt-1 text-2xl font-black text-[#0F172A]">0</p>
                )}
                <span className="text-[10px] font-semibold text-slate-400">
                  Clique para editar &rarr;
                </span>
              </div>
              <div className="rounded-lg bg-amber-50 p-2.5 text-[#F59E0B] opacity-60">
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ) : (
          <Card
            onClick={handleCardPendentesClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleCardPendentesClick()
              }
            }}
            className="group cursor-pointer rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400"
            title="Ver jogos pendentes em Meus Palpites"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-[#64748B] group-hover:text-amber-800 transition-colors">
                    Jogos Pendentes
                  </p>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-amber-600" />
                </div>
                {stats === null && loading ? (
                  <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-200" />
                ) : (
                  <p className="mt-1 text-2xl font-black text-[#0F172A]">{stats?.pendentes ?? 0}</p>
                )}
                <span className="text-[10px] font-semibold text-amber-600 group-hover:underline">
                  Clique para palpitar &rarr;
                </span>
              </div>
              <div className="rounded-lg bg-amber-50 p-2.5 text-[#F59E0B] group-hover:bg-amber-100 transition-colors">
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </Card>
        )}

        {/* Card de Atalho para Enquetes (Copa Coni) */}
        <Card
          onClick={() => navigate('/bolao/enquetes')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              navigate('/bolao/enquetes')
            }
          }}
          className="group cursor-pointer rounded-[14px] border-emerald-200 bg-linear-to-br from-emerald-50/40 via-white to-white p-4 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-400"
          title="Acessar módulo de Enquetes da Copa Coni"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-emerald-800">Enquetes da Rodada</p>
                <ArrowRight className="h-3.5 w-3.5 text-emerald-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">Copa Coni</p>
              <span className="text-[10px] font-semibold text-emerald-700 group-hover:underline">
                Votar nos jogos &rarr;
              </span>
            </div>
            <div className="rounded-lg bg-emerald-100 p-2.5 text-emerald-700 group-hover:bg-emerald-200 transition-colors">
              <Vote className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          {' '}
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between pr-2 gap-2 flex-wrap">
                <p className="text-xs font-medium text-[#64748B]">Jogos de Hoje</p>
                {loading && (isGeral ? allJogos.length === 0 : jogos.length === 0) ? (
                  <div className="h-4 w-12 animate-pulse rounded bg-slate-200" />
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant="outline"
                      className="border-blue-200 bg-blue-50/60 text-[10px] font-semibold text-[#0F2A43]"
                    >
                      {jogosDeHoje.length} jogo(s)
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopiarWhatsApp}
                      disabled={jogosDeHoje.length === 0}
                      className={cn(
                        'h-7 px-2 text-[10px] font-bold transition-all',
                        copiado
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                      )}
                      title="Copiar lista de pendentes formatada para o WhatsApp"
                    >
                      {copiado ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600 mr-1 shrink-0" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-slate-600 mr-1 shrink-0" />
                          <span>Cobrar WhatsApp</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              {loading && (isGeral ? allJogos.length === 0 : jogos.length === 0) ? (
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
                </div>
              ) : jogosDeHoje.length === 0 ? (
                <p className="mt-1 text-sm font-medium text-slate-400">
                  Nenhum jogo agendado para hoje
                </p>
              ) : (
                <div className="mt-1.5 space-y-2 max-h-60 overflow-y-auto pr-1">
                  {jogosDeHoje.map((jogo) => {
                    const bolaoOrigem = isGeral ? bolaoMap.get(jogo.bolao) : null
                    const jogoDataISO = normalizeDataISO(jogo.data)
                    const matchedLive = resolveLiveScoreForGame(
                      jogo,
                      apiFixtures,
                      0.55,
                      jogoDataISO,
                    )
                    const logoCasa =
                      escudosMap[jogo.time_a?.trim()] ||
                      matchedLive?.homeTeamLogo ||
                      readEscudoCache(jogo.time_a?.trim() || '') ||
                      ''
                    const logoVisitante =
                      escudosMap[jogo.time_b?.trim()] ||
                      matchedLive?.awayTeamLogo ||
                      readEscudoCache(jogo.time_b?.trim() || '') ||
                      ''
                    const initialsA = (jogo.time_a || '').slice(0, 2).toUpperCase()
                    const initialsB = (jogo.time_b || '').slice(0, 2).toUpperCase()

                    return (
                      <div
                        key={jogo.id}
                        className="rounded-md border border-slate-100 bg-slate-50/50 p-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 py-0.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {bolaoOrigem && (
                              <Badge
                                variant="secondary"
                                className="border border-[#CBD5E1] bg-slate-100 text-[#0F2A43] font-semibold text-[9px] px-1 py-0 shrink-0"
                              >
                                {bolaoOrigem.nome.replace('Copa ', '')}
                              </Badge>
                            )}
                            <div className="flex items-center gap-1.5 min-w-0 truncate">
                              <span className="flex items-center gap-1 min-w-0 truncate">
                                <TeamShield
                                  escudo={logoCasa}
                                  nomeTime={jogo.time_a}
                                  sigla={initialsA}
                                  sizeClass="h-5 w-5"
                                  textClass="text-[8px] font-black"
                                />
                                <span className="font-bold text-[#0F172A] truncate">
                                  {jogo.time_a}
                                </span>
                              </span>
                              <span className="text-slate-400 font-bold px-0.5 shrink-0">x</span>
                              <span className="flex items-center gap-1 min-w-0 truncate">
                                <TeamShield
                                  escudo={logoVisitante}
                                  nomeTime={jogo.time_b}
                                  sigla={initialsB}
                                  sizeClass="h-5 w-5"
                                  textClass="text-[8px] font-black"
                                />
                                <span className="font-bold text-[#0F172A] truncate">
                                  {jogo.time_b}
                                </span>
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 font-semibold text-[#0F2A43] bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                            {formatHoraBR(jogo.hora) || '—'}
                          </span>
                        </div>

                        {/* Linha discreta de palpites por membro ativo */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                          <span className="text-[10px] font-medium text-slate-500 mr-0.5">
                            Palpites:
                          </span>
                          {membrosAtivos.map((membro) => {
                            const jaPalpitou = checarPalpiteRegistrado(
                              jogo.id,
                              membro.nome,
                              membro.ids,
                            )
                            return (
                              <span
                                key={membro.nome}
                                className={cn(
                                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors',
                                  jaPalpitou
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-rose-50 text-rose-700 border border-rose-200',
                                )}
                                title={
                                  jaPalpitou
                                    ? `${membro.nome}: Palpite registrado`
                                    : `${membro.nome}: Palpite pendente`
                                }
                              >
                                {jaPalpitou ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-rose-600 shrink-0" />
                                )}
                                <span>{membro.nome}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}{' '}
            </div>
            <div className="ml-2 rounded-lg bg-blue-50 p-2.5 text-[#0F2A43] shrink-0 self-start">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </div>

      {/* Bloco: Palpites Liberados do Grupo (Posicionado entre Jogos de Hoje e a Tabela de Classificação) */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <CardHeader className="p-0 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-bold text-[#0F172A]">
                <Users className="h-5 w-5 text-[#0F2A43]" />
                Palpites Liberados do Grupo
              </CardTitle>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Exibição de palpites de confrontos pendentes cujos horários de início já passaram.
              </p>
            </div>
            <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
              {jogosLiberados.length} jogo(s) pendente(s) em andamento
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-8 text-center text-xs text-[#64748B]">
              Carregando palpites do grupo...
            </div>
          ) : jogosLiberados.length === 0 ? (
            <div className="rounded-lg bg-slate-50 py-10 text-center text-xs text-slate-500">
              Nenhum jogo em andamento no momento. Os palpites de cada confronto são liberados aqui
              assim que o horário da partida iniciar e permanecem até a finalização do placar
              definitivo.
            </div>
          ) : (
            <div className="space-y-4">
              {jogosLiberados.map((jogo) => {
                const gameBets = palpites.filter((p) => p.jogo === jogo.id)
                const bolaoOrigem = bolaoMap.get(jogo.bolao)
                const jogoDataISO = normalizeDataISO(jogo.data)
                // Resolve placar ao vivo: Se houver fixture_id busca direto na API; senão matching por texto
                const matchedLive = resolveLiveScoreForGame(jogo, apiFixtures, 0.55, jogoDataISO)

                // -------------------------------------------------------------
                // ORDEM DE PRIORIDADE RIGOROSA (solicitada pelo usuário):
                // (a) Sobrescrita manual digitada pelo Admin para partida em andamento — SEMPRE vence
                // (b) Dados reais da API (goals.home/away + eventos Goal com scorers)
                // (c) Placar manual já salvo no banco (se maior que zero ou se jogo finalizado)
                // (d) Nenhum dado → título estático "Time A x Time B" com badge "Aguardando atualização"
                // É PROIBIDO exibir 0 x 0 que não venha comprovadamente da API ou do Admin/banco!
                // -------------------------------------------------------------
                const sobrescritaJogo = sobrescritasAdmin[jogo.id]

                // Verifica se há placar real salvo manualmente no banco de dados
                const temPlacarManualBanco =
                  jogo.placar_a != null &&
                  jogo.placar_b != null &&
                  !isNaN(Number(jogo.placar_a)) &&
                  !isNaN(Number(jogo.placar_b)) &&
                  (Number(jogo.placar_a) > 0 ||
                    Number(jogo.placar_b) > 0 ||
                    jogo.resultado_finalizado)

                // Marcadores salvos manualmente no banco (se houver)
                const marcadoresBanco =
                  Array.isArray(jogo.marcadores) && jogo.marcadores.length > 0
                    ? jogo.marcadores
                        .map((m) => (typeof m === 'string' ? m : m.nome || m.name || ''))
                        .filter(Boolean)
                        .join(', ')
                    : ''

                let tituloConfronto = `${jogo.time_a} x ${jogo.time_b}`
                let placarExibido: string | null = null
                let tipoFontePlacar: 'sobrescrita' | 'api' | 'manual' | 'aguardando' = 'aguardando'
                let marcadoresParaExibir = ''

                if (sobrescritaJogo) {
                  // (a) Sobrescrita manual do Admin (Douglas)
                  placarExibido = `${sobrescritaJogo.placar_a} x ${sobrescritaJogo.placar_b}`
                  tituloConfronto = `${jogo.time_a} ${sobrescritaJogo.placar_a} x ${sobrescritaJogo.placar_b} ${jogo.time_b}`
                  tipoFontePlacar = 'sobrescrita'
                  marcadoresParaExibir = Array.isArray(sobrescritaJogo.marcadores)
                    ? sobrescritaJogo.marcadores.join(', ')
                    : ''
                } else if (matchedLive) {
                  // (b) Dados reais da API (só exibe números se informados, nunca 0x0 falso quando null)
                  if (matchedLive.placarA !== null && matchedLive.placarB !== null) {
                    placarExibido = `${matchedLive.placarA} x ${matchedLive.placarB}`
                    tituloConfronto = `${jogo.time_a} ${matchedLive.placarA} x ${matchedLive.placarB} ${jogo.time_b}`
                    tipoFontePlacar = 'api'
                  } else {
                    placarExibido = null
                    tituloConfronto = `${jogo.time_a} x ${jogo.time_b}`
                    tipoFontePlacar = 'aguardando'
                  }
                  marcadoresParaExibir =
                    matchedLive.scorers && matchedLive.scorers.length > 0
                      ? matchedLive.scorers
                          .map((s) => (s.minute ? `${s.name} ${s.minute}'` : s.name))
                          .join(', ')
                      : marcadoresBanco
                } else if (temPlacarManualBanco) {
                  // (c) Placar manual já salvo no banco
                  placarExibido = `${Number(jogo.placar_a)} x ${Number(jogo.placar_b)}`
                  tituloConfronto = `${jogo.time_a} ${Number(jogo.placar_a)} x ${Number(jogo.placar_b)} ${jogo.time_b}`
                  tipoFontePlacar = 'manual'
                  marcadoresParaExibir = marcadoresBanco
                } else {
                  // (d) Nenhum dado: Permanece título estático sem "0 x 0" e sem placar falso
                  placarExibido = null
                  tituloConfronto = `${jogo.time_a} x ${jogo.time_b}`
                  tipoFontePlacar = 'aguardando'
                  marcadoresParaExibir = ''
                }

                const providerLabel =
                  tipoFontePlacar === 'sobrescrita'
                    ? 'Admin (Douglas)'
                    : matchedLive?.provider === 'thesportsdb'
                      ? 'TheSportsDB'
                      : matchedLive?.provider === 'football_data'
                        ? 'Football-Data.org'
                        : 'API-Football'

                // Status badge: Ao Vivo (API em andamento, Sobrescrita manual do Admin ou nativo por horário kickoff <= agora)
                const kickoffTimestamp = getJogoKickoffTimestamp(jogo.data, jogo.hora)
                const isNativamenteInPlay =
                  kickoffTimestamp !== null &&
                  nowMs >= kickoffTimestamp &&
                  !jogo.resultado_finalizado &&
                  !(matchedLive && matchedLive.isFinished)

                const isStatusAoVivo =
                  tipoFontePlacar === 'sobrescrita' ||
                  Boolean(matchedLive?.isLive) ||
                  isNativamenteInPlay

                const isStatusEncerrado = Boolean(
                  (matchedLive && matchedLive.isFinished) || jogo.resultado_finalizado,
                )

                return (
                  <div
                    key={jogo.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
                  >
                    {/* Header do confronto */}
                    <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {bolaoOrigem && (
                            <Badge
                              variant="secondary"
                              className="border border-[#CBD5E1] bg-white text-[#0F2A43] font-bold text-[10px] px-2 py-0.5"
                            >
                              🏆 {bolaoOrigem.nome}
                            </Badge>
                          )}
                          {(() => {
                            const logoCasa =
                              escudosMap[jogo.time_a?.trim()] ||
                              matchedLive?.homeTeamLogo ||
                              readEscudoCache(jogo.time_a?.trim() || '') ||
                              ''
                            const logoVisitante =
                              escudosMap[jogo.time_b?.trim()] ||
                              matchedLive?.awayTeamLogo ||
                              readEscudoCache(jogo.time_b?.trim() || '') ||
                              ''
                            const initialsA = (jogo.time_a || '').slice(0, 2).toUpperCase()
                            const initialsB = (jogo.time_b || '').slice(0, 2).toUpperCase()

                            return (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <TeamShield
                                  escudo={logoCasa}
                                  nomeTime={jogo.time_a}
                                  sigla={initialsA}
                                  sizeClass="h-5 w-5"
                                  textClass="text-[9px] font-black"
                                />
                                <span className="font-bold text-sm text-[#0F172A] tracking-tight">
                                  {tituloConfronto}
                                </span>
                                <TeamShield
                                  escudo={logoVisitante}
                                  nomeTime={jogo.time_b}
                                  sigla={initialsB}
                                  sizeClass="h-5 w-5"
                                  textClass="text-[9px] font-black"
                                />
                              </div>
                            )
                          })()}
                          {jogo.competicao && (
                            <span className="text-[11px] text-slate-500 font-medium">
                              • {jogo.competicao}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500">
                            {formatDataBR(jogo.data)} às {formatHoraBR(jogo.hora)}
                          </span>

                          {/* Badge de status da partida (Ao Vivo, Encerrado ou Aguardando API) */}
                          {isStatusAoVivo && (
                            <Badge
                              variant="secondary"
                              className="border border-emerald-400 bg-emerald-50 text-emerald-800 text-[10px] font-bold shadow-2xs flex items-center gap-1.5 animate-pulse"
                              title={`Partida em andamento via ${providerLabel} (${matchedLive?.statusLong || (isNativamenteInPlay ? 'Em Andamento' : 'Ao Vivo')}${matchedLive?.matchedBy === 'fixture_id' ? ' • ID Direto' : ''}).`}
                            >
                              <Radio className="h-3 w-3 text-emerald-600" />
                              <span>
                                {matchedLive?.elapsed
                                  ? `Ao Vivo ${matchedLive.elapsed}'`
                                  : matchedLive?.statusShort === 'HT'
                                    ? 'Intervalo'
                                    : 'Ao Vivo'}
                              </span>
                            </Badge>
                          )}

                          {!isStatusAoVivo && isStatusEncerrado && (
                            <Badge
                              variant="secondary"
                              className="border border-slate-300 bg-slate-100 text-slate-800 text-[10px] font-bold shadow-2xs flex items-center gap-1"
                              title="Partida encerrada"
                            >
                              <CheckCircle2 className="h-3 w-3 text-slate-600" />
                              <span>Encerrado</span>
                            </Badge>
                          )}

                          {!isStatusAoVivo && !isStatusEncerrado && !matchedLive && (
                            <Badge
                              variant="secondary"
                              className="border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-semibold shadow-2xs flex items-center gap-1"
                              title="Aguardando atualização de placar ao vivo da API externa"
                            >
                              <Clock className="h-3 w-3 text-amber-600" />
                              <span>Aguardando atualização</span>
                            </Badge>
                          )}

                          {/* Botão de Sobrescrita Manual exclusivo para o Admin (Douglas) */}
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const initPlacarA =
                                    sobrescritaJogo != null
                                      ? sobrescritaJogo.placar_a
                                      : (matchedLive?.placarA ??
                                        (jogo.placar_a != null ? Number(jogo.placar_a) : ''))
                                  const initPlacarB =
                                    sobrescritaJogo != null
                                      ? sobrescritaJogo.placar_b
                                      : (matchedLive?.placarB ??
                                        (jogo.placar_b != null ? Number(jogo.placar_b) : ''))

                                  const countA =
                                    initPlacarA === '' ? 0 : Math.max(0, Number(initPlacarA) || 0)
                                  const countB =
                                    initPlacarB === '' ? 0 : Math.max(0, Number(initPlacarB) || 0)

                                  const parseScorerString = (
                                    token: string,
                                  ): { nome: string; minuto: string } => {
                                    const raw = String(token || '').trim()
                                    const minMatch = raw.match(/(\d+(?:\+\d+)?)\s*['’]?$/)
                                    if (minMatch) {
                                      const minVal = minMatch[1]
                                      const nameVal = raw
                                        .replace(/\s*\d+(?:\+\d+)?\s*['’]?$/, '')
                                        .trim()
                                      return { nome: nameVal, minuto: `${minVal}'` }
                                    }
                                    return { nome: raw, minuto: '' }
                                  }

                                  let rawTokensA: string[] = []
                                  let rawTokensB: string[] = []

                                  if (sobrescritaJogo != null) {
                                    if (
                                      Array.isArray(sobrescritaJogo.marcadores_a) ||
                                      Array.isArray(sobrescritaJogo.marcadores_b)
                                    ) {
                                      rawTokensA = (sobrescritaJogo.marcadores_a || []).map(String)
                                      rawTokensB = (sobrescritaJogo.marcadores_b || []).map(String)
                                    } else if (Array.isArray(sobrescritaJogo.marcadores)) {
                                      // Degrade gracioso para sobrescrita legada: divide de acordo com o placar
                                      const pA = Number(sobrescritaJogo.placar_a) || 0
                                      const pB = Number(sobrescritaJogo.placar_b) || 0
                                      if (pA > 0 && pB === 0) {
                                        rawTokensA = sobrescritaJogo.marcadores.map(String)
                                      } else if (pB > 0 && pA === 0) {
                                        rawTokensB = sobrescritaJogo.marcadores.map(String)
                                      } else {
                                        rawTokensA = sobrescritaJogo.marcadores
                                          .slice(0, pA)
                                          .map(String)
                                        rawTokensB = sobrescritaJogo.marcadores
                                          .slice(pA, pA + pB)
                                          .map(String)
                                      }
                                    }
                                  } else if (
                                    matchedLive?.scorers &&
                                    matchedLive.scorers.length > 0
                                  ) {
                                    for (const sc of matchedLive.scorers) {
                                      const token = sc.minute ? `${sc.name} ${sc.minute}'` : sc.name
                                      if (sc.teamSide === 'away') {
                                        rawTokensB.push(token)
                                      } else {
                                        rawTokensA.push(token)
                                      }
                                    }
                                  }

                                  const initialGolsA: Array<{ nome: string; minuto: string }> = []
                                  for (let i = 0; i < countA; i++) {
                                    if (rawTokensA[i]) {
                                      initialGolsA.push(parseScorerString(rawTokensA[i]))
                                    } else {
                                      initialGolsA.push({ nome: '', minuto: '' })
                                    }
                                  }

                                  const initialGolsB: Array<{ nome: string; minuto: string }> = []
                                  for (let i = 0; i < countB; i++) {
                                    if (rawTokensB[i]) {
                                      initialGolsB.push(parseScorerString(rawTokensB[i]))
                                    } else {
                                      initialGolsB.push({ nome: '', minuto: '' })
                                    }
                                  }

                                  setAdminSobrescritaJogo({
                                    jogo,
                                    placarA: initPlacarA,
                                    placarB: initPlacarB,
                                    golsA: initialGolsA,
                                    golsB: initialGolsB,
                                  })
                                }}
                                className="h-6 px-2 text-[10px] font-bold border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 flex items-center gap-1"
                                title="Digitar placar e marcadores manualmente para esta partida em andamento (Admin)"
                              >
                                <Edit3 className="h-3 w-3 text-amber-700" />
                                <span>
                                  {sobrescritaJogo ? 'Editar Sobrescrita' : 'Sobrescrever Placar'}
                                </span>
                              </Button>

                              {sobrescritaJogo && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoverSobrescritaAdmin(jogo.id)}
                                  className="h-6 px-1.5 text-[10px] font-medium text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded border border-rose-200 transition"
                                  title="Remover sobrescrita manual e voltar para o placar da API"
                                >
                                  Remover
                                </button>
                              )}
                            </div>
                          )}

                          <Badge
                            variant="outline"
                            className="border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800"
                          >
                            Palpites Encerrados
                          </Badge>
                        </div>
                      </div>

                      {/* 2. Autores dos gols reais divididos por equipe (Mandante e Visitante) */}
                      {(() => {
                        const splitScorers = splitMatchScorersByTeam({
                          teamAName: jogo.time_a,
                          teamBName: jogo.time_b,
                          placarA:
                            sobrescritaJogo != null
                              ? sobrescritaJogo.placar_a
                              : matchedLive
                                ? matchedLive.placarA
                                : jogo.placar_a,
                          placarB:
                            sobrescritaJogo != null
                              ? sobrescritaJogo.placar_b
                              : matchedLive
                                ? matchedLive.placarB
                                : jogo.placar_b,
                          sobrescritaMarcadoresA: sobrescritaJogo?.marcadores_a ?? null,
                          sobrescritaMarcadoresB: sobrescritaJogo?.marcadores_b ?? null,
                          sobrescritaMarcadores: sobrescritaJogo?.marcadores ?? null,
                          liveScorers: matchedLive?.scorers ?? null,
                          golsBancoA: (jogo as any).gols_time_a ?? null,
                          golsBancoB: (jogo as any).gols_time_b ?? null,
                          marcadoresBancoLegado: jogo.marcadores ?? null,
                        })

                        const temGolsParaExibir =
                          Boolean(marcadoresParaExibir) ||
                          splitScorers.hasAnyScorers ||
                          (splitScorers.placarA !== null &&
                            splitScorers.placarB !== null &&
                            (splitScorers.placarA > 0 || splitScorers.placarB > 0))

                        if (temGolsParaExibir) {
                          return (
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-emerald-200/90 bg-emerald-50/90 px-3 py-1.5 text-[11px] text-emerald-950 shadow-2xs">
                              <div className="flex items-center gap-1.5 font-bold text-emerald-900 shrink-0">
                                <span>⚽</span>
                                <span>Gols da partida:</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-emerald-950">
                                    Gols {jogo.time_a}:
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      splitScorers.labelA === '-'
                                        ? 'text-slate-400 font-normal'
                                        : 'text-emerald-900'
                                    }`}
                                  >
                                    {splitScorers.labelA}
                                  </span>
                                </div>
                                <span className="text-emerald-300">•</span>
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-emerald-950">
                                    Gols {jogo.time_b}:
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      splitScorers.labelB === '-'
                                        ? 'text-slate-400 font-normal'
                                        : 'text-emerald-900'
                                    }`}
                                  >
                                    {splitScorers.labelB}
                                  </span>
                                </div>
                              </div>
                              {tipoFontePlacar === 'sobrescrita' && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-300">
                                  (Admin Douglas)
                                </span>
                              )}
                            </div>
                          )
                        }

                        if (!matchedLive && !temPlacarManualBanco && !sobrescritaJogo) {
                          return (
                            <div className="mt-1.5 text-[10px] text-slate-400 italic">
                              Aguardando início do placar / marcadores da API...
                            </div>
                          )
                        }

                        return null
                      })()}
                    </div>

                    {/* Cards dos palpites de cada participante */}
                    <div className="p-4">
                      {gameBets.length === 0 ? (
                        <p className="text-center text-xs italic text-slate-400 py-1">
                          Nenhum participante palpitou para este confronto.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {gameBets.map((bet) => {
                            const part = participantesMap.get(bet.participante)
                            const nomeParticipante = part?.nome || 'Participante'
                            const isCurrentUser =
                              participantName &&
                              nomeParticipante.trim().toLowerCase() ===
                                participantName.trim().toLowerCase()

                            const liveBreakdown = liveScoresBreakdownByBetId.get(bet.id)

                            return (
                              <div
                                key={bet.id}
                                className={`rounded-lg border p-3 text-xs transition shadow-2xs ${
                                  isCurrentUser
                                    ? 'border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-300'
                                    : 'border-slate-200 bg-slate-50/60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold text-[#0F172A] truncate">
                                    {nomeParticipante}
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {isCurrentUser && (
                                      <Badge className="bg-[#10B981] px-1 py-0 text-[9px] font-bold text-white hover:bg-[#10B981]">
                                        Você
                                      </Badge>
                                    )}
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setAdminEditingPalpite({
                                            palpite: bet,
                                            participanteNome: nomeParticipante,
                                            timeA: jogo.time_a,
                                            timeB: jogo.time_b,
                                          })
                                        }
                                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition"
                                        title="Editar marcadores deste palpite (Admin)"
                                      >
                                        <Edit3 className="h-2.5 w-2.5" />
                                        <span>Editar</span>
                                      </button>
                                    )}
                                  </div>
                                </div>{' '}
                                <div className="mt-1 text-xs font-semibold text-slate-800">
                                  Palpite:{' '}
                                  <strong className="text-sm font-black text-[#0F2A43]">
                                    {bet.placar_a} x {bet.placar_b}
                                  </strong>
                                </div>
                                {(() => {
                                  const splitPalpite = getPalpiteMarcadoresPorTime(bet)
                                  return (
                                    <ParticipantScorersView
                                      participanteNome={nomeParticipante}
                                      timeA={jogo.time_a}
                                      timeB={jogo.time_b}
                                      placarA={splitPalpite.placarA}
                                      placarB={splitPalpite.placarB}
                                      scorersA={splitPalpite.timeA}
                                      scorersB={splitPalpite.timeB}
                                      rawGolsA={bet.goleadores_a}
                                      rawGolsB={bet.goleadores_b}
                                      jogoGolsA={(jogo as any).gols_time_a}
                                      jogoGolsB={(jogo as any).gols_time_b}
                                    />
                                  )
                                })()}
                                {/* Detalhamento da pontuação parcial / ao vivo */}
                                <div className="mt-2 pt-2 border-t border-slate-200/80">
                                  {liveBreakdown && liveBreakdown.hasScore ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-emerald-800">
                                          +{liveBreakdown.pontos} pt
                                          {liveBreakdown.pontos === 1 ? '' : 's'} parciais
                                        </span>
                                        {liveBreakdown.pontos > 0 && (
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        )}
                                      </div>
                                      {liveBreakdown.resumoItens.length > 0 ? (
                                        <p className="text-[10px] text-slate-600 leading-tight">
                                          {liveBreakdown.resumoItens.join(', ')}
                                        </p>
                                      ) : (
                                        <p className="text-[10px] text-slate-400 italic">
                                          Nenhum acerto parcial no momento (0 pts)
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between text-[10px] text-slate-400 italic">
                                      <span>Aguardando início</span>
                                      <span className="font-semibold">-</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two Column Layout on Desktop: Ranking (60%) vs Actions & Archive (40%) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Leaderboard Card (60% ~ 7 cols) */}
        <div className="lg:col-span-7">
          <Card className="h-full rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardHeader className="p-0 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl font-bold text-[#0F172A]">
                    <Trophy className="h-5 w-5 text-[#F59E0B]" />
                    Tabela de Classificação Atual
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Pontuação somada em tempo real com regras oficiais
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
                >
                  Ao Vivo
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="py-12 text-center text-xs text-[#64748B]">
                  Carregando classificação...
                </div>
              ) : rankingParticipantes.length === 0 ? (
                <div className="rounded-lg bg-slate-50 py-10 text-center text-xs text-slate-500">
                  Nenhum participante registrado para esta competição.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {rankingParticipantes.map((part, index) => {
                    const badge = getPositionBadge(index)
                    const isCurrentUser =
                      participantName &&
                      part.nome.trim().toLowerCase() === participantName.trim().toLowerCase()

                    return (
                      <div
                        key={part.id}
                        className={`flex items-center justify-between px-4 py-3.5 transition duration-150 ${
                          isCurrentUser
                            ? 'bg-[#ECFDF5] font-semibold ring-1 ring-inset ring-emerald-200'
                            : index % 2 === 0
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-[#F8FAFC] hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Position circle */}
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs shadow-xs ${badge.bg}`}
                          >
                            {badge.text}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-[#0F172A]">{part.nome}</span>
                              {index === 0 && <span className="animate-bounce">🏆</span>}
                              {isCurrentUser && (
                                <Badge className="bg-[#10B981] px-1.5 py-0 text-[10px] font-bold text-white hover:bg-[#10B981]">
                                  Você
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Points */}
                        <div className="text-right flex flex-col items-end">
                          <div className="flex items-center gap-1.5">
                            <span className="text-lg font-black text-[#0F2A43]">
                              {part.pontuacao_total}
                            </span>
                            <span className="text-xs font-medium text-slate-500">pts</span>
                          </div>
                          {(part as any).pontos_ao_vivo > 0 && (
                            <span className="text-xs text-emerald-600 font-semibold leading-tight">
                              (+{(part as any).pontos_ao_vivo} ao vivo)
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Actions & Side Panels (40% ~ 5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Action Card */}
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardTitle className="text-lg font-bold text-[#0F172A]">Ações Rápidas</CardTitle>
            <p className="mt-1 text-xs text-[#64748B]">
              Gerencie seus palpites e acompanhe os confrontos.
            </p>

            <div className="mt-5 space-y-3">
              <Link to="/bolao/estatisticas" className="block">
                <Button className="h-11 w-full justify-between rounded-lg bg-[#F59E0B] text-sm font-bold text-slate-950 shadow-xs hover:bg-amber-400">
                  <span className="flex items-center gap-2">
                    <BarChart2 className="h-4 w-4" />
                    Estatísticas (Hall da Fama)
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>

              <Link
                to={isGeral ? '/bolao/meus-palpites?geral=1' : '/bolao/meus-palpites'}
                className="block"
              >
                <Button className="h-11 w-full justify-between rounded-lg bg-[#0F2A43] text-sm font-semibold text-white shadow-xs hover:bg-[#1B3A5C]">
                  <span>Meus Palpites</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>

              {isAdmin && (
                <Link to="/bolao/admin/jogos" className="block">
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-between rounded-lg border-[#0F2A43] text-sm font-semibold text-[#0F2A43] hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-500" />
                      Gerenciar Jogos (Admin)
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}

              <Link to="/bolao/chat" className="block">
                <Button
                  variant="outline"
                  className="h-11 w-full justify-between rounded-lg border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    Assistente do Bolão (IA)
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Card>

          {/* Historical Archive Card */}
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-indigo-50 p-2.5 text-indigo-700">
                <History className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-base font-bold text-[#0F172A]">
                  Banco de Dados Histórico
                </CardTitle>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  Consulte o histórico dos campeonatos anteriores.
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-slate-600">
              Acesse as classificações e resultados dos bolões passados (Copa Sormani, Copa
              Genilton, Copa Coni).
            </p>

            <Link to="/bolao/historico" className="mt-4 block">
              <Button
                variant="outline"
                className="h-10 w-full rounded-lg border-slate-300 text-xs font-semibold text-[#0F2A43] hover:bg-slate-50"
              >
                Ver Histórico Completo
              </Button>
            </Link>
          </Card>
        </div>
      </div>

      {/* Modal de Sobrescrita Manual do Admin Douglas (Partida em Andamento) */}
      {adminSobrescritaJogo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-amber-100 p-1.5 text-amber-800">
                  <Edit3 className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Sobrescrever Placar Ao Vivo</h3>
                  <p className="text-[11px] text-slate-500">
                    Prioridade sobre a API para exibição aos participantes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdminSobrescritaJogo(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-center text-xs font-semibold text-slate-700">
                {adminSobrescritaJogo.jogo.time_a} x {adminSobrescritaJogo.jogo.time_b}
              </div>

              {/* Placar */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Gols {adminSobrescritaJogo.jogo.time_a}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={adminSobrescritaJogo.placarA}
                    onChange={(e) => {
                      const val = e.target.value
                      const count = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0)
                      setAdminSobrescritaJogo((prev) => {
                        if (!prev) return null
                        const oldList = prev.golsA || []
                        const nextList: Array<{ nome: string; minuto: string }> = []
                        for (let i = 0; i < count; i++) {
                          nextList.push(oldList[i] || { nome: '', minuto: '' })
                        }
                        return {
                          ...prev,
                          placarA: val,
                          golsA: nextList,
                        }
                      })
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-base font-bold text-[#0F2A43] focus:border-amber-500 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Gols {adminSobrescritaJogo.jogo.time_b}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={adminSobrescritaJogo.placarB}
                    onChange={(e) => {
                      const val = e.target.value
                      const count = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0)
                      setAdminSobrescritaJogo((prev) => {
                        if (!prev) return null
                        const oldList = prev.golsB || []
                        const nextList: Array<{ nome: string; minuto: string }> = []
                        for (let i = 0; i < count; i++) {
                          nextList.push(oldList[i] || { nome: '', minuto: '' })
                        }
                        return {
                          ...prev,
                          placarB: val,
                          golsB: nextList,
                        }
                      })
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-base font-bold text-[#0F2A43] focus:border-amber-500 focus:outline-none"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Autores dos Gols individuais por gol (Mandante e Visitante) - Estrutura idêntica à de Meus Palpites */}
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {/* Time A */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                    <span className="text-xs font-bold text-slate-800">
                      Marcadores — {adminSobrescritaJogo.jogo.time_a}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-1.5 py-0.5">
                      {adminSobrescritaJogo.golsA.length} gol
                      {adminSobrescritaJogo.golsA.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {adminSobrescritaJogo.golsA.length === 0 ? (
                    <p className="py-2 text-center text-xs italic text-slate-400">
                      0 gols para este time (campos bloqueados)
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {adminSobrescritaJogo.golsA.map((gol, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                            {idx + 1}º
                          </span>
                          <input
                            type="text"
                            value={gol.nome}
                            onChange={(e) => {
                              const val = e.target.value
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsA]
                                nextList[idx] = { ...nextList[idx], nome: val }
                                return { ...prev, golsA: nextList }
                              })
                            }}
                            placeholder={`Jogador autor do ${idx + 1}º gol (ex: Raphinha)`}
                            className="flex-1 h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={gol.minuto}
                            onChange={(e) => {
                              const val = e.target.value
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsA]
                                nextList[idx] = { ...nextList[idx], minuto: val }
                                return { ...prev, golsA: nextList }
                              })
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              if (!raw) return
                              const cleanDigits = raw.replace(/\D/g, '')
                              const formatted = cleanDigits ? `${cleanDigits}'` : raw
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsA]
                                nextList[idx] = { ...nextList[idx], minuto: formatted }
                                return { ...prev, golsA: nextList }
                              })
                            }}
                            placeholder="Min (ex: 69)"
                            className="w-20 h-8 rounded-md border border-slate-300 bg-white px-2 text-center text-xs text-slate-800 focus:border-amber-500 focus:outline-none"
                            title="Minutagem do gol (ex: 69 ou 69')"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Time B */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                    <span className="text-xs font-bold text-slate-800">
                      Marcadores — {adminSobrescritaJogo.jogo.time_b}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-1.5 py-0.5">
                      {adminSobrescritaJogo.golsB.length} gol
                      {adminSobrescritaJogo.golsB.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {adminSobrescritaJogo.golsB.length === 0 ? (
                    <p className="py-2 text-center text-xs italic text-slate-400">
                      0 gols para este time (campos bloqueados)
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {adminSobrescritaJogo.golsB.map((gol, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                            {idx + 1}º
                          </span>
                          <input
                            type="text"
                            value={gol.nome}
                            onChange={(e) => {
                              const val = e.target.value
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsB]
                                nextList[idx] = { ...nextList[idx], nome: val }
                                return { ...prev, golsB: nextList }
                              })
                            }}
                            placeholder={`Jogador autor do ${idx + 1}º gol (ex: Youssouf Fofana)`}
                            className="flex-1 h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={gol.minuto}
                            onChange={(e) => {
                              const val = e.target.value
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsB]
                                nextList[idx] = { ...nextList[idx], minuto: val }
                                return { ...prev, golsB: nextList }
                              })
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              if (!raw) return
                              const cleanDigits = raw.replace(/\D/g, '')
                              const formatted = cleanDigits ? `${cleanDigits}'` : raw
                              setAdminSobrescritaJogo((prev) => {
                                if (!prev) return null
                                const nextList = [...prev.golsB]
                                nextList[idx] = { ...nextList[idx], minuto: formatted }
                                return { ...prev, golsB: nextList }
                              })
                            }}
                            placeholder="Min (ex: 19)"
                            className="w-20 h-8 rounded-md border border-slate-300 bg-white px-2 text-center text-xs text-slate-800 focus:border-amber-500 focus:outline-none"
                            title="Minutagem do gol (ex: 19 ou 19')"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-md bg-amber-50/80 p-2.5 text-[11px] text-amber-900 border border-amber-200">
                ℹ️ Esta sobrescrita tem prioridade visual máxima no card. Ela <strong>não</strong>{' '}
                altera regras de apuração oficial nem finaliza a partida.
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAdminSobrescritaJogo(null)}
                className="text-xs text-slate-500"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSalvarSobrescritaAdmin}
                disabled={adminSobrescritaJogo.isSaving}
                className="bg-[#F59E0B] hover:bg-amber-500 text-slate-950 font-bold text-xs"
              >
                {adminSobrescritaJogo.isSaving ? 'Salvando...' : 'Salvar Sobrescrita'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Marcadores do Admin */}
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
          setPalpites((prev) => prev.map((p) => (p.id === updatedRecord.id ? updatedRecord : p)))
          loadData(true)
        }}
      />
    </div>
  )
}
