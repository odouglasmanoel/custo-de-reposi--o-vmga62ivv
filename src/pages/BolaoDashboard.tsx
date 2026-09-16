import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
  Globe,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth, BOLAO_MEMBERS } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Bolao, Participante, Jogo, Palpite } from '@/types/bolao'
import { formatBolaoLabel, GERAL_BOLAO_ID } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  formatDataBR,
  formatHoraBR,
  formatDateTimeBR,
  isPalpiteEncerrado,
  isJogoHoje,
  isJogoHojeNaoIniciado,
  getJogoKickoffTimestamp,
} from '@/lib/dateUtils'
import { formatPalpiteMarcadoresSummary } from '@/lib/scorerUtils'
import { Users } from 'lucide-react'

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

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [allParticipantes, setAllParticipantes] = useState<Participante[]>([])
  const [allJogos, setAllJogos] = useState<Jogo[]>([])
  const [jogos, setJogos] = useState<Jogo[]>([])
  const [palpites, setPalpites] = useState<Palpite[]>([])
  const [loading, setLoading] = useState(true)
  const [nowMs, setNowMs] = useState<number>(Date.now())

  // Atualiza periodicamente o timestamp atual para destravar os palpites do grupo no minuto exato do jogo
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  const isGeral = activeBolaoId === GERAL_BOLAO_ID

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
      if (activeBolaoId === GERAL_BOLAO_ID) {
        // Carregar dados de todas as copas (ativas e encerradas) em apenas 3 chamadas
        const [allParts, allGames, allPredictions] = await Promise.all([
          pb.collection('participantes').getFullList<Participante>({
            sort: 'nome',
          }),
          pb.collection('jogos').getFullList<Jogo>({
            sort: 'data,hora',
          }),
          pb.collection('palpites').getFullList<Palpite>(),
        ])
        setAllParticipantes(allParts)
        setAllJogos(allGames)
        setParticipantes(allParts)
        setJogos(allGames)
        setPalpites(allPredictions)
      } else {
        // Otimização: buscar listas globais uma única vez e derivar as listas filtradas do bolão em memória,
        // eliminando 2 queries duplicadas contra o PocketBase no mount e a cada atualização
        const [globalParts, globalGames, palpitesList] = await Promise.all([
          pb.collection('participantes').getFullList<Participante>({
            sort: 'nome',
          }),
          pb.collection('jogos').getFullList<Jogo>({
            sort: 'data,hora',
          }),
          pb.collection('palpites').getFullList<Palpite>({
            filter: `bolao = '${activeBolaoId}'`,
          }),
        ])
        const partList = globalParts.filter((p) => p.bolao === activeBolaoId)
        const jogosList = globalGames.filter((j) => j.bolao === activeBolaoId)

        setParticipantes(partList)
        setJogos(jogosList)
        setPalpites(palpitesList)
        setAllParticipantes(globalParts)
        setAllJogos(globalGames)
      }
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
    if (isGeral) {
      // Visão Geral: agregar os 4 participantes em todas as copas
      const finishedGameIds = new Set(
        allJogos.filter((j) => j.resultado_finalizado).map((j) => j.id),
      )

      // Identificar os 4 membros oficiais
      const memberNames = [...BOLAO_MEMBERS]

      return memberNames
        .map((memberName) => {
          // Encontrar todos os registros de participantes deste membro em todos os bolões
          const memberPartRecords = allParticipantes.filter(
            (p) => p.nome.trim().toLowerCase() === memberName.toLowerCase(),
          )
          const memberPartIds = new Set(memberPartRecords.map((p) => p.id))

          // Soma de pontos importados de todas as copas para este membro
          const totalImportados = memberPartRecords.reduce(
            (acc, p) => acc + (Number(p.pontos_importados) || 0),
            0,
          )

          // Soma de palpites de jogos finalizados em todas as copas para este membro
          const sumPalpites = palpites
            .filter((p) => memberPartIds.has(p.participante) && finishedGameIds.has(p.jogo))
            .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)

          const pontuacaoConsolidada = totalImportados + sumPalpites

          return {
            id: memberPartRecords[0]?.id || `geral-${memberName}`,
            bolao: GERAL_BOLAO_ID,
            nome: memberName,
            pontos_importados: totalImportados,
            pontuacao_total: pontuacaoConsolidada,
            collectionId: '',
            collectionName: 'participantes',
            created: '',
            updated: '',
          } as Participante
        })
        .sort((a, b) => {
          if (b.pontuacao_total !== a.pontuacao_total) {
            return b.pontuacao_total - a.pontuacao_total
          }
          return a.nome.localeCompare(b.nome)
        })
    }

    // Visão de bolão específico (lógica existente mantida com precisão)
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
  }, [isGeral, participantes, jogos, palpites, allJogos, allParticipantes])

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

  // Jogos cujos palpites foram liberados:
  // SOMENTE jogos pendentes (não finalizados) cujo horário de início já passou (dataHoraAtual >= dataHoraJogo)
  const jogosLiberados = useMemo(() => {
    const targetGames = isGeral ? allJogos : jogos
    return targetGames
      .filter((j) => !j.resultado_finalizado && isPalpiteEncerrado(j.data, j.hora, nowMs))
      .sort((a, b) => {
        // Ordenar por horário de kickoff decrescente (mais recentes primeiro)
        const kickA = getJogoKickoffTimestamp(a.data, a.hora) ?? new Date(a.data).getTime()
        const kickB = getJogoKickoffTimestamp(b.data, b.hora) ?? new Date(b.data).getTime()
        return kickB - kickA
      })
  }, [isGeral, allJogos, jogos, nowMs])

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

  // Quick stats
  const stats = useMemo(() => {
    const gamesToUse = isGeral ? allJogos : jogos
    const registrados = gamesToUse.filter((j) => j.resultado_finalizado).length
    const pendentes = gamesToUse.filter((j) => !j.resultado_finalizado).length
    return {
      registrados,
      pendentes,
    }
  }, [isGeral, allJogos, jogos])

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
              <p className="mt-1 text-2xl font-black text-[#0F172A]">{stats.pendentes}</p>
              <span className="text-[10px] font-semibold text-amber-600 group-hover:underline">
                Clique para palpitar &rarr;
              </span>
            </div>
            <div className="rounded-lg bg-amber-50 p-2.5 text-[#F59E0B] group-hover:bg-amber-100 transition-colors">
              <Clock className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between pr-2">
                <p className="text-xs font-medium text-[#64748B]">Jogos de Hoje</p>
                <Badge
                  variant="outline"
                  className="border-blue-200 bg-blue-50/60 text-[10px] font-semibold text-[#0F2A43]"
                >
                  {jogosDeHoje.length} jogo(s)
                </Badge>
              </div>
              {jogosDeHoje.length === 0 ? (
                <p className="mt-1 text-sm font-medium text-slate-400">
                  Nenhum jogo agendado para hoje
                </p>
              ) : (
                <div className="mt-1.5 space-y-1.5 max-h-24 overflow-y-auto pr-1">
                  {jogosDeHoje.map((jogo) => {
                    const bolaoOrigem = isGeral ? bolaoMap.get(jogo.bolao) : null
                    return (
                      <div
                        key={jogo.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {bolaoOrigem && (
                            <Badge
                              variant="secondary"
                              className="border border-[#CBD5E1] bg-slate-100 text-[#0F2A43] font-semibold text-[9px] px-1 py-0 shrink-0"
                            >
                              {bolaoOrigem.nome.replace('Copa ', '')}
                            </Badge>
                          )}
                          <span className="font-bold text-[#0F172A] truncate">
                            {jogo.time_a} x {jogo.time_b}
                          </span>
                        </div>
                        <span className="shrink-0 font-semibold text-[#0F2A43] bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                          {formatHoraBR(jogo.hora) || '—'}
                        </span>
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

                return (
                  <div
                    key={jogo.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
                  >
                    {/* Header do confronto */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        {bolaoOrigem && (
                          <Badge
                            variant="secondary"
                            className="border border-[#CBD5E1] bg-white text-[#0F2A43] font-bold text-[10px] px-2 py-0.5"
                          >
                            🏆 {bolaoOrigem.nome}
                          </Badge>
                        )}
                        <span className="font-bold text-sm text-[#0F172A]">
                          {jogo.time_a} x {jogo.time_b}
                        </span>
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
                        <Badge
                          variant="outline"
                          className="border-rose-300 bg-rose-50 text-[10px] font-semibold text-rose-800"
                        >
                          Palpites Encerrados (Em andamento)
                        </Badge>
                      </div>
                    </div>

                    {/* Cards dos palpites de cada participante */}
                    <div className="p-4">
                      {gameBets.length === 0 ? (
                        <p className="text-center text-xs italic text-slate-400 py-1">
                          Nenhum participante palpitou para este confronto.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {gameBets.map((bet) => {
                            const part = participantesMap.get(bet.participante)
                            const nomeParticipante = part?.nome || 'Participante'
                            const isCurrentUser =
                              participantName &&
                              nomeParticipante.trim().toLowerCase() ===
                                participantName.trim().toLowerCase()

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
                                  {isCurrentUser && (
                                    <Badge className="bg-[#10B981] px-1 py-0 text-[9px] font-bold text-white hover:bg-[#10B981] shrink-0">
                                      Você
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-1 text-xs font-semibold text-slate-800">
                                  Palpite:{' '}
                                  <strong className="text-sm font-black text-[#0F2A43]">
                                    {bet.placar_a} x {bet.placar_b}
                                  </strong>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-600 font-medium leading-snug">
                                  {formatPalpiteMarcadoresSummary(bet)}
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
    </div>
  )
}
