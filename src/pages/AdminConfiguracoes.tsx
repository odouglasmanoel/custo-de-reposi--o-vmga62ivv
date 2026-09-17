import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Radio,
  ExternalLink,
  Save,
  HelpCircle,
  Eye,
  EyeOff,
  Database,
  RefreshCw,
  Zap,
  Globe,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'

type ProvedorKey = 'football_data' | 'thesportsdb' | 'api_football'

interface ConfigState {
  provedor: ProvedorKey
  hasKey: boolean
  hasDbKey: boolean
  hasSecretFallback: boolean
  maskedKey: string
  hasFallbackKey: boolean
  hasFallbackDbKey: boolean
  maskedFallbackKey: string
  hasTsdbKey?: boolean
  hasTsdbDbKey?: boolean
  maskedTsdbKey?: string
  ativo: boolean
}
export default function AdminConfiguracoes() {
  const { user, isAdmin } = useAuth()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingFallback, setTestingFallback] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)

  const [config, setConfig] = useState<ConfigState>({
    provedor: 'api_football',
    hasKey: false,
    hasDbKey: false,
    hasSecretFallback: false,
    maskedKey: '',
    hasFallbackKey: false,
    hasFallbackDbKey: false,
    maskedFallbackKey: '',
    hasTsdbKey: false,
    hasTsdbDbKey: false,
    maskedTsdbKey: '',
    ativo: true,
  })

  const [selectedProvedor, setSelectedProvedor] = useState<ProvedorKey>('api_football')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKeyText, setShowKeyText] = useState(false)

  // Campo específico para chave secundária de contingência (Football-Data.org)
  const [fallbackApiKeyInput, setFallbackApiKeyInput] = useState('')
  const [showFallbackKeyText, setShowFallbackKeyText] = useState(false)

  // Campo específico para chave do TheSportsDB (Sul-Americana / Libertadores)
  const [tsdbApiKeyInput, setTsdbApiKeyInput] = useState('')
  const [showTsdbKeyText, setShowTsdbKeyText] = useState(false)
  const [testingTsdb, setTestingTsdb] = useState(false)
  const [tsdbTestResult, setTsdbTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const [ativoInput, setAtivoInput] = useState(true)

  // Status feedback do teste primário
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // Status feedback do teste secundário (contingência)
  const [fallbackTestResult, setFallbackTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const loadConfig = async () => {
    try {
      setLoading(true)
      const headers: Record<string, string> = {}
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }
      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/config`,
        { headers },
      )
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        setSelectedProvedor(data.provedor || 'api_football')
        setAtivoInput(data.ativo !== false)
      } else {
        const err = await res.json().catch(() => ({}))
        toast({
          title: 'Erro ao carregar configurações',
          description: err.message || 'Falha na resposta do servidor',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      console.error('Erro ao carregar configurações de integração:', err)
      toast({
        title: 'Erro de comunicação',
        description: 'Não foi possível carregar as configurações de integração.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setTestResult(null)
    setFallbackTestResult(null)
    setTsdbTestResult(null)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const payload: {
        provedor: ProvedorKey
        api_key?: string
        fallback_api_key?: string
        tsdb_api_key?: string
        ativo: boolean
      } = {
        provedor: selectedProvedor,
        ativo: ativoInput,
      }

      // Se o usuário digitou uma nova chave no input primário
      if (apiKeyInput.trim()) {
        payload.api_key = apiKeyInput.trim()
      }

      // Se o usuário digitou uma nova chave de contingência (Football-Data.org)
      if (fallbackApiKeyInput.trim()) {
        payload.fallback_api_key = fallbackApiKeyInput.trim()
      }

      // Se o usuário digitou uma nova chave para TheSportsDB (Sul-Americana / Libertadores)
      if (tsdbApiKeyInput.trim()) {
        payload.tsdb_api_key = tsdbApiKeyInput.trim()
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/config`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        },
      )

      if (res.ok) {
        const data = await res.json()
        toast({
          title: 'Configurações salvas!',
          description:
            'As chaves de API principal, de contingência e TheSportsDB foram gravadas com segurança no banco de dados.',
        })
        setConfig({
          provedor: data.provedor,
          hasKey: data.hasKey,
          hasDbKey: true,
          hasSecretFallback: config.hasSecretFallback,
          maskedKey: data.maskedKey,
          hasFallbackKey: data.hasFallbackKey,
          hasFallbackDbKey: data.hasFallbackKey,
          maskedFallbackKey: data.maskedFallbackKey,
          hasTsdbKey: data.hasTsdbKey,
          hasTsdbDbKey: data.hasTsdbDbKey,
          maskedTsdbKey: data.maskedTsdbKey,
          ativo: data.ativo,
        })
        setApiKeyInput('') // Limpa campo de edição
        setFallbackApiKeyInput('') // Limpa campo de edição
        setTsdbApiKeyInput('') // Limpa campo TheSportsDB
      } else {
        const err = await res.json().catch(() => ({}))
        toast({
          title: 'Erro ao salvar',
          description: err.message || 'Falha ao salvar no banco de dados',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      toast({
        title: 'Erro ao salvar',
        description: err instanceof Error ? err.message : 'Falha na requisição',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/test`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provedor: selectedProvedor,
            api_key: apiKeyInput.trim() || undefined,
          }),
        },
      )

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || 'Conexão testada com sucesso!',
        })
        toast({
          title: 'Conexão bem-sucedida! 🎉',
          description: data.message || 'API principal validada com êxito.',
        })
      } else {
        setTestResult({
          success: false,
          message: data.message || 'Falha ao conectar com o provedor.',
        })
        toast({
          title: data.rate_limited ? 'Limite da API atingido' : 'Falha no teste de conexão',
          description: data.message || 'Verifique a chave informada.',
          variant: data.rate_limited ? 'default' : 'destructive',
        })
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Erro de rede ou timeout.',
      })
    } finally {
      setTesting(false)
    }
  }

  // Teste de conexão específico para a chave secundária de contingência (Football-Data.org)
  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/limpar-cache`,
        {
          method: 'POST',
          headers,
        },
      )

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast({
          title: 'Cache limpo com sucesso! 🧹',
          description: data.message || 'Cache limpo — próxima busca será direto na API',
        })
      } else {
        toast({
          title: 'Erro ao limpar cache',
          description: data.error || data.message || 'Falha ao comunicar com o servidor',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      toast({
        title: 'Erro ao limpar cache',
        description: err instanceof Error ? err.message : 'Falha na requisição',
        variant: 'destructive',
      })
    } finally {
      setClearingCache(false)
    }
  }

  const handleTestFallbackConnection = async () => {
    setTestingFallback(true)
    setFallbackTestResult(null)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/test`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provedor: 'football_data',
            is_fallback: true,
            api_key: fallbackApiKeyInput.trim() || undefined,
          }),
        },
      )

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setFallbackTestResult({
          success: true,
          message: data.message || 'Conexão de contingência testada com sucesso!',
        })
        toast({
          title: 'Contingência Validada! 🛡️',
          description:
            'A chave secundária do Football-Data.org está funcionando e pronta para assumir.',
        })
      } else {
        setFallbackTestResult({
          success: false,
          message: data.message || 'Falha ao conectar com a Football-Data.org.',
        })
        toast({
          title: 'Falha no teste da contingência',
          description: data.message || 'Verifique o token do Football-Data.org.',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      setFallbackTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Erro de rede ou timeout.',
      })
    } finally {
      setTestingFallback(false)
    }
  }

  // Teste de conexão específico para TheSportsDB (Sul-Americana / Libertadores)
  const handleTestTsdbConnection = async () => {
    setTestingTsdb(true)
    setTsdbTestResult(null)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/placar-ao-vivo/test`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provedor: 'thesportsdb',
            api_key: tsdbApiKeyInput.trim() || undefined,
          }),
        },
      )

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setTsdbTestResult({
          success: true,
          message: data.message || 'Conexão com TheSportsDB validada com sucesso!',
        })
        toast({
          title: 'TheSportsDB Conectado! 🌎',
          description: 'A integração com TheSportsDB para CONMEBOL está operando.',
        })
      } else {
        setTsdbTestResult({
          success: false,
          message: data.message || 'Falha ao conectar com o TheSportsDB.',
        })
        toast({
          title: 'Falha no teste TheSportsDB',
          description: data.message || 'Verifique a chave ou conectividade.',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      setTsdbTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Erro de rede ou timeout.',
      })
    } finally {
      setTestingTsdb(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
        Acesso restrito ao administrador Douglas.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header com breadcrumb para Jogos e título */}
      <div className="flex flex-col justify-between gap-4 rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
              <Shield className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                  Configurações de Admin — Placar Ao Vivo & Contingência
                </h1>
                <Badge
                  variant="secondary"
                  className="border border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800"
                >
                  Banco de Dados Próprio
                </Badge>
              </div>
              <p className="text-xs text-[#64748B]">
                Gerencie as fontes de dados de futebol, configure a contingência automática para
                Football-Data.org e mantenha os placares ativos mesmo quando a API-Football estourar
                a cota diária de 100 requisições.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearCache}
            disabled={clearingCache || loading}
            className="h-8 rounded-lg border-rose-300 bg-rose-50/50 text-xs font-semibold text-rose-800 hover:bg-rose-100 hover:text-rose-900"
            title="Zerar caches em memória no servidor e forçar busca limpa na API"
          >
            {clearingCache ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-rose-700" />
                Limpando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-rose-700" />
                Limpar Cache do Servidor
              </>
            )}
          </Button>
          <Link to="/bolao/admin/jogos">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg border-slate-300 text-xs font-semibold text-[#0F2A43] hover:bg-slate-50"
            >
              Voltar para Gerenciar Jogos
            </Button>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadConfig}
            disabled={loading}
            className="h-8 text-xs text-slate-500 hover:text-slate-800"
            title="Recarregar configurações"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Grid com Formulário de Configuração e Guia dos Provedores */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Formulário Principal (7 cols) */}
        <div className="lg:col-span-7">
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
                <KeyRound className="h-5 w-5 text-emerald-600" />
                Provedor Principal & Chave de Contingência
              </CardTitle>
              <p className="text-xs text-[#64748B]">
                Defina o provedor primário e a chave secundária (fallback) para redirecionamento
                automático quando a cota gratuita da API-Football for excedida (Status 429).
              </p>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-xs text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#0F2A43]" />
                  Carregando configurações salvas...
                </div>
              ) : (
                <form onSubmit={handleSave} className="space-y-5">
                  {/* Status atual no banco */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-[#0F2A43]" />
                        <span className="font-semibold text-slate-700">Chave Principal:</span>
                        {config.hasDbKey ? (
                          <span className="font-mono font-bold text-emerald-700">
                            {config.maskedKey || 'Salva'}
                          </span>
                        ) : (
                          <span className="italic text-slate-400">Vazia</span>
                        )}
                      </div>
                      {config.hasDbKey ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-400 text-[10px]">
                          Pendente
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-emerald-600" />
                        <span className="font-semibold text-slate-700">Contingência (FD.org):</span>
                        {config.hasFallbackKey ? (
                          <span className="font-mono font-bold text-emerald-700">
                            {config.maskedFallbackKey || 'Salva'}
                          </span>
                        ) : (
                          <span className="italic text-slate-400">Vazia</span>
                        )}
                      </div>
                      {config.hasFallbackKey ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
                          Ativa
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-300 text-amber-700 text-[10px]"
                        >
                          Opcional
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Seleção do Provedor Primário */}
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-[#0F172A]">
                      Provedor Principal (Consultado Primeiro)
                    </Label>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {/* API-Football (Padrão com contingência automática) */}
                      <button
                        type="button"
                        onClick={() => setSelectedProvedor('api_football')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                          selectedProvedor === 'api_football'
                            ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xs font-bold text-[#0F172A]">API-Football</span>
                          <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800">
                            Principal
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Ampla cobertura de ligas. Se estourar 100 req/dia, chave secundária
                          assume.
                        </p>
                      </button>

                      {/* Football-Data.org */}
                      <button
                        type="button"
                        onClick={() => setSelectedProvedor('football_data')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                          selectedProvedor === 'football_data'
                            ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xs font-bold text-[#0F172A]">
                            Football-Data.org
                          </span>
                          <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[9px] font-bold text-blue-800">
                            Direto
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Usar Football-Data.org como fonte primária única de dados.
                        </p>
                      </button>

                      {/* TheSportsDB */}
                      <button
                        type="button"
                        onClick={() => setSelectedProvedor('thesportsdb')}
                        className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                          selectedProvedor === 'thesportsdb'
                            ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xs font-bold text-[#0F172A]">TheSportsDB</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-medium text-slate-600">
                            Grátis (3)
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Base livre em JSON (chave de teste pública 3).
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Campo de texto da Chave de API Principal */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="api-key-input" className="text-xs font-bold text-[#0F172A]">
                        Chave do Provedor Principal (
                        {selectedProvedor === 'api_football'
                          ? 'API-Football'
                          : selectedProvedor === 'football_data'
                            ? 'Football-Data.org'
                            : 'TheSportsDB'}
                        )
                      </Label>
                      {selectedProvedor === 'thesportsdb' && (
                        <span className="text-[11px] text-slate-500">
                          (Opcional para TheSportsDB; usa chave pública se vazio)
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <Input
                        id="api-key-input"
                        type={showKeyText ? 'text' : 'password'}
                        placeholder={
                          config.hasDbKey
                            ? `Chave principal salva (${config.maskedKey}). Deixe em branco para manter.`
                            : selectedProvedor === 'thesportsdb'
                              ? 'Ex: 3 (ou sua chave privada)'
                              : 'Cole sua API Key principal aqui...'
                        }
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        className="h-10 pr-10 font-mono text-xs border-[#CBD5E1] focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeyText(!showKeyText)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        title={showKeyText ? 'Ocultar' : 'Exibir'}
                      >
                        {showKeyText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Botão de Teste da Chave Principal */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[11px] text-slate-500">
                        Consultada primeiramente respeitando o cache do servidor.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={testing || saving}
                        className="h-7 border-slate-300 text-xs font-semibold text-[#0F2A43] hover:bg-slate-50"
                      >
                        {testing ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-slate-600" />
                            Testando...
                          </>
                        ) : (
                          <>
                            <Radio className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                            Testar Conexão Principal
                          </>
                        )}
                      </Button>
                    </div>

                    {testResult && (
                      <div
                        className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                          testResult.success
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-red-300 bg-red-50 text-red-900'
                        }`}
                      >
                        {testResult.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                        )}
                        <p className="leading-relaxed">{testResult.message}</p>
                      </div>
                    )}
                  </div>

                  {/* BLOCO DE CONTINGÊNCIA AUTOMÁTICA (FOOTBALL-DATA.ORG) */}
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-emerald-600" />
                        <Label
                          htmlFor="fallback-key-input"
                          className="text-xs font-bold text-emerald-950"
                        >
                          Chave Secundária de Contingência (Football-Data.org)
                        </Label>
                      </div>
                      <Badge className="bg-emerald-600 text-white font-semibold text-[10px]">
                        Fallback Automático
                      </Badge>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Quando a chamada para a API-Football retornar erro de cota excedida (Status
                      429 ou limite atingido), a consulta é automaticamente redirecionada para a
                      Football-Data.org utilizando esta chave.
                    </p>

                    <div className="relative">
                      <Input
                        id="fallback-key-input"
                        type={showFallbackKeyText ? 'text' : 'password'}
                        placeholder={
                          config.hasFallbackKey
                            ? `Chave de contingência salva (${config.maskedFallbackKey || 'Salva'}). Deixe em branco para manter.`
                            : 'Cole o token da Football-Data.org aqui (ex: a1b2c3d4...)'
                        }
                        value={fallbackApiKeyInput}
                        onChange={(e) => setFallbackApiKeyInput(e.target.value)}
                        className="h-10 pr-10 font-mono text-xs border-emerald-200 bg-white focus-visible:border-emerald-500 focus-visible:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFallbackKeyText(!showFallbackKeyText)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        title={showFallbackKeyText ? 'Ocultar' : 'Exibir'}
                      >
                        {showFallbackKeyText ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-emerald-800">
                        Chave gratuita enviada por e-mail no cadastro em football-data.org.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestFallbackConnection}
                        disabled={testingFallback || saving}
                        className="h-7 border-emerald-300 bg-white text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                      >
                        {testingFallback ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-emerald-700" />
                            Testando contingência...
                          </>
                        ) : (
                          <>
                            <Radio className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                            Testar Conexão de Contingência
                          </>
                        )}
                      </Button>
                    </div>

                    {fallbackTestResult && (
                      <div
                        className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                          fallbackTestResult.success
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-red-300 bg-red-50 text-red-900'
                        }`}
                      >
                        {fallbackTestResult.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                        )}
                        <p className="leading-relaxed">{fallbackTestResult.message}</p>
                      </div>
                    )}
                  </div>

                  {/* BLOCO DE COBERTURA CONMEBOL (THESPORTSDB) */}
                  <div className="rounded-xl border border-blue-300 bg-blue-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-blue-600" />
                        <Label htmlFor="tsdb-key-input" className="text-xs font-bold text-blue-950">
                          Chave TheSportsDB (Sul-Americana / Libertadores)
                        </Label>
                      </div>
                      <Badge className="bg-blue-600 text-white font-semibold text-[10px]">
                        CONMEBOL Fallback
                      </Badge>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Como a Football-Data.org não cobre a Copa Sul-Americana (ex.: Flamengo x
                      Independiente del Valle), o servidor consulta o TheSportsDB automaticamente
                      quando a aba CONMEBOL estiver ativa ou o provedor primário não cobrir essas
                      partidas.
                    </p>

                    <div className="relative">
                      <Input
                        id="tsdb-key-input"
                        type={showTsdbKeyText ? 'text' : 'password'}
                        placeholder={
                          config.hasTsdbKey
                            ? `Chave TheSportsDB salva (${config.maskedTsdbKey || 'Salva'}). Padrão "3" usado se em branco.`
                            : 'Chave TheSportsDB opcional (se em branco, usa a pública "3")'
                        }
                        value={tsdbApiKeyInput}
                        onChange={(e) => setTsdbApiKeyInput(e.target.value)}
                        className="h-10 pr-10 font-mono text-xs border-blue-200 bg-white focus-visible:border-blue-500 focus-visible:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTsdbKeyText(!showTsdbKeyText)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        title={showTsdbKeyText ? 'Ocultar' : 'Exibir'}
                      >
                        {showTsdbKeyText ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-blue-800">
                        Chave padrão pública "3" ativada automaticamente.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestTsdbConnection}
                        disabled={testingTsdb || saving}
                        className="h-7 border-blue-300 bg-white text-xs font-semibold text-blue-900 hover:bg-blue-50"
                      >
                        {testingTsdb ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-blue-700" />
                            Testando TheSportsDB...
                          </>
                        ) : (
                          <>
                            <Radio className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                            Testar Conexão TheSportsDB
                          </>
                        )}
                      </Button>
                    </div>

                    {tsdbTestResult && (
                      <div
                        className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                          tsdbTestResult.success
                            ? 'border-blue-300 bg-blue-50 text-blue-900'
                            : 'border-red-300 bg-red-50 text-red-900'
                        }`}
                      >
                        {tsdbTestResult.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                        )}
                        <p className="leading-relaxed">{tsdbTestResult.message}</p>
                      </div>
                    )}
                  </div>

                  {/* Toggle Ativo */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      id="chk-ativo-integ"
                      type="checkbox"
                      checked={ativoInput}
                      onChange={(e) => setAtivoInput(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <Label
                      htmlFor="chk-ativo-integ"
                      className="cursor-pointer text-xs font-medium text-slate-700"
                    >
                      Habilitar exibição do badge de placar ao vivo no Dashboard
                    </Label>
                  </div>

                  {/* Botões de Ação */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleClearCache}
                      disabled={clearingCache || saving}
                      className="h-10 rounded-lg border-rose-300 bg-rose-50/50 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                    >
                      {clearingCache ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin text-rose-700" />
                          Limpando caches do servidor...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 text-rose-700" />
                          Limpar Cache do Servidor
                        </>
                      )}
                    </Button>

                    <Button
                      type="submit"
                      disabled={saving || testing || testingFallback || clearingCache}
                      className="h-10 rounded-lg bg-[#0F2A43] px-6 text-xs font-semibold text-white shadow-xs hover:bg-[#1B3A5C]"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando chaves no banco...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Salvar Configurações
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Guia de Como Obter as Chaves Gratuitas (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <HelpCircle className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-base font-bold text-[#0F172A]">
                Como obter as chaves gratuitas
              </CardTitle>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Football-Data.org (Chave de contingência gratuita) */}
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3.5 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-emerald-700" />
                    Football-Data.org (Contingência)
                  </span>
                  <a
                    href="https://www.football-data.org/client/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                  >
                    <span>Criar conta grátis</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-700 leading-relaxed">
                  <strong>Cadastro 100% gratuito:</strong> Acesse o link, informe seu nome e e-mail.
                  O token da API chega diretamente na sua caixa de entrada em instantes. Cole esse
                  token no campo de contingência acima.
                </p>
                <div className="rounded bg-white/80 p-2 text-[11px] text-emerald-900 border border-emerald-200">
                  🛡️ <strong>Como funciona o fallback:</strong> O servidor tenta primeiro a
                  API-Football com cache severo (30m calendário / 5m ao vivo). Se ela retornar erro
                  429 (cota de 100 req diárias esgotada), o sistema consulta a Football-Data.org sem
                  interrupção para os usuários do bolão.
                </div>
              </div>

              {/* API-Football */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">API-Football (API-Sports)</span>
                  <a
                    href="https://www.api-football.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:underline"
                  >
                    <span>api-sports.io</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Plano gratuito inclui 100 requisições por dia. O sistema utiliza timeout curto
                  (8s), deduplicação (mínimo 10s) e revalidação sob demanda para poupar o consumo.
                </p>
              </div>

              {/* TheSportsDB */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-950">TheSportsDB</span>
                  <a
                    href="https://www.thesportsdb.com/free_sports_api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                  >
                    <span>Documentação</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Utiliza a chave pública gratuita (padrão <strong>3</strong>) sem necessidade de
                  cadastro complexo.
                </p>
              </div>
            </div>

            {/* Comportamento silencioso garantido */}
            <div className="mt-4 rounded-lg bg-slate-100 p-3 text-[11px] text-slate-600 leading-relaxed">
              <strong>Prioridade de exibição garantida:</strong> Sobrescrita manual do Admin Douglas
              → Dados da API ativa / contingência → Placar salvo no banco. Nunca é inventado 0x0
              falso, e se todas as APIs falharem os palpites e pontuações continuam 100% intactos.
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
