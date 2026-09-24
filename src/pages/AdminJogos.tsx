import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Edit3,
  Loader2,
  AlertCircle,
  Upload,
  Trophy,
  CheckCircle2,
  FileSpreadsheet,
  Settings,
  Users,
  RefreshCw,
  Pencil,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import { BOLAO_MEMBERS } from '@/context/AuthContext'
import type { Bolao, Jogo } from '@/types/bolao'
import { formatBolaoLabel } from '@/types/bolao'
import { formatDataBR, formatHoraBR, sortJogosCadastrados } from '@/lib/dateUtils'
import {
  parseSpreadsheet,
  importBolaoSpreadsheet,
  type ParsedParticipantScore,
  type ParsedGame,
} from '@/lib/spreadsheetParser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AdminManageParticipantesModal } from '@/components/AdminManageParticipantesModal'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/pocketbase/errors'

export default function AdminJogos() {
  const { boloes, activeBolao, activeBolaoId, setActiveBolaoId, refreshBoloes } = useActivePool()
  const { toast } = useToast()
  const [boloesLocais, setBoloesLocais] = useState<Bolao[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [jogos, setJogos] = useState<Jogo[]>(() => {
    try {
      const targetId = activeBolaoId || 'geral'
      const raw =
        sessionStorage.getItem(`bolao_cache_jogos_${targetId}`) ||
        sessionStorage.getItem('bolao_cache_all_jogos')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch {
      /* ignore */
    }
    return []
  })
  const [loading, setLoading] = useState(() => jogos.length === 0)
  const [isRevalidating, setIsRevalidating] = useState(() => jogos.length > 0)
  const [submitting, setSubmitting] = useState(false)

  // Modal Novo Bolão
  const [modalNovoBolao, setModalNovoBolao] = useState(false)
  const [novoBolaoNome, setNovoBolaoNome] = useState('')
  const [novoBolaoFoco, setNovoBolaoFoco] = useState('')
  const [novoBolaoAtivo, setNovoBolaoAtivo] = useState(true)
  const [salvandoBolao, setSalvandoBolao] = useState(false)
  const [erroNovoBolao, setErroNovoBolao] = useState<string | null>(null)
  const [todosNomesParticipantes, setTodosNomesParticipantes] = useState<string[]>([
    ...BOLAO_MEMBERS,
  ])
  const [participantesSelecionados, setParticipantesSelecionados] = useState<string[]>([
    ...BOLAO_MEMBERS,
  ])

  // Modal Gerenciar Participantes
  const [modalGerenciarParticipantes, setModalGerenciarParticipantes] = useState(false)
  const [forcingEscalacaoId, setForcingEscalacaoId] = useState<string | null>(null)
  const [vinculandoFixtures, setVinculandoFixtures] = useState(false)

  // Upload Planilha states
  const [modalUpload, setModalUpload] = useState(false)
  const [parsedScores, setParsedScores] = useState<ParsedParticipantScore[]>([])
  const [parsedGames, setParsedGames] = useState<ParsedGame[]>([])
  const [uploadFileName, setUploadFileName] = useState('')
  const [parsingSpreadsheet, setParsingSpreadsheet] = useState(false)
  const [importingSpreadsheet, setImportingSpreadsheet] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadAvisos, setUploadAvisos] = useState<string[]>([])

  // Form fields
  const [timeA, setTimeA] = useState('')
  const [timeB, setTimeB] = useState('')
  const [competicao, setCompeticao] = useState('')
  const [fixtureId, setFixtureId] = useState('')
  const [dataJogo, setDataJogo] = useState('')
  const [horaJogo, setHoraJogo] = useState('')
  const [temPenaltis, setTemPenaltis] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit Jogo Modal state
  const [editingJogo, setEditingJogo] = useState<Jogo | null>(null)
  const [editTimeA, setEditTimeA] = useState('')
  const [editTimeB, setEditTimeB] = useState('')
  const [editData, setEditData] = useState('')
  const [editHora, setEditHora] = useState('')
  const [editCompeticao, setEditCompeticao] = useState('')
  const [editFixtureId, setEditFixtureId] = useState('')
  const [savingEditJogo, setSavingEditJogo] = useState(false)
  const [editJogoError, setEditJogoError] = useState<string | null>(null)

  // Delete confirmation
  const [gameToDelete, setGameToDelete] = useState<Jogo | null>(null)
  const [deleting, setDeleting] = useState(false)

  useRealtime<Jogo>('jogos', () => {
    loadJogos()
  })

  // PATCH 1: Carregamento autônomo dos bolões na montagem com fallback em localStorage
  useEffect(() => {
    const fetchBoloesLocais = async () => {
      try {
        const records = await pb.collection('boloes').getFullList<Bolao>({
          sort: '-created',
        })
        if (records && records.length > 0) {
          setBoloesLocais(records)
          try {
            localStorage.setItem('bolao_cache_boloes', JSON.stringify(records))
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.warn('Carregamento autônomo de bolões (AdminJogos):', err)
        // Em caso de erro de rede, ler bolao_cache_boloes do localStorage para o dropdown não ficar só com "Geral"
        try {
          const raw =
            localStorage.getItem('bolao_cache_boloes') ||
            sessionStorage.getItem('bolao_cache_boloes')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setBoloesLocais(parsed)
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    fetchBoloesLocais()
  }, [])

  // Carregar todos os nomes únicos de participantes cadastrados para seleção na criação de bolão
  const carregarNomesParticipantes = async () => {
    try {
      const records = await pb.collection('participantes').getFullList<{ nome: string }>({
        fields: 'nome',
      })
      const setNomes = new Set<string>(BOLAO_MEMBERS)
      for (const r of records) {
        if (r.nome && r.nome.trim()) {
          setNomes.add(r.nome.trim())
        }
      }
      const lista = Array.from(setNomes).sort()
      setTodosNomesParticipantes(lista)
      // Se a lista de selecionados estiver vazia ou for default, manter os habituais
      setParticipantesSelecionados((prev) => (prev.length > 0 ? prev : [...BOLAO_MEMBERS]))
    } catch (err) {
      console.warn('Erro ao carregar participantes para modal de novo bolão:', err)
      setTodosNomesParticipantes([...BOLAO_MEMBERS])
    }
  }

  useEffect(() => {
    carregarNomesParticipantes()
  }, [])

  // Merge sem duplicar IDs entre boloesLocais e boloes do contexto
  const boloesDisponiveis = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of boloesLocais) {
      if (b && b.id) map.set(b.id, b)
    }
    for (const b of boloes) {
      if (b && b.id && !map.has(b.id)) {
        map.set(b.id, b)
      }
    }
    return Array.from(map.values())
  }, [boloesLocais, boloes])

  const loadJogos = async (overrideBolaoId?: string) => {
    const targetBolaoId = overrideBolaoId !== undefined ? overrideBolaoId : activeBolaoId || 'geral'
    if (!targetBolaoId) return
    try {
      const isGeral = targetBolaoId === 'geral'
      const records = await pb.collection('jogos').getFullList<Jogo>({
        filter: isGeral ? '' : `bolao = '${targetBolaoId}'`,
        sort: 'data,hora',
      })
      setJogos(records)
      try {
        if (isGeral) {
          sessionStorage.setItem('bolao_cache_all_jogos', JSON.stringify(records))
        }
        sessionStorage.setItem(`bolao_cache_jogos_${targetBolaoId}`, JSON.stringify(records))
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('Erro ao carregar jogos:', err)
      // Quando a consulta falhar, ler sessionStorage.getItem('bolao_cache_all_jogos') para não renderizar "Total 0"
      try {
        const cachedRaw =
          sessionStorage.getItem(`bolao_cache_jogos_${targetBolaoId}`) ||
          sessionStorage.getItem('bolao_cache_all_jogos')
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setJogos(parsed)
          }
        }
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false)
    }
  }

  // PATCH 2: Auto-seleção sem conflito
  // Se activeBolaoId for 'geral' ou um id válido de bolão existente, NÃO reescrever.
  // Manter 'geral' como default quando nada estiver definido/persistido.
  useEffect(() => {
    if (!activeBolaoId || activeBolaoId.trim() === '') {
      setActiveBolaoId('geral')
      return
    }

    if (activeBolaoId === 'geral') {
      return
    }

    // Se tiver um ID específico, checar se é válido na lista disponível (se já carregada)
    if (boloesDisponiveis.length > 0) {
      const isValid = boloesDisponiveis.some((b) => b.id === activeBolaoId)
      if (!isValid) {
        // ID inválido/inexistente: fallback seguro para 'geral'
        setActiveBolaoId('geral')
      }
    }
  }, [boloesDisponiveis, activeBolaoId, setActiveBolaoId])

  // PATCH 3: Garantir ciclo de filtragem disparado ao alterar activeBolaoId
  useEffect(() => {
    const targetId = activeBolaoId || 'geral'
    setLoading(true)
    loadJogos(targetId)
  }, [activeBolaoId])

  const handleCreateJogo = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!timeA.trim() || !timeB.trim() || !dataJogo || !horaJogo.trim()) {
      setFormError('Preencha todos os campos do jogo.')
      return
    }

    // Se o bolão selecionado no dropdown for 'geral', tentar associar ao primeiro bolão ativo disponível
    let targetBolao = activeBolaoId
    if (!targetBolao || targetBolao === 'geral') {
      const primeiroAtivo = boloesDisponiveis.find((b) => b.ativo !== false) || boloesDisponiveis[0]
      if (primeiroAtivo) {
        targetBolao = primeiroAtivo.id
      } else {
        setFormError('Selecione uma competição/bolão específica para vincular o novo jogo.')
        return
      }
    }

    setSubmitting(true)
    try {
      // Normalização da data para ISO string completa aceita pelo PocketBase DateField
      let dataIsoFormatada = dataJogo.trim()
      if (!dataIsoFormatada.includes('T')) {
        dataIsoFormatada = `${dataIsoFormatada}T00:00:00.000Z`
      }

      // ISOLAMENTO TOTAL:
      // O cadastro manual de partidas NUNCA depende nem aguarda chamadas a APIs externas (API-Football, Football-Data ou TSDB).
      // Salva diretamente os dados digitados com valores padrão explícitos e consistentes.
      await pb.collection('jogos').create({
        bolao: targetBolao,
        time_a: timeA.trim(),
        time_b: timeB.trim(),
        competicao: competicao.trim() || '',
        fixture_id: fixtureId.trim() || '',
        data: dataIsoFormatada,
        hora: horaJogo.trim(),
        placar_a: null,
        placar_b: null,
        resultado_finalizado: false,
        tem_penaltis: Boolean(temPenaltis),
        vencedor_penaltis: '',
        gols_time_a: [],
        gols_time_b: [],
      })

      toast({
        title: 'Jogo cadastrado com sucesso!',
        description: `${timeA.trim()} x ${timeB.trim()} adicionado à competição.`,
      })

      // Reset form
      setTimeA('')
      setTimeB('')
      setCompeticao('')
      setFixtureId('')
      setDataJogo('')
      setHoraJogo('')
      setTemPenaltis(false)
      setFormError(null)
      loadJogos(targetBolao)
    } catch (err: unknown) {
      console.error('Erro detalhado ao cadastrar jogo:', err)
      const msg = getErrorMessage(err)
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!gameToDelete) return
    setDeleting(true)
    try {
      const deletedGameId = gameToDelete.id
      const bolaoId = gameToDelete.bolao

      // 1. Explicit cascade: delete all palpites linked to this game
      try {
        const palpitesToDelete = await pb.collection('palpites').getFullList({
          filter: `jogo = '${deletedGameId}'`,
        })
        for (const p of palpitesToDelete) {
          try {
            await pb.collection('palpites').delete(p.id)
          } catch {
            /* intentionally ignored */
          }
        }
      } catch {
        /* intentionally ignored */
      }

      // 2. Delete game itself
      await pb.collection('jogos').delete(deletedGameId)

      // 3. Immediately recalculate leaderboard points for all participants of this bolão
      try {
        const [remainingGames, remainingPalpites, participants] = await Promise.all([
          pb.collection('jogos').getFullList<Jogo>({
            filter: `bolao = '${bolaoId}'`,
          }),
          pb.collection('palpites').getFullList({
            filter: `bolao = '${bolaoId}'`,
          }),
          pb.collection('participantes').getFullList<any>({
            filter: `bolao = '${bolaoId}'`,
          }),
        ])

        const finishedGameIds = new Set(
          remainingGames
            .filter((j) => j.id !== deletedGameId && j.resultado_finalizado)
            .map((j) => j.id),
        )

        for (const part of participants) {
          const sumPalpites = remainingPalpites
            .filter(
              (p) =>
                p.participante === part.id &&
                p.jogo !== deletedGameId &&
                finishedGameIds.has(p.jogo),
            )
            .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)

          const importedPts = Number(part.pontos_importados) || 0
          const updatedTotal = importedPts + sumPalpites

          await pb.collection('participantes').update(part.id, {
            pontuacao_total: updatedTotal,
          })
        }

        // Update bolao timestamp
        await pb.collection('boloes').update(bolaoId, {
          ultima_atualizacao: new Date().toISOString(),
        })
      } catch (recalcErr) {
        console.error('Aviso ao recalcular pontuações na exclusão:', recalcErr)
      }

      toast({
        title: 'Jogo excluído com sucesso',
        description:
          'A partida e palpites foram removidos e o ranking foi recalculado imediatamente.',
      })
      setGameToDelete(null)
      loadJogos()
    } catch (err) {
      toast({
        title: 'Erro ao excluir',
        description: 'Não foi possível excluir o jogo.',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  // Create new Bolão
  const handleCreateBolao = async (e: React.FormEvent) => {
    e.preventDefault()
    setErroNovoBolao(null)
    if (!novoBolaoNome.trim()) {
      setErroNovoBolao('Informe o nome da competição.')
      return
    }

    setSalvandoBolao(true)
    try {
      const created = await pb.collection('boloes').create({
        nome: novoBolaoNome.trim(),
        foco: novoBolaoFoco.trim() || '',
        ativo: novoBolaoAtivo,
      })

      // Criar registros em participantes apenas para os selecionados
      const membrosParaCriar =
        participantesSelecionados.length > 0 ? participantesSelecionados : BOLAO_MEMBERS

      for (const m of membrosParaCriar) {
        try {
          await pb.collection('participantes').create({
            bolao: created.id,
            nome: m,
            pontos_importados: 0,
            pontuacao_total: 0,
          })
        } catch (mErr) {
          console.warn(`Aviso ao vincular participante ${m} ao novo bolão:`, mErr)
        }
      }

      toast({
        title: 'Bolão criado com sucesso!',
        description: `Competição "${novoBolaoNome.trim()}" cadastrada com ${membrosParaCriar.length} participantes.`,
      })

      await refreshBoloes()
      setBoloesLocais((prev) => [created as Bolao, ...prev])
      setActiveBolaoId(created.id)
      setNovoBolaoNome('')
      setNovoBolaoFoco('')
      setModalNovoBolao(false)
    } catch (err: unknown) {
      console.error('Erro ao criar bolão:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao cadastrar o bolão'
      setErroNovoBolao(msg)
    } finally {
      setSalvandoBolao(false)
    }
  }

  // Handle file select for spreadsheet
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadFileName(file.name)
    setParsingSpreadsheet(true)
    setUploadError(null)
    setUploadAvisos([])
    setParsedScores([])
    setParsedGames([])
    try {
      const { scores, games, avisos } = await parseSpreadsheet(file)
      setParsedScores(scores)
      setParsedGames(games)
      setUploadAvisos(avisos)
      if (scores.length === 0 && games.length === 0) {
        setUploadError(
          'Nenhuma pontuação ou jogo identificado. Verifique os cabeçalhos da planilha.',
        )
      }
    } catch (err: unknown) {
      console.error('Erro ao processar planilha:', err)
      setUploadError(err instanceof Error ? err.message : 'Erro ao ler o arquivo')
    } finally {
      setParsingSpreadsheet(false)
    }
  }

  const handleOpenEditJogo = (jogo: Jogo) => {
    setEditingJogo(jogo)
    setEditTimeA(jogo.time_a || '')
    setEditTimeB(jogo.time_b || '')
    // Extrai YYYY-MM-DD se estiver no formato ISO
    const rawData = jogo.data || ''
    const matchIso = rawData.match(/^(\d{4}-\d{2}-\d{2})/)
    setEditData(matchIso ? matchIso[1] : rawData)
    setEditHora(jogo.hora || '')
    setEditCompeticao(jogo.competicao || '')
    setEditFixtureId(jogo.fixture_id || '')
    setEditJogoError(null)
  }

  const handleSaveEditJogo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingJogo) return
    setEditJogoError(null)

    if (!editTimeA.trim() || !editTimeB.trim()) {
      setEditJogoError('Os nomes dos times mandante e visitante são obrigatórios.')
      return
    }

    setSavingEditJogo(true)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      let dataIsoFormatada = editData.trim()
      if (dataIsoFormatada && !dataIsoFormatada.includes('T')) {
        dataIsoFormatada = `${dataIsoFormatada}T00:00:00.000Z`
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/admin/editar-jogo`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jogo_id: editingJogo.id,
            time_a: editTimeA.trim(),
            time_b: editTimeB.trim(),
            data: dataIsoFormatada || undefined,
            hora: editHora.trim() || undefined,
            competicao: editCompeticao.trim() || undefined,
            fixture_id: editFixtureId.trim() || undefined,
          }),
        },
      )

      const data = await res.json()

      if (!res.ok || data.success === false) {
        const errorMsg = data.error || 'Não foi possível salvar as alterações do jogo.'
        setEditJogoError(errorMsg)
        toast({
          title: 'Erro ao editar jogo',
          description: errorMsg,
          variant: 'destructive',
        })
      } else {
        if (data.fixture_vinculado || data.escudos_atualizados) {
          const escudosTxt = data.escudos_atualizados ? ' e escudos sincronizados' : ''
          const fixtureTxt = data.fixture_vinculado
            ? 'Fixture vinculada com sucesso'
            : 'Dados salvos'
          toast({
            title: 'Jogo atualizado com sucesso!',
            description: `${fixtureTxt}${escudosTxt}.`,
          })
        } else {
          toast({
            title: 'Dados cadastrais salvos',
            description:
              data.aviso ||
              'Nomes atualizados. Fixture/escudos permanecem pendentes (sem correspondência ou cota).',
          })
        }
        setEditingJogo(null)
        loadJogos(activeBolaoId || 'geral')
      }
    } catch (err: unknown) {
      console.error('Erro ao editar jogo:', err)
      const msg = err instanceof Error ? err.message : 'Falha na comunicação com o servidor.'
      setEditJogoError(msg)
      toast({
        title: 'Erro de comunicação',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setSavingEditJogo(false)
    }
  }

  // Ação de forçar busca de escalação sob demanda (Douglas)
  const handleForcarEscalacao = async (jogoTarget: Jogo) => {
    setForcingEscalacaoId(jogoTarget.id)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/admin/forcar-escalacao`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ jogo_id: jogoTarget.id }),
        },
      )

      const data = await res.json()

      if (!res.ok || data.success === false) {
        const errorMsg =
          data.error ||
          data.notice ||
          'Não foi possível obter escalações da API externa no momento.'
        toast({
          title: 'Aviso sobre escalação',
          description: errorMsg,
          variant: data.rate_limited ? 'destructive' : 'default',
        })
      } else {
        toast({
          title: 'Escalação sincronizada!',
          description: `Escalações do confronto ${jogoTarget.time_a} x ${jogoTarget.time_b} foram atualizadas com sucesso.`,
        })
      }

      // Recarrega jogos para refletir o novo fixture_id e escalacoes salvos
      loadJogos()
    } catch (err: unknown) {
      console.error('Erro ao forçar busca de escalação:', err)
      toast({
        title: 'Erro na requisição',
        description: 'Falha de comunicação ao solicitar busca de escalação.',
        variant: 'destructive',
      })
    } finally {
      setForcingEscalacaoId(null)
    }
  }

  // Varredura de jogos existentes sem fixture_id (Douglas)
  const handleVincularFixtures = async () => {
    setVinculandoFixtures(true)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/admin/vincular-fixtures`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ bolao_id: activeBolaoId || 'geral' }),
        },
      )

      const data = await res.json()
      if (!res.ok || data.success === false) {
        const errorMsg = data.error || 'Não foi possível completar o vínculo de fixtures.'
        toast({
          title: 'Erro no vínculo de fixtures',
          description: errorMsg,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Vínculo de fixtures concluído!',
          description:
            data.vinculados > 0
              ? `${data.vinculados} jogo(s) vinculado(s) com sucesso na API.`
              : data.message || 'Nenhum novo ID vinculado no momento.',
        })
        loadJogos(activeBolaoId || 'geral')
      }
    } catch (err: unknown) {
      console.error('Erro ao vincular fixtures:', err)
      toast({
        title: 'Erro na requisição',
        description: 'Falha de comunicação ao solicitar vínculo de partidas.',
        variant: 'destructive',
      })
    } finally {
      setVinculandoFixtures(false)
    }
  }

  // Confirm import into active bolão
  const handleConfirmImport = async () => {
    if (!activeBolaoId || (parsedScores.length === 0 && parsedGames.length === 0)) return
    setImportingSpreadsheet(true)
    try {
      const result = await importBolaoSpreadsheet(activeBolaoId, parsedScores, parsedGames)
      toast({
        title: 'Importação e Reset concluídos com sucesso!',
        description: `${result.jogosProcessados} jogo(s) cadastrado(s), ${result.palpitesProcessados} palpite(s) e ${result.participantesAtualizados} participante(s) atualizados com a base limpa.`,
      })
      setModalUpload(false)
      setParsedScores([])
      setParsedGames([])
      setUploadFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await Promise.all([refreshBoloes(), loadJogos()])
    } catch (err: unknown) {
      console.error('Erro ao importar planilha:', err)
      toast({
        title: 'Erro ao importar dados',
        description: err instanceof Error ? err.message : 'Falha ao gravar no banco',
        variant: 'destructive',
      })
    } finally {
      setImportingSpreadsheet(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with pool selector */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
              <Shield className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                  Gestão de Jogos
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
                Módulo exclusivo do Administrador (Douglas) para agendamento e controle de partidas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bolão selector with (Ativo) label */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="admin-pool-select" className="text-xs font-semibold text-slate-500">
              Bolão:
            </label>
            <select
              id="admin-pool-select"
              value={activeBolaoId || 'geral'}
              onChange={(e) => {
                const newId = e.target.value
                setActiveBolaoId(newId)
                setLoading(true)
                loadJogos(newId)
              }}
              className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F2A43] shadow-xs focus:border-[#10B981] focus:outline-none"
            >
              <option value="geral">Geral (Todas as Copas)</option>
              {boloesDisponiveis.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome
                    ? b.ativo === false
                      ? `${b.nome} (Encerrado)`
                      : b.nome
                    : formatBolaoLabel(b)}
                </option>
              ))}
            </select>
          </div>

          {/* Criar Novo Bolão Button */}
          <Button
            type="button"
            onClick={() => {
              carregarNomesParticipantes()
              setModalNovoBolao(true)
            }}
            size="sm"
            className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Criar Novo Bolão
          </Button>

          {/* Gerenciar Participantes Button */}
          <Button
            type="button"
            onClick={() => setModalGerenciarParticipantes(true)}
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 shadow-xs hover:bg-emerald-100"
          >
            <Users className="mr-1 h-3.5 w-3.5 text-emerald-600" />
            Gerenciar Participantes
          </Button>

          {/* Vincular IDs das Partidas */}
          <Button
            type="button"
            onClick={handleVincularFixtures}
            disabled={vinculandoFixtures}
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-indigo-300 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 shadow-xs hover:bg-indigo-100"
            title="Varre jogos pendentes sem fixture_id e vincula automaticamente pela API-Football"
          >
            {vinculandoFixtures ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                <span>Vinculando IDs...</span>
              </>
            ) : (
              <>
                <RefreshCw className="mr-1 h-3.5 w-3.5 text-indigo-600" />
                <span>Vincular IDs das Partidas</span>
              </>
            )}
          </Button>

          {/* Upload Planilha individual por bolão */}
          <Button
            type="button"
            onClick={() => {
              setUploadError(null)
              setParsedScores([])
              setParsedGames([])
              setUploadFileName('')
              setModalUpload(true)
            }}
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-indigo-300 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 shadow-xs hover:bg-indigo-100"
          >
            <Upload className="mr-1 h-3.5 w-3.5 text-indigo-600" />
            Upload de Planilha ({activeBolao?.nome || 'Bolão'})
          </Button>

          {/* Atalho para Configurações de API Key */}
          <Link to="/bolao/configuracoes">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 shadow-xs hover:bg-emerald-100"
              title="Configurar fontes de placar ao vivo e API Key"
            >
              <Settings className="mr-1 h-3.5 w-3.5 text-emerald-600" />
              Configurações da API
            </Button>
          </Link>
        </div>
      </div>

      {/* Game Registration Form */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
            <Plus className="h-5 w-5 text-emerald-600" />
            Cadastro / Registro de Jogos
          </CardTitle>
          <p className="text-xs text-[#64748B]">
            Adicione uma nova partida para a competição{' '}
            <strong className="text-slate-800">
              {activeBolaoId === 'geral' || !activeBolaoId
                ? boloesDisponiveis.find((b) => b.ativo !== false)?.nome || 'Copa Coni'
                : activeBolao?.nome}
            </strong>
            . O cadastro manual é autônomo e não depende de chamadas à API externa.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {formError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 shadow-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-red-900">Não foi possível salvar a partida:</p>
                <p className="text-red-700 leading-relaxed">{formError}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleCreateJogo} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="time-a" className="text-xs font-semibold text-[#0F172A]">
                  Time A (Mandante)
                </Label>
                <Input
                  id="time-a"
                  placeholder="Ex: Flamengo"
                  value={timeA}
                  onChange={(e) => setTimeA(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
              </div>

              <div>
                <Label htmlFor="time-b" className="text-xs font-semibold text-[#0F172A]">
                  Time B (Visitante)
                </Label>
                <Input
                  id="time-b"
                  placeholder="Ex: Palmeiras"
                  value={timeB}
                  onChange={(e) => setTimeB(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
              </div>

              <div>
                <Label htmlFor="competicao-jogo" className="text-xs font-semibold text-[#0F172A]">
                  Competição (Opcional)
                </Label>
                <Input
                  id="competicao-jogo"
                  placeholder="Ex: Brasileirão - 20ª rodada"
                  value={competicao}
                  onChange={(e) => setCompeticao(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
              </div>

              <div>
                <Label htmlFor="data-jogo" className="text-xs font-semibold text-[#0F172A]">
                  Data
                </Label>
                <Input
                  id="data-jogo"
                  type="date"
                  value={dataJogo}
                  onChange={(e) => setDataJogo(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
              </div>

              <div>
                <Label htmlFor="hora-jogo" className="text-xs font-semibold text-[#0F172A]">
                  Hora (HH:MM)
                </Label>
                <Input
                  id="hora-jogo"
                  placeholder="21:30"
                  value={horaJogo}
                  onChange={(e) => setHoraJogo(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="fixture-id-jogo" className="text-xs font-semibold text-[#0F172A]">
                    ID da Partida (API-Football)
                  </Label>
                  <span className="text-[10px] font-normal text-slate-400">Opcional</span>
                </div>
                <Input
                  id="fixture-id-jogo"
                  placeholder="Ex: 1208456 (consulta direta)"
                  value={fixtureId}
                  onChange={(e) => setFixtureId(e.target.value)}
                  className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Se informado, busca na API diretamente pelo ID da fixture.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={temPenaltis}
                  onChange={(e) => setTemPenaltis(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Partida eliminatória (pode haver disputa de pênaltis)
              </label>

              <Button
                type="submit"
                disabled={submitting}
                className="h-10 rounded-lg bg-[#0F2A43] px-6 text-xs font-semibold text-white shadow-xs hover:bg-[#1B3A5C]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Cadastrar Jogo'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Games List */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <CardTitle className="text-lg font-bold text-[#0F172A]">
            Lista de Jogos Cadastrados
          </CardTitle>
          <span className="text-xs font-medium text-slate-500">
            Total: {jogos.length} partida(s)
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Carregando jogos...</div>
        ) : jogos.length === 0 ? (
          <div className="rounded-lg bg-slate-50 py-12 text-center text-xs text-slate-500">
            Nenhum jogo cadastrado neste bolão ainda. Utilize o formulário acima para adicionar
            partidas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3">Confronto</th>
                  <th className="px-4 py-3">Data / Hora</th>
                  <th className="px-4 py-3 text-center">Placar Final</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortJogosCadastrados(jogos).map((jogo) => {
                  const finalizado = jogo.resultado_finalizado

                  return (
                    <tr key={jogo.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-bold text-[#0F172A] line-clamp-2 leading-tight"
                            title={`${jogo.time_a} x ${jogo.time_b}`}
                          >
                            {jogo.time_a} x {jogo.time_b}
                          </span>
                          {jogo.competicao && (
                            <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                              {jogo.competicao}
                            </span>
                          )}
                          {jogo.fixture_id && (
                            <span
                              className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-emerald-800"
                              title={`ID direto API-Football: ${jogo.fixture_id}`}
                            >
                              ID: {jogo.fixture_id}
                            </span>
                          )}
                          {jogo.tem_penaltis && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              Pênaltis possíveis
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{formatDataBR(jogo.data)}</span>
                          <Clock className="ml-1 h-3.5 w-3.5 text-slate-400" />
                          <span>{formatHoraBR(jogo.hora)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {finalizado && jogo.placar_a !== null && jogo.placar_b !== null ? (
                          <span className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-black text-white">
                            {jogo.placar_a} x {jogo.placar_b}
                            {jogo.vencedor_penaltis && (
                              <span className="ml-1 text-[10px] text-amber-300">
                                (Pên: {jogo.vencedor_penaltis === 'A' ? jogo.time_a : jogo.time_b})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {finalizado ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                            Encerrado
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-800"
                          >
                            Pendente
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleForcarEscalacao(jogo)}
                            disabled={forcingEscalacaoId === jogo.id}
                            className="h-8 rounded-md border-indigo-200 bg-indigo-50/70 px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900"
                            title="Buscar ou forçar atualização de escalação na API-Football"
                          >
                            {forcingEscalacaoId === jogo.id ? (
                              <>
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                <span>Buscando...</span>
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                <span>Forçar Escalação</span>
                              </>
                            )}
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenEditJogo(jogo)}
                            className="h-8 rounded-md border-amber-200 bg-amber-50/70 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                            title="Editar informações cadastrais do jogo (nomes, data, hora, competição)"
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            <span>Editar Jogo</span>
                          </Button>

                          <Link to={`/bolao/admin/jogos/${jogo.id}/resultado`}>
                            <Button
                              size="sm"
                              className="h-8 rounded-md bg-[#0F2A43] px-3 text-xs font-semibold text-white hover:bg-[#1B3A5C]"
                            >
                              <Edit3 className="mr-1 h-3.5 w-3.5" />
                              {finalizado ? 'Editar Resultado' : 'Preencher Resultado'}
                            </Button>
                          </Link>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setGameToDelete(jogo)}
                            className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Excluir partida"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Dialog Editar Jogo */}
      <Dialog open={!!editingJogo} onOpenChange={(open) => !open && setEditingJogo(null)}>
        <DialogContent className="rounded-xl bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Pencil className="h-4 w-4 text-amber-600" />
              Editar Jogo Cadastrado
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Atualize os dados do confronto. Nomes oficiais em inglês (ex.:{' '}
              <strong className="text-slate-700">&quot;Japan&quot;</strong>,{' '}
              <strong className="text-slate-700">&quot;South Korea&quot;</strong>) facilitam a
              correspondência automática na API-Football e TheSportsDB.
            </DialogDescription>
          </DialogHeader>

          {editJogoError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{editJogoError}</span>
            </div>
          )}

          <form onSubmit={handleSaveEditJogo} className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-time-a" className="text-xs font-bold text-slate-700">
                  Time A (Mandante)
                </Label>
                <Input
                  id="edit-time-a"
                  placeholder="Ex: Japan"
                  value={editTimeA}
                  onChange={(e) => setEditTimeA(e.target.value)}
                  className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
                  required
                />
              </div>

              <div>
                <Label htmlFor="edit-time-b" className="text-xs font-bold text-slate-700">
                  Time B (Visitante)
                </Label>
                <Input
                  id="edit-time-b"
                  placeholder="Ex: South Korea"
                  value={editTimeB}
                  onChange={(e) => setEditTimeB(e.target.value)}
                  className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-data" className="text-xs font-bold text-slate-700">
                  Data
                </Label>
                <Input
                  id="edit-data"
                  type="date"
                  value={editData}
                  onChange={(e) => setEditData(e.target.value)}
                  className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
                />
              </div>

              <div>
                <Label htmlFor="edit-hora" className="text-xs font-bold text-slate-700">
                  Hora (HH:MM)
                </Label>
                <Input
                  id="edit-hora"
                  placeholder="Ex: 20:00"
                  value={editHora}
                  onChange={(e) => setEditHora(e.target.value)}
                  className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-competicao" className="text-xs font-bold text-slate-700">
                Competição (Opcional)
              </Label>
              <Input
                id="edit-competicao"
                placeholder="Ex: Copa Coni, Amistoso Internacional"
                value={editCompeticao}
                onChange={(e) => setEditCompeticao(e.target.value)}
                className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-fixture-id" className="text-xs font-bold text-slate-700">
                  ID do Jogo (API-Football / Fixture ID)
                </Label>
                {editFixtureId && (
                  <span className="font-mono text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    Vinculado: {editFixtureId}
                  </span>
                )}
              </div>
              <Input
                id="edit-fixture-id"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ex: 1208456 (cole ou digite o ID numérico)"
                value={editFixtureId}
                onChange={(e) => setEditFixtureId(e.target.value.replace(/[^0-9]/g, ''))}
                className="mt-1 h-9 border-[#CBD5E1] font-mono text-xs focus-visible:border-amber-500 focus-visible:ring-amber-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Uma vez preenchido ou vinculado, o ID fica fixo no banco e não é apagado ao renomear
                os times. Preencha manualmente caso a busca automática falhe por grafia/fuso.
              </p>
            </div>

            <div className="rounded-lg bg-amber-50/70 border border-amber-200 p-2.5 text-[11px] text-amber-900 leading-relaxed">
              💡 <strong>Dica da API:</strong> Quando o ID do jogo estiver informado, o sistema
              preserva o ID e poupa chamadas de busca à API-Football. Caso esteja em branco, tenta
              vincular automaticamente por data e nomes.
            </div>

            <DialogFooter className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={savingEditJogo}
                onClick={() => setEditingJogo(null)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingEditJogo}
                className="bg-[#0F2A43] text-xs font-semibold text-white hover:bg-[#1B3A5C]"
              >
                {savingEditJogo ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Salvando e Vinculando...
                  </>
                ) : (
                  'Salvar Alterações'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!gameToDelete} onOpenChange={(open) => !open && setGameToDelete(null)}>
        <DialogContent className="rounded-xl bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#0F172A]">
              Confirmar exclusão de partida
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Tem certeza que deseja remover o confronto{' '}
              <strong className="text-slate-800">
                {gameToDelete?.time_a} x {gameToDelete?.time_b}
              </strong>
              ? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setGameToDelete(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleDeleteConfirm}
              className="text-xs"
            >
              {deleting ? 'Excluindo...' : 'Sim, excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Criar Novo Bolão */}
      <Dialog open={modalNovoBolao} onOpenChange={setModalNovoBolao}>
        <DialogContent className="rounded-xl bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <Trophy className="h-5 w-5 text-amber-500" />
              Criar Novo Bolão
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Cadastre uma nova competição oficial. Os participantes oficiais serão vinculados
              automaticamente.
            </DialogDescription>
          </DialogHeader>

          {erroNovoBolao && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{erroNovoBolao}</span>
            </div>
          )}

          <form onSubmit={handleCreateBolao} className="space-y-4 pt-2">
            <div>
              <Label htmlFor="nome-bolao" className="text-xs font-bold text-slate-700">
                Nome da Competição
              </Label>
              <Input
                id="nome-bolao"
                placeholder="Ex: Copa Libertadores 2026"
                value={novoBolaoNome}
                onChange={(e) => setNovoBolaoNome(e.target.value)}
                className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="foco-bolao" className="text-xs font-bold text-slate-700">
                Foco / Descrição do Bolão
              </Label>
              <Input
                id="foco-bolao"
                placeholder="Ex: Jogos Aleatórios, Copa do Brasil, Libertadores"
                value={novoBolaoFoco}
                onChange={(e) => setNovoBolaoFoco(e.target.value)}
                className="mt-1 h-10 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Define a categoria ou tema exibido no badge oficial do bolão.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="chk-ativo"
                type="checkbox"
                checked={novoBolaoAtivo}
                onChange={(e) => setNovoBolaoAtivo(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <Label
                htmlFor="chk-ativo"
                className="cursor-pointer text-xs font-medium text-slate-700"
              >
                Definir como bolão ativo (visível no seletor)
              </Label>
            </div>

            {/* Participantes a vincular */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-bold text-slate-700">
                  Participantes Iniciais ({participantesSelecionados.length} selecionado(s))
                </Label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setParticipantesSelecionados([...todosNomesParticipantes])}
                    className="text-emerald-700 hover:underline font-semibold"
                  >
                    Selecionar Todos
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setParticipantesSelecionados([])}
                    className="text-slate-500 hover:underline"
                  >
                    Desmarcar Todos
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
                {todosNomesParticipantes.map((nome) => {
                  const isChecked = participantesSelecionados.includes(nome)
                  return (
                    <label
                      key={nome}
                      className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-white text-xs"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setParticipantesSelecionados((prev) => [...prev, nome])
                          } else {
                            setParticipantesSelecionados((prev) => prev.filter((n) => n !== nome))
                          }
                        }}
                      />
                      <span className="font-medium text-slate-800">{nome}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <DialogFooter className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={salvandoBolao}
                onClick={() => setModalNovoBolao(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={salvandoBolao}
                className="bg-[#0F2A43] text-xs font-semibold text-white hover:bg-[#1B3A5C]"
              >
                {salvandoBolao ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Bolão'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Upload de Planilha por Bolão */}
      <Dialog open={modalUpload} onOpenChange={setModalUpload}>
        <DialogContent className="rounded-xl bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
              Upload de Planilha — {activeBolao?.nome}
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Importe pontuações e classificações já acumuladas em planilha Excel (.xlsx, .xls) ou
              CSV. A pontuação acumulada do arquivo será mantida e preservada sem recálculo por
              posição.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* File picker */}
            <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
                id="file-spreadsheet-upload"
              />
              <label
                htmlFor="file-spreadsheet-upload"
                className="flex flex-col items-center justify-center cursor-pointer"
              >
                <Upload className="h-8 w-8 text-indigo-500 mb-2" />
                <span className="text-xs font-bold text-indigo-900">
                  {uploadFileName
                    ? uploadFileName
                    : 'Clique para selecionar a planilha Excel / CSV'}
                </span>
                <span className="mt-1 text-[11px] text-slate-500">
                  Formatos aceitos: .xlsx, .xls, .csv
                </span>
              </label>
            </div>

            {parsingSpreadsheet && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-indigo-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo e processando colunas do arquivo...
              </div>
            )}

            {uploadError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{uploadError}</span>
              </div>
            )}

            {uploadAvisos.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {uploadAvisos.map((aviso, i) => (
                  <p key={i}>• {aviso}</p>
                ))}
              </div>
            )}

            {/* Warning about Reset/Clear */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
              <span className="font-bold">Aviso de Limpeza Prévia (Reset/Clear):</span> Antes de
              gravar os dados do arquivo, todos os registros anteriores de{' '}
              <strong>{activeBolao?.nome}</strong> serão limpos (pontuações acumuladas zeradas,
              partidas e histórico de palpites antigos deletados) para evitar duplicidade.
            </div>

            {/* Preview of detected scores and games */}
            {(parsedScores.length > 0 || parsedGames.length > 0) && (
              <div className="space-y-3">
                {parsedScores.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-bold text-slate-800">
                        Classificação Detectada ({parsedScores.length} participantes):
                      </span>
                      <Badge
                        variant="outline"
                        className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-800"
                      >
                        Pronto para gravar
                      </Badge>
                    </div>
                    <div className="mt-2 divide-y divide-slate-100 max-h-36 overflow-y-auto">
                      {parsedScores.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1 text-xs">
                          <span className="font-semibold text-slate-700">{item.nome}</span>
                          <span className="font-black text-[#0F2A43]">{item.pontuacao} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {parsedGames.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-bold text-slate-800">
                        Partidas Históricas ({parsedGames.length} confrontos):
                      </span>
                      <Badge
                        variant="outline"
                        className="border-indigo-300 bg-indigo-50 text-[10px] text-indigo-800"
                      >
                        Confrontos + Palpites
                      </Badge>
                    </div>
                    <div className="mt-2 divide-y divide-slate-100 max-h-40 overflow-y-auto">
                      {parsedGames.slice(0, 15).map((game, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1 text-xs">
                          <div className="flex flex-col min-w-0 max-w-[220px]">
                            <span
                              className="font-semibold text-slate-700 line-clamp-2 leading-tight"
                              title={`${game.time_a} x ${game.time_b}`}
                            >
                              {game.time_a} x {game.time_b}
                            </span>
                            {game.competicao && (
                              <span className="text-[10px] text-indigo-600 font-medium truncate">
                                {game.competicao}
                              </span>
                            )}
                          </div>
                          <span className="font-bold text-[#0F2A43]">
                            {game.placar_a !== undefined && game.placar_b !== undefined
                              ? `${game.placar_a} x ${game.placar_b}`
                              : 'Pendente'}
                            {game.palpites && game.palpites.length > 0 && (
                              <span className="ml-1 text-[10px] text-slate-500 font-normal">
                                ({game.palpites.length} palpites)
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                      {parsedGames.length > 15 && (
                        <div className="py-1 text-center text-[10px] text-slate-400">
                          + {parsedGames.length - 15} confronto(s) adicional(is)
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-slate-500 pt-1">
                  Os dados serão gravados na base limpa da competição{' '}
                  <strong>{activeBolao?.nome}</strong>. Tanto a aba &quot;Resultados dos Jogos&quot;
                  quanto a &quot;Tabela de Classificação&quot; serão atualizadas.
                </p>
              </div>
            )}

            <DialogFooter className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importingSpreadsheet}
                onClick={() => setModalUpload(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  importingSpreadsheet || (parsedScores.length === 0 && parsedGames.length === 0)
                }
                onClick={handleConfirmImport}
                className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {importingSpreadsheet ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Limpando e Importando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Limpar Base e Importar
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Gerenciar Participantes */}
      <AdminManageParticipantesModal
        open={modalGerenciarParticipantes}
        onOpenChange={setModalGerenciarParticipantes}
        boloes={boloesDisponiveis}
        onSuccess={() => {
          carregarNomesParticipantes()
          refreshBoloes()
        }}
      />
    </div>
  )
}
