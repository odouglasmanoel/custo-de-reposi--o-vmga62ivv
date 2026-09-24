import { useState, useEffect, useMemo } from 'react'
import {
  Calendar,
  Clock,
  Loader2,
  Trophy,
  Award,
  ChevronRight,
  ShieldAlert,
  AlertCircle,
  Eye,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'
import { formatDataBR, formatHoraBR } from '@/lib/dateUtils'
import { getScoreBreakdownBadges, type ScoreRuleBadge } from '@/lib/scoreBadgeUtils'
import { jogoPontua } from '@/lib/jogoStatus'
import { ParticipantScorersView } from '@/components/ParticipantScorersView'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

interface ParticipantBetsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  participante: { id: string; nome: string; pontuacao_total: number } | null
  activeBolaoId: string
  boloes: Bolao[]
}

interface BetItemWithGame {
  palpite: Palpite
  jogo: Jogo
  badges: ScoreRuleBadge[]
}

export function ParticipantBetsModal({
  open,
  onOpenChange,
  participante,
  activeBolaoId,
  boloes,
}: ParticipantBetsModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<BetItemWithGame[]>([])

  const boloesMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of boloes) {
      map.set(b.id, b)
    }
    return map
  }, [boloes])

  useEffect(() => {
    if (!open || !participante) {
      setItems([])
      setError(null)
      return
    }

    let isMounted = true

    const carregarPalpites = async () => {
      setLoading(true)
      setError(null)

      try {
        const isGeral = !activeBolaoId || activeBolaoId === 'geral'

        // 1. Obter todos os registros de participante com o mesmo nome para cobrir 'geral'
        // ou id específico
        const participantRecords = await pb.collection('participantes').getFullList<Participante>({
          filter: `nome ~ '${participante.nome.trim()}'`,
        })

        const matchingIds = participantRecords
          .filter((p) => p.nome.trim().toLowerCase() === participante.nome.trim().toLowerCase())
          .map((p) => p.id)

        if (matchingIds.length === 0) {
          matchingIds.push(participante.id)
        }

        // Montar filtro de palpites
        const partFilter = matchingIds.map((id) => `participante = '${id}'`).join(' || ')
        let finalFilter = matchingIds.length > 1 ? `(${partFilter})` : partFilter

        if (!isGeral) {
          finalFilter = `(${finalFilter}) && bolao = '${activeBolaoId}'`
        }

        // 2. Buscar palpites
        const palpites = await pb.collection('palpites').getFullList<Palpite>({
          filter: finalFilter,
          sort: '-created',
        })

        if (palpites.length === 0) {
          if (isMounted) {
            setItems([])
            setLoading(false)
          }
          return
        }

        // 3. Buscar jogos correspondentes
        const jogoIds = Array.from(new Set(palpites.map((p) => p.jogo).filter(Boolean)))
        const jogosChunk: Jogo[] = []

        // Dividir em lotes de 40 para não estourar URL filter
        for (let i = 0; i < jogoIds.length; i += 30) {
          const slice = jogoIds.slice(i, i + 30)
          const jFilter = slice.map((id) => `id = '${id}'`).join(' || ')
          const recs = await pb.collection('jogos').getFullList<Jogo>({
            filter: jFilter,
          })
          jogosChunk.push(...recs)
        }

        const jogosMap = new Map<string, Jogo>()
        for (const j of jogosChunk) {
          jogosMap.set(j.id, j)
        }

        // 4. Montar lista de palpites enriquecida com o jogo e badges
        const now = Date.now()
        const enriched: BetItemWithGame[] = []
        for (const p of palpites) {
          const j = jogosMap.get(p.jogo)
          if (!j) continue

          const badges = getScoreBreakdownBadges(p, j, now)
          enriched.push({
            palpite: p,
            jogo: j,
            badges,
          })
        }

        // Ordenar jogos por data/hora decrescente
        enriched.sort((a, b) => {
          const dtA = `${a.jogo.data || ''}T${a.jogo.hora || '00:00'}`
          const dtB = `${b.jogo.data || ''}T${b.jogo.hora || '00:00'}`
          return dtB.localeCompare(dtA)
        })

        if (isMounted) {
          setItems(enriched)
        }
      } catch (err: any) {
        console.error('Erro ao carregar palpites do participante:', err)
        if (isMounted) {
          setError(err?.message || 'Falha ao buscar palpites.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    carregarPalpites()

    return () => {
      isMounted = false
    }
  }, [open, participante, activeBolaoId])

  // Agrupamento por bolão/copa quando no modo Geral
  const isGeral = !activeBolaoId || activeBolaoId === 'geral'

  const groupedByBolao = useMemo(() => {
    if (!isGeral) {
      return [{ bolaoId: activeBolaoId, items }]
    }
    const map = new Map<string, BetItemWithGame[]>()
    for (const item of items) {
      const bId = item.palpite.bolao || item.jogo.bolao || 'indefinido'
      const list = map.get(bId) || []
      list.push(item)
      map.set(bId, list)
    }
    return Array.from(map.entries()).map(([bolaoId, bItems]) => ({
      bolaoId,
      items: bItems,
    }))
  }, [isGeral, activeBolaoId, items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-full max-h-[88vh] overflow-y-auto bg-white rounded-xl p-6">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-[#0F172A]">
                  Palpites de {participante?.nome}
                </DialogTitle>
                <DialogDescription className="text-xs text-[#64748B]">
                  {isGeral
                    ? 'Todos os palpites em todas as competições'
                    : `Palpites para ${boloesMap.get(activeBolaoId)?.nome || 'a competição selecionada'}`}
                </DialogDescription>
              </div>
            </div>

            {participante && (
              <Badge className="bg-[#0F2A43] hover:bg-[#1B3A5C] text-white text-xs px-2.5 py-1 font-bold">
                Total: {participante.pontuacao_total} pts
              </Badge>
            )}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <span>Buscando palpites e detalhamentos de pontuação...</span>
          </div>
        ) : error ? (
          <div className="my-6 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div>
              <p className="font-semibold">Erro ao carregar:</p>
              <p>{error}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="my-8 rounded-lg bg-slate-50 p-8 text-center text-xs text-slate-500">
            Nenhum palpite registrado para {participante?.nome} nesta visualização.
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {groupedByBolao.map(({ bolaoId, items: bItems }) => {
              const bolaoInfo = boloesMap.get(bolaoId)
              const bolaoNome = bolaoInfo?.nome || (bolaoId === 'geral' ? 'Geral' : 'Competição')

              return (
                <div key={bolaoId} className="space-y-3">
                  {isGeral && (
                    <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                      <Badge
                        variant="secondary"
                        className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold"
                      >
                        {bolaoNome}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        ({bItems.length} partida{bItems.length === 1 ? '' : 's'})
                      </span>
                    </div>
                  )}

                  <div className="space-y-3">
                    {bItems.map(({ palpite, jogo, badges }) => {
                      const agoraMs = Date.now()
                      const podePontuar = jogoPontua(jogo, agoraMs)
                      const finalizado = Boolean(jogo.resultado_finalizado) && podePontuar
                      const placarRealA = jogo.placar_a
                      const placarRealB = jogo.placar_b
                      const temResultadoReal =
                        placarRealA !== null &&
                        placarRealA !== undefined &&
                        placarRealB !== null &&
                        placarRealB !== undefined

                      const ptsJogo = podePontuar ? Number(palpite.pontuacao_jogo) || 0 : 0

                      return (
                        <div
                          key={palpite.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-slate-300 transition"
                        >
                          {/* Cabeçalho do Confronto */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="text-sm font-bold text-[#0F172A] line-clamp-2 leading-tight"
                                title={`${jogo.time_a} x ${jogo.time_b}`}
                              >
                                {jogo.time_a} x {jogo.time_b}
                              </span>
                              {jogo.competicao && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                  {jogo.competicao}
                                </span>
                              )}
                              {jogo.tem_penaltis && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                                  Mata-mata
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1 text-[11px]">
                                <Calendar className="h-3 w-3 text-slate-400" />
                                {formatDataBR(jogo.data)}
                              </span>
                              <span className="flex items-center gap-1 text-[11px]">
                                <Clock className="h-3 w-3 text-slate-400" />
                                {formatHoraBR(jogo.hora)}
                              </span>
                            </div>
                          </div>

                          {/* Comparativo: Palpite vs Placar Real */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 border-b border-slate-100">
                            {/* Palpite do participante */}
                            <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wide">
                                  Palpite de {participante?.nome}:
                                </span>
                                <Badge className="bg-emerald-600 text-white font-black text-xs px-2 py-0">
                                  {palpite.placar_a} x {palpite.placar_b}
                                  {palpite.vencedor_penaltis &&
                                    palpite.vencedor_penaltis !== 'N' && (
                                      <span className="ml-1 text-[9px] font-normal opacity-90">
                                        (Pên:{' '}
                                        {palpite.vencedor_penaltis === 'A'
                                          ? jogo.time_a
                                          : jogo.time_b}
                                        )
                                      </span>
                                    )}
                                </Badge>
                              </div>

                              {/* Marcadores apostados via ParticipantScorersView */}
                              <ParticipantScorersView
                                participanteNome={participante?.nome || ''}
                                timeA={jogo.time_a}
                                timeB={jogo.time_b}
                                placarA={palpite.placar_a}
                                placarB={palpite.placar_b}
                                rawGolsA={palpite.goleadores_a}
                                rawGolsB={palpite.goleadores_b}
                                jogoGolsA={podePontuar ? jogo.gols_time_a : []}
                                jogoGolsB={podePontuar ? jogo.gols_time_b : []}
                              />
                            </div>

                            {/* Placar Real da Partida */}
                            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                                    Resultado Real:
                                  </span>
                                  {finalizado ? (
                                    <Badge className="bg-slate-900 text-white font-black text-xs px-2 py-0">
                                      {placarRealA} x {placarRealB}
                                      {jogo.vencedor_penaltis && (
                                        <span className="ml-1 text-[9px] text-amber-300">
                                          (Pên:{' '}
                                          {jogo.vencedor_penaltis === 'A'
                                            ? jogo.time_a
                                            : jogo.time_b}
                                          )
                                        </span>
                                      )}
                                    </Badge>
                                  ) : podePontuar ? (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-300 bg-amber-50 text-amber-800 text-[10px]"
                                    >
                                      {temResultadoReal
                                        ? `Ao Vivo: ${placarRealA} x ${placarRealB}`
                                        : 'Aguardando jogo'}
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="border-slate-300 bg-slate-100 text-slate-600 text-[10px]"
                                    >
                                      Aguardando início
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {/* Pontos obtidos nesta partida */}
                              <div className="pt-2 flex items-center justify-between border-t border-slate-200/60 mt-1">
                                <span className="text-xs font-semibold text-slate-600">
                                  Pontos na Partida:
                                </span>
                                <span
                                  className={`text-sm font-black ${
                                    ptsJogo > 0 ? 'text-emerald-700' : 'text-slate-500'
                                  }`}
                                >
                                  {podePontuar ? `+${ptsJogo} pts` : '-'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Detalhamento da Pontuação (Badges) */}
                          <div className="pt-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                              Detalhamento de Pontos:
                            </span>

                            {!podePontuar ? (
                              <span className="text-xs text-slate-400 italic">
                                Aguardando início
                              </span>
                            ) : badges.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {badges.map((b) => (
                                  <span
                                    key={b.id}
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-900"
                                  >
                                    <span className="font-semibold">{b.label}</span>
                                    {b.pointsText && (
                                      <span className="rounded bg-emerald-600 px-1 py-0 text-[10px] font-bold text-white">
                                        {b.pointsText}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ) : ptsJogo > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                +{ptsJogo} pts obtidos
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">
                                {finalizado
                                  ? 'Nenhuma pontuação nesta partida.'
                                  : 'Pontuação será calculada após o encerramento.'}
                              </span>
                            )}
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
      </DialogContent>
    </Dialog>
  )
}
