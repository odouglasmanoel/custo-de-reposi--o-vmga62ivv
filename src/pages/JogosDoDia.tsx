import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Radio,
  Calendar,
  Clock,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Trophy,
  Filter,
  Flame,
  Globe2,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getHojeDataSaoPaulo, formatDataBR } from '@/lib/dateUtils'

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
    id: number
    date: string
    timestamp?: number
    timezone?: string
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
    }
    away: {
      id: number
      name: string
      logo: string
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
  isLive: boolean
}

interface ApiResponse {
  configured: boolean
  date: string
  total: number
  hasLive: boolean
  fixtures: DayFixture[]
  cached?: boolean
  cacheAgeSeconds?: number
  updatedAt?: string
  message?: string
  error?: string
}

export default function JogosDoDia() {
  const { user, isAdmin } = useAuth()
  const [selectedDate, setSelectedDate] = useState<string>(() => getHojeDataSaoPaulo(Date.now()))
  const [fixtures, setFixtures] = useState<DayFixture[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isConfigured, setIsConfigured] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCached, setIsCached] = useState<boolean>(false)
  const [cacheAge, setCacheAge] = useState<number>(0)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Filtros
  const [selectedRegion, setSelectedRegion] = useState<string>('todos')
  const [selectedStatus, setSelectedStatus] = useState<string>('todos') // todos, ao-vivo, em-breve, finalizado
  const [searchTerm, setSearchTerm] = useState<string>('')

  const fetchJogos = useCallback(async (dateStr: string, force = false) => {
    try {
      if (force) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setErrorMessage(null)

      const headers: Record<string, string> = {}
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const url = `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/jogos-do-dia?date=${encodeURIComponent(
        dateStr,
      )}${force ? '&refresh=1' : ''}`

      const res = await fetch(url, { headers })
      if (!res.ok) {
        throw new Error(`Falha na resposta do servidor (HTTP ${res.status})`)
      }

      const data: ApiResponse = await res.json()
      setIsConfigured(Boolean(data.configured))
      setFixtures(Array.isArray(data.fixtures) ? data.fixtures : [])
      setIsCached(Boolean(data.cached))
      setCacheAge(data.cacheAgeSeconds || 0)
      setLastUpdated(data.updatedAt || new Date().toISOString())

      if (data.error) {
        setErrorMessage(data.error)
      } else if (data.message && !data.configured) {
        setErrorMessage(data.message)
      }
    } catch (err: unknown) {
      console.error('Erro ao buscar jogos do dia:', err)
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar os jogos do dia. Verifique sua conexão.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchJogos(selectedDate)
  }, [selectedDate, fetchJogos])

  // Polling automático inteligente a cada 60s
  useEffect(() => {
    const timer = setInterval(() => {
      // Faz refresh silencioso sem loader intrusivo
      fetchJogos(selectedDate, false)
    }, 60000)
    return () => clearInterval(timer)
  }, [selectedDate, fetchJogos])

  // Contadores para os filtros de status
  const counts = useMemo(() => {
    let live = 0
    let scheduled = 0
    let finished = 0

    for (const f of fixtures) {
      const st = f.fixture?.status?.short || ''
      if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)) {
        live++
      } else if (['FT', 'AET', 'PEN'].includes(st)) {
        finished++
      } else {
        scheduled++
      }
    }

    return { total: fixtures.length, live, scheduled, finished }
  }, [fixtures])

  // Filtragem e busca
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      // Filtro de região
      if (selectedRegion !== 'todos') {
        if (f.league.region !== selectedRegion) {
          return false
        }
      }

      // Filtro de status
      const st = f.fixture?.status?.short || ''
      const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)
      const isFinished = ['FT', 'AET', 'PEN'].includes(st)
      const isUpcoming = !isLive && !isFinished

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
  }, [fixtures, selectedRegion, selectedStatus, searchTerm])

  // Agrupamento por competição/liga
  const groupedByLeague = useMemo(() => {
    const map = new Map<
      number,
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

    return Array.from(map.values()).sort((a, b) => {
      // Prioridade: ligas com jogos ao vivo primeiro, depois pelo nome
      const aHasLive = a.matches.some((m) => m.isLive)
      const bHasLive = b.matches.some((m) => m.isLive)
      if (aHasLive && !bHasLive) return -1
      if (!aHasLive && bHasLive) return 1
      return a.league.name.localeCompare(b.league.name)
    })
  }, [filteredFixtures])

  // Helpers de formatação de status
  const renderStatusBadge = (fixture: DayFixture) => {
    const st = fixture.fixture?.status?.short || ''
    const elapsed = fixture.fixture?.status?.elapsed

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
        <Badge
          variant="outline"
          className="border-slate-300 bg-slate-100 text-slate-700 font-bold text-[11px]"
        >
          Finalizado
        </Badge>
      )
    }

    if (st === 'POSTP' || st === 'CANC') {
      return (
        <Badge variant="destructive" className="font-bold text-[11px]">
          Adiado/Cancelado
        </Badge>
      )
    }

    // Horário agendado
    const matchDate = new Date(fixture.fixture.date)
    const horaBR = matchDate.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })

    return (
      <Badge
        variant="outline"
        className="border-blue-200 bg-blue-50 text-blue-800 font-bold text-[11px] gap-1"
      >
        <Clock className="h-3 w-3" />
        {horaBR}
      </Badge>
    )
  }

  // Agrupar marcadores por time para exibição visual
  const getMatchScorers = (fixture: DayFixture) => {
    const homeScorers: string[] = []
    const awayScorers: string[] = []

    for (const sc of fixture.scorers || []) {
      const minText = sc.minute ? `${sc.minute}'` : ''
      const entry = `${sc.name} ${minText}`.trim()
      if (sc.teamSide === 'home' || (sc.teamId && sc.teamId === fixture.teams.home.id)) {
        homeScorers.push(entry)
      } else if (sc.teamSide === 'away' || (sc.teamId && sc.teamId === fixture.teams.away.id)) {
        awayScorers.push(entry)
      } else {
        // Fallback se não tiver timeSide explícito
        homeScorers.push(entry)
      }
    }

    return { homeScorers, awayScorers }
  }

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

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || refreshing}
            onClick={() => fetchJogos(selectedDate, true)}
            className="h-8 gap-1.5 text-xs font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
            title="Atualizar dados agora"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#0F2A43]' : ''}`}
            />
            <span>Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Alerta de cache e cota */}
      {isCached && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2 text-[11px] text-blue-900">
          <div className="flex items-center gap-1.5">
            <Globe2 className="h-3.5 w-3.5 text-blue-600" />
            <span>
              Resposta em cache compartilhado no servidor ({cacheAge}s atrás). Atualização
              automática a cada 60s para otimizar consumo de cota da API.
            </span>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-blue-700 font-medium">
              Último sync: {new Date(lastUpdated).toLocaleTimeString('pt-BR')}
            </span>
          )}
        </div>
      )}

      {/* Mensagem se API não configurada */}
      {!isConfigured && (
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
      <div className="flex flex-col gap-3 rounded-[14px] border border-[#E2E8F0] bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        {/* Filtro por Região */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" />
            Região:
          </span>
          {[
            { id: 'todos', label: 'Todos' },
            { id: 'Brasileirão & Copas', label: 'Brasileirão & Copas' },
            { id: 'Sul-Americana', label: 'Sul-Americana / Liberta' },
            { id: 'Futebol Europeu', label: 'Futebol Europeu' },
          ].map((reg) => (
            <Button
              key={reg.id}
              type="button"
              variant={selectedRegion === reg.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedRegion(reg.id)}
              className={`h-7 px-2.5 text-xs font-semibold ${
                selectedRegion === reg.id
                  ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {reg.label}
            </Button>
          ))}
        </div>

        {/* Filtro por Status e Busca */}
        <div className="flex flex-wrap items-center gap-2">
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

          <div className="relative w-full sm:w-48">
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
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-16 text-center shadow-xs">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[#0F2A43]" />
          <p className="mt-3 text-xs font-semibold text-slate-600">
            Consultando calendário e partidas da API-Football...
          </p>
        </Card>
      ) : errorMessage && fixtures.length === 0 ? (
        <Card className="rounded-[14px] border-rose-200 bg-rose-50/60 p-8 text-center text-xs text-rose-800">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-600 mb-2" />
          <p className="font-bold">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchJogos(selectedDate, true)}
            className="mt-3 h-8 text-xs font-semibold bg-white border-rose-300 text-rose-900 hover:bg-rose-100"
          >
            Tentar novamente
          </Button>
        </Card>
      ) : groupedByLeague.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500 shadow-xs">
          <Trophy className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="font-semibold text-slate-700">
            Nenhuma partida encontrada para os critérios selecionados.
          </p>
          <p className="mt-1 text-slate-400">
            Tente selecionar outra data ou ajustar os filtros de região e status acima.
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
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-bold border-slate-200 bg-white"
                    >
                      {league.region}
                    </Badge>
                    {hasLiveInLeague && (
                      <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                    )}
                  </div>
                </div>

                {/* Grid de partidas da liga */}
                <div className="divide-y divide-slate-100">
                  {matches.map((match) => {
                    const { homeScorers, awayScorers } = getMatchScorers(match)
                    const homeScore = match.goals?.home ?? '-'
                    const awayScore = match.goals?.away ?? '-'

                    return (
                      <div
                        key={match.fixture.id}
                        className={`p-4 transition hover:bg-slate-50/60 ${
                          match.isLive ? 'bg-emerald-50/20' : ''
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {/* Status Badge */}
                          <div className="shrink-0 sm:w-36">{renderStatusBadge(match)}</div>

                          {/* Confronto Central: Times e Placar */}
                          <div className="flex-1 max-w-xl">
                            <div className="flex items-center justify-between gap-4">
                              {/* Time Mandante */}
                              <div className="flex flex-1 items-center justify-end gap-2.5 text-right">
                                <span className="text-sm font-bold text-[#0F172A] sm:text-base truncate">
                                  {match.teams.home.name}
                                </span>
                                {match.teams.home.logo && (
                                  <img
                                    src={match.teams.home.logo}
                                    alt={match.teams.home.name}
                                    className="h-6 w-6 object-contain shrink-0"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                )}
                              </div>

                              {/* Placar Central */}
                              <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-1 font-mono text-base font-black text-white shadow-2xs sm:text-lg min-w-[72px]">
                                <span>{homeScore}</span>
                                <span className="text-slate-500 font-normal">:</span>
                                <span>{awayScore}</span>
                              </div>

                              {/* Time Visitante */}
                              <div className="flex flex-1 items-center justify-start gap-2.5 text-left">
                                {match.teams.away.logo && (
                                  <img
                                    src={match.teams.away.logo}
                                    alt={match.teams.away.name}
                                    className="h-6 w-6 object-contain shrink-0"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                )}
                                <span className="text-sm font-bold text-[#0F172A] sm:text-base truncate">
                                  {match.teams.away.name}
                                </span>
                              </div>
                            </div>

                            {/* Detalhes de Pênaltis se houver */}
                            {match.score?.penalty &&
                              match.score.penalty.home !== null &&
                              match.score.penalty.away !== null && (
                                <div className="text-center text-[10px] font-semibold text-slate-500 mt-1">
                                  (Pênaltis: {match.score.penalty.home} x {match.score.penalty.away}
                                  )
                                </div>
                              )}

                            {/* Marcadores dos gols com minutagem */}
                            {(homeScorers.length > 0 || awayScorers.length > 0) && (
                              <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                                <div className="text-right space-y-0.5">
                                  {homeScorers.map((s, idx) => (
                                    <div key={idx} className="truncate text-slate-700 font-medium">
                                      ⚽ {s}
                                    </div>
                                  ))}
                                </div>
                                <div className="text-left space-y-0.5">
                                  {awayScorers.map((s, idx) => (
                                    <div key={idx} className="truncate text-slate-700 font-medium">
                                      ⚽ {s}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Espaço lateral para alinhamento uniforme */}
                          <div className="hidden sm:block sm:w-20 text-right">
                            <span className="text-[10px] text-slate-400">{match.fixture.id}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
