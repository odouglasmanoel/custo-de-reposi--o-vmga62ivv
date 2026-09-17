import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { ActivePoolProvider } from '@/context/ActivePoolContext'
import { ProtectedRoute, BolaoRoute, AdminRoute } from '@/components/RouteGuards'

import Layout from './components/Layout'
import Login from './pages/Login'
import Index from './pages/Index'
import BolaoDashboard from './pages/BolaoDashboard'
import AdminJogos from './pages/AdminJogos'
import AdminResultado from './pages/AdminResultado'
import AdminConfiguracoes from './pages/AdminConfiguracoes'
import Palpites from './pages/Palpites'
import JogosDoDia from './pages/JogosDoDia'
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

            {/* Protected Corporate & Bolão routes with Layout */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Index />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Bolão Restricted Layer (Douglas, Gabriel, Bruno, Davi) */}
            <Route
              path="/bolao"
              element={
                <BolaoRoute>
                  <Layout>
                    <BolaoDashboard />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Alias /inicio para a tela inicial do Bolão */}
            <Route
              path="/inicio"
              element={
                <BolaoRoute>
                  <Layout>
                    <BolaoDashboard />
                  </Layout>
                </BolaoRoute>
              }
            />

            <Route
              path="/bolao/palpites"
              element={
                <BolaoRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Alias /bolao/meus-palpites para Meus Palpites */}
            <Route
              path="/bolao/meus-palpites"
              element={
                <BolaoRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Alias direto /meus-palpites */}
            <Route
              path="/meus-palpites"
              element={
                <BolaoRoute>
                  <Layout>
                    <Palpites />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Central de Jogos do Dia & Placar Ao Vivo */}
            <Route
              path="/bolao/jogos-do-dia"
              element={
                <BolaoRoute>
                  <Layout>
                    <JogosDoDia />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Alias direto /jogos-do-dia */}
            <Route
              path="/jogos-do-dia"
              element={
                <BolaoRoute>
                  <Layout>
                    <JogosDoDia />
                  </Layout>
                </BolaoRoute>
              }
            />

            <Route
              path="/bolao/historico"
              element={
                <BolaoRoute>
                  <Layout>
                    <Historico />
                  </Layout>
                </BolaoRoute>
              }
            />

            <Route
              path="/bolao/estatisticas"
              element={
                <BolaoRoute>
                  <Layout>
                    <Estatisticas />
                  </Layout>
                </BolaoRoute>
              }
            />

            <Route
              path="/bolao/chat"
              element={
                <BolaoRoute>
                  <Layout>
                    <Chat />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Módulo de Enquetes da Copa Coni (Acessível por todos os participantes) */}
            <Route
              path="/bolao/enquetes"
              element={
                <BolaoRoute>
                  <Layout>
                    <Enquetes />
                  </Layout>
                </BolaoRoute>
              }
            />

            {/* Admin Routes (Douglas Only) */}
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
