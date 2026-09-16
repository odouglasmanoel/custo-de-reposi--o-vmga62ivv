import { useState, useEffect } from 'react'
import {
  History,
  Trophy,
  Calendar,
  AlertCircle,
  Loader2,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Participante, Jogo, Palpite } from '@/types/bolao'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDataBR, formatHoraBR, formatDateTimeBR } from '@/lib/dateUtils'

export default function Historico() {
  const [boloes, setBoloes] = useState<Bolao[]>([])
  const [selectedBolao, setSelectedBolao] = useState<Bolao | null>(null)

  const [participantes, setParticipantes] = useState<Participante[]>([])
  const [jogos, setJogos] = useState<Jogo[]>([])
  const [palpites, setPalpites] = useState<Palpite[]>([])

  const [loadingBoloes, setLoadingBoloes] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Load all available boloes
  useEffect(() => {
    const fetchBoloes = async () => {
      try {
        const records = await pb.collection('boloes').getFullList<Bolao>({
          sort: 'nome',
        })
        setBoloes(records)
        if (records.length > 0) {
          setSelectedBolao(records[0])
        }
      } catch (err) {
        console.error('Erro ao listar bolões do histórico:', err)
      } finally {
        setLoadingBoloes(false)
      }
    }
    fetchBoloes()
  }, [])

  // Load details for selected pool
  useEffect(() => {
    if (!selectedBolao) return

    const loadPoolData = async () => {
      setLoadingDetails(true)
      try {
        const [parts, games, bets] = await Promise.all([
          pb.collection('participantes').getFullList<Participante>({
            filter: `bolao = '${selectedBolao.id}'`,
            sort: '-pontuacao_total,nome',
          }),
          pb.collection('jogos').getFullList<Jogo>({
            filter: `bolao = '${selectedBolao.id}'`,
            sort: 'data,hora',
          }),
          pb.collection('palpites').getFullList<Palpite>({
            filter: `bolao = '${selectedBolao.id}'`,
          }),
        ])
        setParticipantes(parts)
        setJogos(games)
        setPalpites(bets)
      } catch (err) {
        console.error('Erro ao carregar detalhes do bolão selecionado:', err)
      } finally {
        setLoadingDetails(false)
      }
    }

    loadPoolData()
  }, [selectedBolao])

  const getPositionBadge = (index: number) => {
    if (index === 0) return { bg: 'bg-[#F59E0B] text-slate-950', text: '1º', trophy: '🏆' }
    if (index === 1) return { bg: 'bg-[#94A3B8] text-white', text: '2º', trophy: '🥈' }
    if (index === 2) return { bg: 'bg-[#B45309] text-white', text: '3º', trophy: '🥉' }
    return { bg: 'bg-[#0F2A43] text-white', text: `${index + 1}º`, trophy: '' }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[14px] border border-[#E2E8F0] bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
            <History className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
              Banco de Dados Histórico
            </h1>
            <p className="text-xs text-[#64748B]">
              Consulta de campeonatos anteriores. Módulo dinâmico preparado para visualização de
              edições passadas.
            </p>
          </div>
        </div>
      </div>

      {/* Mandatory note banner */}
      <Alert className="border-blue-200 bg-blue-50/70 text-blue-900">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-xs font-semibold text-blue-800">
          O arquivo da Copa do Mundo será integrado posteriormente.
        </AlertDescription>
      </Alert>

      {/* Pool Cards Grid */}
      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
          Campeonatos Cadastrados ({boloes.length})
        </h2>

        {loadingBoloes ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Carregando lista de bolões...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {boloes.map((b) => {
              const isSelected = selectedBolao?.id === b.id

              return (
                <Card
                  key={b.id}
                  className={`cursor-pointer rounded-[14px] border p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                    isSelected
                      ? 'border-[#0F2A43] bg-white ring-2 ring-[#0F2A43]/20 shadow-sm'
                      : 'border-[#E2E8F0] bg-white'
                  }`}
                  onClick={() => setSelectedBolao(b)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-[#0F172A]">{b.nome}</h3>
                      <p className="mt-1 text-[11px] text-[#64748B]">
                        {b.ultima_atualizacao
                          ? `Atualizado em: ${formatDateTimeBR(b.ultima_atualizacao)}`
                          : 'Sem data de atualização'}
                      </p>
                    </div>

                    <Badge className="bg-emerald-100 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100">
                      Ativo
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500">
                      {isSelected ? 'Visualizando' : 'Clique para ver'}
                    </span>
                    <Button
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      className={`h-7 px-2.5 text-xs font-semibold ${
                        isSelected
                          ? 'bg-[#0F2A43] text-white hover:bg-[#1B3A5C]'
                          : 'border-slate-300 text-slate-700'
                      }`}
                    >
                      Ver Detalhes
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Pool Detail View: Tabs for Classificação and Resultados */}
      {selectedBolao && (
        <Card className="rounded-[14px] border-[#E2E8F0] bg-white p-6 shadow-xs">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-xl font-bold text-[#0F172A]">Detalhes: {selectedBolao.nome}</h2>
              <p className="text-xs text-[#64748B]">
                Dados consolidados no banco de dados da Skip Cloud (somente leitura).
              </p>
            </div>
            <Badge variant="outline" className="border-slate-300 text-xs text-slate-700">
              {jogos.length} jogos registrados
            </Badge>
          </div>

          {loadingDetails ? (
            <div className="flex min-h-[250px] items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-[#0F2A43]" />
            </div>
          ) : (
            <Tabs defaultValue="classificacao" className="w-full">
              <TabsList className="grid w-full grid-cols-2 max-w-sm bg-slate-100 p-1 mb-6 rounded-lg">
                <TabsTrigger
                  value="classificacao"
                  className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#0F2A43] data-[state=active]:shadow-xs"
                >
                  Classificação
                </TabsTrigger>
                <TabsTrigger
                  value="resultados"
                  className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#0F2A43] data-[state=active]:shadow-xs"
                >
                  Resultados dos Jogos
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Classificação */}
              <TabsContent value="classificacao" className="space-y-4">
                <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {participantes.map((part, index) => {
                    const badge = getPositionBadge(index)

                    return (
                      <div
                        key={part.id}
                        className={`flex items-center justify-between px-5 py-4 ${
                          index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-xs ${badge.bg}`}
                          >
                            {badge.text}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-[#0F172A]">{part.nome}</span>
                            {index === 0 && <span className="ml-1 text-sm">🏆</span>}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-lg font-black text-[#0F2A43]">
                            {part.pontuacao_total}
                          </span>
                          <span className="ml-1 text-xs font-medium text-slate-500">pontos</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TabsContent>

              {/* Tab 2: Resultados */}
              <TabsContent value="resultados" className="space-y-4">
                {jogos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-xs text-slate-500">
                    Nenhum jogo cadastrado para esta edição histórica. As planilhas históricas devem
                    ser importadas via painel da Skip Cloud / PocketBase.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                    {jogos.map((jogo) => {
                      const gameBets = palpites.filter((p) => p.jogo === jogo.id)

                      return (
                        <div key={jogo.id} className="p-4 bg-white hover:bg-slate-50/70">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#0F172A]">
                                {jogo.time_a}
                              </span>
                              <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-black text-white">
                                {jogo.resultado_finalizado && jogo.placar_a !== null
                                  ? `${jogo.placar_a} x ${jogo.placar_b}`
                                  : 'A definir'}
                              </span>
                              <span className="font-bold text-sm text-[#0F172A]">
                                {jogo.time_b}
                              </span>
                            </div>

                            <span className="text-[11px] text-slate-500">
                              {formatDataBR(jogo.data)} às {formatHoraBR(jogo.hora)}
                            </span>
                          </div>

                          {/* Goal scorers if any */}
                          {((Array.isArray(jogo.gols_time_a) && jogo.gols_time_a.length > 0) ||
                            (Array.isArray(jogo.gols_time_b) && jogo.gols_time_b.length > 0)) && (
                            <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded">
                              <span className="font-semibold text-slate-700">Gols reais: </span>
                              {[
                                ...(Array.isArray(jogo.gols_time_a)
                                  ? jogo.gols_time_a.map((g) => `${g.nome} (${g.posicao})`)
                                  : []),
                                ...(Array.isArray(jogo.gols_time_b)
                                  ? jogo.gols_time_b.map((g) => `${g.nome} (${g.posicao})`)
                                  : []),
                              ].join(', ')}
                            </div>
                          )}

                          {/* Per-participant predictions for this game */}
                          {gameBets.length > 0 && (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {gameBets.map((bet) => {
                                const part = participantes.find((p) => p.id === bet.participante)
                                return (
                                  <div
                                    key={bet.id}
                                    className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                                  >
                                    <div className="font-bold text-slate-800">
                                      {part?.nome || 'Participante'}
                                    </div>
                                    <div className="text-[11px] text-slate-600">
                                      Palpite: {bet.placar_a} x {bet.placar_b}
                                    </div>
                                    <div className="mt-1 font-semibold text-emerald-700">
                                      +{bet.pontuacao_jogo} pts
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </Card>
      )}
    </div>
  )
}
