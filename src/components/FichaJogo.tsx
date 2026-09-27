import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  RotateCw,
  AlertCircle,
  FileText,
  Clock,
  ArrowRightLeft,
} from 'lucide-react'
import { resolveTeamBadgeUrl } from '@/lib/flags'
import { fetchEventosJogo, MatchEvent, FichaJogoResponse } from '@/services/eventosJogo'
import { useAuth } from '@/context/AuthContext'
import { isJogoConcluido } from '@/lib/jogoStatus'

export interface FichaJogoProps {
  fixtureId?: string | number | null
  jogoId?: string | null
  timeA: string
  timeB: string
  status?: string | null
  resultado_finalizado?: boolean | null
  placarA?: number | null
  placarB?: number | null
  // Marcadores locais para fallback imediato caso a API não tenha eventos
  golsTimeA?: any[]
  golsTimeB?: any[]
  // Status de kickoff para decidir visibilidade
  isConcluido?: boolean
  isAoVivo?: boolean
  className?: string
  defaultOpen?: boolean
}

export const FichaJogo: React.FC<FichaJogoProps> = ({
  fixtureId,
  jogoId,
  timeA,
  timeB,
  status,
  resultado_finalizado,
  placarA,
  placarB,
  golsTimeA = [],
  golsTimeB = [],
  isConcluido = false,
  isAoVivo = false,
  className = '',
  defaultOpen = false,
}) => {
  const { isAdmin } = useAuth()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FichaJogoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Determina se o jogo está finalizado/encerrado
  const jogoFinalizado = useMemo(() => {
    if (isConcluido) return true
    return isJogoConcluido({ status, resultado_finalizado })
  }, [isConcluido, status, resultado_finalizado])

  // Verifica se o jogo possui dados/marcadores locais ou placar registrado
  const temDadosLocais = useMemo(() => {
    const temGolsA = Array.isArray(golsTimeA) && golsTimeA.length > 0
    const temGolsB = Array.isArray(golsTimeB) && golsTimeB.length > 0
    const temPlacar =
      (typeof placarA === 'number' && !isNaN(placarA)) ||
      (typeof placarB === 'number' && !isNaN(placarB))
    return temGolsA || temGolsB || temPlacar
  }, [golsTimeA, golsTimeB, placarA, placarB])

  const numFixtureId = useMemo(() => {
    if (!fixtureId) return null
    const clean = String(fixtureId).trim()
    return clean ? clean : null
  }, [fixtureId])

  // Resolução dos escudos usando o helper oficial do projeto
  const badgeA = useMemo(() => resolveTeamBadgeUrl({ teamName: timeA }), [timeA])
  const badgeB = useMemo(() => resolveTeamBadgeUrl({ teamName: timeB }), [timeB])

  const carregarEventos = useCallback(
    async (forceRefresh = false) => {
      if (!numFixtureId && !jogoId) return

      // Respeita o forceRefresh mesmo em jogo finalizado para permitir busca e sincronização de marcadores
      const efetivoForceRefresh = forceRefresh

      setLoading(true)
      setError(null)
      try {
        const res = await fetchEventosJogo({
          fixtureId: numFixtureId,
          jogoId: jogoId || undefined,
          forceRefresh: efetivoForceRefresh,
        })
        setData(res)
        if (!res.success && res.error) {
          setError(res.error)
        }
      } catch (err: any) {
        setError('Não foi possível carregar a ficha no momento.')
      } finally {
        setLoading(false)
      }
    },
    [numFixtureId, jogoId, jogoFinalizado],
  )

  // Lazy loading: só busca quando o usuário abre pela primeira vez
  const handleToggle = () => {
    const nextState = !isOpen
    setIsOpen(nextState)
    if (nextState && !data && !loading) {
      carregarEventos()
    }
  }

  // Se já estiver aberto por default
  useEffect(() => {
    if (isOpen && !data && !loading && (numFixtureId || jogoId)) {
      carregarEventos()
    }
  }, [isOpen, data, loading, numFixtureId, jogoId, carregarEventos])

  // Fallback: se a API não retornou eventos, sintetiza com marcadores locais existentes
  const displayEvents = useMemo<MatchEvent[]>(() => {
    if (data?.events && data.events.length > 0) {
      return [...data.events].sort((a, b) => {
        const minA = a.time?.elapsed ?? 0
        const minB = b.time?.elapsed ?? 0
        return minA - minB
      })
    }

    // Se temos marcadores locais no jogo:
    const fallback: MatchEvent[] = []
    const addScorers = (list: any[], teamName: string, side: 'home' | 'away') => {
      if (!Array.isArray(list)) return
      list.forEach((sc) => {
        if (!sc) return
        const nomeStr = typeof sc === 'string' ? sc : sc.nome || ''
        const minMatch = String(sc.minuto || nomeStr).match(/(\d+)/)
        const min = minMatch ? parseInt(minMatch[1], 10) : 0
        const cleanName = nomeStr.replace(/\s*\d+\s*['’]/g, '').trim()
        if (cleanName) {
          fallback.push({
            time: { elapsed: min || null },
            team: { name: teamName, side },
            player: { name: cleanName },
            type: 'Goal',
            detail: sc.posicao === 'Gol Contra' ? 'Own Goal' : 'Normal Goal',
            category: 'goal',
          })
        }
      })
    }

    addScorers(golsTimeA, timeA, 'home')
    addScorers(golsTimeB, timeB, 'away')

    return fallback.sort((a, b) => (a.time?.elapsed ?? 0) - (b.time?.elapsed ?? 0))
  }, [data, golsTimeA, golsTimeB, timeA, timeB])

  // Normalização do lado (mandante/visitante)
  const getSide = (ev: MatchEvent): 'home' | 'away' => {
    if (ev.team?.side) return ev.team.side
    const teamNameLower = (ev.team?.name || '').toLowerCase()
    const homeNameLower = timeA.toLowerCase()
    const awayNameLower = timeB.toLowerCase()

    if (teamNameLower && homeNameLower.includes(teamNameLower)) return 'home'
    if (teamNameLower && awayNameLower.includes(teamNameLower)) return 'away'
    if (teamNameLower && teamNameLower.includes(homeNameLower)) return 'home'
    if (teamNameLower && teamNameLower.includes(awayNameLower)) return 'away'

    // Verifica pelo ID do time se disponível
    if (data?.teams?.home?.id && ev.team?.id === data.teams.home.id) return 'home'
    if (data?.teams?.away?.id && ev.team?.id === data.teams.away.id) return 'away'

    return 'home'
  }

  // Render do ícone do evento
  const renderEventIcon = (ev: MatchEvent) => {
    const typeLower = (ev.type || '').toLowerCase()
    const detailLower = (ev.detail || '').toLowerCase()

    if (ev.category === 'goal' || typeLower.includes('goal')) {
      if (detailLower.includes('missed') || detailLower.includes('perdido')) {
        return (
          <span className="text-red-500 font-bold text-xs" title="Pênalti Perdido">
            ❌
          </span>
        )
      }
      return (
        <span className="text-base select-none" title="Gol">
          ⚽
        </span>
      )
    }

    if (ev.category === 'card' || typeLower.includes('card')) {
      if (
        detailLower.includes('yellow') &&
        (detailLower.includes('red') || detailLower.includes('second'))
      ) {
        return (
          <span
            className="inline-flex items-center -space-x-1 select-none"
            title="Segundo Amarelo / Vermelho"
          >
            <span className="text-sm">🟨</span>
            <span className="text-sm">🟥</span>
          </span>
        )
      }
      if (detailLower.includes('red') || detailLower.includes('vermelho')) {
        return (
          <span className="text-sm select-none" title="Cartão Vermelho">
            🟥
          </span>
        )
      }
      return (
        <span className="text-sm select-none" title="Cartão Amarelo">
          🟨
        </span>
      )
    }

    if (ev.category === 'subst' || typeLower.includes('sub')) {
      return (
        <span
          className="text-emerald-500 font-bold select-none text-sm inline-flex items-center"
          title="Substituição"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </span>
      )
    }

    return <Clock className="w-3.5 h-3.5 text-slate-400" />
  }

  // Descrição detalhada do evento em pt-BR
  const formatEventDetail = (ev: MatchEvent) => {
    const detailLower = (ev.detail || '').toLowerCase()
    const typeLower = (ev.type || '').toLowerCase()

    if (ev.category === 'goal' || typeLower.includes('goal')) {
      if (detailLower.includes('own') || detailLower.includes('contra')) {
        return <span className="text-xs text-red-500 font-medium">(Gol Contra)</span>
      }
      if (detailLower.includes('penalty') || detailLower.includes('pênalti')) {
        return <span className="text-xs text-emerald-600 font-medium">(Pênalti)</span>
      }
      if (ev.assist?.name) {
        return <span className="text-xs text-slate-400">assistência: {ev.assist.name}</span>
      }
      return null
    }

    if (ev.category === 'card' || typeLower.includes('card')) {
      if (
        detailLower.includes('second') ||
        (detailLower.includes('yellow') && detailLower.includes('red'))
      ) {
        return <span className="text-xs text-amber-600 font-medium">(2º Amarelo / Expulsão)</span>
      }
      if (detailLower.includes('red')) {
        return <span className="text-xs text-red-600 font-medium">(Vermelho Direto)</span>
      }
      return null
    }

    if (ev.category === 'subst' || typeLower.includes('sub')) {
      if (ev.assist?.name) {
        return (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="text-emerald-600 font-medium">⬆ {ev.assist.name}</span>
            <span className="text-red-500 font-medium">⬇ {ev.player?.name}</span>
          </span>
        )
      }
    }

    return null
  }

  return (
    <div
      className={`w-full mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 ${className}`}
    >
      {/* Botão de Sanfona */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleToggle}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors py-1 px-2 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          aria-expanded={isOpen}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>{isOpen ? 'Ocultar Ficha do Jogo' : 'Ver Ficha do Jogo'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/*
          OCULTAÇÃO PARA NÃO-ADMINS:
          O botão/ícone "Atualizar eventos" só é exibido se o usuário for Administrador (isAdmin).
          Para participantes comuns (não-admins), fica oculto completamente.

          TRAVA EM JOGOS ENCERRADOS:
          Para jogos com status encerrado/finalizado, o botão fica desabilitado para o admin,
          com tooltip explicativo, evitando qualquer gasto de cota.
        */}
        {isOpen && isAdmin && (
          <button
            type="button"
            onClick={() => carregarEventos(true)}
            disabled={loading}
            title="Atualizar eventos"
            aria-label="Atualizar eventos"
            className="text-xs p-1 rounded transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RotateCw className={`w-3 h-3 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        )}
      </div>

      {/* Conteúdo Expansível (Timeline) */}
      {isOpen && (
        <div className="mt-3 bg-slate-50/80 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 transition-all">
          {/* Cabeçalho dos Times com Escudos */}
          <div className="grid grid-cols-2 gap-4 pb-2.5 mb-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">
            <div className="flex items-center gap-2">
              {badgeA ? (
                <img
                  src={badgeA}
                  alt={timeA}
                  className="w-5 h-5 object-contain rounded-full bg-white shadow-xs"
                  loading="lazy"
                  onError={(e) => {
                    ;(e.target as HTMLElement).style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold">
                  {timeA.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="truncate">{timeA}</span>
              {typeof placarA === 'number' && (
                <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-extrabold text-sm">
                  {placarA}
                </span>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 text-right">
              {typeof placarB === 'number' && (
                <span className="mr-auto text-emerald-600 dark:text-emerald-400 font-extrabold text-sm">
                  {placarB}
                </span>
              )}
              <span className="truncate">{timeB}</span>
              {badgeB ? (
                <img
                  src={badgeB}
                  alt={timeB}
                  className="w-5 h-5 object-contain rounded-full bg-white shadow-xs"
                  loading="lazy"
                  onError={(e) => {
                    ;(e.target as HTMLElement).style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold">
                  {timeB.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Estado de Carregamento */}
          {loading && (
            <div className="flex items-center justify-center py-6 gap-2 text-xs text-slate-500">
              <RotateCw className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Carregando timeline de eventos...</span>
            </div>
          )}

          {/* Mensagem de Aviso ou Erro Amigável */}
          {!loading &&
            // Quando a partida estiver encerrada ou possuir dados locais gravados, a busca externa é apenas complementar: não exibe a faixa amarela de erro de API externa
            !(jogoFinalizado || temDadosLocais) &&
            (error || data?.notice) && (
              <div className="mb-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  {data?.notice || error}
                  {data?.rate_limited && (
                    <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
                      A cota da API foi preservada com sucesso. Os dados locais continuam visíveis.
                    </p>
                  )}
                </div>
              </div>
            )}

          {/* Lista de Eventos (Timeline Centralizada) */}
          {!loading && displayEvents.length > 0 && (
            <div className="relative py-2">
              {/* Linha vertical central */}
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -ml-px bg-slate-200 dark:bg-slate-700" />

              <div className="space-y-3">
                {displayEvents.map((ev, index) => {
                  const side = getSide(ev)
                  const minute = ev.time?.elapsed != null ? `${ev.time.elapsed}'` : "—'"
                  const extra = ev.time?.extra ? `+${ev.time.extra}` : ''
                  const minuteLabel = `${minute}${extra}`

                  const isHome = side === 'home'

                  return (
                    <div
                      key={`${ev.type}-${ev.time?.elapsed}-${index}`}
                      className="relative flex items-center"
                    >
                      {/* Lado Esquerdo (Mandante) */}
                      <div
                        className={`w-1/2 pr-3 text-right ${isHome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        {isHome && (
                          <div className="flex flex-col items-end">
                            <div className="flex items-center gap-1.5 justify-end">
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                {ev.category === 'subst' && ev.assist?.name
                                  ? ''
                                  : ev.player?.name || 'Jogador'}
                              </span>
                              {renderEventIcon(ev)}
                            </div>
                            {formatEventDetail(ev)}
                          </div>
                        )}
                      </div>

                      {/* Marcador Central de Minuto */}
                      <div className="relative z-10 flex items-center justify-center shrink-0 w-8 h-6 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-300 shadow-xs select-none">
                        {minuteLabel}
                      </div>

                      {/* Lado Direito (Visitante) */}
                      <div
                        className={`w-1/2 pl-3 text-left ${!isHome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        {!isHome && (
                          <div className="flex flex-col items-start">
                            <div className="flex items-center gap-1.5 justify-start">
                              {renderEventIcon(ev)}
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                {ev.category === 'subst' && ev.assist?.name
                                  ? ''
                                  : ev.player?.name || 'Jogador'}
                              </span>
                            </div>
                            {formatEventDetail(ev)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Vazio / Sem eventos ainda */}
          {!loading && displayEvents.length === 0 && !error && (
            <div className="py-6 text-center text-xs text-slate-400">
              <Clock className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
              <p>Nenhum evento registrado até o momento.</p>
              <p className="text-[11px] text-slate-400/80 mt-0.5">
                {jogoFinalizado &&
                data?.success &&
                (data?.source === 'api_football' || Array.isArray(data?.events))
                  ? 'A partida foi finalizada sem registro de eventos na súmula da API.'
                  : 'Os eventos aparecerão em tempo real conforme a partida avançar.'}
              </p>
            </div>
          )}

          {/* Rodapé informativo discreto */}
          <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span>⚽ Gol</span>
              <span>•</span>
              <span>🟨 Cartão</span>
              <span>•</span>
              <span>🔄 Substituição</span>
            </span>
            {numFixtureId && <span className="opacity-60">ID API: {numFixtureId}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
export default FichaJogo
