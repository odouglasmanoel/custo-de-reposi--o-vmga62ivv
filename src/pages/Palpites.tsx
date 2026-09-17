import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  Sparkles,
  AlertCircle,
  Edit3,
  Lock,
  Globe,
  Filter,
  ArrowLeft,
  Users,
  RefreshCcw,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Jogo, Palpite, Participante, Bolao } from '@/types/bolao'
import { GERAL_BOLAO_ID } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  formatDataBR,
  formatHoraBR,
  isPalpiteEncerrado,
  formatHoraEncerramento,
} from '@/lib/dateUtils'
import { formatPalpiteMarcadoresSummary, getPalpiteMarcadoresPorTime } from '@/lib/scorerUtils'

interface PalpiteFormData {
  placar_a: number | string
  placar_b: number | string
  goleadores_a: string[]
  goleadores_b: string[]
  vencedor_penaltis: 'A' | 'B' | 'N' | string
}

function normalizeScorersArray(raw: any, goalCount: number): string[] {
  let currentList: string[] = []
  if (Array.isArray(raw)) {
    currentList = raw.map((x) => String(x || '').trim())
  } else if (typeof raw === 'string' && raw.trim()) {
    // Pode ser JSON stringificado ou texto separado por vírgula
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        currentList = parsed.map((x) => String(x || '').trim())
      } else {
        currentList = raw.split(',').map((s) => s.trim())
      }
    } catch (_) {
      currentList = raw.split(',').map((s) => s.trim())
    }
  }

  if (goalCount <= 0) return []
  const result: string[] = []
  for (let i = 0; i < goalCount; i++) {
    result.push(currentList[i] ?? '')
  }
  return result
}

