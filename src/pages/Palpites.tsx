import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Jogo, Palpite, Participante } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatDataBR, formatHoraBR } from '@/lib/dateUtils'

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
  const { user, participantName } = useAuth()
  const { activeBolao, activeBolaoId, currentParticipante } = useActivePool()
  const { toast } = useToast()

  const [jogos, setJogos] = useState<Jogo[]>([])
  const [palpites, setPalpites] = useState<Record<string, Palpite>>({})
  const [formData, setFormData] = useState<Record<string, PalpiteFormData>>({})
  const [savingGameId, setSavingGameId] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useRealtime<Jogo>('jogos', () => {
    loadData()
  })

  useRealtime<Palpite>('palpites', () => {
    loadData()
  })

  const loadData = async () => {
    if (!activeBolaoId) return

    // If currentParticipante is not yet populated from context, try resolving it directly from PB
    let participanteId = currentParticipante?.id
    if (!participanteId && user) {
      const searchName =
        participantName ||
        (user.name as string) ||
        (user.email ? (user.email as string).split('@')[0] : '')
      if (searchName) {
        try {
          const parts = await pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${activeBolaoId}'`,
          })
          const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          const resolved = exact || partial || parts[0]
          if (resolved) participanteId = resolved.id
        } catch {
          /* intentionally ignored */
        }
      }
    }

    try {
      const [gamesList, myPalpites] = await Promise.all([
        pb.collection('jogos').getFullList<Jogo>({
          filter: `bolao = '${activeBolaoId}'`,
          sort: 'data,hora',
        }),
        participanteId
          ? pb.collection('palpites').getFullList<Palpite>({
              filter: `bolao = '${activeBolaoId}' && participante = '${participanteId}'`,
            })
          : Promise.resolve([] as Palpite[]),
      ])

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
    } catch (err) {
      console.error('Erro ao carregar palpites:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeBolaoId && currentParticipante) {
      setLoading(true)
      loadData()
    } else {
      setLoading(false)
    }
  }, [activeBolaoId, currentParticipante])

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
    if (!activeBolaoId) return

    // Resolve participante if missing
    let participanteToUse = currentParticipante
    if (!participanteToUse && user) {
      const searchName =
        participantName ||
        (user.name as string) ||
        (user.email ? (user.email as string).split('@')[0] : '')
      if (searchName) {
        try {
          const parts = await pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${activeBolaoId}'`,
          })
          const exact = parts.find((p) => p.nome.toLowerCase() === searchName.toLowerCase())
          const partial = parts.find(
            (p) =>
              p.nome.toLowerCase().includes(searchName.toLowerCase()) ||
              searchName.toLowerCase().includes(p.nome.toLowerCase()),
          )
          participanteToUse = exact || partial || null
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

      // Only save scorers if goals > 0; trim empty values
      // Note: Supports repeated player names (e.g. ["Pedro Raul", "Pedro Raul"] or ["Pedro Raul", "Gui Negão"])
      const gA =
        numA > 0 ? (currentForm.goleadores_a || []).map((s) => s.trim()).filter(Boolean) : []
      const gB =
        numB > 0 ? (currentForm.goleadores_b || []).map((s) => s.trim()).filter(Boolean) : []

      // Step 1: UPSERT Check - Always verify if a record already exists for this bolão + game + participant
      let existingRecordId: string | null = palpites[jogo.id]?.id || null

      if (!existingRecordId) {
        try {
          const remoteRecords = await pb.collection('palpites').getList<Palpite>(1, 1, {
            filter: `bolao = '${activeBolaoId}' && jogo = '${jogo.id}' && participante = '${participanteToUse.id}'`,
          })
          if (remoteRecords.items.length > 0) {
            existingRecordId = remoteRecords.items[0].id
          }
        } catch (_) {
          // not found or error querying, proceed to creation check
        }
      }

      const payload = {
        bolao: activeBolaoId,
        jogo: jogo.id,
        participante: participanteToUse.id,
        placar_a: numA,
        placar_b: numB,
        goleadores_a: gA, // JSON array of player names (supports repeats e.g. ["Pedro Raul", "Pedro Raul"])
        goleadores_b: gB,
        vencedor_penaltis: currentForm.vencedor_penaltis || 'N',
      }

      if (existingRecordId) {
        // Step 1a: Update existing record
        try {
          await pb.collection('palpites').update(existingRecordId, {
            placar_a: numA,
            placar_b: numB,
            goleadores_a: gA,
            goleadores_b: gB,
            vencedor_penaltis: currentForm.vencedor_penaltis || 'N',
          })
        } catch (updateErr: any) {
          // If record was deleted remotely in between or ID mismatch, fallback to create
          if (updateErr?.status === 404) {
            await pb.collection('palpites').create({
              ...payload,
              pontuacao_jogo: 0,
              detalhamento: [],
            })
          } else {
            throw updateErr
          }
        }
      } else {
        // Step 1b: Create new record
        try {
          await pb.collection('palpites').create({
            ...payload,
            pontuacao_jogo: 0,
            detalhamento: [],
          })
        } catch (createErr: any) {
          // If a duplicate constraint occurred because someone/another tab inserted it, try update
          const duplicateCheck = await pb
            .collection('palpites')
            .getFirstListItem<Palpite>(
              `bolao = '${activeBolaoId}' && jogo = '${jogo.id}' && participante = '${participanteToUse.id}'`,
            )
            .catch(() => null)

          if (duplicateCheck) {
            await pb.collection('palpites').update(duplicateCheck.id, {
              placar_a: numA,
              placar_b: numB,
              goleadores_a: gA,
              goleadores_b: gB,
              vencedor_penaltis: currentForm.vencedor_penaltis || 'N',
            })
          } else {
            throw createErr
          }
        }
      }

      toast({
        title: 'Palpite salvo com sucesso!',
        description: `Palpite para ${jogo.time_a} x ${jogo.time_b} registrado.`,
      })
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-2 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
            Meus Palpites — {participantName || 'Participante'}
          </h1>
          <p className="text-xs text-[#64748B]">
            Competição:{' '}
            <span className="font-semibold text-[#0F2A43]">
              {activeBolao?.nome || 'Bolão do Grupo'}
            </span>
          </p>
        </div>

        <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
          Total de jogos: {jogos.length}
        </Badge>
      </div>

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2A43]" />
        </div>
      ) : jogos.length === 0 ? (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-12 text-center text-xs text-slate-500">
          Nenhuma partida disponível neste bolão. Os jogos serão cadastrados pelo administrador
          Douglas.
        </Card>
      ) : (
        <div className="space-y-4">
          {jogos.map((jogo) => {
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
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>{formatDataBR(jogo.data)}</span>
                    <span>•</span>
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>{formatHoraBR(jogo.hora)}</span>
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
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-amber-800 text-[11px]"
                    >
                      Aberto para palpites
                    </Badge>
                  )}
                </div>

                <div className="p-6">
                  {/* Teams vs block */}
                  <div className="flex items-center justify-center gap-6 py-2">
                    <span className="text-base font-bold text-[#0F172A] sm:text-lg">
                      {jogo.time_a}
                    </span>
                    <span className="text-xs font-bold uppercase text-slate-400">VS</span>
                    <span className="text-base font-bold text-[#0F172A] sm:text-lg">
                      {jogo.time_b}
                    </span>
                  </div>

                  {/* Form or Read-only view */}
                  {finalizado ? (
                    /* Finalized game: show participant's bet and points detail toggle */
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
                    <div className="mt-4 space-y-4">
                      {/* Score inputs */}
                      <div className="flex items-center justify-center gap-4">
                        <div className="w-24 text-center">
                          <Label className="text-[11px] font-bold text-slate-600">
                            Gols {jogo.time_a}
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={form.placar_a ?? ''}
                            onChange={(e) => handleScoreChange(jogo.id, 'a', e.target.value)}
                            className="mt-1 h-12 text-center text-xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
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
                            placeholder="0"
                            value={form.placar_b ?? ''}
                            onChange={(e) => handleScoreChange(jogo.id, 'b', e.target.value)}
                            className="mt-1 h-12 text-center text-xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
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
                                        placeholder={`Nome do autor do ${idx + 1}º gol (ex: Pedro Raul)`}
                                        value={form.goleadores_a?.[idx] || ''}
                                        onChange={(e) =>
                                          handleScorerLineChange(jogo.id, 'a', idx, e.target.value)
                                        }
                                        className="h-8 border-[#CBD5E1] bg-white text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                                      />
                                    </div>
                                  ))}
                                  <p className="mt-1 text-[10px] text-slate-500">
                                    Pode repetir o mesmo jogador caso aposte em múltiplos gols dele.
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
                                        placeholder={`Nome do autor do ${idx + 1}º gol (ex: Veiga)`}
                                        value={form.goleadores_b?.[idx] || ''}
                                        onChange={(e) =>
                                          handleScorerLineChange(jogo.id, 'b', idx, e.target.value)
                                        }
                                        className="h-8 border-[#CBD5E1] bg-white text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                                      />
                                    </div>
                                  ))}
                                  <p className="mt-1 text-[10px] text-slate-500">
                                    Pode repetir o mesmo jogador caso aposte em múltiplos gols dele.
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
                            value={form.vencedor_penaltis || 'N'}
                            onChange={(e) => handlePenaltisChange(jogo.id, e.target.value)}
                            className="mt-1.5 h-8 w-full sm:w-64 rounded-md border border-amber-300 bg-white px-2 text-xs font-medium text-slate-800"
                          >
                            <option value="N">Não haverá pênaltis (vitória no tempo normal)</option>
                            <option value="A">{jogo.time_a} passa nos pênaltis</option>
                            <option value="B">{jogo.time_b} passa nos pênaltis</option>
                          </select>
                        </div>
                      )}

                      {/* Save Palpite button */}
                      <div className="flex justify-end pt-2">
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
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
