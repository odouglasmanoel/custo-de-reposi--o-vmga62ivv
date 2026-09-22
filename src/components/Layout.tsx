import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Trophy,
  LogOut,
  ArrowLeft,
  MessageSquare,
  Shield,
  KeyRound,
  Settings,
  BarChart2,
  Radio,
  Vote,
  Home,
  CheckCircle2,
  History,
  CalendarDays,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  User,
} from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

interface LayoutProps {
  children?: React.ReactNode
}

interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ElementType
  badge?: string
  adminOnly?: boolean
  aliases?: string[]
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'inicio',
    label: 'Início',
    path: '/bolao',
    icon: Home,
    aliases: ['/inicio'],
  },
  {
    id: 'meus-palpites',
    label: 'Meus Palpites',
    path: '/bolao/meus-palpites',
    icon: CheckCircle2,
    aliases: ['/bolao/palpites', '/meus-palpites'],
  },
  {
    id: 'jogos-do-dia',
    label: 'Jogos do Dia',
    path: '/bolao/jogos-do-dia',
    icon: CalendarDays,
    aliases: ['/jogos-do-dia'],
  },
  {
    id: 'enquetes',
    label: 'Enquetes',
    path: '/bolao/enquetes',
    icon: Vote,
  },
  {
    id: 'historico',
    label: 'Histórico',
    path: '/bolao/historico',
    icon: History,
  },
  {
    id: 'estatisticas',
    label: 'Estatísticas',
    path: '/bolao/estatisticas',
    icon: BarChart2,
  },
  {
    id: 'chat',
    label: 'Assistente',
    path: '/bolao/chat',
    icon: MessageSquare,
  },
  {
    id: 'admin',
    label: 'Admin',
    path: '/bolao/admin/jogos',
    icon: Shield,
    adminOnly: true,
    aliases: ['/bolao/admin/jogos', '/bolao/configuracoes', '/bolao/admin/configuracoes'],
  },
]

