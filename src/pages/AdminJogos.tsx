import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Plus, Trash2, Calendar, Clock, Edit3, Loader2, AlertCircle } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useActivePool } from '@/context/ActivePoolContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { Jogo } from '@/types/bolao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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

export default function AdminJogos() {
  const { boloes, activeBolao, activeBolaoId, setActiveBolaoId } = useActivePool()
  const { toast } = useToast()

  const [jogos, setJogos] = useState<Jogo[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Form fields
  const [timeA, setTimeA] = useState('')
  const [timeB, setTimeB] = useState('')
  const [dataJogo, setDataJogo] = useState('')
  const [horaJogo, setHoraJogo] = useState('')
  const [temPenaltis, setTemPenaltis] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete confirmation
  const [gameToDelete, setGameToDelete] = useState<Jogo | null>(null)
  const [deleting, setDeleting] = useState(false)

  useRealtime<Jogo>('jogos', () => {
    loadJogos()
  })

  const loadJogos = async () => {
    if (!activeBolaoId) return
    try {
      const records = await pb.collection('jogos').getFullList<Jogo>({
        filter: `bolao = '${activeBolaoId}'`,
        sort: 'data,hora',
      })
      setJogos(records)
    } catch (err) {
      console.error('Erro ao carregar jogos:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeBolaoId) {
      setLoading(true)
      loadJogos()
    }
  }, [activeBolaoId])

  const handleCreateJogo = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!timeA.trim() || !timeB.trim() || !dataJogo || !horaJogo.trim()) {
      setFormError('Preencha todos os campos do jogo.')
      return
    }

    if (!activeBolaoId) {
      setFormError('Nenhum bolão ativo selecionado.')
      return
    }

    setSubmitting(true)
    try {
      await pb.collection('jogos').create({
        bolao: activeBolaoId,
        time_a: timeA.trim(),
        time_b: timeB.trim(),
        data: new Date(dataJogo).toISOString(),
        hora: horaJogo.trim(),
        resultado_finalizado: false,
        tem_penaltis: temPenaltis,
        gols_time_a: [],
        gols_time_b: [],
      })

      toast({
        title: 'Jogo cadastrado!',
        description: `${timeA} x ${timeB} adicionado com sucesso.`,
      })

      // Reset form
      setTimeA('')
      setTimeB('')
      setDataJogo('')
      setHoraJogo('')
      setTemPenaltis(false)
      loadJogos()
    } catch (err: unknown) {
      console.error('Erro ao cadastrar jogo:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao salvar o jogo'
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!gameToDelete) return
    setDeleting(true)
    try {
      await pb.collection('jogos').delete(gameToDelete.id)
      toast({
        title: 'Jogo excluído',
        description: 'A partida foi removida do bolão.',
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
              <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Gestão de Jogos</h1>
              <p className="text-xs text-[#64748B]">
                Módulo exclusivo do Administrador (Douglas) para agendamento e controle de partidas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="admin-pool-select" className="text-xs font-semibold text-slate-500">
            Bolão Selecionado:
          </label>
          <select
            id="admin-pool-select"
            value={activeBolaoId || ''}
            onChange={(e) => setActiveBolaoId(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F2A43] shadow-xs focus:border-[#10B981] focus:outline-none"
          >
            {boloes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome} {b.ativo ? '(Ativo)' : ''}
              </option>
            ))}
          </select>
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
            Adicione uma nova partida para a competição {activeBolao?.nome}.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {formError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleCreateJogo} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                {jogos.map((jogo) => {
                  const dataFormatada = jogo.data ? jogo.data.split('T')[0] : '—'
                  const finalizado = jogo.resultado_finalizado

                  return (
                    <tr key={jogo.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3.5">
                        <span className="font-bold text-[#0F172A]">
                          {jogo.time_a} x {jogo.time_b}
                        </span>
                        {jogo.tem_penaltis && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            Pênaltis possíveis
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{dataFormatada}</span>
                          <Clock className="ml-1 h-3.5 w-3.5 text-slate-400" />
                          <span>{jogo.hora}</span>
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
    </div>
  )
}
