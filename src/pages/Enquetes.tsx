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
  Pencil,
  ChevronRight,
  Sparkles,
  Info,
  Radio,
  ExternalLink,
  ChevronDown,
  ChevronUp,
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
import {
  formatDataBR,
  formatHoraBR,
  formatDataHoraSaoPaulo,
  satisfiesEnqueteMinTimeMargin,
} from '@/lib/dateUtils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type EnqueteModel,
  type JogoComVotos,
  type JogoBuscado,
  getDefaultDatasIntervalo,
  buscarJogosIntervalo,
  buscarEscudoTime,
  criarEnquete,
  listarEnquetes,
  obterDadosEnquete,
  toggleVotoJogo,
  toggleAdminSelecaoJogo,
  atualizarStatusEnquete,
  cadastrarJogosAprovadosNaCopaConi,
  excluirEnquete,
  adicionarJogoManualNaEnquete,
  editarJogoEnquete,
  excluirJogoEnquete,
  readListaEnquetesCache,
  readEnqueteDetalhesCache,
} from '@/services/enquetes'

export default function Enquetes() {
  const { user, isAdmin, participantName } = useAuth()
  const { toast } = useToast()

  // Inicialização instantânea a partir do cache (dois níveis)
  const initialListaCached = useMemo(() => readListaEnquetesCache() || [], [])
  const initialEnqueteId = useMemo(() => {
    if (initialListaCached.length > 0) {
      const aberta = initialListaCached.find((e) => e.status === 'aberta') || initialListaCached[0]
      return aberta.id
    }
    return ''
  }, [initialListaCached])

  // Estados principais
  const [enquetes, setEnquetes] = useState<EnqueteModel[]>(initialListaCached)
  const [enqueteAtivaId, setEnqueteAtivaId] = useState<string>(initialEnqueteId)
  const [enqueteAtiva, setEnqueteAtiva] = useState<EnqueteModel | null>(() => {
    if (initialEnqueteId) {
      const cached = readEnqueteDetalhesCache(initialEnqueteId, user?.id)
      if (cached) return cached.enquete
      return initialListaCached.find((e) => e.id === initialEnqueteId) || null
    }
    return null
  })
  const [jogosEnquete, setJogosEnquete] = useState<JogoComVotos[]>(() => {
    if (initialEnqueteId) {
      const cached = readEnqueteDetalhesCache(initialEnqueteId, user?.id)
      if (cached) return cached.jogos
    }
    return []
  })
  const [meusVotosIds, setMeusVotosIds] = useState<Set<string>>(() => {
    if (initialEnqueteId) {
      const cached = readEnqueteDetalhesCache(initialEnqueteId, user?.id)
      if (cached) return cached.meusVotosIds
    }
    return new Set()
  })
  // Se tínhamos cache inicial para a enquete ativa, não bloqueia a tela!
  const hasInitialCache = Boolean(initialEnqueteId && jogosEnquete.length > 0)
  const [loading, setLoading] = useState(!hasInitialCache)
  const [isSyncing, setIsSyncing] = useState(false)
  const [votandoJogoId, setVotandoJogoId] = useState<string | null>(null)

  // Paginação incremental / Lazy Loading de Cards de Jogos para alta performance de renderização
  const [visibleCount, setVisibleCount] = useState(15)

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

  // Formulário expansível de adição manual de confronto
  const [formManualAberto, setFormManualAberto] = useState(false)
  const [manualTimeA, setManualTimeA] = useState('')
  const [manualTimeB, setManualTimeB] = useState('')
  const [manualLogoCasa, setManualLogoCasa] = useState('')
  const [manualLogoVisitante, setManualLogoVisitante] = useState('')
  const [manualCompeticao, setManualCompeticao] = useState('')
  const [manualData, setManualData] = useState(datasPadrao.dataInicio)
  const [manualHorario, setManualHorario] = useState('16:00')
  const [manualAvisoMargem, setManualAvisoMargem] = useState<string | null>(null)
  const [manualAvisoDuplicado, setManualAvisoDuplicado] = useState<string | null>(null)

  // Modal de adição de jogo manual em enquete ativa (já criada)
  const [dialogAdicionarManualAtivaOpen, setDialogAdicionarManualAtivaOpen] = useState(false)
  const [salvandoJogoAtiva, setSalvandoJogoAtiva] = useState(false)
  const [ativaManualMandante, setAtivaManualMandante] = useState('')
  const [ativaManualVisitante, setAtivaManualVisitante] = useState('')
  const [ativaManualLogoCasa, setAtivaManualLogoCasa] = useState('')
  const [ativaManualLogoVisitante, setAtivaManualLogoVisitante] = useState('')
  const [ativaManualCompeticao, setAtivaManualCompeticao] = useState('')
  const [ativaManualData, setAtivaManualData] = useState('')
  const [ativaManualHorario, setAtivaManualHorario] = useState('16:00')
  const [ativaManualAvisoMargem, setAtivaManualAvisoMargem] = useState<string | null>(null)
  const [ativaManualAvisoDuplicado, setAtivaManualAvisoDuplicado] = useState<string | null>(null)

  // Admin: Modal de Edição de Jogo da Enquete
  const [jogoEmEdicao, setJogoEmEdicao] = useState<JogoComVotos | null>(null)
  const [dialogEditarJogoOpen, setDialogEditarJogoOpen] = useState(false)
  const [editMandante, setEditMandante] = useState('')
  const [editVisitante, setEditVisitante] = useState('')
  const [editLogoCasa, setEditLogoCasa] = useState('')
  const [editLogoVisitante, setEditLogoVisitante] = useState('')
  const [editCompeticao, setEditCompeticao] = useState('')
  const [editData, setEditData] = useState('')
  const [editHorario, setEditHorario] = useState('16:00')
  const [editAvisoMargem, setEditAvisoMargem] = useState<string | null>(null)
  const [salvandoEdicaoJogo, setSalvandoEdicaoJogo] = useState(false)

  // Admin: Modal de Exclusão de Jogo Individual da Enquete
  const [jogoEmExclusao, setJogoEmExclusao] = useState<JogoComVotos | null>(null)
  const [dialogExcluirJogoOpen, setDialogExcluirJogoOpen] = useState(false)
  const [excluindoJogo, setExcluindoJogo] = useState(false)

  // Atualiza data padrão do formulário manual ao alterar dataInicio da busca
  useEffect(() => {
    if (dataInicio) {
      setManualData(dataInicio)
    }
  }, [dataInicio])

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

  // Carrega lista de enquetes com SWR
  const carregarListaEnquetes = useCallback(
    async (selectFirst = true) => {
      // 1. Tenta cache imediato se ainda não tivermos lista
      const cached = readListaEnquetesCache()
      if (cached && cached.length > 0) {
        setEnquetes((prev) => (prev.length === 0 ? cached : prev))
      }

      // Revalidação em background (sem bloquear se já temos dados)
      setIsSyncing(true)
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
        setIsSyncing(false)
      }
    },
    [enqueteAtivaId],
  )

  // Carrega detalhes da enquete selecionada com SWR
  const carregarDetalhesEnquete = useCallback(
    async (enqueteId: string, showSpinner = true) => {
      if (!enqueteId) return

      // 1. Lê do cache local/memória imediatamente
      const cached = readEnqueteDetalhesCache(enqueteId, user?.id)
      if (cached) {
        setEnqueteAtiva(cached.enquete)
        setJogosEnquete(cached.jogos)
        setMeusVotosIds(cached.meusVotosIds)
        setLoading(false) // Dados exibidos instantaneamente!
        setIsSyncing(true)
      } else if (showSpinner) {
        setLoading(true)
      }

      try {
        const dados = await obterDadosEnquete(enqueteId, user?.id)
        setEnqueteAtiva(dados.enquete)

        // Assegura conversão de datas e horários dos jogos para o fuso America/Sao_Paulo (UTC-3)
        const jogosNormalizados = dados.jogos.map((j) => {
          const sp = formatDataHoraSaoPaulo(j.data, j.horario)
          return {
            ...j,
            data: sp.data || j.data,
            horario: sp.horario || j.horario || '16:00',
          }
        })

        setJogosEnquete(jogosNormalizados)
        setMeusVotosIds(dados.meusVotosIds)
      } catch (err) {
        console.error('Erro ao obter detalhes da enquete:', err)
      } finally {
        setLoading(false)
        setIsSyncing(false)
      }
    },
    [user?.id],
  )

  useEffect(() => {
    carregarListaEnquetes(true)
  }, [carregarListaEnquetes])

  useEffect(() => {
    if (enqueteAtivaId) {
      setFiltroCategoria('todos')
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

  // Lista dinâmica de competições presentes nos jogos da enquete ativa, com contagem de jogos
  const competicoesEnquete = useMemo(() => {
    const counts = new Map<string, number>()
    for (const j of jogosEnquete) {
      const nomeComp = (j.campeonato || '').trim() || 'Outros'
      counts.set(nomeComp, (counts.get(nomeComp) || 0) + 1)
    }

    // Ordena por contagem decrescente e em caso de empate, alfabeticamente
    return Array.from(counts.entries())
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => {
        if (b.total !== a.total) {
          return b.total - a.total
        }
        return a.nome.localeCompare(b.nome, 'pt-BR')
      })
  }, [jogosEnquete])

  // Filtro de jogos na lista de votação
  const jogosFiltradosVotacao = useMemo(() => {
    if (filtroCategoria === 'todos') return jogosEnquete
    if (filtroCategoria === 'meus-votos') {
      return jogosEnquete.filter((j) => meusVotosIds.has(j.id))
    }
    // Filtro dinâmico por competição exata
    return jogosEnquete.filter((j) => {
      const nomeComp = (j.campeonato || '').trim() || 'Outros'
      return nomeComp === filtroCategoria
    })
  }, [jogosEnquete, filtroCategoria, meusVotosIds])

  // Reseta paginação de cards quando a categoria de filtro ou enquete ativa mudar
  useEffect(() => {
    setVisibleCount(15)
  }, [filtroCategoria, enqueteAtivaId])

  // Jogos visíveis renderizados incrementalmente no DOM (Lazy Loading)
  const jogosVisiveis = useMemo(() => {
    return jogosFiltradosVotacao.slice(0, visibleCount)
  }, [jogosFiltradosVotacao, visibleCount])

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

      // Regra 1: Garantir que todas as partidas estejam expressas no fuso America/Sao_Paulo (UTC-3)
      // Regra 2: Filtro de margem mínima de +3 horas a partir do momento da busca/criação
      const nowMs = Date.now()
      const normalizedFixtures: JogoBuscado[] = fixtures
        .map((f) => {
          const spConverted = formatDataHoraSaoPaulo(f.data, f.horario)
          return {
            ...f,
            data: spConverted.data || f.data,
            horario: spConverted.horario || f.horario || '16:00',
            origem: 'api' as const,
          }
        })
        .filter((f) => satisfiesEnqueteMinTimeMargin(f.data, f.horario, nowMs, 3))

      // Preserva jogos manuais já inseridos pelo admin se ele fizer uma nova busca
      setJogosEncontrados((prev) => {
        const manuaisExistentes = prev.filter((j) => j.origem === 'manual')
        return [...manuaisExistentes, ...normalizedFixtures]
      })

      // Mantém selecionados os manuais e seleciona também os novos jogos da API
      setJogosPreSelecionados((prev) => {
        const next = new Set(prev)
        normalizedFixtures.forEach((f) => next.add(f.id))
        return next
      })
      if (normalizedFixtures.length === 0) {
        setErroBuscaJogos(
          'Nenhum confronto das competições principais encontrado para o período informado (partidas com menos de 3 horas de antecedência foram desconsideradas).',
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

  // Admin: Adicionar jogo manualmente no modal de criação
  const handleAdicionarJogoManual = async () => {
    const timeA = manualTimeA.trim()
    const timeB = manualTimeB.trim()
    const competicao = manualCompeticao.trim() || 'Amistoso / Outros'
    const dataJogo = manualData.trim()
    const horarioJogo = manualHorario.trim() || '16:00'
    const customLogoA = manualLogoCasa.trim()
    const customLogoB = manualLogoVisitante.trim()

    // Validações obrigatórias
    if (!timeA || !timeB) {
      toast({
        title: 'Campos incompletos',
        description: 'Informe tanto o time mandante quanto o time visitante.',
        variant: 'destructive',
      })
      return
    }

    if (timeA.toLowerCase() === timeB.toLowerCase()) {
      toast({
        title: 'Equipes idênticas',
        description: 'O time mandante e o time visitante devem ser diferentes entre si.',
        variant: 'destructive',
      })
      return
    }

    if (!dataJogo) {
      toast({
        title: 'Data obrigatória',
        description: 'Selecione a data da partida no formato YYYY-MM-DD.',
        variant: 'destructive',
      })
      return
    }

    // Normaliza para fuso de Brasília e verifica margem de 3 horas
    const spConverted = formatDataHoraSaoPaulo(dataJogo, horarioJogo)
    const dataFinal = spConverted.data || dataJogo
    const horaFinal = spConverted.horario || horarioJogo

    const nowMs = Date.now()
    const respeitaMargem = satisfiesEnqueteMinTimeMargin(dataFinal, horaFinal, nowMs, 3)
    if (!respeitaMargem) {
      setManualAvisoMargem(
        'Atenção: Este confronto está agendado para menos de 3 horas a partir de agora (ou no passado). Você pode adicioná-lo manualmente se desejar manter.',
      )
    } else {
      setManualAvisoMargem(null)
    }

    // Verifica se já existe jogo semelhante na mesma data (duplicação potencial)
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
    const pairNew = [norm(timeA), norm(timeB)].sort().join('___')
    const duplicado = jogosEncontrados.some((j) => {
      const pairExisting = [norm(j.time_a), norm(j.time_b)].sort().join('___')
      return j.data === dataFinal && pairExisting === pairNew
    })

    if (duplicado) {
      setManualAvisoDuplicado(
        `Aviso: Já existe uma partida cadastrada entre ${timeA} e ${timeB} na data ${formatDataBR(dataFinal)}. O confronto foi inserido mantendo a distinção.`,
      )
    } else {
      setManualAvisoDuplicado(null)
    }

    // Resolução de escudos: URL digitada pelo Admin > API automática por nome de time > vazio
    let logoAFinal = customLogoA
    let logoBFinal = customLogoB

    const buscamPromessas: Promise<void>[] = []
    if (!logoAFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeA)
          .then((badge) => {
            if (badge) logoAFinal = badge
          })
          .catch(() => {}),
      )
    }
    if (!logoBFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeB)
          .then((badge) => {
            if (badge) logoBFinal = badge
          })
          .catch(() => {}),
      )
    }

    if (buscamPromessas.length > 0) {
      await Promise.all(buscamPromessas)
    }

    const regiaoCalculada =
      competicao.toLowerCase().includes('brasileir') || competicao.toLowerCase().includes('copa')
        ? 'Brasileirão & Copas'
        : 'Futebol Europeu'

    const novoJogoManual: JogoBuscado = {
      id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      time_a: timeA,
      time_b: timeB,
      logo_casa: logoAFinal,
      logo_visitante: logoBFinal,
      campeonato: competicao,
      prioridade: 5,
      regiao: regiaoCalculada,
      data: dataFinal,
      horario: horaFinal,
      origem: 'manual',
    }

    // Adiciona na lista geral de jogos da enquete em criação e já pré-seleciona
    setJogosEncontrados((prev) => [novoJogoManual, ...prev])
    setJogosPreSelecionados((prev) => new Set(prev).add(novoJogoManual.id))

    // Se o título ainda não foi preenchido, sugere
    if (!tituloEnquete) {
      setTituloEnquete(`Enquete Copa Coni — ${formatDataBR(dataInicio)} a ${formatDataBR(dataFim)}`)
    }

    toast({
      title: 'Jogo manual adicionado!',
      description: `${timeA} x ${timeB} incluído na lista para publicação.`,
    })

    // Limpa campos do time mas mantém data e competição se admin quiser cadastrar mais jogos
    setManualTimeA('')
    setManualTimeB('')
    setManualLogoCasa('')
    setManualLogoVisitante('')
  }

  // Admin: Remover jogo da lista de criação (seja manual ou api)
  const handleRemoverJogoCriacao = (jogoId: string) => {
    setJogosEncontrados((prev) => prev.filter((j) => j.id !== jogoId))
    setJogosPreSelecionados((prev) => {
      const next = new Set(prev)
      next.delete(jogoId)
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
      setFormManualAberto(false)
      setManualTimeA('')
      setManualTimeB('')
      setManualCompeticao('')
      setManualAvisoMargem(null)
      setManualAvisoDuplicado(null)

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

  // Admin: Abrir modal de inserção de jogo manual na enquete ativa
  const handleAbrirModalAdicionarManualAtiva = () => {
    setAtivaManualMandante('')
    setAtivaManualVisitante('')
    setAtivaManualLogoCasa('')
    setAtivaManualLogoVisitante('')
    setAtivaManualCompeticao('')
    setAtivaManualData(enqueteAtiva?.data_inicio || datasPadrao.dataInicio)
    setAtivaManualHorario('16:00')
    setAtivaManualAvisoMargem(null)
    setAtivaManualAvisoDuplicado(null)
    setDialogAdicionarManualAtivaOpen(true)
  }

  // Admin: Salvar jogo manual na enquete ativa
  const handleSalvarJogoManualAtiva = async () => {
    if (!enqueteAtiva) return

    const timeA = ativaManualMandante.trim()
    const timeB = ativaManualVisitante.trim()
    const competicao = ativaManualCompeticao.trim() || 'Amistoso / Outros'
    const dataJogo = ativaManualData.trim()
    const horarioJogo = ativaManualHorario.trim() || '16:00'
    const customLogoA = ativaManualLogoCasa.trim()
    const customLogoB = ativaManualLogoVisitante.trim()

    // Validações obrigatórias
    if (!timeA || !timeB) {
      toast({
        title: 'Campos incompletos',
        description: 'Informe tanto o time mandante quanto o time visitante.',
        variant: 'destructive',
      })
      return
    }

    if (timeA.toLowerCase() === timeB.toLowerCase()) {
      toast({
        title: 'Equipes idênticas',
        description: 'O time mandante e o time visitante devem ser diferentes entre si.',
        variant: 'destructive',
      })
      return
    }

    if (!dataJogo) {
      toast({
        title: 'Data obrigatória',
        description: 'Selecione a data da partida no formato YYYY-MM-DD.',
        variant: 'destructive',
      })
      return
    }

    // Normaliza para fuso de Brasília e verifica margem de 3 horas
    const spConverted = formatDataHoraSaoPaulo(dataJogo, horarioJogo)
    const dataFinal = spConverted.data || dataJogo
    const horaFinal = spConverted.horario || horarioJogo

    const nowMs = Date.now()
    const respeitaMargem = satisfiesEnqueteMinTimeMargin(dataFinal, horaFinal, nowMs, 3)
    if (!respeitaMargem) {
      setAtivaManualAvisoMargem(
        'Atenção: Este confronto está agendado para menos de 3 horas a partir de agora (ou no passado). Você pode adicioná-lo manualmente se desejar manter.',
      )
    } else {
      setAtivaManualAvisoMargem(null)
    }

    // Alerta de duplicação potencial com jogos já existentes nesta enquete
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
    const pairNew = [norm(timeA), norm(timeB)].sort().join('___')
    const duplicado = jogosEnquete.some((j) => {
      const pairExisting = [norm(j.time_a), norm(j.time_b)].sort().join('___')
      return j.data === dataFinal && pairExisting === pairNew
    })

    if (duplicado) {
      setAtivaManualAvisoDuplicado(
        `Aviso: Já existe uma partida cadastrada entre ${timeA} e ${timeB} na data ${formatDataBR(dataFinal)}. O confronto foi inserido mantendo a distinção.`,
      )
    } else {
      setAtivaManualAvisoDuplicado(null)
    }

    // Resolução prévia de escudos: URL digitada > busca automática via API
    let logoAFinal = customLogoA
    let logoBFinal = customLogoB

    const buscamPromessas: Promise<void>[] = []
    if (!logoAFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeA)
          .then((badge) => {
            if (badge) logoAFinal = badge
          })
          .catch(() => {}),
      )
    }
    if (!logoBFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeB)
          .then((badge) => {
            if (badge) logoBFinal = badge
          })
          .catch(() => {}),
      )
    }

    if (buscamPromessas.length > 0) {
      await Promise.all(buscamPromessas)
    }

    const regiaoCalculada =
      competicao.toLowerCase().includes('brasileir') || competicao.toLowerCase().includes('copa')
        ? 'Brasileirão & Copas'
        : 'Futebol Europeu'

    setSalvandoJogoAtiva(true)
    try {
      const novoRegistro = await adicionarJogoManualNaEnquete({
        enqueteId: enqueteAtiva.id,
        time_a: timeA,
        time_b: timeB,
        logo_casa: logoAFinal,
        logo_visitante: logoBFinal,
        campeonato: competicao,
        regiao: regiaoCalculada,
        data: dataFinal,
        horario: horaFinal,
      })

      // Normaliza no fuso America/Sao_Paulo (UTC-3)
      const spNovo = formatDataHoraSaoPaulo(novoRegistro.data, novoRegistro.horario)
      const novoJogoComVotos: JogoComVotos = {
        ...novoRegistro,
        logo_casa: novoRegistro.logo_casa || logoAFinal,
        logo_visitante: novoRegistro.logo_visitante || logoBFinal,
        data: spNovo.data || novoRegistro.data,
        horario: spNovo.horario || novoRegistro.horario || '16:00',
        totalVotos: 0,
        votantes: [],
        votadoPorMim: false,
      }

      // Atualiza imediatamente o estado React:
      // Mantém votos já computados intactos e inclui o novo jogo
      setJogosEnquete((prev) => [...prev, novoJogoComVotos])

      toast({
        title: 'Jogo manual adicionado!',
        description: `${timeA} x ${timeB} foi incluído na enquete ativa e já está aberto para votação.`,
      })

      setDialogAdicionarManualAtivaOpen(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar jogo manual.'
      toast({
        title: 'Erro ao adicionar jogo',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setSalvandoJogoAtiva(false)
    }
  }

  // Admin: Abrir modal de edição de confronto
  const handleAbrirModalEditarJogo = (jogo: JogoComVotos, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setJogoEmEdicao(jogo)
    setEditMandante(jogo.time_a)
    setEditVisitante(jogo.time_b)
    setEditLogoCasa(jogo.logo_casa || '')
    setEditLogoVisitante(jogo.logo_visitante || '')
    setEditCompeticao(jogo.campeonato || '')
    setEditData(jogo.data)
    setEditHorario(jogo.horario || '16:00')
    setEditAvisoMargem(null)
    setDialogEditarJogoOpen(true)
  }

  // Admin: Salvar edição de confronto
  const handleSalvarEdicaoJogo = async () => {
    if (!jogoEmEdicao) return

    const timeA = editMandante.trim()
    const timeB = editVisitante.trim()
    const competicao = editCompeticao.trim() || 'Amistoso / Outros'
    const dataJogo = editData.trim()
    const horarioJogo = editHorario.trim() || '16:00'
    const customLogoA = editLogoCasa.trim()
    const customLogoB = editLogoVisitante.trim()

    if (!timeA || !timeB) {
      toast({
        title: 'Campos incompletos',
        description: 'Informe tanto o time mandante quanto o visitante.',
        variant: 'destructive',
      })
      return
    }

    if (timeA.toLowerCase() === timeB.toLowerCase()) {
      toast({
        title: 'Equipes idênticas',
        description: 'O time mandante e o visitante devem ser diferentes entre si.',
        variant: 'destructive',
      })
      return
    }

    if (!dataJogo) {
      toast({
        title: 'Data obrigatória',
        description: 'Selecione a data da partida no formato YYYY-MM-DD.',
        variant: 'destructive',
      })
      return
    }

    // Normaliza para fuso de Brasília e verifica margem de 3 horas
    const spConverted = formatDataHoraSaoPaulo(dataJogo, horarioJogo)
    const dataFinal = spConverted.data || dataJogo
    const horaFinal = spConverted.horario || horarioJogo

    const nowMs = Date.now()
    const respeitaMargem = satisfiesEnqueteMinTimeMargin(dataFinal, horaFinal, nowMs, 3)
    if (!respeitaMargem) {
      setEditAvisoMargem(
        'Atenção: Este confronto está agendado para menos de 3 horas a partir de agora (ou no passado). Você pode salvá-lo manualmente se desejar.',
      )
    } else {
      setEditAvisoMargem(null)
    }

    // Resolução prévia de escudos: se não preenchido manualmente e alterou o time, busca via API
    let logoAFinal = customLogoA
    let logoBFinal = customLogoB

    const buscamPromessas: Promise<void>[] = []
    if (!logoAFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeA)
          .then((badge) => {
            if (badge) logoAFinal = badge
          })
          .catch(() => {}),
      )
    }
    if (!logoBFinal) {
      buscamPromessas.push(
        buscarEscudoTime(timeB)
          .then((badge) => {
            if (badge) logoBFinal = badge
          })
          .catch(() => {}),
      )
    }

    if (buscamPromessas.length > 0) {
      await Promise.all(buscamPromessas)
    }

    const regiaoCalculada =
      competicao.toLowerCase().includes('brasileir') || competicao.toLowerCase().includes('copa')
        ? 'Brasileirão & Copas'
        : 'Futebol Europeu'

    setSalvandoEdicaoJogo(true)
    try {
      const atualizado = await editarJogoEnquete(jogoEmEdicao.id, {
        time_a: timeA,
        time_b: timeB,
        logo_casa: logoAFinal,
        logo_visitante: logoBFinal,
        campeonato: competicao,
        regiao: regiaoCalculada,
        data: dataFinal,
        horario: horaFinal,
      })

      // Atualiza o estado React imediatamente mantendo os votos já computados
      setJogosEnquete((prev) =>
        prev.map((j) => {
          if (j.id === jogoEmEdicao.id) {
            return {
              ...j,
              time_a: atualizado.time_a,
              time_b: atualizado.time_b,
              logo_casa: atualizado.logo_casa || logoAFinal,
              logo_visitante: atualizado.logo_visitante || logoBFinal,
              campeonato: atualizado.campeonato,
              regiao: atualizado.regiao,
              data: dataFinal,
              horario: horaFinal,
            }
          }
          return j
        }),
      )

      toast({
        title: 'Jogo atualizado com sucesso!',
        description: `${timeA} x ${timeB} salvo. Votos computados permanecem intactos.`,
      })

      setDialogEditarJogoOpen(false)
      setJogoEmEdicao(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao atualizar confronto.'
      toast({
        title: 'Erro ao editar jogo',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setSalvandoEdicaoJogo(false)
    }
  }

  // Admin: Abrir confirmação de exclusão de confronto
  const handleAbrirModalExcluirJogo = (jogo: JogoComVotos, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setJogoEmExclusao(jogo)
    setDialogExcluirJogoOpen(true)
  }

  // Admin: Confirmar exclusão de confronto
  const handleConfirmarExcluirJogo = async () => {
    if (!jogoEmExclusao) return
    const idParaExcluir = jogoEmExclusao.id
    const nomeConfronto = `${jogoEmExclusao.time_a} x ${jogoEmExclusao.time_b}`

    setExcluindoJogo(true)
    try {
      await excluirJogoEnquete(idParaExcluir)

      // Atualiza estado React imediatamente
      setJogosEnquete((prev) => prev.filter((j) => j.id !== idParaExcluir))
      setMeusVotosIds((prev) => {
        if (prev.has(idParaExcluir)) {
          const next = new Set(prev)
          next.delete(idParaExcluir)
          return next
        }
        return prev
      })

      // Se o filtro atual era a competição desse jogo e ela não existe mais nos restantes,
      // reseta o filtro para 'todos'
      const compRestantes = new Set(
        jogosEnquete.filter((j) => j.id !== idParaExcluir).map((j) => (j.campeonato || '').trim()),
      )
      if (
        filtroCategoria !== 'todos' &&
        filtroCategoria !== 'meus-votos' &&
        !compRestantes.has(filtroCategoria)
      ) {
        setFiltroCategoria('todos')
      }

      toast({
        title: 'Jogo excluído da enquete',
        description: `${nomeConfronto} removido com sucesso.`,
      })

      setDialogExcluirJogoOpen(false)
      setJogoEmExclusao(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao remover o jogo.'
      toast({
        title: 'Erro ao excluir jogo',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setExcluindoJogo(false)
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
                {isSyncing && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700 animate-pulse">
                    <RefreshCw className="h-3 w-3 animate-spin text-amber-600" />
                    Sincronizando...
                  </span>
                )}
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
              onClick={() => setDialogNovaEnqueteOpen(true)}
              size="sm"
              className="bg-amber-600 font-bold text-white shadow-xs hover:bg-amber-700"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Nova Enquete
            </Button>
          )}
        </div>
      </div>

      {/* Skeleton de Carregamento Instantâneo quando ainda não temos dados */}
      {loading && !enqueteAtiva && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-7 w-20" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-full" />
                </div>
              </Card>
            ))}
          </div>

          <div className="space-y-3">
            <Skeleton className="h-9 w-64 rounded-md" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="border-slate-200 bg-white p-4">
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <div className="my-3 flex items-center justify-between gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-6 w-24" />
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

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
              onClick={() => setDialogNovaEnqueteOpen(true)}
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAbrirModalAdicionarManualAtiva}
                  className="h-8 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700 shadow-xs"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />+ Adicionar Jogo Manual
                </Button>

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
            {/* Filtros rápidos da lista de votação gerados dinamicamente */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500">Filtrar:</span>

                {/* Botão Fixo: Todos */}
                <Button
                  variant={filtroCategoria === 'todos' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('todos')}
                  className={`h-7 px-2.5 text-xs font-medium transition ${
                    filtroCategoria === 'todos'
                      ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos ({jogosEnquete.length})
                </Button>

                {/* Botões Dinâmicos: Um para cada competição presente nos jogos */}
                {competicoesEnquete.map((comp) => {
                  const isSelected = filtroCategoria === comp.nome
                  return (
                    <Button
                      key={comp.nome}
                      variant={isSelected ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setFiltroCategoria(comp.nome)}
                      className={`h-7 px-2.5 text-xs font-medium transition ${
                        isSelected
                          ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {comp.nome} ({comp.total})
                    </Button>
                  )
                })}

                {/* Botão Fixo: Meus Votos com contador de 8 */}
                <Button
                  variant={filtroCategoria === 'meus-votos' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltroCategoria('meus-votos')}
                  className={`h-7 px-2.5 text-xs font-medium transition ${
                    filtroCategoria === 'meus-votos'
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
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

            {/* Mensagem amigável quando nenhum jogo bate com o filtro */}
            {jogosFiltradosVotacao.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
                <Vote className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {filtroCategoria === 'meus-votos'
                    ? 'Você ainda não votou em nenhuma partida nesta enquete.'
                    : 'Nenhum jogo encontrado para o filtro selecionado.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {filtroCategoria === 'meus-votos'
                    ? 'Clique nas partidas abaixo no filtro "Todos" para selecionar até 8 confrontos.'
                    : 'Selecione "Todos" para visualizar todas as partidas disponíveis para votação.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFiltroCategoria('todos')}
                  className="mt-3 text-xs"
                >
                  Ver Todos os Jogos
                </Button>
              </div>
            )}

            {/* Grade de Confrontos para Votação com Lazy Loading / Paginação Incremental */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jogosVisiveis.map((jogo) => {
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
                      {/* Topo do Card: Campeonato, Origem, Data e Botões Admin (Editar/Excluir) */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="truncate text-[11px] font-bold text-slate-600">
                            {jogo.campeonato || 'Competição'}
                          </span>
                          {jogo.origem === 'manual' && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-bold text-amber-700"
                            >
                              Manual
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            <span>{formatDataBR(jogo.data)}</span>
                            <Clock className="ml-1 h-3 w-3 text-slate-400" />
                            <span>{formatHoraBR(jogo.horario || '16:00')}</span>
                          </div>

                          {/* Botões de Ação Admin: Editar e Excluir Jogo */}
                          {isAdmin && (
                            <div className="flex items-center gap-1 border-l border-slate-200 pl-1.5">
                              <button
                                type="button"
                                onClick={(e) => handleAbrirModalEditarJogo(jogo, e)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-600 transition"
                                title="Editar jogo"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleAbrirModalExcluirJogo(jogo, e)}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                                title="Excluir confronto da enquete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Confronto */}
                      <div className="my-3 flex items-center justify-between gap-2">
                        {/* Time A */}
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          {jogo.logo_casa ? (
                            <img
                              src={jogo.logo_casa}
                              alt={jogo.time_a}
                              className="h-7 w-7 object-contain shrink-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget
                                  .nextElementSibling as HTMLElement | null
                                if (fallback) fallback.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div
                            className={`h-7 w-7 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                              jogo.logo_casa ? 'hidden' : 'flex'
                            }`}
                            title={jogo.time_a}
                          >
                            <span className="text-[10px] font-black uppercase text-slate-700">
                              {jogo.time_a.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-slate-800 line-clamp-1">
                            {jogo.time_a}
                          </span>
                        </div>

                        {/* Versus */}
                        <div className="px-1 text-[11px] font-black text-slate-400 shrink-0">x</div>

                        {/* Time B */}
                        <div className="flex flex-1 items-center justify-end gap-2 text-right min-w-0">
                          <span className="text-xs font-bold text-slate-800 line-clamp-1">
                            {jogo.time_b}
                          </span>
                          {jogo.logo_visitante ? (
                            <img
                              src={jogo.logo_visitante}
                              alt={jogo.time_b}
                              className="h-7 w-7 object-contain shrink-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget
                                  .nextElementSibling as HTMLElement | null
                                if (fallback) fallback.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div
                            className={`h-7 w-7 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                              jogo.logo_visitante ? 'hidden' : 'flex'
                            }`}
                            title={jogo.time_b}
                          >
                            <span className="text-[10px] font-black uppercase text-slate-700">
                              {jogo.time_b.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
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

            {/* Botão para carregar mais jogos se houver mais que o visível */}
            {jogosFiltradosVotacao.length > visibleCount && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2 pt-2">
                <p className="text-xs text-slate-500">
                  Exibindo {visibleCount} de {jogosFiltradosVotacao.length} confrontos
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((prev) => prev + 15)}
                  className="border-slate-300 bg-white text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900"
                >
                  <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                  Carregar mais {Math.min(15, jogosFiltradosVotacao.length - visibleCount)} jogos
                </Button>
              </div>
            )}
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
                              {/* Escudo Mandante */}
                              <div className="flex items-center gap-1.5">
                                {jogo.logo_casa ? (
                                  <img
                                    src={jogo.logo_casa}
                                    alt={jogo.time_a}
                                    className="h-5 w-5 object-contain shrink-0"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                      const fallback = e.currentTarget
                                        .nextElementSibling as HTMLElement | null
                                      if (fallback) fallback.style.display = 'flex'
                                    }}
                                  />
                                ) : null}
                                <div
                                  className={`h-5 w-5 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                                    jogo.logo_casa ? 'hidden' : 'flex'
                                  }`}
                                  title={jogo.time_a}
                                >
                                  <span className="text-[8px] font-black uppercase text-slate-700">
                                    {jogo.time_a.slice(0, 2).toUpperCase()}
                                  </span>
                                </div>
                                <span className="text-sm font-bold text-slate-900">
                                  {jogo.time_a}
                                </span>
                              </div>

                              <span className="text-xs font-black text-slate-400">x</span>

                              {/* Escudo Visitante */}
                              <div className="flex items-center gap-1.5">
                                {jogo.logo_visitante ? (
                                  <img
                                    src={jogo.logo_visitante}
                                    alt={jogo.time_b}
                                    className="h-5 w-5 object-contain shrink-0"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                      const fallback = e.currentTarget
                                        .nextElementSibling as HTMLElement | null
                                      if (fallback) fallback.style.display = 'flex'
                                    }}
                                  />
                                ) : null}
                                <div
                                  className={`h-5 w-5 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                                    jogo.logo_visitante ? 'hidden' : 'flex'
                                  }`}
                                  title={jogo.time_b}
                                >
                                  <span className="text-[8px] font-black uppercase text-slate-700">
                                    {jogo.time_b.slice(0, 2).toUpperCase()}
                                  </span>
                                </div>
                                <span className="text-sm font-bold text-slate-900">
                                  {jogo.time_b}
                                </span>
                              </div>

                              {jogo.origem === 'manual' && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-700"
                                >
                                  Manual
                                </Badge>
                              )}

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

                          {/* Ações do Admin: Botões Rápidos de Editar e Excluir */}
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => handleAbrirModalEditarJogo(jogo, e)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-600 transition"
                                title="Editar jogo"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleAbrirModalExcluirJogo(jogo, e)}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                                title="Excluir confronto da enquete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}

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
                <strong>Champions League</strong> e <strong>Grandes da Europa</strong>,
                desconsiderando partidas que começam em menos de <strong>3 horas</strong> e
                convertendo horários para o fuso de Brasília (<strong>UTC-3</strong>).
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

            {/* Seção Expansível: Adicionar Jogo Manualmente */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-amber-950">Adicionar Jogo Manualmente</h4>
                    <p className="text-[11px] text-amber-800">
                      Inclua confrontos extras não encontrados nas APIs ou clássicos regionais.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormManualAberto((prev) => !prev)}
                  className="h-7 border-amber-300 bg-white text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  {formManualAberto ? (
                    <>
                      <ChevronUp className="mr-1 h-3.5 w-3.5" />
                      Recolher Formulário
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                      Adicionar Jogo Manualmente
                    </>
                  )}
                </Button>
              </div>

              {formManualAberto && (
                <div className="mt-3 space-y-3 border-t border-amber-200/70 pt-3">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {/* Mandante */}
                    <div className="space-y-1">
                      <Label htmlFor="manual-time-a" className="text-xs font-bold text-slate-700">
                        Mandante (Time Casa) *:
                      </Label>
                      <Input
                        id="manual-time-a"
                        placeholder="Ex.: Flamengo"
                        value={manualTimeA}
                        onChange={(e) => setManualTimeA(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>

                    {/* Visitante */}
                    <div className="space-y-1">
                      <Label htmlFor="manual-time-b" className="text-xs font-bold text-slate-700">
                        Visitante (Time Fora) *:
                      </Label>
                      <Input
                        id="manual-time-b"
                        placeholder="Ex.: Palmeiras"
                        value={manualTimeB}
                        onChange={(e) => setManualTimeB(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>
                  </div>

                  {/* Escudos Opcionais (Mandante e Visitante) */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor="manual-logo-casa"
                        className="text-xs font-bold text-slate-700 flex items-center justify-between"
                      >
                        <span>URL Escudo Mandante (opcional):</span>
                        <span className="text-[10px] font-normal text-slate-500">
                          Prioridade máxima
                        </span>
                      </Label>
                      <Input
                        id="manual-logo-casa"
                        type="url"
                        placeholder="https://... (se vazio, busca automática)"
                        value={manualLogoCasa}
                        onChange={(e) => setManualLogoCasa(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label
                        htmlFor="manual-logo-visitante"
                        className="text-xs font-bold text-slate-700 flex items-center justify-between"
                      >
                        <span>URL Escudo Visitante (opcional):</span>
                        <span className="text-[10px] font-normal text-slate-500">
                          Prioridade máxima
                        </span>
                      </Label>
                      <Input
                        id="manual-logo-visitante"
                        type="url"
                        placeholder="https://... (se vazio, busca automática)"
                        value={manualLogoVisitante}
                        onChange={(e) => setManualLogoVisitante(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {/* Competição com Datalist de sugestões */}
                    <div className="space-y-1 sm:col-span-1">
                      <Label
                        htmlFor="manual-competicao"
                        className="text-xs font-bold text-slate-700"
                      >
                        Competição *:
                      </Label>
                      <Input
                        id="manual-competicao"
                        list="sugestoes-competicoes"
                        placeholder="Ex.: Brasileirão Série A"
                        value={manualCompeticao}
                        onChange={(e) => setManualCompeticao(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                      <datalist id="sugestoes-competicoes">
                        <option value="Brasileirão Série A" />
                        <option value="Champions League" />
                        <option value="Premier League (Inglaterra)" />
                        <option value="La Liga (Espanha)" />
                        <option value="Serie A (Itália)" />
                        <option value="Bundesliga (Alemanha)" />
                        <option value="Ligue 1 (França)" />
                        <option value="Copa Libertadores" />
                        <option value="Copa Sul-Americana" />
                        <option value="Copa do Brasil" />
                        <option value="UEFA Europa League" />
                      </datalist>
                    </div>

                    {/* Data */}
                    <div className="space-y-1">
                      <Label htmlFor="manual-data" className="text-xs font-bold text-slate-700">
                        Data (Brasília) *:
                      </Label>
                      <Input
                        id="manual-data"
                        type="date"
                        value={manualData}
                        onChange={(e) => setManualData(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>

                    {/* Horário */}
                    <div className="space-y-1">
                      <Label htmlFor="manual-horario" className="text-xs font-bold text-slate-700">
                        Horário (Brasília UTC-3) *:
                      </Label>
                      <Input
                        id="manual-horario"
                        type="time"
                        value={manualHorario}
                        onChange={(e) => setManualHorario(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>
                  </div>

                  {/* Avisos leves (margem / duplicação) */}
                  {manualAvisoMargem && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100/70 p-2 text-[11px] text-amber-900">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                      <span>{manualAvisoMargem}</span>
                    </div>
                  )}

                  {manualAvisoDuplicado && (
                    <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800">
                      <Info className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span>{manualAvisoDuplicado}</span>
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAdicionarJogoManual}
                      className="bg-amber-600 text-xs font-bold text-white hover:bg-amber-700"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Adicionar à Lista da Enquete
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Lista dos Jogos para Pré-Seleção (Mesclando API e Manuais) */}
            {jogosEncontrados.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">
                      Jogos na Enquete ({jogosEncontrados.length} confrontos):
                    </span>
                    <span className="text-[11px] text-slate-500">
                      ({jogosEncontrados.filter((j) => j.origem === 'manual').length} manuais,{' '}
                      {jogosEncontrados.filter((j) => j.origem !== 'manual').length} de API)
                    </span>
                  </div>
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
                    const isManual = j.origem === 'manual'
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
                            <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-300 shrink-0" />
                          )}
                          {/* Escudo Mandante */}
                          {j.logo_casa ? (
                            <img
                              src={j.logo_casa}
                              alt={j.time_a}
                              className="h-5 w-5 object-contain shrink-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget
                                  .nextElementSibling as HTMLElement | null
                                if (fallback) fallback.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div
                            className={`h-5 w-5 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                              j.logo_casa ? 'hidden' : 'flex'
                            }`}
                            title={j.time_a}
                          >
                            <span className="text-[8px] font-black uppercase text-slate-700">
                              {j.time_a.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-bold text-slate-800">{j.time_a}</span>
                          <span className="text-slate-400 font-bold text-[10px]">x</span>
                          {/* Escudo Visitante */}
                          {j.logo_visitante ? (
                            <img
                              src={j.logo_visitante}
                              alt={j.time_b}
                              className="h-5 w-5 object-contain shrink-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget
                                  .nextElementSibling as HTMLElement | null
                                if (fallback) fallback.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div
                            className={`h-5 w-5 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                              j.logo_visitante ? 'hidden' : 'flex'
                            }`}
                            title={j.time_b}
                          >
                            <span className="text-[8px] font-black uppercase text-slate-700">
                              {j.time_b.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-bold text-slate-800">{j.time_b}</span>
                          {isManual && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-bold text-amber-800"
                            >
                              Manual
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-medium">{j.campeonato}</span>
                          <span>•</span>
                          <span>
                            {formatDataBR(j.data)} {formatHoraBR(j.horario)}
                          </span>
                          <button
                            type="button"
                            title="Remover jogo desta enquete"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoverJogoCriacao(j.id)
                            }}
                            className="ml-1 p-1 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
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
              <div key={j.id} className="flex items-center justify-between py-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  {j.logo_casa ? (
                    <img
                      src={j.logo_casa}
                      alt={j.time_a}
                      className="h-4 w-4 object-contain shrink-0"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  <div
                    className={`h-4 w-4 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                      j.logo_casa ? 'hidden' : 'flex'
                    }`}
                    title={j.time_a}
                  >
                    <span className="text-[7px] font-black uppercase text-slate-700">
                      {j.time_a.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className="font-bold text-slate-800">{j.time_a}</span>
                  <span className="text-[10px] font-bold text-slate-400">x</span>
                  {j.logo_visitante ? (
                    <img
                      src={j.logo_visitante}
                      alt={j.time_b}
                      className="h-4 w-4 object-contain shrink-0"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  <div
                    className={`h-4 w-4 rounded-full bg-slate-100 border border-slate-200 items-center justify-center shrink-0 ${
                      j.logo_visitante ? 'hidden' : 'flex'
                    }`}
                    title={j.time_b}
                  >
                    <span className="text-[7px] font-black uppercase text-slate-700">
                      {j.time_b.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className="font-bold text-slate-800">{j.time_b}</span>
                </div>
                <span className="text-slate-500 text-[11px]">
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

      {/* MODAL DE INSERÇÃO MANUAL DE JOGO NA ENQUETE ATIVA (PAINEL ADMIN) */}
      <Dialog
        open={dialogAdicionarManualAtivaOpen}
        onOpenChange={setDialogAdicionarManualAtivaOpen}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Plus className="h-5 w-5 text-amber-600" />
              Adicionar Jogo Manual na Enquete Ativa
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Inclua manualmente um confronto em <strong>"{enqueteAtiva?.titulo}"</strong>. O jogo
              ficará disponível imediatamente para votação sem afetar os votos já existentes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {/* Mandante */}
              <div className="space-y-1">
                <Label htmlFor="ativa-manual-time-a" className="text-xs font-bold text-slate-700">
                  Mandante (Time Casa) *:
                </Label>
                <Input
                  id="ativa-manual-time-a"
                  placeholder="Ex.: Corinthians"
                  value={ativaManualMandante}
                  onChange={(e) => setAtivaManualMandante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              {/* Visitante */}
              <div className="space-y-1">
                <Label htmlFor="ativa-manual-time-b" className="text-xs font-bold text-slate-700">
                  Visitante (Time Fora) *:
                </Label>
                <Input
                  id="ativa-manual-time-b"
                  placeholder="Ex.: Palmeiras"
                  value={ativaManualVisitante}
                  onChange={(e) => setAtivaManualVisitante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* Escudos Opcionais (Mandante e Visitante) */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="ativa-manual-logo-casa"
                  className="text-xs font-bold text-slate-700 flex items-center justify-between"
                >
                  <span>URL Escudo Mandante (opcional):</span>
                  <span className="text-[10px] font-normal text-slate-500">Prioridade máxima</span>
                </Label>
                <Input
                  id="ativa-manual-logo-casa"
                  type="url"
                  placeholder="https://... (se vazio, busca automática)"
                  value={ativaManualLogoCasa}
                  onChange={(e) => setAtivaManualLogoCasa(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor="ativa-manual-logo-visitante"
                  className="text-xs font-bold text-slate-700 flex items-center justify-between"
                >
                  <span>URL Escudo Visitante (opcional):</span>
                  <span className="text-[10px] font-normal text-slate-500">Prioridade máxima</span>
                </Label>
                <Input
                  id="ativa-manual-logo-visitante"
                  type="url"
                  placeholder="https://... (se vazio, busca automática)"
                  value={ativaManualLogoVisitante}
                  onChange={(e) => setAtivaManualLogoVisitante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* Competição com Datalist de sugestões */}
              <div className="space-y-1 sm:col-span-1">
                <Label
                  htmlFor="ativa-manual-competicao"
                  className="text-xs font-bold text-slate-700"
                >
                  Competição / Liga *:
                </Label>
                <Input
                  id="ativa-manual-competicao"
                  list="sugestoes-competicoes-ativa"
                  placeholder="Ex.: Brasileirão Série A"
                  value={ativaManualCompeticao}
                  onChange={(e) => setAtivaManualCompeticao(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
                <datalist id="sugestoes-competicoes-ativa">
                  <option value="Brasileirão Série A" />
                  <option value="Champions League" />
                  <option value="Premier League (Inglaterra)" />
                  <option value="La Liga (Espanha)" />
                  <option value="Serie A (Itália)" />
                  <option value="Bundesliga (Alemanha)" />
                  <option value="Ligue 1 (França)" />
                  <option value="Copa Libertadores" />
                  <option value="Copa Sul-Americana" />
                  <option value="Copa do Brasil" />
                  <option value="UEFA Europa League" />
                </datalist>
              </div>

              {/* Data (UTC-3) */}
              <div className="space-y-1">
                <Label htmlFor="ativa-manual-data" className="text-xs font-bold text-slate-700">
                  Data (Brasília UTC-3) *:
                </Label>
                <Input
                  id="ativa-manual-data"
                  type="date"
                  value={ativaManualData}
                  onChange={(e) => setAtivaManualData(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              {/* Horário (UTC-3) */}
              <div className="space-y-1">
                <Label htmlFor="ativa-manual-horario" className="text-xs font-bold text-slate-700">
                  Horário (UTC-3) *:
                </Label>
                <Input
                  id="ativa-manual-horario"
                  type="time"
                  value={ativaManualHorario}
                  onChange={(e) => setAtivaManualHorario(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* Avisos leves (margem / duplicação) */}
            {ativaManualAvisoMargem && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100/70 p-2.5 text-[11px] text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
                <span>{ativaManualAvisoMargem}</span>
              </div>
            )}

            {ativaManualAvisoDuplicado && (
              <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-[11px] text-blue-800">
                <Info className="h-4 w-4 shrink-0 text-blue-600" />
                <span>{ativaManualAvisoDuplicado}</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogAdicionarManualAtivaOpen(false)}
              disabled={salvandoJogoAtiva}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSalvarJogoManualAtiva}
              disabled={salvandoJogoAtiva}
              className="bg-amber-600 font-bold text-white hover:bg-amber-700"
            >
              {salvandoJogoAtiva ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Inserir Jogo na Enquete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE EDIÇÃO DE JOGO DA ENQUETE (PAINEL ADMIN) */}
      <Dialog open={dialogEditarJogoOpen} onOpenChange={setDialogEditarJogoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Pencil className="h-5 w-5 text-amber-600" />
              Editar Jogo da Enquete
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Altere as informações do confronto. Os <strong>votos já computados</strong>{' '}
              permanecerão intactos no card.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {/* Mandante */}
              <div className="space-y-1">
                <Label htmlFor="edit-mandante" className="text-xs font-bold text-slate-700">
                  Mandante (Time Casa) *:
                </Label>
                <Input
                  id="edit-mandante"
                  placeholder="Ex.: Corinthians"
                  value={editMandante}
                  onChange={(e) => setEditMandante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              {/* Visitante */}
              <div className="space-y-1">
                <Label htmlFor="edit-visitante" className="text-xs font-bold text-slate-700">
                  Visitante (Time Fora) *:
                </Label>
                <Input
                  id="edit-visitante"
                  placeholder="Ex.: Palmeiras"
                  value={editVisitante}
                  onChange={(e) => setEditVisitante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* Escudos Mandante e Visitante (Pré-preenchidos) */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="edit-logo-casa"
                  className="text-xs font-bold text-slate-700 flex items-center justify-between"
                >
                  <span>URL Escudo Mandante (opcional):</span>
                  <span className="text-[10px] font-normal text-slate-500">Prioridade máxima</span>
                </Label>
                <Input
                  id="edit-logo-casa"
                  type="url"
                  placeholder="https://... (se vazio, busca automática)"
                  value={editLogoCasa}
                  onChange={(e) => setEditLogoCasa(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor="edit-logo-visitante"
                  className="text-xs font-bold text-slate-700 flex items-center justify-between"
                >
                  <span>URL Escudo Visitante (opcional):</span>
                  <span className="text-[10px] font-normal text-slate-500">Prioridade máxima</span>
                </Label>
                <Input
                  id="edit-logo-visitante"
                  type="url"
                  placeholder="https://... (se vazio, busca automática)"
                  value={editLogoVisitante}
                  onChange={(e) => setEditLogoVisitante(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* Competição com Datalist de sugestões */}
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="edit-competicao" className="text-xs font-bold text-slate-700">
                  Competição / Liga *:
                </Label>
                <Input
                  id="edit-competicao"
                  list="sugestoes-competicoes-edit"
                  placeholder="Ex.: Brasileirão Série A"
                  value={editCompeticao}
                  onChange={(e) => setEditCompeticao(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
                <datalist id="sugestoes-competicoes-edit">
                  <option value="Brasileirão Série A" />
                  <option value="Champions League" />
                  <option value="Premier League (Inglaterra)" />
                  <option value="La Liga (Espanha)" />
                  <option value="Serie A (Itália)" />
                  <option value="Bundesliga (Alemanha)" />
                  <option value="Ligue 1 (França)" />
                  <option value="Copa Libertadores" />
                  <option value="Copa Sul-Americana" />
                  <option value="Copa do Brasil" />
                  <option value="UEFA Europa League" />
                </datalist>
              </div>

              {/* Data (UTC-3) */}
              <div className="space-y-1">
                <Label htmlFor="edit-data" className="text-xs font-bold text-slate-700">
                  Data (Brasília UTC-3) *:
                </Label>
                <Input
                  id="edit-data"
                  type="date"
                  value={editData}
                  onChange={(e) => setEditData(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>

              {/* Horário (UTC-3) */}
              <div className="space-y-1">
                <Label htmlFor="edit-horario" className="text-xs font-bold text-slate-700">
                  Horário (UTC-3) *:
                </Label>
                <Input
                  id="edit-horario"
                  type="time"
                  value={editHorario}
                  onChange={(e) => setEditHorario(e.target.value)}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* Aviso de margem */}
            {editAvisoMargem && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100/70 p-2.5 text-[11px] text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
                <span>{editAvisoMargem}</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDialogEditarJogoOpen(false)
                setJogoEmEdicao(null)
              }}
              disabled={salvandoEdicaoJogo}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSalvarEdicaoJogo}
              disabled={salvandoEdicaoJogo}
              className="bg-amber-600 font-bold text-white hover:bg-amber-700"
            >
              {salvandoEdicaoJogo ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
              )}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE JOGO INDIVIDUAL (PAINEL ADMIN) */}
      <Dialog open={dialogExcluirJogoOpen} onOpenChange={setDialogExcluirJogoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-700">
              <Trash2 className="h-5 w-5" />
              Excluir Confronto da Enquete
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Tem certeza que deseja remover o confronto{' '}
              <strong>
                "{jogoEmExclusao?.time_a} x {jogoEmExclusao?.time_b}"
              </strong>{' '}
              da enquete? O jogo será excluído, as contagens serão recalculadas e os filtros
              dinâmicos ajustados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDialogExcluirJogoOpen(false)
                setJogoEmExclusao(null)
              }}
              disabled={excluindoJogo}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmarExcluirJogo}
              disabled={excluindoJogo}
              className="bg-rose-600 font-bold text-white hover:bg-rose-700"
            >
              {excluindoJogo ? 'Excluindo...' : 'Sim, Excluir Jogo'}
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
