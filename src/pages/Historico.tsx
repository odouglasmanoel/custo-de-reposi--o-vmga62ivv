import { useState, useEffect } from 'react'
import { History, Loader2, Lock, Power, RotateCcw, ShieldAlert, Edit3 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { normalizeMemberName } from '@/lib/statsCalculator'
import type { Bolao, Participante, Jogo, Palpite } from '@/types/bolao'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { toast } from '@/hooks/use-toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDataBR, formatHoraBR, formatDateTimeBR } from '@/lib/dateUtils'
import {
  formatPalpiteMarcadoresSummary,
  getPalpiteMarcadoresPorTime,
  splitMatchScorersByTeam,
} from '@/lib/scorerUtils'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'

export default function Historico() {
  const { isAdmin } = useAuth()
  const { refreshBoloes: refreshGlobalBoloes } = useActivePool()
  const [boloes, setBoloes] = useState<Bolao[]>([])
  const [selectedBolao, setSelectedBolao] = useState<Bolao | null>(null)

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [jogos, setJogos] = useState<Jogo[]>([])
  const [palpites, setPalpites] = useState<Palpite[]>([])

  const [editingPalpite, setEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
    timeA: string
    timeB: string
  } | null>(null)

  const [loadingBoloes, setLoadingBoloes] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  // Load all available boloes
  useEffect(() => {
    const fetchBoloes = async () => {
      try {
        const records = await pb.collection('boloes').getFullList<Bolao>({
          sort: 'nome',
        })
        setBoloes(records)
        if (records.length > 0) {
          setSelectedBolao(records[0])
        }
      } catch (err) {
        console.error('Erro ao listar bolões do histórico:', err)
      } finally {
        setLoadingBoloes(false)
      }
    }
    fetchBoloes()
  }, [])

  // Load details for selected pool
  useEffect(() => {
    if (!selectedBolao) return

    const loadPoolData = async () => {
      setLoadingDetails(true)
      try {
        const [parts, games, bets] = await Promise.all([
          pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${selectedBolao.id}'`,
            sort: 'nome',
          }),
          pb.collection('jogos').getFullList<Jogo>({
            filter: `bolao = '${selectedBolao.id}'`,
            sort: 'data,hora',
          }),
          pb.collection('palpites').getFullList<Palpite>({
            filter: `bolao = '${selectedBolao.id}'`,
          }),
        ])

        // Dynamically calculate ranking: sum valid finished games + pontos_importados (or existing pontuacao_total if no imported field)
        // Deduplicação estrita por participante (nome normalizado) para garantir que cada participante apareça uma única vez
        const finishedGameIds = new Set(
          games.filter((g) => g.resultado_finalizado).map((g) => g.id),
        )

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

        setParticipantes(calculatedParts)
        setJogos(games)
        setPalpites(bets)
      } catch (err) {
        console.error('Erro ao carregar detalhes do bolão selecionado:', err)
      } finally {
        setLoadingDetails(false)
      }
    }

    loadPoolData()
  }, [selectedBolao])

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
          <div className="py-8 text-center text-xs text-slate-500">
            Carregando lista de bolões...
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
              </div>
              <p className="text-xs text-[#64748B]">
                Dados consolidados no banco de dados da Skip Cloud (somente leitura).
              </p>
            </div>
            <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
              {jogos.length} jogos registrados
            </Badge>
          </div>

          {loadingDetails ? (
            <div className="flex min-h-[250px] items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-[#0F2A43]" />
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
                {jogos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-xs text-slate-500">
                    Nenhum jogo cadastrado para esta edição histórica. As planilhas históricas devem
                    ser importadas via painel da Skip Cloud / PocketBase.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                    {jogos.map((jogo) => {
                      const gameBets = palpites.filter((p) => p.jogo === jogo.id)

                      return (
                        <div key={jogo.id} className="p-4 bg-white hover:bg-slate-50/70">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-sm text-[#0F172A]">
                                {jogo.time_a}
                              </span>
                              <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-black text-white">
                                {jogo.resultado_finalizado && jogo.placar_a !== null
                                  ? `${jogo.placar_a} x ${jogo.placar_b}`
                                  : 'A definir'}
                              </span>
                              <span className="font-bold text-sm text-[#0F172A]">
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
                                            <div className="mt-1 font-semibold text-emerald-700">
                                              +{bet.pontuacao_jogo} pts
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
          setPalpites((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }}
      />
    </div>
  )
}
