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
  PlusCircle,
  Pencil,
  Trash2,
  Sparkles,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { getHojeDataSaoPaulo, formatDataBR } from '@/lib/dateUtils'
import {
  getFixtureDateSaoPaulo,
  isFixturePostponed,
  isFixtureCancelled,
} from '@/lib/apiFootballMatcher'

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

export default function JogosDoDia() {
  const { user, isAdmin } = useAuth()
  const [selectedDate, setSelectedDate] = useState<string>(() => getHojeDataSaoPaulo(Date.now()))
  const [fixtures, setFixtures] = useState<DayFixture[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeProvider, setActiveProvider] = useState<string>('api_football')
  const [isConfigured, setIsConfigured] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCached, setIsCached] = useState<boolean>(false)
  const [cacheAge, setCacheAge] = useState<number>(0)
  const [ttlRemaining, setTtlRemaining] = useState<number>(0)
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Filtros
  const [selectedRegion, setSelectedRegion] = useState<string>('todos')
  const [selectedStatus, setSelectedStatus] = useState<string>('todos') // todos, ao-vivo, em-breve, finalizado
  const [searchTerm, setSearchTerm] = useState<string>('')

  // Estado do Modal de Inserir/Editar Jogo Manual pelo Admin (Douglas)
  const { toast } = useToast()
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [deletingManualId, setDeletingManualId] = useState<string | null>(null)
  const [editingManualRecordId, setEditingManualRecordId] = useState<string | null>(null)
  const [manualFormData, setManualFormData] = useState({
    timeCasa: '',
    timeVisitante: '',
    horario: '20:00',
    data: '',
    campeonato: 'Copa Sul-Americana',
    regiao: 'Sul-Americana' as
      | 'Brasileirão & Copas'
      | 'Sul-Americana'
      | 'Futebol Europeu'
      | 'Outros',
    placarCasa: '',
    placarVisitante: '',
    status: 'NS',
    observacao: '',
  })

  const openNewManualModal = () => {
    setEditingManualRecordId(null)
    setManualFormData({
      timeCasa: '',
      timeVisitante: '',
      horario: '20:00',
      data: selectedDate || getHojeDataSaoPaulo(Date.now()),
      campeonato: 'Copa Sul-Americana',
      regiao: 'Sul-Americana',
      placarCasa: '',
      placarVisitante: '',
      status: 'NS',
      observacao: '',
    })
    setManualModalOpen(true)
  }

  const openEditManualModal = (fixture: DayFixture) => {
    const recordId =
      fixture.manualRecordId ||
      (typeof fixture.fixture.id === 'string' && fixture.fixture.id.startsWith('manual_')
        ? fixture.fixture.id.replace('manual_', '')
        : null)
    setEditingManualRecordId(recordId)

    // Extrai horário de fixture.date ou hora default
    let horaStr = '20:00'
    if (fixture.fixture.date) {
      try {
        const d = new Date(fixture.fixture.date)
        if (!isNaN(d.getTime())) {
          horaStr = d.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          })
        }
      } catch {
        /* intentionally ignored */
      }
    }

    setManualFormData({
      timeCasa: fixture.teams.home.name || '',
      timeVisitante: fixture.teams.away.name || '',
      horario: horaStr,
      data: selectedDate,
      campeonato: fixture.league.name || '',
      regiao: fixture.league.region || 'Sul-Americana',
      placarCasa:
        fixture.goals.home !== null && fixture.goals.home !== undefined
          ? String(fixture.goals.home)
          : '',
      placarVisitante:
        fixture.goals.away !== null && fixture.goals.away !== undefined
          ? String(fixture.goals.away)
          : '',
      status: fixture.fixture.status?.short || 'NS',
      observacao: fixture.league.round !== 'Manual' ? fixture.league.round || '' : '',
    })
    setManualModalOpen(true)
  }

  const handleSaveManualGame = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualFormData.timeCasa.trim() || !manualFormData.timeVisitante.trim()) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Por favor, informe os nomes do Time da Casa e Time Visitante.',
        variant: 'destructive',
      })
      return
    }

    setSavingManual(true)
    try {
      const pCasa =
        manualFormData.placarCasa.trim() !== '' ? parseInt(manualFormData.placarCasa, 10) : null
      const pVis =
        manualFormData.placarVisitante.trim() !== ''
          ? parseInt(manualFormData.placarVisitante, 10)
          : null

      const payload = {
        time_casa: manualFormData.timeCasa.trim(),
        time_visitante: manualFormData.timeVisitante.trim(),
        data: manualFormData.data.trim() || selectedDate,
        horario: manualFormData.horario.trim() || '20:00',
        campeonato: manualFormData.campeonato.trim() || 'Copa Sul-Americana',
        regiao: manualFormData.regiao,
        placar_casa: pCasa !== null && !isNaN(pCasa) ? pCasa : null,
        placar_visitante: pVis !== null && !isNaN(pVis) ? pVis : null,
        status: manualFormData.status || 'NS',
        observacao: manualFormData.observacao.trim(),
      }

      if (editingManualRecordId) {
        await pb.collection('jogos_do_dia_manuais').update(editingManualRecordId, payload)
        toast({
          title: 'Jogo manual atualizado!',
          description: `${payload.time_casa} x ${payload.time_visitante} atualizado com prioridade.`,
        })
      } else {
        await pb.collection('jogos_do_dia_manuais').create(payload)
        toast({
          title: 'Jogo manual adicionado!',
          description: `${payload.time_casa} x ${payload.time_visitante} garantido na exibição.`,
        })
      }

      setManualModalOpen(false)
      // Recarrega jogos do dia (com forçamento)
      await fetchJogos(selectedDate, true)
    } catch (err: unknown) {
      console.error('Erro ao salvar jogo manual:', err)
      toast({
        title: 'Erro ao salvar jogo manual',
        description: err instanceof Error ? err.message : 'Falha ao salvar no banco.',
        variant: 'destructive',
      })
    } finally {
      setSavingManual(false)
    }
  }

  const handleDeleteManualGame = async (recordId: string, fixtureTitle: string) => {
    if (!confirm(`Deseja realmente remover o jogo manual "${fixtureTitle}"?`)) {
      return
    }
    setDeletingManualId(recordId)
    try {
      await pb.collection('jogos_do_dia_manuais').delete(recordId)
      toast({
        title: 'Jogo manual removido',
        description: 'A partida manual foi excluída com sucesso.',
      })
      await fetchJogos(selectedDate, true)
    } catch (err: unknown) {
      console.error('Erro ao deletar jogo manual:', err)
      toast({
        title: 'Erro ao remover',
        description: err instanceof Error ? err.message : 'Não foi possível deletar.',
        variant: 'destructive',
      })
    } finally {
      setDeletingManualId(null)
    }
  }

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

      // Timeout seguro de 10s no client para nunca travar a tela
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      let res: Response
      try {
        res = await fetch(url, { headers, signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!res.ok) {
        // Tratar 500 ou qualquer outro status sem explodir
        let errorBodyText = ''
        try {
          const errJson = await res.json()
          errorBodyText = errJson?.error || errJson?.message || ''
        } catch {
          /* intentionally ignored */
        }
        throw new Error(
          errorBodyText ||
            `Instabilidade momentânea no servidor de dados (HTTP ${res.status}). Os dados serão recarregados automaticamente.`,
        )
      }

      const data: ApiResponse = await res.json()
      setIsConfigured(Boolean(data.configured))
      setActiveProvider(data.provider || 'api_football')
      setFixtures(Array.isArray(data.fixtures) ? data.fixtures : [])
      setIsCached(Boolean(data.cached))
      setCacheAge(data.cacheAgeSeconds || 0)
      setTtlRemaining(data.ttlRemainingSeconds ?? 0)
      setIsRateLimited(Boolean(data.rate_limited))
      setLastUpdated(data.updatedAt || new Date().toISOString())

      // Se rate limit foi sinalizado (429 tratado com status 200)
      if (data.rate_limited) {
        setErrorMessage(
          'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.',
        )
      } else if (data.error && (!data.fixtures || data.fixtures.length === 0)) {
        setErrorMessage(data.error)
      } else if (data.message && !data.configured) {
        setErrorMessage(data.message)
      } else {
        setErrorMessage(null)
      }
    } catch (err: unknown) {
      console.error('Erro ao buscar jogos do dia:', err)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      setErrorMessage(
        isAbort
          ? 'Tempo de resposta excedido ao buscar jogos do dia. Tente atualizar novamente.'
          : err instanceof Error
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

  // Ligas e competições relevantes acompanhadas pelo app:
  // Brasileirão A-D, Copa do Brasil, Libertadores, Sul-Americana,
  // Champions League, Europa League, Conference League, Premier League,
  // La Liga, Serie A, Bundesliga, Ligue 1 e principais copas nacionais europeias.
  const relevantFixtures = useMemo(() => {
    // Regex de clubes brasileiros para filtrar confrontos em torneios CONMEBOL (Libertadores e Sul-Americana)
    const brazilianClubsRegex =
      /(Flamengo|Palmeiras|São Paulo|Sao Paulo|Corinthians|Fluminense|Grêmio|Gremio|Internacional|Atlético Mineiro|Atletico Mineiro|Atlético-MG|Botafogo|Cruzeiro|Vasco|Athletico Paranaense|Athletico-PR|Fortaleza|Bahia|Bragantino|Red Bull Bragantino|Cuiabá|Cuiaba|Goiás|Goias|Coritiba|Santos|América Mineiro|America-MG|Ceará|Ceara|Juventude|Vitória|Vitoria|Sport|Chapecoense|Avaí|Avai|Ponte Preta)/i

    const targetLeagueSet = new Set<number>([
      71, // Brasileirão Série A
      72, // Série B
      73, // Copa do Brasil / Série C
      74, // Copa do Brasil / Série D
      75, // Série C
      76, // Série D
      13, // Copa Libertadores
      11, // Copa Sudamericana
      450, // Copa Sudamericana alternativa
      2, // UEFA Champions League (CL)
      3, // UEFA Europa League (EL)
      848, // UEFA Conference League
      39, // Premier League (Inglaterra)
      140, // La Liga (Espanha)
      135, // Serie A (Itália)
      78, // Bundesliga (Alemanha)
      61, // Ligue 1 (França)
      45, // FA Cup
      48, // EFL Carabao Cup
      143, // Copa del Rey
      137, // Coppa Italia
      81, // DFB-Pokal
      66, // Coupe de France
      2013, // Football-Data.org Brasileirão Série A
      2001, // Football-Data.org UEFA Champions League
      2021, // Football-Data.org Premier League
      2014, // Football-Data.org La Liga
      2019, // Football-Data.org Serie A
      2002, // Football-Data.org Bundesliga
      2015, // Football-Data.org Ligue 1
    ])

    return fixtures.filter((item) => {
      // FILTRO ESTRITO DE FUSO HORÁRIO (America/Sao_Paulo - UTC-3):
      // Converte o horário da partida para a data no fuso de Brasília.
      // Se a partida pertence a outro dia que não a selectedDate selecionada no datepicker,
      // descarta imediatamente (evitando jogos de ontem, ex.: Corinthians).
      const fixtureDateStr = item.fixture?.date
      if (selectedDate && fixtureDateStr) {
        const fixtureDateSP = getFixtureDateSaoPaulo(fixtureDateStr)
        if (fixtureDateSP && fixtureDateSP !== selectedDate) {
          return false
        }
      }

      const lid = item.league?.id
      // Se não temos lid ou não está no target, mas tem região mapeada válida
      if (item.league?.region && item.league.region !== 'Outros') {
        // Aceita torneios categorizados diretamente
      } else if (!lid || !targetLeagueSet.has(lid)) {
        return false
      }

      // Regra CONMEBOL (Libertadores e Sul-Americana): prioriza confrontos que envolvam clubes brasileiros
      if (lid === 13 || lid === 11 || lid === 450) {
        const homeName = item.teams?.home?.name || ''
        const awayName = item.teams?.away?.name || ''
        const homeCountry = item.teams?.home?.country || ''
        const awayCountry = item.teams?.away?.country || ''

        const isHomeBrazilian = homeCountry === 'Brazil' || brazilianClubsRegex.test(homeName)
        const isAwayBrazilian = awayCountry === 'Brazil' || brazilianClubsRegex.test(awayName)

        if (!isHomeBrazilian && !isAwayBrazilian) {
          return false
        }
      }

      return true
    })
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

  // Regras estritas de economia de cota pedidas pelo administrador:
  // 1. Partidas ainda não iniciadas ("Em Breve"/agendadas): NENHUM polling contínuo.
  // 2. No exato momento do kickoff ("rola a bola"), dispara 1 única busca pela partida.
  // 3. Durante o jogo (status "Ao Vivo"): APENAS se houver jogos efetivamente ao vivo gera polling periódico (~60s).

  // Kickoff timers: Dispara UMA única busca no exato momento que o jogo começar
  useEffect(() => {
    const timers: NodeJS.Timeout[] = []
    const now = Date.now()

    for (const f of relevantFixtures) {
      const st = (f.fixture?.status?.short || '').toUpperCase().trim()
      const long = (f.fixture?.status?.long || '').toUpperCase().trim()
      const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(st)
      const isFinished = ['FT', 'AET', 'PEN'].includes(st)
      const isPostponedOrCancelled = isFixturePostponed(st, long) || isFixtureCancelled(st, long)

      if (!isLive && !isFinished && !isPostponedOrCancelled && f.fixture?.date) {
        const kickoffTime = new Date(f.fixture.date).getTime()
        if (!isNaN(kickoffTime)) {
          const delay = kickoffTime - now

          // Se o kickoff for no futuro próximo (até 24 horas), agenda disparo exato uma única vez
          if (delay > 0 && delay <= 24 * 60 * 60 * 1000) {
            const t = setTimeout(() => {
              // Dispara UMA única verificação pontual ao rolar a bola
              fetchJogos(selectedDate, false)
            }, delay + 1000) // +1s após o horário para garantir que a partida iniciou
            timers.push(t)
          }
        }
      }
    }

    return () => {
      timers.forEach((t) => clearTimeout(t))
    }
  }, [relevantFixtures, selectedDate, fetchJogos])

  // Polling periódico APENAS quando há jogos efetivamente com status "Ao Vivo"
  // E nunca se tiver atingido rate limit
  useEffect(() => {
    if (counts.live === 0 || isRateLimited) {
      return
    }

    const timer = setInterval(() => {
      fetchJogos(selectedDate, false)
    }, 300000) // 5 minutos enquanto houver ao vivo, respeitando o cache mínimo
    return () => clearInterval(timer)
  }, [counts.live, isRateLimited, selectedDate, fetchJogos])

  // Filtragem e busca baseadas no conjunto de ligas relevantes
  const filteredFixtures = useMemo(() => {
    return relevantFixtures.filter((f) => {
      // Filtro de região
      if (selectedRegion !== 'todos') {
        if (f.league.region !== selectedRegion) {
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
  }, [relevantFixtures, selectedRegion, selectedStatus, searchTerm])

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
      return a.league.name.localeCompare(b.league.name)
    })
  }, [filteredFixtures])

  // Helpers de formatação de status
  const renderStatusBadge = (fixture: DayFixture) => {
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

          {/* Botão de Inserir Jogo Manual (Garantia Total do Admin) */}
          {isAdmin && (
            <Button
              type="button"
              size="sm"
              onClick={openNewManualModal}
              className="h-8 gap-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
              title="Inserir / Editar Jogo do Dia Manualmente"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Inserir Jogo Manual</span>
            </Button>
          )}
        </div>
      </div>

      {/* Alerta de Rate Limit com mensagem amigável exata */}
      {isRateLimited && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
            <span className="font-semibold">
              Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente
              novamente mais tarde.
            </span>
          </div>
          {fixtures.length > 0 && (
            <span className="text-[11px] text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded font-medium">
              Exibindo dados em cache seguro
            </span>
          )}
        </div>
      )}

      {/* Alerta de cache e cota */}
      {isCached && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2 text-[11px] text-blue-900">
          <div className="flex items-center gap-1.5">
            <Globe2 className="h-3.5 w-3.5 text-blue-600" />
            <span>
              Servido do cache do servidor (atualizado há{' '}
              {cacheAge < 60 ? `${cacheAge}s` : `${Math.round(cacheAge / 60)} min`}
              ).{' '}
              {ttlRemaining > 0
                ? `Revalidação sob demanda liberada em ${Math.ceil(ttlRemaining / 60)} min.`
                : 'Revalidação disponível pelo botão Atualizar.'}
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
        <Card
          className={`rounded-[14px] p-8 text-center text-xs ${
            isRateLimited
              ? 'border-amber-300 bg-amber-50/70 text-amber-900'
              : 'border-rose-200 bg-rose-50/60 text-rose-800'
          }`}
        >
          <AlertCircle
            className={`mx-auto h-7 w-7 mb-2 ${isRateLimited ? 'text-amber-600' : 'text-rose-600'}`}
          />
          <p className="font-bold">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchJogos(selectedDate, true)}
            className={`mt-3 h-8 text-xs font-semibold bg-white ${
              isRateLimited
                ? 'border-amber-300 text-amber-900 hover:bg-amber-100'
                : 'border-rose-300 text-rose-900 hover:bg-rose-100'
            }`}
          >
            Tentar novamente
          </Button>
        </Card>
      ) : groupedByLeague.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500 shadow-xs">
          <Trophy className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          {activeProvider === 'football_data' &&
          (selectedRegion === 'Sul-Americana' ||
            (selectedRegion === 'Brasileirão & Copas' &&
              relevantFixtures.filter((f) => f.league.region === 'Brasileirão & Copas').length ===
                0)) ? (
            <div className="space-y-1">
              <p className="font-semibold text-slate-700">
                Sem cobertura neste provedor ({selectedRegion})
              </p>
              <p className="mt-1 text-slate-400 max-w-md mx-auto">
                O provedor ativo (Football-Data.org) cobre apenas grandes ligas (Brasileirão Série
                A, Champions League, Premier League, La Liga, Serie A, Bundesliga e Ligue 1).
                Torneios como Séries B/C/D, Copa do Brasil ou Sul-Americana não são transmitidos por
                ele.
              </p>
            </div>
          ) : (
            <>
              <p className="font-semibold text-slate-700">
                Nenhuma partida encontrada para os critérios selecionados.
              </p>
              <p className="mt-1 text-slate-400">
                Tente selecionar outra data ou ajustar os filtros de região e status acima.
              </p>
            </>
          )}
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
                    const stMatch = (match.fixture?.status?.short || '').toUpperCase().trim()
                    const longMatch = (match.fixture?.status?.long || '').toUpperCase().trim()
                    const matchIsPostponed = isFixturePostponed(stMatch, longMatch)
                    const matchIsCancelled = isFixtureCancelled(stMatch, longMatch)
                    const isPstOrCanc = matchIsPostponed || matchIsCancelled

                    const homeScore = match.goals?.home ?? '-'
                    const awayScore = match.goals?.away ?? '-'

                    return (
                      <div
                        key={match.fixture.id}
                        className={`p-4 transition hover:bg-slate-50/60 ${
                          match.isLive
                            ? 'bg-emerald-50/20'
                            : isPstOrCanc
                              ? 'bg-slate-50/40 opacity-90'
                              : ''
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
                                <span
                                  className={`text-sm font-bold sm:text-base truncate ${
                                    isPstOrCanc ? 'text-slate-600' : 'text-[#0F172A]'
                                  }`}
                                >
                                  {match.teams.home.name}
                                </span>
                                {match.teams.home.logo && (
                                  <img
                                    src={match.teams.home.logo}
                                    alt={match.teams.home.name}
                                    className={`h-6 w-6 object-contain shrink-0 ${
                                      isPstOrCanc ? 'grayscale-[50%] opacity-80' : ''
                                    }`}
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                )}
                              </div>

                              {/* Placar Central ou Badge de Adiado/Cancelado */}
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

                              {/* Time Visitante */}
                              <div className="flex flex-1 items-center justify-start gap-2.5 text-left">
                                {match.teams.away.logo && (
                                  <img
                                    src={match.teams.away.logo}
                                    alt={match.teams.away.name}
                                    className={`h-6 w-6 object-contain shrink-0 ${
                                      isPstOrCanc ? 'grayscale-[50%] opacity-80' : ''
                                    }`}
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                )}
                                <span
                                  className={`text-sm font-bold sm:text-base truncate ${
                                    isPstOrCanc ? 'text-slate-600' : 'text-[#0F172A]'
                                  }`}
                                >
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

                          {/* Espaço lateral para alinhamento uniforme ou Ações de Admin no Jogo Manual */}
                          <div className="shrink-0 text-right sm:w-28 flex items-center justify-end gap-1">
                            {isAdmin && (match.isManual || match.fixture?.isManual) && (
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-amber-700 hover:bg-amber-100/60"
                                  title="Editar este jogo manual"
                                  onClick={() => openEditManualModal(match)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled={deletingManualId === match.manualRecordId}
                                  className="h-7 w-7 text-rose-600 hover:bg-rose-100/60"
                                  title="Remover este jogo manual"
                                  onClick={() => {
                                    const recId =
                                      match.manualRecordId ||
                                      (typeof match.fixture.id === 'string' &&
                                      match.fixture.id.startsWith('manual_')
                                        ? match.fixture.id.replace('manual_', '')
                                        : '')
                                    if (recId) {
                                      handleDeleteManualGame(
                                        recId,
                                        `${match.teams.home.name} x ${match.teams.away.name}`,
                                      )
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                            <span className="text-[10px] text-slate-400 block truncate max-w-[70px]">
                              {match.fixture.id}
                            </span>
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

      {/* Modal de Inserir / Editar Jogo do Dia Manualmente */}
      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent className="max-w-lg bg-white p-6 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Sparkles className="h-5 w-5 text-amber-600" />
              {editingManualRecordId
                ? 'Editar Jogo do Dia (Manual)'
                : 'Inserir Jogo do Dia Manualmente'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveManualGame} className="space-y-4 pt-2">
            <p className="text-xs text-slate-500">
              Jogos inseridos manualmente pelo Admin possuem <strong>prioridade total</strong> de
              exibição e aparecem mesmo que APIs externas caiam ou fiquem sem cota.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-time-casa" className="text-xs font-semibold text-slate-700">
                  Time da Casa *
                </Label>
                <Input
                  id="manual-time-casa"
                  placeholder="Ex: Flamengo"
                  value={manualFormData.timeCasa}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, timeCasa: e.target.value })
                  }
                  required
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="manual-time-visitante"
                  className="text-xs font-semibold text-slate-700"
                >
                  Time Visitante *
                </Label>
                <Input
                  id="manual-time-visitante"
                  placeholder="Ex: Indep. del Valle"
                  value={manualFormData.timeVisitante}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, timeVisitante: e.target.value })
                  }
                  required
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-data" className="text-xs font-semibold text-slate-700">
                  Data (AAAA-MM-DD) *
                </Label>
                <Input
                  id="manual-data"
                  type="date"
                  value={manualFormData.data}
                  onChange={(e) => setManualFormData({ ...manualFormData, data: e.target.value })}
                  required
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-horario" className="text-xs font-semibold text-slate-700">
                  Horário (Brasília) *
                </Label>
                <Input
                  id="manual-horario"
                  placeholder="21:30"
                  value={manualFormData.horario}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, horario: e.target.value })
                  }
                  required
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-campeonato" className="text-xs font-semibold text-slate-700">
                  Campeonato *
                </Label>
                <Input
                  id="manual-campeonato"
                  placeholder="Ex: Copa Sul-Americana"
                  value={manualFormData.campeonato}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, campeonato: e.target.value })
                  }
                  required
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-regiao" className="text-xs font-semibold text-slate-700">
                  Categoria / Região
                </Label>
                <select
                  id="manual-regiao"
                  value={manualFormData.regiao}
                  onChange={(e) =>
                    setManualFormData({
                      ...manualFormData,
                      regiao: e.target.value as
                        | 'Brasileirão & Copas'
                        | 'Sul-Americana'
                        | 'Futebol Europeu'
                        | 'Outros',
                    })
                  }
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-amber-500"
                >
                  <option value="Sul-Americana">Sul-Americana / Liberta</option>
                  <option value="Brasileirão & Copas">Brasileirão & Copas</option>
                  <option value="Futebol Europeu">Futebol Europeu</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="manual-placar-casa"
                  className="text-xs font-semibold text-slate-700"
                >
                  Gols Casa
                </Label>
                <Input
                  id="manual-placar-casa"
                  type="number"
                  min="0"
                  max="99"
                  placeholder="-"
                  value={manualFormData.placarCasa}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, placarCasa: e.target.value })
                  }
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="manual-placar-visitante"
                  className="text-xs font-semibold text-slate-700"
                >
                  Gols Visitante
                </Label>
                <Input
                  id="manual-placar-visitante"
                  type="number"
                  min="0"
                  max="99"
                  placeholder="-"
                  value={manualFormData.placarVisitante}
                  onChange={(e) =>
                    setManualFormData({ ...manualFormData, placarVisitante: e.target.value })
                  }
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-status" className="text-xs font-semibold text-slate-700">
                  Status
                </Label>
                <select
                  id="manual-status"
                  value={manualFormData.status}
                  onChange={(e) => setManualFormData({ ...manualFormData, status: e.target.value })}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-amber-500"
                >
                  <option value="NS">Em Breve (NS)</option>
                  <option value="1H">1º Tempo</option>
                  <option value="HT">Intervalo</option>
                  <option value="2H">2º Tempo</option>
                  <option value="FT">Encerrado (FT)</option>
                  <option value="PST">Adiado</option>
                  <option value="CANC">Cancelado</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-obs" className="text-xs font-semibold text-slate-700">
                Fase / Observação (opcional)
              </Label>
              <Input
                id="manual-obs"
                placeholder="Ex: Fase de Grupos - Rodada 5"
                value={manualFormData.observacao}
                onChange={(e) =>
                  setManualFormData({ ...manualFormData, observacao: e.target.value })
                }
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualModalOpen(false)}
                disabled={savingManual}
                className="h-8 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingManual}
                className="h-8 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white"
              >
                {savingManual ? (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : editingManualRecordId ? (
                  'Salvar Alterações'
                ) : (
                  'Cadastrar Jogo'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
