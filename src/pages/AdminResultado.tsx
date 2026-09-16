import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Shield,
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  Loader2,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit3,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Jogo, Palpite, Normalizacao, ScorerItem } from '@/types/bolao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatDataBR, formatHoraBR } from '@/lib/dateUtils'
import { AdminEditMarcadoresModal } from '@/components/AdminEditMarcadoresModal'
import { formatPalpiteMarcadoresSummary } from '@/lib/scorerUtils'

export default function AdminResultado() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [jogo, setJogo] = useState<Jogo | null>(null)
  const [palpites, setPalpites] = useState<Palpite[]>([])
  const [normalizacoes, setNormalizacoes] = useState<Normalizacao[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Scores
  const [placarA, setPlacarA] = useState<number | string>('')
  const [placarB, setPlacarB] = useState<number | string>('')

  // Goal scorers panels
  const [golsA, setGolsA] = useState<ScorerItem[]>([])
  const [golsB, setGolsB] = useState<ScorerItem[]>([])

  // Penalties & API ID
  const [temPenaltis, setTemPenaltis] = useState(false)
  const [vencedorPenaltis, setVencedorPenaltis] = useState<'A' | 'B' | ''>('')
  const [fixtureId, setFixtureId] = useState('')

  // Normalization mappings state
  const [showNormalizer, setShowNormalizer] = useState(false)
  const [mappingInputs, setMappingInputs] = useState<Record<string, string>>({})
  const [savingNorms, setSavingNorms] = useState(false)
  const [participantesMap, setParticipantesMap] = useState<Record<string, string>>({})
  const [editingPalpite, setEditingPalpite] = useState<{
    palpite: Palpite
    participanteNome: string
  } | null>(null)

  useEffect(() => {
    if (id) {
      loadGameData(id)
    }
  }, [id])

  const loadGameData = async (gameId: string) => {
    try {
      setLoading(true)
      const gameRecord = await pb.collection('jogos').getOne<Jogo>(gameId)
      setJogo(gameRecord)

      setPlacarA(
        gameRecord.placar_a !== null && gameRecord.placar_a !== undefined
          ? gameRecord.placar_a
          : '',
      )
      setPlacarB(
        gameRecord.placar_b !== null && gameRecord.placar_b !== undefined
          ? gameRecord.placar_b
          : '',
      )
      setTemPenaltis(!!gameRecord.tem_penaltis)
      setVencedorPenaltis((gameRecord.vencedor_penaltis as 'A' | 'B') || '')
      setFixtureId(gameRecord.fixture_id || '')

      // Real scorers
      setGolsA(Array.isArray(gameRecord.gols_time_a) ? gameRecord.gols_time_a : [])
      setGolsB(Array.isArray(gameRecord.gols_time_b) ? gameRecord.gols_time_b : [])

      // Load all palpites for this game to detect predicted names needing normalization
      const [allPalpites, allNorms] = await Promise.all([
        pb.collection('palpites').getFullList<Palpite>({
          filter: `jogo = '${gameId}'`,
        }),
        pb.collection('normalizacoes').getFullList<Normalizacao>({
          filter: `bolao = '${gameRecord.bolao}'`,
        }),
      ])

      setPalpites(allPalpites)
      setNormalizacoes(allNorms)

      // Carregar nomes dos participantes deste bolão
      try {
        const parts = await pb.collection('participantes').getFullList({
          filter: `bolao = '${gameRecord.bolao}'`,
        })
        const partMap: Record<string, string> = {}
        for (const p of parts) {
          partMap[p.id] = p.nome
        }
        setParticipantesMap(partMap)
      } catch {
        /* ignore */
      }

      // Initialize mapping inputs with existing normalizations
      const initialMap: Record<string, string> = {}
      for (const n of allNorms) {
        initialMap[n.nome_original] = n.nome_correto
      }
      setMappingInputs(initialMap)
    } catch (err: unknown) {
      console.error('Erro ao carregar partida:', err)
      setError('Não foi possível carregar os dados desta partida.')
    } finally {
      setLoading(false)
    }
  }

  // Add scorer row to team A
  const addScorerA = () => {
    setGolsA([...golsA, { nome: '', posicao: 'Atacante/Meia', quantidade: 1 }])
  }

  const removeScorerA = (index: number) => {
    setGolsA(golsA.filter((_, i) => i !== index))
  }

  const updateScorerA = (index: number, field: keyof ScorerItem, value: any) => {
    const updated = [...golsA]
    updated[index] = { ...updated[index], [field]: value }
    setGolsA(updated)
  }

  // Add scorer row to team B
  const addScorerB = () => {
    setGolsB([...golsB, { nome: '', posicao: 'Atacante/Meia', quantidade: 1 }])
  }

  const removeScorerB = (index: number) => {
    setGolsB(golsB.filter((_, i) => i !== index))
  }

  const updateScorerB = (index: number, field: keyof ScorerItem, value: any) => {
    const updated = [...golsB]
    updated[index] = { ...updated[index], [field]: value }
    setGolsB(updated)
  }

  // Normalizer: identify predicted names not matching real scorers exactly
  const allPredictedNames = Array.from(
    new Set(
      palpites.flatMap((p) => [
        ...(Array.isArray(p.goleadores_a) ? p.goleadores_a : []),
        ...(Array.isArray(p.goleadores_b) ? p.goleadores_b : []),
      ]),
    ),
  ).filter(Boolean)

  const realScorerNames = [...golsA, ...golsB]
    .map((g) => g.nome.trim().toLowerCase())
    .filter(Boolean)

  // Candidate names for normalization (names predicted by participants)
  const candidateNames = allPredictedNames.filter((name) => {
    // If it's already an exact match with a real scorer, it doesn't strictly need normalization, but Douglas can edit if desired
    return true
  })

  const handleSaveNormalizations = async () => {
    if (!jogo) return
    setSavingNorms(true)
    try {
      for (const [orig, corr] of Object.entries(mappingInputs)) {
        if (!orig || !corr) continue
        const existing = normalizacoes.find(
          (n) => n.nome_original.toLowerCase() === orig.toLowerCase(),
        )
        if (existing) {
          if (existing.nome_correto !== corr) {
            await pb.collection('normalizacoes').update(existing.id, {
              nome_correto: corr.trim(),
            })
          }
        } else {
          await pb.collection('normalizacoes').create({
            bolao: jogo.bolao,
            nome_original: orig.trim(),
            nome_correto: corr.trim(),
          })
        }
      }

      // Reload normalizations
      const refreshedNorms = await pb.collection('normalizacoes').getFullList<Normalizacao>({
        filter: `bolao = '${jogo.bolao}'`,
      })
      setNormalizacoes(refreshedNorms)

      toast({
        title: 'Padronizações salvas!',
        description: 'Mapeamentos de nomes atualizados com sucesso.',
      })
    } catch (err) {
      toast({
        title: 'Erro ao salvar padronizações',
        variant: 'destructive',
      })
    } finally {
      setSavingNorms(false)
    }
  }

  // Save game result and trigger scoring calculation
  const handleSaveAndCalculate = async () => {
    if (!jogo) return
    setError(null)

    if (placarA === '' || placarB === '') {
      setError('Por favor, informe o placar dos dois times.')
      return
    }

    if (temPenaltis && !vencedorPenaltis) {
      setError('Informe o vencedor na disputa por pênaltis.')
      return
    }

    setSaving(true)
    try {
      // 1. Update game in PocketBase
      const gamePayload: Record<string, unknown> = {
        placar_a: Number(placarA),
        placar_b: Number(placarB),
        resultado_finalizado: true,
        gols_time_a: golsA.filter((g) => g.nome.trim()),
        gols_time_b: golsB.filter((g) => g.nome.trim()),
        tem_penaltis: temPenaltis,
        vencedor_penaltis: temPenaltis ? vencedorPenaltis : '',
        fixture_id: fixtureId.trim() || '',
      }
      await pb.collection('jogos').update<Jogo>(jogo.id, gamePayload)

      // 2. Trigger automatic scoring calculation via custom backend hook
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        reqHeaders['Authorization'] = pb.authStore.token
      }
      const calcPayload = { jogo_id: jogo.id }

      const calcResponse = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/calcular-pontuacao`,
        {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(calcPayload),
        },
      )

      if (!calcResponse.ok) {
        const errPayload = await calcResponse.json().catch(() => ({}))
        throw new Error(errPayload.error || 'Falha ao acionar motor de cálculo')
      }

      toast({
        title: 'Resultado salvo e pontuação calculada!',
        description: 'O ranking e os palpites foram atualizados com sucesso.',
      })

      // Navigate back to admin games list
      navigate('/bolao/admin/jogos')
    } catch (err: unknown) {
      console.error('Erro ao salvar resultado:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao salvar e calcular'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  // Position badge styling helper
  const getPositionTagStyle = (pos: string) => {
    if (pos.includes('Zagueiro') || pos.includes('Lateral')) {
      return 'bg-purple-100 text-purple-800 border-purple-200'
    }
    if (pos.includes('Goleiro')) {
      return 'bg-red-100 text-red-800 border-red-200'
    }
    if (pos.includes('Contra')) {
      return 'bg-slate-200 text-slate-800 border-slate-300'
    }
    return 'bg-blue-100 text-blue-800 border-blue-200'
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#0F2A43]" />
      </div>
    )
  }

  if (!jogo) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        Partida não encontrada.{' '}
        <Button variant="link" onClick={() => navigate('/bolao/admin/jogos')}>
          Voltar para gestão de jogos
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/bolao/admin/jogos')}
            className="text-slate-600 hover:bg-slate-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-amber-100 p-1.5 text-amber-700">
                <Shield className="h-5 w-5" />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[#0F172A] sm:text-2xl">
                  {jogo.time_a} x {jogo.time_b}
                </h1>
                {jogo.competicao && (
                  <Badge
                    variant="secondary"
                    className="border border-indigo-200 bg-indigo-50 font-semibold text-indigo-800 text-xs px-2 py-0.5"
                  >
                    {jogo.competicao}
                  </Badge>
                )}
                {jogo.fixture_id && (
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 font-mono font-semibold text-emerald-800 text-xs px-2 py-0.5"
                  >
                    ID API: {jogo.fixture_id}
                  </Badge>
                )}
              </div>
            </div>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Data: {formatDataBR(jogo.data)} às {formatHoraBR(jogo.hora)}
            </p>
          </div>
        </div>

        <Button
          onClick={handleSaveAndCalculate}
          disabled={saving}
          className="h-11 rounded-lg bg-[#0F2A43] px-6 text-xs font-bold text-white shadow-xs hover:bg-[#1B3A5C]"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Calculando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4 text-emerald-400" />
              Salvar Resultado e Calcular
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Score Section */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <CardTitle className="text-base font-bold text-[#0F172A]">
          Placar Final da Partida
        </CardTitle>
        <p className="mt-0.5 text-xs text-[#64748B]">
          Informe a quantidade de gols no tempo normal (ou prorrogação) de cada time.
        </p>

        <div className="mt-4 mb-4 max-w-sm">
          <Label htmlFor="edit-fixture-id" className="text-xs font-semibold text-[#0F172A]">
            ID da Partida (API-Football)
          </Label>
          <Input
            id="edit-fixture-id"
            placeholder="Ex: 1208456 (consulta direta)"
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            className="mt-1 h-9 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Associa este jogo diretamente à fixture da API-Football.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 sm:gap-8">
          <div className="w-36 text-center">
            <Label className="text-xs font-bold text-slate-700">{jogo.time_a}</Label>
            <Input
              type="number"
              min="0"
              value={placarA}
              onChange={(e) => setPlacarA(e.target.value)}
              placeholder="0"
              className="mt-2 h-16 text-center text-3xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
            />
          </div>

          <div className="pt-6 text-2xl font-black text-slate-400">X</div>

          <div className="w-36 text-center">
            <Label className="text-xs font-bold text-slate-700">{jogo.time_b}</Label>
            <Input
              type="number"
              min="0"
              value={placarB}
              onChange={(e) => setPlacarB(e.target.value)}
              placeholder="0"
              className="mt-2 h-16 text-center text-3xl font-black text-[#0F2A43] focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
            />
          </div>
        </div>
      </Card>

      {/* Goal Scorers Section: Two panels (one per team) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Panel Team A */}
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <CardTitle className="text-sm font-bold text-[#0F172A]">
                Autores dos Gols — {jogo.time_a}
              </CardTitle>
              <p className="text-[11px] text-[#64748B]">Gols reais marcados pelo time A</p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addScorerA}
              className="h-8 bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar Gol
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {golsA.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Nenhum gol registrado para {jogo.time_a}.
              </p>
            ) : (
              golsA.map((scorer, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex-1">
                    <Input
                      placeholder="Nome do jogador"
                      value={scorer.nome}
                      onChange={(e) => updateScorerA(index, 'nome', e.target.value)}
                      className="h-8 border-slate-300 bg-white text-xs"
                    />
                  </div>

                  <div className="w-full sm:w-36">
                    <select
                      value={scorer.posicao}
                      onChange={(e) => updateScorerA(index, 'posicao', e.target.value)}
                      className={`h-8 w-full rounded-md border text-[11px] font-semibold px-2 ${getPositionTagStyle(
                        scorer.posicao,
                      )}`}
                    >
                      <option value="Atacante/Meia">Atacante/Meia (+1 pt)</option>
                      <option value="Zagueiro/Lateral">Zagueiro/Lateral (+3 pts)</option>
                      <option value="Goleiro">Goleiro (+10 pts)</option>
                      <option value="Gol Contra">Gol Contra (+5 pts)</option>
                    </select>
                  </div>

                  <div className="w-16">
                    <Input
                      type="number"
                      min="1"
                      title="Quantidade de gols"
                      value={scorer.quantidade}
                      onChange={(e) => updateScorerA(index, 'quantidade', Number(e.target.value))}
                      className="h-8 border-slate-300 bg-white text-center text-xs"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeScorerA(index)}
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Panel Team B */}
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <CardTitle className="text-sm font-bold text-[#0F172A]">
                Autores dos Gols — {jogo.time_b}
              </CardTitle>
              <p className="text-[11px] text-[#64748B]">Gols reais marcados pelo time B</p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addScorerB}
              className="h-8 bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar Gol
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {golsB.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Nenhum gol registrado para {jogo.time_b}.
              </p>
            ) : (
              golsB.map((scorer, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex-1">
                    <Input
                      placeholder="Nome do jogador"
                      value={scorer.nome}
                      onChange={(e) => updateScorerB(index, 'nome', e.target.value)}
                      className="h-8 border-slate-300 bg-white text-xs"
                    />
                  </div>

                  <div className="w-full sm:w-36">
                    <select
                      value={scorer.posicao}
                      onChange={(e) => updateScorerB(index, 'posicao', e.target.value)}
                      className={`h-8 w-full rounded-md border text-[11px] font-semibold px-2 ${getPositionTagStyle(
                        scorer.posicao,
                      )}`}
                    >
                      <option value="Atacante/Meia">Atacante/Meia (+1 pt)</option>
                      <option value="Zagueiro/Lateral">Zagueiro/Lateral (+3 pts)</option>
                      <option value="Goleiro">Goleiro (+10 pts)</option>
                      <option value="Gol Contra">Gol Contra (+5 pts)</option>
                    </select>
                  </div>

                  <div className="w-16">
                    <Input
                      type="number"
                      min="1"
                      title="Quantidade de gols"
                      value={scorer.quantidade}
                      onChange={(e) => updateScorerB(index, 'quantidade', Number(e.target.value))}
                      className="h-8 border-slate-300 bg-white text-center text-xs"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeScorerB(index)}
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Penalties Section */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <input
            id="chk-penaltis"
            type="checkbox"
            checked={temPenaltis}
            onChange={(e) => setTemPenaltis(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <Label htmlFor="chk-penaltis" className="cursor-pointer text-xs font-bold text-[#0F172A]">
            Houve disputa por pênaltis?
          </Label>
        </div>

        {temPenaltis && (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 border border-amber-200">
            <p className="text-xs font-semibold text-amber-900 mb-2">
              Selecione o vencedor da disputa de pênaltis (+2 pontos para quem acertou):
            </p>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="vencedor_penaltis"
                  value="A"
                  checked={vencedorPenaltis === 'A'}
                  onChange={() => setVencedorPenaltis('A')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                {jogo.time_a}
              </label>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="vencedor_penaltis"
                  value="B"
                  checked={vencedorPenaltis === 'B'}
                  onChange={() => setVencedorPenaltis('B')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                {jogo.time_b}
              </label>
            </div>
          </div>
        )}
      </Card>

      {/* Name Normalizer (Normalizador de Nomes) */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <button
          type="button"
          onClick={() => setShowNormalizer(!showNormalizer)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <CardTitle className="text-sm font-bold text-[#0F172A]">
              Padronizar nomes de jogadores (Normalizador)
            </CardTitle>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Permite associar apelidos digitados pelos participantes (ex: &ldquo;Deyvinho&rdquo;)
              ao nome correto do jogador real (&ldquo;Deyverson&rdquo;).
            </p>
          </div>
          {showNormalizer ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </button>

        {showNormalizer && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {candidateNames.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhum nome de jogador digitado nos palpites desta partida.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {candidateNames.map((origName) => (
                    <div
                      key={origName}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs"
                    >
                      <span
                        className="w-1/2 font-semibold text-slate-700 truncate"
                        title={origName}
                      >
                        {origName}
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <Input
                        placeholder="Nome correto"
                        value={mappingInputs[origName] ?? ''}
                        onChange={(e) =>
                          setMappingInputs({ ...mappingInputs, [origName]: e.target.value })
                        }
                        className="h-8 border-slate-300 bg-white text-xs"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingNorms}
                    onClick={handleSaveNormalizations}
                    className="h-8 rounded-md bg-slate-800 text-xs font-semibold text-white hover:bg-slate-900"
                  >
                    {savingNorms ? 'Salvando...' : 'Salvar Padronizações'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Painel de Palpites Registrados com Edição Direta de Marcadores pelo Admin */}
      <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <CardTitle className="text-base font-bold text-[#0F172A]">
              Palpites Registrados e Marcadores dos Participantes ({palpites.length})
            </CardTitle>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Edite diretamente o texto dos marcadores de qualquer palpite para padronizar a grafia.
            </p>
          </div>
          <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
            {palpites.length} participante(s)
          </Badge>
        </div>

        <div className="mt-4">
          {palpites.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400 italic">
              Nenhum palpite registrado para este confronto.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {palpites.map((bet) => {
                const partNome = participantesMap[bet.participante] || 'Participante'
                return (
                  <div
                    key={bet.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/60">
                        <span className="font-bold text-slate-800 truncate">{partNome}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditingPalpite({
                              palpite: bet,
                              participanteNome: partNome,
                            })
                          }
                          className="h-6 px-2 text-[10px] font-semibold border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          title="Editar marcadores deste palpite"
                        >
                          <Edit3 className="mr-1 h-2.5 w-2.5" />
                          Editar
                        </Button>
                      </div>
                      <div className="mt-2 text-xs font-semibold text-slate-800">
                        Palpite:{' '}
                        <strong className="text-sm font-black text-[#0F2A43]">
                          {bet.placar_a} x {bet.placar_b}
                        </strong>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600 font-medium leading-snug">
                        {formatPalpiteMarcadoresSummary(bet)}
                      </div>
                    </div>

                    {jogo.resultado_finalizado && (
                      <div className="mt-2 pt-2 border-t border-slate-200/60 text-[11px] font-bold text-emerald-700">
                        Pontuação: +{bet.pontuacao_jogo} pts
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Modal de Edição de Marcadores pelo Admin */}
      <AdminEditMarcadoresModal
        open={Boolean(editingPalpite)}
        onOpenChange={(open) => {
          if (!open) setEditingPalpite(null)
        }}
        palpite={editingPalpite?.palpite || null}
        nomeParticipante={editingPalpite?.participanteNome}
        timeA={jogo.time_a}
        timeB={jogo.time_b}
        onSuccess={() => {
          loadGameData(jogo.id)
        }}
      />

      {/* Save button footer */}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={() => navigate('/bolao/admin/jogos')}
          className="text-xs"
        >
          Cancelar
        </Button>

        <Button
          onClick={handleSaveAndCalculate}
          disabled={saving}
          className="h-11 rounded-lg bg-[#0F2A43] px-8 text-xs font-bold text-white shadow-xs hover:bg-[#1B3A5C]"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Calculando pontuações...
            </>
          ) : (
            'Salvar Resultado e Calcular'
          )}
        </Button>
      </div>
    </div>
  )
}
