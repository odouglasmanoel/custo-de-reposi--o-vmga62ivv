import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Radio,
  Calendar,
  Clock,
  RefreshCw,
  Search,
  AlertCircle,
  Trophy,
  Filter,
  Flame,
  Globe2,
  Shield,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react'
import { MatchDetailsModal } from '@/components/MatchDetailsModal'
import { setWithBoundedCapacity } from '@/lib/cacheManager'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getHojeDataSaoPaulo,
  getJogoKickoffTimestamp,
  parseHoraJogo,
  normalizeDataISO,
} from '@/lib/dateUtils'
import type { Jogo } from '@/types/bolao'
import {
  cleanTeamName,
  stringSimilarity,
  getFixtureDateSaoPaulo,
  isFixturePostponed,
  isFixtureCancelled,
  isFixtureLive,
  isFixtureFinished,
} from '@/lib/apiFootballMatcher'
import {
  buscarJogosIntervalo,
  buscarEscudoTime,
  readEscudoCache,
  JogoBuscado,
} from '@/services/enquetes'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface FixtureScorer {
  name: string
  minute: number | null
  extraMinute?: number | null
  teamId?: number | null
  teamName?: string | null
  teamSide?: 'home' | 'away' | null
}

export interface DayFixture {
  fixture: {
    id: number | string
    date: string
    timestamp?: number
    timezone?: string
    isManual?: boolean
    manualId?: string
    status: {
      long: string
      short: string
      elapsed?: number | null
    }
  }
  league: {
    id: number
    name: string
    country: string
    logo: string
    flag?: string
    round?: string
    region: 'Brasileirão & Copas' | 'Sul-Americana' | 'Futebol Europeu' | 'Outros'
  }
  teams: {
    home: {
      id: number
      name: string
      logo: string
      country?: string
    }
    away: {
      id: number
      name: string
      logo: string
      country?: string
    }
  }
  goals: {
    home: number | null
    away: number | null
  }
  score?: {
    halftime?: { home: number | null; away: number | null }
    fulltime?: { home: number | null; away: number | null }
    extratime?: { home: number | null; away: number | null }
    penalty?: { home: number | null; away: number | null }
  }
  scorers: FixtureScorer[]
  events?: any[]
  goalEvents?: any[]
  golevents?: any[]
  provider?: string
  isLive: boolean
  isManual?: boolean
  manualRecordId?: string
}

interface ApiResponse {
  configured: boolean
  provider?: string
  date: string
  total: number
  hasLive: boolean
  fixtures: DayFixture[]
  cached?: boolean
  cacheAgeSeconds?: number
  ttlSeconds?: number
  ttlRemainingSeconds?: number
  updatedAt?: string
  message?: string
  error?: string
  warning?: string
  rate_limited?: boolean
}

interface JogosDoDiaCachePayload {
  fixtures: DayFixture[]
  provider: string
  configured: boolean
  updatedAt: string
  timestamp: number
}

const JOGOS_DO_DIA_CACHE_PREFIX = 'cr_jogos_dia_cache_v4'
const jogosDiaMemoryCache = new Map<string, JogosDoDiaCachePayload>()