export default function Palpites() {
  const { user, participantName, isAdmin } = useAuth()
  const { boloes, activeBolao, activeBolaoId, currentParticipante } = useActivePool()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const isGeralParam = searchParams.get('geral') === '1' || activeBolaoId === GERAL_BOLAO_ID
  const pendentesRaw = searchParams.get('pendentes')
  // Padrão: true (Apenas Pendentes ativado por padrão em todas as copas e na visão geral)
  // Caso o usuário acesse explicitamente ?pendentes=0, desativa; se ?pendentes=1 ou omitido, inicia ativado (true)
  const initialPendentes = pendentesRaw === null ? true : pendentesRaw !== '0'

  const [jogos, setJogos] = useState<Jogo[]>([])
  const [allBoloes, setAllBoloes] = useState<Bolao[]>([])
  const [participantesList, setParticipantesList] = useState<Participante[]>([])
  const [allGroupPalpites, setAllGroupPalpites] = useState<Palpite[]>([])
  const [userParticipantsMap, setUserParticipantsMap] = useState<Record<string, Participante>>({})
  const [palpites, setPalpites] = useState<Record<string, Palpite>>({})
  const [formData, setFormData] = useState<Record<string, PalpiteFormData>>({})
  const [editingGames, setEditingGames] = useState<Record<string, boolean>>({})
  const [savingGameId, setSavingGameId] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({})
  const [adminEditingPalpite, setAdminEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
    timeA: string
    timeB: string
  } | null>(null)
  const [filterPendentes, setFilterPendentes] = useState<boolean>(initialPendentes)
  const [visibleCount, setVisibleCount] = useState<number>(20)
  const [loadingGroupBets, setLoadingGroupBets] = useState(false)
  const [loadedGroupBets, setLoadedGroupBets] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(Date.now())

  // Referências para deduplicação e controle de concorrência
  const activeLoadPromiseRef = useRef<Promise<void> | null>(null)
  const activeGroupBetsPromiseRef = useRef<Promise<void> | null>(null)
  const lastLoadTimeRef = useRef<number>(0)

  // Atualiza periodicamente o horário atual para sincronizar o bloqueio de encerramento em tempo real
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  // Sincronizar filtro se a query string mudar na navegação
  useEffect(() => {
    if (pendentesRaw !== null) {
      setFilterPendentes(pendentesRaw !== '0')
    }
  }, [pendentesRaw])

  // Resetar contagem visível ao mudar bolão ou filtro
  useEffect(() => {
    setVisibleCount(20)
  }, [activeBolaoId, isGeralParam, filterPendentes])

  // Resetar estado de palpites do grupo sob demanda quando trocar de bolão
  useEffect(() => {
    setLoadedGroupBets(false)
    setAllGroupPalpites([])
  }, [activeBolaoId, isGeralParam])

  // Carregamento SOB DEMANDA dos palpites do grupo (apenas quando solicitado pelo usuário)
  // Deduplicado para nunca disparar chamadas concorrentes repetidas
  const loadGroupBetsOnDemand = useCallback(async () => {
    if (loadedGroupBets) return
    if (activeGroupBetsPromiseRef.current) {
      return activeGroupBetsPromiseRef.current
    }

    setLoadingGroupBets(true)

    const fetchTask = async () => {
      try {
        if (isGeralParam) {
          const [allParts, allGroupBets] = await Promise.all([
            pb.collection('participantes').getFullList<Participante>({
              sort: 'nome',
              fields: 'id,nome,bolao',
            }),
            pb.collection('palpites').getFullList<Palpite>({
              fields:
                'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,pontuacao_jogo,vencedor_penaltis',
            }),
          ])
          setParticipantesList(allParts)
          setAllGroupPalpites(allGroupBets)
        } else {
          const currentTargetBolaoId =
            activeBolaoId && activeBolaoId !== GERAL_BOLAO_ID
              ? activeBolaoId
              : boloes.find((b) => b.ativo)?.id || boloes[0]?.id
          if (currentTargetBolaoId) {
            const [parts, bets] = await Promise.all([
              pb.collection('participantes').getFullList<Participante>({
                filter: `bolao = '${currentTargetBolaoId}'`,
                sort: 'nome',
                fields: 'id,nome,bolao',
              }),
              pb.collection('palpites').getFullList<Palpite>({
                filter: `bolao = '${currentTargetBolaoId}'`,
                fields:
                  'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,pontuacao_jogo,vencedor_penaltis',
              }),
            ])
            setParticipantesList(parts)
            setAllGroupPalpites(bets)
          }
        }
        setLoadedGroupBets(true)
      } catch (err) {
        console.warn('Erro ao carregar palpites do grupo sob demanda:', err)
      } finally {
        setLoadingGroupBets(false)
        activeGroupBetsPromiseRef.current = null
      }
    }

    const promise = fetchTask()
    activeGroupBetsPromiseRef.current = promise
    return promise
  }, [loadedGroupBets, isGeralParam, activeBolaoId, boloes])

  // Carregamento principal dos jogos e palpites do usuário logado
  // Tolerante a timeout (10s), deduplicado e com payload otimizado (campos estritamente necessários)
  const loadData = useCallback(
    async (isManualRefresh: boolean = false) => {
      if (!user) return

      const now = Date.now()
      if (!isManualRefresh && now - lastLoadTimeRef.current < 2500) {
        return
      }

      if (activeLoadPromiseRef.current) {
        return activeLoadPromiseRef.current
      }

      if (isManualRefresh) {
        setIsRefreshing(true)
      }

      const fetchTask = async () => {
        lastLoadTimeRef.current = Date.now()
        setLoadError(null)

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Tempo de resposta excedido ao buscar palpites')),
            10000,
          ),
        )

        try {
          const searchName =
            participantName ||
            (user.name as string) ||
            (user.email ? (user.email as string).split('@')[0] : '')

          // Buscar lista de bolões com campos essenciais para exibir nome e tema
          const loadedBoloes =
            boloes.length > 0
              ? boloes
              : await pb.collection('boloes').getFullList<Bolao>({
                  sort: 'nome',
                  fields: 'id,nome,foco,ativo',
                })
          setAllBoloes(loadedBoloes)

          if (isGeralParam) {
            // MODO GERAL: Carregamento otimizado — buscar jogos + participantes do usuário + palpites do próprio usuário
            // Retorna apenas dados estritamente necessários do usuário logado, reduzindo o payload drasticamente
            const allGamesPromise = pb.collection('jogos').getFullList<Jogo>({
              sort: 'data,hora',
              fields:
                'id,bolao,time_a,time_b,data,hora,competicao,resultado_finalizado,placar_a,placar_b,tem_penaltis,vencedor_penaltis',
            })

            // Buscar apenas os registros de participante deste usuário
            const myPartsPromise = pb.collection('participantes').getFullList<Participante>({
              filter: `nome ~ '${searchName.replace(/'/g, "\\'")}'`,
              fields: 'id,nome,bolao',
            })

            const [allGames, myParts] = await Promise.race([
              Promise.all([allGamesPromise, myPartsPromise]),
              timeoutPromise,
            ])

            const myPartMapByBolao: Record<string, Participante> = {}
            for (const p of myParts) {
              myPartMapByBolao[p.bolao] = p
            }
            setUserParticipantsMap(myPartMapByBolao)

            const myPartIds = myParts.map((p) => p.id)
            let myPalpites: Palpite[] = []

            if (myPartIds.length > 0) {
              const filterUserBets = myPartIds.map((id) => `participante = '${id}'`).join(' || ')
              myPalpites = await Promise.race([
                pb.collection('palpites').getFullList<Palpite>({
                  filter: filterUserBets,
                  fields:
                    'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento',
                }),
                timeoutPromise,
              ])
            }

            if (Array.isArray(allGames)) {
              setJogos(allGames)

              const mapPalpites: Record<string, Palpite> = {}
              const forms: Record<string, PalpiteFormData> = {}

              for (const p of myPalpites) {
                mapPalpites[p.jogo] = p
                const gA = p.placar_a !== null && p.placar_a !== undefined ? Number(p.placar_a) : 0
                const gB = p.placar_b !== null && p.placar_b !== undefined ? Number(p.placar_b) : 0
                forms[p.jogo] = {
                  placar_a: p.placar_a ?? '',
                  placar_b: p.placar_b ?? '',
                  goleadores_a: normalizeScorersArray(p.goleadores_a, gA),
                  goleadores_b: normalizeScorersArray(p.goleadores_b, gB),
                  vencedor_penaltis: p.vencedor_penaltis || 'N',
                }
              }

              setPalpites(mapPalpites)
              setFormData(forms)
            }
          } else {
            // MODO BOLÃO ESPECÍFICO: Buscar apenas dados deste bolão e do participante logado
            const currentTargetBolaoId =
              activeBolaoId && activeBolaoId !== GERAL_BOLAO_ID
                ? activeBolaoId
                : loadedBoloes.find((b) => b.ativo)?.id || loadedBoloes[0]?.id

            if (!currentTargetBolaoId) {
              setLoading(false)
              setIsRefreshing(false)
              return
            }

            let participanteId = currentParticipante?.id
            if (!participanteId || currentParticipante?.bolao !== currentTargetBolaoId) {
              if (searchName) {
                try {
                  const parts = await pb.collection('participantes').getFullList<Participante>({
                    filter: `bolao = '${currentTargetBolaoId}' && (nome ~ '${searchName.replace(/'/g, "\\'")}')`,
                    fields: 'id,nome,bolao',
                  })
                  const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
                  const partial = parts.find(
                    (p) =>
                      p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
                      searchName.toLowerCase().includes(p.nome.toLowerCase()),
                  )
                  const resolved = exact || partial || parts[0]
                  if (resolved) {
                    participanteId = resolved.id
                    setUserParticipantsMap({ [currentTargetBolaoId]: resolved })
                  }
                } catch {
                  /* ignore */
                }
              }
            } else if (currentParticipante) {
              setUserParticipantsMap({ [currentTargetBolaoId]: currentParticipante })
            }

            // Buscar apenas jogos do bolão e palpites deste participante com campos enxutos
            const gamesPromise = pb.collection('jogos').getFullList<Jogo>({
              filter: `bolao = '${currentTargetBolaoId}'`,
              sort: 'data,hora',
              fields:
                'id,bolao,time_a,time_b,data,hora,competicao,resultado_finalizado,placar_a,placar_b,tem_penaltis,vencedor_penaltis',
            })

            let myPalpitesPromise: Promise<Palpite[]> = Promise.resolve([])
            if (participanteId) {
              myPalpitesPromise = pb.collection('palpites').getFullList<Palpite>({
                filter: `bolao = '${currentTargetBolaoId}' && participante = '${participanteId}'`,
                fields:
                  'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento',
              })
            }

            const [gamesList, myPalpites] = await Promise.race([
              Promise.all([gamesPromise, myPalpitesPromise]),
              timeoutPromise,
            ])

            if (Array.isArray(gamesList)) {
              setJogos(gamesList)

              const mapPalpites: Record<string, Palpite> = {}
              const forms: Record<string, PalpiteFormData> = {}

              for (const p of myPalpites) {
                mapPalpites[p.jogo] = p
                const gA = p.placar_a !== null && p.placar_a !== undefined ? Number(p.placar_a) : 0
                const gB = p.placar_b !== null && p.placar_b !== undefined ? Number(p.placar_b) : 0
                forms[p.jogo] = {
                  placar_a: p.placar_a ?? '',
                  placar_b: p.placar_b ?? '',
                  goleadores_a: normalizeScorersArray(p.goleadores_a, gA),
                  goleadores_b: normalizeScorersArray(p.goleadores_b, gB),
                  vencedor_penaltis: p.vencedor_penaltis || 'N',
                }
              }

              setPalpites(mapPalpites)
              setFormData(forms)
            }
          }
        } catch (err) {
          console.warn('Alerta ao carregar palpites (preservando estado atual):', err)
          setLoadError(
            'A resposta demorou mais que o normal. Seus palpites atuais foram preservados.',
          )
        } finally {
          setLoading(false)
          setIsRefreshing(false)
          activeLoadPromiseRef.current = null
        }
      }

      const promise = fetchTask()
      activeLoadPromiseRef.current = promise
      return promise
    },
    [user, participantName, boloes, isGeralParam, activeBolaoId, currentParticipante],
  )

  useRealtime<Jogo>('jogos', () => {
    loadData()
  })

  useRealtime<Palpite>('palpites', () => {
    loadData()
  })

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [activeBolaoId, isGeralParam, currentParticipante, loadData])

  const handleScoreChange = (jogoId: string, team: 'a' | 'b', rawVal: string) => {
    const valNum = rawVal === '' ? '' : Math.max(0, parseInt(rawVal, 10) || 0)
    setFormData((prev) => {
      const cur = prev[jogoId] || {
        placar_a: '',
        placar_b: '',
        goleadores_a: [],
        goleadores_b: [],
        vencedor_penaltis: 'N',
      }

      if (team === 'a') {
        const goalCount = typeof valNum === 'number' ? valNum : 0
        const updatedList = normalizeScorersArray(cur.goleadores_a, goalCount)
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            placar_a: valNum,
            goleadores_a: updatedList,
          },
        }
      } else {
        const goalCount = typeof valNum === 'number' ? valNum : 0
        const updatedList = normalizeScorersArray(cur.goleadores_b, goalCount)
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            placar_b: valNum,
            goleadores_b: updatedList,
          },
        }
      }
    })
  }

  const handleScorerLineChange = (
    jogoId: string,
    team: 'a' | 'b',
    index: number,
    nameValue: string,
  ) => {
    setFormData((prev) => {
      const cur = prev[jogoId] || {
        placar_a: '',
        placar_b: '',
        goleadores_a: [],
        goleadores_b: [],
        vencedor_penaltis: 'N',
      }

      if (team === 'a') {
        const list = [...(cur.goleadores_a || [])]
        list[index] = nameValue
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_a: list,
          },
        }
      } else {
        const list = [...(cur.goleadores_b || [])]
        list[index] = nameValue
        return {
          ...prev,
          [jogoId]: {
            ...cur,
            goleadores_b: list,
          },
        }
      }
    })
  }

  const handlePenaltisChange = (jogoId: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [jogoId]: {
        ...(prev[jogoId] || {
          placar_a: '',
          placar_b: '',
          goleadores_a: [],
          goleadores_b: [],
          vencedor_penaltis: 'N',
        }),
        vencedor_penaltis: value,
      },
    }))
  }

  const handleSavePalpite = async (jogo: Jogo) => {
    // Validação preventiva no frontend: verificar se o horário do jogo já foi atingido (Fuso Brasília UTC-3)
    if (isPalpiteEncerrado(jogo.data, jogo.hora, Date.now())) {
      const horaEncerramento = formatHoraEncerramento(jogo.hora)
      toast({
        title: 'Palpites encerrados',
        description: `Não foi possível salvar: os palpites para este jogo foram encerrados às ${horaEncerramento}`,
        variant: 'destructive',
      })
      // Desabilita modo de edição
      setEditingGames((prev) => ({
        ...prev,
        [jogo.id]: false,
      }))
      return
    }

    const jogoBolaoId = jogo.bolao || activeBolaoId
    if (!jogoBolaoId) return

    // Resolve participante específico para o bolão deste jogo
    let participanteToUse = userParticipantsMap[jogoBolaoId] || currentParticipante
    if (!participanteToUse || participanteToUse.bolao !== jogoBolaoId) {
      const searchName =
        participantName ||
        (user?.name as string) ||
        (user?.email ? (user.email as string).split('@')[0] : '')
      if (searchName) {
        try {
          const parts = await pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${jogoBolaoId}'`,
          })
          const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          participanteToUse = exact || partial || parts[0] || null
        } catch {
          /* intentionally ignored */
        }
      }
    }

    if (!participanteToUse) {
      toast({
        title: 'Participante não identificado',
        description: 'Não foi possível encontrar seu cadastro de participante neste bolão.',
        variant: 'destructive',
      })
      return
    }

    const currentForm = formData[jogo.id]

    if (
      currentForm?.placar_a === '' ||
      currentForm?.placar_a === undefined ||
      currentForm?.placar_b === '' ||
      currentForm?.placar_b === undefined
    ) {
      toast({
        title: 'Preencha o placar',
        description: 'Informe os gols previstos para os dois times.',
        variant: 'destructive',
      })
      return
    }

    setSavingGameId(jogo.id)
    try {
      const numA = Number(currentForm.placar_a)
      const numB = Number(currentForm.placar_b)

      // Regras de marcadores:
      // Se gols > 0: lista de marcadores (suporta repetidos, ex: "Pedro Raul, Pedro Raul")
      // Se gols == 0: string vazia "" ou null (nunca lista de objetos vazios)
      const gA =
        numA > 0 ? (currentForm.goleadores_a || []).map((s) => s.trim()).filter(Boolean) : []
      const gB =
        numB > 0 ? (currentForm.goleadores_b || []).map((s) => s.trim()).filter(Boolean) : []

      // Marcadores time A e B: texto simples separado por vírgulas ("" ou null quando o time fez 0 gols, incluindo o caso 0x0)
      const marcadoresTimeA = numA > 0 ? gA.join(', ') : ''
      const marcadoresTimeB = numB > 0 ? gB.join(', ') : ''
      const vencedorPenaltis = currentForm.vencedor_penaltis || 'N'

      // Payload explícito enviado para o endpoint server-side /backend/v1/salvar-palpite:
      // - jogo_id (ID do jogo)
      // - usuario_email ou usuario_id (identificação do usuário)
      // - gols_time_a e gols_time_b (inteiros)
      // - marcadores_time_a e marcadores_time_b (texto simples separado por vírgulas, "" ou null para 0 gols)
      // - vencedor_penaltis
      const userEmail = (user?.email as string) || ''
      const userId = (user?.id as string) || ''

      const response = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/salvar-palpite`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: pb.authStore.token,
          },
          body: JSON.stringify({
            jogo_id: jogo.id,
            bolao_id: jogoBolaoId,
            participante_id: participanteToUse.id,
            usuario_email: userEmail,
            usuario_id: userId,
            gols_time_a: numA,
            gols_time_b: numB,
            marcadores_time_a: numA > 0 ? marcadoresTimeA : '',
            marcadores_time_b: numB > 0 ? marcadoresTimeB : '',
            vencedor_penaltis: vencedorPenaltis,
            placar_a: numA,
            placar_b: numB,
            goleadores_a: gA,
            goleadores_b: gB,
          }),
        },
      )

      if (!response.ok) {
        const resJson = await response.json().catch(() => ({}))
        throw new Error(resJson.error || 'Erro ao salvar palpite no servidor')
      }

      toast({
        title: 'Palpite salvo com sucesso!',
        description: `Palpite para ${jogo.time_a} x ${jogo.time_b} registrado.`,
      })
      setEditingGames((prev) => ({
        ...prev,
        [jogo.id]: false,
      }))
      await loadData()
    } catch (err: unknown) {
      console.error('Erro ao salvar palpite:', err)
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as any).message)
            : 'Falha na comunicação com o servidor'
      toast({
        title: 'Erro ao registrar palpite',
        description: errorMsg,
        variant: 'destructive',
      })
    } finally {
      setSavingGameId(null)
    }
  }

  const toggleDetails = (jogoId: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [jogoId]: !prev[jogoId],
    }))
  }

  // Mapear id do bolão para o objeto do bolão para rótulos fáceis
  const bolaoMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of allBoloes) {
      map.set(b.id, b)
    }
    return map
  }, [allBoloes])

  // Mapear id do participante para o objeto Participante
  const participanteMap = useMemo(() => {
    const map = new Map<string, Participante>()
    for (const p of participantesList) {
      map.set(p.id, p)
    }
    return map
  }, [participantesList])

  // Lista de jogos filtrada se pendentes estiver ativo
  const allFilteredJogos = useMemo(() => {
    if (!filterPendentes) return jogos
    return jogos.filter((j) => !j.resultado_finalizado)
  }, [jogos, filterPendentes])

  // Lista fatiada para carregamento progressivo e renderização instantânea
  const displayedJogos = useMemo(() => {
    return allFilteredJogos.slice(0, visibleCount)
  }, [allFilteredJogos, visibleCount])

  const hasMore = visibleCount < allFilteredJogos.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              Meus Palpites — {participantName || 'Participante'}
            </h1>
            {isGeralParam ? (
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
            {isGeralParam ? (
              <span>
                Listagem unificada:{' '}
                <span className="font-semibold text-[#0F2A43]">Todas as Copas e Competições</span>
              </span>
            ) : (
              <span>
                Competição:{' '}
                <span className="font-semibold text-[#0F2A43]">
                  {activeBolao?.nome || 'Bolão do Grupo'}
                </span>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
            title="Atualizar palpites"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 text-[#0F2A43] ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </Button>

          {/* Botão de filtro para alternar entre todos e apenas pendentes */}
          <Button
            type="button"
            variant={filterPendentes ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const nextState = !filterPendentes
              setFilterPendentes(nextState)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                if (nextState) {
                  updated.set('pendentes', '1')
                } else {
                  updated.set('pendentes', '0')
                }
                return updated
              })
            }}
            className={`h-8 gap-1.5 text-xs font-semibold ${
              filterPendentes
                ? 'bg-[#F59E0B] text-slate-950 hover:bg-amber-400 font-bold'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>{filterPendentes ? 'Filtrando: Jogos Pendentes' : 'Apenas Pendentes'}</span>
          </Button>

          <Badge variant="outline" className="border-slate-300 text-xs text-slate-700 py-1">
            {allFilteredJogos.length} jogo(s) {filterPendentes ? 'pendente(s)' : 'total'}
          </Badge>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-700 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadData(true)}
            className="text-xs font-bold text-amber-900 underline hover:text-amber-950"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {filterPendentes ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-700 shrink-0" />
            <span>Exibindo apenas jogos pendentes para registrar ou editar seus palpites.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFilterPendentes(false)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                updated.set('pendentes', '0')
                return updated
              })
            }}
            className="text-xs font-bold text-amber-900 underline hover:text-amber-950"
          >
            Ver todos os jogos
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          <span>Exibindo todos os jogos (encerrados e pendentes).</span>
          <button
            type="button"
            onClick={() => {
              setFilterPendentes(true)
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev)
                updated.set('pendentes', '1')
                return updated
              })
            }}
            className="text-xs font-bold text-[#0F2A43] underline hover:text-slate-950"
          >
            Apenas pendentes
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2A43]" />
        </div>
      ) : displayedJogos.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500">
          {filterPendentes
            ? 'Não há jogos pendentes no momento para os critérios selecionados.'
            : 'Nenhuma partida disponível. Os jogos serão cadastrados pelo administrador Douglas.'}
        </Card>
      ) : (
        <div className="space-y-4">
          {displayedJogos.map((jogo) => {
            const bolaoOrigem = bolaoMap.get(jogo.bolao)
            const palpite = palpites[jogo.id]
            const form = formData[jogo.id] || {
              placar_a: '',
              placar_b: '',
              goleadores_a: '',
              goleadores_b: '',
              vencedor_penaltis: 'N',
            }

            const finalizado = jogo.resultado_finalizado
            const pontos = palpite ? palpite.pontuacao_jogo : 0
            const detalhamento = palpite?.detalhamento || []

            return (
              <Card
                key={jogo.id}
                className="overflow-hidden rounded-[14px] border-[#E2E8F0] bg-white shadow-xs transition hover:shadow-sm"
              >
                {/* Match header */}
                <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    {/* Badge da Copa / Bolão de origem (especialmente valioso na lista unificada) */}
                    {bolaoOrigem && (
                      <Badge
                        variant="secondary"
                        className="border border-[#CBD5E1] bg-white text-[#0F2A43] font-bold text-[11px] px-2 py-0.5 shadow-2xs"
                      >
                        🏆 {bolaoOrigem.nome} {bolaoOrigem.ativo === false ? '(Encerrado)' : ''}
                      </Badge>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      <span>{formatDataBR(jogo.data)}</span>
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>{formatHoraBR(jogo.hora)}</span>
                    </span>
                  </div>
                  {finalizado ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-black text-white">
                        Resultado Real: {jogo.placar_a} x {jogo.placar_b}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          pontos > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {pontos > 0 ? `+${pontos} pontos` : '0 pontos'}
                      </span>
                    </div>
                  ) : isPalpiteEncerrado(jogo.data, jogo.hora, nowMs) ? (
                    <Badge
                      variant="outline"
                      className="border-rose-300 bg-rose-50 text-rose-800 text-[11px] font-semibold gap-1"
                    >
                      <Lock className="h-3 w-3 text-rose-600" />
                      Palpites encerrados para esta partida
                    </Badge>
                  ) : palpite && !editingGames[jogo.id] ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] font-semibold gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Palpite Registrado
                    </Badge>
                  ) : palpite && editingGames[jogo.id] ? (
                    <Badge
                      variant="outline"
                      className="border-blue-300 bg-blue-50 text-blue-800 text-[11px] font-semibold gap-1"
                    >
                      <Edit3 className="h-3 w-3 text-blue-600" />
                      Editando Palpite
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-amber-800 text-[11px]"
                    >
                      Aberto para palpites
                    </Badge>
                  )}{' '}
                </div>

                <div className="p-6">
                  {/* Teams vs block */}
                  <div className="flex flex-col items-center justify-center gap-1.5 py-2">
                    <div className="flex items-center justify-center gap-6">
                      <span className="text-base font-bold text-[#0F172A] sm:text-lg">
                        {jogo.time_a}
                      </span>
                      <span className="text-xs font-bold uppercase text-slate-400">VS</span>
                      <span className="text-base font-bold text-[#0F172A] sm:text-lg">
                        {jogo.time_b}
                      </span>
                    </div>
                    {jogo.competicao && (
                      <Badge
                        variant="secondary"
                        className="border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-700 px-2 py-0.5"
                      >
                        {jogo.competicao}
                      </Badge>
                    )}
                  </div>
                  {/* Grupo de palpites liberados para partidas encerradas ou com horário de kickoff atingido */}
                  {(() => {
                    const isExpiredOrFinalized =
                      finalizado || isPalpiteEncerrado(jogo.data, jogo.hora, nowMs)
                    if (!isExpiredOrFinalized) return null

                    if (!loadedGroupBets) {
                      return (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-center">
                          <p className="text-xs text-slate-600 mb-2">
                            Palpites do grupo disponíveis para esta partida encerrada ou iniciada.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loadingGroupBets}
                            onClick={loadGroupBetsOnDemand}
                            className="h-7 text-xs font-semibold border-slate-300 text-[#0F2A43] hover:bg-white"
                          >
                            {loadingGroupBets ? (
                              <>
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                Carregando palpites do grupo...
                              </>
                            ) : (
                              <>
                                <Users className="mr-1.5 h-3.5 w-3.5" />
                                Carregar palpites do grupo
                              </>
                            )}
                          </Button>
                        </div>
                      )
                    }

                    const betsForGame = allGroupPalpites.filter((p) => p.jogo === jogo.id)

                    return (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                        <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200">
                          <div className="flex items-center gap-1.5">
                            <Users className="h-4 w-4 text-[#0F2A43]" />
                            <span className="text-xs font-bold text-[#0F172A]">
                              Palpites do Grupo Liberados
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className="border-slate-300 bg-white text-[10px] font-semibold text-slate-700"
                          >
                            {betsForGame.length} palpite(s)
                          </Badge>
                        </div>

                        {betsForGame.length === 0 ? (
                          <p className="text-center py-2 text-xs italic text-slate-400">
                            Nenhum participante registrou palpite para esta partida antes do
                            encerramento.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                            {betsForGame.map((bet) => {
                              const part = participanteMap.get(bet.participante)
                              const nomeParticipante = part?.nome || 'Participante'
                              const isCurrentUser =
                                participantName &&
                                nomeParticipante.trim().toLowerCase() ===
                                  participantName.trim().toLowerCase()

                              return (
                                <div
                                  key={bet.id}
                                  className={`rounded-lg border p-3 text-xs transition duration-150 shadow-2xs ${
                                    isCurrentUser
                                      ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-300'
                                      : 'border-slate-200 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold text-[#0F172A] truncate">
                                      {nomeParticipante}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {isCurrentUser && (
                                        <Badge className="bg-[#10B981] px-1 py-0 text-[9px] font-bold text-white hover:bg-[#10B981]">
                                          Você
                                        </Badge>
                                      )}
                                      {isAdmin && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setAdminEditingPalpite({
                                              palpite: bet,
                                              participanteNome: nomeParticipante,
                                              timeA: jogo.time_a,
                                              timeB: jogo.time_b,
                                            })
                                          }
                                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition"
                                          title="Editar marcadores deste palpite (Admin)"
                                        >
                                          <Edit3 className="h-2.5 w-2.5" />
                                          <span>Editar</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-slate-800">
                                    Palpite:{' '}
                                    <strong className="text-sm font-black text-[#0F2A43]">
                                      {bet.placar_a} x {bet.placar_b}
                                    </strong>
                                  </div>
                                  {(() => {
                                    const splitPalpite = getPalpiteMarcadoresPorTime(bet)
                                    const is0x0 =
                                      splitPalpite.placarA === 0 && splitPalpite.placarB === 0

                                    if (is0x0) {
                                      return (
                                        <div className="mt-1 text-[10px] text-slate-400 italic">
                                          Sem marcadores (0x0)
                                        </div>
                                      )
                                    }

                                    return (
                                      <div className="mt-1.5 space-y-0.5 border-t border-slate-200/60 pt-1 text-[11px] leading-snug">
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
                                  {finalizado && (
                                    <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                                      <span className="text-slate-500 font-medium">Pontos:</span>
                                      <span
                                        className={`font-bold ${
                                          bet.pontuacao_jogo > 0
                                            ? 'text-emerald-700'
                                            : 'text-slate-500'
                                        }`}
                                      >
                                        +{bet.pontuacao_jogo} pts
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {/* Form or Read-only view */}
                  {finalizado /* Finalized game: show participant's bet and points detail toggle */ ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-slate-700">
                          <span className="font-semibold text-slate-900">
                            Seu palpite de placar:
                          </span>{' '}
                          {palpite ? (
                            <strong className="text-sm font-black text-[#0F2A43]">
                              {palpite.placar_a} x {palpite.placar_b}
                            </strong>
                          ) : (
                            <span className="text-slate-400 italic">Nenhum palpite enviado</span>
                          )}
                        </div>

                        {palpite && detalhamento.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleDetails(jogo.id)}
                            className="h-7 text-xs font-semibold text-[#0F2A43] hover:bg-slate-200"
                          >
                            <span>Detalhar pontuação</span>
                            {expandedDetails[jogo.id] ? (
                              <ChevronUp className="ml-1 h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="ml-1 h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Scorer prediction snapshot */}
                      {palpite && (
                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded bg-white p-2 border border-slate-200">
                            <span className="text-[11px] font-medium text-slate-500">
                              Goleadores indicados ({jogo.time_a}):
                            </span>
                            <p className="font-medium text-slate-800">
                              {Array.isArray(palpite.goleadores_a) &&
                              palpite.goleadores_a.length > 0
                                ? palpite.goleadores_a.join(', ')
                                : 'Nenhum'}
                            </p>
                          </div>
                          <div className="rounded bg-white p-2 border border-slate-200">
                            <span className="text-[11px] font-medium text-slate-500">
                              Goleadores indicados ({jogo.time_b}):
                            </span>
                            <p className="font-medium text-slate-800">
                              {Array.isArray(palpite.goleadores_b) &&
                              palpite.goleadores_b.length > 0
                                ? palpite.goleadores_b.join(', ')
                                : 'Nenhum'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Expandable breakdown list */}
                      {expandedDetails[jogo.id] && detalhamento.length > 0 && (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 animate-in fade-in duration-200">
                          <p className="font-bold text-emerald-950 mb-1">
                            Critérios de pontuação atendidos:
                          </p>
                          <ul className="list-inside list-disc space-y-1">
                            {detalhamento.map((item, idx) => (
                              <li key={idx} className="font-medium">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Active game: Palpite registration form */
                    (() => {
                      const isSaved = Boolean(palpite)
                      const isExpired = isPalpiteEncerrado(jogo.data, jogo.hora, nowMs)
                      // Se o prazo expirou, não permite editar
                      const isEditing = Boolean(editingGames[jogo.id]) && !isExpired
                      const isLocked = (isSaved && !isEditing) || isExpired
                      const horaEncerramento = formatHoraEncerramento(jogo.hora)

                      return (
                        <div className="mt-4 space-y-4">
                          {/* Banner de encerramento da partida */}
                          {isExpired && (
                            <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-900">
                              <div className="flex items-center gap-2">
                                <Lock className="h-4 w-4 text-rose-700 shrink-0" />
                                <span>
                                  <strong>Palpites encerrados para esta partida</strong>{' '}
                                  (encerramento às {horaEncerramento}).
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className="border-rose-300 bg-white text-rose-800 text-[11px] font-bold"
                              >
                                Encerrado
                              </Badge>
                            </div>
                          )}

                          {/* Status banner when saved & locked (and not expired) */}
                          {isLocked && !isExpired && (
                            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-900">
                              <div className="flex items-center gap-2">
                                <Lock className="h-4 w-4 text-emerald-700 shrink-0" />
                                <span>
                                  <strong>Palpite Registrado.</strong> Os campos estão travados para
                                  leitura.
                                </span>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  setEditingGames((prev) => ({
                                    ...prev,
                                    [jogo.id]: true,
                                  }))
                                }
                                className="h-7 gap-1 rounded bg-[#0F2A43] px-3 text-[11px] font-semibold text-white hover:bg-[#1B3A5C]"
                              >
                                <Edit3 className="h-3 w-3" />
                                Editar Palpite
                              </Button>
                            </div>
                          )}

                          {isEditing && !isExpired && (
                            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-xs text-blue-900">
                              <div className="flex items-center gap-2">
                                <Edit3 className="h-4 w-4 text-blue-700 shrink-0" />
                                <span>
                                  Modo de edição ativo. Atualize seus palpites e clique em{' '}
                                  <strong>Salvar Palpite</strong>.
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  // Cancel edit: revert to original saved palpite
                                  const gA =
                                    palpite.placar_a !== null && palpite.placar_a !== undefined
                                      ? Number(palpite.placar_a)
                                      : 0
                                  const gB =
                                    palpite.placar_b !== null && palpite.placar_b !== undefined
                                      ? Number(palpite.placar_b)
                                      : 0
                                  setFormData((prev) => ({
                                    ...prev,
                                    [jogo.id]: {
                                      placar_a: palpite.placar_a ?? '',
                                      placar_b: palpite.placar_b ?? '',
                                      goleadores_a: normalizeScorersArray(palpite.goleadores_a, gA),
                                      goleadores_b: normalizeScorersArray(palpite.goleadores_b, gB),
                                      vencedor_penaltis: palpite.vencedor_penaltis || 'N',
                                    },
                                  }))
                                  setEditingGames((prev) => ({
                                    ...prev,
                                    [jogo.id]: false,
                                  }))
                                }}
                                className="h-7 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                              >
                                Cancelar
                              </Button>
                            </div>
                          )}

                          {/* Score inputs */}
                          <div className="flex items-center justify-center gap-4">
                            <div className="w-24 text-center">
                              <Label className="text-[11px] font-bold text-slate-600">
                                Gols {jogo.time_a}
                              </Label>
                              <Input
                                type="number"
                                min="0"
                                disabled={isLocked}
                                placeholder="0"
                                value={form.placar_a ?? ''}
                                onChange={(e) => handleScoreChange(jogo.id, 'a', e.target.value)}
                                className={`mt-1 h-12 text-center text-xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                  isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                                }`}
                              />
                            </div>

                            <span className="pt-5 text-xl font-bold text-slate-300">X</span>

                            <div className="w-24 text-center">
                              <Label className="text-[11px] font-bold text-slate-600">
                                Gols {jogo.time_b}
                              </Label>
                              <Input
                                type="number"
                                min="0"
                                disabled={isLocked}
                                placeholder="0"
                                value={form.placar_b ?? ''}
                                onChange={(e) => handleScoreChange(jogo.id, 'b', e.target.value)}
                                className={`mt-1 h-12 text-center text-xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                  isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                                }`}
                              />
                            </div>
                          </div>

                          {/* Goal scorers dynamic line inputs: 1 input per goal entered in score */}
                          {(() => {
                            const numGolsA =
                              form.placar_a === '' || form.placar_a === undefined
                                ? 0
                                : Math.max(0, Number(form.placar_a) || 0)
                            const numGolsB =
                              form.placar_b === '' || form.placar_b === undefined
                                ? 0
                                : Math.max(0, Number(form.placar_b) || 0)
                            const isZeroA = numGolsA === 0
                            const isZeroB = numGolsB === 0

                            return (
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {/* Team A Scorers */}
                                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                                    <Label className="text-xs font-bold text-slate-800">
                                      Marcadores de gols — {jogo.time_a}
                                    </Label>
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] ${
                                        isZeroA
                                          ? 'border-slate-300 text-slate-400 bg-slate-100'
                                          : 'border-emerald-300 text-emerald-800 bg-emerald-50'
                                      }`}
                                    >
                                      {isZeroA
                                        ? '0 gols (bloqueado)'
                                        : `${numGolsA} gol${numGolsA > 1 ? 's' : ''} previsto${numGolsA > 1 ? 's' : ''}`}
                                    </Badge>
                                  </div>

                                  {isZeroA ? (
                                    <p className="py-3 text-center text-xs italic text-slate-400">
                                      Placar zero (0): campo de marcadores bloqueado.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {Array.from({ length: numGolsA }).map((_, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                                            {idx + 1}º
                                          </span>
                                          <Input
                                            disabled={isLocked}
                                            placeholder={`Nome do autor do ${idx + 1}º gol (ex: Pedro Raul)`}
                                            value={form.goleadores_a?.[idx] || ''}
                                            onChange={(e) =>
                                              handleScorerLineChange(
                                                jogo.id,
                                                'a',
                                                idx,
                                                e.target.value,
                                              )
                                            }
                                            className={`h-8 border-[#CBD5E1] bg-white text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                              isLocked
                                                ? 'bg-slate-100 cursor-not-allowed opacity-90'
                                                : ''
                                            }`}
                                          />
                                        </div>
                                      ))}
                                      <p className="mt-1 text-[10px] text-slate-500">
                                        Pode repetir o mesmo jogador caso aposte em múltiplos gols
                                        dele.
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Team B Scorers */}
                                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
                                    <Label className="text-xs font-bold text-slate-800">
                                      Marcadores de gols — {jogo.time_b}
                                    </Label>
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] ${
                                        isZeroB
                                          ? 'border-slate-300 text-slate-400 bg-slate-100'
                                          : 'border-emerald-300 text-emerald-800 bg-emerald-50'
                                      }`}
                                    >
                                      {isZeroB
                                        ? '0 gols (bloqueado)'
                                        : `${numGolsB} gol${numGolsB > 1 ? 's' : ''} previsto${numGolsB > 1 ? 's' : ''}`}
                                    </Badge>
                                  </div>

                                  {isZeroB ? (
                                    <p className="py-3 text-center text-xs italic text-slate-400">
                                      Placar zero (0): campo de marcadores bloqueado.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {Array.from({ length: numGolsB }).map((_, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                                            {idx + 1}º
                                          </span>
                                          <Input
                                            disabled={isLocked}
                                            placeholder={`Nome do autor do ${idx + 1}º gol (ex: Veiga)`}
                                            value={form.goleadores_b?.[idx] || ''}
                                            onChange={(e) =>
                                              handleScorerLineChange(
                                                jogo.id,
                                                'b',
                                                idx,
                                                e.target.value,
                                              )
                                            }
                                            className={`h-8 border-[#CBD5E1] bg-white text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981] ${
                                              isLocked
                                                ? 'bg-slate-100 cursor-not-allowed opacity-90'
                                                : ''
                                            }`}
                                          />
                                        </div>
                                      ))}
                                      <p className="mt-1 text-[10px] text-slate-500">
                                        Pode repetir o mesmo jogador caso aposte em múltiplos gols
                                        dele.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Penalties select (when game has tem_penaltis) */}
                          {jogo.tem_penaltis && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                              <Label className="text-xs font-bold text-amber-900">
                                Vencedor nos pênaltis (+2 pontos caso haja disputa):
                              </Label>
                              <select
                                disabled={isLocked}
                                value={form.vencedor_penaltis || 'N'}
                                onChange={(e) => handlePenaltisChange(jogo.id, e.target.value)}
                                className={`mt-1.5 h-8 w-full sm:w-64 rounded-md border border-amber-300 bg-white px-2 text-xs font-medium text-slate-800 ${
                                  isLocked ? 'bg-slate-100 cursor-not-allowed opacity-90' : ''
                                }`}
                              >
                                <option value="N">
                                  Não haverá pênaltis (vitória no tempo normal)
                                </option>
                                <option value="A">{jogo.time_a} passa nos pênaltis</option>
                                <option value="B">{jogo.time_b} passa nos pênaltis</option>
                              </select>
                            </div>
                          )}

                          {/* Action buttons footer */}
                          <div className="flex justify-end pt-2">
                            {isExpired ? (
                              <Button
                                type="button"
                                disabled
                                className="h-9 cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-5 text-xs font-bold text-slate-400 shadow-none"
                              >
                                <Lock className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                                Palpites Encerrados
                              </Button>
                            ) : isLocked ? (
                              <Button
                                type="button"
                                onClick={() =>
                                  setEditingGames((prev) => ({
                                    ...prev,
                                    [jogo.id]: true,
                                  }))
                                }
                                className="h-9 rounded-lg border border-[#0F2A43] bg-white px-5 text-xs font-bold text-[#0F2A43] shadow-xs hover:bg-slate-100"
                              >
                                <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                                Editar Palpite
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                onClick={() => handleSavePalpite(jogo)}
                                disabled={savingGameId === jogo.id}
                                className="h-9 rounded-lg bg-[#0F2A43] px-5 text-xs font-bold text-white shadow-xs hover:bg-[#1B3A5C]"
                              >
                                {savingGameId === jogo.id ? (
                                  <>
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    Salvando...
                                  </>
                                ) : (
                                  <>
                                    <Save className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                                    Salvar Palpite
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })()
                  )}{' '}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Paginação / Carregamento progressivo para evitar travamento da DOM */}
      {!loading && hasMore && (
        <div className="flex flex-col items-center justify-center gap-2 pt-4 pb-8">
          <p className="text-xs text-slate-500">
            Exibindo <strong>{displayedJogos.length}</strong> de{' '}
            <strong>{allFilteredJogos.length}</strong> partidas
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisibleCount((prev) => prev + 20)}
            className="h-10 px-6 font-bold text-xs border-[#0F2A43] text-[#0F2A43] hover:bg-slate-50 transition shadow-2xs"
          >
            Carregar mais 20 partidas ({allFilteredJogos.length - displayedJogos.length} restantes)
          </Button>
        </div>
      )}

      {/* Modal de Edição de Marcadores para o Admin */}
      <AdminEditMarcadoresModal
        open={Boolean(adminEditingPalpite)}
        onOpenChange={(open) => {
          if (!open) setAdminEditingPalpite(null)
        }}
        palpite={adminEditingPalpite?.palpite || null}
        nomeParticipante={adminEditingPalpite?.participanteNome}
        timeA={adminEditingPalpite?.timeA}
        timeB={adminEditingPalpite?.timeB}
        onSuccess={() => {
          loadData()
        }}
      />
    </div>
  )
}
