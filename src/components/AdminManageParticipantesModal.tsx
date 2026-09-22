import { useState, useMemo } from 'react'
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  AlertCircle,
  Trophy,
  CheckSquare,
  Square,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Participante } from '@/types/bolao'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

interface AdminManageParticipantesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boloes: Bolao[]
  onSuccess?: () => void
}

interface GroupedParticipante {
  nome: string
  registros: Participante[] // um por bolão em que participa
  totalPontos: number
}

export function AdminManageParticipantesModal({
  open,
  onOpenChange,
  boloes,
  onSuccess,
}: AdminManageParticipantesModalProps) {
  const { toast } = useToast()

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [loading, setLoading] = useState(false)

  // Formulário: Cadastrar novo participante
  const [novoNome, setNovoNome] = useState('')
  const [novoPontosImportados, setNovoPontosImportados] = useState<number>(0)
  const [boloesSelecionados, setBoloesSelecionados] = useState<string[]>([])
  const [cadastrando, setCadastrando] = useState(false)
  const [erroCadastro, setErroCadastro] = useState<string | null>(null)

  // Gerenciamento de Bolões de um participante existente
  const [managingParticipantName, setManagingParticipantName] = useState<string | null>(null)
  const [managingBoloes, setManagingBoloes] = useState<string[]>([])
  const [savingBoloes, setSavingBoloes] = useState(false)

  // Edição rápida de nome
  const [editingNameOriginal, setEditingNameOriginal] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Exclusão de vínculo
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const carregarParticipantes = async () => {
    setLoading(true)
    try {
      const records = await pb.collection('participantes').getFullList<Participante>({
        sort: 'nome,bolao',
      })
      setParticipantes(records)
    } catch (err) {
      console.error('Erro ao carregar participantes:', err)
      toast({
        title: 'Erro ao carregar participantes',
        description: 'Não foi possível buscar a lista de participantes.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Carregar ao abrir o modal
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
    if (isOpen) {
      carregarParticipantes()
      setErroCadastro(null)
      setNovoNome('')
      setNovoPontosImportados(0)
      // Por padrão, selecionar todos os bolões ativos
      const ativos = boloes.filter((b) => b.ativo !== false).map((b) => b.id)
      setBoloesSelecionados(ativos.length > 0 ? ativos : boloes.map((b) => b.id))
    }
  }

  // Agrupamento por nome
  const participantesAgrupados = useMemo(() => {
    const map = new Map<string, Participante[]>()
    for (const p of participantes) {
      const nomeLimpo = p.nome.trim()
      const list = map.get(nomeLimpo) || []
      list.push(p)
      map.set(nomeLimpo, list)
    }

    const result: GroupedParticipante[] = []
    map.forEach((registros, nome) => {
      const totalPontos = registros.reduce((acc, r) => acc + (r.pontuacao_total || 0), 0)
      result.push({ nome, registros, totalPontos })
    })

    return result.sort((a, b) => a.nome.localeCompare(b.nome))
  }, [participantes])

  // Bolões ativos mapeados por id para renderizar nome
  const boloesMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of boloes) {
      map.set(b.id, b)
    }
    return map
  }, [boloes])

  // Submeter cadastro de novo participante
  const handleCadastrarNovo = async (e: React.FormEvent) => {
    e.preventDefault()
    setErroCadastro(null)

    const nomeTrim = novoNome.trim()
    if (!nomeTrim) {
      setErroCadastro('Informe o nome do participante.')
      return
    }

    if (boloesSelecionados.length === 0) {
      setErroCadastro('Selecione pelo menos um bolão para vincular o participante.')
      return
    }

    setCadastrando(true)
    let criados = 0
    const erros: string[] = []

    try {
      for (const bolaoId of boloesSelecionados) {
        try {
          await pb.collection('participantes').create({
            bolao: bolaoId,
            nome: nomeTrim,
            pontos_importados: Number(novoPontosImportados) || 0,
            pontuacao_total: Number(novoPontosImportados) || 0,
          })
          criados++
        } catch (err: any) {
          const bNome = boloesMap.get(bolaoId)?.nome || bolaoId
          if (err?.status === 400 || String(err?.message).includes('unique')) {
            erros.push(`${nomeTrim} já participa do bolão "${bNome}".`)
          } else {
            erros.push(`Erro no bolão "${bNome}": ${err?.message || 'falha'}`)
          }
        }
      }

      if (criados > 0) {
        toast({
          title: 'Participante cadastrado!',
          description: `${nomeTrim} adicionado a ${criados} bolão(ões).`,
        })
        setNovoNome('')
        setNovoPontosImportados(0)
        await carregarParticipantes()
        onSuccess?.()
      }

      if (erros.length > 0) {
        setErroCadastro(erros.join(' '))
      }
    } finally {
      setCadastrando(false)
    }
  }

  // Iniciar gerenciamento de bolões de um participante
  const handleOpenGerenciarBoloes = (group: GroupedParticipante) => {
    setManagingParticipantName(group.nome)
    setManagingBoloes(group.registros.map((r) => r.bolao))
  }

  // Salvar alteração de bolões (adicionar novos e remover desmarcados)
  const handleSalvarBoloesParticipante = async () => {
    if (!managingParticipantName) return
    setSavingBoloes(true)

    const currentRecords = participantes.filter(
      (p) => p.nome.trim().toLowerCase() === managingParticipantName.trim().toLowerCase(),
    )
    const currentBolaoIds = new Set(currentRecords.map((r) => r.bolao))
    const targetBolaoIds = new Set(managingBoloes)

    try {
      // 1. Remover dos bolões desmarcados
      for (const rec of currentRecords) {
        if (!targetBolaoIds.has(rec.bolao)) {
          await pb.collection('participantes').delete(rec.id)
        }
      }

      // 2. Adicionar aos bolões recém-marcados
      for (const bId of managingBoloes) {
        if (!currentBolaoIds.has(bId)) {
          await pb.collection('participantes').create({
            bolao: bId,
            nome: managingParticipantName,
            pontos_importados: 0,
            pontuacao_total: 0,
          })
        }
      }

      toast({
        title: 'Vínculos atualizados!',
        description: `Bolões de ${managingParticipantName} foram atualizados.`,
      })
      setManagingParticipantName(null)
      await carregarParticipantes()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro ao atualizar bolões:', err)
      toast({
        title: 'Erro ao atualizar vínculos',
        description: err?.message || 'Não foi possível salvar alterações.',
        variant: 'destructive',
      })
    } finally {
      setSavingBoloes(false)
    }
  }

  // Salvar renomeação rápida
  const handleSaveRename = async () => {
    if (!editingNameOriginal || !editingNameValue.trim()) return
    const novoNomeTrim = editingNameValue.trim()
    if (novoNomeTrim.toLowerCase() === editingNameOriginal.toLowerCase()) {
      setEditingNameOriginal(null)
      return
    }

    setSavingName(true)
    try {
      const recordsToUpdate = participantes.filter(
        (p) => p.nome.trim().toLowerCase() === editingNameOriginal.trim().toLowerCase(),
      )
      for (const rec of recordsToUpdate) {
        await pb.collection('participantes').update(rec.id, {
          nome: novoNomeTrim,
        })
      }
      toast({
        title: 'Nome atualizado!',
        description: `Participante renomeado de "${editingNameOriginal}" para "${novoNomeTrim}".`,
      })
      setEditingNameOriginal(null)
      await carregarParticipantes()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro ao renomear participante:', err)
      toast({
        title: 'Erro ao renomear',
        description: err?.message || 'Verifique se o novo nome já existe no bolão.',
        variant: 'destructive',
      })
    } finally {
      setSavingName(false)
    }
  }

  // Excluir vínculo específico de participante em um bolão
  const handleRemoverVinculo = async (participanteId: string, nomeBolao: string) => {
    if (!window.confirm(`Remover este participante do bolão "${nomeBolao}"?`)) {
      return
    }

    setDeletingId(participanteId)
    try {
      await pb.collection('participantes').delete(participanteId)
      toast({
        title: 'Participante removido do bolão',
        description: `Vínculo com ${nomeBolao} excluído com sucesso.`,
      })
      await carregarParticipantes()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro ao remover vínculo:', err)
      toast({
        title: 'Erro ao remover',
        description: err?.message || 'Não foi possível remover o participante.',
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  // Helpers de seleção de bolões para o formulário de cadastro
  const toggleBolaoCadastro = (id: string) => {
    setBoloesSelecionados((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    )
  }

  const selectAllCadastro = () => {
    setBoloesSelecionados(boloes.map((b) => b.id))
  }

  const deselectAllCadastro = () => {
    setBoloesSelecionados([])
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-white rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
            <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
              <Users className="h-5 w-5" />
            </div>
            <span>Gerenciar Participantes</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-[#64748B]">
            Cadastre novos participantes, vincule-os a competições existentes e gerencie o status de
            cada membro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* SEÇÃO A: Cadastrar Novo Participante */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-950 mb-3">
              <Plus className="h-4 w-4 text-emerald-600" />
              <span>Cadastrar Novo Participante</span>
            </h3>

            {erroCadastro && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <span>{erroCadastro}</span>
              </div>
            )}

            <form onSubmit={handleCadastrarNovo} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="part-nome" className="text-xs font-semibold text-slate-700">
                    Nome Completo ou Apelido
                  </Label>
                  <Input
                    id="part-nome"
                    placeholder="Ex: Lucas Silva"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    className="mt-1 h-9 bg-white border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="part-pontos" className="text-xs font-semibold text-slate-700">
                    Pontos Iniciais (Importados)
                  </Label>
                  <Input
                    id="part-pontos"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={novoPontosImportados}
                    onChange={(e) => setNovoPontosImportados(Number(e.target.value) || 0)}
                    className="mt-1 h-9 bg-white border-slate-300 text-xs"
                  />
                </div>
              </div>

              {/* Bolões a vincular */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Vincular aos Bolões:
                  </Label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllCadastro}
                      className="text-emerald-700 hover:underline font-medium"
                    >
                      Selecionar Todos
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={deselectAllCadastro}
                      className="text-slate-500 hover:underline"
                    >
                      Desmarcar Todos
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white rounded-lg p-2.5 border border-slate-200 max-h-36 overflow-y-auto">
                  {boloes.map((b) => {
                    const checked = boloesSelecionados.includes(b.id)
                    return (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-slate-50 text-xs"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleBolaoCadastro(b.id)}
                        />
                        <span className="truncate text-slate-800">
                          {b.nome} {b.ativo === false ? '(Encerrado)' : ''}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  size="sm"
                  disabled={cadastrando}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-8"
                >
                  {cadastrando ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Cadastrando...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Cadastrar Participante
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* SEÇÃO B: Lista de Participantes Cadastrados */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800">
                Participantes Cadastrados ({participantesAgrupados.length})
              </h3>
              <span className="text-[11px] text-slate-500">
                Total de vínculos: {participantes.length}
              </span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                Carregando participantes...
              </div>
            ) : participantesAgrupados.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-500">
                Nenhum participante encontrado.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden bg-white">
                {participantesAgrupados.map((group) => {
                  const isEditing = editingNameOriginal === group.nome
                  const isManagingThis = managingParticipantName === group.nome

                  return (
                    <div key={group.nome} className="p-3.5 hover:bg-slate-50/60 transition">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        {/* Nome ou Input de Edição */}
                        <div className="flex items-center gap-2 flex-1">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                              <Input
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                className="h-8 text-xs bg-white"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleSaveRename}
                                disabled={savingName}
                                className="h-8 w-8 p-0 text-emerald-600 hover:bg-emerald-50"
                                title="Salvar nome"
                              >
                                {savingName ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingNameOriginal(null)}
                                className="h-8 w-8 p-0 text-slate-400 hover:bg-slate-100"
                                title="Cancelar"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#0F172A]">{group.nome}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNameOriginal(group.nome)
                                  setEditingNameValue(group.nome)
                                }}
                                className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
                                title="Editar nome"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              isManagingThis
                                ? setManagingParticipantName(null)
                                : handleOpenGerenciarBoloes(group)
                            }
                            className="h-7 text-[11px] font-semibold border-slate-300 text-[#0F2A43] hover:bg-slate-100"
                          >
                            <Trophy className="h-3 w-3 mr-1 text-amber-500" />
                            {isManagingThis ? 'Fechar' : 'Gerenciar Bolões'}
                          </Button>
                        </div>
                      </div>

                      {/* Chips dos bolões vinculados */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {group.registros.map((reg) => {
                          const bInfo = boloesMap.get(reg.bolao)
                          return (
                            <Badge
                              key={reg.id}
                              variant="secondary"
                              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium border border-slate-200 flex items-center gap-1.5 py-0.5"
                            >
                              <span>{bInfo?.nome || 'Bolão'}</span>
                              <span className="font-bold text-[#0F2A43]">
                                ({reg.pontuacao_total} pts)
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoverVinculo(reg.id, bInfo?.nome || 'Bolão')}
                                disabled={deletingId === reg.id}
                                className="text-slate-400 hover:text-red-600 ml-0.5"
                                title="Remover deste bolão"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          )
                        })}
                      </div>

                      {/* Painel expandido de gerenciamento de bolões do participante */}
                      {isManagingThis && (
                        <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 animate-in fade-in-50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-700">
                              Vincular / Desvincular bolões de {group.nome}:
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setManagingBoloes(boloes.map((b) => b.id))}
                                className="text-[11px] text-emerald-700 hover:underline font-medium"
                              >
                                Marcar Todos
                              </button>
                              <span className="text-slate-300">•</span>
                              <button
                                type="button"
                                onClick={() => setManagingBoloes([])}
                                className="text-[11px] text-slate-500 hover:underline"
                              >
                                Desmarcar Todos
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                            {boloes.map((b) => {
                              const isChecked = managingBoloes.includes(b.id)
                              return (
                                <label
                                  key={b.id}
                                  className="flex items-center gap-2 cursor-pointer bg-white rounded border border-slate-200 p-2 text-xs"
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setManagingBoloes((prev) => [...prev, b.id])
                                      } else {
                                        setManagingBoloes((prev) =>
                                          prev.filter((id) => id !== b.id),
                                        )
                                      }
                                    }}
                                  />
                                  <span className="truncate">
                                    {b.nome} {b.ativo === false ? '(Encerrado)' : ''}
                                  </span>
                                </label>
                              )
                            })}
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setManagingParticipantName(null)}
                              className="h-7 text-xs"
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleSalvarBoloesParticipante}
                              disabled={savingBoloes}
                              className="h-7 bg-[#0F2A43] hover:bg-[#1B3A5C] text-white text-xs font-semibold"
                            >
                              {savingBoloes ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  Salvando...
                                </>
                              ) : (
                                'Salvar Vínculos'
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
