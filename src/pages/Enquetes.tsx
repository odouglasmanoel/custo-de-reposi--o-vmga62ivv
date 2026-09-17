import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Vote,
  Calendar,
  Clock,
  Shield,
  Plus,
  RefreshCw,
  Trophy,
  CheckCircle2,
  AlertCircle,
  Flame,
  CheckSquare,
  Square,
  Users,
  Send,
  Trash2,
  ChevronRight,
  Sparkles,
  Info,
  Radio,
  ExternalLink,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatDataBR, formatHoraBR } from '@/lib/dateUtils'
import {
  type EnqueteModel,
  type JogoComVotos,
  type JogoBuscado,
  getDefaultDatasIntervalo,
  buscarJogosIntervalo,
  criarEnquete,
  listarEnquetes,
  obterDadosEnquete,
  toggleVotoJogo,
  toggleAdminSelecaoJogo,
  atualizarStatusEnquete,
  cadastrarJogosAprovadosNaCopaConi,
  excluirEnquete,
} from '@/services/enquetes'

export default function Enquetes() {
  const { user, isAdmin, participantName } = useAuth()
  const { toast } = useToast()

  // Estados principais
  const [enquetes, setEnquetes] = useState<EnqueteModel[]>([])
  const [enqueteAtivaId, setEnqueteAtivaId] = useState<string>('')
  const [enqueteAtiva, setEnqueteAtiva] = useState<EnqueteModel | null>(null)
  const [jogosEnquete, setJogosEnquete] = useState<JogoComVotos[]>([])
  const [meusVotosIds, setMeusVotosIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [votandoJogoId, setVotandoJogoId] = useState<string | null>(null)

  // Painel Admin: Criação de Nova Enquete
  const [dialogNovaEnqueteOpen, setDialogNovaEnqueteOpen] = useState(false)
  const datasPadrao = useMemo(() => getDefaultDatasIntervalo(), [])
  const [dataInicio, setDataInicio] = useState(datasPadrao.dataInicio)
  const [dataFim, setDataFim] = useState(datasPadrao.dataFim)
  const [tituloEnquete, setTituloEnquete] = useState('')
  const [descricaoEnquete, setDescricaoEnquete] = useState('')
  const [buscandoJogos, setBuscandoJogos] = useState(false)
  const [jogosEncontrados, setJogosEncontrados] = useState<JogoBuscado[]>([])
  const [jogosPreSelecionados, setJogosPreSelecionados] = useState<Set<string>>(new Set())
  const [publicandoEnquete, setPublicandoEnquete] = useState(false)
  const [erroBuscaJogos, setErroBuscaJogos] = useState<string | null>(null)

  // Ações do Admin no Apurador
  const [cadastrandoConi, setCadastrandoConi] = useState(false)
  const [confirmCadastrarOpen, setConfirmCadastrarOpen] = useState(false)
  const [dialogExcluirOpen, setDialogExcluirOpen] = useState(false)
  const [excluindoEnquete, setExcluindoEnquete] = useState(false)

  // Filtro de visualização na aba de votação
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todos')

  // Realtime para atualizar votos e status
  useRealtime('enquete_votos', () => {
    if (enqueteAtivaId) {
      carregarDetalhesEnquete(enqueteAtivaId, false)
    }
  })

  useRealtime('enquete_jogos', () => {
    if (enqueteAtivaId) {
      carregarDetalhesEnquete(enqueteAtivaId, false)
    }
  })

  useRealtime('enquetes', () => {
    carregarListaEnquetes(false)
  })

  // Carrega lista de enquetes
  const carregarListaEnquetes = useCallback(
    async (selectFirst = true) => {
      try {
        const lista = await listarEnquetes()
        setEnquetes(lista)
        if (lista.length > 0) {
          if (selectFirst || !enqueteAtivaId) {
            // Seleciona a primeira aberta ou mais recente
            const aberta = lista.find((e) => e.status === 'aberta') || lista[0]
            setEnqueteAtivaId(aberta.id)
          }
        } else {
          setEnqueteAtivaId('')
          setEnqueteAtiva(null)
          setJogosEnquete([])
        }
      } catch (err) {
        console.error('Erro ao carregar enquetes:', err)
      } finally {
        setLoading(false)
      }
    },
    [enqueteAtivaId],
  )

  // Carrega detalhes da enquete selecionada
  const carregarDetalhesEnquete = useCallback(
    async (enqueteId: string, showSpinner = true) => {
      if (!enqueteId) return
      if (showSpinner) setLoading(true)
      try {
        const dados = await obterDadosEnquete(enqueteId, user?.id)
        setEnqueteAtiva(dados.enquete)
        setJogosEnquete(dados.jogos)
        setMeusVotosIds(dados.meusVotosIds)
      } catch (err) {
        console.error('Erro ao obter detalhes da enquete:', err)
      } finally {
        if (showSpinner) setLoading(false)
      }
    },
    [user?.id],
  )

  useEffect(() => {
    carregarListaEnquetes(true)
  }, [carregarListaEnquetes])

  useEffect(() => {
    if (enqueteAtivaId) {
      carregarDetalhesEnquete(enqueteAtivaId, true)
    }
  }, [enqueteAtivaId, carregarDetalhesEnquete])

  // Total de votos do usuário logado na enquete ativa
  const totalMeusVotos = meusVotosIds.size
  const limiteVotos = enqueteAtiva?.limite_votos || 8
  const limiteAtingido = totalMeusVotos >= limiteVotos

  // Ranking dos jogos por total de votos (decrescente)
  const rankingJogos = useMemo(() => {
    return [...jogosEnquete].sort((a, b) => {
      if (b.totalVotos !== a.totalVotos) {
        return b.totalVotos - a.totalVotos
      }
      return a.data.localeCompare(b.data)
    })
  }, [jogosEnquete])

  // IDs dos 4 jogos mais votados
  const top4JogosIds = useMemo(() => {
    const sorted = [...jogosEnquete]
      .filter((j) => j.totalVotos > 0)
      .sort((a, b) => b.totalVotos - a.totalVotos)
    return new Set(sorted.slice(0, 4).map((j) => j.id))
  }, [jogosEnquete])

  // Jogos aprovados para Copa Coni (selecionados manualmente pelo admin OU top 4 por padrão se admin não marcou outros)
  const jogosAprovadosParaConi = useMemo(() => {
    const marcadosPeloAdmin = jogosEnquete.filter((j) => j.selecionado_admin)
    if (marcadosPeloAdmin.length > 0) {
      return marcadosPeloAdmin
    }
    // Fallback: se o admin ainda não marcou caixas manuais, sugere os 4 mais votados (com ao menos 1 voto)
    const comVotos = [...jogosEnquete]
      .filter((j) => j.totalVotos > 0)
      .sort((a, b) => b.totalVotos - a.totalVotos)
    return comVotos.slice(0, 4)
  }, [jogosEnquete])

  // Filtro de jogos na lista de votação
  const jogosFiltradosVotacao = useMemo(() => {
    if (filtroCategoria === 'todos') return jogosEnquete
    if (filtroCategoria === 'brasileirao') {
      return jogosEnquete.filter(
        (j) =>
          j.campeonato?.toLowerCase().includes('brasileir') ||
          j.regiao?.toLowerCase().includes('brasileir'),
      )
    }
    if (filtroCategoria === 'champions') {
      return jogosEnquete.filter((j) => j.campeonato?.toLowerCase().includes('champions'))
    }
    if (filtroCategoria === 'europa') {
      return jogosEnquete.filter(
        (j) =>
          !j.campeonato?.toLowerCase().includes('brasileir') &&
          !j.campeonato?.toLowerCase().includes('champions'),
      )
    }
    if (filtroCategoria === 'meus-votos') {
      return jogosEnquete.filter((j) => meusVotosIds.has(j.id))
    }
    return jogosEnquete
  }, [jogosEnquete, filtroCategoria, meusVotosIds])

  // Ação: Votar / Desmarcar Jogo
  const handleToggleVoto = async (jogoId: string) => {
    if (!enqueteAtiva) return
    if (enqueteAtiva.status !== 'aberta') {
      toast({
        title: 'Votação encerrada',
        description: 'Esta enquete não está mais recebendo votos.',
        variant: 'destructive',
      })
      return
    }

    const jaVotado = meusVotosIds.has(jogoId)
    if (!jaVotado && limiteAtingido) {
      toast({
        title: 'Limite de 8 votos atingido!',
        description:
          'Você já utilizou os 8 votos permitidos. Para votar nesta partida, desmarque outra primeiro.',
        variant: 'destructive',
      })
      return
    }

    setVotandoJogoId(jogoId)
    try {
      const res = await toggleVotoJogo(enqueteAtiva.id, jogoId, limiteVotos)
      setMeusVotosIds((prev) => {
        const next = new Set(prev)
        if (res.voted) next.add(jogoId)
        else next.delete(jogoId)
        return next
      })

      // Atualização otimista na lista local
      setJogosEnquete((prev) =>
        prev.map((j) => {
          if (j.id === jogoId) {
            const countDiff = res.voted ? 1 : -1
            const myName = participantName || 'Eu'
            const nextVotantes = res.voted
              ? [...j.votantes, myName]
              : j.votantes.filter((v) => v !== myName)
            return {
              ...j,
              totalVotos: Math.max(0, j.totalVotos + countDiff),
              votadoPorMim: res.voted,
              votantes: nextVotantes,
            }
          }
          return j
        }),
      )

      toast({
        title: res.voted ? 'Voto registrado!' : 'Voto removido',
        description: `Votos utilizados: ${res.totalVotosUsuario}/${limiteVotos}`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao registrar voto.'
      toast({
        title: 'Aviso de votação',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setVotandoJogoId(null)
    }
  }

  // Admin: Buscar jogos no intervalo
  const handleBuscarJogosIntervalo = async () => {
    setErroBuscaJogos(null)
    if (!dataInicio || !dataFim) {
      setErroBuscaJogos('Preencha as datas de início e fim do intervalo.')
      return
    }
    if (dataInicio > dataFim) {
      setErroBuscaJogos('A data inicial não pode ser posterior à data final.')
      return
    }

    setBuscandoJogos(true)
    try {
      const fixtures = await buscarJogosIntervalo(dataInicio, dataFim)
      setJogosEncontrados(fixtures)
      // Por padrão, pré-seleciona todos os jogos encontrados para a enquete
      setJogosPreSelecionados(new Set(fixtures.map((f) => f.id)))
      if (fixtures.length === 0) {
        setErroBuscaJogos(
          'Nenhum confronto das competições principais encontrado para o período informado.',
        )
      } else if (!tituloEnquete) {
        setTituloEnquete(
          `Enquete Copa Coni — ${formatDataBR(dataInicio)} a ${formatDataBR(dataFim)}`,
        )
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao buscar jogos'
      setErroBuscaJogos(msg)
    } finally {
      setBuscandoJogos(false)
    }
  }

  // Admin: Alternar pré-seleção de jogo antes de publicar a enquete
  const togglePreSelecaoJogo = (jogoId: string) => {
    setJogosPreSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(jogoId)) next.delete(jogoId)
      else next.add(jogoId)
      return next
    })
  }

  // Admin: Publicar Nova Enquete
  const handlePublicarEnquete = async () => {
    if (!tituloEnquete.trim()) {
      toast({
        title: 'Título obrigatório',
        description: 'Dê um nome ou rodada para a nova enquete.',
        variant: 'destructive',
      })
      return
    }

    const jogosParaSalvar = jogosEncontrados.filter((j) => jogosPreSelecionados.has(j.id))
    if (jogosParaSalvar.length === 0) {
      toast({
        title: 'Selecione ao menos 1 jogo',
        description: 'Marque as partidas que estarão disponíveis para votação.',
        variant: 'destructive',
      })
      return
    }

    setPublicandoEnquete(true)
    try {
      const nova = await criarEnquete({
        titulo: tituloEnquete.trim(),
        descricao: descricaoEnquete.trim(),
        dataInicio,
        dataFim,
        jogos: jogosParaSalvar,
        limiteVotos: 8,
      })

      toast({
        title: 'Enquete publicada com sucesso!',
        description: `Votação aberta para o grupo com ${jogosParaSalvar.length} confrontos.`,
      })

      setDialogNovaEnqueteOpen(false)
      setJogosEncontrados([])
      setJogosPreSelecionados(new Set())
      setTituloEnquete('')
      setDescricaoEnquete('')

      await carregarListaEnquetes(false)
      setEnqueteAtivaId(nova.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao publicar enquete.'
      toast({
        title: 'Erro ao criar enquete',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setPublicandoEnquete(false)
    }
  }

  // Admin: Alternar seleção manual do Admin no Ranking/Apurador
  const handleToggleAdminSelecao = async (jogo: JogoComVotos) => {
    if (!isAdmin) return
    const novoStatus = !jogo.selecionado_admin
    try {
      await toggleAdminSelecaoJogo(jogo.id, novoStatus)
      setJogosEnquete((prev) =>
        prev.map((j) => (j.id === jogo.id ? { ...j, selecionado_admin: novoStatus } : j)),
      )
      toast({
        title: novoStatus ? 'Jogo selecionado para a rodada' : 'Jogo desselecionado',
        description: `${jogo.time_a} x ${jogo.time_b} ${novoStatus ? 'incluído na seleção final' : 'removido da seleção final'}.`,
      })
    } catch (err) {
      toast({
        title: 'Erro ao atualizar seleção',
        description: 'Não foi possível salvar o ajuste.',
        variant: 'destructive',
      })
    }
  }

  // Admin: Cadastrar selecionados na Copa Coni
  const handleCadastrarNaCopaConi = async () => {
    if (!enqueteAtiva) return
    if (jogosAprovadosParaConi.length === 0) {
      toast({
        title: 'Nenhum jogo selecionado',
        description: 'Selecione manualmente ou aguarde votos nos confrontos.',
        variant: 'destructive',
      })
      return
    }

    setCadastrandoConi(true)
    try {
      const res = await cadastrarJogosAprovadosNaCopaConi(enqueteAtiva.id, jogosAprovadosParaConi)
      toast({
        title: 'Jogos cadastrados na Copa Coni!',
        description: `${res.cadastrados} partida(s) inserida(s) automaticamente no bolão ${res.bolaoNome} sem digitação manual.`,
      })
      setConfirmCadastrarOpen(false)
      await carregarDetalhesEnquete(enqueteAtiva.id, false)
      await carregarListaEnquetes(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao cadastrar partidas'
      toast({
        title: 'Erro no cadastro',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setCadastrandoConi(false)
    }
  }

  // Admin: Alternar status da enquete (Encerrar / Reabrir)
  const handleMudarStatusEnquete = async (novoStatus: 'aberta' | 'encerrada') => {
    if (!enqueteAtiva) return
    try {
      await atualizarStatusEnquete(enqueteAtiva.id, novoStatus)
      setEnqueteAtiva((prev) => (prev ? { ...prev, status: novoStatus } : null))
      toast({
        title: novoStatus === 'encerrada' ? 'Votação encerrada!' : 'Votação reaberta!',
        description:
          novoStatus === 'encerrada'
            ? 'Os participantes não podem mais alterar votos.'
            : 'Os participantes podem votar normalmente.',
      })
      await carregarListaEnquetes(false)
    } catch (err) {
      toast({
        title: 'Erro ao alterar status',
        description: 'Tente novamente.',
        variant: 'destructive',
      })
    }
  }

  // Admin: Excluir enquete
  const handleExcluirEnquete = async () => {
    if (!enqueteAtiva) return
    setExcluindoEnquete(true)
    try {
      await excluirEnquete(enqueteAtiva.id)
      toast({
        title: 'Enquete excluída',
        description: 'A enquete e seus votos foram removidos com sucesso.',
      })
      setDialogExcluirOpen(false)
      await carregarListaEnquetes(true)
    } catch (err) {
      toast({
        title: 'Erro ao excluir enquete',
        description: 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setExcluindoEnquete(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Vote className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                  Enquetes da Copa Coni
                </h1>
                <Badge
                  variant="secondary"
                  className="border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800"
                >
                  Jogos da Rodada
                </Badge>
              </div>
              <p className="text-xs text-[#64748B]">
                Votação colaborativa do grupo para escolher as partidas aleatórias que entrarão na
                rodada.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Enquete */}
          {enquetes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="select-enquete" className="text-xs font-semibold text-slate-500">
                Enquete:
              </Label>
              <select
                id="select-enquete"
                value={enqueteAtivaId}
                onChange={(e) => setEnqueteAtivaId(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-xs focus:border-emerald-500 focus:outline-none"
              >
                {enquetes.map((enq) => (
                  <option key={enq.id} value={enq.id}>
                    {enq.titulo} (
                    {enq.status === 'aberta'
                      ? 'Aberta'
                      : enq.status === 'cadastrada'
                        ? 'Cadastrada'
                        : 'Encerrada'}
                    )
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Botão Admin: Nova Enquete */}
          {isAdmin && (
            <Button
              onClick={() => {
                setDialogNovaEnqueteOpen(true)
                if (jogosEncontrados.length === 0) {
                  handleBuscarJogosIntervalo()
                }
              }}
              size="sm"
              className="bg-amber-600 font-bold text-white shadow-xs hover:bg-amber-700"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Nova Enquete
            </Button>
          )}
        </div>
      </div>

      {/* Trava de votação e Contador Reativo */}
      {enqueteAtiva && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Contador de Votos Pessoais */}
          <Card className="border-emerald-200 bg-linear-to-br from-emerald-50/60 to-white shadow-xs">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  Seus Votos na Enquete
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-emerald-700">{totalMeusVotos}</span>
                  <span className="text-sm font-bold text-slate-500">
                    / {limiteVotos} permitidos
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {limiteAtingido
                    ? 'Limite máximo de 8 votos atingido.'
                    : `Você ainda pode escolher mais ${limiteVotos - totalMeusVotos} jogo(s).`}
                </p>
              </div>
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full text-base font-black shadow-xs ${
                  limiteAtingido ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {totalMeusVotos}/{limiteVotos}
              </div>
            </CardContent>
          </Card>

          {/* Status da Enquete */}
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status da Votação
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      enqueteAtiva.status === 'aberta'
                        ? 'bg-emerald-100 text-emerald-800'
                        : enqueteAtiva.status === 'cadastrada'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        enqueteAtiva.status === 'aberta'
                          ? 'animate-pulse bg-emerald-500'
                          : enqueteAtiva.status === 'cadastrada'
                            ? 'bg-indigo-500'
                            : 'bg-slate-400'
                      }`}
                    />
                    {enqueteAtiva.status === 'aberta'
                      ? 'Votação Aberta'
                      : enqueteAtiva.status === 'cadastrada'
                        ? 'Jogos Cadastrados na Copa Coni'
                        : 'Votação Encerrada'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  Período dos jogos: {formatDataBR(enqueteAtiva.data_inicio)} até{' '}
                  {formatDataBR(enqueteAtiva.data_fim)}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <Calendar className="h-6 w-6 text-slate-600" />
              </div>
            </CardContent>
          </Card>

          {/* Resumo do Apurador / Seleção */}
          <Card className="border-indigo-200 bg-linear-to-br from-indigo-50/60 to-white shadow-xs">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
                  Apurador da Rodada
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-indigo-700">
                    {jogosAprovadosParaConi.length}
                  </span>
                  <span className="text-sm font-bold text-slate-600">partidas selecionadas</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {isAdmin
                    ? 'Ajuste os checkboxes no ranking e envie para a Copa Coni.'
                    : 'Os 4 mais votados serão cadastrados pelo Admin.'}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xs">
                <Trophy className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Caso não haja enquetes cadastradas */}
      {!loading && enquetes.length === 0 && (
        <Card className="border-dashed border-slate-300 bg-white p-12 text-center">
          <Vote className="mx-auto h-12 w-12 text-slate-400" />
          <h3 className="mt-4 text-base font-bold text-slate-900">
            Nenhuma enquete cadastrada no momento
          </h3>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-600">
            O Administrador Douglas pode criar uma nova enquete selecionando as datas para buscar
            automaticamente os jogos das principais competições.
          </p>
          {isAdmin && (
            <Button
              onClick={() => {
                setDialogNovaEnqueteOpen(true)
                handleBuscarJogosIntervalo()
              }}
              className="mt-5 bg-amber-600 font-bold text-white hover:bg-amber-700"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Criar Primeira Enquete
            </Button>
          )}
        </Card>
      )}

      {/* Conteúdo com Abas: 1. Votação dos Participantes | 2. Apurador e Decisão Admin */}
      {enqueteAtiva && (
        <Tabs defaultValue="votacao" className="w-full">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <TabsList className="bg-slate-100 p-1">
              <TabsTrigger value="votacao" className="text-xs font-bold">
                <CheckSquare className="mr-1.5 h-4 w-4" />
                Votação dos Participantes ({jogosEnquete.length} jogos)
              </TabsTrigger>
              <TabsTrigger value="apurador" className="text-xs font-bold">
                <Trophy className="mr-1.5 h-4 w-4 text-amber-500" />
                Apurador & Ranking
              </TabsTrigger>
            </TabsList>

            {/* Ações de Administração da Enquete */}
            {isAdmin && (
              <div className="flex items-center gap-2">
                {enqueteAtiva.status === 'aberta' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMudarStatusEnquete('encerrada')}
                    className="h-8 border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Encerrar Votação
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMudarStatusEnquete('aberta')}
                    className="h-8 border-emerald-300 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    Reabrir Votação
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogExcluirOpen(true)}
                  className="h-8 border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  title="Excluir Enquete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* ABA 1: Votação dos Participantes */}
          <TabsContent value="votacao" className="mt-4 space-y-4">
            {/* Filtros rápidos da lista de votação */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500">Filtrar:</span>
                <Button
                  variant={filtroCategoria === 'todos' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('todos')}
                  className={`h-7 px-2.5 text-xs ${
                    filtroCategoria === 'todos'
                      ? 'bg-[#0F2A43] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos ({jogosEnquete.length})
                </Button>
                <Button
                  variant={filtroCategoria === 'brasileirao' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('brasileirao')}
                  className={`h-7 px-2.5 text-xs ${
                    filtroCategoria === 'brasileirao'
                      ? 'bg-[#0F2A43] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Brasileirão Série A
                </Button>
                <Button
                  variant={filtroCategoria === 'champions' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('champions')}
                  className={`h-7 px-2.5 text-xs ${
                    filtroCategoria === 'champions'
                      ? 'bg-[#0F2A43] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Champions League
                </Button>
                <Button
                  variant={filtroCategoria === 'europa' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('europa')}
                  className={`h-7 px-2.5 text-xs ${
                    filtroCategoria === 'europa'
                      ? 'bg-[#0F2A43] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Grandes da Europa
                </Button>
                <Button
                  variant={filtroCategoria === 'meus-votos' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('meus-votos')}
                  className={`h-7 px-2.5 text-xs ${
                    filtroCategoria === 'meus-votos'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  Meus Votos ({totalMeusVotos}/8)
                </Button>
              </div>

              <div className="text-xs font-semibold text-slate-500">
                Mostrando {jogosFiltradosVotacao.length} jogo(s)
              </div>
            </div>

            {/* Grade de Confrontos para Votação */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jogosFiltradosVotacao.map((jogo) => {
                const votado = meusVotosIds.has(jogo.id)
                const isTop4 = top4JogosIds.has(jogo.id)
                const isBlocked = !votado && limiteAtingido

                return (
                  <Card
                    key={jogo.id}
                    onClick={() => {
                      if (enqueteAtiva.status === 'aberta' && !isBlocked) {
                        handleToggleVoto(jogo.id)
                      }
                    }}
                    className={`relative cursor-pointer transition-all duration-200 hover:shadow-md ${
                      votado
                        ? 'border-2 border-emerald-500 bg-emerald-50/40 shadow-xs'
                        : isBlocked
                          ? 'border-slate-200 bg-slate-50/70 opacity-60 cursor-not-allowed'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Badge de Top 4 Votados */}
                    {isTop4 && (
                      <div className="absolute -top-2.5 right-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase text-white shadow-xs">
                          <Flame className="h-3 w-3" />
                          Top 4
                        </span>
                      </div>
                    )}

                    <CardContent className="p-4">
                      {/* Topo do Card: Campeonato e Data */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <span className="line-clamp-1 text-[11px] font-bold text-slate-600">
                          {jogo.campeonato || 'Competição'}
                        </span>
                        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          <span>{formatDataBR(jogo.data)}</span>
                          <Clock className="ml-1 h-3 w-3 text-slate-400" />
                          <span>{formatHoraBR(jogo.horario || '16:00')}</span>
                        </div>
                      </div>

                      {/* Confronto */}
                      <div className="my-3 flex items-center justify-between gap-2">
                        {/* Time A */}
                        <div className="flex flex-1 items-center gap-2">
                          {jogo.logo_casa ? (
                            <img
                              src={jogo.logo_casa}
                              alt={jogo.time_a}
                              className="h-7 w-7 object-contain"
                              onError={(e) => {
                                ;(e.target as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-700">
                              {jogo.time_a.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs font-bold text-slate-800 line-clamp-1">
                            {jogo.time_a}
                          </span>
                        </div>

                        {/* Versus */}
                        <div className="px-1 text-[11px] font-black text-slate-400">x</div>

                        {/* Time B */}
                        <div className="flex flex-1 items-center justify-end gap-2 text-right">
                          <span className="text-xs font-bold text-slate-800 line-clamp-1">
                            {jogo.time_b}
                          </span>
                          {jogo.logo_visitante ? (
                            <img
                              src={jogo.logo_visitante}
                              alt={jogo.time_b}
                              className="h-7 w-7 object-contain"
                              onError={(e) => {
                                ;(e.target as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-700">
                              {jogo.time_b.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rodapé do Card: Checkbox e Contagem de Votos */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        {/* Indicador de Seleção / Checkbox */}
                        <button
                          type="button"
                          disabled={enqueteAtiva.status !== 'aberta' || isBlocked}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleVoto(jogo.id)
                          }}
                          className={`flex items-center gap-1.5 text-xs font-bold transition ${
                            votado
                              ? 'text-emerald-700 hover:text-emerald-800'
                              : isBlocked
                                ? 'text-slate-400 cursor-not-allowed'
                                : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {votado ? (
                            <CheckSquare className="h-5 w-5 text-emerald-600 fill-emerald-100" />
                          ) : (
                            <Square className="h-5 w-5 text-slate-400" />
                          )}
                          <span>{votado ? 'Voto selecionado' : 'Votar neste jogo'}</span>
                        </button>

                        {/* Contador de votos total neste jogo */}
                        <div
                          className="flex items-center gap-1 text-xs font-bold text-slate-700"
                          title={
                            jogo.votantes.length > 0
                              ? `Votado por: ${jogo.votantes.join(', ')}`
                              : 'Nenhum voto ainda'
                          }
                        >
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            {jogo.totalVotos} {jogo.totalVotos === 1 ? 'voto' : 'votos'}
                          </span>
                        </div>
                      </div>

                      {/* Votantes destacados */}
                      {jogo.votantes.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5 text-[10px] text-slate-500">
                          <span className="font-semibold text-slate-600">Votos:</span>
                          {jogo.votantes.map((v, idx) => (
                            <span
                              key={idx}
                              className={`rounded px-1.5 py-0.2 font-medium ${
                                v === participantName
                                  ? 'bg-emerald-100 text-emerald-800 font-bold'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>

          {/* ABA 2: Apurador e Decisão do Admin */}
          <TabsContent value="apurador" className="mt-4 space-y-4">
            {/* Painel do Apurador e Ação de Cadastro na Copa Coni */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/60 via-white to-amber-50/40 p-4 shadow-xs sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                    <Trophy className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      Painel Apurador — Decisão Final da Rodada (Copa Coni)
                    </h3>
                    <p className="text-xs text-[#64748B]">
                      {isAdmin
                        ? 'Você tem o controle final para selecionar os confrontos exatos da rodada. Marque as caixas de seleção abaixo e confirme o cadastro automático.'
                        : 'Ranking dos jogos mais votados pelos participantes do bolão em tempo real.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão Admin: Cadastrar Selecionados na Copa Coni */}
              {isAdmin && (
                <Button
                  onClick={() => setConfirmCadastrarOpen(true)}
                  disabled={jogosAprovadosParaConi.length === 0 || cadastrandoConi}
                  className="bg-emerald-600 font-bold text-white shadow-xs hover:bg-emerald-700"
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  Cadastrar Selecionados na Copa Coni ({jogosAprovadosParaConi.length})
                </Button>
              )}
            </div>

            {/* Tabela de Ranking dos Jogos Mais Votados */}
            <Card className="border-slate-200 bg-white shadow-xs">
              <CardHeader className="border-b border-slate-100 py-3.5">
                <CardTitle className="text-sm font-bold text-[#0F172A]">
                  Classificação Geral dos Votos
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-100">
                  {rankingJogos.map((jogo, index) => {
                    const isTop4 = index < 4 && jogo.totalVotos > 0
                    const isSelectedByAdmin = Boolean(jogo.selecionado_admin)
                    const isCadastradoNoBolao = Boolean(jogo.cadastrado_bolao)

                    return (
                      <div
                        key={jogo.id}
                        className={`flex flex-col justify-between gap-3 p-4 transition sm:flex-row sm:items-center ${
                          isSelectedByAdmin
                            ? 'bg-amber-50/60'
                            : isTop4
                              ? 'bg-emerald-50/40'
                              : 'hover:bg-slate-50/80'
                        }`}
                      >
                        {/* Posição e Confronto */}
                        <div className="flex items-center gap-3">
                          {/* Posição */}
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black shadow-xs ${
                              index === 0 && jogo.totalVotos > 0
                                ? 'bg-amber-400 text-amber-950'
                                : index === 1 && jogo.totalVotos > 0
                                  ? 'bg-slate-300 text-slate-800'
                                  : index === 2 && jogo.totalVotos > 0
                                    ? 'bg-amber-700 text-white'
                                    : isTop4
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {index + 1}º
                          </div>

                          {/* Times e Detalhes */}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">
                                {jogo.time_a} x {jogo.time_b}
                              </span>

                              {isTop4 && (
                                <Badge className="border-none bg-amber-500 text-[10px] font-black uppercase text-white">
                                  Top 4
                                </Badge>
                              )}

                              {isSelectedByAdmin && (
                                <Badge className="border border-amber-300 bg-amber-100 text-[10px] font-bold text-amber-900">
                                  Aprovado pelo Admin
                                </Badge>
                              )}

                              {isCadastradoNoBolao && (
                                <Badge className="border border-emerald-300 bg-emerald-100 text-[10px] font-bold text-emerald-900">
                                  Cadastrado na Copa Coni
                                </Badge>
                              )}
                            </div>

                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{jogo.campeonato}</span>
                              <span>•</span>
                              <span>
                                {formatDataBR(jogo.data)} às {formatHoraBR(jogo.horario || '16:00')}
                              </span>
                              {jogo.votantes.length > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-600">
                                    Votantes:{' '}
                                    <strong className="text-slate-800">
                                      {jogo.votantes.join(', ')}
                                    </strong>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Placar de Votos e Controle Admin */}
                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                          {/* Badge de Votos */}
                          <div className="flex flex-col items-center">
                            <span className="text-lg font-black text-[#0F2A43]">
                              {jogo.totalVotos}
                            </span>
                            <span className="text-[10px] font-semibold uppercase text-slate-500">
                              {jogo.totalVotos === 1 ? 'voto' : 'votos'}
                            </span>
                          </div>

                          {/* Controle Final do Admin: Checkbox para Ajustar/Confirmar Partida */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleToggleAdminSelecao(jogo)}
                              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition shadow-xs ${
                                isSelectedByAdmin
                                  ? 'border-amber-400 bg-amber-500 text-white hover:bg-amber-600'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {isSelectedByAdmin ? (
                                <CheckSquare className="h-4 w-4" />
                              ) : (
                                <Square className="h-4 w-4 text-slate-400" />
                              )}
                              <span>
                                {isSelectedByAdmin ? 'Confirmado p/ Rodada' : 'Confirmar p/ Rodada'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* DIALOG ADMIN: Criar Nova Enquete por Intervalo de Datas */}
      <Dialog open={dialogNovaEnqueteOpen} onOpenChange={setDialogNovaEnqueteOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
              <Shield className="h-5 w-5 text-amber-600" />
              Criar Nova Enquete — Copa Coni
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Defina o período dos confrontos (padrão: hoje até a próxima segunda-feira) e busque
              automaticamente as partidas nas APIs integradas (API-Football, Football-Data.org e
              TheSportsDB).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Seletores de Data Inicial e Data Final */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="data-inicio" className="text-xs font-bold text-slate-700">
                  Data Inicial:
                </Label>
                <Input
                  id="data-inicio"
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="data-fim" className="text-xs font-bold text-slate-700">
                  Data Final (padrão: próxima segunda):
                </Label>
                <Input
                  id="data-fim"
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Botão Buscar Jogos */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600">
                Filtra automaticamente: <strong>Série A do Brasileirão</strong>,{' '}
                <strong>Champions League</strong> e <strong>Grandes da Europa</strong>.
              </div>
              <Button
                type="button"
                onClick={handleBuscarJogosIntervalo}
                disabled={buscandoJogos}
                size="sm"
                className="bg-[#0F2A43] text-xs font-bold text-white hover:bg-[#1B3A5C]"
              >
                {buscandoJogos ? (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Buscar Jogos
              </Button>
            </div>

            {/* Aviso de Erro na Busca */}
            {erroBuscaJogos && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>{erroBuscaJogos}</span>
              </div>
            )}

            {/* Campos de Título e Descrição da Enquete */}
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="titulo-enquete" className="text-xs font-bold text-slate-700">
                  Título da Enquete:
                </Label>
                <Input
                  id="titulo-enquete"
                  placeholder="Ex.: Enquete Copa Coni — Rodada de Fim de Semana"
                  value={tituloEnquete}
                  onChange={(e) => setTituloEnquete(e.target.value)}
                  className="h-9 text-xs font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="desc-enquete" className="text-xs font-semibold text-slate-700">
                  Observações / Instruções (Opcional):
                </Label>
                <Input
                  id="desc-enquete"
                  placeholder="Ex.: Escolha até 8 jogos. Os 4 mais votados irão para a Copa Coni."
                  value={descricaoEnquete}
                  onChange={(e) => setDescricaoEnquete(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Lista dos Jogos Encontrados para Pré-Seleção */}
            {jogosEncontrados.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Jogos Encontrados ({jogosEncontrados.length} partidas no período):
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setJogosPreSelecionados(new Set(jogosEncontrados.map((j) => j.id)))
                      }
                      className="text-[11px] font-bold text-emerald-600 hover:underline"
                    >
                      Selecionar Todos
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setJogosPreSelecionados(new Set())}
                      className="text-[11px] font-bold text-slate-500 hover:underline"
                    >
                      Desmarcar Todos
                    </button>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {jogosEncontrados.map((j) => {
                    const sel = jogosPreSelecionados.has(j.id)
                    return (
                      <div
                        key={j.id}
                        onClick={() => togglePreSelecaoJogo(j.id)}
                        className={`flex cursor-pointer items-center justify-between p-2.5 text-xs transition ${
                          sel ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {sel ? (
                            <CheckSquare className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-300" />
                          )}
                          <span className="font-bold text-slate-800">
                            {j.time_a} x {j.time_b}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-medium">{j.campeonato}</span>
                          <span>•</span>
                          <span>
                            {formatDataBR(j.data)} {formatHoraBR(j.horario)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogNovaEnqueteOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handlePublicarEnquete}
              disabled={publicandoEnquete || jogosPreSelecionados.size === 0}
              size="sm"
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {publicandoEnquete ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Publicar Enquete ({jogosPreSelecionados.size} jogos)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIRMAÇÃO DE CADASTRO NA COPA CONI */}
      <Dialog open={confirmCadastrarOpen} onOpenChange={setConfirmCadastrarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Trophy className="h-5 w-5 text-amber-500" />
              Cadastrar Jogos na Copa Coni
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Você está prestes a incluir automaticamente{' '}
              <strong>{jogosAprovadosParaConi.length} partida(s)</strong> no bolão{' '}
              <strong>Copa Coni</strong> para a rodada de palpites:
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 p-2">
            {jogosAprovadosParaConi.map((j) => (
              <div key={j.id} className="py-1.5 text-xs">
                <span className="font-bold text-slate-800">
                  {j.time_a} x {j.time_b}
                </span>{' '}
                <span className="text-slate-500">
                  ({j.campeonato} — {formatDataBR(j.data)} {formatHoraBR(j.horario || '16:00')})
                </span>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmCadastrarOpen(false)}
              disabled={cadastrandoConi}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCadastrarNaCopaConi}
              disabled={cadastrandoConi}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {cadastrandoConi ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Confirmar e Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIRMAÇÃO DE EXCLUSÃO DE ENQUETE */}
      <Dialog open={dialogExcluirOpen} onOpenChange={setDialogExcluirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-700">
              <Trash2 className="h-5 w-5" />
              Excluir Enquete
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Tem certeza que deseja excluir a enquete <strong>"{enqueteAtiva?.titulo}"</strong>?
              Todos os votos e confrontos desta enquete serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogExcluirOpen(false)}
              disabled={excluindoEnquete}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleExcluirEnquete}
              disabled={excluindoEnquete}
              className="bg-rose-600 font-bold text-white hover:bg-rose-700"
            >
              {excluindoEnquete ? 'Excluindo...' : 'Sim, Excluir Enquete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
