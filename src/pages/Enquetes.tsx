import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
  Share2,
  Check,
  Search,
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
import { Progress } from '@/components/ui/progress'
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
  isEnqueteExpirada,
  formatEnquetePrazoLimiteBR,
  formatEnqueteTituloDinamico,
  extrairNomeCopaEnquete,
  formatEnqueteStatusLabel,
  formatEnquetePeriodoCurto,
  enquetesPossuemAnosDiferentes,
  ordenarEnquetesCrescente,
} from '@/lib/dateUtils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type EnqueteModel,
  type JogoComVotos,
  type JogoBuscado,
  type FixtureDetalhesItem,
  getDefaultDatasIntervalo,
  buscarJogosIntervalo,
  buscarEscudoTime,
  criarEnquete,
  listarEnquetes,
  obterDadosEnquete,
  toggleVotoJogo,
  toggleAdminSelecaoJogo,
  atualizarStatusEnquete,
  editarEnquete,
  cadastrarJogosAprovadosNaCopaConi,
  excluirEnquete,
  adicionarJogoManualNaEnquete,
  editarJogoEnquete,
  excluirJogoEnquete,
  buscarFixtureDetalhes,
  buscarFixtureAutoLookup,
  isApiSportsLogo,
  readListaEnquetesCache,
  readEnqueteDetalhesCache,
  readEscudoCache,
} from '@/services/enquetes'
import { TeamShield } from '@/components/TeamShield'
import { resolveTeamBadgeUrl, getClubLogoUrl } from '@/lib/flags'
import { normalizeLeagueName } from '@/lib/tournamentRegionMatcher'

/**
 * Adaptador de compatibilidade que redireciona para o TeamShield único,
 * preservando todas as prioridades oficiais (ficha_detalhes > tabela canônica > URL cadastrada)
 * e repassando fixtureId e isSide quando disponíveis.
 */
function EnqueteTeamBadge({
  nomeTime,
  savedLogo,
  fixtureId,
  fichaDetalhes,
  isSide,
  sizeClass = 'h-7 w-7 sm:h-8 sm:w-8 min-w-[28px] min-h-[28px]',
  textClass = 'text-[10px] font-black uppercase text-slate-700',
}: {
  nomeTime: string
  savedLogo?: string | null
  fixtureId?: string | number | null
  fichaDetalhes?: any
  isSide?: 'home' | 'away'
  sizeClass?: string
  textClass?: string
}) {
  return (
    <TeamShield
      teamName={nomeTime}
      escudo={savedLogo}
      fixtureId={fixtureId}
      fichaDetalhes={fichaDetalhes}
      isSide={isSide}
      sizeClass={sizeClass}
      textClass={textClass}
    />
  )
}

function WhatsAppIcon({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.585 1.761.884 2.802.884l.006-.001c3.179 0 5.767-2.587 5.768-5.766.001-3.18-2.585-5.77-5.78-5.77zm3.385 8.163c-.144.405-.837.774-1.17.822-.312.043-.683.078-2.208-.553-1.849-.766-3.031-2.64-3.125-2.764-.094-.124-.748-.996-.748-1.9 0-.903.473-1.348.641-1.52.169-.172.368-.215.49-.215.124 0 .248.001.357.006.115.006.269-.043.421.321.157.376.536 1.309.583 1.405.047.095.078.207.016.331-.063.124-.094.202-.187.311-.093.11-.197.246-.282.33-.095.095-.194.198-.083.39.112.191.498.822 1.07 1.332.738.656 1.36.858 1.552.953.193.095.305.083.419-.048.113-.131.488-.567.618-.761.13-.194.26-.162.438-.096.178.066 1.13.533 1.325.63.195.097.325.144.372.226.048.082.048.477-.096.882zM12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.987-1.308C8.423 21.547 10.155 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.2c-1.636 0-3.161-.489-4.444-1.332l-.319-.209-2.956.775.789-2.882-.228-.363A8.15 8.15 0 0 1 3.8 12c0-4.521 3.679-8.2 8.2-8.2 4.522 0 8.2 3.679 8.2 8.2 0 4.522-3.678 8.2-8.2 8.2z" />
    </svg>
  )
}

