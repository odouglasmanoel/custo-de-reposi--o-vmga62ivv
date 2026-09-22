import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Loader2 } from 'lucide-react'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Se o PocketBase authStore já possui credencial válida síncrona, não bloqueia em spinner
  const hasValidAuth = !!user || pb.authStore.isValid

  if (loading && !hasValidAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F6F9]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#0F2A43] border-t-transparent" />
          <p className="text-sm font-medium text-[#64748B]">Carregando Repress...</p>
        </div>
      </div>
    )
  }

  if (!user && !loading && !pb.authStore.isValid) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

export const BolaoRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, isBolaoMember } = useAuth()
  const location = useLocation()

  const hasValidAuth = !!user || pb.authStore.isValid

  if (loading && !hasValidAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F6F9]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2A43]" />
          <p className="text-sm font-medium text-[#64748B]">Validando acesso ao Bolão...</p>
        </div>
      </div>
    )
  }

  if (!user && !loading && !pb.authStore.isValid) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!isBolaoMember && !loading) {
    return <Navigate to="/bolao" replace />
  }

  return <>{children}</>
}

export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, isAdmin } = useAuth()

  const hasValidAuth = !!user || pb.authStore.isValid

  if (loading && !hasValidAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F6F9]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2A43]" />
          <p className="text-sm font-medium text-[#64748B]">
            Verificando credenciais de administrador...
          </p>
        </div>
      </div>
    )
  }

  if (!user && !loading && !pb.authStore.isValid) {
    return <Navigate to="/login" replace />
  }

  if (!isAdmin && !loading) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
