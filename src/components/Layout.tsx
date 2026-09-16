import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Trophy, LogOut, ArrowLeft, MessageSquare, Shield, KeyRound, User } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useActivePool } from '@/context/ActivePoolContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

interface LayoutProps {
  children?: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, isBolaoMember, isAdmin, logout } = useAuth()
  const { activeBolao } = useActivePool()
  const navigate = useNavigate()
  const location = useLocation()

  const isBolaoScreen = location.pathname.startsWith('/bolao')
  const showBackButton =
    location.pathname === '/bolao/chat' ||
    location.pathname === '/bolao/palpites' ||
    location.pathname === '/bolao/historico' ||
    location.pathname.startsWith('/bolao/admin')

  const handleBack = () => {
    if (location.pathname.startsWith('/bolao/admin/jogos/')) {
      navigate('/bolao/admin/jogos')
    } else if (
      location.pathname === '/bolao/admin/jogos' ||
      location.pathname === '/bolao/chat' ||
      location.pathname === '/bolao/palpites' ||
      location.pathname === '/bolao/historico'
    ) {
      navigate('/bolao')
    } else if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/bolao')
    }
  }

  const [changePasswordOpen, setChangePasswordOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const userNameDisplay = user?.name || user?.username || 'Colaborador'

  return (
    <div className="flex min-h-screen flex-col bg-[#F3F6F9] text-[#0F172A]">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-[#E2E8F0] bg-[#0F2A43] text-white shadow-sm backdrop-blur transition-all">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Left: Brand & Title */}
          <div className="flex items-center gap-3">
            {showBackButton && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="mr-1 text-white hover:bg-[#1B3A5C] hover:text-white"
                title="Voltar"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <Link to={isBolaoMember ? '/bolao' : '/'} className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-white hover:opacity-95">
                Repress
              </span>
              <span className="hidden text-xs text-slate-300 md:inline-block">|</span>
              <span className="hidden text-sm font-medium text-slate-200 sm:inline-block">
                Custo de Reposição — Gestão e Consultas
              </span>
            </Link>

            {isBolaoMember && (
              <Link
                to="/bolao"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B] px-2.5 py-0.5 text-xs font-bold text-slate-950 shadow-sm transition-transform hover:scale-105"
              >
                <Trophy className="h-3.5 w-3.5" />
                <span>Bolão</span>
              </Link>
            )}
          </div>

          {/* Right: User info & Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            {user ? (
              <>
                {isBolaoMember && (
                  <nav className="hidden items-center gap-1 lg:flex">
                    <Link
                      to="/bolao"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        location.pathname === '/bolao'
                          ? 'bg-[#1B3A5C] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Início
                    </Link>
                    <Link
                      to="/bolao/palpites"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        location.pathname === '/bolao/palpites'
                          ? 'bg-[#1B3A5C] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Meus Palpites
                    </Link>
                    <Link
                      to="/bolao/historico"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        location.pathname === '/bolao/historico'
                          ? 'bg-[#1B3A5C] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Histórico
                    </Link>
                    <Link
                      to="/bolao/chat"
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        location.pathname === '/bolao/chat'
                          ? 'bg-[#1B3A5C] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-[#10B981]" />
                      Assistente
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/bolao/admin/jogos"
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          location.pathname.startsWith('/bolao/admin')
                            ? 'bg-[#1B3A5C] text-amber-300'
                            : 'text-amber-400 hover:text-amber-300'
                        }`}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        Admin
                      </Link>
                    )}
                  </nav>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="group flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-right transition hover:border-slate-600 hover:bg-[#143452] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                      title="Opções da conta"
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B3A5C] text-xs font-bold text-white ring-1 ring-slate-600 group-hover:ring-emerald-400">
                        {userNameDisplay.charAt(0).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold leading-tight text-white group-hover:text-emerald-300 sm:text-sm">
                          {userNameDisplay}
                        </div>
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 border-slate-200 bg-white shadow-lg"
                  >
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-xs font-bold text-[#0F172A]">{userNameDisplay}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setChangePasswordOpen(true)}
                      className="cursor-pointer gap-2 text-xs font-medium text-[#0F172A] hover:bg-slate-100 focus:bg-slate-100"
                    >
                      <KeyRound className="h-4 w-4 text-[#10B981]" />
                      <span>Alterar Senha</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="cursor-pointer gap-2 text-xs font-medium text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4 text-rose-600" />
                      <span>Sair</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="h-8 border-slate-600 bg-[#143452] px-2.5 text-xs font-medium text-white hover:bg-rose-950 hover:text-rose-200"
                  title="Sair do sistema"
                >
                  <LogOut className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Sair</span>
                </Button>
              </>
            ) : (
              <Link to="/login">
                <Button
                  size="sm"
                  className="bg-[#10B981] text-xs font-semibold text-white hover:bg-emerald-600"
                >
                  Entrar
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {children}
      </main>

      {/* Footer — shown only on corporate screens or general non-bolão screens */}
      {!isBolaoScreen && (
        <footer className="border-t border-[#E2E8F0] bg-white py-4 text-center text-xs text-[#64748B]">
          Repress — Custo de Reposição &copy; {new Date().getFullYear()}
        </footer>
      )}

      {/* Modal de Alteração de Senha */}
      <ChangePasswordModal open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  )
}