function readJogosDiaCache(dateStr: string): JogosDoDiaCachePayload | null {
  if (!dateStr) return null
  const fromMem = jogosDiaMemoryCache.get(dateStr)
  if (fromMem && Array.isArray(fromMem.fixtures)) {
    return fromMem
  }
  try {
    const raw = localStorage.getItem(`${JOGOS_DO_DIA_CACHE_PREFIX}_${dateStr}`)
    if (raw) {
      const parsed = JSON.parse(raw) as JogosDoDiaCachePayload
      if (parsed && Array.isArray(parsed.fixtures)) {
        jogosDiaMemoryCache.set(dateStr, parsed)
        return parsed
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeJogosDiaCache(dateStr: string, data: Omit<JogosDoDiaCachePayload, 'timestamp'>) {
  if (!dateStr) return
  const payload: JogosDoDiaCachePayload = {
    ...data,
    timestamp: Date.now(),
  }
  setWithBoundedCapacity(jogosDiaMemoryCache, dateStr, payload, 100)
  try {
    localStorage.setItem(`${JOGOS_DO_DIA_CACHE_PREFIX}_${dateStr}`, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

interface MatchRowItemProps {
  match: DayFixture
  renderStatusBadge: (fixture: DayFixture) => React.ReactNode
  getMatchScorers: (fixture: DayFixture) => { homeScorers: string[]; awayScorers: string[] }
  onOpenDetails: (fixture: DayFixture) => void
}

const MatchRowItem = React.memo(
  function MatchRowItem({
    match,
    renderStatusBadge,
    getMatchScorers,
    onOpenDetails,
  }: MatchRowItemProps) {
    const { homeScorers, awayScorers } = getMatchScorers(match)
    const stMatch = (match.fixture?.status?.short || '').toUpperCase().trim()
    const longMatch = (match.fixture?.status?.long || '').toUpperCase().trim()
    const matchIsPostponed = isFixturePostponed(stMatch, longMatch)
    const matchIsCancelled = isFixtureCancelled(stMatch, longMatch)
    const isPstOrCanc = matchIsPostponed || matchIsCancelled

    const isUpcomingMatch =
      !match.isLive &&
      !['FT', 'AET', 'PEN'].includes(stMatch) &&
      !matchIsPostponed &&
      !matchIsCancelled

    const hasExplicitHomeScore =
      match.goals?.home !== null &&
      match.goals?.home !== undefined &&
      !isNaN(Number(match.goals?.home))
    const hasExplicitAwayScore =
      match.goals?.away !== null &&
      match.goals?.away !== undefined &&
      !isNaN(Number(match.goals?.away))

    const showDash = isUpcomingMatch || !hasExplicitHomeScore || !hasExplicitAwayScore

    const homeScore = showDash ? '—' : match.goals?.home
    const awayScore = showDash ? '—' : match.goals?.away

    return (
      <div
        className={`p-4 transition hover:bg-slate-50/60 ${
          match.isLive ? 'bg-emerald-50/20' : isPstOrCanc ? 'bg-slate-50/40 opacity-90' : ''
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Status Badge */}
          <div className="shrink-0 sm:w-36">{renderStatusBadge(match)}</div>

          {/* Confronto Central: Times e Placar */}
          <div className="flex-1 max-w-xl">
            {(() => {
              const isScheduledStatus = ['NS', 'TBD', 'PST', 'CANC', 'ABD', 'SUSP'].includes(
                stMatch,
              )
              const hasAnyScorers = homeScorers.length > 0 || awayScorers.length > 0
              const canShowScorers = !isPstOrCanc && !isScheduledStatus && hasAnyScorers

              return (
                <>
                  <div className="flex items-start justify-between gap-4">
                    {/* Time Mandante e seus marcadores logo abaixo */}
                    <div className="flex flex-1 flex-col items-end text-right min-w-0">
                      <div className="flex items-center justify-end gap-2.5 w-full">
                        <span
                          className={`text-sm font-bold sm:text-base truncate ${
                            isPstOrCanc ? 'text-slate-600' : 'text-[#0F172A]'
                          }`}
                        >
                          {match.teams.home.name}
                        </span>
                        {match.teams.home.logo ? (
                          <img
                            src={match.teams.home.logo}
                            alt={match.teams.home.name}
                            className={`h-6 w-6 object-contain shrink-0 ${
                              isPstOrCanc ? 'grayscale-[50%] opacity-80' : ''
                            }`}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget
                                .nextElementSibling as HTMLElement | null
                              if (fallback) fallback.style.display = 'flex'
                            }}
                          />
                        ) : null}
                        <div
                          className={`h-6 w-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 ${
                            match.teams.home.logo ? 'hidden' : 'flex'
                          }`}
                          title={match.teams.home.name}
                        >
                          {match.teams.home.name ? (
                            <span className="text-[10px] font-black uppercase text-slate-600">
                              {match.teams.home.name.substring(0, 2)}
                            </span>
                          ) : (
                            <Shield className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                      </div>
                      {/* Marcadores do MANDANTE logo abaixo do nome */}
                      {canShowScorers && homeScorers.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-right w-full">
                          {homeScorers.map((s, idx) => (
                            <div
                              key={idx}
                              className="truncate text-slate-500 font-normal text-[11px]"
                              title={s}
                            >
                              {s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Placar Central ou Badge de Adiado/Cancelado */}
                    <div className="shrink-0 flex flex-col items-center pt-0.5">
                      {isPstOrCanc ? (
                        <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 shadow-2xs min-w-[72px]">
                          <span>{matchIsPostponed ? 'Adiado' : 'Cancelado'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-1 font-mono text-base font-black text-white shadow-2xs sm:text-lg min-w-[72px]">
                          <span>{homeScore}</span>
                          <span className="text-slate-500 font-normal">:</span>
                          <span>{awayScore}</span>
                        </div>
                      )}

                      {/* Detalhes de Pênaltis se houver */}
                      {match.score?.penalty &&
                        match.score.penalty.home !== null &&
                        match.score.penalty.away !== null && (
                          <div className="text-center text-[10px] font-semibold text-slate-500 mt-1">
                            (Pên: {match.score.penalty.home}x{match.score.penalty.away})
                          </div>
                        )}
                    </div>

                    {/* Time Visitante e seus marcadores logo abaixo */}
                    <div className="flex flex-1 flex-col items-start text-left min-w-0">
                      <div className="flex items-center justify-start gap-2.5 w-full">
                        {match.teams.away.logo ? (
                          <img
                            src={match.teams.away.logo}
                            alt={match.teams.away.name}
                            className={`h-6 w-6 object-contain shrink-0 ${
                              isPstOrCanc ? 'grayscale-[50%] opacity-80' : ''
                            }`}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget
                                .nextElementSibling as HTMLElement | null
                              if (fallback) fallback.style.display = 'flex'
                            }}
                          />
                        ) : null}
                        <div
                          className={`h-6 w-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 ${
                            match.teams.away.logo ? 'hidden' : 'flex'
                          }`}
                          title={match.teams.away.name}
                        >
                          {match.teams.away.name ? (
                            <span className="text-[10px] font-black uppercase text-slate-600">
                              {match.teams.away.name.substring(0, 2)}
                            </span>
                          ) : (
                            <Shield className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                        <span
                          className={`text-sm font-bold sm:text-base truncate ${
                            isPstOrCanc ? 'text-slate-600' : 'text-[#0F172A]'
                          }`}
                        >
                          {match.teams.away.name}
                        </span>
                      </div>
                      {/* Marcadores do VISITANTE logo abaixo do nome */}
                      {canShowScorers && awayScorers.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-left w-full">
                          {awayScorers.map((s, idx) => (
                            <div
                              key={idx}
                              className="truncate text-slate-500 font-normal text-[11px]"
                              title={s}
                            >
                              {s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
            })()}
          </div>

          {/* Espaço lateral com botão Exibir Detalhes */}
          <div className="shrink-0 flex items-center justify-end gap-2 sm:w-36">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenDetails(match)}
              className="h-7 px-2.5 text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-200 gap-1 rounded-md cursor-pointer transition shadow-2xs"
              title="Exibir Ficha e Detalhes da Partida"
            >
              <FileText className="h-3 w-3 text-slate-500" />
              <span>Exibir Detalhes</span>
            </Button>
          </div>
        </div>
      </div>
    )
  },
  (prev, next) => {
    return (
      prev.match.fixture.id === next.match.fixture.id &&
      prev.match.isLive === next.match.isLive &&
      prev.match.goals?.home === next.match.goals?.home &&
      prev.match.goals?.away === next.match.goals?.away &&
      prev.match.fixture.status?.short === next.match.fixture.status?.short &&
      prev.match.fixture.status?.elapsed === next.match.fixture.status?.elapsed &&
      prev.match.scorers?.length === next.match.scorers?.length
    )
  },
)

export default function JogosDoDia() {
  const { user, isAdmin } = useAuth()
  const [selectedDate, setSelectedDate] = useState<string>(() => getHojeDataSaoPaulo(Date.now()))

  // Leitura inicial síncrona do cache SWR de dois níveis
  const initialCache = useMemo(() => {
    return readJogosDiaCache(selectedDate)
  }, [selectedDate])

  const [fixtures, setFixtures] = useState<DayFixture[]>(() => initialCache?.fixtures || [])
  const [loading, setLoading] = useState<boolean>(
    () => !initialCache || initialCache.fixtures.length === 0,
  )
  const [isRevalidating, setIsRevalidating] = useState<boolean>(
    () => !!(initialCache && initialCache.fixtures.length > 0),
  )
  const [refreshing, setRefreshing] = useState(false)
  const [activeProvider, setActiveProvider] = useState<string>(
    () => initialCache?.provider || 'api_football',
  )
  const [isConfigured, setIsConfigured] = useState<boolean>(() =>
    initialCache ? initialCache.configured : true,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCached, setIsCached] = useState<boolean>(false)
  const [cacheAge, setCacheAge] = useState<number>(0)
  const [ttlRemaining, setTtlRemaining] = useState<number>(0)
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [lastUpdated, setLastUpdated] = useState<string>(() => initialCache?.updatedAt || '')

  const prevDateRef = useRef<string>(selectedDate)
  const activeFetchAbortRef = useRef<AbortController | null>(null)

  // Filtros
  const [selectedCompetition, setSelectedCompetition] = useState<string>('todos')
  const [isCompetitionsExpanded, setIsCompetitionsExpanded] = useState<boolean>(false)
  const [selectedRound, setSelectedRound] = useState<string>('todos')
  const [selectedStatus, setSelectedStatus] = useState<string>('todos') // todos, ao-vivo, em-breve, finalizado
  const [searchTerm, setSearchTerm] = useState<string>('')

  // Modal de Detalhes da Partida sob demanda
  const [selectedDetailsMatch, setSelectedDetailsMatch] = useState<DayFixture | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)

  const handleOpenDetails = useCallback((match: DayFixture) => {
    setSelectedDetailsMatch(match)
    setIsDetailsModalOpen(true)
  }, [])

  const handleCloseDetails = useCallback(() => {
    setIsDetailsModalOpen(false)
    setSelectedDetailsMatch(null)
  }, [])

  const fetchJogos = useCallback(
    async (dateStr: string, force = false) => {
      try {
        if (force) {
          setRefreshing(true)
        } else {
          // Se já temos partidas em cache, não exibe tela bloqueante, apenas sinaliza revalidação discreta
          const hasExisting =
            fixtures.length > 0 || (readJogosDiaCache(dateStr)?.fixtures.length || 0) > 0
          if (hasExisting) {
            setIsRevalidating(true)
          } else {
            setLoading(true)
          }
        }
        setErrorMessage(null)

        if (activeFetchAbortRef.current) {
          activeFetchAbortRef.current.abort()
        }
        const controller = new AbortController()
        activeFetchAbortRef.current = controller

        const headers: Record<string, string> = {}
        if (pb.authStore.token) {
          headers['Authorization'] = pb.authStore.token
        }

        // ====================================================================
        // REGRA DE OURO DO USUÁRIO:
        // Não fazer requisições diretas à API externa no clique ou carregamento da tela!
        // A tela lê EXCLUSIVAMENTE a tabela local `jogos_do_dia` gravada pelo cron matinal.
        // Se a tabela estiver vazia para a data, avisa amigavelmente sem disparar requisições.
        // ====================================================================
        const localRecords = await pb.collection('jogos_do_dia').getFullList({
          filter: `data = '${dateStr}'`,
          sort: 'campeonato,horario',
          requestKey: `jogos_do_dia_${dateStr}`,
        })

        // Converte registros da collection local `jogos_do_dia` para DayFixture
        const convertedFixtures: DayFixture[] = (localRecords || []).map((rec: any) => {
          const rawPayload = rec.raw_payload || {}
          const stShort = rec.status_short || 'NS'
          const stLong = rec.status_long || 'Agendado'
          const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(stShort.toUpperCase())

          return {
            fixture: {
              id: rec.fixture_id,
              date: rec.data_hora_iso || `${rec.data}T${rec.horario || '16:00'}:00-03:00`,
              status: {
                short: stShort,
                long: stLong,
                elapsed: rec.status_elapsed != null ? rec.status_elapsed : null,
              },
            },
            league: {
              id: rec.league_id || 0,
              name: rec.campeonato || 'Futebol',
              country: rec.pais || 'Brasil',
              logo: rec.campeonato_logo || '',
              round: rec.round || '',
              region: rec.regiao || 'Brasileirão & Copas',
            },
            teams: {
              home: {
                id: rawPayload.teams?.home?.id || 0,
                name: rec.time_casa,
                logo: rec.logo_casa || '',
              },
              away: {
                id: rawPayload.teams?.away?.id || 0,
                name: rec.time_visitante,
                logo: rec.logo_visitante || '',
              },
            },
            goals: {
              home: rec.placar_casa != null ? Number(rec.placar_casa) : null,
              away: rec.placar_visitante != null ? Number(rec.placar_visitante) : null,
            },
            events: rec.events || rawPayload.events || [],
            scorers: rec.scorers || [],
            isLive: isLive,
          }
        })

        setActiveProvider('api_football')
        setIsCached(true)
        setCacheAge(0)
        setTtlRemaining(0)
        setIsRateLimited(false)

        const finalFixturesList = convertedFixtures
        setFixtures(finalFixturesList)
        setIsConfigured(true)

        const updatedTimestamp = new Date().toISOString()
        setLastUpdated(updatedTimestamp)

        writeJogosDiaCache(dateStr, {
          fixtures: finalFixturesList,
          provider: 'api_football',
          configured: true,
          updatedAt: updatedTimestamp,
        })

        if (finalFixturesList.length === 0) {
          setErrorMessage(
            'Nenhum jogo armazenado no momento. As partidas sincronizadas aparecerão após o próximo ciclo de atualização.',
          )
        } else {
          setErrorMessage(null)
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error('Erro ao buscar jogos do dia:', err)
        // Fallback defensivo com cache local caso ocorra exceção não tratada
        const cachedFallback = readJogosDiaCache(dateStr)
        if (cachedFallback && cachedFallback.fixtures.length > 0) {
          setFixtures(cachedFallback.fixtures)
          setIsConfigured(cachedFallback.configured)
          setLastUpdated(cachedFallback.updatedAt)
          setErrorMessage(null)
        } else {
          setErrorMessage(
            'Nenhum jogo armazenado no momento. As partidas sincronizadas aparecerão após o próximo ciclo de atualização.',
          )
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
        setIsRevalidating(false)
      }
    },
    [fixtures.length],
  )

  // Hidratação instantânea ao trocar a data selecionada (SWR)
  useEffect(() => {
    if (selectedDate !== prevDateRef.current) {
      prevDateRef.current = selectedDate
      const cached = readJogosDiaCache(selectedDate)
      if (cached && cached.fixtures.length > 0) {
        setFixtures(cached.fixtures)
        setActiveProvider(cached.provider)
        setIsConfigured(cached.configured)
        setLastUpdated(cached.updatedAt)
        setLoading(false)
        setIsRevalidating(true)
      } else {
        setFixtures([])
        setLoading(true)
        setIsRevalidating(false)
      }
    }
    fetchJogos(selectedDate)
  }, [selectedDate, fetchJogos])

  // Lista todos os jogos do mundo retornados pelos provedores (/backend/v1/jogos-do-dia e buscarJogosIntervalo semCorte=true).
  // Sem travas de exclusão por região 'Outros' ou condição de times brasileiros em Libertadores/Sul-Americana.
  const relevantFixtures = useMemo(() => {
    const seenMatchupKeys = new Set<string>()
    const deduplicated: DayFixture[] = []

    for (const item of fixtures) {
      // FILTRO DE FUSO HORÁRIO (America/Sao_Paulo - UTC-3):
      // Converte o horário da partida para a data no fuso de Brasília.
      // Se a partida pertence a outro dia que não a selectedDate selecionada no datepicker,
      // descarta para evitar contaminação de datas vizinhas.
      const fixtureDateStr = item.fixture?.date
      if (selectedDate && fixtureDateStr) {
        const fixtureDateSP = getFixtureDateSaoPaulo(fixtureDateStr)
        if (fixtureDateSP && fixtureDateSP !== selectedDate) {
          continue
        }
      }

      // DEDUPLICAÇÃO DE CONFRONTOS ENTRE PROVEDORES:
      // Garante que o mesmo par de times não apareça duas vezes na lista final independente da ordem
      const hClean = cleanTeamName(item.teams?.home?.name || '').toLowerCase()
      const aClean = cleanTeamName(item.teams?.away?.name || '').toLowerCase()
      if (hClean && aClean) {
        const matchupKey = [hClean, aClean].sort().join('__vs__')
        if (seenMatchupKeys.has(matchupKey)) {
          continue
        }
        seenMatchupKeys.add(matchupKey)
      }

      deduplicated.push(item)
    }

    return deduplicated
  }, [fixtures, selectedDate])

  // Contadores para os filtros de status e controle de polling baseados nas partidas relevantes
  const counts = useMemo(() => {
    let live = 0
    let scheduled = 0
    let finished = 0

    for (const f of relevantFixtures) {
      const st = (f.fixture?.status?.short || '').toUpperCase().trim()
      const long = (f.fixture?.status?.long || '').toUpperCase().trim()
      const isPostponedOrCancelled = isFixturePostponed(st, long) || isFixtureCancelled(st, long)

      if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)) {
        live++
      } else if (['FT', 'AET', 'PEN'].includes(st)) {
        finished++
      } else if (!isPostponedOrCancelled) {
        scheduled++
      }
    }

    return { total: relevantFixtures.length, live, scheduled, finished }
  }, [relevantFixtures])

  // Regra de ouro da arquitetura:
  // Zero polling pelo frontend! A tela lê exclusivamente a tabela local do banco.
  // Nenhuma requisição à API externa é disparada no cliente por timers ou kickoffs.

  // Lista de competições 100% dinâmica derivada dos jogos do dia
  const availableCompetitions = useMemo(() => {
    const compsMap = new Map<string, string>()
    for (const f of relevantFixtures) {
      const leagueName = (f.league?.name || '').trim()
      if (leagueName) compsMap.set(leagueName, leagueName)
    }
    return Array.from(compsMap.keys()).sort((a, b) => a.localeCompare(b))
  }, [relevantFixtures])

  // Reseta selectedCompetition se a competição selecionada não estiver mais nas disponíveis
  useEffect(() => {
    if (selectedCompetition !== 'todos' && !availableCompetitions.includes(selectedCompetition)) {
      setSelectedCompetition('todos')
    }
  }, [availableCompetitions, selectedCompetition])

  // Lista dinâmica de rounds/fases com base nos jogos da competição selecionada
  const availableRounds = useMemo(() => {
    const roundsSet = new Set<string>()
    for (const f of relevantFixtures) {
      if (selectedCompetition !== 'todos' && (f.league?.name || '').trim() !== selectedCompetition)
        continue
      const r = (f.league?.round || '').trim()
      if (r) roundsSet.add(r)
    }
    return Array.from(roundsSet).sort((a, b) => a.localeCompare(b))
  }, [relevantFixtures, selectedCompetition])

  // Reseta selectedRound caso o round atual não exista mais nas opções da competição selecionada
  useEffect(() => {
    if (selectedRound !== 'todos' && !availableRounds.includes(selectedRound)) {
      setSelectedRound('todos')
    }
  }, [availableRounds, selectedRound])

  // Função utilitária para extrair timestamp absoluto de kickoff para ordenação
  const resolveKickoffTimestamp = useCallback((fixture: DayFixture): number => {
    const rawDate = fixture.fixture?.date
    if (!rawDate) return 0

    // Se já é uma ISO completa ou data com hora UTC/offset
    if (rawDate.includes('T')) {
      const parsedUtc = new Date(rawDate).getTime()
      if (!isNaN(parsedUtc)) {
        return parsedUtc
      }
    }

    // Se for string no formato data ou data com hora separada
    const ts = getJogoKickoffTimestamp(rawDate)
    if (ts !== null && !isNaN(ts)) {
      return ts
    }

    const fallbackDate = new Date(rawDate).getTime()
    return !isNaN(fallbackDate) ? fallbackDate : 0
  }, [])

  // Filtragem e busca baseadas no conjunto de ligas relevantes
  const filteredFixtures = useMemo(() => {
    return relevantFixtures.filter((f) => {
      // Filtro de competição 100% dinâmico
      if (
        selectedCompetition !== 'todos' &&
        (f.league?.name || '').trim() !== selectedCompetition
      ) {
        return false
      }

      // Filtro de divisão / fase
      if (selectedRound !== 'todos') {
        const r = (f.league?.round || '').trim()
        if (r !== selectedRound) {
          return false
        }
      }

      // Filtro de status
      const st = (f.fixture?.status?.short || '').toUpperCase().trim()
      const long = (f.fixture?.status?.long || '').toUpperCase().trim()
      const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)
      const isFinished = ['FT', 'AET', 'PEN'].includes(st)
      const isPostponedOrCancelled = isFixturePostponed(st, long) || isFixtureCancelled(st, long)
      const isUpcoming = !isLive && !isFinished && !isPostponedOrCancelled

      if (selectedStatus === 'ao-vivo' && !isLive) return false
      if (selectedStatus === 'em-breve' && !isUpcoming) return false
      if (selectedStatus === 'finalizado' && !isFinished) return false

      // Busca por texto (time mandante, visitante ou nome da liga)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim()
        const home = (f.teams?.home?.name || '').toLowerCase()
        const away = (f.teams?.away?.name || '').toLowerCase()
        const leagueName = (f.league?.name || '').toLowerCase()
        if (!home.includes(query) && !away.includes(query) && !leagueName.includes(query)) {
          return false
        }
      }

      return true
    })
  }, [relevantFixtures, selectedCompetition, selectedRound, selectedStatus, searchTerm])

  // Agrupamento por competição/liga
  const groupedByLeague = useMemo(() => {
    const map = new Map<
      number | string,
      {
        league: DayFixture['league']
        matches: DayFixture[]
      }
    >()

    for (const match of filteredFixtures) {
      const lid = match.league.id
      const existing = map.get(lid)
      if (!existing) {
        map.set(lid, {
          league: match.league,
          matches: [match],
        })
      } else {
        existing.matches.push(match)
      }
    }

    const groups = Array.from(map.values())

    // Ordenação interna das partidas dentro de cada grupo por horário cronológico e competição
    for (const group of groups) {
      group.matches.sort((a, b) => {
        const timeA = resolveKickoffTimestamp(a)
        const timeB = resolveKickoffTimestamp(b)
        if (timeA !== timeB) {
          return timeA - timeB
        }
        return (a.league?.name || '').localeCompare(b.league?.name || '')
      })
    }

    return groups.sort((a, b) => {
      // Prioridade máxima: ligas com jogos manuais inseridos pelo Admin
      const aHasManual = a.matches.some((m) => m.isManual || m.fixture?.isManual)
      const bHasManual = b.matches.some((m) => m.isManual || m.fixture?.isManual)
      if (aHasManual && !bHasManual) return -1
      if (!aHasManual && bHasManual) return 1

      // Em seguida: ligas com jogos ao vivo primeiro, depois pelo nome
      const aHasLive = a.matches.some((m) => m.isLive)
      const bHasLive = b.matches.some((m) => m.isLive)
      if (aHasLive && !bHasLive) return -1
      if (!aHasLive && bHasLive) return 1

      // Ordenação cronológica pelo horário da primeira partida do grupo
      const earliestA = a.matches.length > 0 ? resolveKickoffTimestamp(a.matches[0]) : 0
      const earliestB = b.matches.length > 0 ? resolveKickoffTimestamp(b.matches[0]) : 0
      if (earliestA !== earliestB) {
        return earliestA - earliestB
      }

      return (a.league?.name || '').localeCompare(b.league?.name || '')
    })
  }, [filteredFixtures])

  // Helpers de formatação de status
  const renderStatusBadge = useCallback((fixture: DayFixture) => {
    const isManual = Boolean(fixture.isManual || fixture.fixture?.isManual)
    const st = (fixture.fixture?.status?.short || '').toUpperCase().trim()
    const long = (fixture.fixture?.status?.long || '').toUpperCase().trim()
    const elapsed = fixture.fixture?.status?.elapsed
    // Jogos Adiados (PST / POSTPONED)
    if (isFixturePostponed(st, long)) {
      return (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-800 font-bold text-[11px] gap-1 px-2 py-0.5 shadow-2xs"
        >
          <Clock className="h-3 w-3 text-amber-600" />
          Adiado
        </Badge>
      )
    }

    // Jogos Cancelados / Suspensos (CANC / CANCELLED / SUSP / ABD)
    if (isFixtureCancelled(st, long)) {
      return (
        <Badge
          variant="outline"
          className="border-rose-300 bg-rose-50 text-rose-700 font-bold text-[11px] gap-1 px-2 py-0.5 shadow-2xs"
        >
          <AlertCircle className="h-3 w-3 text-rose-500" />
          Cancelado
        </Badge>
      )
    }

    if (st === 'HT') {
      return (
        <Badge className="bg-amber-500 text-slate-950 font-black text-[11px] gap-1 px-2 py-0.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
          </span>
          Intervalo (HT)
        </Badge>
      )
    }

    if (['1H', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)) {
      return (
        <Badge className="bg-emerald-600 text-white font-black text-[11px] gap-1.5 px-2.5 py-0.5 animate-pulse">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
          Ao Vivo {elapsed ? `${elapsed}'` : ''}
        </Badge>
      )
    }

    if (['FT', 'AET', 'PEN'].includes(st)) {
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant="outline"
            className="border-slate-300 bg-slate-100 text-slate-700 font-bold text-[11px]"
          >
            Finalizado
          </Badge>
          {isManual && (
            <Badge className="border-amber-400 bg-amber-50 text-amber-800 border font-semibold text-[10px] px-1.5 py-0">
              Manual
            </Badge>
          )}
        </div>
      )
    }
    // Horário agendado (apenas se data for válida)
    const matchDate = new Date(fixture.fixture.date)
    if (isNaN(matchDate.getTime())) {
      return (
        <Badge
          variant="outline"
          className="border-slate-200 bg-slate-50 text-slate-600 font-bold text-[11px]"
        >
          A Definir
        </Badge>
      )
    }

    const horaBR = matchDate.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })

    return (
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="outline"
          className="border-blue-200 bg-blue-50 text-blue-800 font-bold text-[11px] gap-1"
        >
          <Clock className="h-3 w-3" />
          {horaBR}
        </Badge>
        {isManual && (
          <Badge className="border-amber-400 bg-amber-50 text-amber-800 border font-semibold text-[10px] px-1.5 py-0">
            Manual
          </Badge>
        )}
      </div>
    )
  }, [])

  const GENERIC_GOAL_TERMS = new Set([
    'gol',
    'goal',
    'normal goal',
    'penalty',
    'own goal',
    'pênalti',
    'penalti',
    'contra',
    'autogol',
    'missed penalty',
  ])
  function isGenericScorerName(name?: string | null): boolean {
    if (!name || typeof name !== 'string') return true
    const clean = name.trim().toLowerCase()
    return !clean || GENERIC_GOAL_TERMS.has(clean)
  }

  // Agrupar marcadores por time para exibição visual, consumindo:
  // - events da API-Football
  // - goals / goalEvents do Football-Data.org
  // - golevents / events do TheSportsDB
  // - scorers normalizado do backend
  const getMatchScorers = useCallback((fixture: DayFixture) => {
    const homeScorers: string[] = []
    const awayScorers: string[] = []
    const seenScorerKeys = new Set<string>()

    const addScorer = (
      name: string,
      minute: number | null | undefined,
      side: 'home' | 'away' | null,
      isOwnGoal = false,
      extraMinute?: number | null | undefined,
      typeOrDetail = '',
      eventIndex: number = 0,
    ) => {
      if (!side || (side !== 'home' && side !== 'away')) return

      // Gols contra creditados ao time beneficiado no placar
      const effectiveSide = isOwnGoal ? (side === 'home' ? 'away' : 'home') : side

      // Limpeza rigorosa do nome (remover emojis duplicados, minutagem residual no final e sufixos repetidos)
      let cleanName = (name || '').trim()
      cleanName = cleanName.replace(/⚽/g, '').trim()
      // Remove sufixos repetidos de contra/own goal
      cleanName = cleanName.replace(/\s*\((contra|own\s*goal|o\.?g\.?)\)/gi, '').trim()
      // Remove minutagem residual no final (ex: "27'", "45+2'", "27")
      cleanName = cleanName.replace(/\s*\d+(\+\d+)?'?$/, '').trim()

      const hasRealName = !isGenericScorerName(cleanName)
      const finalDisplayName = hasRealName ? (isOwnGoal ? `${cleanName} (contra)` : cleanName) : ''

      let parsedMin = minute != null && !isNaN(Number(minute)) ? Number(minute) : null
      let parsedExtra =
        extraMinute != null && !isNaN(Number(extraMinute)) && Number(extraMinute) > 0
          ? Number(extraMinute)
          : null

      // Se minute não veio separado mas estava no nome original
      if (parsedMin == null && name) {
        const rawMinMatch = name.match(/(\d+)\s*\+\s*(\d+)/)
        if (rawMinMatch) {
          parsedMin = parseInt(rawMinMatch[1], 10)
          parsedExtra = parseInt(rawMinMatch[2], 10)
        } else {
          const singleMinMatch = name.match(/(\d+)'?$/)
          if (singleMinMatch) {
            parsedMin = parseInt(singleMinMatch[1], 10)
          }
        }
      }

      let minFormatted = ''
      let minutoNormalizado = ''
      if (parsedMin != null) {
        if (parsedExtra != null) {
          minFormatted = `${parsedMin}+${parsedExtra}'`
          minutoNormalizado = `${parsedMin}+${parsedExtra}`
        } else {
          minFormatted = `${parsedMin}'`
          minutoNormalizado = `${parsedMin}`
        }
      }

      // Regra estrita: se não houver nome real E não houver minuto, NÃO adicionar o marcador (return)
      if (!hasRealName && !minFormatted) {
        return
      }

      // Com nome real: `⚽ Nome 38'` (ou sem minuto: `⚽ Nome`). Sem nome com minuto: `⚽ 38'`.
      const entry = hasRealName
        ? minFormatted
          ? `⚽ ${finalDisplayName} ${minFormatted}`
          : `⚽ ${finalDisplayName}`
        : `⚽ ${minFormatted}`

      // Chave de deduplicação composta:
      // ${lado}__${nomeNormalizado}__${minuto}__${acrescimos||0}__${tipo||''}__${indiceDoEvento}
      // Garante que dois gols do mesmo atleta em minutos diferentes (ou até no mesmo tempo) NUNCA colapsem!
      const nomeNormalizado = cleanName.toLowerCase()
      const extraVal = parsedExtra || 0
      const tipoVal = (typeOrDetail || '').toLowerCase().trim()
      const key = `${effectiveSide}__${nomeNormalizado}__${minutoNormalizado}__${extraVal}__${tipoVal}__${eventIndex}`
      if (seenScorerKeys.has(key)) return
      seenScorerKeys.add(key)

      if (effectiveSide === 'away') {
        awayScorers.push(entry)
      } else if (effectiveSide === 'home') {
        homeScorers.push(entry)
      }
    }

    const homeId = fixture.teams?.home?.id
    const awayId = fixture.teams?.away?.id
    const homeClean = cleanTeamName(fixture.teams?.home?.name || '').toLowerCase()
    const awayClean = cleanTeamName(fixture.teams?.away?.name || '').toLowerCase()

    const resolveSide = (
      tId: number | null | undefined,
      tName: string | null | undefined,
      hintSide: 'home' | 'away' | null | undefined,
    ): 'home' | 'away' | null => {
      if (hintSide === 'home' || hintSide === 'away') return hintSide
      if (tId != null) {
        if (homeId != null && String(tId) === String(homeId)) return 'home'
        if (awayId != null && String(tId) === String(awayId)) return 'away'
      }
      if (tName) {
        const homeRaw = fixture.teams?.home?.name || ''
        const awayRaw = fixture.teams?.away?.name || ''
        const simHome = Math.max(
          stringSimilarity(tName, homeRaw),
          homeClean ? stringSimilarity(cleanTeamName(tName), homeClean) : 0,
        )
        const simAway = Math.max(
          stringSimilarity(tName, awayRaw),
          awayClean ? stringSimilarity(cleanTeamName(tName), awayClean) : 0,
        )
        // Normalização aprofundada (acentos, caixa, pontuação)
        const normalizeStr = (s: string) =>
          s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
        const normTarget = normalizeStr(tName)
        const normHome = normalizeStr(homeRaw)
        const normAway = normalizeStr(awayRaw)
        const c = cleanTeamName(tName).toLowerCase()

        const subHome =
          (homeClean && (c === homeClean || homeClean.includes(c) || c.includes(homeClean))) ||
          (normHome && (normTarget.includes(normHome) || normHome.includes(normTarget)))
        const subAway =
          (awayClean && (c === awayClean || awayClean.includes(c) || c.includes(awayClean))) ||
          (normAway && (normTarget.includes(normAway) || normAway.includes(normTarget)))

        if (subHome && !subAway) return 'home'
        if (subAway && !subHome) return 'away'
        if (simHome >= 0.55 && simHome > simAway) return 'home'
        if (simAway >= 0.55 && simAway > simHome) return 'away'
      }
      return null
    }

    // Leitura tolerante de autor do gol tratando objetos aninhados e todas as chaves
    const extractNameFromEv = (ev: any): string => {
      if (!ev) return ''
      const candidates = [
        ev.player?.name,
        ev.player?.shortName,
        typeof ev.player === 'object' && ev.player?.name ? ev.player.name : null,
        ev.scorer?.name,
        ev.scorer?.shortName,
        typeof ev.scorer === 'object' && ev.scorer?.name ? ev.scorer.name : null,
        ev.strPlayer,
        ev.playerName,
        ev.player_name,
        ev.event_player,
        ev.strScorer,
        ev.scorer_name,
        typeof ev.player === 'string' ? ev.player : null,
        typeof ev.scorer === 'string' ? ev.scorer : null,
        ev.name,
        ev.strEvent,
        ev.detail,
      ]
      for (const cand of candidates) {
        if (typeof cand === 'string' && !isGenericScorerName(cand)) {
          return cand.trim()
        }
      }
      return ''
    }

    // Leitura de minutagem aceitando time.elapsed, minute, intMinute, intGoalScoredTime, time e strings "43'" ou "45+2'"
    const extractMinuteFromEv = (ev: any): { minute: number | null; extra: number | null } => {
      if (!ev) return { minute: null, extra: null }
      let rawMin =
        ev.time?.elapsed ??
        ev.minute ??
        ev.intMinute ??
        ev.intGoalScoredTime ??
        (typeof ev.time === 'number' || typeof ev.time === 'string' ? ev.time : null) ??
        ev.intTime ??
        null
      let rawExtra = ev.time?.extra ?? ev.extraMinute ?? null

      if (typeof rawMin === 'string') {
        const plusMatch = rawMin.match(/(\d+)\s*\+\s*(\d+)/)
        if (plusMatch) {
          rawMin = parseInt(plusMatch[1], 10)
          rawExtra = parseInt(plusMatch[2], 10)
        } else {
          const numMatch = rawMin.match(/(\d+)/)
          rawMin = numMatch ? parseInt(numMatch[1], 10) : null
        }
      }
      return {
        minute: rawMin != null && !isNaN(Number(rawMin)) ? Number(rawMin) : null,
        extra: rawExtra != null && !isNaN(Number(rawExtra)) ? Number(rawExtra) : null,
      }
    }

    // 1. Array normalizado universal do backend (scorers)
    if (Array.isArray(fixture.scorers) && fixture.scorers.length > 0) {
      for (let i = 0; i < fixture.scorers.length; i++) {
        const sc = fixture.scorers[i]
        if (!sc || !sc.name) continue
        const side = resolveSide(sc.teamId, sc.teamName, sc.teamSide)
        const isContra = /contra|own\s*goal|o\.?g\.?/i.test(sc.name)
        const cleanScName = sc.name
          .replace(/⚽/g, '')
          .replace(/\s*\(contra\)/gi, '')
          .replace(/\s*\d+(\+\d+)?'?$/, '')
          .trim()
        const minObj = {
          minute: sc.minute != null ? Number(sc.minute) : null,
          extra: sc.extraMinute != null ? Number(sc.extraMinute) : null,
        }
        // Se for gol contra, o gol pontua para a equipe adversária no placar
        addScorer(cleanScName, minObj.minute, side, isContra, minObj.extra, 'goal', i)
      }
    }

    // 2. Provedor API-Football: events do tipo "Goal"
    if (
      homeScorers.length === 0 &&
      awayScorers.length === 0 &&
      Array.isArray(fixture.events) &&
      fixture.events.length > 0
    ) {
      for (let i = 0; i < fixture.events.length; i++) {
        const ev = fixture.events[i]
        const evType = String(ev?.type || '')
          .toLowerCase()
          .trim()
        const evDetail = String(ev?.detail || '')
          .toLowerCase()
          .trim()
        if (ev && (evType === 'goal' || evType === 'gol' || evDetail.includes('goal'))) {
          // Nome de ev.player?.name || ev.scorer?.name (via extractNameFromEv)
          const playerName = ev.player?.name || ev.scorer?.name || extractNameFromEv(ev)
          // Gol contra quando evDetail.includes('own')
          const isOwn = evDetail.includes('own') || evType.includes('own')
          // Minuto de ev.time?.elapsed ?? ev.minute; extra de ev.time?.extra
          const minute = ev.time?.elapsed ?? ev.minute ?? extractMinuteFromEv(ev).minute
          const extra = ev.time?.extra ?? extractMinuteFromEv(ev).extra
          // Lado via resolveSide(ev.team?.id, ev.team?.name, null)
          const side = resolveSide(ev.team?.id, ev.team?.name, null)
          addScorer(playerName, minute, side, isOwn, extra, evDetail || evType, i)
        }
      }
    }

    // 3. Provedor Football-Data.org: goals / goalEvents
    if (homeScorers.length === 0 && awayScorers.length === 0) {
      const rawGoals = Array.isArray(fixture.goalEvents)
        ? fixture.goalEvents
        : Array.isArray((fixture as any).goals)
          ? (fixture as any).goals
          : []
      if (rawGoals.length > 0) {
        for (let i = 0; i < rawGoals.length; i++) {
          const g = rawGoals[i]
          const playerName = extractNameFromEv(g)
          const isOwn = String(g.type || '').toUpperCase() === 'OWN'
          const { minute, extra } = extractMinuteFromEv(g)
          const side = resolveSide(g.team?.id, g.team?.name || g.team?.shortName, null)
          addScorer(playerName, minute, side, isOwn, extra, g.type || 'goal', i)
        }
      }
    }

    // 4. Provedor TheSportsDB: golevents
    if (
      homeScorers.length === 0 &&
      awayScorers.length === 0 &&
      Array.isArray(fixture.golevents) &&
      fixture.golevents.length > 0
    ) {
      for (let i = 0; i < fixture.golevents.length; i++) {
        const ge = fixture.golevents[i]
        const playerName = extractNameFromEv(ge)
        const { minute, extra } = extractMinuteFromEv(ge)
        const side =
          ge.teamSide === 'away' || ge.teamSide === 'home'
            ? ge.teamSide
            : resolveSide(ge.idTeam || ge.teamId, ge.strTeam || ge.teamName, null)
        const isContra = /contra|own\s*goal/i.test(ge.strSub || ge.strDetail || '')
        addScorer(playerName, minute, side, isContra, extra, ge.strDetail || 'goal', i)
      }
    }

    // 5. Suporte adicional a fixture.timeline (lookuptimeline) e fixture.match_events
    if (homeScorers.length === 0 && awayScorers.length === 0) {
      const altTimeline = Array.isArray((fixture as any).timeline)
        ? (fixture as any).timeline
        : Array.isArray((fixture as any).match_events)
          ? (fixture as any).match_events
          : []

      if (altTimeline.length > 0) {
        for (let i = 0; i < altTimeline.length; i++) {
          const item = altTimeline[i]
          const itemType = String(item.strTimeline || item.type || item.strType || '').toLowerCase()
          if (itemType === 'goal' || itemType === 'gol' || itemType.includes('goal')) {
            const playerName = extractNameFromEv(item)
            const { minute, extra } = extractMinuteFromEv(item)
            const side = resolveSide(
              item.idTeam || item.teamId || item.team?.id,
              item.strTeam || item.teamName || item.team?.name,
              item.teamSide === 'home' || item.teamSide === 'away' ? item.teamSide : null,
            )
            const isOwn = /contra|own/i.test(item.strTimelineDetail || item.detail || '')
            addScorer(playerName, minute, side, isOwn, extra, item.strTimelineDetail || itemType, i)
          }
        }
      }
    }

    // Placar do jogo
    const hGoals =
      fixture.goals?.home != null && !isNaN(Number(fixture.goals.home))
        ? Number(fixture.goals.home)
        : fixture.score?.fulltime?.home != null && !isNaN(Number(fixture.score.fulltime.home))
          ? Number(fixture.score.fulltime.home)
          : null
    const aGoals =
      fixture.goals?.away != null && !isNaN(Number(fixture.goals.away))
        ? Number(fixture.goals.away)
        : fixture.score?.fulltime?.away != null && !isNaN(Number(fixture.score.fulltime.away))
          ? Number(fixture.score.fulltime.away)
          : null

    // Regra estrita: se o placar for 0 para o time (ou ausente), coluna de marcadores fica estritamente vazia
    let finalHomeScorers = hGoals === 0 || hGoals == null ? [] : [...homeScorers]
    let finalAwayScorers = aGoals === 0 || aGoals == null ? [] : [...awayScorers]

    // Se houver mais marcadores detalhados listados que o número de gols no placar, limita ao número de gols
    if (hGoals != null && hGoals > 0 && finalHomeScorers.length > hGoals) {
      finalHomeScorers = finalHomeScorers.slice(0, hGoals)
    }
    if (aGoals != null && aGoals > 0 && finalAwayScorers.length > aGoals) {
      finalAwayScorers = finalAwayScorers.slice(0, aGoals)
    }

    // AJUSTE 2 — Restauração do fallback de gols (⚽):
    // Se o placar do jogo tem gols (ex.: 1x1, 0x1, 4x0), o ícone ⚽ DEVE SEMPRE ser exibido
    // abaixo do time que marcou, para CADA gol do placar. A contagem de marcadores exibida por time
    // deve ser exatamente igual ao placar daquele time.
    // Quando faltarem eventos para completar o placar de um time, completa a lista daquele time
    // com entradas de ícone puro "⚽" (icon-only, sem texto genérico nem a palavra "Gol").
    if (hGoals != null && hGoals > 0 && finalHomeScorers.length < hGoals) {
      const neededHome = hGoals - finalHomeScorers.length
      for (let k = 0; k < neededHome; k++) {
        finalHomeScorers.push('⚽')
      }
    }

    if (aGoals != null && aGoals > 0 && finalAwayScorers.length < aGoals) {
      const neededAway = aGoals - finalAwayScorers.length
      for (let k = 0; k < neededAway; k++) {
        finalAwayScorers.push('⚽')
      }
    }

    return {
      homeScorers: finalHomeScorers,
      awayScorers: finalAwayScorers,
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* Header com resumo e status de conexão */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2">
              <Radio className="h-6 w-6 text-rose-500 animate-pulse" />
              Jogos do Dia & Placar Ao Vivo
            </h1>
            {counts.live > 0 && (
              <Badge className="bg-rose-500 text-white font-bold text-xs gap-1 px-2.5 py-0.5">
                <Flame className="h-3.5 w-3.5" />
                {counts.live} jogo(s) ao vivo agora
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-[#64748B]">
            Acompanhamento em tempo real das principais competições: Brasileirão (A, B, C, D), Copa
            do Brasil, Libertadores, Sul-Americana, Champions League e grandes ligas europeias.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de data */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
            <Calendar className="h-4 w-4 text-slate-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(e.target.value)
                }
              }}
              className="bg-transparent text-xs font-semibold text-slate-800 outline-none"
            />
          </div>
          {(isRevalidating || refreshing) && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#64748B] bg-slate-100 px-2.5 py-1 rounded-md animate-pulse">
              <RefreshCw className="h-3 w-3 animate-spin text-[#0F2A43]" />
              Sincronizando placares...
            </span>
          )}
        </div>
      </div>

      {/* Banner âmbar suave verbatim para modo local / espera de reset */}
      <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 shadow-xs">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="font-medium">
            Exibindo dados armazenados localmente (Aguardando reset da API às 21h)
          </span>
        </div>
        {lastUpdated && (
          <span className="text-[10px] text-amber-300/80 font-medium">
            Leitura local: {new Date(lastUpdated).toLocaleTimeString('pt-BR')}
          </span>
        )}
      </div>

      {/* Mensagem se API não configurada (APENAS se não houver jogos para exibir) */}
      {!isConfigured && fixtures.length === 0 && (
        <Card className="rounded-[14px] border-amber-200 bg-amber-50/60 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-amber-900">API de Futebol não configurada</h3>
              <p className="text-xs text-amber-800">
                A chave de integração com a API-Football ainda não foi cadastrada no sistema. O
                administrador Douglas pode configurar a chave nas Configurações do Bolão.
              </p>
              {isAdmin && (
                <div className="pt-2">
                  <Link to="/bolao/configuracoes">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-[#0F2A43] text-white hover:bg-[#1B3A5C]"
                    >
                      Ir para Configurações de Integração
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col gap-3 rounded-[14px] border border-[#E2E8F0] bg-white p-4 shadow-xs">
        {/* Linha superior: Filtro de Competição e Seletor de Divisão / Fase */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Filtro por Competição 100% dinâmico com recolhimento */}
          {(() => {
            const INITIAL_COMP_LIMIT = 8
            const hasMoreCompetitions = availableCompetitions.length > INITIAL_COMP_LIMIT
            const displayedCompetitions = isCompetitionsExpanded
              ? availableCompetitions
              : availableCompetitions.slice(0, INITIAL_COMP_LIMIT)

            return (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
                  <Filter className="h-3.5 w-3.5" />
                  Competição:
                </span>
                <Button
                  type="button"
                  variant={selectedCompetition === 'todos' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedCompetition('todos')
                    setSelectedRound('todos')
                  }}
                  className={`h-7 px-2.5 text-xs font-semibold ${
                    selectedCompetition === 'todos'
                      ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Todos
                </Button>
                {displayedCompetitions.map((compName) => (
                  <Button
                    key={compName}
                    type="button"
                    variant={selectedCompetition === compName ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedCompetition(compName)
                      setSelectedRound('todos')
                    }}
                    className={`h-7 px-2.5 text-xs font-semibold ${
                      selectedCompetition === compName
                        ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {compName}
                  </Button>
                ))}
                {hasMoreCompetitions && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCompetitionsExpanded((prev) => !prev)}
                    className="h-7 px-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-dashed border-slate-300 gap-1"
                    title={
                      isCompetitionsExpanded
                        ? 'Recolher competições'
                        : `Mostrar mais ${availableCompetitions.length - INITIAL_COMP_LIMIT} competições`
                    }
                  >
                    {isCompetitionsExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>[ - Mostrar menos ]</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>[ + Mostrar mais ]</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            )
          })()}

          {/* Filtro secundário: Divisão / Fase */}
          {availableRounds.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                Divisão / Fase:
              </span>
              <Select value={selectedRound} onValueChange={setSelectedRound}>
                <SelectTrigger className="h-8 min-w-[200px] max-w-[280px] text-xs bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Todas as Fases / Divisões" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs font-medium">
                    Todas as Fases / Divisões
                  </SelectItem>
                  {availableRounds.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Linha inferior: Filtro por Status e Busca */}
        <div className="flex flex-col gap-3 pt-2 border-t border-slate-100 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={selectedStatus} onValueChange={setSelectedStatus} className="w-auto">
            <TabsList className="bg-slate-100 p-0.5 h-8">
              <TabsTrigger value="todos" className="text-xs font-semibold h-7 px-2.5">
                Todos ({counts.total})
              </TabsTrigger>
              <TabsTrigger
                value="ao-vivo"
                className="text-xs font-semibold h-7 px-2.5 data-[state=active]:bg-rose-500 data-[state=active]:text-white"
              >
                Ao Vivo ({counts.live})
              </TabsTrigger>
              <TabsTrigger value="em-breve" className="text-xs font-semibold h-7 px-2.5">
                Em Breve ({counts.scheduled})
              </TabsTrigger>
              <TabsTrigger value="finalizado" className="text-xs font-semibold h-7 px-2.5">
                Finalizados ({counts.finished})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar time ou liga..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs bg-slate-50 border-slate-200 focus-visible:ring-[#0F2A43]"
            />
          </div>
        </div>
      </div>

      {/* Lista de Jogos por Competição */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card
              key={i}
              className="overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-6 w-6 rounded-full bg-slate-200 animate-pulse" />
                  <div className="space-y-1">
                    <div className="h-4 w-32 rounded bg-slate-200 animate-pulse" />
                    <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
                  </div>
                </div>
                <div className="h-5 w-16 rounded bg-slate-200 animate-pulse" />
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
                  <div className="h-8 w-16 rounded bg-slate-900/10 animate-pulse" />
                  <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : errorMessage && fixtures.length === 0 ? (
        <Card className="rounded-[14px] p-8 text-center text-xs border border-amber-500/30 bg-amber-500/10 text-amber-300 shadow-xs">
          <AlertCircle className="mx-auto h-7 w-7 mb-2 text-amber-400" />
          <p className="font-semibold">{errorMessage}</p>
        </Card>
      ) : groupedByLeague.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500 shadow-xs">
          <Trophy className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="font-semibold text-slate-700">
            Nenhuma partida encontrada para os critérios selecionados.
          </p>
          <p className="mt-1 text-slate-400">
            Tente selecionar outra data ou ajustar os filtros de competição, divisão/fase e status
            acima.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedByLeague.map(({ league, matches }) => {
            const hasLiveInLeague = matches.some((m) => m.isLive)

            return (
              <div
                key={league.id}
                className="overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white shadow-xs"
              >
                {/* Header da Liga */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {league.logo ? (
                      <img
                        src={league.logo}
                        alt={league.name}
                        className="h-6 w-6 object-contain"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <Trophy className="h-5 w-5 text-slate-400" />
                    )}
                    <div>
                      <h2 className="text-sm font-bold text-[#0F172A]">{league.name}</h2>
                      <span className="text-[10px] text-slate-500">
                        {league.country} {league.round ? `• ${league.round}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasLiveInLeague && (
                      <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                    )}
                  </div>
                </div>
                {/* Grid de partidas da liga */}
                <div className="divide-y divide-slate-100">
                  {matches.map((match) => (
                    <MatchRowItem
                      key={match.fixture.id}
                      match={match}
                      renderStatusBadge={renderStatusBadge}
                      getMatchScorers={getMatchScorers}
                      onOpenDetails={handleOpenDetails}
                    />
                  ))}
                </div>{' '}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de Detalhes da Partida (Sob Demanda) */}
      <MatchDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={handleCloseDetails}
        match={selectedDetailsMatch}
      />
    </div>
  )
}
