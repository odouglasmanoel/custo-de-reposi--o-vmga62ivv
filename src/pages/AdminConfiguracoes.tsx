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
  ativo: boolean
}

export default function AdminConfiguracoes() {
  const { user, isAdmin } = useAuth()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const [config, setConfig] = useState<ConfigState>({
    provedor: 'football_data',
    hasKey: false,
    hasDbKey: false,
    hasSecretFallback: false,
    maskedKey: '',
    ativo: true,
  })

  const [selectedProvedor, setSelectedProvedor] = useState<ProvedorKey>('football_data')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKeyText, setShowKeyText] = useState(false)
  const [ativoInput, setAtivoInput] = useState(true)

  // Status feedback do teste
  const [testResult, setTestResult] = useState<{
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
        setSelectedProvedor(data.provedor || 'football_data')
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
        ativo: boolean
      } = {
        provedor: selectedProvedor,
        ativo: ativoInput,
      }

      // Se o usuário digitou uma nova chave no input, envia para salvar
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
          description:
            'A chave da API e o provedor foram gravados no banco de dados com segurança.',
        })
        setConfig({
          provedor: data.provedor,
          hasKey: data.hasKey,
          hasDbKey: true,
          hasSecretFallback: config.hasSecretFallback,
          maskedKey: data.maskedKey,
          ativo: data.ativo,
        })
        setApiKeyInput('') // Limpa campo de edição para não deixar em aberto
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
          description: data.message || 'API externa validada com êxito.',
        })
      } else {
        setTestResult({
          success: false,
          message: data.message || 'Falha ao conectar com o provedor.',
        })
        toast({
          title: 'Falha no teste de conexão',
          description: data.message || 'Verifique a chave informada.',
          variant: 'destructive',
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
                  Configurações de Admin — Placar Ao Vivo
                </h1>
                <Badge
                  variant="secondary"
                  className="border border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800"
                >
                  Banco de Dados Próprio
                </Badge>
              </div>
              <p className="text-xs text-[#64748B]">
                Gerencie as fontes de dados de futebol e insira a API Key diretamente pelo
                aplicativo, sem depender de painéis externos.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                Integração do Placar Ao Vivo
              </CardTitle>
              <p className="text-xs text-[#64748B]">
                Escolha o provedor de dados de futebol e salve sua chave. O app consultará os
                placares ao vivo em tempo real nos jogos em andamento.
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
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-[#0F2A43]" />
                      <span className="font-semibold text-slate-700">Chave no banco de dados:</span>
                      {config.hasDbKey ? (
                        <span className="font-mono font-bold text-emerald-700">
                          {config.maskedKey || 'Chave salva'}
                        </span>
                      ) : (
                        <span className="italic text-slate-400">Nenhuma chave salva ainda</span>
                      )}
                    </div>

                    {config.hasDbKey ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                        Configurada
                      </Badge>
                    ) : config.hasSecretFallback ? (
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-800"
                        title="Há um secret legado configurado como fallback temporário"
                      >
                        Fallback Secrets Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-300 text-slate-500">
                        Não configurada
                      </Badge>
                    )}
                  </div>

                  {/* Seleção do Provedor */}
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-[#0F172A]">
                      Provedor de Dados de Futebol
                    </Label>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {/* Football-Data.org (Recomendada) */}
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
                          <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-black text-emerald-800">
                            Recomendada
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Plano gratuito com partidas do dia e placares ao vivo.
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
                          <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[9px] font-bold text-blue-800">
                            Sem chave / Grátis
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Base livre em JSON (chave de teste pública 3).
                        </p>
                      </button>

                      {/* API-Football (Legado / Fallback) */}
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
                          <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-medium text-slate-600">
                            Legado / Fallback
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Integração anterior via API-Sports ou RapidAPI.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Campo de texto da Chave de API */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="api-key-input" className="text-xs font-bold text-[#0F172A]">
                        Chave da API (API Key / Token)
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
                            ? `Chave salva (${config.maskedKey}). Deixe em branco para manter.`
                            : selectedProvedor === 'thesportsdb'
                              ? 'Ex: 3 (ou sua chave privada)'
                              : 'Cole sua API Key aqui...'
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

                    <p className="text-[11px] text-slate-500">
                      A chave fica armazenada com segurança no banco de dados e nunca é exposta
                      abertamente para os participantes comuns do bolão.
                    </p>
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

                  {/* Feedback do Teste de Conexão */}
                  {testResult && (
                    <div
                      className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
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
                      <div>
                        <p className="font-bold">
                          {testResult.success ? 'Conexão validada:' : 'Falha na conexão:'}
                        </p>
                        <p className="mt-0.5 leading-relaxed">{testResult.message}</p>
                      </div>
                    </div>
                  )}

                  {/* Botões de Ação */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTestConnection}
                      disabled={testing || saving}
                      className="h-10 border-slate-300 text-xs font-semibold text-[#0F2A43] hover:bg-slate-50"
                    >
                      {testing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin text-slate-600" />
                          Testando conexão...
                        </>
                      ) : (
                        <>
                          <Radio className="mr-2 h-4 w-4 text-emerald-600" />
                          Testar Conexão
                        </>
                      )}
                    </Button>

                    <Button
                      type="submit"
                      disabled={saving || testing}
                      className="h-10 rounded-lg bg-[#0F2A43] px-6 text-xs font-semibold text-white shadow-xs hover:bg-[#1B3A5C]"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
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
              {/* Football-Data.org */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950">1. Football-Data.org (Melhor)</span>
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
                <p className="text-slate-600 leading-relaxed">
                  Cadastre seu e-mail gratuitamente no site. A chave de API chega instantaneamente
                  por e-mail. Cole-a no campo acima para ativar partidas ao vivo e do dia.
                </p>
              </div>

              {/* TheSportsDB */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-950">2. TheSportsDB</span>
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
                  cadastro complexo. Também suporta chaves personalizadas caso você possua plano de
                  apoiador.
                </p>
              </div>

              {/* API-Football */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">3. API-Football (Fallback)</span>
                  <a
                    href="https://www.api-football.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:underline"
                  >
                    <span>API-Sports</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Mantida como opção para quem já utilizava plano via RapidAPI ou chave direta da
                  API-Sports.
                </p>
              </div>
            </div>

            {/* Comportamento silencioso garantido */}
            <div className="mt-4 rounded-lg bg-slate-100 p-3 text-[11px] text-slate-600 leading-relaxed">
              <strong>Nota sobre funcionamento:</strong> Se nenhuma chave estiver configurada ou se
              a API estiver temporariamente fora do ar, o aplicativo opera normalmente em silêncio:
              nenhum erro é exibido e os resultados oficiais continuam sendo lançados pelo
              administrador na tela de Gestão de Jogos.
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
