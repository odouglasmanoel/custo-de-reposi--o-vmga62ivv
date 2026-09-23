import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { History, Loader2, Lock, Power, RotateCcw, ShieldAlert, Edit3 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { normalizeMemberName } from '@/lib/statsCalculator'
import type { Bolao, Participante, Jogo, Palpite } from '@/types/bolao'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { setWithBoundedCapacity } from '@/lib/cacheManager'
import { toast } from '@/hooks/use-toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDataBR, formatHoraBR, formatDateTimeBR, sortJogosDecrescente } from '@/lib/dateUtils'
import { getPalpiteMarcadoresPorTime, splitMatchScorersByTeam } from '@/lib/scorerUtils'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'
import { getScoreBreakdownBadges } from '@/lib/scoreBadgeUtils'

interface HistoricoPoolCache {
  participantes: Participante[]
  jogos: Jogo[]
  palpites: Palpite[]
  timestamp: number
}

const CACHE_HISTORICO_PREFIX = 'cr_historico_cache_v1'
const memoryCache = new Map<string, HistoricoPoolCache>()

function readPoolCache(bolaoId: string): HistoricoPoolCache | null {
  if (!bolaoId) return null
  const fromMem = memoryCache.get(bolaoId)
  if (fromMem && Array.isArray(fromMem.jogos)) {
    return fromMem
  }
  try {
    const raw = localStorage.getItem(`${CACHE_HISTORICO_PREFIX}_${bolaoId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HistoricoPoolCache
    if (parsed && Array.isArray(parsed.jogos)) {
      memoryCache.set(bolaoId, parsed)
      return parsed
    }
  } catch {
    return null
  }
  return null
}
function writePoolCache(
  bolaoId: string,
  data: {
    participantes: Participante[]
    jogos: Jogo[]
    palpites: Palpite[]
  },
) {
  if (!bolaoId) return
  const payload: HistoricoPoolCache = {
    ...data,
    timestamp: Date.now(),
  }
  setWithBoundedCapacity(memoryCache, bolaoId, payload, 50)
  try {
    localStorage.setItem(`${CACHE_HISTORICO_PREFIX}_${bolaoId}`, JSON.stringify(payload))
  } catch {
    // localStorage indisponível ou cota cheia
  }
}

export default function Historico() {
  const { isAdmin } = useAuth()
  const { refreshBoloes: refreshGlobalBoloes } = useActivePool()

  // Bolões conhecidos para fallback instantâneo (todas as competições históricas do sistema)
  const fallbackBoloesPadrao: Bolao[] = useMemo(
    () => [
      {
        id: 'copa-coni-fallback',
        nome: 'Copa Coni',
        ativo: true,
        foco: 'Jogos Aleatórios',
        collectionId: 'boloes',
        collectionName: 'boloes',
        created: '',
        updated: '',
      } as Bolao,
      {
        id: 'copa-mundo-fallback',
        nome: 'Copa do Mundo',
        ativo: false,
        foco: 'Seleções Mundiais',
        collectionId: 'boloes',
        collectionName: 'boloes',
        created: '',
        updated: '',
      } as Bolao,
      {
        id: 'copa-genilton-fallback',
        nome: 'Copa Genilton',
        ativo: false,
        foco: 'Paulistão',
        collectionId: 'boloes',
        collectionName: 'boloes',
        created: '',
        updated: '',
      } as Bolao,
      {
        id: 'copa-sormani-fallback',
        nome: 'Copa Sormani',
        ativo: false,
        foco: 'Santos',
        collectionId: 'boloes',
        collectionName: 'boloes',
        created: '',
        updated: '',
      } as Bolao,
    ],
    [],
  )

  // Hidratar o estado boloes imediatamente a partir de localStorage com fallback nos conhecidos
  const [boloes, setBoloes] = useState<Bolao[]>(() => {
    try {
      const raw =
        localStorage.getItem('bolao_cache_boloes') || sessionStorage.getItem('bolao_cache_boloes')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch {
      /* ignore */
    }
    return fallbackBoloesPadrao
  })

  const [selectedBolao, setSelectedBolao] = useState<Bolao | null>(() => {
    try {
      const raw =
        localStorage.getItem('bolao_cache_boloes') || sessionStorage.getItem('bolao_cache_boloes')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0]
        }
      }
    } catch {
      /* ignore */
    }
    return fallbackBoloesPadrao[0] || null
  })

  const initialPoolCache = selectedBolao ? readPoolCache(selectedBolao.id) : null

  const [participantes, setParticipantes] = useState<Participante[]>(
    () => initialPoolCache?.participantes || [],
  )
  const [jogos, setJogos] = useState<Jogo[]>(() => initialPoolCache?.jogos || [])
  const [palpites, setPalpites] = useState<Palpite[]>(() => initialPoolCache?.palpites || [])

  const jogosOrdenadosDecrescente = useMemo(() => sortJogosDecrescente(jogos), [jogos])

  const [editingPalpite, setEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
    timeA: string
    timeB: string
  } | null>(null)

  const [loadingBoloes, setLoadingBoloes] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(() => !initialPoolCache)
  const [isRevalidating, setIsRevalidating] = useState(() => Boolean(initialPoolCache))
  const [hasLoadedCurrentPool, setHasLoadedCurrentPool] = useState(() => Boolean(initialPoolCache))
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  const activeFetchPromiseRef = useRef<Promise<void> | null>(null)
  const currentBolaoIdRef = useRef<string | null>(null)

  // Load all available boloes
  useEffect(() => {
    const fetchBoloes = async () => {
      try {
        const records = await pb.collection('boloes').getFullList<Bolao>({
          sort: 'nome',
          fields: 'id,nome,ativo,ultima_atualizacao,foco',
        })
        if (records && records.length > 0) {
          setBoloes(records)
          try {
            localStorage.setItem('bolao_cache_boloes', JSON.stringify(records))
          } catch {
            /* ignore */
          }
          setSelectedBolao((prev) => {
            if (prev && records.some((b) => b.id === prev.id)) {
              return prev
            }
            return records[0]
          })
        }
      } catch (err) {
        console.error('Erro ao listar bolões do histórico:', err)
        // Rejeição da consulta: fallback em localStorage ou nos bolões conhecidos já hidratados
        try {
          const raw = localStorage.getItem('bolao_cache_boloes')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setBoloes(parsed)
            }
          } else {
            setBoloes((prev) => (prev.length > 0 ? prev : fallbackBoloesPadrao))
          }
        } catch {
          setBoloes((prev) => (prev.length > 0 ? prev : fallbackBoloesPadrao))
        }
      } finally {
        setLoadingBoloes(false)
      }
    }
    fetchBoloes()
  }, [fallbackBoloesPadrao])

  // Função pura para computar o ranking consolidado mantendo a regra idêntica
  const computeRanking = useCallback((parts: Participante[], games: Jogo[], bets: Palpite[]) => {
    const finishedGameIds = new Set(games.filter((g) => g.resultado_finalizado).map((g) => g.id))

    const grouped = new Map<
      string,
      {
        primaryPart: Participante
        totalImported: number
        allPartIds: Set<string>
      }
    >()

    for (const part of parts) {
      const norm = normalizeMemberName(part.nome)
      const existing = grouped.get(norm)
      const imp =
        part.pontos_importados !== undefined && part.pontos_importados !== null
          ? Number(part.pontos_importados)
          : Number(part.pontuacao_total) || 0

      if (!existing) {
        grouped.set(norm, {
          primaryPart: part,
          totalImported: imp,
          allPartIds: new Set([part.id]),
        })
      } else {
        existing.totalImported += imp
        existing.allPartIds.add(part.id)
      }
    }

    const calculatedParts: Participante[] = []
    for (const [normName, group] of grouped.entries()) {
      const sumPalpites = bets
        .filter((p) => group.allPartIds.has(p.participante) && finishedGameIds.has(p.jogo))
        .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)

      calculatedParts.push({
        ...group.primaryPart,
        nome: normName,
        pontos_importados: group.totalImported,
        pontuacao_total: group.totalImported + sumPalpites,
      })
    }

    calculatedParts.sort((a, b) => {
      if (b.pontuacao_total !== a.pontuacao_total) {
        return b.pontuacao_total - a.pontuacao_total
      }
      return a.nome.localeCompare(b.nome)
    })

    return calculatedParts
  }, [])

  // Load details for selected pool with SWR (Instant render from cache + background revalidation)
  useEffect(() => {
    if (!selectedBolao) return
    const targetBolaoId = selectedBolao.id
    currentBolaoIdRef.current = targetBolaoId

    // 1. Tentar ler do cache local para renderização instantânea (SWR)
    const cached = readPoolCache(targetBolaoId)
    if (cached) {
      setJogos(cached.jogos)
      setParticipantes(cached.participantes)
      setPalpites(cached.palpites)
      setLoadingDetails(false)
      setIsRevalidating(true)
      setHasLoadedCurrentPool(true)
    } else {
      // Sem cache: ativa loading skeleton completo e esvazia estados anteriores
      setJogos([])
      setParticipantes([])
      setPalpites([])
      setLoadingDetails(true)
      setIsRevalidating(false)
      setHasLoadedCurrentPool(false)
    }

    // 2. Busca consolidada e em paralelo no backend (apenas 1 query por coleção)
    const loadPoolData = async () => {
      try {
        const [parts, games, bets] = await Promise.all([
          pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${targetBolaoId}'`,
            sort: 'nome',
            fields: 'id,bolao,nome,pontuacao_total,pontos_importados',
          }),
          pb.collection('jogos').getFullList<Jogo>({
            filter: `bolao = '${targetBolaoId}'`,
            sort: 'data,hora',
            fields:
              'id,bolao,time_a,time_b,data,hora,placar_a,placar_b,resultado_finalizado,gols_time_a,gols_time_b,tem_penaltis,vencedor_penaltis,competicao,fixture_id',
          }),
          pb.collection('palpites').getFullList<Palpite>({
            filter: `bolao = '${targetBolaoId}'`,
            fields:
              'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento',
          }),
        ])

        // Se o usuário já mudou de bolão enquanto a requisição rodava, ignora a resposta obsoleta
        if (currentBolaoIdRef.current !== targetBolaoId) {
          return
        }

        const calculatedParts = computeRanking(parts, games, bets)

        setParticipantes(calculatedParts)
        setJogos(games)
        setPalpites(bets)
        setHasLoadedCurrentPool(true)

        // Salva no cache particionado para renderização instantânea na próxima visita
        writePoolCache(targetBolaoId, {
          participantes: calculatedParts,
          jogos: games,
          palpites: bets,
        })
      } catch (err) {
        if (currentBolaoIdRef.current === targetBolaoId) {
          console.error('Erro ao carregar detalhes do bolão selecionado:', err)
          // Em falha do Promise.all, preservar o estado atual em vez de setar [], mantendo readPoolCache(targetBolaoId)
          const fallbackCached = readPoolCache(targetBolaoId)
          if (fallbackCached) {
            setJogos(fallbackCached.jogos)
            setParticipantes(fallbackCached.participantes)
            setPalpites(fallbackCached.palpites)
          }
        }
      } finally {
        if (currentBolaoIdRef.current === targetBolaoId) {
          setLoadingDetails(false)
          setIsRevalidating(false)
          setHasLoadedCurrentPool(true)
          activeFetchPromiseRef.current = null
        }
      }
    }

    const promise = loadPoolData()
    activeFetchPromiseRef.current = promise
  }, [selectedBolao, computeRanking])

  const handleToggleStatus = async (bolaoToToggle: Bolao, e: React.MouseEvent) => {
    e.stopPropagation()
    const novoStatus = !bolaoToToggle.ativo
    setUpdatingStatusId(bolaoToToggle.id)
    try {
      const updated = await pb.collection('boloes').update<Bolao>(bolaoToToggle.id, {
        ativo: novoStatus,
      })

      // Atualiza estado local de bolões
      setBoloes((prev) =>
        prev.map((b) => (b.id === bolaoToToggle.id ? { ...b, ativo: updated.ativo } : b)),
      )

      // Se o bolão selecionado for o mesmo, atualiza também
      if (selectedBolao?.id === bolaoToToggle.id) {
        setSelectedBolao((prev) => (prev ? { ...prev, ativo: updated.ativo } : null))
      }

      // Sincroniza o contexto global de bolões para o dropdown refletir a mudança
      await refreshGlobalBoloes()

      toast({
        title: novoStatus ? 'Bolão Reativado' : 'Bolão Encerrado',
        description: `O status da competição "${bolaoToToggle.nome}" foi alterado com sucesso para ${novoStatus ? 'Ativo' : 'Encerrado'}.`,
      })
    } catch (err) {
      console.error('Erro ao alternar status do bolão:', err)
      toast({
        title: 'Erro ao alterar status',
        description: 'Não foi possível atualizar o status do bolão. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const getPositionBadge = (index: number) => {
    if (index === 0) return { bg: 'bg-[#F59E0B] text-slate-950', text: '1º', trophy: '🏆' }
    if (index === 1) return { bg: 'bg-[#94A3B8] text-white', text: '2º', trophy: '🥈' }
    if (index === 2) return { bg: 'bg-[#B45309] text-white', text: '3º', trophy: '🥉' }
    return { bg: 'bg-[#0F2A43] text-white', text: `${index + 1}º`, trophy: '' }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
            <History className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              Banco de Dados Histórico
            </h1>
            <p className="text-xs text-[#64748B]">
              Consulta de campeonatos anteriores. Módulo dinâmico preparado para visualização de
              edições passadas.
            </p>
          </div>
        </div>
      </div>

      {/* Pool Cards Grid */}
      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
          Campeonatos Cadastrados ({boloes.length})
        </h2>

        {loadingBoloes ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card
                key={i}
                className="rounded-[14px] border border-slate-200 p-5 bg-white space-y-3"
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-2 w-2/3">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-24 rounded-md" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {boloes.map((b) => {
              const isSelected = selectedBolao?.id === b.id

              return (
                <Card
                  key={b.id}
                  className={`cursor-pointer rounded-[14px] border p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                    isSelected
                      ? 'border-[#0F2A43] bg-white ring-2 ring-[#0F2A43]/20 shadow-sm'
                      : 'border-[#E2E8F0] bg-white'
                  }`}
                  onClick={() => setSelectedBolao(b)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-[#0F172A]">{b.nome}</h3>
                      {b.foco && (
                        <div className="mt-1">
                          <span className="inline-block rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                            {b.foco}
                          </span>
                        </div>
                      )}
                      <p className="mt-1.5 text-[11px] text-[#64748B]">
                        {b.ultima_atualizacao
                          ? `Atualizado em: ${formatDateTimeBR(b.ultima_atualizacao)}`
                          : 'Sem data de atualização'}
                      </p>
                    </div>

                    {b.ativo ? (
                      <Badge className="bg-emerald-100 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-200">
                        Encerrado
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500">
                      {isSelected ? 'Visualizando' : 'Clique para ver'}
                    </span>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updatingStatusId === b.id}
                          onClick={(e) => handleToggleStatus(b, e)}
                          className={`h-7 px-2 text-[11px] font-semibold transition ${
                            b.ativo
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
                          }`}
                          title={b.ativo ? 'Encerrar Bolão' : 'Reativar Bolão'}
                        >
                          {updatingStatusId === b.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : b.ativo ? (
                            <>
                              <Power className="mr-1 h-3 w-3" />
                              Encerrar Bolão
                            </>
                          ) : (
                            <>
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Reativar Bolão
                            </>
                          )}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        onClick={() => setSelectedBolao(b)}
                        className={`h-7 px-2.5 text-xs font-semibold ${
                          isSelected
                            ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                            : 'border-slate-300 text-slate-700'
                        }`}
                      >
                        Ver Detalhes
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Pool Detail View: Tabs for Classificação and Resultados */}
      {selectedBolao && (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#0F172A]">Detalhes: {selectedBolao.nome}</h2>
                {selectedBolao.ativo ? (
                  <Badge className="bg-emerald-100 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100">
                    Ativo
                  </Badge>
                ) : (
                  <Badge className="bg-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-200">
                    Encerrado
                  </Badge>
                )}
                {selectedBolao.foco && (
                  <Badge
                    variant="secondary"
                    className="border border-indigo-200 bg-indigo-50 font-bold text-indigo-800 text-xs px-2.5 py-0.5"
                  >
                    Tema: {selectedBolao.foco}
                  </Badge>
                )}
                {isRevalidating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Sincronizando...
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B]">
                Dados consolidados no banco de dados da Skip Cloud (somente leitura).
              </p>
            </div>

            {loadingDetails || !hasLoadedCurrentPool ? (
              <Skeleton className="h-6 w-32 rounded-full" />
            ) : (
              <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
                {jogos.length} jogos registrados
              </Badge>
            )}
          </div>

          {loadingDetails && !hasLoadedCurrentPool ? (
            <div className="space-y-4">
              <div className="flex gap-2 max-w-sm">
                <Skeleton className="h-8 w-1/2 rounded-lg" />
                <Skeleton className="h-8 w-1/2 rounded-lg" />
              </div>
              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-4 bg-white">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Tabs defaultValue="classificacao" className="w-full">
              <TabsList className="grid w-full grid-cols-2 max-w-sm bg-slate-100 p-1 mb-6 rounded-lg">
                <TabsTrigger
                  value="classificacao"
                  className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#0F2A43] data-[state=active]:shadow-xs"
                >
                  Classificação
                </TabsTrigger>
                <TabsTrigger
                  value="resultados"
                  className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#0F2A43] data-[state=active]:shadow-xs"
                >
                  Resultados dos Jogos
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Classificação */}
              <TabsContent value="classificacao" className="space-y-4">
                <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {participantes.map((part, index) => {
                    const badge = getPositionBadge(index)

                    return (
                      <div
                        key={part.id}
                        className={`flex items-center justify-between px-5 py-4 ${
                          index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-xs ${badge.bg}`}
                          >
                            {badge.text}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-[#0F172A]">{part.nome}</span>
                            {index === 0 && <span className="ml-1 text-sm">🏆</span>}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-lg font-black text-[#0F2A43]">
                            {part.pontuacao_total}
                          </span>
                          <span className="ml-1 text-xs font-medium text-slate-500">pontos</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TabsContent>

              {/* Tab 2: Resultados */}
              <TabsContent value="resultados" className="space-y-4">
                {jogosOrdenadosDecrescente.length === 0 ? (
                  hasLoadedCurrentPool ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-xs text-slate-500">
                      Nenhum jogo cadastrado para esta edição histórica. As planilhas históricas
                      devem ser importadas via painel da Skip Cloud / PocketBase.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="p-4 bg-white space-y-2">
                          <div className="flex justify-between items-center">
                            <Skeleton className="h-5 w-48" />
                            <Skeleton className="h-4 w-28" />
                          </div>
                          <Skeleton className="h-4 w-64" />
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                    {jogosOrdenadosDecrescente.map((jogo) => {
                      const gameBets = palpites.filter((p) => p.jogo === jogo.id)

                      const penWinnerTeam =
                        jogo.vencedor_penaltis === 'A'
                          ? jogo.time_a
                          : jogo.vencedor_penaltis === 'B'
                            ? jogo.time_b
                            : (jogo.vencedor_penaltis || '').trim()

                      const shouldShowPenalties = Boolean(
                        jogo.resultado_finalizado &&
                        (jogo.tem_penaltis || penWinnerTeam) &&
                        penWinnerTeam &&
                        penWinnerTeam !== 'N',
                      )

                      return (
                        <div key={jogo.id} className="p-4 bg-white hover:bg-slate-50/70">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="font-bold text-sm text-[#0F172A] line-clamp-2 leading-tight"
                                title={jogo.time_a}
                              >
                                {jogo.time_a}
                              </span>
                              <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-black text-white shrink-0">
                                {jogo.resultado_finalizado && jogo.placar_a !== null
                                  ? `${jogo.placar_a} x ${jogo.placar_b}`
                                  : 'A definir'}
                              </span>
                              <span
                                className="font-bold text-sm text-[#0F172A] line-clamp-2 leading-tight"
                                title={jogo.time_b}
                              >
                                {jogo.time_b}
                              </span>
                              {jogo.competicao && (
                                <Badge
                                  variant="secondary"
                                  className="border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-700 px-2 py-0.5"
                                >
                                  {jogo.competicao}
                                </Badge>
                              )}
                            </div>

                            <span className="text-[11px] text-slate-500">
                              {formatDataBR(jogo.data)} às {formatHoraBR(jogo.hora)}
                            </span>
                          </div>

                          {/* Indicação de Vencedor nos Pênaltis / Classificado em mata-mata */}
                          {shouldShowPenalties && (
                            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
                              <span className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px]">
                                (Nos Pênaltis: {penWinnerTeam})
                              </span>
                            </div>
                          )}

                          {/* Goal scorers if any: separados por mandante e visitante */}
                          {(() => {
                            const splitScorers = splitMatchScorersByTeam({
                              teamAName: jogo.time_a,
                              teamBName: jogo.time_b,
                              placarA: jogo.placar_a,
                              placarB: jogo.placar_b,
                              golsBancoA: jogo.gols_time_a,
                              golsBancoB: jogo.gols_time_b,
                              marcadoresBancoLegado: jogo.marcadores,
                            })

                            if (!splitScorers.hasAnyScorers) return null

                            return (
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                                <span className="font-semibold text-slate-800">⚽ Gols reais:</span>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <div>
                                    <span className="font-semibold text-slate-700">
                                      Gols {jogo.time_a}:
                                    </span>{' '}
                                    <span
                                      className={
                                        splitScorers.labelA === '-'
                                          ? 'text-slate-400 font-normal'
                                          : 'text-slate-900 font-medium'
                                      }
                                    >
                                      {splitScorers.labelA}
                                    </span>
                                  </div>
                                  <span className="text-slate-300 hidden sm:inline">•</span>
                                  <div>
                                    <span className="font-semibold text-slate-700">
                                      Gols {jogo.time_b}:
                                    </span>{' '}
                                    <span
                                      className={
                                        splitScorers.labelB === '-'
                                          ? 'text-slate-400 font-normal'
                                          : 'text-slate-900 font-medium'
                                      }
                                    >
                                      {splitScorers.labelB}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {/* Per-participant predictions for this game */}
                          {gameBets.length > 0 &&
                            (() => {
                              const podeVisualizar = jogo.resultado_finalizado || isAdmin

                              if (!podeVisualizar) {
                                return (
                                  <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
                                    <div className="flex items-center gap-2">
                                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                                      <span>
                                        Os palpites completos (placar e marcadores) ficam visíveis
                                        após a conclusão da partida.
                                      </span>
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className="border-slate-300 text-[10px] text-slate-500"
                                    >
                                      Em sigilo
                                    </Badge>
                                  </div>
                                )
                              }

                              return (
                                <div className="mt-3 space-y-2">
                                  {!jogo.resultado_finalizado && isAdmin && (
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                                      <span>
                                        Visualização antecipada exclusiva para Admin (partida ainda
                                        não concluída).
                                      </span>
                                    </div>
                                  )}
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    {gameBets.map((bet) => {
                                      const part = participantes.find(
                                        (p) => p.id === bet.participante,
                                      )
                                      return (
                                        <div
                                          key={bet.id}
                                          className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                                        >
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="font-bold text-slate-800 truncate">
                                              {part?.nome || 'Participante'}
                                            </span>
                                            {isAdmin && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setEditingPalpite({
                                                    palpite: bet,
                                                    participanteNome: part?.nome || 'Participante',
                                                    timeA: jogo.time_a,
                                                    timeB: jogo.time_b,
                                                  })
                                                }
                                                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition"
                                                title="Editar marcadores deste palpite (Admin)"
                                              >
                                                <Edit3 className="h-2.5 w-2.5" />
                                                <span>Editar</span>
                                              </button>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-slate-600 mt-0.5">
                                            Palpite: {bet.placar_a} x {bet.placar_b}
                                          </div>
                                          {(() => {
                                            const splitPalpite = getPalpiteMarcadoresPorTime(bet)
                                            const is0x0 =
                                              splitPalpite.placarA === 0 &&
                                              splitPalpite.placarB === 0

                                            if (is0x0) {
                                              return (
                                                <div className="mt-0.5 text-[10px] text-slate-400 italic">
                                                  Sem marcadores (0x0)
                                                </div>
                                              )
                                            }

                                            return (
                                              <div className="mt-1 space-y-0.5 border-t border-slate-200/60 pt-0.5 text-[10px] leading-snug">
                                                <div className="truncate text-slate-700">
                                                  <span className="font-semibold text-slate-800">
                                                    Gols Mandante:
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
                                                <div className="truncate text-slate-700">
                                                  <span className="font-semibold text-slate-800">
                                                    Gols Visitante:
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
                                            )
                                          })()}
                                          {jogo.resultado_finalizado && (
                                            <div className="mt-1.5 pt-1 border-t border-slate-200/50">
                                              <div className="font-bold text-emerald-700 text-xs">
                                                +{bet.pontuacao_jogo} pts
                                              </div>

                                              {/* Badges discriminando as regras atingidas */}
                                              {(() => {
                                                const badges = getScoreBreakdownBadges(bet, jogo)
                                                if (badges.length === 0) return null

                                                return (
                                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                                    {badges.map((b) => {
                                                      let styleClass =
                                                        'bg-slate-100 text-slate-700 border-slate-200'
                                                      if (b.variant === 'exact') {
                                                        styleClass =
                                                          'bg-amber-100 text-amber-900 border-amber-300 font-semibold'
                                                      } else if (b.variant === 'winner') {
                                                        styleClass =
                                                          'bg-emerald-100 text-emerald-900 border-emerald-300'
                                                      } else if (b.variant === 'penalties') {
                                                        styleClass =
                                                          'bg-indigo-100 text-indigo-900 border-indigo-300'
                                                      } else if (b.variant === 'half') {
                                                        styleClass =
                                                          'bg-blue-100 text-blue-900 border-blue-300'
                                                      } else if (b.variant === 'scorer') {
                                                        styleClass =
                                                          'bg-violet-100 text-violet-900 border-violet-300'
                                                      }

                                                      return (
                                                        <span
                                                          key={b.id}
                                                          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] leading-tight ${styleClass}`}
                                                          title={
                                                            b.pointsText
                                                              ? `${b.label} (${b.pointsText} pts)`
                                                              : b.label
                                                          }
                                                        >
                                                          {b.label}
                                                        </span>
                                                      )
                                                    })}
                                                  </div>
                                                )
                                              })()}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })()}
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </Card>
      )}

      {/* Modal de Edição de Marcadores para o Admin */}
      <AdminEditMarcadoresModal
        open={Boolean(editingPalpite)}
        onOpenChange={(open) => {
          if (!open) setEditingPalpite(null)
        }}
        palpite={editingPalpite?.palpite || null}
        nomeParticipante={editingPalpite?.participanteNome}
        timeA={editingPalpite?.timeA}
        timeB={editingPalpite?.timeB}
        onSuccess={(updated) => {
          setEditingPalpite((prev) => (prev ? { ...prev, palpite: updated } : null))
          setPalpites((prev) => {
            const nextBets = prev.map((p) => (p.id === updated.id ? updated : p))
            if (selectedBolao) {
              const recalculated = computeRanking(participantes, jogos, nextBets)
              setParticipantes(recalculated)
              writePoolCache(selectedBolao.id, {
                participantes: recalculated,
                jogos,
                palpites: nextBets,
              })
            }
            return nextBets
          })
        }}
      />
    </div>
  )
}