export default function Enquetes() {
  const { user, isAdmin, participantName } = useAuth()
  const { toast } = useToast()

  // Inicialização instantânea a partir do cache (dois níveis) e parâmetro da URL
  const initialListaCached = useMemo(() => readListaEnquetesCache() || [], [])

  // Estado único de verdade (Single Source of Truth) para a enquete ativa
  const [enquetes, setEnquetes] = useState<EnqueteModel[]>(initialListaCached)
  const [activePoll, setActivePoll] = useState<EnqueteModel | null>(() => {
    if (initialListaCached.length === 0) return null

    // 1. Prioridade máxima: parâmetro ?id= da URL (deep links como os enviados no WhatsApp)
    let resolvedPoll: EnqueteModel | null = null
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const idFromUrl = urlParams.get('id')
      if (idFromUrl) {
        resolvedPoll = initialListaCached.find((e) => e.id === idFromUrl) || null
      }
    }

    // 2. Default sem id na URL: SEMPRE a primeira enquete da ordem crescente de data_inicio (enquetesOrdenadas[0])
    if (!resolvedPoll) {
      const ordenadas = ordenarEnquetesCrescente(initialListaCached)
      resolvedPoll = ordenadas[0] || null
    }

    if (resolvedPoll) {
      const cached = readEnqueteDetalhesCache(resolvedPoll.id, user?.id)
      if (cached?.enquete) {
        return cached.enquete
      }
      return resolvedPoll
    }
    return null
  })

  const [jogosEnquete, setJogosEnquete] = useState<JogoComVotos[]>(() => {
    if (activePoll?.id) {
      const cached = readEnqueteDetalhesCache(activePoll.id, user?.id)
      if (cached) return cached.jogos
    }
    return []
  })

  const [meusVotosIds, setMeusVotosIds] = useState<Set<string>>(() => {
    if (activePoll?.id) {
      const cached = readEnqueteDetalhesCache(activePoll.id, user?.id)
      if (cached) return cached.meusVotosIds
    }
    return new Set()
  })
  // Se tínhamos cache inicial para a enquete ativa, não bloqueia a tela!
  const hasInitialCache = Boolean(activePoll?.id && jogosEnquete.length > 0)
  const [isLoadingEnquetes, setIsLoadingEnquetes] = useState(enquetes.length === 0)
  const [loadingDetalhes, setLoadingDetalhes] = useState(
    !hasInitialCache && Boolean(activePoll?.id),
  )
  const loading = isLoadingEnquetes || (loadingDetalhes && !activePoll)
  const [votandoJogoId, setVotandoJogoId] = useState<string | null>(null)

  // Paginação incremental / Lazy Loading de Cards de Jogos para alta performance de renderização
  const [visibleCount, setVisibleCount] = useState(15)

  // Painel Admin: Criação de Nova Enquete
  const [dialogNovaEnqueteOpen, setDialogNovaEnqueteOpen] = useState(false)
  const datasPadrao = useMemo(() => getDefaultDatasIntervalo(), [])
  const [dataInicio, setDataInicio] = useState(datasPadrao.dataInicio)
  const [dataFim, setDataFim] = useState(datasPadrao.dataFim)
  const [dataLimiteVotacao, setDataLimiteVotacao] = useState(
    datasPadrao.dataFim ? `${datasPadrao.dataFim}T12:00` : '',
  )
  const [limiteVotosCriacao, setLimiteVotosCriacao] = useState('4')
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
  const [origemManualLogoCasa, setOrigemManualLogoCasa] = useState<'auto' | 'manual'>('auto')
  const [origemManualLogoVisitante, setOrigemManualLogoVisitante] = useState<'auto' | 'manual'>(
    'auto',
  )
  const [manualCompeticao, setManualCompeticao] = useState('')
  const [manualData, setManualData] = useState(datasPadrao.dataInicio)
  const [manualHorario, setManualHorario] = useState('16:00')
  const [manualAvisoMargem, setManualAvisoMargem] = useState<string | null>(null)
  const [manualAvisoDuplicado, setManualAvisoDuplicado] = useState<string | null>(null)

  // Título dinâmico da enquete ativa calculado em tempo real:
  // 3.a) Priorizar activePoll.titulo quando informado pelo usuário; a formatação dinâmica
  // "Enquete ${nomeCopa} — ${dInicio} a ${dFim}" serve apenas como fallback quando não há título salvo.
  const tituloEnqueteAtiva = useMemo(() => {
    if (!activePoll) return ''
    const tituloTrim = (activePoll.titulo || '').trim()
    if (tituloTrim) {
      return tituloTrim
    }
    const nomeCopa = extrairNomeCopaEnquete(activePoll.titulo, 'Copa Coni')
    const dInicio = formatDataBR(activePoll.data_inicio)
    const dFim = formatDataBR(activePoll.data_fim)
    if (dInicio && dInicio !== '—' && dFim && dFim !== '—') {
      return `Enquete ${nomeCopa} — ${dInicio} a ${dFim}`
    }
    return formatEnqueteTituloDinamico({
      titulo: activePoll.titulo,
      data_inicio: activePoll.data_inicio,
      data_fim: activePoll.data_fim,
      status: activePoll.status,
      jogos: jogosEnquete,
      incluirStatus: false,
    })
  }, [activePoll, jogosEnquete])

  // Diálogo para Reabrir Votação com nova data limite
  const [dialogReabrirOpen, setDialogReabrirOpen] = useState(false)
  const [reabrirNovaDataLimite, setReabrirNovaDataLimite] = useState('')
  const [reabrindoVotacao, setReabrindoVotacao] = useState(false)

  // Modal de adição de jogo manual em enquete ativa (já criada)
  const [dialogAdicionarManualAtivaOpen, setDialogAdicionarManualAtivaOpen] = useState(false)
  const [salvandoJogoAtiva, setSalvandoJogoAtiva] = useState(false)
  const [ativaManualMandante, setAtivaManualMandante] = useState('')
  const [ativaManualVisitante, setAtivaManualVisitante] = useState('')
  const [ativaManualFixtureId, setAtivaManualFixtureId] = useState('')
  const [ativaManualLogoCasa, setAtivaManualLogoCasa] = useState('')
  const [ativaManualLogoVisitante, setAtivaManualLogoVisitante] = useState('')
  const [origemAtivaLogoCasa, setOrigemAtivaLogoCasa] = useState<'auto' | 'manual'>('auto')
  const [origemAtivaLogoVisitante, setOrigemAtivaLogoVisitante] = useState<'auto' | 'manual'>(
    'auto',
  )
  const [ativaManualCompeticao, setAtivaManualCompeticao] = useState('')
  const [ativaManualData, setAtivaManualData] = useState('')
  const [ativaManualHorario, setAtivaManualHorario] = useState('16:00')
  const [ativaManualAvisoMargem, setAtivaManualAvisoMargem] = useState<string | null>(null)
  const [ativaManualAvisoDuplicado, setAtivaManualAvisoDuplicado] = useState<string | null>(null)
  const [autoLookupAtivaFeedback, setAutoLookupAtivaFeedback] = useState<string | null>(null)
  const [buscandoAutoLookupAtiva, setBuscandoAutoLookupAtiva] = useState(false)
  const [alternativasAtiva, setAlternativasAtiva] = useState<FixtureDetalhesItem[]>([])
  const [avisoBuscaAtiva, setAvisoBuscaAtiva] = useState<string | null>(null)

  // Admin: Modal de Edição da Enquete Ativa (Título, Limite, Período, Prazo e Descrição)
  const [dialogEditarEnqueteOpen, setDialogEditarEnqueteOpen] = useState(false)
  const [editEnqueteTitulo, setEditEnqueteTitulo] = useState('')
  const [editEnqueteLimiteVotos, setEditEnqueteLimiteVotos] = useState('4')
  const [editEnqueteDataInicio, setEditEnqueteDataInicio] = useState('')
  const [editEnqueteDataFim, setEditEnqueteDataFim] = useState('')
  const [editEnqueteDataLimiteVotacao, setEditEnqueteDataLimiteVotacao] = useState('')
  const [editEnqueteDescricao, setEditEnqueteDescricao] = useState('')
  const [salvandoEdicaoEnquete, setSalvandoEdicaoEnquete] = useState(false)

  const handleAbrirModalEditarEnquete = () => {
    if (!activePoll) return
    setEditEnqueteTitulo(activePoll.titulo || '')
    setEditEnqueteLimiteVotos(String(activePoll.limite_votos || 4))
    setEditEnqueteDataInicio(activePoll.data_inicio || '')
    setEditEnqueteDataFim(activePoll.data_fim || '')
    setEditEnqueteDataLimiteVotacao(
      activePoll.data_limite_votacao
        ? activePoll.data_limite_votacao.replace(' ', 'T').slice(0, 16)
        : '',
    )
    setEditEnqueteDescricao(activePoll.descricao || '')
    setDialogEditarEnqueteOpen(true)
  }

  const handleSalvarEdicaoEnquete = async () => {
    if (!activePoll) return
    const limiteNum = Math.max(1, parseInt(editEnqueteLimiteVotos, 10) || 4)
    if (!editEnqueteDataInicio || !editEnqueteDataFim) {
      toast({
        title: 'Datas obrigatórias',
        description: 'Informe a data inicial e a data final da enquete.',
        variant: 'destructive',
      })
      return
    }

    setSalvandoEdicaoEnquete(true)
    try {
      const atualizada = await editarEnquete(activePoll.id, {
        titulo: editEnqueteTitulo,
        limite_votos: limiteNum,
        data_inicio: editEnqueteDataInicio,
        data_fim: editEnqueteDataFim,
        data_limite_votacao: editEnqueteDataLimiteVotacao,
        descricao: editEnqueteDescricao,
      })

      setActivePoll((prev) => (prev ? { ...prev, ...atualizada } : atualizada))
      setDialogEditarEnqueteOpen(false)
      toast({
        title: 'Enquete atualizada!',
        description: 'As alterações foram salvas com sucesso. Votos e jogos preservados.',
      })
      await carregarListaEnquetes(false)
      await carregarDetalhesEnquete(activePoll.id, false)
    } catch (err: any) {
      console.error('Erro ao editar enquete:', err)
      toast({
        title: 'Erro ao salvar alterações',
        description: err?.message || 'Verifique os dados informados e tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setSalvandoEdicaoEnquete(false)
    }
  }

  // Admin: Modal de Edição de Jogo da Enquete
  const [jogoEmEdicao, setJogoEmEdicao] = useState<JogoComVotos | null>(null)
  const [dialogEditarJogoOpen, setDialogEditarJogoOpen] = useState(false)
  const [editMandante, setEditMandante] = useState('')
  const [editVisitante, setEditVisitante] = useState('')
  const [editFixtureId, setEditFixtureId] = useState('')
  const [editLogoCasa, setEditLogoCasa] = useState('')
  const [editLogoVisitante, setEditLogoVisitante] = useState('')
  const [origemEditLogoCasa, setOrigemEditLogoCasa] = useState<'auto' | 'manual'>('auto')
  const [origemEditLogoVisitante, setOrigemEditLogoVisitante] = useState<'auto' | 'manual'>('auto')
  const [editCompeticao, setEditCompeticao] = useState('')
  const [editData, setEditData] = useState('')
  const [editHorario, setEditHorario] = useState('16:00')
  const [editAvisoMargem, setEditAvisoMargem] = useState<string | null>(null)
  const [salvandoEdicaoJogo, setSalvandoEdicaoJogo] = useState(false)
  const [buscandoFixtureEdit, setBuscandoFixtureEdit] = useState(false)
  const [buscandoFixtureAtiva, setBuscandoFixtureAtiva] = useState(false)
  const [autoLookupEditFeedback, setAutoLookupEditFeedback] = useState<string | null>(null)
  const [buscandoAutoLookupEdit, setBuscandoAutoLookupEdit] = useState(false)
  const [alternativasEdit, setAlternativasEdit] = useState<FixtureDetalhesItem[]>([])
  const [avisoBuscaEdit, setAvisoBuscaEdit] = useState<string | null>(null)

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
    if (activePoll?.id) {
      carregarDetalhesEnquete(activePoll.id, false)
    }
  })

  useRealtime('enquete_jogos', () => {
    if (activePoll?.id) {
      carregarDetalhesEnquete(activePoll.id, false)
    }
  })

  useRealtime('enquetes', () => {
    carregarListaEnquetes(false)
  })

  // Carrega lista de enquetes com SWR e memoização segura
  const carregarListaEnquetes = useCallback(async (selectFirst = true) => {
    // 1. Tenta cache imediato se ainda não tivermos lista
    const cached = readListaEnquetesCache()
    if (cached && cached.length > 0) {
      setEnquetes((prev) => (prev.length === 0 ? cached : prev))
    }

    try {
      const lista = await listarEnquetes()
      setEnquetes(lista)
      if (lista.length > 0) {
        setActivePoll((prevActive) => {
          if (selectFirst || !prevActive) {
            // Verifica se há enquete indicada na URL
            const urlParams =
              typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
            const idFromUrl = urlParams?.get('id')
            const correspondenteUrl = idFromUrl ? lista.find((e) => e.id === idFromUrl) : null

            // Regra: se houver ?id= na URL, prevalece; senão, a primeira da ordem crescente de data_inicio
            const listaOrdenada = ordenarEnquetesCrescente(lista)
            const selecionada = correspondenteUrl || listaOrdenada[0] || lista[0]
            return selecionada
          } else {
            // Sincroniza activePoll com os dados mais recentes da lista revalidada
            const atualizada = lista.find((e) => e.id === prevActive.id)
            if (atualizada) {
              return { ...prevActive, ...atualizada }
            }
            return prevActive
          }
        })
      } else {
        setActivePoll(null)
        setJogosEnquete([])
      }
    } catch (err) {
      console.error('Erro ao carregar enquetes:', err)
    } finally {
      setIsLoadingEnquetes(false)
    }
  }, [])

  // Carrega detalhes da enquete selecionada com SWR
  const carregarDetalhesEnquete = useCallback(
    async (enqueteId: string, showSpinner = true) => {
      if (!enqueteId) return

      // 1. Lê do cache local/memória imediatamente
      const cached = readEnqueteDetalhesCache(enqueteId, user?.id)
      if (cached) {
        setActivePoll((prev) =>
          prev?.id === enqueteId ? { ...prev, ...cached.enquete } : cached.enquete,
        )
        setJogosEnquete(cached.jogos)
        setMeusVotosIds(cached.meusVotosIds)
        setLoadingDetalhes(false) // Dados exibidos instantaneamente!
      } else if (showSpinner) {
        setLoadingDetalhes(true)
      }

      try {
        const dados = await obterDadosEnquete(enqueteId, user?.id)
        setActivePoll((prev) =>
          prev?.id === enqueteId ? { ...prev, ...dados.enquete } : dados.enquete,
        )

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

        // Sincroniza o item na lista de enquetes com os dados mais recentes retornados pelo backend
        if (dados.enquete) {
          setEnquetes((prev) =>
            prev.map((e) => (e.id === enqueteId ? { ...e, ...dados.enquete } : e)),
          )
        }
      } catch (err) {
        console.error('Erro ao obter detalhes da enquete:', err)
      } finally {
        setLoadingDetalhes(false)
      }
    },
    [user?.id],
  )

  useEffect(() => {
    carregarListaEnquetes(true)
  }, [carregarListaEnquetes])

  const activePollId = activePoll?.id
  useEffect(() => {
    if (activePollId) {
      setFiltroCategoria('todos')
      // Na troca de seleção, não exibe spinner invasivo nem aciona sincronização bloqueante
      carregarDetalhesEnquete(activePollId, false)

      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        if (url.searchParams.get('id') !== activePollId) {
          url.searchParams.set('id', activePollId)
          window.history.replaceState({}, '', url.toString())
        }
      }
    }
  }, [activePollId, carregarDetalhesEnquete])

  // Ordena os botões de enquetes por data_inicio em ordem CRESCENTE (mais antiga/próxima para a mais distante)
  const enquetesOrdenadas = useMemo(() => {
    return ordenarEnquetesCrescente(enquetes)
  }, [enquetes])

  // Desambiguação de anos: se houver enquetes de anos diferentes, inclui o ano no rótulo curto
  const exibirAnoBotoes = useMemo(() => {
    return enquetesPossuemAnosDiferentes(enquetes)
  }, [enquetes])

  // Troca imediata ao clicar no botão da enquete
  const handleSelecionarEnquete = useCallback(
    (selected: EnqueteModel) => {
      if (!selected) return
      setActivePoll(selected)
      // Se houver cache de detalhes da enquete, já hidrata jogos e votos sem travar UI
      if (selected.id) {
        const cached = readEnqueteDetalhesCache(selected.id, user?.id)
        if (cached) {
          setJogosEnquete(cached.jogos)
          setMeusVotosIds(cached.meusVotosIds)
        } else {
          setJogosEnquete([])
        }
      }
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set('id', selected.id)
        window.history.replaceState({}, '', url.toString())
      }
    },
    [user?.id],
  )

  // Total de votos do usuário logado na enquete ativa (piso mínimo de 1 voto, padrão 4)
  const totalMeusVotos = meusVotosIds.size
  const limiteVotos = Math.max(1, activePoll?.limite_votos || 4)
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

  // Jogos aprovados para Copa Coni: estritamente marcados pelo admin ("Confirmar p/ Rodada")
  const jogosAprovadosParaConi = useMemo(() => {
    return jogosEnquete.filter((j) => Boolean(j.selecionado_admin))
  }, [jogosEnquete])

  // Status efetivo da votação da enquete ativa:
  // Se explicitamente 'encerrada' OU se atingiu o prazo limite configurado (data_limite_votacao / fallback data_fim)
  const votacaoExpiradaPorPrazo = useMemo(() => {
    if (!activePoll) return false
    return isEnqueteExpirada(activePoll.data_limite_votacao, activePoll.data_fim)
  }, [activePoll])

  const isVotacaoEncerrada = useMemo(() => {
    if (!activePoll) return true
    if (activePoll.status === 'encerrada') return true
    if (votacaoExpiradaPorPrazo) return true
    return false
  }, [activePoll, votacaoExpiradaPorPrazo])

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

  // Normalização e unificação canônica de competições no cliente para abas/filtros
  // (ex.: "Brazilian Serie A" -> "Brasileirão Série A")
  const competicoesEnqueteNormalizadas = useMemo(() => {
    const counts = new Map<string, number>()
    for (const j of jogosEnquete) {
      const nomeComp = normalizeLeagueName(j.campeonato) || 'Outros'
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

  // Filtro de jogos na lista de votação com normalização de liga
  const jogosFiltradosVotacao = useMemo(() => {
    if (filtroCategoria === 'todos') return jogosEnquete
    if (filtroCategoria === 'meus-votos') {
      return jogosEnquete.filter((j) => meusVotosIds.has(j.id))
    }
    // Filtro dinâmico por competição normalizada
    return jogosEnquete.filter((j) => {
      const nomeComp = normalizeLeagueName(j.campeonato) || 'Outros'
      return nomeComp === filtroCategoria || (j.campeonato || '').trim() === filtroCategoria
    })
  }, [jogosEnquete, filtroCategoria, meusVotosIds])

  // Reseta paginação de cards quando a categoria de filtro ou enquete ativa mudar
  useEffect(() => {
    setVisibleCount(15)
  }, [filtroCategoria, activePoll?.id])

  // Jogos visíveis renderizados incrementalmente no DOM (Lazy Loading)
  const jogosVisiveis = useMemo(() => {
    return jogosFiltradosVotacao.slice(0, visibleCount)
  }, [jogosFiltradosVotacao, visibleCount])

  // Ação: Compartilhar Enquete Aberta no WhatsApp
  const handleCompartilharWhatsApp = useCallback(() => {
    if (typeof window === 'undefined') return

    // Monta link absoluto dinâmico garantindo apontamento para a tela da enquete ativa
    const urlObj = new URL(window.location.href)
    urlObj.pathname = '/bolao/enquetes'
    // Limpa parâmetros residuais de busca
    urlObj.search = ''
    if (activePoll?.id) {
      urlObj.searchParams.set('id', activePoll.id)
    }
    const linkPagina = urlObj.toString()

    const tituloMsg =
      tituloEnqueteAtiva ||
      (activePoll
        ? formatEnqueteTituloDinamico({
            titulo: activePoll.titulo,
            data_inicio: activePoll.data_inicio,
            data_fim: activePoll.data_fim,
            status: activePoll.status,
            jogos: jogosEnquete,
            incluirStatus: false,
          })
        : '')

    const mensagem =
      `🗳️ *Votação Aberta: ${tituloMsg}*\n\n` +
      `Pessoal, a enquete da rodada já está aberta para escolha dos jogos! Entrem para registrar seus votos antes do encerramento.\n\n` +
      `👉 Acesse e vote agora: ${linkPagina}`

    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
  }, [activePoll, tituloEnqueteAtiva, jogosEnquete])

  // Ação: Votar / Desmarcar Jogo
  const handleToggleVoto = async (jogoId: string) => {
    // 1. Verificação se o usuário está logado
    if (!user && !pb.authStore.isValid) {
      toast({
        title: 'Login necessário',
        description:
          'Você precisa estar logado para votar na enquete. Faça login no sistema e tente novamente.',
        variant: 'destructive',
      })
      return
    }

    if (!activePoll) return
    if (activePoll.status !== 'aberta' || isVotacaoEncerrada) {
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
        title: `Limite de ${limiteVotos} votos atingido`,
        description: `Você já utilizou os ${limiteVotos} votos permitidos. Para votar nesta partida, desmarque outra primeiro.`,
        variant: 'destructive',
      })
      return
    }

    // Se já estiver processando um voto para este jogo, ignora clique duplo
    if (votandoJogoId === jogoId) return

    setVotandoJogoId(jogoId)
    try {
      const res = await toggleVotoJogo(activePoll.id, jogoId, limiteVotos)
      setMeusVotosIds((prev) => {
        const next = new Set(prev)
        if (res.voted) next.add(jogoId)
        else next.delete(jogoId)
        return next
      })

      // Atualização imediata e precisa no estado da interface
      setJogosEnquete((prev) =>
        prev.map((j) => {
          if (j.id === jogoId) {
            const countDiff = res.voted ? 1 : -1
            const myName = participantName || user?.name || user?.username || 'Eu'
            const nextVotantes = res.voted
              ? j.votantes.includes(myName)
                ? j.votantes
                : [...j.votantes, myName]
              : j.votantes.filter((v) => v !== myName)

            // Se o backend retornou totalVotosJogo absoluto, usa-o diretamente; senão ajusta incrementalmente
            const nextTotal =
              res.totalVotosJogo !== undefined
                ? res.totalVotosJogo
                : Math.max(0, j.totalVotos + countDiff)

            return {
              ...j,
              totalVotos: nextTotal,
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
      console.error('[handleToggleVoto] Erro detalhado na votação:', err)
      const rawMsg = err instanceof Error ? err.message : 'Falha ao registrar voto.'
      const friendlyMsg =
        rawMsg.includes('Failed to authenticate') ||
        rawMsg.includes('autenticado') ||
        rawMsg.includes('logado')
          ? 'Você precisa estar logado para votar. Acesse sua conta e tente novamente.'
          : rawMsg.includes('Something went wrong')
            ? 'Não foi possível gravar o voto no momento. Tente novamente em alguns instantes.'
            : rawMsg

      toast({
        title: 'Aviso de votação',
        description: friendlyMsg,
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
          formatEnqueteTituloDinamico({
            titulo: 'Enquete Copa Coni',
            data_inicio: dataInicio,
            data_fim: dataFim,
            jogos: normalizedFixtures,
            incluirStatus: false,
          }),
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

    // Atualiza ou sugere título recalculando dinamicamente com o novo jogo incluído
    if (!tituloEnquete || tituloEnquete.startsWith('Enquete Copa Coni')) {
      setTituloEnquete(
        formatEnqueteTituloDinamico({
          titulo: tituloEnquete || 'Enquete Copa Coni',
          data_inicio: dataInicio,
          data_fim: dataFim,
          jogos: [novoJogoManual, ...jogosEncontrados],
          incluirStatus: false,
        }),
      )
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
    const restantes = jogosEncontrados.filter((j) => j.id !== jogoId)
    setJogosEncontrados(restantes)
    setJogosPreSelecionados((prev) => {
      const next = new Set(prev)
      next.delete(jogoId)
      return next
    })
    if (restantes.length > 0 && (!tituloEnquete || tituloEnquete.startsWith('Enquete Copa Coni'))) {
      setTituloEnquete(
        formatEnqueteTituloDinamico({
          titulo: tituloEnquete || 'Enquete Copa Coni',
          data_inicio: dataInicio,
          data_fim: dataFim,
          jogos: restantes,
          incluirStatus: false,
        }),
      )
    }
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
        dataLimiteVotacao: dataLimiteVotacao.trim() || undefined,
        jogos: jogosParaSalvar,
        limiteVotos: Number(limiteVotosCriacao) || 4,
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
      setLimiteVotosCriacao('4')
      setFormManualAberto(false)
      setManualTimeA('')
      setManualTimeB('')
      setManualCompeticao('')
      setManualAvisoMargem(null)
      setManualAvisoDuplicado(null)
      setDataLimiteVotacao(datasPadrao.dataFim ? `${datasPadrao.dataFim}T12:00` : '')

      await carregarListaEnquetes(false)
      setActivePoll(nova)
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
    setAtivaManualFixtureId('')
    setAtivaManualLogoCasa('')
    setAtivaManualLogoVisitante('')
    setOrigemAtivaLogoCasa('auto')
    setOrigemAtivaLogoVisitante('auto')
    setAtivaManualCompeticao('')
    setAtivaManualData(activePoll?.data_inicio || datasPadrao.dataInicio)
    setAtivaManualHorario('16:00')
    setAtivaManualAvisoMargem(null)
    setAtivaManualAvisoDuplicado(null)
    setDialogAdicionarManualAtivaOpen(true)
  }

  // Admin: Salvar jogo manual na enquete ativa
  const handleSalvarJogoManualAtiva = async () => {
    if (!activePoll) return

    const timeA = ativaManualMandante.trim()
    const timeB = ativaManualVisitante.trim()
    const fixtureIdClean = ativaManualFixtureId.replace(/\D/g, '').trim()
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

    // Resolução de escudos:
    // Se o usuário digitou uma URL customizada, usa ela; se deixou vazio, tenta resolver da tabela canônica
    let logoAFinal = customLogoA || readEscudoCache(timeA) || getClubLogoUrl(timeA) || ''
    let logoBFinal = customLogoB || readEscudoCache(timeB) || getClubLogoUrl(timeB) || ''

    const regiaoCalculada =
      competicao.toLowerCase().includes('brasileir') || competicao.toLowerCase().includes('copa')
        ? 'Brasileirão & Copas'
        : 'Futebol Europeu'

    setSalvandoJogoAtiva(true)
    try {
      const novoRegistro = await adicionarJogoManualNaEnquete({
        enqueteId: activePoll.id,
        time_a: timeA,
        time_b: timeB,
        fixture_id: fixtureIdClean,
        logo_casa: logoAFinal,
        logo_visitante: logoBFinal,
        campeonato: competicao,
        regiao: regiaoCalculada,
        data: dataFinal,
        horario: horaFinal,
      })

      const saveMeta = (novoRegistro as any)._saveMeta

      // Feedback amigável conforme o que foi resolvido ao salvar:
      if (saveMeta?.autoLookupSucesso && saveMeta?.fixtureIdEncontrado) {
        toast({
          title: 'ID e escudos vinculados!',
          description: `Partida localizada na API-Football (ID #${saveMeta.fixtureIdEncontrado}) e escudos oficiais salvos automaticamente.`,
        })
      } else if (saveMeta?.escudosAtualizados) {
        toast({
          title: 'Escudos oficiais salvos!',
          description: 'URLs de escudos atualizadas com as imagens oficiais da API-Football.',
        })
      }

      if (saveMeta?.rateLimited && saveMeta?.aviso) {
        toast({
          title: 'Cota diária da API',
          description: saveMeta.aviso,
        })
      } else if (fixtureIdClean && (!novoRegistro.logo_casa || !novoRegistro.logo_visitante)) {
        toast({
          title: 'Escudos pendentes',
          description:
            'O jogo foi cadastrado com o ID da partida intacto. Os escudos oficiais ficaram pendentes devido à cota da API ou conexão.',
        })
      }

      // Normaliza no fuso America/Sao_Paulo (UTC-3)
      const spNovo = formatDataHoraSaoPaulo(novoRegistro.data, novoRegistro.horario)
      const novoJogoComVotos: JogoComVotos = {
        ...novoRegistro,
        fixture_id:
          novoRegistro.fixture_id || fixtureIdClean || saveMeta?.fixtureIdEncontrado || '',
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

  // Admin: Função utilitária para buscar escudos pela fixture na edição
  const handleBuscarEscudosPorFixtureEdit = async (
    fidParam?: string,
    forcedLogos?: { home?: string; away?: string },
  ) => {
    const rawFid = fidParam !== undefined ? fidParam : editFixtureId
    const cleanId = rawFid.replace(/\D/g, '').trim()

    if (forcedLogos?.home || forcedLogos?.away) {
      if (forcedLogos.home) {
        setEditLogoCasa(forcedLogos.home)
      }
      if (forcedLogos.away) {
        setEditLogoVisitante(forcedLogos.away)
      }
      return
    }

    if (!cleanId) return

    setBuscandoFixtureEdit(true)
    try {
      const res = await buscarFixtureDetalhes(cleanId)
      if (res.success && res.fixture) {
        let mudou = false
        if (res.fixture.homeTeamLogo) {
          setEditLogoCasa(res.fixture.homeTeamLogo)
          mudou = true
        }
        if (res.fixture.awayTeamLogo) {
          setEditLogoVisitante(res.fixture.awayTeamLogo)
          mudou = true
        }
        if (mudou) {
          toast({
            title: 'Escudos atualizados pela API',
            description: `Escudos oficiais vinculados à fixture ${cleanId} aplicados ao formulário.`,
          })
        }
      } else if (res.rate_limited) {
        toast({
          title: 'Limite da API atingido',
          description:
            'Limite diário da API-Sports atingido (80/dia, reset às 21h). O ID foi mantido para salvamento.',
        })
      }
    } catch {
      /* ignore */
    } finally {
      setBuscandoFixtureEdit(false)
    }
  }

  // Admin: Função utilitária para buscar escudos pela fixture na adição manual
  const handleBuscarEscudosPorFixtureAtiva = async (
    fidParam?: string,
    forcedLogos?: { home?: string; away?: string },
  ) => {
    const rawFid = fidParam !== undefined ? fidParam : ativaManualFixtureId
    const cleanId = rawFid.replace(/\D/g, '').trim()

    if (forcedLogos?.home || forcedLogos?.away) {
      if (forcedLogos.home) {
        setAtivaManualLogoCasa(forcedLogos.home)
      }
      if (forcedLogos.away) {
        setAtivaManualLogoVisitante(forcedLogos.away)
      }
      return
    }

    if (!cleanId) return

    setBuscandoFixtureAtiva(true)
    try {
      const res = await buscarFixtureDetalhes(cleanId)
      if (res.success && res.fixture) {
        let mudou = false
        if (res.fixture.homeTeamLogo) {
          setAtivaManualLogoCasa(res.fixture.homeTeamLogo)
          mudou = true
        }
        if (res.fixture.awayTeamLogo) {
          setAtivaManualLogoVisitante(res.fixture.awayTeamLogo)
          mudou = true
        }
        if (mudou) {
          toast({
            title: 'Escudos atualizados pela API',
            description: `Escudos oficiais vinculados à fixture ${cleanId} aplicados ao formulário.`,
          })
        }
      } else if (res.rate_limited) {
        toast({
          title: 'Limite da API atingido',
          description:
            'Limite diário da API-Sports atingido (80/dia, reset às 21h). O ID foi mantido para salvamento.',
        })
      }
    } catch {
      /* ignore */
    } finally {
      setBuscandoFixtureAtiva(false)
    }
  }

  // Admin: Botão explícito "Buscar ID" no modal Adicionar Jogo Manual na Enquete Ativa
  // Se o campo de ID contiver um valor numérico, busca diretamente pela fixture na API-Football
  // e preenche os escudos mandante e visitante (além de nomes/liga se vazios).
  // Se o ID estiver vazio, faz fallback para busca por Mandante + Visitante + Data.
  const handleBuscarIdManualAtiva = async () => {
    const fidManual = ativaManualFixtureId.replace(/\D/g, '').trim()

    if (fidManual) {
      setBuscandoFixtureAtiva(true)
      setAvisoBuscaAtiva(null)
      try {
        const res = await buscarFixtureDetalhes(fidManual)
        if (res.success && res.fixture) {
          const f = res.fixture
          const fidStr = String(f.id || fidManual).replace(/\D/g, '')
          setAtivaManualFixtureId(fidStr)
          setAutoLookupAtivaFeedback(`ID #${fidStr} identificado`)
          setAlternativasAtiva([])
          setAvisoBuscaAtiva(null)

          // Sempre atualiza os escudos mandante e visitante com o que a API retornar
          if (f.homeTeamLogo) {
            setAtivaManualLogoCasa(f.homeTeamLogo)
          }
          if (f.awayTeamLogo) {
            setAtivaManualLogoVisitante(f.awayTeamLogo)
          }

          // Preenche nomes dos times apenas se ainda não preenchidos pelo usuário
          if (f.homeTeamName && !ativaManualMandante.trim()) {
            setAtivaManualMandante(f.homeTeamName)
          }
          if (f.awayTeamName && !ativaManualVisitante.trim()) {
            setAtivaManualVisitante(f.awayTeamName)
          }

          // Preenche competição e data apenas se ainda não preenchidos
          if (f.leagueName && !ativaManualCompeticao.trim()) {
            setAtivaManualCompeticao(f.leagueName)
          }
          if (f.date && !ativaManualData.trim()) {
            try {
              const dtParts = f.date.split('T')
              if (dtParts[0]) setAtivaManualData(dtParts[0])
            } catch {
              /* ignore */
            }
          }

          toast({
            title: 'Partida identificada!',
            description: `ID #${fidStr} e escudos oficiais vinculados com sucesso.`,
          })
        } else if (res.rate_limited) {
          const aviso =
            'Cota diária da API atingida (80/dia, reset às 21h). O ID foi mantido para salvamento.'
          setAvisoBuscaAtiva(aviso)
          toast({
            title: 'Cota de requisições atingida',
            description: aviso,
          })
        } else {
          setAvisoBuscaAtiva(
            res.error || `Nenhuma partida encontrada na API-Football para o ID #${fidManual}.`,
          )
          toast({
            title: 'Partida não encontrada',
            description: `Nenhum confronto localizado na API-Football para o ID #${fidManual}.`,
            variant: 'destructive',
          })
        }
      } catch {
        setAvisoBuscaAtiva('Falha na comunicação com o serviço de busca da API.')
      } finally {
        setBuscandoFixtureAtiva(false)
      }
      return
    }

    // Fallback: busca por mandante e data quando ID estiver vazio
    const mandante = ativaManualMandante.trim()
    const visitante = ativaManualVisitante.trim()
    const data = ativaManualData.trim()

    if (!mandante || !data) {
      toast({
        title: 'Preencha o ID ou os campos',
        description: 'Informe o ID da partida ou preencha ao menos o Mandante e a Data do jogo.',
        variant: 'destructive',
      })
      return
    }

    setBuscandoAutoLookupAtiva(true)
    setAvisoBuscaAtiva(null)
    try {
      const res = await buscarFixtureAutoLookup({ mandante, visitante, data })
      if (res.success && res.fixture?.id) {
        const fidStr = String(res.fixture.id).replace(/\D/g, '')
        setAtivaManualFixtureId(fidStr)
        setAutoLookupAtivaFeedback(`ID #${fidStr} encontrado`)
        setAlternativasAtiva([])
        setAvisoBuscaAtiva(null)

        // Preenche escudos com os oficiais da API
        if (res.fixture.homeTeamLogo) {
          setAtivaManualLogoCasa(res.fixture.homeTeamLogo)
        }
        if (res.fixture.awayTeamLogo) {
          setAtivaManualLogoVisitante(res.fixture.awayTeamLogo)
        }

        toast({
          title: 'ID Encontrado!',
          description: `ID #${fidStr} e escudos oficiais vinculados com sucesso.`,
        })
      } else if (res.rate_limited) {
        const aviso =
          'Cota diária da API atingida (80/dia, reset às 21h). Você ainda pode salvar manualmente.'
        setAvisoBuscaAtiva(aviso)
        toast({
          title: 'Cota de requisições atingida',
          description: aviso,
        })
      } else {
        // Não encontrou correspondência única
        const alts = Array.isArray(res.alternativas) ? res.alternativas : []
        setAlternativasAtiva(alts)
        const msgAviso =
          alts.length > 0
            ? `Encontradas ${alts.length} partidas naquela data. Selecione uma abaixo para preencher o formulário:`
            : 'Nenhuma correspondência exata encontrada para a data informada. Verifique os nomes ou selecione uma alternativa.'
        setAvisoBuscaAtiva(msgAviso)
      }
    } catch {
      setAvisoBuscaAtiva('Falha na comunicação com o serviço de busca da API.')
    } finally {
      setBuscandoAutoLookupAtiva(false)
    }
  }

  // Admin: Botão explícito "Buscar ID" no modal Editar Jogo da Enquete
  // Se o campo de ID contiver um valor numérico, busca diretamente pela fixture na API-Football
  // e preenche os escudos mandante e visitante (além de nomes/liga se vazios).
  // Se o ID estiver vazio, faz fallback para busca por Mandante + Visitante + Data.
  const handleBuscarIdManualEdit = async () => {
    const fidManual = editFixtureId.replace(/\D/g, '').trim()

    if (fidManual) {
      setBuscandoFixtureEdit(true)
      setAvisoBuscaEdit(null)
      try {
        const res = await buscarFixtureDetalhes(fidManual)
        if (res.success && res.fixture) {
          const f = res.fixture
          const fidStr = String(f.id || fidManual).replace(/\D/g, '')
          setEditFixtureId(fidStr)
          setAutoLookupEditFeedback(`ID #${fidStr} identificado`)
          setAlternativasEdit([])
          setAvisoBuscaEdit(null)

          // Sempre atualiza os escudos mandante e visitante com o que a API retornar
          if (f.homeTeamLogo) {
            setEditLogoCasa(f.homeTeamLogo)
          }
          if (f.awayTeamLogo) {
            setEditLogoVisitante(f.awayTeamLogo)
          }

          // Preenche nomes dos times apenas se ainda não preenchidos pelo usuário
          if (f.homeTeamName && !editMandante.trim()) {
            setEditMandante(f.homeTeamName)
          }
          if (f.awayTeamName && !editVisitante.trim()) {
            setEditVisitante(f.awayTeamName)
          }

          // Preenche competição e data apenas se ainda não preenchidos
          if (f.leagueName && !editCompeticao.trim()) {
            setEditCompeticao(f.leagueName)
          }
          if (f.date && !editData.trim()) {
            try {
              const dtParts = f.date.split('T')
              if (dtParts[0]) setEditData(dtParts[0])
            } catch {
              /* ignore */
            }
          }

          toast({
            title: 'Partida identificada!',
            description: `ID #${fidStr} e escudos oficiais vinculados com sucesso.`,
          })
        } else if (res.rate_limited) {
          const aviso =
            'Cota diária da API atingida (80/dia, reset às 21h). O ID foi mantido para salvamento.'
          setAvisoBuscaEdit(aviso)
          toast({
            title: 'Cota de requisições atingida',
            description: aviso,
          })
        } else {
          setAvisoBuscaEdit(
            res.error || `Nenhuma partida encontrada na API-Football para o ID #${fidManual}.`,
          )
          toast({
            title: 'Partida não encontrada',
            description: `Nenhum confronto localizado na API-Football para o ID #${fidManual}.`,
            variant: 'destructive',
          })
        }
      } catch {
        setAvisoBuscaEdit('Falha na comunicação com o serviço de busca da API.')
      } finally {
        setBuscandoFixtureEdit(false)
      }
      return
    }

    // Fallback: busca por mandante e data quando ID estiver vazio
    const mandante = editMandante.trim()
    const visitante = editVisitante.trim()
    const data = editData.trim()

    if (!mandante || !data) {
      toast({
        title: 'Preencha o ID ou os campos',
        description: 'Informe o ID da partida ou preencha ao menos o Mandante e a Data do jogo.',
        variant: 'destructive',
      })
      return
    }

    setBuscandoAutoLookupEdit(true)
    setAvisoBuscaEdit(null)
    try {
      const res = await buscarFixtureAutoLookup({ mandante, visitante, data })
      if (res.success && res.fixture?.id) {
        const fidStr = String(res.fixture.id).replace(/\D/g, '')
        setEditFixtureId(fidStr)
        setAutoLookupEditFeedback(`ID #${fidStr} encontrado`)
        setAlternativasEdit([])
        setAvisoBuscaEdit(null)

        // Preenche escudos com os oficiais da API
        if (res.fixture.homeTeamLogo) {
          setEditLogoCasa(res.fixture.homeTeamLogo)
        }
        if (res.fixture.awayTeamLogo) {
          setEditLogoVisitante(res.fixture.awayTeamLogo)
        }

        toast({
          title: 'ID Encontrado!',
          description: `ID #${fidStr} e escudos oficiais vinculados com sucesso.`,
        })
      } else if (res.rate_limited) {
        const aviso =
          'Cota diária da API atingida (80/dia, reset às 21h). Você ainda pode salvar manualmente.'
        setAvisoBuscaEdit(aviso)
        toast({
          title: 'Cota de requisições atingida',
          description: aviso,
        })
      } else {
        const alts = Array.isArray(res.alternativas) ? res.alternativas : []
        setAlternativasEdit(alts)
        const msgAviso =
          alts.length > 0
            ? `Encontradas ${alts.length} partidas naquela data. Selecione uma abaixo para preencher o formulário:`
            : 'Nenhuma correspondência exata encontrada para a data informada. Verifique os nomes ou selecione uma alternativa.'
        setAvisoBuscaEdit(msgAviso)
      }
    } catch {
      setAvisoBuscaEdit('Falha na comunicação com o serviço de busca da API.')
    } finally {
      setBuscandoAutoLookupEdit(false)
    }
  }

  // Preenche formulário a partir de uma alternativa selecionada (Adição Manual)
  const handleSelecionarAlternativaAtiva = (alt: FixtureDetalhesItem) => {
    const fidStr = String(alt.id).replace(/\D/g, '')
    setAtivaManualFixtureId(fidStr)
    setAutoLookupAtivaFeedback(`ID #${fidStr} selecionado`)
    if (alt.homeTeamName && !ativaManualMandante) setAtivaManualMandante(alt.homeTeamName)
    if (alt.awayTeamName && !ativaManualVisitante) setAtivaManualVisitante(alt.awayTeamName)
    if (alt.homeTeamLogo && !isApiSportsLogo(ativaManualLogoCasa))
      setAtivaManualLogoCasa(alt.homeTeamLogo)
    if (alt.awayTeamLogo && !isApiSportsLogo(ativaManualLogoVisitante))
      setAtivaManualLogoVisitante(alt.awayTeamLogo)
    if (alt.leagueName && !ativaManualCompeticao) setAtivaManualCompeticao(alt.leagueName)
    setAlternativasAtiva([])
    setAvisoBuscaAtiva(null)
    toast({
      title: 'Partida selecionada',
      description: `ID #${fidStr} e escudos aplicados ao formulário.`,
    })
  }

  // Preenche formulário a partir de uma alternativa selecionada (Edição)
  const handleSelecionarAlternativaEdit = (alt: FixtureDetalhesItem) => {
    const fidStr = String(alt.id).replace(/\D/g, '')
    setEditFixtureId(fidStr)
    setAutoLookupEditFeedback(`ID #${fidStr} selecionado`)
    if (alt.homeTeamName) setEditMandante(alt.homeTeamName)
    if (alt.awayTeamName) setEditVisitante(alt.awayTeamName)
    if (alt.homeTeamLogo && !isApiSportsLogo(editLogoCasa)) setEditLogoCasa(alt.homeTeamLogo)
    if (alt.awayTeamLogo && !isApiSportsLogo(editLogoVisitante))
      setEditLogoVisitante(alt.awayTeamLogo)
    if (alt.leagueName && !editCompeticao) setEditCompeticao(alt.leagueName)
    setAlternativasEdit([])
    setAvisoBuscaEdit(null)
    toast({
      title: 'Partida selecionada',
      description: `ID #${fidStr} e escudos aplicados ao formulário.`,
    })
  }

  // Auto-Lookup com Debounce para Modal de Criação Manual (800ms)
  useEffect(() => {
    if (!dialogAdicionarManualAtivaOpen) return
    const mandante = ativaManualMandante.trim()
    const visitante = ativaManualVisitante.trim()
    const data = ativaManualData.trim()

    // Só dispara se Mandante, Visitante e Data estiverem preenchidos e não houver ID digitado manualmente
    if (!mandante || !visitante || !data) {
      setAutoLookupAtivaFeedback(null)
      return
    }

    // Se o usuário já informou um ID manualmente, não sobressai auto-lookup a menos que o campo esteja vazio
    if (ativaManualFixtureId) {
      return
    }

    let isMounted = true
    setBuscandoAutoLookupAtiva(true)
    const timer = setTimeout(async () => {
      try {
        const res = await buscarFixtureAutoLookup({ mandante, visitante, data })
        if (!isMounted) return
        if (res.success && res.fixture?.id) {
          const fidStr = String(res.fixture.id).replace(/\D/g, '')
          setAtivaManualFixtureId(fidStr)
          setAutoLookupAtivaFeedback(`ID #${fidStr} encontrado automaticamente`)

          // Atualiza escudos com os oficiais da API-Sports
          if (res.fixture.homeTeamLogo && !isApiSportsLogo(ativaManualLogoCasa)) {
            setAtivaManualLogoCasa(res.fixture.homeTeamLogo)
          }
          if (res.fixture.awayTeamLogo && !isApiSportsLogo(ativaManualLogoVisitante)) {
            setAtivaManualLogoVisitante(res.fixture.awayTeamLogo)
          }
        } else {
          setAutoLookupAtivaFeedback(null)
        }
      } catch {
        if (isMounted) setAutoLookupAtivaFeedback(null)
      } finally {
        if (isMounted) setBuscandoAutoLookupAtiva(false)
      }
    }, 800)

    return () => {
      isMounted = false
      clearTimeout(timer)
      setBuscandoAutoLookupAtiva(false)
    }
  }, [
    ativaManualMandante,
    ativaManualVisitante,
    ativaManualData,
    dialogAdicionarManualAtivaOpen,
    ativaManualFixtureId,
    ativaManualLogoCasa,
    ativaManualLogoVisitante,
  ])

  // Auto-Lookup com Debounce para Modal de Edição de Jogo (800ms)
  useEffect(() => {
    if (!dialogEditarJogoOpen || !jogoEmEdicao) return
    const mandante = editMandante.trim()
    const visitante = editVisitante.trim()
    const data = editData.trim()

    if (!mandante || !visitante || !data) {
      setAutoLookupEditFeedback(null)
      return
    }

    // Se já tiver fixture_id (pré-carregado ou digitado), não sobrescreve
    if (editFixtureId) {
      return
    }

    let isMounted = true
    setBuscandoAutoLookupEdit(true)
    const timer = setTimeout(async () => {
      try {
        const res = await buscarFixtureAutoLookup({ mandante, visitante, data })
        if (!isMounted) return
        if (res.success && res.fixture?.id) {
          const fidStr = String(res.fixture.id).replace(/\D/g, '')
          setEditFixtureId(fidStr)
          setAutoLookupEditFeedback(`ID #${fidStr} encontrado automaticamente`)

          // Atualiza escudos com os oficiais da API-Sports
          if (res.fixture.homeTeamLogo && !isApiSportsLogo(editLogoCasa)) {
            setEditLogoCasa(res.fixture.homeTeamLogo)
          }
          if (res.fixture.awayTeamLogo && !isApiSportsLogo(editLogoVisitante)) {
            setEditLogoVisitante(res.fixture.awayTeamLogo)
          }
        } else {
          setAutoLookupEditFeedback(null)
        }
      } catch {
        if (isMounted) setAutoLookupEditFeedback(null)
      } finally {
        if (isMounted) setBuscandoAutoLookupEdit(false)
      }
    }, 800)

    return () => {
      isMounted = false
      clearTimeout(timer)
      setBuscandoAutoLookupEdit(false)
    }
  }, [
    editMandante,
    editVisitante,
    editData,
    dialogEditarJogoOpen,
    jogoEmEdicao,
    editFixtureId,
    editLogoCasa,
    editLogoVisitante,
  ])

  // Admin: Abrir modal de edição de confronto
  const handleAbrirModalEditarJogo = (jogo: JogoComVotos, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setJogoEmEdicao(jogo)
    setEditMandante(jogo.time_a)
    setEditVisitante(jogo.time_b)
    setEditFixtureId(jogo.fixture_id ? String(jogo.fixture_id).replace(/\D/g, '').trim() : '')
    const lCasa = jogo.logo_casa || ''
    const lVis = jogo.logo_visitante || ''
    setEditLogoCasa(lCasa)
    setEditLogoVisitante(lVis)
    const isAutoLogo = (u: string) =>
      u.includes('thesportsdb.com') ||
      u.includes('media.api-sports.io') ||
      u.includes('flagcdn.com')
    setOrigemEditLogoCasa(!lCasa || isAutoLogo(lCasa) ? 'auto' : 'manual')
    setOrigemEditLogoVisitante(!lVis || isAutoLogo(lVis) ? 'auto' : 'manual')
    setEditCompeticao(jogo.campeonato || '')
    setEditData(jogo.data)
    setEditHorario(jogo.horario || '16:00')
    setEditAvisoMargem(null)
    setAutoLookupEditFeedback(null)
    setDialogEditarJogoOpen(true)
  }

  // Admin: Salvar edição de confronto
  const handleSalvarEdicaoJogo = async () => {
    if (!jogoEmEdicao) return

    const timeA = editMandante.trim()
    const timeB = editVisitante.trim()
    const cleanEditFixtureId = editFixtureId.replace(/\D/g, '').trim()
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

    // Resolução de escudos:
    // REGRA 1: URL vazia + nome alterado → re-busca automática do escudo pelo NOVO nome via cascata (buscarEscudoTime)
    // REGRA 2: URL preenchida → prioridade absoluta, mantida
    // REGRA 3: URL vazia e nome NÃO alterado → preserva o vazio
    let logoAFinal = customLogoA
    let logoBFinal = customLogoB

    const origTimeA = (jogoEmEdicao.time_a || '').trim().toLowerCase()
    const origTimeB = (jogoEmEdicao.time_b || '').trim().toLowerCase()
    const mudouNomeA = origTimeA !== timeA.toLowerCase()
    const mudouNomeB = origTimeB !== timeB.toLowerCase()

    const buscaPromessas: Promise<void>[] = []
    if (!logoAFinal && mudouNomeA) {
      buscaPromessas.push(
        buscarEscudoTime(timeA)
          .then((badge) => {
            if (badge) logoAFinal = badge
          })
          .catch(() => {}),
      )
    }
    if (!logoBFinal && mudouNomeB) {
      buscaPromessas.push(
        buscarEscudoTime(timeB)
          .then((badge) => {
            if (badge) logoBFinal = badge
          })
          .catch(() => {}),
      )
    }

    if (buscaPromessas.length > 0) {
      await Promise.all(buscaPromessas)
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
        fixture_id: cleanEditFixtureId,
        logo_casa: logoAFinal,
        logo_visitante: logoBFinal,
        campeonato: competicao,
        regiao: regiaoCalculada,
        data: dataFinal,
        horario: horaFinal,
      })

      const saveMeta = (atualizado as any)._saveMeta

      // Feedback amigável conforme o que foi resolvido ao salvar:
      if (saveMeta?.autoLookupSucesso && saveMeta?.fixtureIdEncontrado) {
        toast({
          title: 'ID e escudos vinculados!',
          description: `Partida localizada na API-Football (ID #${saveMeta.fixtureIdEncontrado}) e escudos oficiais salvos automaticamente.`,
        })
      } else if (saveMeta?.escudosAtualizados) {
        toast({
          title: 'Escudos oficiais salvos!',
          description: 'URLs de escudos atualizadas com as imagens oficiais da API-Football.',
        })
      }

      if (saveMeta?.rateLimited && saveMeta?.aviso) {
        toast({
          title: 'Cota diária da API',
          description: saveMeta.aviso,
        })
      } else if (cleanEditFixtureId && (!atualizado.logo_casa || !atualizado.logo_visitante)) {
        toast({
          title: 'Escudos pendentes',
          description:
            'O confronto foi salvo com o ID da partida intacto. Os escudos oficiais ficaram pendentes devido à cota da API ou conexão.',
        })
      }

      // Atualiza o estado React imediatamente mantendo os votos já computados.
      // IMPORTANTE: se o admin limpou o escudo, o valor salvo é string vazia.
      // Não fazer fallback com `||` que recuperaria a URL antiga se for string vazia!
      setJogosEnquete((prev) =>
        prev.map((j) => {
          if (j.id === jogoEmEdicao.id) {
            return {
              ...j,
              time_a: atualizado.time_a,
              time_b: atualizado.time_b,
              fixture_id:
                atualizado.fixture_id !== undefined
                  ? atualizado.fixture_id
                  : cleanEditFixtureId || j.fixture_id,
              logo_casa: atualizado.logo_casa !== undefined ? atualizado.logo_casa : logoAFinal,
              logo_visitante:
                atualizado.logo_visitante !== undefined ? atualizado.logo_visitante : logoBFinal,
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
    if (!activePoll) return
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
      const res = await cadastrarJogosAprovadosNaCopaConi(activePoll.id, jogosAprovadosParaConi)
      toast({
        title: 'Jogos cadastrados na Copa Coni!',
        description: `${res.cadastrados} partida(s) inserida(s) automaticamente no bolão ${res.bolaoNome} sem digitação manual.`,
      })
      setConfirmCadastrarOpen(false)
      await carregarDetalhesEnquete(activePoll.id, false)
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
    if (!activePoll) return
    if (novoStatus === 'aberta') {
      // Abre modal para definir nova data/hora limite de votação
      const baseData = activePoll.data_limite_votacao
        ? activePoll.data_limite_votacao.replace(' ', 'T').slice(0, 16)
        : activePoll.data_fim
          ? `${activePoll.data_fim}T12:00`
          : ''
      setReabrirNovaDataLimite(baseData)
      setDialogReabrirOpen(true)
      return
    }

    try {
      await atualizarStatusEnquete(activePoll.id, novoStatus)
      setActivePoll((prev) => (prev ? { ...prev, status: novoStatus } : null))
      toast({
        title: 'Votação encerrada!',
        description: 'Os participantes não podem mais alterar votos.',
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

  // Admin: Confirmar Reabertura com Nova Data Limite
  const handleConfirmarReabrirVotacao = async () => {
    if (!activePoll) return
    setReabrindoVotacao(true)
    try {
      const novaDataLimiteTrim = reabrirNovaDataLimite.trim()
      await atualizarStatusEnquete(activePoll.id, 'aberta', novaDataLimiteTrim || undefined)
      setActivePoll((prev) =>
        prev
          ? {
              ...prev,
              status: 'aberta',
              data_limite_votacao: novaDataLimiteTrim || prev.data_limite_votacao,
            }
          : null,
      )
      toast({
        title: 'Votação reaberta!',
        description: 'Os participantes podem votar normalmente com o novo prazo configurado.',
      })
      setDialogReabrirOpen(false)
      await carregarListaEnquetes(false)
    } catch (err) {
      toast({
        title: 'Erro ao reabrir votação',
        description: 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setReabrindoVotacao(false)
    }
  }

  // Admin: Excluir enquete
  const handleExcluirEnquete = async () => {
    if (!activePoll) return
    setExcluindoEnquete(true)
    try {
      await excluirEnquete(activePoll.id)
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

  // Card de jogo para votação da enquete memoizado com React.memo
  const EnqueteJogoVotacaoCard = React.useMemo(() => {
    return React.memo(
      function EnqueteJogoVotacaoCard({
        jogo,
        votado,
        isTop4,
        isBlocked,
        statusEnquete,
        participantName,
        isAdmin,
        onToggleVoto,
        onEditar,
        onExcluir,
      }: {
        jogo: JogoComVotos
        votado: boolean
        isTop4: boolean
        isBlocked: boolean
        statusEnquete: string
        participantName: string
        isAdmin: boolean
        onToggleVoto: (id: string) => void
        onEditar: (jogo: JogoComVotos, e: React.MouseEvent) => void
        onExcluir: (jogo: JogoComVotos, e: React.MouseEvent) => void
      }) {
        return (
          <Card
            onClick={() => {
              if (statusEnquete === 'aberta') {
                onToggleVoto(jogo.id)
              }
            }}
            className={`relative transition-all duration-200 hover:shadow-md ${
              votado
                ? 'cursor-pointer border-2 border-emerald-500 bg-emerald-50/40 shadow-xs'
                : isBlocked
                  ? 'border-slate-200 bg-slate-50/70 opacity-50 cursor-not-allowed'
                  : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
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
                        onClick={(e) => onEditar(jogo, e)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-600 transition"
                        title="Editar jogo"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => onExcluir(jogo, e)}
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
                  <EnqueteTeamBadge
                    nomeTime={jogo.time_a}
                    savedLogo={jogo.logo_casa}
                    fixtureId={jogo.fixture_id}
                    isSide="home"
                    sizeClass="h-7 w-7 sm:h-8 sm:w-8 min-w-[28px] min-h-[28px] shrink-0 object-contain"
                  />
                  <span
                    className="min-w-0 truncate text-[11px] sm:text-xs font-bold text-slate-800 leading-tight"
                    title={jogo.time_a}
                  >
                    {jogo.time_a}
                  </span>
                </div>

                {/* Versus */}
                <div className="px-1 text-[11px] font-black text-slate-400 shrink-0">x</div>

                {/* Time B */}
                <div className="flex flex-1 items-center justify-end gap-2 text-right min-w-0">
                  <span
                    className="min-w-0 truncate text-[11px] sm:text-xs font-bold text-slate-800 leading-tight text-right"
                    title={jogo.time_b}
                  >
                    {jogo.time_b}
                  </span>
                  <EnqueteTeamBadge
                    nomeTime={jogo.time_b}
                    savedLogo={jogo.logo_visitante}
                    fixtureId={jogo.fixture_id}
                    isSide="away"
                    sizeClass="h-7 w-7 sm:h-8 sm:w-8 min-w-[28px] min-h-[28px] shrink-0 object-contain"
                  />
                </div>
              </div>

              {/* Rodapé do Card: Checkbox e Contagem de Votos */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                {/* Indicador de Seleção / Checkbox */}
                <button
                  type="button"
                  disabled={statusEnquete !== 'aberta' || isBlocked}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isBlocked) {
                      onToggleVoto(jogo.id)
                      return
                    }
                    onToggleVoto(jogo.id)
                  }}
                  className={`flex items-center gap-1.5 text-xs font-bold transition ${
                    votado
                      ? 'text-emerald-700 hover:text-emerald-800 cursor-pointer'
                      : isBlocked
                        ? 'text-slate-400 opacity-50 cursor-not-allowed'
                        : 'text-slate-600 hover:text-slate-900 cursor-pointer'
                  }`}
                >
                  {votado ? (
                    <CheckSquare className="h-5 w-5 text-emerald-600 fill-emerald-100" />
                  ) : (
                    <Square
                      className={`h-5 w-5 ${isBlocked ? 'text-slate-300' : 'text-slate-400'}`}
                    />
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
      },
      (prev, next) => {
        return (
          prev.jogo.id === next.jogo.id &&
          prev.votado === next.votado &&
          prev.isTop4 === next.isTop4 &&
          prev.isBlocked === next.isBlocked &&
          prev.statusEnquete === next.statusEnquete &&
          prev.jogo.totalVotos === next.jogo.totalVotos &&
          prev.jogo.votantes.length === next.jogo.votantes.length
        )
      },
    )
  }, [])

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
                  {tituloEnqueteAtiva || 'Enquetes da Copa Coni'}
                </h1>
                <Badge
                  variant="secondary"
                  className="border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800"
                >
                  Jogos da Rodada
                </Badge>
              </div>
              <p className="text-xs text-[#64748B]">
                {tituloEnqueteAtiva
                  ? 'Votação colaborativa do grupo para escolher as partidas que entrarão na Copa Coni.'
                  : 'Votação colaborativa do grupo para escolher as partidas aleatórias que entrarão na rodada.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Botões / Tabs de Navegação entre Enquetes */}
          {enquetesOrdenadas.length > 0 && (
            <div
              role="tablist"
              aria-label="Enquetes disponíveis"
              className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center"
            >
              {enquetesOrdenadas.map((enq) => {
                const isActive = activePoll?.id === enq.id
                const periodoCurto = formatEnquetePeriodoCurto(
                  enq.data_inicio,
                  enq.data_fim,
                  exibirAnoBotoes,
                )
                const isAberta = (enq.status || '').toLowerCase() === 'aberta'
                const isCadastrada = (enq.status || '').toLowerCase() === 'cadastrada'
                const statusTextoCurto = isAberta
                  ? 'Aberta'
                  : isCadastrada
                    ? 'Cadastrada'
                    : 'Encerrada'

                return (
                  <button
                    key={enq.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleSelecionarEnquete(enq)}
                    className={`group relative inline-flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:justify-start ${
                      isActive
                        ? 'bg-gradient-to-r from-[#10B981] to-emerald-600 text-white shadow-sm shadow-emerald-950/20'
                        : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {/* Indicador / Badge compacto de status */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        isActive
                          ? isAberta
                            ? 'bg-white/20 text-white'
                            : 'bg-black/20 text-white'
                          : isAberta
                            ? 'bg-emerald-100 text-emerald-800'
                            : isCadastrada
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isActive
                            ? isAberta
                              ? 'bg-white'
                              : 'bg-emerald-100'
                            : isAberta
                              ? 'bg-emerald-500'
                              : isCadastrada
                                ? 'bg-indigo-500'
                                : 'bg-slate-400'
                        }`}
                      />
                      <span>{statusTextoCurto}</span>
                    </span>

                    {/* Período curto */}
                    <span className="font-extrabold tracking-tight">{periodoCurto}</span>
                  </button>
                )
              })}
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
      {loading && !activePoll && (
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
      {activePoll && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Contador de Votos Pessoais */}
          <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
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
                      ? `Limite máximo de ${limiteVotos} votos atingido.`
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
              </div>
              <div className="mt-3">
                <Progress
                  value={Math.min(100, Math.round((totalMeusVotos / limiteVotos) * 100))}
                  className="h-2 bg-emerald-100"
                />
              </div>
            </CardContent>
          </Card>

          {/* Status da Enquete */}
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Status da Votação
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCompartilharWhatsApp}
                    className="h-6 px-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    title="Compartilhar no WhatsApp"
                  >
                    <WhatsAppIcon className="mr-1 h-3.5 w-3.5 text-[#25D366]" />
                    WhatsApp
                  </Button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      !isVotacaoEncerrada && activePoll.status === 'aberta'
                        ? 'bg-emerald-100 text-emerald-800'
                        : activePoll.status === 'cadastrada'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        !isVotacaoEncerrada && activePoll.status === 'aberta'
                          ? 'animate-pulse bg-emerald-500'
                          : activePoll.status === 'cadastrada'
                            ? 'bg-indigo-500'
                            : 'bg-slate-400'
                      }`}
                    />
                    {!isVotacaoEncerrada && activePoll.status === 'aberta'
                      ? 'Votação Aberta'
                      : activePoll.status === 'cadastrada'
                        ? 'Jogos Cadastrados na Copa Coni'
                        : 'Votação Encerrada'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-700">
                  Votação Encerra em:{' '}
                  <span className="font-bold text-[#0F2A43]">
                    {formatEnquetePrazoLimiteBR(
                      activePoll.data_limite_votacao,
                      activePoll.data_fim,
                    )}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Período dos jogos: {formatDataBR(activePoll.data_inicio)} até{' '}
                  {formatDataBR(activePoll.data_fim)}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <Calendar className="h-6 w-6 text-slate-600" />
              </div>
            </CardContent>
          </Card>

          {/* Resumo do Apurador / Seleção */}
          <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white shadow-xs">
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
                    : 'Partidas confirmadas pelo Administrador para a rodada.'}
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
      {activePoll && (
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
                  variant="outline"
                  size="sm"
                  onClick={handleAbrirModalEditarEnquete}
                  className="h-8 border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs"
                  title="Editar Enquete"
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5 text-amber-600" />
                  Editar Enquete
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAbrirModalAdicionarManualAtiva}
                  className="h-8 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700 shadow-xs"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Adicionar Jogo Manual
                </Button>

                {!isVotacaoEncerrada && activePoll.status === 'aberta' ? (
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

                {/* Botões Dinâmicos: Um para cada competição presente nos jogos (normalizado e deduplicado) */}
                {competicoesEnqueteNormalizadas.map((comp) => {
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

                {/* Botão Fixo: Meus Votos com contador de 10 */}
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
                  Meus Votos ({totalMeusVotos}/{limiteVotos})
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
                    ? `Clique nas partidas abaixo no filtro "Todos" para selecionar até ${limiteVotos} confrontos.`
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

            {/* Skeleton de carregamento de jogos se estiver buscando detalhes e ainda não temos confrontos */}
            {loadingDetalhes && jogosEnquete.length === 0 ? (
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
            ) : (
              /* Grade de Confrontos para Votação com Lazy Loading / Paginação Incremental */
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {jogosVisiveis.map((jogo) => {
                  const votado = meusVotosIds.has(jogo.id)
                  const isTop4 = top4JogosIds.has(jogo.id)
                  const isBlocked = !votado && limiteAtingido

                  return (
                    <EnqueteJogoVotacaoCard
                      key={jogo.id}
                      jogo={jogo}
                      votado={votado}
                      isTop4={isTop4}
                      isBlocked={isBlocked}
                      statusEnquete={isVotacaoEncerrada ? 'encerrada' : activePoll.status}
                      participantName={participantName}
                      isAdmin={isAdmin}
                      onToggleVoto={handleToggleVoto}
                      onEditar={handleAbrirModalEditarJogo}
                      onExcluir={handleAbrirModalExcluirJogo}
                    />
                  )
                })}
              </div>
            )}

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
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/60 via-white to-amber-50/40 p-4 shadow-xs sm:flex-row sm:items-center">
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
                          {(() => {
                            const logoA = resolveTeamBadgeUrl({
                              teamName: jogo.time_a,
                              savedBadge: jogo.logo_casa,
                            })
                            const logoB = resolveTeamBadgeUrl({
                              teamName: jogo.time_b,
                              savedBadge: jogo.logo_visitante,
                            })

                            return (
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {/* Escudo Mandante */}
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <EnqueteTeamBadge
                                      nomeTime={jogo.time_a}
                                      savedLogo={jogo.logo_casa}
                                      fixtureId={jogo.fixture_id}
                                      isSide="home"
                                      sizeClass="h-5 w-5 min-w-[20px] min-h-[20px] shrink-0 object-contain"
                                    />
                                    <span
                                      className="min-w-0 truncate text-xs sm:text-sm font-bold text-slate-900 leading-tight"
                                      title={jogo.time_a}
                                    >
                                      {jogo.time_a}
                                    </span>
                                  </div>

                                  <span className="text-xs font-black text-slate-400 shrink-0">
                                    x
                                  </span>

                                  {/* Escudo Visitante */}
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <EnqueteTeamBadge
                                      nomeTime={jogo.time_b}
                                      savedLogo={jogo.logo_visitante}
                                      fixtureId={jogo.fixture_id}
                                      isSide="away"
                                      sizeClass="h-5 w-5 min-w-[20px] min-h-[20px] shrink-0 object-contain"
                                    />
                                    <span
                                      className="min-w-0 truncate text-xs sm:text-sm font-bold text-slate-900 leading-tight"
                                      title={jogo.time_b}
                                    >
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
                                    {formatDataBR(jogo.data)} às{' '}
                                    {formatHoraBR(jogo.horario || '16:00')}
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
                            )
                          })()}
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

      {/* DIALOG ADMIN: Editar Enquete Ativa (Título, Limite, Período, Prazo e Instruções) */}
      <Dialog open={dialogEditarEnqueteOpen} onOpenChange={setDialogEditarEnqueteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Pencil className="h-5 w-5 text-amber-600" />
              Editar Enquete
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Altere as configurações da enquete ativa. Todos os jogos, votos computados e
              estatísticas serão preservados intactos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            {/* Título da Enquete */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-enquete-titulo" className="text-xs font-bold text-slate-700">
                Título da Enquete *:
              </Label>
              <Input
                id="edit-enquete-titulo"
                placeholder="Ex.: Enquete Copa Coni — Rodada 10"
                value={editEnqueteTitulo}
                onChange={(e) => setEditEnqueteTitulo(e.target.value)}
                className="h-9 text-xs font-medium"
              />
            </div>

            {/* Limite de Votos por Participante */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-enquete-limite-votos"
                className="text-xs font-bold text-slate-700"
              >
                Limite de Votos por Participante *:
              </Label>
              <Input
                id="edit-enquete-limite-votos"
                type="number"
                min={1}
                placeholder="4"
                value={editEnqueteLimiteVotos}
                onChange={(e) => setEditEnqueteLimiteVotos(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                Quantidade máxima de confrontos em que cada participante pode votar (mínimo 1).
              </p>
            </div>

            {/* Intervalo de Datas: Inicial e Final */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="edit-enquete-data-inicio"
                  className="text-xs font-bold text-slate-700"
                >
                  Data Inicial *:
                </Label>
                <Input
                  id="edit-enquete-data-inicio"
                  type="date"
                  value={editEnqueteDataInicio}
                  onChange={(e) => setEditEnqueteDataInicio(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-enquete-data-fim" className="text-xs font-bold text-slate-700">
                  Data Final *:
                </Label>
                <Input
                  id="edit-enquete-data-fim"
                  type="date"
                  value={editEnqueteDataFim}
                  onChange={(e) => setEditEnqueteDataFim(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Data e Hora Limite de Votação (datetime-local) */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-enquete-prazo" className="text-xs font-bold text-slate-700">
                Data e Hora Limite de Votação *:
              </Label>
              <Input
                id="edit-enquete-prazo"
                type="datetime-local"
                value={editEnqueteDataLimiteVotacao}
                onChange={(e) => setEditEnqueteDataLimiteVotacao(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                Ao atingir esse prazo, o sistema encerra automaticamente a recepção de votos.
              </p>
            </div>

            {/* Observações / Instruções (Opcional) */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-enquete-descricao"
                className="text-xs font-semibold text-slate-700"
              >
                Observações / Instruções (Opcional):
              </Label>
              <Input
                id="edit-enquete-descricao"
                placeholder="Ex.: Vote em até 4 confrontos para a rodada."
                value={editEnqueteDescricao}
                onChange={(e) => setEditEnqueteDescricao(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogEditarEnqueteOpen(false)}
              disabled={salvandoEdicaoEnquete}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSalvarEdicaoEnquete}
              disabled={salvandoEdicaoEnquete}
              className="bg-amber-600 font-bold text-white hover:bg-amber-700 shadow-xs"
            >
              {salvandoEdicaoEnquete ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  onChange={(e) => {
                    const novoFim = e.target.value
                    setDataFim(novoFim)
                    if (novoFim && (!dataLimiteVotacao || dataLimiteVotacao.startsWith(dataFim))) {
                      setDataLimiteVotacao(`${novoFim}T12:00`)
                    }
                  }}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Campo de Prazo Limite de Votação */}
            <div className="space-y-1.5">
              <Label htmlFor="data-limite-votacao" className="text-xs font-bold text-slate-700">
                Data e Hora Limite de Votação *:
              </Label>
              <Input
                id="data-limite-votacao"
                type="datetime-local"
                value={dataLimiteVotacao}
                onChange={(e) => setDataLimiteVotacao(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                A votação será encerrada automaticamente assim que este horário for atingido.
              </p>
            </div>

            {/* Campo Limite de Votos por Participante */}
            <div className="space-y-1.5">
              <Label htmlFor="limite-votos-criacao" className="text-xs font-bold text-slate-700">
                Limite de Votos por Participante *:
              </Label>
              <Input
                id="limite-votos-criacao"
                type="number"
                min={1}
                placeholder="Ex.: 4"
                value={limiteVotosCriacao}
                onChange={(e) => setLimiteVotosCriacao(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                Quantidade máxima de jogos que cada participante poderá selecionar durante a
                votação.
              </p>
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
                  placeholder="Ex.: Escolha até 10 jogos. Os 4 mais votados irão para a Copa Coni."
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
                        placeholder="Ex.: Corinthians"
                        value={manualTimeA}
                        onChange={(e) => {
                          const novo = e.target.value
                          setManualTimeA(novo)
                          if (origemManualLogoCasa === 'auto' && manualLogoCasa) {
                            setManualLogoCasa('')
                          }
                        }}
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
                        onChange={(e) => {
                          const novo = e.target.value
                          setManualTimeB(novo)
                          if (origemManualLogoVisitante === 'auto' && manualLogoVisitante) {
                            setManualLogoVisitante('')
                          }
                        }}
                        className="h-8 bg-white text-xs"
                      />
                    </div>{' '}
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
                        onChange={(e) => {
                          setManualLogoCasa(e.target.value)
                          setOrigemManualLogoCasa('manual')
                        }}
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
                        onChange={(e) => {
                          setManualLogoVisitante(e.target.value)
                          setOrigemManualLogoVisitante('manual')
                        }}
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
                          <EnqueteTeamBadge
                            nomeTime={j.time_a}
                            savedLogo={j.logo_casa}
                            fixtureId={j.fixture_id}
                            isSide="home"
                            sizeClass="h-5 w-5 min-w-[20px] min-h-[20px] shrink-0 object-contain"
                          />
                          <span
                            className="font-bold text-slate-800 truncate leading-tight"
                            title={j.time_a}
                          >
                            {j.time_a}
                          </span>
                          <span className="text-slate-400 font-bold text-[10px] shrink-0">x</span>
                          {/* Escudo Visitante */}
                          <EnqueteTeamBadge
                            nomeTime={j.time_b}
                            savedLogo={j.logo_visitante}
                            fixtureId={j.fixture_id}
                            isSide="away"
                            sizeClass="h-5 w-5 min-w-[20px] min-h-[20px] shrink-0 object-contain"
                          />
                          <span
                            className="font-bold text-slate-800 truncate leading-tight"
                            title={j.time_b}
                          >
                            {j.time_b}
                          </span>
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

      {/* DIALOG ADMIN: Reabrir Votação com Nova Data Limite */}
      <Dialog open={dialogReabrirOpen} onOpenChange={setDialogReabrirOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Vote className="h-5 w-5 text-emerald-600" />
              Reabrir Votação da Enquete
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Defina ou atualize a nova data e horário limite para os participantes enviarem votos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reabrir-data-limite" className="text-xs font-bold text-slate-700">
                Nova Data e Hora Limite de Votação *:
              </Label>
              <Input
                id="reabrir-data-limite"
                type="datetime-local"
                value={reabrirNovaDataLimite}
                onChange={(e) => setReabrirNovaDataLimite(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-slate-500">
                A votação ficará aberta até este novo instante configurado.
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogReabrirOpen(false)}
              disabled={reabrindoVotacao}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmarReabrirVotacao}
              disabled={reabrindoVotacao}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {reabrindoVotacao ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Confirmar Reabertura
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
                <div className="flex items-center gap-1.5 min-w-0">
                  <EnqueteTeamBadge
                    nomeTime={j.time_a}
                    savedLogo={j.logo_casa}
                    fixtureId={j.fixture_id}
                    isSide="home"
                    sizeClass="h-4 w-4 min-w-[16px] min-h-[16px] shrink-0 object-contain"
                  />
                  <span
                    className="font-bold text-slate-800 truncate leading-tight"
                    title={j.time_a}
                  >
                    {j.time_a}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">x</span>
                  <EnqueteTeamBadge
                    nomeTime={j.time_b}
                    savedLogo={j.logo_visitante}
                    fixtureId={j.fixture_id}
                    isSide="away"
                    sizeClass="h-4 w-4 min-w-[16px] min-h-[16px] shrink-0 object-contain"
                  />
                  <span
                    className="font-bold text-slate-800 truncate leading-tight"
                    title={j.time_b}
                  >
                    {j.time_b}
                  </span>
                </div>
                <span className="text-slate-500 text-[11px] shrink-0">
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
              Inclua manualmente um confronto em{' '}
              <strong>"{tituloEnqueteAtiva || activePoll?.titulo}"</strong>. O jogo ficará
              disponível imediatamente para votação sem afetar os votos já existentes.
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
                  onChange={(e) => {
                    const novo = e.target.value
                    setAtivaManualMandante(novo)
                    if (origemAtivaLogoCasa === 'auto' && ativaManualLogoCasa) {
                      setAtivaManualLogoCasa('')
                    }
                  }}
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
                  onChange={(e) => {
                    const novo = e.target.value
                    setAtivaManualVisitante(novo)
                    if (origemAtivaLogoVisitante === 'auto' && ativaManualLogoVisitante) {
                      setAtivaManualLogoVisitante('')
                    }
                  }}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* ID da Partida (API-Football) / api_fixture_id com Botão Buscar ID */}
            <div className="space-y-1">
              <Label
                htmlFor="ativa-manual-fixture-id"
                className="text-xs font-bold text-slate-700 flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <span>ID da Partida (API-Football) / api_fixture_id</span>
                  {autoLookupAtivaFeedback && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                      <Check className="h-3 w-3 text-emerald-600" />
                      {autoLookupAtivaFeedback}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-normal text-slate-500">
                  {buscandoAutoLookupAtiva
                    ? 'Buscando partida...'
                    : buscandoFixtureAtiva
                      ? 'Buscando escudos...'
                      : 'Opcional'}
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ativa-manual-fixture-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ex.: 1528881"
                    value={ativaManualFixtureId}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '')
                      setAtivaManualFixtureId(clean)
                      setAutoLookupAtivaFeedback(null)
                    }}
                    onBlur={() => {
                      if (ativaManualFixtureId) {
                        handleBuscarEscudosPorFixtureAtiva(ativaManualFixtureId)
                      }
                    }}
                    className="h-9 bg-white text-xs"
                  />
                  {(buscandoFixtureAtiva || buscandoAutoLookupAtiva) && (
                    <div className="absolute right-2.5 top-2.5">
                      <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleBuscarIdManualAtiva}
                  disabled={buscandoAutoLookupAtiva || buscandoFixtureAtiva}
                  className="h-9 shrink-0 gap-1.5 border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900"
                  title="Buscar ID e escudos oficiais na API-Football"
                >
                  <Search className="h-3.5 w-3.5 text-emerald-700" />
                  Buscar ID
                </Button>
              </div>

              {/* Aviso suave amigável e Lista de Alternativas (se houver múltiplas ou sem match exato) */}
              {avisoBuscaAtiva && (
                <div className="rounded-md border border-amber-200 bg-amber-50/80 p-2 text-[11px] text-amber-800">
                  <div className="flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                    <span className="flex-1">{avisoBuscaAtiva}</span>
                  </div>
                  {alternativasAtiva.length > 0 && (
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {alternativasAtiva.map((alt) => (
                        <button
                          key={alt.id}
                          type="button"
                          onClick={() => handleSelecionarAlternativaAtiva(alt)}
                          className="w-full flex items-center justify-between gap-2 p-1.5 rounded bg-white border border-amber-200 hover:bg-emerald-50 hover:border-emerald-300 text-left transition"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {alt.homeTeamLogo ? (
                              <img
                                src={alt.homeTeamLogo}
                                alt=""
                                className="h-4 w-4 object-contain shrink-0"
                              />
                            ) : null}
                            <span className="font-bold text-slate-800 truncate text-[11px]">
                              {alt.homeTeamName || 'Mandante'} x {alt.awayTeamName || 'Visitante'}
                            </span>
                            {alt.awayTeamLogo ? (
                              <img
                                src={alt.awayTeamLogo}
                                alt=""
                                className="h-4 w-4 object-contain shrink-0"
                              />
                            ) : null}
                          </div>
                          <span className="text-[10px] font-black text-emerald-700 shrink-0">
                            ID #{alt.id}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                  onChange={(e) => {
                    setAtivaManualLogoCasa(e.target.value)
                    setOrigemAtivaLogoCasa('manual')
                  }}
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
                  onChange={(e) => {
                    setAtivaManualLogoVisitante(e.target.value)
                    setOrigemAtivaLogoVisitante('manual')
                  }}
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
                  onChange={(e) => {
                    const novo = e.target.value
                    setEditMandante(novo)
                    if (origemEditLogoCasa === 'auto' && editLogoCasa) {
                      setEditLogoCasa('')
                    }
                  }}
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
                  onChange={(e) => {
                    const novo = e.target.value
                    setEditVisitante(novo)
                    if (origemEditLogoVisitante === 'auto' && editLogoVisitante) {
                      setEditLogoVisitante('')
                    }
                  }}
                  className="h-9 bg-white text-xs"
                />
              </div>
            </div>

            {/* ID da Partida (API-Football) / api_fixture_id com Botão Buscar ID */}
            <div className="space-y-1">
              <Label
                htmlFor="edit-fixture-id"
                className="text-xs font-bold text-slate-700 flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <span>ID da Partida (API-Football) / api_fixture_id</span>
                  {autoLookupEditFeedback && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                      <Check className="h-3 w-3 text-emerald-600" />
                      {autoLookupEditFeedback}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-normal text-slate-500">
                  {buscandoAutoLookupEdit
                    ? 'Buscando partida...'
                    : buscandoFixtureEdit
                      ? 'Buscando escudos...'
                      : 'Opcional'}
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="edit-fixture-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ex.: 1528881"
                    value={editFixtureId}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '')
                      setEditFixtureId(clean)
                      setAutoLookupEditFeedback(null)
                    }}
                    onBlur={() => {
                      if (editFixtureId) {
                        handleBuscarEscudosPorFixtureEdit(editFixtureId)
                      }
                    }}
                    className="h-9 bg-white text-xs"
                  />
                  {(buscandoFixtureEdit || buscandoAutoLookupEdit) && (
                    <div className="absolute right-2.5 top-2.5">
                      <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleBuscarIdManualEdit}
                  disabled={buscandoAutoLookupEdit || buscandoFixtureEdit}
                  className="h-9 shrink-0 gap-1.5 border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900"
                  title="Buscar ID e escudos oficiais na API-Football"
                >
                  <Search className="h-3.5 w-3.5 text-emerald-700" />
                  Buscar ID
                </Button>
              </div>

              {/* Aviso suave amigável e Lista de Alternativas (se houver múltiplas ou sem match exato) */}
              {avisoBuscaEdit && (
                <div className="rounded-md border border-amber-200 bg-amber-50/80 p-2 text-[11px] text-amber-800">
                  <div className="flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                    <span className="flex-1">{avisoBuscaEdit}</span>
                  </div>
                  {alternativasEdit.length > 0 && (
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {alternativasEdit.map((alt) => (
                        <button
                          key={alt.id}
                          type="button"
                          onClick={() => handleSelecionarAlternativaEdit(alt)}
                          className="w-full flex items-center justify-between gap-2 p-1.5 rounded bg-white border border-amber-200 hover:bg-emerald-50 hover:border-emerald-300 text-left transition"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {alt.homeTeamLogo ? (
                              <img
                                src={alt.homeTeamLogo}
                                alt=""
                                className="h-4 w-4 object-contain shrink-0"
                              />
                            ) : null}
                            <span className="font-bold text-slate-800 truncate text-[11px]">
                              {alt.homeTeamName || 'Mandante'} x {alt.awayTeamName || 'Visitante'}
                            </span>
                            {alt.awayTeamLogo ? (
                              <img
                                src={alt.awayTeamLogo}
                                alt=""
                                className="h-4 w-4 object-contain shrink-0"
                              />
                            ) : null}
                          </div>
                          <span className="text-[10px] font-black text-emerald-700 shrink-0">
                            ID #{alt.id}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                  onChange={(e) => {
                    setEditLogoCasa(e.target.value)
                    setOrigemEditLogoCasa('manual')
                  }}
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
                  onChange={(e) => {
                    setEditLogoVisitante(e.target.value)
                    setOrigemEditLogoVisitante('manual')
                  }}
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
              Tem certeza que deseja excluir a enquete{' '}
              <strong>"{tituloEnqueteAtiva || activePoll?.titulo}"</strong>? Todos os votos e
              confrontos desta enquete serão removidos.
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

      {/* Botão Flutuante (FAB) para Adicionar Jogo Manual na Enquete Ativa (apenas Admin) */}
      {isAdmin &&
        activePoll &&
        !dialogAdicionarManualAtivaOpen &&
        !dialogNovaEnqueteOpen &&
        !dialogEditarJogoOpen &&
        !dialogExcluirJogoOpen &&
        !dialogExcluirOpen &&
        !dialogReabrirOpen &&
        !confirmCadastrarOpen && (
          <button
            type="button"
            onClick={handleAbrirModalAdicionarManualAtiva}
            className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg shadow-amber-950/25 transition-all duration-200 hover:scale-105 hover:bg-amber-700 hover:shadow-xl active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            aria-label="Adicionar Jogo Manual"
            title="+ Adicionar Jogo Manual"
          >
            <Plus className="h-7 w-7 stroke-[2.5] text-white" />
          </button>
        )}
    </div>
  )
}
