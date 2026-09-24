import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  KeyRound,
  Shield,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Radio,
  ExternalLink,
  HelpCircle,
  Database,
  RefreshCw,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'

interface ApiValidadaInfo {
  validada?: boolean
  timestamp?: string
  endpoint_testado?: string
  status_code?: number
}

interface ConfigState {
  provedor: 'api_football'
  hasKey: boolean
  hasDbKey: boolean
  hasSecretFallback: boolean
  maskedKey: string
  ativo: boolean
  api_validada?: ApiValidadaInfo | null
}

export default function AdminConfiguracoes() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [resettingApiCounter, setResettingApiCounter] = useState(false)

  const [config, setConfig] = useState<ConfigState>({
    provedor: 'api_football',
    hasKey: false,
    hasDbKey: false,
    hasSecretFallback: false,
    maskedKey: '',
    ativo: true,
  })

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKeyText, setShowKeyText] = useState(false)
  const [ativoInput, setAtivoInput] = useState(true)
  const [maxLimitInput, setMaxLimitInput] = useState('80')
  const [travaDesativadaInput, setTravaDesativadaInput] = useState(false)

  // Status feedback do teste
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [confirmTestOpen, setConfirmTestOpen] = useState(false)
  const [dailyUsageInfo, setDailyUsageInfo] = useState<{
    count: number
    max_limit: number
    trava_desativada?: boolean
    blocked?: boolean
    waiting_reset: boolean
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
        setConfig({
          provedor: 'api_football',
          hasKey: Boolean(data.hasKey),
          hasDbKey: Boolean(data.hasDbKey),
          hasSecretFallback: Boolean(data.hasSecretFallback),
          maskedKey: data.maskedKey || '',
          ativo: data.ativo !== false,
          api_validada: data.api_validada || null,
        })
        setAtivoInput(data.ativo !== false)
        if (data.usage) {
          setDailyUsageInfo(data.usage)
          setMaxLimitInput(String(data.usage.max_limit || 80))
          setTravaDesativadaInput(Boolean(data.usage.trava_desativada))
        }
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
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const parsedMaxLimit = parseInt(maxLimitInput, 10)
      const payload: {
        provedor: 'api_football'
        api_key?: string
        ativo: boolean
        max_limit?: number
        trava_desativada?: boolean
      } = {
        provedor: 'api_football',
        ativo: ativoInput,
        max_limit: isNaN(parsedMaxLimit) || parsedMaxLimit <= 0 ? 80 : parsedMaxLimit,
        trava_desativada: travaDesativadaInput,
      }

      if (apiKeyInput.trim()) {
        payload.api_key = apiKeyInput.trim()
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
          description: 'Configurações e limites da API-Football gravados com sucesso.',
        })
        setConfig({
          provedor: 'api_football',
          hasKey: Boolean(data.hasKey),
          hasDbKey: true,
          hasSecretFallback: config.hasSecretFallback,
          maskedKey: data.maskedKey,
          ativo: data.ativo,
        })
        setApiKeyInput('') // Limpa campo de edição
        await loadConfig()
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

  const handleResetApiCounter = async () => {
    setResettingApiCounter(true)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/admin/resetar-contador-api`,
        {
          method: 'POST',
          headers,
        },
      )

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast({
          title: 'Contador da API Resetado! 🔄',
          description:
            data.message ||
            'O contador diário de requisições foi zerado e o bloqueio removido imediatamente.',
        })
        if (data.usage) {
          setDailyUsageInfo(data.usage)
        }
        await loadConfig()
      } else {
        toast({
          title: 'Erro ao resetar contador',
          description: data.error || data.message || 'Falha na resposta do servidor',
          variant: 'destructive',
        })
      }
    } catch (err: unknown) {
      toast({
        title: 'Erro ao resetar contador',
        description: err instanceof Error ? err.message : 'Falha na requisição',
        variant: 'destructive',
      })
    } finally {
      setResettingApiCounter(false)
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
            provedor: 'api_football',
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
          description: data.message || 'API-Football validada com êxito.',
        })
      } else {
        setTestResult({
          success: false,
          message: data.message || 'Falha ao conectar com a API-Football.',
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
          description: data.message || 'Cache limpo — próxima busca será direto na API-Football',
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
            <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
              <Shield className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
                  Configurações de Admin — API-Football Exclusiva
                </h1>
                <Badge
                  variant="secondary"
                  className="border border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800"
                >
                  Fonte Única Oficial
                </Badge>
              </div>
              <p className="text-xs text-[#64748B]">
                A aplicação consome exclusivamente a API-Football (v3.football.api-sports.io) para
                placar ao vivo, eventos, escalações e cron de sincronização, sem contingências
                secundárias.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetApiCounter}
            disabled={resettingApiCounter || loading}
            className="h-8 rounded-lg border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 shadow-xs hover:bg-emerald-100"
            title="Zera o contador diário de requisições da API no banco e remove qualquer bloqueio imediatamente"
          >
            {resettingApiCounter ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-emerald-700" />
                Resetando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
                Resetar Contador Diário da API
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearCache}
            disabled={clearingCache || loading}
            className="h-8 rounded-lg border-rose-300 bg-rose-50/50 text-xs font-semibold text-rose-800 hover:bg-rose-100 hover:text-rose-900"
            title="Zerar caches em memória no servidor e forçar busca imediata na API"
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

      {/* Grid com Formulário de Configuração e Guia */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Formulário Principal (7 cols) */}
        <div className="lg:col-span-7">
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#0F172A]">
                <KeyRound className="h-5 w-5 text-emerald-600" />
                Chave da API-Football
              </CardTitle>
              <p className="text-xs text-[#64748B]">
                Configure a chave da API-Football (v3.football.api-sports.io). As requisições de
                jogos ao vivo e sincronização vão direto na API com cabeçalho{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">
                  x-apisports-key
                </code>
                .
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
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-[#0F2A43]" />
                        <span className="font-semibold text-slate-700">
                          Chave API-Football (Banco):
                        </span>
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
                          OK (Ativa)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-400 text-[10px]">
                          Pendente
                        </Badge>
                      )}
                    </div>

                    {/* Exibição do estado 'API validada' com timestamp persistido */}
                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-200/80 pt-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2
                          className={`h-3.5 w-3.5 ${
                            config.api_validada ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                        />
                        <span className="font-semibold text-slate-700">API validada:</span>
                        {config.api_validada ? (
                          <span className="text-emerald-700 font-medium">
                            Sim{' '}
                            {config.api_validada.timestamp && (
                              <span className="text-slate-500 font-normal">
                                ({new Date(config.api_validada.timestamp).toLocaleString('pt-BR')})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Não validada recentemente</span>
                        )}
                      </div>
                      {config.api_validada && (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-50 text-emerald-800 border-emerald-200 text-[9px] font-semibold"
                        >
                          Validada no Banco
                        </Badge>
                      )}
                    </div>

                    {/* Exibição do Contador de Requisições do Dia com Botão de Reset Integrado */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-700">Uso diário interno:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {dailyUsageInfo?.count ?? 0} / {dailyUsageInfo?.max_limit ?? 80} reqs
                        </span>
                        {dailyUsageInfo?.trava_desativada ? (
                          <Badge className="bg-amber-100 text-amber-800 text-[9px]">
                            Trava Desativada
                          </Badge>
                        ) : dailyUsageInfo && dailyUsageInfo.count >= dailyUsageInfo.max_limit ? (
                          <Badge variant="destructive" className="text-[9px]">
                            Limite Atingido
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 text-[9px]">
                            Liberado
                          </Badge>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleResetApiCounter}
                        disabled={resettingApiCounter || loading}
                        className="h-6 rounded border-emerald-300 bg-emerald-50 px-2 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100"
                        title="Zerar contador do dia atual e remover bloqueios"
                      >
                        {resettingApiCounter ? (
                          <Loader2 className="h-3 w-3 animate-spin text-emerald-700" />
                        ) : (
                          'Resetar Contador Diário da API'
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Campo de texto da Chave de API */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="api-key-input" className="text-xs font-bold text-[#0F172A]">
                        Chave API-Football (x-apisports-key)
                      </Label>
                    </div>

                    <div className="relative">
                      <Input
                        id="api-key-input"
                        type={showKeyText ? 'text' : 'password'}
                        placeholder={
                          config.hasDbKey
                            ? `Chave salva (${config.maskedKey}). Deixe em branco para manter.`
                            : 'Cole sua API Key do API-Sports / API-Football aqui...'
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

                    {/* Botão de Teste da Chave */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[11px] text-slate-500">
                        Dispara requisição direta em /status da API-Football.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (dailyUsageInfo && dailyUsageInfo.count >= 15) {
                            toast({
                              title: 'Limite Diário Atingido (15/15)',
                              description:
                                'A cota diária de segurança foi atingida hoje. O teste está bloqueado até o reset às 21h (00:00 UTC).',
                              variant: 'destructive',
                            })
                            return
                          }
                          setConfirmTestOpen(true)
                        }}
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
                            Testar Conexão Direta
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

                  {/* Configurações de Limite Diário e Trava de Segurança */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 space-y-3">
                    <div className="text-xs font-bold text-slate-800">
                      Controle da Trava Diária de Requisições
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div>
                        <Label
                          htmlFor="max-limit-input"
                          className="text-[11px] font-semibold text-slate-700"
                        >
                          Limite Máximo Diário (req/dia)
                        </Label>
                        <Input
                          id="max-limit-input"
                          type="number"
                          min="1"
                          max="100"
                          value={maxLimitInput}
                          onChange={(e) => setMaxLimitInput(e.target.value)}
                          className="mt-1 h-8 font-mono text-xs border-[#CBD5E1]"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">
                          Padrão: 80 req/dia (Cota total gratuita da API-Sports: 100/dia).
                        </p>
                      </div>

                      <div className="pt-2 sm:pt-0">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={travaDesativadaInput}
                            onChange={(e) => setTravaDesativadaInput(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                          />
                          <div>
                            <span className="text-xs font-semibold text-slate-800">
                              Desativar trava interna diária
                            </span>
                            <p className="text-[10px] text-slate-500">
                              Permite que requisições continuem mesmo acima do limite configurado
                              enquanto houver saldo real na API-Sports.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
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
                      Habilitar sincronização e badge de placar ao vivo no Bolão
                    </Label>
                  </div>

                  {/* Botões de Ação */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleResetApiCounter}
                        disabled={resettingApiCounter || saving}
                        className="h-10 rounded-lg border-emerald-300 bg-emerald-50 px-4 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                      >
                        {resettingApiCounter ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-700" />
                            Resetando contador...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 text-emerald-700" />
                            Resetar Contador Diário da API
                          </>
                        )}
                      </Button>

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
                    </div>

                    <Button
                      type="submit"
                      disabled={saving || testing || clearingCache || resettingApiCounter}
                      className="h-10 rounded-lg bg-[#0F2A43] px-6 text-xs font-semibold text-white shadow-xs hover:bg-[#1B3A5C]"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando no banco...
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

        {/* Painel lateral informativo */}
        <div className="space-y-4 lg:col-span-5">
          <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <HelpCircle className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base font-bold text-[#0F172A]">
                API-Football Exclusiva
              </CardTitle>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3.5 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    API-Football (v3.football.api-sports.io)
                  </span>
                  <a
                    href="https://dashboard.api-football.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                  >
                    <span>Painel API-Sports</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-700 leading-relaxed">
                  Todas as consultas de placares ao vivo, escalações (/fixtures/lineups) e eventos
                  saem diretamente para a API-Football com a chave salva. Todas as contingências e
                  APIs secundárias foram totalmente eliminadas do sistema.
                </p>
                <div className="rounded bg-white/80 p-2 text-[11px] text-emerald-900 border border-emerald-200">
                  ⚡ <strong>Sem caches longos:</strong> Não há retenção de 30min ou 5min para jogos
                  ao vivo. Apenas a proteção anti-spam leve de 60s por fixture contra cliques
                  repetidos.
                </div>
              </div>

              {/* Informações da sincronização */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 leading-relaxed space-y-2">
                <div>
                  <strong>Cron Ativo:</strong> <code>placar_ao_vivo_sync</code> roda a cada 10
                  minutos sincronizando os jogos do bolão e disparando escalações oficiais 1h antes
                  do pontapé inicial.
                </div>
                <div>
                  <strong>Antifalha Mantida:</strong> Jogos com{' '}
                  <code>resultado_finalizado = true</code> nunca são sobrescritos e pontuações
                  continuam intactas.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* AlertDialog de Confirmação de Consumo de Cota */}
      <AlertDialog open={confirmTestOpen} onOpenChange={setConfirmTestOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <AlertDialogTitle className="text-base font-bold text-slate-900">
                Confirmar Teste da API-Football
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-xs text-slate-600 leading-relaxed pt-2 space-y-2">
              <p>
                Este teste executa a validação direta de credenciais no endpoint{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">/status</code> da
                API-Football. Chamadas de teste /status são <strong>isentas da cota diária</strong>{' '}
                do Bolão e gravam o registro <code>api_validada</code> no banco.
              </p>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-900 font-medium">
                Trava de segurança: máx{' '}
                <strong>{dailyUsageInfo?.max_limit || 80} requisições de dados/dia</strong>.
                {dailyUsageInfo && (
                  <div className="mt-1 text-[11px] font-normal text-emerald-800">
                    Consumo de dados hoje:{' '}
                    <strong>
                      {dailyUsageInfo.count} / {dailyUsageInfo.max_limit}
                    </strong>
                    {dailyUsageInfo.trava_desativada && ' (trava desativada)'}.
                  </div>
                )}
              </div>
              <p>Deseja testar e validar a conexão agora?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmTestOpen(false)
                handleTestConnection()
              }}
              className="bg-[#0F2A43] hover:bg-[#1B3A5C] text-xs font-semibold text-white"
            >
              Sim, Testar Conexão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
