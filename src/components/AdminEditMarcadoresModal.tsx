import { useState, useEffect } from 'react'
import { Loader2, Save, User, ShieldCheck } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Palpite } from '@/types/bolao'
import { extractScorerNames } from '@/lib/scorerUtils'
import { invalidateStatsCache } from '@/services/stats'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

interface AdminEditMarcadoresModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  palpite: Palpite | null
  nomeParticipante?: string
  timeA?: string
  timeB?: string
  onSuccess?: (updatedPalpite: Palpite) => void
}

type PersistedPosicao = 'Atacante' | 'Defensor' | 'Goleiro'

interface ScorerInputState {
  nome: string
  posicao: PersistedPosicao
  gol_contra: boolean
}

const POSICOES_DISPONIVEIS: Array<{
  value: PersistedPosicao
  label: string
}> = [
  { value: 'Atacante', label: 'Atacante / Meio-campista (+1 pt)' },
  { value: 'Defensor', label: 'Defensor / Lateral (+3 pts)' },
  { value: 'Goleiro', label: 'Goleiro (+10 pts)' },
]

function inferPosicaoFromNameOrItem(raw: any): PersistedPosicao {
  if (raw && typeof raw === 'object' && raw.posicao) {
    const p = String(raw.posicao).toLowerCase()
    if (p.includes('goleiro')) return 'Goleiro'
    if (p.includes('defensor') || p.includes('zagueiro') || p.includes('lateral')) return 'Defensor'
    // 'Meio-campista', 'Meia', 'Atacante' ou outros caem em 'Atacante'
    return 'Atacante'
  }
  const str = String(typeof raw === 'string' ? raw : raw?.nome || '').toLowerCase()
  if (str.includes('goleiro')) return 'Goleiro'
  if (str.includes('zagueiro') || str.includes('lateral') || str.includes('defensor'))
    return 'Defensor'
  return 'Atacante'
}

function parseRawScorerList(raw: any, count: number): ScorerInputState[] {
  const extracted = extractScorerNames(raw)
  const slots = Math.max(count, extracted.length)
  const result: ScorerInputState[] = []

  let rawArray: any[] = []
  if (Array.isArray(raw)) {
    rawArray = raw
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) rawArray = parsed
    } catch {
      rawArray = []
    }
  }

  for (let i = 0; i < slots; i++) {
    const itemRaw = rawArray[i]
    const fallbackName = extracted[i] || ''
    const rawString =
      typeof itemRaw === 'string'
        ? itemRaw
        : typeof itemRaw?.nome === 'string'
          ? itemRaw.nome
          : fallbackName

    // Detectar marcador com "(gol contra)"/"(contra)" no nome, flag gol_contra === true ou posicao === 'Gol Contra'
    const isGolContra =
      Boolean(itemRaw && typeof itemRaw === 'object' && itemRaw.gol_contra === true) ||
      Boolean(
        itemRaw &&
        typeof itemRaw === 'object' &&
        String(itemRaw.posicao || '')
          .toLowerCase()
          .includes('contra'),
      ) ||
      /\(gol contra\)|\(contra\)/i.test(rawString) ||
      /\(gol contra\)|\(contra\)/i.test(fallbackName)

    const cleanName = (fallbackName || rawString).replace(/\(gol contra\)|\(contra\)/gi, '').trim()

    result.push({
      nome: cleanName,
      posicao: inferPosicaoFromNameOrItem(itemRaw || fallbackName),
      gol_contra: isGolContra,
    })
  }

  return result
}

