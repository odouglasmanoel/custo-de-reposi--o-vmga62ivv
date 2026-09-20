import React, { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, Loader2, KeyRound } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { extractFieldErrors, getErrorMessage } from '@/lib/pocketbase/errors'
import { normalizarLogin } from '@/lib/loginUtils'

interface ChangePasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordModal({ open, onOpenChange }: ChangePasswordModalProps) {
  const { user, refreshUser } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [loading, setLoading] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null)
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  const resetForm = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowCurrent(false)
    setShowNew(false)
    setShowConfirm(false)
    setGeneralError(null)
    setCurrentPasswordError(null)
    setNewPasswordError(null)
    setConfirmPasswordError(null)
    setSuccess(false)
    setLoading(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setGeneralError(null)
    setCurrentPasswordError(null)
    setNewPasswordError(null)
    setConfirmPasswordError(null)
    setSuccess(false)

    if (!user) {
      setGeneralError('Usuário não autenticado.')
      return
    }

    let hasError = false

    if (!currentPassword) {
      setCurrentPasswordError('Informe a senha atual.')
      hasError = true
    }

    if (!newPassword) {
      setNewPasswordError('Informe a nova senha.')
      hasError = true
    } else if (newPassword.length < 4) {
      setNewPasswordError('A nova senha deve ter no mínimo 4 caracteres.')
      hasError = true
    }

    if (!confirmPassword) {
      setConfirmPasswordError('Confirme a nova senha.')
      hasError = true
    } else if (newPassword && newPassword !== confirmPassword) {
      setConfirmPasswordError('A confirmação não confere com a nova senha.')
      hasError = true
    }

    if (hasError) return

    setLoading(true)

    try {
      // 1. Obter ID e credenciais diretamente da sessão ativa do PocketBase
      const authRecord = pb.authStore.record || user
      const targetUserId = authRecord?.id
      if (!targetUserId) {
        setGeneralError('Sessão inválida. Faça login novamente.')
        setLoading(false)
        return
      }

      // 1.1 Opcional: Re-autenticar com senha atual para validação de segurança imediata no client
      const rawUserIdentifier =
        authRecord.email || user.email || authRecord.username || authRecord.name || user.name || ''
      const userEmail = normalizarLogin(rawUserIdentifier)

      if (userEmail) {
        try {
          await pb.collection('users').authWithPassword(userEmail, currentPassword)
        } catch (authErr: unknown) {
          console.error('Falha ao validar senha atual:', authErr)
          setCurrentPasswordError('Senha atual incorreta.')
          setLoading(false)
          return
        }
      }

      // 2. Atualizar senha no PocketBase via endpoint de records da collection 'users'
      // O PocketBase exige 'oldPassword' quando um usuário autenticado atualiza sua própria senha
      // Aceita qualquer combinação a partir de 4 caracteres (incluindo repetidos/sequenciais)
      await pb.collection('users').update(targetUserId, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      })

      // Atualiza estado local de auth para manter sessão consistente
      await refreshUser()

      setSuccess(true)
      toast({
        title: 'Sucesso',
        description: 'Senha alterada com sucesso!',
      })

      // Fecha modal após breve confirmação com timer rastreado para cleanup seguro
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = setTimeout(() => {
        handleOpenChange(false)
      }, 1200)
    } catch (err: unknown) {
      console.error('Erro ao atualizar senha:', err)
      const fieldErrors = extractFieldErrors(err)
      if (fieldErrors.oldPassword) {
        setCurrentPasswordError(fieldErrors.oldPassword)
      }
      if (fieldErrors.password) {
        setNewPasswordError(fieldErrors.password)
      }
      if (fieldErrors.passwordConfirm) {
        setConfirmPasswordError(fieldErrors.passwordConfirm)
      }

      const errorMsg = getErrorMessage(err)
      setGeneralError(errorMsg || 'Não foi possível alterar a senha. Tente novamente mais tarde.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F2A43] text-white">
              <KeyRound className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-[#0F172A]">Alterar Senha</DialogTitle>
              <DialogDescription className="text-xs text-[#64748B]">
                Atualize sua credencial de acesso individual ao Repress.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="my-6 flex flex-col items-center justify-center space-y-2 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 animate-in zoom-in-50" />
            <h3 className="text-base font-semibold text-[#0F172A]">Senha alterada com sucesso!</h3>
            <p className="text-xs text-[#64748B]">
              Sua nova credencial já está ativa para os próximos acessos.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4 py-2">
            {generalError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{generalError}</span>
              </div>
            )}

            {/* Senha Atual */}
            <div className="space-y-1">
              <Label htmlFor="current-password" className="text-xs font-semibold text-[#0F172A]">
                Senha Atual
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value)
                    if (currentPasswordError) setCurrentPasswordError(null)
                  }}
                  className={`h-10 pl-9 pr-10 text-sm focus-visible:ring-[#10B981] ${
                    currentPasswordError ? 'border-red-500' : 'border-[#CBD5E1]'
                  }`}
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {currentPasswordError && (
                <p className="text-xs text-red-600">{currentPasswordError}</p>
              )}
            </div>

            {/* Nova Senha */}
            <div className="space-y-1">
              <Label htmlFor="new-password" className="text-xs font-semibold text-[#0F172A]">
                Nova Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  placeholder="Mínimo de 4 caracteres"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    if (newPasswordError) setNewPasswordError(null)
                  }}
                  className={`h-10 pl-9 pr-10 text-sm focus-visible:ring-[#10B981] ${
                    newPasswordError ? 'border-red-500' : 'border-[#CBD5E1]'
                  }`}
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPasswordError && <p className="text-xs text-red-600">{newPasswordError}</p>}
            </div>

            {/* Confirmar Nova Senha */}
            <div className="space-y-1">
              <Label htmlFor="confirm-password" className="text-xs font-semibold text-[#0F172A]">
                Confirmar Nova Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repita a nova senha"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    if (confirmPasswordError) setConfirmPasswordError(null)
                  }}
                  className={`h-10 pl-9 pr-10 text-sm focus-visible:ring-[#10B981] ${
                    confirmPasswordError ? 'border-red-500' : 'border-[#CBD5E1]'
                  }`}
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPasswordError && (
                <p className="text-xs text-red-600">{confirmPasswordError}</p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
                className="h-10 border-[#CBD5E1] text-xs font-medium text-[#0F172A]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="h-10 bg-[#0F2A43] text-xs font-semibold text-white hover:bg-[#1B3A5C]"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Nova Senha'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
