import { useState, useEffect } from 'react'
import { Edit3, Loader2, Save, User, ShieldCheck } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Palpite } from '@/types/bolao'
import { extractScorerNames } from '@/lib/scorerUtils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  const [scorersA, setScorersA] = useState<string[]>([])
  const [scorersB, setScorersB] = useState<string[]>([])

  const placarA = Math.max(0, Number(palpite?.placar_a) || 0)
  const placarB = Math.max(0, Number(palpite?.placar_b) || 0)

  // Preenche os marcadores ao abrir o modal
  useEffect(() => {
    if (palpite && open) {
      const extractedA = extractScorerNames(palpite.goleadores_a)
      const extractedB = extractScorerNames(palpite.goleadores_b)

      // Garante quantidade de inputs proporcional aos gols indicados no palpite
      // (se placarA for 2, teremos no mínimo 2 slots, ou se extraídos > placar, mantém todos)
      const slotsA = Math.max(placarA, extractedA.length)
      const initialA: string[] = []
      for (let i = 0; i < slotsA; i++) {
        initialA.push(extractedA[i] || '')
      }

      const slotsB = Math.max(placarB, extractedB.length)
      const initialB: string[] = []
      for (let i = 0; i < slotsB; i++) {
        initialB.push(extractedB[i] || '')
      }

      setScorersA(initialA)
      setScorersB(initialB)
    }
  }, [palpite, open, placarA, placarB])

  const handleUpdateScorerA = (idx: number, val: string) => {
    setScorersA((prev) => {
      const next = [...prev]
      next[idx] = val
      return next
    })
  }

  const handleUpdateScorerB = (idx: number, val: string) => {
    setScorersB((prev) => {
      const next = [...prev]
      next[idx] = val
      return next
    })
  }

  const handleSave = async () => {
    if (!palpite) return
    setSaving(true)

    try {
      // Limpa espaços e remove itens totalmente vazios além do limite de gols
      const cleanA = scorersA.map((s) => s.trim()).filter(Boolean)
      const cleanB = scorersB.map((s) => s.trim()).filter(Boolean)

      // Atualiza o palpite no banco PocketBase
      const updatedRecord = await pb.collection('palpites').update<Palpite>(palpite.id, {
        goleadores_a: cleanA,
        goleadores_b: cleanB,
      })

      // Se o jogo já estiver finalizado, aciona recálculo imediato de pontuação para manter tudo consistente
      try {
        const game = await pb.collection('jogos').getOne(palpite.jogo)
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
        console.warn('Aviso: recalculo após edição de marcadores:', errCalc)
      }

      toast({
        title: 'Marcadores atualizados!',
        description: `Grafia dos marcadores do palpite de ${nomeParticipante || 'Participante'} salva com sucesso.`,
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
            <div className="space-y-1.5">
              {scorersA.map((val, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                    {idx + 1}º
                  </span>
                  <Input
                    value={val}
                    onChange={(e) => handleUpdateScorerA(idx, e.target.value)}
                    placeholder={`Nome padronizado do ${idx + 1}º marcador`}
                    className="h-8 text-xs bg-white border-slate-300 focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                  />
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
            <div className="space-y-1.5">
              {scorersB.map((val, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                    {idx + 1}º
                  </span>
                  <Input
                    value={val}
                    onChange={(e) => handleUpdateScorerB(idx, e.target.value)}
                    placeholder={`Nome padronizado do ${idx + 1}º marcador`}
                    className="h-8 text-xs bg-white border-slate-300 focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                  />
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
