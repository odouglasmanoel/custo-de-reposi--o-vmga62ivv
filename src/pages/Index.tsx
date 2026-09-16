import { useAuth } from '@/context/AuthContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertTriangle,
  Database,
  Calculator,
  FileSpreadsheet,
  Layers,
  ArrowUpRight,
} from 'lucide-react'

export default function Index() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      {/* Maintenance Notice Banner */}
      <Alert className="border-amber-300 bg-amber-50 text-amber-900">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="font-semibold text-amber-900">
          Módulo em manutenção — novas funcionalidades em breve.
        </AlertTitle>
        <AlertDescription className="text-sm text-amber-800">
          O sistema corporativo de cálculo de Custo de Reposição está passando por atualizações
          programadas na base de índices de insumos.
        </AlertDescription>
      </Alert>

      {/* Welcome header */}
      <div className="flex flex-col gap-1 border-b border-[#E2E8F0] pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
          Bem-vindo(a), {user?.name || user?.username || 'Colaborador(a)'}
        </h1>
        <p className="text-sm text-[#64748B]">
          Repress — Painel de Custo de Reposição, Gestão e Consultas Corporativas
        </p>
      </div>

      {/* Corporate placeholder cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1: Consultas recentes */}
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-2 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-blue-50 p-2 text-[#0F2A43]">
                <Database className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-slate-400">01</span>
            </div>
            <CardTitle className="mt-2 text-lg font-bold text-[#0F172A]">
              Consultas recentes
            </CardTitle>
            <CardDescription className="text-xs text-[#64748B]">
              Histórico de consultas e simulações de reposição realizadas por sua unidade.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span>Última busca: Aço CA-50 12mm</span>
                <span className="font-medium text-slate-700">Hoje</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Cimento CP-II F32</span>
                <span className="font-medium text-slate-700">Ontem</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Custos de reposição */}
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-2 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-emerald-50 p-2 text-[#10B981]">
                <Calculator className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-slate-400">02</span>
            </div>
            <CardTitle className="mt-2 text-lg font-bold text-[#0F172A]">
              Custos de reposição
            </CardTitle>
            <CardDescription className="text-xs text-[#64748B]">
              Tabela dinâmica com cotações médias e índices SINAPI / FGV atualizados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span>Variação mensal projetada</span>
                <span className="font-semibold text-emerald-600">+0,42%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Índice ponderado regional</span>
                <span className="font-medium text-slate-700">Sudeste (SP/MG)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Relatórios */}
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-2 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-slate-400">03</span>
            </div>
            <CardTitle className="mt-2 text-lg font-bold text-[#0F172A]">Relatórios</CardTitle>
            <CardDescription className="text-xs text-[#64748B]">
              Geração de demonstrativos contábeis e laudos técnicos de reposição patrimonial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span>Relatório Consolidado Q3</span>
                <span className="font-medium text-slate-700">Disponível</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Exportações PDF / XLSX</span>
                <span className="font-medium text-slate-700">Habilitado</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auxiliary informative section */}
      <div className="rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-slate-100 p-2 text-[#0F2A43]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#0F172A]">
              Diretrizes de Gestão e Auditoria Repress
            </h3>
            <p className="text-xs text-[#64748B]">
              Todos os cálculos observam a norma regulamentadora NBR 14653 e as instruções
              normativas vigentes.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
