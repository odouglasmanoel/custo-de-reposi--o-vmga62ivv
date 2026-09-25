import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Trophy,
  Target,
  CheckCircle,
  Flame,
  Award,
  Filter,
  TrendingUp,
  Info,
  Loader2,
  Sparkles,
  Globe,
  Shield,
  Clock,
  Snowflake,
  Crown,
  Wrench,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend as RechartsLegend,
} from 'recharts'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'
import { formatBolaoLabel, GERAL_BOLAO_ID } from '@/types/bolao'
import { type StatsCalculationResult } from '@/lib/statsCalculator'
import { readStatsCache, fetchStatisticsData, invalidateStatsCache } from '@/services/stats'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'

// Cores temáticas para cada participante no gráfico
const PARTICIPANT_COLORS: Record<string, { stroke: string; bg: string; border: string }> = {
  Douglas: {
    stroke: '#2563EB', // Blue 600
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  Gabriel: {
    stroke: '#10B981', // Emerald 500
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  'Bruno Lopes': {
    stroke: '#F59E0B', // Amber 500
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  'Bruno Xavier': {
    stroke: '#EC4899', // Pink 500
    bg: 'bg-pink-50',
    border: 'border-pink-200',
  },
  Bruno: {
    stroke: '#F59E0B', // Amber 500 (legado)
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  Davi: {
    stroke: '#8B5CF6', // Purple 500
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
}

export default function Estatisticas() {
  const { participantName } = useAuth()
  const { activeBolaoId, setActiveBolaoId } = useActivePool()
  const [searchParams, setSearchParams] = useSearchParams()

  const [boloes, setBoloes] = useState<Bolao[]>([])
  const [statsData, setStatsData] = useState<StatsCalculationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRevalidating, setIsRevalidating] = useState(false)

  // Filtro de competição: 'geral' | 'todas' | id do bolão
  const initialCompetitionId = useMemo(() => {
    const fromParam = searchParams.get('bolao')
    if (fromParam) return fromParam
    if (activeBolaoId) return activeBolaoId
    return GERAL_BOLAO_ID
  }, [])

  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>(initialCompetitionId)
  const currentCompIdRef = useRef<string>(initialCompetitionId)

  // Sincronizar caso o query param da URL mude externamente
  useEffect(() => {
    const fromParam = searchParams.get('bolao')
    if (fromParam && fromParam !== selectedCompetitionId) {
      setSelectedCompetitionId(fromParam)
    }
  }, [searchParams])

  // Função core de carregamento com cache SWR de dois níveis
  const loadStats = useCallback(
    async (compFilter: string, forceBackground: boolean = false) => {
      currentCompIdRef.current = compFilter

      // 1. Verificar cache de 2 níveis (memória primeiro, depois localStorage)
      const cached = readStatsCache(compFilter)
      if (cached) {
        setStatsData(cached.stats)
        if (cached.boloes && cached.boloes.length > 0) {
          setBoloes(cached.boloes)
        }
        setLoading(false)
        setIsRevalidating(true)
      } else if (!forceBackground) {
        setLoading(true)
        setIsRevalidating(false)
      }

      // 2. Busca e revalidação em segundo plano sem N+1 (em lote e com projeção de campos mínimos)
      try {
        const result = await fetchStatisticsData(compFilter, {
          boloesList: boloes.length > 0 ? boloes : undefined,
        })

        // Ignora resposta caso o usuário tenha trocado o filtro de competição no meio da requisição
        if (currentCompIdRef.current !== compFilter) {
          return
        }

        setBoloes(result.boloes)
        setStatsData(result.stats)
      } catch (err) {
        if (currentCompIdRef.current === compFilter) {
          console.error('Erro ao buscar dados de estatísticas:', err)
        }
      } finally {
        if (currentCompIdRef.current === compFilter) {
          setLoading(false)
          setIsRevalidating(false)
        }
      }
    },
    [boloes],
  )

  useEffect(() => {
    loadStats(selectedCompetitionId)
  }, [selectedCompetitionId])

  // Real-time synchronization com background revalidate silencioso
  useRealtime<Participante>('participantes', () => {
    invalidateStatsCache(selectedCompetitionId)
    loadStats(selectedCompetitionId, true)
  })
  useRealtime<Jogo>('jogos', () => {
    invalidateStatsCache(selectedCompetitionId)
    loadStats(selectedCompetitionId, true)
  })
  useRealtime<Palpite>('palpites', () => {
    invalidateStatsCache(selectedCompetitionId)
    loadStats(selectedCompetitionId, true)
  })
  useRealtime<Bolao>('boloes', () => {
    invalidateStatsCache()
    loadStats(selectedCompetitionId, true)
  })

  const handleSelectCompetition = (newCompId: string) => {
    setSelectedCompetitionId(newCompId)
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev)
      if (newCompId === GERAL_BOLAO_ID || newCompId === 'todas') {
        updated.delete('bolao')
      } else {
        updated.set('bolao', newCompId)
      }
      return updated
    })
    // Sincroniza com o contexto ativo se for uma troca intencional
    if (newCompId === GERAL_BOLAO_ID || newCompId === 'todas') {
      setActiveBolaoId(GERAL_BOLAO_ID)
    } else {
      setActiveBolaoId(newCompId)
    }
  }

  const isGeralSelected =
    !selectedCompetitionId ||
    selectedCompetitionId === GERAL_BOLAO_ID ||
    selectedCompetitionId === 'todas'

  // Nome do bolão selecionado para exibir no título / badge
  const selectedBolaoName = useMemo(() => {
    if (isGeralSelected) return 'Geral (Todas as Copas)'
    const b = boloes.find((item) => item.id === selectedCompetitionId)
    return b ? formatBolaoLabel(b) : 'Competição Selecionada'
  }, [boloes, selectedCompetitionId, isGeralSelected])

  const getPositionBadge = (pos: number) => {
    if (pos === 1) return { bg: 'bg-[#F59E0B] text-slate-950 font-black', text: '1º', trophy: '🏆' }
    if (pos === 2) return { bg: 'bg-[#94A3B8] text-white font-black', text: '2º', trophy: '🥈' }
    if (pos === 3) return { bg: 'bg-[#B45309] text-white font-black', text: '3º', trophy: '🥉' }
    return { bg: 'bg-[#0F2A43] text-white font-bold', text: `${pos}º`, trophy: '' }
  }

  const tabela = statsData?.tabela || []
  const recordes = statsData?.recordes
  const evolucao = statsData?.evolucao || []
  const totalJogosEncerrados = statsData?.totalJogosEncerrados ?? 0
  const totalPalpitesValidos = statsData?.totalPalpitesValidos ?? 0

  // MODO MANUTENÇÃO TEMPORÁRIO
  // Preserva toda a lógica de cálculo e queries no arquivo para reversão futura
  const IS_MAINTENANCE_MODE = true

  if (IS_MAINTENANCE_MODE) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center py-10 px-4">
        <Card className="w-full max-w-xl rounded-2xl border border-[#1B3A5C] bg-[#0B1E30] p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#143452] text-[#F59E0B] shadow-inner ring-1 ring-[#1B3A5C]">
            <Wrench className="h-8 w-8 animate-pulse text-[#F59E0B]" />
          </div>
          <Badge className="mb-3 border-[#1B3A5C] bg-[#143452] px-3 py-1 text-xs font-bold text-amber-400">
            Aviso do Sistema
          </Badge>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Aba em Manutenção
          </h2>
          <p className="mt-4 text-sm sm:text-base leading-relaxed text-slate-300">
            Aba em Manutenção — Estamos alinhando e auditando o histórico de cravadas e dados do
            bolão. Volte em breve!
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>Auditoria em andamento</span>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Section com Título e Filtro por Competição — renderiza no PRIMEIRO FRAME */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[#0F2A43] p-2.5 text-[#F59E0B] shadow-sm">
              <Trophy className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-[#0F172A] sm:text-3xl">
                  Estatísticas
                </h1>
                <Badge className="border-amber-300 bg-amber-50 text-xs font-bold text-amber-900 shadow-xs">
                  <Sparkles className="mr-1 h-3 w-3 text-amber-600" />
                  Hall da Fama
                </Badge>
                {isRevalidating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Sincronizando...
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Dados consolidados, recordes históricos e métricas de desempenho dos participantes.
              </p>
            </div>
          </div>
        </div>

        {/* Filtro por Competição */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 shadow-xs">
          <Filter className="h-4 w-4 text-slate-500" />
          <label
            htmlFor="comp-select"
            className="text-xs font-bold text-slate-700 whitespace-nowrap"
          >
            Competição:
          </label>
          <select
            id="comp-select"
            value={isGeralSelected ? GERAL_BOLAO_ID : selectedCompetitionId}
            onChange={(e) => handleSelectCompetition(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F2A43] shadow-xs transition hover:border-slate-400 focus:border-[#10B981] focus:outline-none"
          >
            <option value={GERAL_BOLAO_ID}>Geral (Todas as Copas)</option>
            {boloes.map((b) => (
              <option key={b.id} value={b.id}>
                {formatBolaoLabel(b)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Se estiver em carregamento inicial (sem cache ainda), exibe Skeletons idênticos ao layout final */}
      {loading && !statsData ? (
        <div className="space-y-6">
          {/* Subheader Informativo Skeleton */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-36 rounded-full" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>

          {/* 1. Cards de Recordes Skeleton (8 cards) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Card
                key={i}
                className="rounded-[14px] border border-[#E2E8F0] bg-white p-5 shadow-xs"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2 w-3/4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-5 w-28" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-xl" />
                </div>
              </Card>
            ))}
          </div>

          {/* 2. Tabela Detalhada Skeleton */}
          <Card className="rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs">
            <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
              <div className="h-10 bg-[#0F2A43]/10" />
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between px-5 py-4 bg-white">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-7 w-7 rounded-full" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
          </Card>

          {/* 3. Gráfico Skeleton */}
          <Card className="rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs">
            <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-52" />
                <Skeleton className="h-3 w-64" />
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-4 w-16 rounded-full" />
                ))}
              </div>
            </div>
            <div className="h-72 w-full flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-[#0F2A43]" />
                <span className="text-xs text-slate-500 font-medium">
                  Carregando evolução dos pontos...
                </span>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <>
          {/* Subheader Informativo */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Visualizando:</span>
              <Badge
                variant="outline"
                className={`font-bold ${
                  isGeralSelected
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-slate-300 text-[#0F2A43]'
                }`}
              >
                {isGeralSelected && <Globe className="mr-1 h-3 w-3 text-amber-600 inline" />}
                {selectedBolaoName}
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <span>
                <strong className="text-slate-800">{totalJogosEncerrados}</strong> jogos encerrados
              </span>
              <span>•</span>
              <span>
                <strong className="text-slate-800">{totalPalpitesValidos}</strong> palpites
                analisados
              </span>
            </div>
          </div>

          {/* 1. Cards Principais de Recordes (Destaques) */}
          {recordes && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Rei da Cravada */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-[#F59E0B] border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-amber-700">
                        Rei da Cravada
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Rei da Cravada"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Participante com o maior número de placares exatos acertados (8 pontos
                          cada).
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <h3 className="mt-2 text-xl font-black text-[#0F172A]">
                      {recordes.reiDaCravada.participante}
                    </h3>
                    <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                      <span className="text-2xl font-black text-[#0F2A43]">
                        {recordes.reiDaCravada.valor}
                      </span>
                      <span className="font-semibold text-slate-500">cravada(s) exata(s)</span>
                    </p>
                    {recordes.reiDaCravada.empate && (
                      <p className="mt-1 text-[11px] font-medium text-amber-700">
                        Empate: {recordes.reiDaCravada.empate.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3 text-[#F59E0B]">
                    <Target className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 2: Mestre do Vencedor/Empate */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-[#10B981] border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-700">
                        Mestre do Resultado
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Mestre do Resultado"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Participante com a maior quantidade de acertos de resultado final
                          (vencedor do jogo ou empate).
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <h3 className="mt-2 text-xl font-black text-[#0F172A]">
                      {recordes.mestreDoResultado.participante}
                    </h3>
                    <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                      <span className="text-2xl font-black text-[#0F2A43]">
                        {recordes.mestreDoResultado.valor}
                      </span>
                      <span className="font-semibold text-slate-500">resultado(s) acertado(s)</span>
                    </p>
                    {recordes.mestreDoResultado.empate && (
                      <p className="mt-1 text-[11px] font-medium text-emerald-700">
                        Empate: {recordes.mestreDoResultado.empate.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 text-[#10B981]">
                    <CheckCircle className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 3: Matador de Aposta (Gols) */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-rose-500 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-rose-700">
                        Matador de Aposta (Gols)
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Matador de Aposta (Gols)"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Participante que mais somou pontos acertando os marcadores de gols das
                          partidas.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <h3 className="mt-2 text-xl font-black text-[#0F172A]">
                      {recordes.matadorDeAposta.participante}
                    </h3>
                    <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                      <span className="text-2xl font-black text-[#0F2A43]">
                        {recordes.matadorDeAposta.valor}
                      </span>
                      <span className="font-semibold text-slate-500">pts de marcadores</span>
                    </p>
                    {recordes.matadorDeAposta.empate && (
                      <p className="mt-1 text-[11px] font-medium text-rose-700">
                        Empate: {recordes.matadorDeAposta.empate.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-rose-50 p-3 text-rose-600">
                    <Flame className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 4: Maior Pontuador de Rodada */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-indigo-600 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-indigo-700">
                        Maior em Rodada
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Maior em Rodada"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          A maior pontuação atingida por um único usuário em um único
                          confronto/rodada.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <h3 className="mt-2 text-xl font-black text-[#0F172A] truncate">
                      {recordes.maiorPontuadorRodada.participante}
                    </h3>
                    <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                      <span className="text-2xl font-black text-[#0F2A43]">
                        {recordes.maiorPontuadorRodada.pontos}
                      </span>
                      <span className="font-semibold text-slate-500">pontos no confronto</span>
                    </p>
                    <p
                      className="mt-1 truncate text-[11px] font-medium text-slate-500"
                      title={recordes.maiorPontuadorRodada.jogoLabel}
                    >
                      {recordes.maiorPontuadorRodada.rodadaLabel ||
                        recordes.maiorPontuadorRodada.jogoLabel}
                    </p>
                  </div>
                  <div className="ml-2 rounded-xl bg-indigo-50 p-3 text-indigo-600">
                    <Award className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 5: Pai dos Defensores (Mestre da Zaga) */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-purple-600 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-purple-700">
                        Pai dos Defensores
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Pai dos Defensores"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Mestre da Zaga: participante que mais acertou marcadores de gol cuja
                          posição registrada é Zagueiro ou Lateral (+3 pts por gol, incluindo
                          apuração retroativa).
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {recordes.paiDosDefensores.temDados ? (
                      <>
                        <h3 className="mt-2 text-xl font-black text-[#0F172A] truncate">
                          {recordes.paiDosDefensores.participante}
                        </h3>
                        <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                          <span className="text-2xl font-black text-[#0F2A43]">
                            {recordes.paiDosDefensores.valor}
                          </span>
                          <span className="font-semibold text-slate-500">
                            marcador{recordes.paiDosDefensores.valor > 1 ? 'es' : ''} zaga/lateral
                          </span>
                        </p>
                        {recordes.paiDosDefensores.empate && (
                          <p className="mt-1 text-[11px] font-medium text-purple-700 truncate">
                            Empate: {recordes.paiDosDefensores.empate.join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 className="mt-2 text-base font-bold text-slate-400">
                          Ainda sem dados apurados
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Nenhum gol de defensor acertado nas partidas finalizadas deste filtro.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="ml-2 rounded-xl bg-purple-50 p-3 text-purple-600">
                    <Shield className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 6: Mestre do Quase (O Injustiçado) */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-amber-600 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-amber-800">
                        Mestre do Quase
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Mestre do Quase"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          O Injustiçado: participante que mais errou a cravação exata do placar por
                          apenas 1 gol de diferença no confronto.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {recordes.mestreDoQuase.temDados ? (
                      <>
                        <h3 className="mt-2 text-xl font-black text-[#0F172A] truncate">
                          {recordes.mestreDoQuase.participante}
                        </h3>
                        <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                          <span className="text-2xl font-black text-[#0F2A43]">
                            {recordes.mestreDoQuase.valor}
                          </span>
                          <span className="font-semibold text-slate-500">
                            palpite{recordes.mestreDoQuase.valor > 1 ? 's' : ''} a 1 gol do exato
                          </span>
                        </p>
                        {recordes.mestreDoQuase.empate && (
                          <p className="mt-1 text-[11px] font-medium text-amber-800 truncate">
                            Empate: {recordes.mestreDoQuase.empate.join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 className="mt-2 text-base font-bold text-slate-400">
                          Ainda sem dados apurados
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Nenhum palpite a exatamente 1 gol do placar real registrado.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="ml-2 rounded-xl bg-amber-50 p-3 text-amber-700">
                    <Clock className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 7: Pé Frio da Rodada */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-cyan-600 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-cyan-800">
                        Pé Frio da Rodada
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Pé Frio da Rodada"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Participante com o menor aproveitamento percentual de pontos nas partidas
                          já finalizadas.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {recordes.peFrioDaRodada.temDados ? (
                      <>
                        <h3 className="mt-2 text-xl font-black text-[#0F172A] truncate">
                          {recordes.peFrioDaRodada.participante}
                        </h3>
                        <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                          <span className="text-2xl font-black text-[#0F2A43]">
                            {recordes.peFrioDaRodada.aproveitamento}%
                          </span>
                          <span className="font-semibold text-slate-500">
                            de aproveitamento ({recordes.peFrioDaRodada.jogosPalpitados} jogos)
                          </span>
                        </p>
                        {recordes.peFrioDaRodada.empate && (
                          <p className="mt-1 text-[11px] font-medium text-cyan-800 truncate">
                            Empate: {recordes.peFrioDaRodada.empate.join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 className="mt-2 text-base font-bold text-slate-400">
                          Ainda sem dados apurados
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Nenhum participante palpitou em jogos encerrados nesta visão.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="ml-2 rounded-xl bg-cyan-50 p-3 text-cyan-700">
                    <Snowflake className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              {/* Card 8: Mito dos Grandes Jogos */}
              <Card className="relative overflow-visible rounded-[14px] border-l-4 border-l-yellow-500 border-t border-r border-b border-[#E2E8F0] bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-1 hover:shadow-md hover:z-20">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wider text-yellow-800">
                        Mito dos Grandes Jogos
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                            aria-label="Informações sobre Mito dos Grandes Jogos"
                          >
                            <Info className="h-3.5 w-3.5 cursor-pointer" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-[70] max-w-xs text-xs"
                        >
                          Maior pontuador considerando exclusivamente confrontos de fases de
                          mata-mata, finais, supercopas e clássicos do futebol.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {recordes.mitoDosGrandesJogos.temDados ? (
                      <>
                        <h3 className="mt-2 text-xl font-black text-[#0F172A] truncate">
                          {recordes.mitoDosGrandesJogos.participante}
                        </h3>
                        <p className="mt-1 flex items-baseline gap-1 text-xs text-slate-600">
                          <span className="text-2xl font-black text-[#0F2A43]">
                            {recordes.mitoDosGrandesJogos.pontos}
                          </span>
                          <span className="font-semibold text-slate-500">
                            pts em decisões ({recordes.mitoDosGrandesJogos.jogosConsiderados} jogos)
                          </span>
                        </p>
                        {recordes.mitoDosGrandesJogos.empate && (
                          <p className="mt-1 text-[11px] font-medium text-yellow-800 truncate">
                            Empate: {recordes.mitoDosGrandesJogos.empate.join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 className="mt-2 text-base font-bold text-slate-400">
                          Ainda sem dados apurados
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Nenhum jogo de mata-mata, final ou clássico apurado neste filtro.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="ml-2 rounded-xl bg-yellow-50 p-3 text-yellow-700">
                    <Crown className="h-6 w-6" />
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* 2. Módulos Visuais e Comparativos: Tabela Detalhada */}
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardHeader className="p-0 pb-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
                    <Trophy className="h-5 w-5 text-[#F59E0B]" />
                    Tabela de Desempenho Detalhada
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Comparativo oficial dos 4 participantes: pontos consolidados, precisão e
                    aproveitamento.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-slate-300 text-xs font-semibold text-slate-700"
                >
                  {selectedBolaoName}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-[#0F2A43] text-white">
                    <tr>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center w-14">
                        Posição
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider">Participante</th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-right">
                        Total de Pontos
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        Cravadas
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        Resultados
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        Gols
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <span>Zaga/Lateral</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded p-0.5 text-slate-300 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                                aria-label="Informações sobre Zaga/Lateral"
                              >
                                <Info className="h-3.5 w-3.5 cursor-pointer" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="center"
                              sideOffset={6}
                              className="z-[70] max-w-xs text-xs"
                            >
                              Pai dos Defensores: quantidade de marcadores de gols acertados que
                              jogam na defesa (Zagueiro ou Lateral).
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <span>Quase Cravou</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded p-0.5 text-slate-300 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                                aria-label="Informações sobre Quase Cravou"
                              >
                                <Info className="h-3.5 w-3.5 cursor-pointer" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="center"
                              sideOffset={6}
                              className="z-[70] max-w-xs text-xs"
                            >
                              Mestre do Quase: vezes em que errou o placar exato por apenas 1 gol de
                              diferença (|diferença total| = 1).
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <span>Grandes Jogos</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded p-0.5 text-slate-300 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                                aria-label="Informações sobre Grandes Jogos"
                              >
                                <Info className="h-3.5 w-3.5 cursor-pointer" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="center"
                              sideOffset={6}
                              className="z-[70] max-w-xs text-xs"
                            >
                              Mito dos Grandes Jogos: total de pontos conquistados em mata-matas,
                              finais e clássicos.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="py-3 px-3 font-bold uppercase tracking-wider text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <span>Aproveitamento</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded p-0.5 text-slate-300 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                                aria-label="Informações sobre Aproveitamento"
                              >
                                <Info className="h-3.5 w-3.5 cursor-pointer" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="end"
                              sideOffset={6}
                              className="z-[70] max-w-xs text-xs"
                            >
                              Percentual conquistado dos pontos possíveis nos jogos palpitados. O
                              menor percentual evidencia o Pé Frio.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {tabela.map((row) => {
                      const posBadge = getPositionBadge(row.posicao || 1)
                      const isCurrentUser =
                        participantName &&
                        row.nome.trim().toLowerCase() === participantName.trim().toLowerCase()

                      return (
                        <tr
                          key={row.nome}
                          className={`transition duration-150 ${
                            isCurrentUser ? 'bg-emerald-50/70 font-semibold' : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Posição */}
                          <td className="py-3.5 px-4 text-center">
                            <div
                              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs shadow-xs ${posBadge.bg}`}
                            >
                              {posBadge.text}
                            </div>
                          </td>

                          {/* Participante */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-[#0F172A]">{row.nome}</span>
                              {row.posicao === 1 && <span>🏆</span>}
                              {isCurrentUser && (
                                <Badge className="bg-[#10B981] px-1.5 py-0 text-[10px] font-bold text-white hover:bg-[#10B981]">
                                  Você
                                </Badge>
                              )}
                            </div>
                            {row.pontosImportados > 0 && (
                              <p className="text-[11px] text-slate-500">
                                Inclui {row.pontosImportados} pts importados de planilhas
                              </p>
                            )}
                          </td>

                          {/* Total de Pontos */}
                          <td className="py-3.5 px-3 text-right">
                            <span className="text-base font-black text-[#0F2A43]">
                              {row.totalPontos}
                            </span>
                            <span className="ml-1 text-[11px] font-medium text-slate-500">pts</span>
                          </td>

                          {/* Cravadas Exatas */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                row.cravadasExatas > 0
                                  ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {row.cravadasExatas}
                            </Badge>
                          </td>

                          {/* Resultados Acertados */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                row.resultadosAcertados > 0
                                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {row.resultadosAcertados}
                            </Badge>
                          </td>

                          {/* Gols Acertados */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                row.golsAcertados > 0
                                  ? 'bg-rose-100 text-rose-900 border border-rose-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              +{row.golsAcertados} pts
                            </Badge>
                          </td>

                          {/* Marcadores Defensores (Pai dos Defensores) */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                (row.marcadoresDefensores || 0) > 0
                                  ? 'bg-purple-100 text-purple-900 border border-purple-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {(row.marcadoresDefensores || 0) > 0
                                ? `🛡️ ${row.marcadoresDefensores}`
                                : '0'}
                            </Badge>
                          </td>

                          {/* Quase Cravadas (Mestre do Quase) */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                (row.quaseCravadas || 0) > 0
                                  ? 'bg-amber-50 text-amber-900 border border-amber-300'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {(row.quaseCravadas || 0) > 0 ? `⏱️ ${row.quaseCravadas}` : '0'}
                            </Badge>
                          </td>

                          {/* Grandes Jogos (Mito dos Grandes Jogos) */}
                          <td className="py-3.5 px-3 text-center">
                            <Badge
                              variant="secondary"
                              className={`font-black ${
                                (row.pontosGrandesJogos || 0) > 0
                                  ? 'bg-yellow-100 text-yellow-950 border border-yellow-300'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {(row.pontosGrandesJogos || 0) > 0
                                ? `👑 ${row.pontosGrandesJogos} pts`
                                : '0 pts'}
                            </Badge>
                          </td>

                          {/* Aproveitamento (%) & Pé Frio */}
                          <td className="py-3.5 px-3 text-right">
                            <div className="flex flex-col items-end">
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-black text-[#0F2A43]">
                                  {row.aproveitamento}%
                                </span>
                                {recordes?.peFrioDaRodada.temDados &&
                                  row.nome === recordes.peFrioDaRodada.participante &&
                                  row.jogosPalpitadosEncerrados > 0 && (
                                    <span
                                      title="Pé Frio: menor aproveitamento do grupo"
                                      className="text-xs"
                                    >
                                      ❄️
                                    </span>
                                  )}
                              </div>
                              <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    row.aproveitamento < 25
                                      ? 'bg-cyan-500'
                                      : row.aproveitamento < 45
                                        ? 'bg-amber-500'
                                        : 'bg-[#10B981]'
                                  }`}
                                  style={{ width: `${Math.min(100, row.aproveitamento)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 3. Gráfico de Evolução dos Pontos */}
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardHeader className="p-0 pb-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
                    <TrendingUp className="h-5 w-5 text-indigo-600" />
                    Gráfico de Evolução de Pontos
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Variação dos pontos acumulados entre os 4 participantes ao longo dos jogos da
                    competição.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {Object.entries(PARTICIPANT_COLORS).map(([name, conf]) => (
                    <div
                      key={name}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                    >
                      <span
                        className="h-3 w-3 rounded-full border shadow-2xs"
                        style={{ backgroundColor: conf.stroke, borderColor: conf.stroke }}
                      />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 pt-2">
              {evolucao.length <= 1 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center text-xs text-slate-500">
                  Não há jogos finalizados suficientes nesta competição para renderizar a curva de
                  evolução.
                </div>
              ) : (
                <div className="h-72 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={evolucao}
                      margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        dataKey="rodadaLabel"
                        stroke="#64748B"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: '#CBD5E1' }}
                      />
                      <YAxis
                        stroke="#64748B"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: '#CBD5E1' }}
                        domain={['dataMin', 'auto']}
                      />
                      <RechartsTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null
                          const currentPoint = payload[0]?.payload
                          return (
                            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs">
                              <p className="font-bold text-slate-900 border-b border-slate-100 pb-1 mb-2">
                                {label}{' '}
                                {currentPoint?.jogoLabel ? `• ${currentPoint.jogoLabel}` : ''}
                              </p>
                              <div className="space-y-1.5">
                                {payload.map((entry) => (
                                  <div
                                    key={entry.name}
                                    className="flex items-center justify-between gap-4"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: entry.color }}
                                      />
                                      <span className="font-semibold text-slate-700">
                                        {entry.name}:
                                      </span>
                                    </div>
                                    <span className="font-black text-slate-950">
                                      {entry.value} pts
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        }}
                      />
                      <RechartsLegend verticalAlign="bottom" height={36} />
                      <Line
                        type="monotone"
                        dataKey="Douglas"
                        name="Douglas"
                        stroke={PARTICIPANT_COLORS.Douglas.stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS.Douglas.stroke }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Gabriel"
                        name="Gabriel"
                        stroke={PARTICIPANT_COLORS.Gabriel.stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS.Gabriel.stroke }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Bruno Lopes"
                        name="Bruno Lopes"
                        stroke={PARTICIPANT_COLORS['Bruno Lopes'].stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS['Bruno Lopes'].stroke }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Bruno Xavier"
                        name="Bruno Xavier"
                        stroke={PARTICIPANT_COLORS['Bruno Xavier'].stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS['Bruno Xavier'].stroke }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Bruno"
                        name="Bruno"
                        stroke={PARTICIPANT_COLORS.Bruno.stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS.Bruno.stroke }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Davi"
                        name="Davi"
                        stroke={PARTICIPANT_COLORS.Davi.stroke}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: PARTICIPANT_COLORS.Davi.stroke }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
