import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Trophy,
  Calendar,
  CheckCircle2,
  Clock,
  MessageSquare,
  History,
  Shield,
  ArrowRight,
  Sparkles,
  BarChart2,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Participante, Jogo, Palpite } from '@/types/bolao'
import { formatBolaoLabel } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDataBR, formatHoraBR, formatDateTimeBR } from '@/lib/dateUtils'

export default function BolaoDashboard() {
  const { user, isAdmin, participantName } = useAuth()
  const { boloes, activeBolao, activeBolaoId, setActiveBolaoId } = useActivePool()

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [jogos, setJogos] = useState<Jogo[]>([])
  const [palpites, setPalpites] = useState<Palpite[]>([])
  const [loading, setLoading] = useState(true)

  // Real-time updates
  useRealtime<Participante>('participantes', () => {
    loadData()
  })

  useRealtime<Jogo>('jogos', () => {
    loadData()
  })

  useRealtime<Palpite>('palpites', () => {
    loadData()
  })

  const loadData = async () => {
    if (!activeBolaoId) return
    try {
      const [partList, jogosList, palpitesList] = await Promise.all([
        pb.collection('participantes').getFullList<Participante>({
          filter: `bolao = '${activeBolaoId}'`,
          sort: 'nome',
        }),
        pb.collection('jogos').getFullList<Jogo>({
          filter: `bolao = '${activeBolaoId}'`,
          sort: 'data,hora',
        }),
        pb.collection('palpites').getFullList<Palpite>({
          filter: `bolao = '${activeBolaoId}'`,
        }),
      ])
      setParticipantes(partList)
      setJogos(jogosList)
      setPalpites(palpitesList)
    } catch (err) {
      console.error('Erro ao carregar dados do dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeBolaoId) {
      setLoading(true)
      loadData()
    }
  }, [activeBolaoId])

  // Dynamic leaderboard calculation (SUM of valid finished games + imported points)
  const rankingParticipantes = useMemo(() => {
    const finishedGameIds = new Set(jogos.filter((j) => j.resultado_finalizado).map((j) => j.id))

    return participantes
      .map((part) => {
        // Sum only palpites whose game still exists in this bolao and is finalized
        const sumPalpites = palpites
          .filter((p) => p.participante === part.id && finishedGameIds.has(p.jogo))
          .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)

        const importedPts = Number(part.pontos_importados) || 0
        const pontuacaoDinamica = importedPts + sumPalpites

        return {
          ...part,
          pontuacao_total: pontuacaoDinamica,
        }
      })
      .sort((a, b) => {
        if (b.pontuacao_total !== a.pontuacao_total) {
          return b.pontuacao_total - a.pontuacao_total
        }
        return a.nome.localeCompare(b.nome)
      })
  }, [participantes, jogos, palpites])

  // Quick stats
  const stats = useMemo(() => {
    const registrados = jogos.filter((j) => j.resultado_finalizado).length
    const pendentes = jogos.filter((j) => !j.resultado_finalizado).length
    const proximo = jogos.find((j) => !j.resultado_finalizado)
    return {
      registrados,
      pendentes,
      proximo: proximo
        ? `${proximo.time_a} x ${proximo.time_b} (${formatDataBR(proximo.data)} às ${formatHoraBR(proximo.hora)})`
        : '—',
    }
  }, [jogos])

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
                {activeBolao?.foco && (
                  <Badge
                    variant="secondary"
                    className="border border-indigo-200 bg-indigo-50 font-bold text-indigo-800 shadow-xs text-xs px-2.5 py-0.5"
                  >
                    Tema: {activeBolao.foco}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-[#64748B]">
                Competição ativa:{' '}
                <span className="font-semibold text-[#0F2A43]">
                  {activeBolao?.nome || 'Carregando...'}
                </span>
                {activeBolao?.ultima_atualizacao && (
                  <span className="ml-2 text-[11px] text-slate-400">
                    • Atualizado em: {formatDateTimeBR(activeBolao.ultima_atualizacao)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Pool switcher dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="pool-select" className="text-xs font-semibold text-slate-500">
            Trocar Bolão:
          </label>
          <select
            id="pool-select"
            value={activeBolaoId || ''}
            onChange={(e) => setActiveBolaoId(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F2A43] shadow-xs focus:border-[#10B981] focus:outline-none"
          >
            {boloes.map((b) => (
              <option key={b.id} value={b.id}>
                {formatBolaoLabel(b)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[#64748B]">Jogos Encerrados</p>
              <p className="mt-1 text-2xl font-black text-[#0F172A]">{stats.registrados}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2.5 text-[#10B981]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[#64748B]">Jogos Pendentes</p>
              <p className="mt-1 text-2xl font-black text-[#0F172A]">{stats.pendentes}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2.5 text-[#F59E0B]">
              <Clock className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[#64748B]">Próximo Jogo</p>
              <p className="mt-1 truncate text-sm font-bold text-[#0F172A]" title={stats.proximo}>
                {stats.proximo}
              </p>
            </div>
            <div className="ml-2 rounded-lg bg-blue-50 p-2.5 text-[#0F2A43]">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </div>

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
                        <div className="text-right">
                          <span className="text-lg font-black text-[#0F2A43]">
                            {part.pontuacao_total}
                          </span>
                          <span className="ml-1 text-xs font-medium text-slate-500">pts</span>
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

              <Link to="/bolao/palpites" className="block">
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
    </div>
  )
}
