import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { User, Lock, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { normalizarLogin } from '@/lib/loginUtils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Detecta se o usuário foi redirecionado por sessão expirada (seja via location.state ou query param ?expired=1)
  const searchParams = new URLSearchParams(location.search)
  const sessionExpired = Boolean(
    (location.state as { sessionExpired?: boolean } | undefined)?.sessionExpired ||
    searchParams.get('expired') === '1',
  )

  // Desvio imediato se o usuário já estiver logado no PocketBase
  React.useEffect(() => {
    if (pb.authStore.isValid && pb.authStore.record) {
      const stateFrom = (
        location.state as { from?: { pathname?: string; search?: string } | string } | undefined
      )?.from
      let targetPath: string | null = null
      if (typeof stateFrom === 'string') {
        targetPath = stateFrom
      } else if (stateFrom?.pathname) {
        targetPath = `${stateFrom.pathname}${stateFrom.search || ''}`
      }

      if (targetPath && targetPath !== '/login') {
        navigate(targetPath, { replace: true })
      } else {
        // Redireciona sempre para a Dashboard Oficial do Bolão
        navigate('/', { replace: true })
      }
    }
  }, [navigate, location.state])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoginError(null)
    setPasswordError(null)

    let hasError = false
    const rawIdentifier = login.trim()
    if (!rawIdentifier) {
      setLoginError('Informe seu login')
      hasError = true
    }

    if (!password) {
      setPasswordError('Informe sua senha')
      hasError = true
    }

    if (hasError) return

    // Normalização via função utilitária compartilhada:
    // "brunol" -> "brunol@repress.com.br", "brunox" -> "brunox@repress.com.br"
    // "douglas.manoel@repress.com.br" -> preservado (case-insensitive e sem espaços de autocorreção mobile)
    const normalizedIdentifier = normalizarLogin(rawIdentifier.toLowerCase())

    setLoading(true)
    try {
      // Limpeza de cache/storage de sessão para garantir visão Geral em novo acesso
      const keysToClear = [
        'repress_active_bolao',
        'repress_selected_bolao',
        'active_bolao_id',
        'selected_bolao_id',
        'last_bolao_id',
        'bolao_ativo',
      ]
      keysToClear.forEach((key) => {
        try {
          localStorage.removeItem(key)
          sessionStorage.removeItem(key)
        } catch {
          /* intentionally ignored */
        }
      })

      await pb.collection('users').authWithPassword(normalizedIdentifier, password)

      // Check post-login redirect logic
      const stateFrom = (
        location.state as { from?: { pathname?: string; search?: string } } | undefined
      )?.from
      const targetPath = stateFrom?.pathname
        ? `${stateFrom.pathname}${stateFrom.search || ''}`
        : null

      if (targetPath && targetPath !== '/login') {
        navigate(targetPath, { replace: true })
      } else {
        // Redireciona sempre para a Dashboard Oficial do Bolão
        navigate('/', { replace: true })
      }
    } catch (err: unknown) {
      console.error('Falha na autenticação:', err)
      const errObj = err as { status?: number; message?: string }
      if (errObj?.status === 0 || errObj?.message?.toLowerCase().includes('failed to fetch')) {
        setError('Não foi possível conectar ao servidor. Verifique sua conexão à internet.')
      } else {
        setError('Login ou senha inválidos')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-[#F3F6F9]">
      {/* Left Panel (Branding) — hidden on small mobile, visible from md up */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0B1E30] via-[#0F2A43] to-[#173F65] p-12 text-white lg:flex">
        {/* Subtle decorative grid/network pattern */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #FFFFFF 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400 backdrop-blur-sm">
            <ShieldCheck className="h-4 w-4" />
            Portal Corporativo Seguro
          </div>
          <h1 className="mt-8 text-5xl font-black tracking-tight text-white">Repress</h1>
          <p className="mt-2 text-xl font-medium text-slate-200">
            Custo de Reposição — Gestão e Consultas
          </p>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-300">
            Plataforma integrada de inteligência corporativa, controle de dados e acesso dedicado
            aos módulos institucionais.
          </p>
        </div>

        <div className="relative z-10 border-t border-white/10 pt-6 text-xs text-slate-400">
          &copy; {new Date().getFullYear()} Repress. Todos os direitos reservados.
        </div>
      </div>

      {/* Right Panel (Form) */}
      <div className="flex w-full flex-col justify-center px-4 py-8 sm:px-8 md:px-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-md">
          {/* Mobile branding header */}
          <div className="mb-8 text-center lg:hidden">
            <h1 className="text-3xl font-black tracking-tight text-[#0F2A43]">Repress</h1>
            <p className="text-sm font-medium text-[#64748B]">
              Custo de Reposição — Gestão e Consultas
            </p>
          </div>

          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                Acessar o sistema
              </h2>
              <p className="mt-1 text-sm text-[#64748B]">Entre com seu login para continuar.</p>
            </div>

            {sessionExpired && !error && (
              <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-900">Sessão expirada</p>
                  <p className="text-xs text-amber-700">
                    Sua sessão foi encerrada por inatividade. Faça login novamente para continuar.
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <Label htmlFor="login" className="text-xs font-semibold text-[#0F172A]">
                  Login
                </Label>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Input
                    id="login"
                    type="text"
                    placeholder="usuario"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    className="h-11 border-[#CBD5E1] pl-9 text-sm focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                {loginError && <p className="mt-1 text-xs text-red-600">{loginError}</p>}
              </div>

              <div>
                <Label htmlFor="password" className="text-xs font-semibold text-[#0F172A]">
                  Senha
                </Label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 border-[#CBD5E1] pl-9 pr-10 text-sm focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordError && <p className="mt-1 text-xs text-red-600">{passwordError}</p>}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-lg bg-[#0F2A43] text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B3A5C] active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  'Entrar'
                )}
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-[#94A3B8]">
              Acesso restrito a colaboradores autorizados.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