export default function Layout({ children }: LayoutProps) {
  const { user, isBolaoMember, isAdmin, logout } = useAuth()
  const { activeBolao } = useActivePool()
  const navigate = useNavigate()
  const location = useLocation()

  // Estado da Sidebar colapsável em desktop (lembrada via localStorage)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bolao_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })

  // Drawer mobile
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)

  // Fecha drawer ao navegar
  useEffect(() => {
    setMobileDrawerOpen(false)
  }, [location.pathname])

  const toggleSidebarCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('bolao_sidebar_collapsed', String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const isBolaoScreen = location.pathname.startsWith('/bolao') || location.pathname === '/inicio'
  const showBackButton =
    location.pathname === '/bolao/chat' ||
    location.pathname === '/bolao/jogos-do-dia' ||
    location.pathname === '/jogos-do-dia' ||
    location.pathname === '/bolao/enquetes' ||
    location.pathname === '/bolao/palpites' ||
    location.pathname === '/bolao/meus-palpites' ||
    location.pathname === '/meus-palpites' ||
    location.pathname === '/bolao/historico' ||
    location.pathname === '/bolao/estatisticas' ||
    location.pathname === '/bolao/configuracoes' ||
    location.pathname.startsWith('/bolao/admin')

  const handleBack = () => {
    if (
      location.pathname.startsWith('/bolao/admin/jogos/') ||
      location.pathname === '/bolao/admin/configuracoes' ||
      location.pathname === '/bolao/configuracoes'
    ) {
      navigate('/bolao/admin/jogos')
    } else if (
      location.pathname === '/bolao/admin/jogos' ||
      location.pathname === '/bolao/chat' ||
      location.pathname === '/bolao/jogos-do-dia' ||
      location.pathname === '/jogos-do-dia' ||
      location.pathname === '/bolao/enquetes' ||
      location.pathname === '/bolao/palpites' ||
      location.pathname === '/bolao/meus-palpites' ||
      location.pathname === '/meus-palpites' ||
      location.pathname === '/bolao/historico' ||
      location.pathname === '/bolao/estatisticas'
    ) {
      navigate('/bolao')
    } else if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/bolao')
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const userNameDisplay = user?.name || user?.username || 'Colaborador'

  const isItemActive = (item: NavItem) => {
    const p = location.pathname
    if (p === item.path) return true
    if (item.aliases && item.aliases.includes(p)) return true
    if (
      item.id === 'admin' &&
      (p.startsWith('/bolao/admin/jogos') ||
        p === '/bolao/configuracoes' ||
        p === '/bolao/admin/configuracoes')
    )
      return true
    return false
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    return true
  })

  return (
    <div className="flex min-h-screen bg-[#F3F6F9] text-[#0F172A]">
      {/* ============================================================== */}
      {/* DESKTOP SIDEBAR (Fixa à esquerda, retrátil / colapsável)      */}
      {/* ============================================================== */}
      {isBolaoMember && (
        <aside
          className={`hidden md:flex flex-col border-r border-[#1B3A5C] bg-[#0B1E30] text-slate-200 transition-all duration-300 z-30 shrink-0 sticky top-0 h-screen ${
            collapsed ? 'w-20' : 'w-64'
          }`}
          aria-label="Navegação Lateral"
        >
          {/* Topo da Sidebar: Título limpo 'Bolão do Grupo' */}
          <div className="flex h-16 items-center justify-between border-b border-[#1B3A5C]/80 px-4">
            <Link
              to="/bolao"
              className="flex items-center gap-2.5 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg p-1"
              title="Bolão do Grupo"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F59E0B] to-amber-600 shadow-md">
                <Trophy className="h-5 w-5 text-slate-950" />
              </div>
              {!collapsed && (
                <div className="flex flex-col leading-tight overflow-hidden">
                  <span className="font-black text-base tracking-tight text-white truncate">
                    Bolão do Grupo
                  </span>
                  {activeBolao && (
                    <span className="text-[11px] font-medium text-emerald-400 truncate">
                      {activeBolao.nome}
                    </span>
                  )}
                </div>
              )}
            </Link>

            {/* Botão de colapsar / expandir sidebar desktop */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebarCollapse}
              className="h-7 w-7 text-slate-400 hover:text-white hover:bg-[#143452] shrink-0"
              title={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Lista de Itens de Navegação */}
          <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
            {visibleNavItems.map((item) => {
              const active = isItemActive(item)
              const Icon = item.icon

              const linkContent = (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-[#10B981] to-emerald-600 text-white shadow-sm shadow-emerald-950/40'
                      : 'text-slate-300 hover:bg-[#143452] hover:text-white'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 transition-transform group-hover:scale-110 ${
                      active
                        ? 'text-white'
                        : item.id === 'jogos-do-dia'
                          ? 'text-sky-400'
                          : item.id === 'enquetes'
                            ? 'text-emerald-400'
                            : item.id === 'estatisticas'
                              ? 'text-amber-400'
                              : item.id === 'chat'
                                ? 'text-teal-400'
                                : item.id === 'admin'
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
                    }`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {item.id === 'enquetes' && !collapsed && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      Copa Coni
                    </span>
                  )}
                  {item.adminOnly && !collapsed && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      Admin
                    </span>
                  )}
                </Link>
              )

              if (collapsed) {
                return (
                  <Tooltip key={item.id} delayDuration={150}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="bg-[#0F2A43] text-white border-slate-700 font-semibold text-xs"
                    >
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return linkContent
            })}
          </nav>

          {/* Rodapé da Sidebar Desktop: Usuário e Ações */}
          <div className="border-t border-[#1B3A5C]/80 p-3 bg-[#081726]/60">
            <div
              className={`flex items-center gap-2.5 rounded-xl bg-[#143452]/60 p-2 ${
                collapsed ? 'justify-center p-1.5' : ''
              }`}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-sm"
                title={userNameDisplay}
              >
                {userNameDisplay.charAt(0).toUpperCase()}
              </div>

              {!collapsed && (
                <div className="flex-1 overflow-hidden leading-tight">
                  <p className="truncate text-xs font-bold text-white">{userNameDisplay}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {isAdmin ? 'Administrador' : 'Participante'}
                  </p>
                </div>
              )}

              {!collapsed && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:text-white hover:bg-[#1B3A5C] focus:outline-none"
                      title="Opções da conta"
                    >
                      <Settings className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 border-slate-200 bg-white">
                    <DropdownMenuLabel className="text-xs font-bold text-slate-900">
                      {userNameDisplay}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setChangePasswordOpen(true)}
                      className="cursor-pointer gap-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    >
                      <KeyRound className="h-4 w-4 text-emerald-600" />
                      <span>Alterar Senha</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="cursor-pointer gap-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4 text-rose-600" />
                      <span>Sair do Sistema</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {collapsed && (
              <div className="mt-2 flex justify-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="h-8 w-8 text-rose-400 hover:bg-rose-950/40 hover:text-rose-200"
                  title="Sair do sistema"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ============================================================== */}
      {/* DRAWER MOBILE (Deslizante à esquerda em telas pequenas)        */}
      {/* ============================================================== */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
          onClick={() => setMobileDrawerOpen(false)}
        >
          <div
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#0B1E30] text-slate-200 shadow-2xl flex flex-col z-50 animate-in slide-in-from-left duration-250"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Topo do Drawer Mobile */}
            <div className="flex h-16 items-center justify-between border-b border-[#1B3A5C] px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#F59E0B] to-amber-600 shadow-md">
                  <Trophy className="h-5 w-5 text-slate-950" />
                </div>
                <div className="flex flex-col">
                  <span className="font-black text-base text-white leading-tight">
                    Bolão do Grupo
                  </span>
                  <span className="text-[11px] text-emerald-400 font-medium">Menu Principal</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileDrawerOpen(false)}
                className="h-8 w-8 text-slate-400 hover:text-white hover:bg-[#143452]"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Links no Drawer Mobile */}
            <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
              {visibleNavItems.map((item) => {
                const active = isItemActive(item)
                const Icon = item.icon
                return (
                  <Link
                    key={item.id}
                    to={item.path}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? 'bg-gradient-to-r from-[#10B981] to-emerald-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-[#143452] hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 shrink-0 ${
                        active
                          ? 'text-white'
                          : item.id === 'jogos-do-dia'
                            ? 'text-sky-400'
                            : item.id === 'enquetes'
                              ? 'text-emerald-400'
                              : item.id === 'estatisticas'
                                ? 'text-amber-400'
                                : item.id === 'chat'
                                  ? 'text-teal-400'
                                  : item.id === 'admin'
                                    ? 'text-amber-300'
                                    : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.id === 'enquetes' && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        Copa Coni
                      </span>
                    )}
                    {item.adminOnly && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        Admin
                      </span>
                    )}
                  </Link>
                )
              })}
            </nav>

            {/* Rodapé do Drawer Mobile */}
            <div className="border-t border-[#1B3A5C] p-4 bg-[#081726]/80 space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                  {userNameDisplay.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-xs font-bold text-white">{userNameDisplay}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {isAdmin ? 'Administrador' : 'Participante'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMobileDrawerOpen(false)
                    setChangePasswordOpen(true)
                  }}
                  className="h-8 border-slate-700 bg-[#143452] text-xs text-slate-200 hover:text-white"
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                  Senha
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="h-8 border-rose-900 bg-rose-950/40 text-xs text-rose-300 hover:bg-rose-950 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5 mr-1" />
                  Sair
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* CONTEÚDO PRINCIPAL (Cabeçalho Superior Limpo + Children)        */}
      {/* ============================================================== */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Cabeçalho Superior Limpo */}
        <header className="sticky top-0 z-20 w-full border-b border-[#E2E8F0] bg-[#0F2A43] text-white shadow-sm backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            {/* Esquerda: Botão Menu Mobile (ou Voltar) + Título Padrão Limpo */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* Botão Hamburger em mobile para abrir Sidebar Drawer */}
              {isBolaoMember && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="md:hidden text-white hover:bg-[#1B3A5C] hover:text-white h-9 w-9"
                  title="Abrir menu lateral"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}

              {showBackButton && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBack}
                  className="text-white hover:bg-[#1B3A5C] hover:text-white h-9 w-9"
                  title="Voltar"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}

              {/* TÍTULO PADRÃO LIMPO: "Bolão do Grupo" (Sem logo/wordmark Repress e sem subtítulo corporativo) */}
              <Link
                to={isBolaoMember ? '/bolao' : '/'}
                className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded-lg py-1"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F59E0B] text-slate-950 shadow-sm md:hidden">
                  <Trophy className="h-4 w-4" />
                </div>
                <span className="text-lg sm:text-xl font-black tracking-tight text-white hover:text-amber-300 transition-colors">
                  Bolão do Grupo
                </span>
                {activeBolao && (
                  <span className="hidden sm:inline-flex items-center rounded-full bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    {activeBolao.nome}
                  </span>
                )}
              </Link>
            </div>

            {/* Direita: Perfil do usuário e ações rápidas */}
            <div className="flex items-center gap-2 sm:gap-3">
              {user ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 transition hover:border-slate-600 hover:bg-[#143452] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                        title="Opções da conta"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1B3A5C] text-xs font-bold text-white ring-1 ring-slate-600 group-hover:ring-emerald-400">
                          {userNameDisplay.charAt(0).toUpperCase()}
                        </div>
                        <div className="hidden sm:block text-left">
                          <div className="text-xs font-bold leading-tight text-white group-hover:text-emerald-300">
                            {userNameDisplay}
                          </div>
                          <div className="text-[10px] text-slate-300">
                            {isAdmin ? 'Administrador' : 'Participante'}
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
                          <p className="text-[11px] text-slate-500">
                            {isAdmin ? 'Acesso Administrativo' : 'Membro do Bolão'}
                          </p>
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
                    className="hidden sm:inline-flex h-8 border-slate-600 bg-[#143452] px-2.5 text-xs font-medium text-white hover:bg-rose-950 hover:text-rose-200"
                    title="Sair do sistema"
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1" />
                    <span>Sair</span>
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

        {/* Área Principal de Conteúdo */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </main>

        {/* Rodapé sutil apenas para telas que não sejam do bolão */}
        {!isBolaoScreen && (
          <footer className="border-t border-[#E2E8F0] bg-white py-4 text-center text-xs text-[#64748B]">
            Bolão do Grupo &copy; {new Date().getFullYear()}
          </footer>
        )}
      </div>

      {/* Modal de Alteração de Senha */}
      <ChangePasswordModal open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  )
}
