import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { ActivePoolProvider } from '@/context/ActivePoolContext'
import { ProtectedRoute, AdminRoute } from '@/components/RouteGuards'

import Layout from './components/Layout'
import Login from './pages/Login'
import Index from './pages/Index'
import BolaoDashboard from './pages/BolaoDashboard'
import AdminJogos from './pages/AdminJogos'
import AdminResultado from './pages/AdminResultado'
import AdminConfiguracoes from './pages/AdminConfiguracoes'
import Palpites from './pages/Palpites'
import Historico from './pages/Historico'
import Estatisticas from './pages/Estatisticas'
import Chat from './pages/Chat'
import Enquetes from './pages/Enquetes'
import NotFound from './pages/NotFound'

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <ActivePoolProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {/* Public Entry Point: Login */}
            <Route path="/login" element={<Login />} />

            {/* Rota principal "/" e "/inicio" renderizam SEMPRE a Dashboard Oficial do Bolão */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BolaoDashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Rota /bolao e /inicio */}
            <Route
              path="/bolao"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BolaoDashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/inicio"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BolaoDashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Rota legada/corporativa Painel de Custo de Reposição */}
            <Route
              path="/custo-reposicao"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Index />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/bolao/palpites"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Alias /bolao/meus-palpites para Meus Palpites */}
            <Route
              path="/bolao/meus-palpites"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Alias direto /meus-palpites */}
            <Route
              path="/meus-palpites"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Redirecionamento da aba/rota removida Jogos do Dia para a Home do Bolão */}
            <Route path="/bolao/jogos-do-dia" element={<Navigate to="/bolao" replace />} />
            <Route path="/jogos-do-dia" element={<Navigate to="/bolao" replace />} />

            <Route
              path="/bolao/historico"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Historico />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/historico" element={<Navigate to="/bolao/historico" replace />} />

            <Route
              path="/bolao/estatisticas"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Estatisticas />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/estatisticas" element={<Navigate to="/bolao/estatisticas" replace />} />

            <Route
              path="/bolao/chat"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Chat />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/chat" element={<Navigate to="/bolao/chat" replace />} />
            <Route path="/assistente" element={<Navigate to="/bolao/chat" replace />} />

            {/* Módulo de Enquetes da Copa Coni (Acessível por todos os participantes) */}
            <Route
              path="/bolao/enquetes"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Enquetes />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/enquetes" element={<Navigate to="/bolao/enquetes" replace />} />

            {/* Admin Routes (Douglas Only) */}
            <Route path="/admin/jogos" element={<Navigate to="/bolao/admin/jogos" replace />} />
            <Route
              path="/bolao/admin/jogos"
              element={
                <AdminRoute>
                  <Layout>
                    <AdminJogos />
                  </Layout>
                </AdminRoute>
              }
            />

            <Route
              path="/bolao/admin/jogos/:id/resultado"
              element={
                <AdminRoute>
                  <Layout>
                    <AdminResultado />
                  </Layout>
                </AdminRoute>
              }
            />

            <Route
              path="/bolao/admin/configuracoes"
              element={
                <AdminRoute>
                  <Layout>
                    <AdminConfiguracoes />
                  </Layout>
                </AdminRoute>
              }
            />

            <Route
              path="/bolao/configuracoes"
              element={
                <AdminRoute>
                  <Layout>
                    <AdminConfiguracoes />
                  </Layout>
                </AdminRoute>
              }
            />

            {/* 404 Catch-All */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </ActivePoolProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
