import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Users,
  Plus,
  Trash2,
  Edit,
  Check,
  X,
  Loader2,
  AlertCircle,
  Trophy,
  Shield,
  KeyRound,
  Eye,
  EyeOff,
  UserCheck,
  AlertTriangle,
  RefreshCw,
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

export interface AuthUserInfo {
  id: string
  name: string
  email: string
  username: string
  verified?: boolean
}

export interface GroupedParticipante {
  nome: string
  registros: Participante[] // um registro por bolão em que participa
  totalPontos: number
  matchedUser?: AuthUserInfo | null
}

export function AdminManageParticipantesModal({
  open,
  onOpenChange,
  boloes,
  onSuccess,
}: AdminManageParticipantesModalProps) {
  const { toast } = useToast()

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [authUsers, setAuthUsers] = useState<AuthUserInfo[]>([])
  const [todosBoloes, setTodosBoloes] = useState<Bolao[]>(boloes)
  const [loading, setLoading] = useState(false)
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)

  // Controle de requisição em voo para evitar sobreposição e duplicidade (ex: React StrictMode)
  const fetchInProgressRef = useRef(false)

  // Formulário: Cadastrar novo participante
  const [novoNome, setNovoNome] = useState('')
  const [novoLogin, setNovoLogin] = useState('')
  const [novaSenhaInicial, setNovaSenhaInicial] = useState('')
  const [criarLoginJunto, setCriarLoginJunto] = useState(false)
  const [novoPontosImportados, setNovoPontosImportados] = useState<number>(0)
  const [boloesSelecionados, setBoloesSelecionados] = useState<string[]>([])
  const [cadastrando, setCadastrando] = useState(false)
  const [erroCadastro, setErroCadastro] = useState<string | null>(null)

  // Sub-modal / Drawer: Edição Completa do Participante (Requisito 1, 2 e 3)
  const [editingTarget, setEditingTarget] = useState<GroupedParticipante | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editNovaSenha, setEditNovaSenha] = useState('')
  const [showEditSenha, setShowEditSenha] = useState(false)
  const [editBoloesSelecionados, setEditBoloesSelecionados] = useState<string[]>([])
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
  const [erroEdicao, setErroEdicao] = useState<string | null>(null)

  // Modal / Diálogo de Confirmação de Exclusão / Desativação
  const [deletingTarget, setDeletingTarget] = useState<GroupedParticipante | null>(null)
  const [deleteOption, setDeleteOption] = useState<'remover_todos_boloes' | 'remover_sistema'>(
    'remover_todos_boloes',
  )
  const [executandoExclusao, setExecutandoExclusao] = useState(false)

  // Exclusão pontual de vínculo de um chip
  const [deletingVinculoId, setDeletingVinculoId] = useState<string | null>(null)

  // Carregar todos os bolões (ativos e encerrados/passados)
  const carregarBoloesCompletos = useCallback(async () => {
    try {
      const records = await pb.collection('boloes').getFullList<Bolao>({
        sort: '-ativo,nome',
      })
      if (records && records.length > 0) {
        setTodosBoloes(records)
      } else {
        setTodosBoloes(boloes)
      }
    } catch (err) {
      console.warn('Erro ao carregar lista completa de bolões:', err)
      setTodosBoloes(boloes)
    }
  }, [boloes])

  // Carregar participantes e usuários de autenticação
  const carregarDados = useCallback(
    async (options?: { force?: boolean }) => {
      // Evita chamadas duplicadas simultâneas (ex: montagem em React StrictMode)
      if (fetchInProgressRef.current && !options?.force) {
        return
      }
      fetchInProgressRef.current = true
      setLoading(true)
      setErroCarregamento(null)

      try {
        await carregarBoloesCompletos()

        // 1. Participantes (banco PocketBase local)
        const records = await pb.collection('participantes').getFullList<Participante>({
          sort: 'nome,bolao',
        })
        setParticipantes(records)

        // 2. Usuários auth (via hook admin dedicado ou fallback SDK na collection 'users')
        try {
          const res = await pb.send('/backend/v1/admin/gerenciar-usuarios', {
            method: 'POST',
            body: { action: 'list' },
          })
          if (res && res.users) {
            setAuthUsers(res.users)
          }
        } catch (adminHookErr) {
          console.warn('Aviso ao consultar endpoint admin hook, usando fallback:', adminHookErr)
          try {
            const directUsers = await pb.collection('users').getFullList()
            const sanitized = directUsers.map((u: any) => {
              const email = u.email || ''
              return {
                id: u.id,
                name: u.name || '',
                email,
                username: email.includes('@') ? email.split('@')[0] : email,
                verified: u.verified,
              }
            })
            setAuthUsers(sanitized)
          } catch (uErr) {
            console.error('Falha ao listar usuários auth:', uErr)
          }
        }
      } catch (err: any) {
        console.error('Erro ao carregar participantes:', err)
        const msg = err?.message || 'Não foi possível buscar a lista de participantes.'
        setErroCarregamento(msg)
        toast({
          title: 'Erro ao carregar participantes',
          description: msg,
          variant: 'destructive',
        })
      } finally {
        fetchInProgressRef.current = false
        setLoading(false)
      }
    },
    [carregarBoloesCompletos, toast],
  )

  // Reseta os campos auxiliares do formulário
  const resetFormState = useCallback(() => {
    setErroCadastro(null)
    setNovoNome('')
    setNovoLogin('')
    setNovaSenhaInicial('')
    setCriarLoginJunto(false)
    setNovoPontosImportados(0)
    setEditingTarget(null)
    setDeletingTarget(null)

    // Por padrão, selecionar todos os bolões ativos
    const listaFonte = todosBoloes.length > 0 ? todosBoloes : boloes
    const ativos = listaFonte.filter((b) => b.ativo !== false).map((b) => b.id)
    setBoloesSelecionados(ativos.length > 0 ? ativos : listaFonte.map((b) => b.id))
  }, [todosBoloes, boloes])

  // CARREGAMENTO AUTOMÁTICO NA ABERTURA (ON MOUNT/OPEN)
  // Garante que o fetch seja disparado automaticamente assim que open = true
  // e recarregue toda vez que o modal for fechado e reaberto.
  useEffect(() => {
    if (open) {
      resetFormState()
      carregarDados({ force: true })
    }
  }, [open, carregarDados, resetFormState])

  // Trata mudanças no estado de abertura vindas do Dialog
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
    if (!isOpen) {
      fetchInProgressRef.current = false
    }
  }

  // Casar usuários auth com os participantes
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

      // Casar com usuário da collection 'users'
      // 1) Match exato por nome
      // 2) Match por apelido / prefixo
      const nomeLower = nome.toLowerCase()
      let matchedUser = authUsers.find((u) => u.name && u.name.trim().toLowerCase() === nomeLower)

      if (!matchedUser) {
        // Tentar por username (ex: "brunol" ou "brunox" para "Bruno Lopes" / "Bruno Xavier")
        matchedUser = authUsers.find((u) => {
          const uLogin = (u.username || '').toLowerCase()
          const uName = (u.name || '').toLowerCase()
          if (nomeLower.includes('lopes') && (uLogin.includes('brunol') || uName.includes('lopes')))
            return true
          if (
            nomeLower.includes('xavier') &&
            (uLogin.includes('brunox') || uName.includes('xavier'))
          )
            return true
          if (
            nomeLower.includes('douglas') &&
            (uLogin.includes('douglas') || uName.includes('douglas'))
          )
            return true
          if (
            nomeLower.includes('gabriel') &&
            (uLogin.includes('gabriel') || uName.includes('gabriel'))
          )
            return true
          if (nomeLower.includes('davi') && (uLogin.includes('davi') || uName.includes('davi')))
            return true
          return false
        })
      }

      result.push({
        nome,
        registros,
        totalPontos,
        matchedUser: matchedUser || null,
      })
    })

    return result.sort((a, b) => a.nome.localeCompare(b.nome))
  }, [participantes, authUsers])

  // Bolões mapeados por id para renderizar nome rápido
  const boloesMap = useMemo(() => {
    const map = new Map<string, Bolao>()
    for (const b of todosBoloes) {
      map.set(b.id, b)
    }
    for (const b of boloes) {
      if (!map.has(b.id)) map.set(b.id, b)
    }
    return map
  }, [todosBoloes, boloes])

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

    if (criarLoginJunto) {
      if (!novoLogin.trim()) {
        setErroCadastro('Informe o username/login de acesso do participante.')
        return
      }
      if (!novaSenhaInicial.trim() || novaSenhaInicial.trim().length < 4) {
        setErroCadastro('A senha inicial deve possuir no mínimo 4 caracteres.')
        return
      }
    }

    setCadastrando(true)
    let criados = 0
    const erros: string[] = []

    try {
      // 1. Criar usuário auth se solicitado
      if (criarLoginJunto) {
        try {
          await pb.send('/backend/v1/admin/gerenciar-usuarios', {
            method: 'POST',
            body: {
              action: 'create_user',
              name: nomeTrim,
              username: novoLogin.trim(),
              password: novaSenhaInicial.trim(),
            },
          })
        } catch (userErr: any) {
          console.warn('Erro ao criar usuário auth via hook:', userErr)
          erros.push(
            `Aviso sobre login: ${userErr?.message || 'não foi possível criar credencial de acesso'}`,
          )
        }
      }

      // 2. Criar vínculos na collection participantes
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
          description: `${nomeTrim} adicionado com sucesso a ${criados} bolão(ões).`,
        })
        setNovoNome('')
        setNovoLogin('')
        setNovaSenhaInicial('')
        setCriarLoginJunto(false)
        setNovoPontosImportados(0)
        await carregarDados()
        onSuccess?.()
      }

      if (erros.length > 0) {
        setErroCadastro(erros.join(' '))
      }
    } finally {
      setCadastrando(false)
    }
  }

  // ABRIR MODAL DE EDIÇÃO COMPLETA (Requisitos 1, 2 e 3)
  const handleOpenEditModal = (group: GroupedParticipante) => {
    setEditingTarget(group)
    setEditNome(group.nome)
    setEditUsername(group.matchedUser?.username || '')
    setEditNovaSenha('')
    setShowEditSenha(false)
    setErroEdicao(null)
    setEditBoloesSelecionados(group.registros.map((r) => r.bolao))
  }

  // SALVAR EDIÇÃO COMPLETA DO PARTICIPANTE
  const handleSalvarEdicaoCompleta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTarget) return
    setErroEdicao(null)

    const nomeOriginal = editingTarget.nome.trim()
    const nomeFinal = editNome.trim()

    if (!nomeFinal) {
      setErroEdicao('O nome do participante não pode ficar em branco.')
      return
    }

    if (editNovaSenha && editNovaSenha.length < 4) {
      setErroEdicao('A nova senha deve ter no mínimo 4 caracteres.')
      return
    }

    setSalvandoEdicao(true)

    try {
      // 1. Atualizar credenciais de usuário (users) se houver usuário vinculado ou dados preenchidos
      const matchedUserId = editingTarget.matchedUser?.id
      if (matchedUserId || editUsername || editNovaSenha) {
        try {
          if (matchedUserId) {
            await pb.send('/backend/v1/admin/gerenciar-usuarios', {
              method: 'POST',
              body: {
                action: 'update_user',
                user_id: matchedUserId,
                name: nomeFinal,
                username: editUsername.trim() || undefined,
                password: editNovaSenha.trim() || undefined,
              },
            })
          } else if (editUsername && editNovaSenha) {
            // Se ainda não tinha usuário auth e o admin preencheu username + senha, criar a conta
            await pb.send('/backend/v1/admin/gerenciar-usuarios', {
              method: 'POST',
              body: {
                action: 'create_user',
                name: nomeFinal,
                username: editUsername.trim(),
                password: editNovaSenha.trim(),
              },
            })
          }
        } catch (authUpdateErr: any) {
          console.error('Erro ao atualizar usuário auth:', authUpdateErr)
          throw new Error(authUpdateErr?.message || 'Falha ao atualizar dados de acesso/login.')
        }
      }

      // 2. Renomear registros de participantes se o nome mudou
      if (nomeFinal.toLowerCase() !== nomeOriginal.toLowerCase()) {
        const registrosParaRenomear = participantes.filter(
          (p) => p.nome.trim().toLowerCase() === nomeOriginal.toLowerCase(),
        )
        for (const reg of registrosParaRenomear) {
          try {
            await pb.collection('participantes').update(reg.id, {
              nome: nomeFinal,
            })
          } catch (pUpdateErr: any) {
            console.error(`Erro ao atualizar nome no participante ${reg.id}:`, pUpdateErr)
          }
        }
      }

      // 3. Atualizar vínculos com bolões (adicionar aos novos, remover dos desmarcados)
      const currentRecords = participantes.filter(
        (p) =>
          p.nome.trim().toLowerCase() === nomeOriginal.toLowerCase() ||
          p.nome.trim().toLowerCase() === nomeFinal.toLowerCase(),
      )
      const currentBolaoIds = new Set(currentRecords.map((r) => r.bolao))
      const targetBolaoIds = new Set(editBoloesSelecionados)

      // 3a. Remover dos bolões desmarcados
      for (const rec of currentRecords) {
        if (!targetBolaoIds.has(rec.bolao)) {
          await pb.collection('participantes').delete(rec.id)
        }
      }

      // 3b. Adicionar aos bolões recém-marcados
      for (const bId of editBoloesSelecionados) {
        if (!currentBolaoIds.has(bId)) {
          await pb.collection('participantes').create({
            bolao: bId,
            nome: nomeFinal,
            pontos_importados: 0,
            pontuacao_total: 0,
          })
        }
      }

      toast({
        title: 'Participante atualizado!',
        description: `Dados e vínculos de "${nomeFinal}" foram atualizados com sucesso.`,
      })

      setEditingTarget(null)
      await carregarDados()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro geral ao salvar edição completa:', err)
      setErroEdicao(err?.message || 'Ocorreu um erro ao salvar as alterações.')
    } finally {
      setSalvandoEdicao(false)
    }
  }

  // EXCLUSÃO / DESATIVAÇÃO COM CONFIRMAÇÃO (Requisito 3)
  const handleConfirmarExclusao = async () => {
    if (!deletingTarget) return
    setExecutandoExclusao(true)

    try {
      const targetName = deletingTarget.nome.trim()
      const userId = deletingTarget.matchedUser?.id

      if (deleteOption === 'remover_sistema') {
        // Remover usuário do sistema (auth + vínculos)
        await pb.send('/backend/v1/admin/gerenciar-usuarios', {
          method: 'POST',
          body: {
            action: 'delete_user',
            user_id: userId || undefined,
            participant_name: targetName,
            remover_participantes: true,
          },
        })

        toast({
          title: 'Usuário desativado/removido',
          description: `"${targetName}" foi removido do sistema e de todas as competições.`,
        })
      } else {
        // Apenas desvincular de todos os bolões (preserva palpites históricos/pontuações gravadas)
        const registros = deletingTarget.registros
        for (const reg of registros) {
          try {
            await pb.collection('participantes').delete(reg.id)
          } catch (delErr) {
            console.warn(`Aviso ao remover participante ${reg.id}:`, delErr)
          }
        }

        toast({
          title: 'Vínculos removidos',
          description: `"${targetName}" foi removido de todas as tabelas e campeonatos ativos.`,
        })
      }

      setDeletingTarget(null)
      await carregarDados()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro na exclusão/desativação:', err)
      toast({
        title: 'Erro na exclusão',
        description: err?.message || 'Não foi possível completar a operação.',
        variant: 'destructive',
      })
    } finally {
      setExecutandoExclusao(false)
    }
  }

  // Excluir vínculo pontual de um único bolão (clicando no X do chip)
  const handleRemoverVinculoUnico = async (
    participanteId: string,
    nomeBolao: string,
    nomeMembro: string,
  ) => {
    if (
      !window.confirm(
        `Remover "${nomeMembro}" da competição "${nomeBolao}"? Ele deixará de figurar na tabela deste campeonato.`,
      )
    ) {
      return
    }

    setDeletingVinculoId(participanteId)
    try {
      await pb.collection('participantes').delete(participanteId)
      toast({
        title: 'Participante removido do bolão',
        description: `Vínculo com ${nomeBolao} removido com sucesso.`,
      })
      await carregarDados()
      onSuccess?.()
    } catch (err: any) {
      console.error('Erro ao remover vínculo único:', err)
      toast({
        title: 'Erro ao remover',
        description: err?.message || 'Não foi possível remover o participante.',
        variant: 'destructive',
      })
    } finally {
      setDeletingVinculoId(null)
    }
  }

  // Helpers de seleção de bolões
  const toggleBolaoCadastro = (id: string) => {
    setBoloesSelecionados((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    )
  }

  const toggleBolaoEdicao = (id: string) => {
    setEditBoloesSelecionados((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl w-full max-h-[92vh] overflow-y-auto bg-white rounded-xl p-6">
          <DialogHeader className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
                <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                  <Users className="h-5 w-5" />
                </div>
                <span>Gerenciar Participantes</span>
              </DialogTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => carregarDados({ force: true })}
                disabled={loading}
                className="h-8 text-xs text-slate-500 hover:text-slate-800"
                title="Recarregar lista"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
            <DialogDescription className="text-xs text-[#64748B]">
              Painel do Administrador (Douglas) com autonomia total: edite nomes, credenciais de
              acesso (username e senha), gerencie vínculos de todas as copas ativas e passadas, ou
              desative participantes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 pt-3">
            {/* SEÇÃO A: Cadastrar Novo Participante */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-2xs">
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

                {/* Opção para criar login simultâneo */}
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <Checkbox
                      checked={criarLoginJunto}
                      onCheckedChange={(checked) => setCriarLoginJunto(Boolean(checked))}
                    />
                    <span>Criar credencial de acesso ao sistema (Login / Senha)</span>
                  </label>

                  {criarLoginJunto && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div>
                        <Label
                          htmlFor="novo-login"
                          className="text-[11px] font-semibold text-slate-600"
                        >
                          Username / Login de Acesso
                        </Label>
                        <Input
                          id="novo-login"
                          placeholder="Ex: lucassilva"
                          value={novoLogin}
                          onChange={(e) => setNovoLogin(e.target.value)}
                          className="mt-1 h-8 text-xs bg-slate-50 border-slate-300"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          O usuário poderá entrar com este login simplificado.
                        </p>
                      </div>
                      <div>
                        <Label
                          htmlFor="nova-senha"
                          className="text-[11px] font-semibold text-slate-600"
                        >
                          Senha Inicial (mínimo 4 dígitos)
                        </Label>
                        <Input
                          id="nova-senha"
                          type="password"
                          placeholder="••••••"
                          value={novaSenhaInicial}
                          onChange={(e) => setNovaSenhaInicial(e.target.value)}
                          className="mt-1 h-8 text-xs bg-slate-50 border-slate-300"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Bolões a vincular (todas as copas ativas e passadas) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      Vincular às Copas / Bolões:
                    </Label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setBoloesSelecionados(todosBoloes.map((b) => b.id))}
                        className="text-emerald-700 hover:underline font-medium"
                      >
                        Selecionar Todos
                      </button>
                      <span className="text-slate-300">•</span>
                      <button
                        type="button"
                        onClick={() => setBoloesSelecionados([])}
                        className="text-slate-500 hover:underline"
                      >
                        Desmarcar Todos
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white rounded-lg p-2.5 border border-slate-200 max-h-36 overflow-y-auto">
                    {todosBoloes.map((b) => {
                      const checked = boloesSelecionados.includes(b.id)
                      const isAtivo = b.ativo !== false
                      return (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-slate-50 text-xs"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleBolaoCadastro(b.id)}
                          />
                          <span className="truncate text-slate-800">{b.nome}</span>
                          {!isAtivo && (
                            <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.2">
                              Passado
                            </span>
                          )}
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

            {/* SEÇÃO B: Lista de Participantes Cadastrados com Edição e Exclusão */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Participantes Cadastrados ({participantesAgrupados.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Clique no botão &quot;Editar&quot; de qualquer participante para alterar nome,
                    login, redefinir senha ou ajustar copas.
                  </p>
                </div>
                <span className="text-[11px] text-slate-500">
                  Total de vínculos: {participantes.length}
                </span>
              </div>

              {erroCarregamento && (
                <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-900">Falha ao carregar participantes</p>
                      <p className="text-red-700">{erroCarregamento}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => carregarDados({ force: true })}
                    className="h-7 border-red-300 text-red-800 hover:bg-red-100 text-xs shrink-0"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Tentar Novamente
                  </Button>
                </div>
              )}

              {loading ? (
                <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2 bg-slate-50/60 rounded-xl border border-slate-200">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                  <span className="font-medium text-slate-700">
                    Carregando participantes e dados...
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Consultando base de participantes e logins
                  </span>
                </div>
              ) : participantesAgrupados.length === 0 ? (
                <div className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-500 border border-slate-200">
                  Nenhum participante encontrado.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden bg-white">
                  {participantesAgrupados.map((group) => {
                    const userAccount = group.matchedUser
                    const isDouglasAdmin = group.nome.toLowerCase() === 'douglas'

                    return (
                      <div key={group.nome} className="p-3.5 hover:bg-slate-50/70 transition">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          {/* Nome e Login */}
                          <div className="flex flex-wrap items-center gap-2 flex-1">
                            <span className="font-bold text-sm text-[#0F172A]">{group.nome}</span>

                            {userAccount ? (
                              <Badge
                                variant="outline"
                                className="border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-mono flex items-center gap-1 py-0"
                                title={`Login ativo: ${userAccount.username}`}
                              >
                                <UserCheck className="h-3 w-3 text-indigo-500" />
                                <span>login: {userAccount.username}</span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-amber-200 bg-amber-50 text-amber-700 text-[10px] py-0"
                                title="Sem conta auth vinculada"
                              >
                                sem login direto
                              </Badge>
                            )}

                            {isDouglasAdmin && (
                              <Badge className="bg-[#0F2A43] text-amber-300 text-[10px] py-0">
                                <Shield className="h-3 w-3 mr-1" />
                                Administrador
                              </Badge>
                            )}
                          </div>

                          {/* Ações: Editar e Excluir */}
                          <div className="flex items-center gap-1.5">
                            {/* Botão de Edição Completa (Requisito 1) */}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenEditModal(group)}
                              className="h-7 text-[11px] font-semibold border-slate-300 text-[#0F2A43] hover:bg-slate-100 hover:text-emerald-700"
                            >
                              <Edit className="h-3 w-3 mr-1 text-slate-500" />
                              Editar
                            </Button>

                            {/* Botão de Exclusão / Desativação (Requisito 3) */}
                            {!isDouglasAdmin && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDeletingTarget(group)
                                  setDeleteOption('remover_todos_boloes')
                                }}
                                className="h-7 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 px-2"
                                title="Remover ou desativar usuário"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Chips dos bolões vinculados */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {group.registros.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">
                              Não participa de nenhum bolão no momento.
                            </span>
                          ) : (
                            group.registros.map((reg) => {
                              const bInfo = boloesMap.get(reg.bolao)
                              const isAtivo = bInfo?.ativo !== false

                              return (
                                <Badge
                                  key={reg.id}
                                  variant="secondary"
                                  className={`text-[11px] font-medium border flex items-center gap-1.5 py-0.5 ${
                                    isAtivo
                                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                      : 'bg-amber-50/60 text-slate-600 border-amber-200/80'
                                  }`}
                                >
                                  <span>{bInfo?.nome || 'Bolão'}</span>
                                  {!isAtivo && (
                                    <span className="text-[9px] text-slate-400 uppercase font-semibold">
                                      (Passado)
                                    </span>
                                  )}
                                  <span className="font-bold text-[#0F2A43]">
                                    ({reg.pontuacao_total} pts)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemoverVinculoUnico(
                                        reg.id,
                                        bInfo?.nome || 'Bolão',
                                        group.nome,
                                      )
                                    }
                                    disabled={deletingVinculoId === reg.id}
                                    className="text-slate-400 hover:text-red-600 ml-0.5"
                                    title="Remover apenas deste bolão"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* SUB-MODAL 1: EDIÇÃO COMPLETA DE USUÁRIO E VÍNCULOS (Requisitos 1 e 2) */}
      <Dialog
        open={Boolean(editingTarget)}
        onOpenChange={(open) => !open && setEditingTarget(null)}
      >
        <DialogContent className="max-w-xl w-full max-h-[92vh] overflow-y-auto bg-white rounded-xl p-6">
          <DialogHeader className="border-b border-slate-100 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#0F172A]">
              <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-700">
                <Edit className="h-4 w-4" />
              </div>
              <span>Editar Participante: {editingTarget?.nome}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Altere nome, credenciais de login (username e senha) e marque ou desmarque a
              participação em todas as Copas ativas e passadas do sistema.
            </DialogDescription>
          </DialogHeader>

          {erroEdicao && (
            <div className="my-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{erroEdicao}</span>
            </div>
          )}

          <form onSubmit={handleSalvarEdicaoCompleta} className="space-y-4 pt-1">
            {/* Bloco 1: Nome e Credenciais de Acesso */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-indigo-600" />
                <span>Dados Cadastrais e de Acesso</span>
              </h4>

              <div>
                <Label htmlFor="edit-nome" className="text-xs font-semibold text-slate-700">
                  Nome Completo ou Apelido
                </Label>
                <Input
                  id="edit-nome"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  placeholder="Ex: Bruno Lopes"
                  className="mt-1 h-9 bg-white text-xs"
                />
                <p className="mt-0.5 text-[10px] text-slate-400">
                  A alteração do nome é sincronizada automaticamente na lista de participantes e
                  tabelas de classificação.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit-username" className="text-xs font-semibold text-slate-700">
                    Username / Login de Acesso
                  </Label>
                  <Input
                    id="edit-username"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    placeholder="Ex: brunol"
                    className="mt-1 h-9 bg-white text-xs font-mono"
                  />
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Identificador utilizado para entrar no app.
                  </p>
                </div>

                <div>
                  <Label htmlFor="edit-senha" className="text-xs font-semibold text-slate-700">
                    Redefinir / Nova Senha
                  </Label>
                  <div className="relative mt-1">
                    <Input
                      id="edit-senha"
                      type={showEditSenha ? 'text' : 'password'}
                      value={editNovaSenha}
                      onChange={(e) => setEditNovaSenha(e.target.value)}
                      placeholder="Deixe vazio para manter"
                      className="h-9 bg-white text-xs pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditSenha(!showEditSenha)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      tabIndex={-1}
                    >
                      {showEditSenha ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Preencha apenas caso deseje definir uma nova senha para este usuário.
                  </p>
                </div>
              </div>
            </div>

            {/* Bloco 2: Gestão de Vínculos com Bolões / Copas (Requisito 2) */}
            <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Trophy className="h-3.5 w-3.5 text-amber-500" />
                    <span>Copas e Campeonatos Vinculados</span>
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    Ao desmarcar um bolão e salvar, o participante é removido do campeonato
                    escolhido (e da tabela de classificação correspondente).
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditBoloesSelecionados(todosBoloes.map((b) => b.id))}
                    className="text-indigo-600 hover:underline font-medium"
                  >
                    Marcar Todas
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setEditBoloesSelecionados([])}
                    className="text-slate-500 hover:underline"
                  >
                    Desmarcar Todas
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pt-1">
                {todosBoloes.map((b) => {
                  const isChecked = editBoloesSelecionados.includes(b.id)
                  const isAtivo = b.ativo !== false

                  return (
                    <label
                      key={b.id}
                      className={`flex items-center justify-between gap-2 cursor-pointer rounded-lg border p-2 text-xs transition ${
                        isChecked
                          ? 'border-indigo-300 bg-indigo-50/50 text-[#0F2A43]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleBolaoEdicao(b.id)}
                        />
                        <span className="font-medium truncate">{b.nome}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`text-[9px] px-1 py-0 ${
                          isAtivo
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {isAtivo ? 'Ativo' : 'Passado'}
                      </Badge>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingTarget(null)}
                disabled={salvandoEdicao}
                className="h-8 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={salvandoEdicao}
                className="h-8 bg-[#0F2A43] hover:bg-[#1B3A5C] text-white text-xs font-semibold"
              >
                {salvandoEdicao ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Salvando Alterações...
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                    Salvar Alterações
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* SUB-MODAL 2: CONFIRMAÇÃO DE EXCLUSÃO / DESATIVAÇÃO (Requisito 3) */}
      <Dialog
        open={Boolean(deletingTarget)}
        onOpenChange={(open) => !open && setDeletingTarget(null)}
      >
        <DialogContent className="max-w-md w-full bg-white rounded-xl p-6">
          <DialogHeader className="border-b border-slate-100 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-red-600">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <span>Remover / Desativar Usuário</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748B]">
              Selecione o nível de remoção desejado para <strong>{deletingTarget?.nome}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div
              onClick={() => setDeleteOption('remover_todos_boloes')}
              className={`cursor-pointer rounded-lg border p-3 transition ${
                deleteOption === 'remover_todos_boloes'
                  ? 'border-indigo-500 bg-indigo-50/50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete-option"
                  checked={deleteOption === 'remover_todos_boloes'}
                  onChange={() => setDeleteOption('remover_todos_boloes')}
                  className="mt-0.5 text-indigo-600"
                />
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    Desvincular de todos os Bolões (Recomendado)
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Remove o participante de todas as tabelas de classificação vigentes, mantendo a
                    credencial de login e os registros de palpites históricos preservados.
                  </p>
                </div>
              </div>
            </div>

            <div
              onClick={() => setDeleteOption('remover_sistema')}
              className={`cursor-pointer rounded-lg border p-3 transition ${
                deleteOption === 'remover_sistema'
                  ? 'border-red-500 bg-red-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete-option"
                  checked={deleteOption === 'remover_sistema'}
                  onChange={() => setDeleteOption('remover_sistema')}
                  className="mt-0.5 text-red-600"
                />
                <div>
                  <p className="text-xs font-bold text-red-700">
                    Remover do Sistema / Excluir Login
                  </p>
                  <p className="text-[11px] text-red-600/90 mt-0.5">
                    Exclui a conta de acesso (login) e retira o participante das competições.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeletingTarget(null)}
              disabled={executandoExclusao}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={executandoExclusao}
              onClick={handleConfirmarExclusao}
              className="h-8 text-xs font-semibold"
            >
              {executandoExclusao ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Processando...
                </>
              ) : (
                'Confirmar Remoção'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