export function AdminEditMarcadoresModal({
  open,
  onOpenChange,
  palpite,
  nomeParticipante,
  timeA = 'Time A',
  timeB = 'Time B',
  onSuccess,
}: AdminEditMarcadoresModalProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [scorersA, setScorersA] = useState<ScorerInputState[]>([])
  const [scorersB, setScorersB] = useState<ScorerInputState[]>([])

  const placarA = Math.max(0, Number(palpite?.placar_a) || 0)
  const placarB = Math.max(0, Number(palpite?.placar_b) || 0)

  // Preenche os marcadores ao abrir o modal
  useEffect(() => {
    if (palpite && open) {
      setScorersA(parseRawScorerList(palpite.goleadores_a, placarA))
      setScorersB(parseRawScorerList(palpite.goleadores_b, placarB))
    }
  }, [palpite, open, placarA, placarB])

  const handleUpdateScorerA = (idx: number, patch: Partial<ScorerInputState>) => {
    setScorersA((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  const handleUpdateScorerB = (idx: number, patch: Partial<ScorerInputState>) => {
    setScorersB((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  const handleSave = async () => {
    if (!palpite) return
    setSaving(true)

    try {
      // Formata os nomes: se marcada como gol contra, adiciona sufixo " (gol contra)", senão salva o nome limpo
      const formatScorerValue = (s: ScorerInputState) => {
        const clean = s.nome.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
        return s.gol_contra ? `${clean} (gol contra)` : clean
      }

      // Limpa espaços e remove itens totalmente vazios além do limite de gols
      const cleanA = scorersA
        .filter((s) => s.nome.replace(/\(gol contra\)|\(contra\)/gi, '').trim().length > 0)
        .map(formatScorerValue)
      const cleanB = scorersB
        .filter((s) => s.nome.replace(/\(gol contra\)|\(contra\)/gi, '').trim().length > 0)
        .map(formatScorerValue)

      // Atualiza o palpite no banco PocketBase
      const updatedRecord = await pb.collection('palpites').update<Palpite>(palpite.id, {
        goleadores_a: cleanA,
        goleadores_b: cleanB,
      })

      // Atualiza também no jogo as posições dos marcadores cadastrados em jogos.gols_time_a / gols_time_b
      try {
        const game = await pb.collection('jogos').getOne(palpite.jogo)
        const existingGolsA: any[] = Array.isArray((game as any).gols_time_a)
          ? (game as any).gols_time_a
          : []
        const existingGolsB: any[] = Array.isArray((game as any).gols_time_b)
          ? (game as any).gols_time_b
          : []

        // Mapeia novas posições informadas pelo Admin
        const newGolsA = existingGolsA.map((g: any) => {
          const matchA = scorersA.find((s) => {
            const sClean = s.nome
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
              .toLowerCase()
            const gClean = String(g.nome || '')
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
              .toLowerCase()
            return sClean === gClean
          })
          if (!matchA) return g
          return {
            nome: g.nome,
            posicao: matchA.gol_contra ? 'Gol Contra' : matchA.posicao,
            quantidade: g.quantidade || 1,
            gol_contra: matchA.gol_contra,
          }
        })

        const newGolsB = existingGolsB.map((g: any) => {
          const matchB = scorersB.find((s) => {
            const sClean = s.nome
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
              .toLowerCase()
            const gClean = String(g.nome || '')
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
              .toLowerCase()
            return sClean === gClean
          })
          if (!matchB) return g
          return {
            nome: g.nome,
            posicao: matchB.gol_contra ? 'Gol Contra' : matchB.posicao,
            quantidade: g.quantidade || 1,
            gol_contra: matchB.gol_contra,
          }
        })

        await pb.collection('jogos').update(game.id, {
          gols_time_a: newGolsA,
          gols_time_b: newGolsB,
        })

        // Se o jogo já estiver finalizado, aciona recálculo imediato de pontuação para manter tudo consistente
        if (game.resultado_finalizado) {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (pb.authStore.token) {
            headers['Authorization'] = pb.authStore.token
          }
          await fetch(`${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/calcular-pontuacao`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jogo_id: palpite.jogo }),
          })
        }
      } catch (errCalc) {
        console.warn('Aviso: atualização de jogo e recálculo após edição de marcadores:', errCalc)
      }

      // Invalida cache de estatísticas para cards e tabela refletirem imediatamente
      try {
        invalidateStatsCache()
      } catch (e) {
        console.warn('Erro ao invalidar cache de estatísticas:', e)
      }

      toast({
        title: 'Marcadores atualizados!',
        description: `Marcadores e posições do palpite de ${nomeParticipante || 'Participante'} salvos com sucesso.`,
      })

      if (onSuccess) {
        onSuccess(updatedRecord)
      }

      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Erro ao atualizar marcadores do palpite:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao salvar as alterações'
      toast({
        title: 'Erro ao salvar marcadores',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!palpite) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-amber-100 p-1.5 text-amber-800">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <DialogTitle className="text-base font-bold text-[#0F172A]">
              Padronizar Marcadores do Palpite (Admin)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#64748B]">
            Corrija ou padronize a grafia dos jogadores indicados pelo participante (ex.: alterar
            &ldquo;Ade&rdquo; para &ldquo;Ricardo Adé&rdquo; ou &ldquo;Flaco&rdquo; para
            &ldquo;Flaco López&rdquo;).
          </DialogDescription>
        </DialogHeader>

        {/* Resumo do palpite */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
            <div className="flex items-center gap-1.5 font-bold text-[#0F172A]">
              <User className="h-3.5 w-3.5 text-slate-500" />
              <span>{nomeParticipante || 'Participante'}</span>
            </div>
            <Badge
              variant="outline"
              className="border-slate-300 text-[10px] font-bold text-slate-700"
            >
              Palpite: {placarA} x {placarB}
            </Badge>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Confronto: <strong className="text-slate-800">{timeA}</strong> x{' '}
            <strong className="text-slate-800">{timeB}</strong>
          </p>
        </div>

        {/* Marcadores Time A */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-slate-800">
              Marcadores — {timeA} ({placarA} gol{placarA === 1 ? '' : 's'})
            </Label>
            {placarA === 0 && (
              <span className="text-[10px] text-slate-400 italic">0 gols previstos</span>
            )}
          </div>
          {scorersA.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-1">
              Nenhum marcador a preencher (0 gols).
            </p>
          ) : (
            <div className="space-y-2">
              {scorersA.map((item, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                      {idx + 1}º
                    </span>
                    <Input
                      value={item.nome}
                      onChange={(e) => handleUpdateScorerA(idx, { nome: e.target.value })}
                      placeholder={`Nome do ${idx + 1}º marcador`}
                      className="h-8 text-xs bg-white border-slate-300 focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                    />
                  </div>
                  <div className="flex items-center gap-2 ml-8 sm:ml-0">
                    <div className="w-48 sm:w-52">
                      <Select
                        value={item.posicao}
                        onValueChange={(val: any) => handleUpdateScorerA(idx, { posicao: val })}
                        disabled={item.gol_contra}
                      >
                        <SelectTrigger
                          className={`h-8 text-[11px] bg-slate-50 border-slate-300 transition-opacity ${
                            item.gol_contra ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          title={item.gol_contra ? 'Gol contra vale regra de +5 pts' : undefined}
                        >
                          <SelectValue placeholder="Selecione a posição">
                            {item.gol_contra ? 'Gol Contra (+5 pts)' : undefined}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {POSICOES_DISPONIVEIS.map((p) => (
                            <SelectItem key={p.value} value={p.value} className="text-xs">
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap text-xs font-medium text-slate-700">
                      <Checkbox
                        checked={item.gol_contra}
                        onCheckedChange={(checked) =>
                          handleUpdateScorerA(idx, { gol_contra: Boolean(checked) })
                        }
                      />
                      <span>Gol Contra</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Marcadores Time B */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-slate-800">
              Marcadores — {timeB} ({placarB} gol{placarB === 1 ? '' : 's'})
            </Label>
            {placarB === 0 && (
              <span className="text-[10px] text-slate-400 italic">0 gols previstos</span>
            )}
          </div>
          {scorersB.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-1">
              Nenhum marcador a preencher (0 gols).
            </p>
          ) : (
            <div className="space-y-2">
              {scorersB.map((item, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                      {idx + 1}º
                    </span>
                    <Input
                      value={item.nome}
                      onChange={(e) => handleUpdateScorerB(idx, { nome: e.target.value })}
                      placeholder={`Nome do ${idx + 1}º marcador`}
                      className="h-8 text-xs bg-white border-slate-300 focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                    />
                  </div>
                  <div className="flex items-center gap-2 ml-8 sm:ml-0">
                    <div className="w-48 sm:w-52">
                      <Select
                        value={item.posicao}
                        onValueChange={(val: any) => handleUpdateScorerB(idx, { posicao: val })}
                        disabled={item.gol_contra}
                      >
                        <SelectTrigger
                          className={`h-8 text-[11px] bg-slate-50 border-slate-300 transition-opacity ${
                            item.gol_contra ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          title={item.gol_contra ? 'Gol contra vale regra de +5 pts' : undefined}
                        >
                          <SelectValue placeholder="Selecione a posição">
                            {item.gol_contra ? 'Gol Contra (+5 pts)' : undefined}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {POSICOES_DISPONIVEIS.map((p) => (
                            <SelectItem key={p.value} value={p.value} className="text-xs">
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap text-xs font-medium text-slate-700">
                      <Checkbox
                        checked={item.gol_contra}
                        onCheckedChange={(checked) =>
                          handleUpdateScorerB(idx, { gol_contra: Boolean(checked) })
                        }
                      />
                      <span>Gol Contra</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs font-semibold"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-[#0F2A43] text-xs font-bold text-white hover:bg-[#1B3A5C]"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                Salvar Alterações
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
