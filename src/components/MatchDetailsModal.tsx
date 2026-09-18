import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, RefreshCw, Shield, Users, HelpCircle } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { isFixtureLive } from '@/lib/apiFootballMatcher'
import { fetchGameLineup, LineupResponse, LineupTeam } from '@/services/escalacoes'
import type { DayFixture } from '@/pages/JogosDoDia'

export interface MatchEventItem {
  time?: {
    elapsed?: number | null
    extra?: number | null
  }
  team?: {
    id?: string | number | null
    name?: string | null
    logo?: string | null
  }
  player?: {
    id?: string | number | null
    name?: string | null
  }
  assist?: {
    id?: string | number | null
    name?: string | null
  }
  type?: string | null // 'Goal' | 'Card' | 'subst' | etc.
  detail?: string | null // 'Normal Goal' | 'Yellow Card' | 'Red Card' | 'Substitution 1' | etc.
  comments?: string | null
}

interface MatchDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  match: DayFixture | null
}

// -------------------------------------------------------------
// CACHE LOCAL EM MEMÓRIA DE FICHAS DETALHADAS (MATCH DETAILS)
// Evita requisições de rede repetitivas ao clicar consecutivamente
// em "Exibir Detalhes". TTL: 15s para ao vivo, 30 min para agendados/finalizados.
// -------------------------------------------------------------
interface CachedDetailsEntry {
  events: MatchEventItem[]
  timestamp: number
  isLive: boolean
}

const matchDetailsMemoryCache = new Map<string, CachedDetailsEntry>()

const getMatchDetailsCacheKey = (match: DayFixture | null): string => {
  if (!match) return ''
  const fixId = match.fixture?.id ? String(match.fixture.id).trim() : ''
  if (fixId) return `details_${fixId}`
  const h = (match.teams?.home?.name || '').trim().toLowerCase()
  const a = (match.teams?.away?.name || '').trim().toLowerCase()
  const d = (match.fixture?.date || '').split('T')[0] || ''
  return `details_${h}__${a}__${d}`
}

export function MatchDetailsModal({ isOpen, onClose, match }: MatchDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'escalacoes'>('timeline')
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<MatchEventItem[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadedFixtureId, setLoadedFixtureId] = useState<string | number | null>(null)

  // Estado das Escalações Integradas no Modal
  const [lineupLoading, setLineupLoading] = useState(false)
  const [lineup, setLineup] = useState<LineupResponse | null>(null)
  const [lineupTab, setLineupTab] = useState<'home' | 'away'>('home')

  const fetchDetails = useCallback(
    async (currentMatch: DayFixture, silent = false, force = false) => {
      if (!currentMatch) return
      const fixtureId = currentMatch.fixture?.id
      const timeA = currentMatch.teams?.home?.name || ''
      const timeB = currentMatch.teams?.away?.name || ''
      const rawDate = currentMatch.fixture?.date || ''
      const datePart = rawDate.split('T')[0] || ''
      const st = (currentMatch.fixture?.status?.short || '').toUpperCase().trim()
      const live = Boolean(currentMatch.isLive || isFixtureLive(st))

      const cacheKey = getMatchDetailsCacheKey(currentMatch)
      const now = Date.now()

      // 1. Verificação no cache em memória para evitar chamadas de rede redundantes
      if (!force && cacheKey && matchDetailsMemoryCache.has(cacheKey)) {
        const cached = matchDetailsMemoryCache.get(cacheKey)!
        const maxAge = cached.isLive ? 15000 : 30 * 60 * 1000
        if (now - cached.timestamp < maxAge) {
          setEvents(cached.events)
          setLoadedFixtureId(fixtureId)
          setErrorMessage(null)
          return
        }
      }

      if (!silent) {
        setLoading(true)
        setErrorMessage(null)
      }

      try {
        const headers: Record<string, string> = {}
        if (pb.authStore.token) {
          headers['Authorization'] = pb.authStore.token
        }

        const queryParams = new URLSearchParams()
        if (fixtureId) queryParams.set('fixture_id', String(fixtureId))
        if (timeA) queryParams.set('time_a', timeA)
        if (timeB) queryParams.set('time_b', timeB)
        if (datePart) queryParams.set('data', datePart)
        if (st) queryParams.set('status', st)
        if (live) queryParams.set('isLive', 'true')
        if (silent || force) queryParams.set('refresh', '1')

        const url = `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/detalhes-partida?${queryParams.toString()}`
        const res = await fetch(url, { headers })

        if (!res.ok) {
          throw new Error(`Erro na consulta (${res.status})`)
        }

        const data = await res.json()
        const rawEvents: MatchEventItem[] = Array.isArray(data.events) ? data.events : []

        let resolvedEvents = rawEvents
        // Se a resposta vier vazia e a partida já tiver scorers embutidos, usa os scorers como fallback
        if (
          resolvedEvents.length === 0 &&
          Array.isArray(currentMatch.scorers) &&
          currentMatch.scorers.length > 0
        ) {
          resolvedEvents = currentMatch.scorers.map((sc) => ({
            time: { elapsed: sc.minute ?? null, extra: sc.extraMinute ?? null },
            team: {
              id: sc.teamId ?? null,
              name:
                sc.teamName ??
                (sc.teamSide === 'home'
                  ? currentMatch.teams?.home?.name || ''
                  : currentMatch.teams?.away?.name || ''),
            },
            player: { name: sc.name },
            type: 'Goal',
            detail: 'Normal Goal',
          }))
        }

        setEvents(resolvedEvents)
        setLoadedFixtureId(fixtureId)

        // Salva no cache local em memória
        if (cacheKey) {
          matchDetailsMemoryCache.set(cacheKey, {
            events: resolvedEvents,
            timestamp: now,
            isLive: live,
          })
        }
      } catch (err: any) {
        // Fallback local gracioso se a partida já contiver scorers
        if (Array.isArray(currentMatch.scorers) && currentMatch.scorers.length > 0) {
          const fallbackGols: MatchEventItem[] = currentMatch.scorers.map((sc) => ({
            time: { elapsed: sc.minute ?? null, extra: sc.extraMinute ?? null },
            team: {
              name:
                sc.teamName ??
                (sc.teamSide === 'home'
                  ? currentMatch.teams?.home?.name || ''
                  : currentMatch.teams?.away?.name || ''),
            },
            player: { name: sc.name },
            type: 'Goal',
            detail: 'Normal Goal',
          }))
          setEvents(fallbackGols)
          setLoadedFixtureId(fixtureId)
        } else {
          setErrorMessage(err?.message || 'Não foi possível carregar os detalhes da partida.')
        }
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  // Busca de escalação sob demanda para a aba "Escalações"
  const loadModalLineup = useCallback(async (currentMatch: DayFixture, force = false) => {
    if (!currentMatch) return
    setLineupLoading(true)
    try {
      const rawDate = currentMatch.fixture?.date || ''
      const datePart = rawDate.split('T')[0] || ''
      const fixId = currentMatch.fixture?.id ? String(currentMatch.fixture.id) : undefined

      const res = await fetchGameLineup({
        jogoId: fixId || 'dia_match',
        fixtureId: fixId,
        timeA: currentMatch.teams?.home?.name || '',
        timeB: currentMatch.teams?.away?.name || '',
        data: datePart,
        forceRefresh: force,
      })
      setLineup(res)
    } catch (e) {
      console.warn('Erro ao carregar escalação no modal:', e)
    } finally {
      setLineupLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && match) {
      if (loadedFixtureId !== match.fixture?.id) {
        setEvents([])
        setErrorMessage(null)
        setLineup(null)
        setActiveTab('timeline')
      }
      fetchDetails(match, false, false)
    } else if (!isOpen) {
      setEvents([])
      setErrorMessage(null)
      setLoadedFixtureId(null)
      setLineup(null)
    }
  }, [isOpen, match, loadedFixtureId, fetchDetails])

  // Carrega escalação quando o usuário alternar para a aba 'escalacoes'
  useEffect(() => {
    if (isOpen && match && activeTab === 'escalacoes' && !lineup && !lineupLoading) {
      loadModalLineup(match, false)
    }
  }, [isOpen, match, activeTab, lineup, lineupLoading, loadModalLineup])

  // Revalidação periódica de 35s enquanto o modal estiver aberto E o jogo for ao vivo
  useEffect(() => {
    if (!isOpen || !match) return

    const st = (match.fixture?.status?.short || '').toUpperCase().trim()
    const isLiveGame = Boolean(match.isLive || isFixtureLive(st))

    if (!isLiveGame) return

    const intervalId = setInterval(() => {
      fetchDetails(match, true, true)
      if (activeTab === 'escalacoes') {
        loadModalLineup(match, false)
      }
    }, 35000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isOpen, match, activeTab, fetchDetails, loadModalLineup])

  if (!match) return null

  const homeName = match.teams?.home?.name || 'Mandante'
  const awayName = match.teams?.away?.name || 'Visitante'
  const homeScore = match.goals?.home ?? '-'
  const awayScore = match.goals?.away ?? '-'
  const isFinished = ['FT', 'AET', 'PEN', 'FINISHED'].includes(
    (match.fixture?.status?.short || '').toUpperCase(),
  )
  const isLive = Boolean(match.isLive)

  // Separar e formatar os eventos
  const renderEventItem = (ev: MatchEventItem, idx: number) => {
    const elapsed = ev.time?.elapsed
    const extra = ev.time?.extra
    const minuteDisplay = elapsed != null ? (extra ? `${elapsed}+${extra}'` : `${elapsed}'`) : ''

    const typeLower = (ev.type || '').toLowerCase()
    const detailLower = (ev.detail || '').toLowerCase()
    const playerName = ev.player?.name?.trim() || ''
    const assistOrIn = ev.assist?.name?.trim() || ''

    let icon = '⚽'
    let eventTitle = playerName || 'Gol'
    let subInfo: string | null = null

    if (
      typeLower.includes('card') ||
      detailLower.includes('card') ||
      detailLower.includes('yellow') ||
      detailLower.includes('red')
    ) {
      const isRed = detailLower.includes('red')
      icon = isRed ? '🟥' : '🟨'
      eventTitle = playerName ? `${playerName}` : isRed ? 'Cartão Vermelho' : 'Cartão Amarelo'
      subInfo = isRed ? 'Cartão Vermelho' : 'Cartão Amarelo'
    } else if (typeLower.includes('sub') || detailLower.includes('sub')) {
      icon = '🔄'
      // Na API-Football: player é quem sai, assist é quem entra (ou vice-versa dependendo do formato)
      if (playerName && assistOrIn) {
        eventTitle = `Entra: ${assistOrIn}`
        subInfo = `Sai: ${playerName}`
      } else {
        eventTitle = playerName || assistOrIn || 'Substituição'
        subInfo = 'Substituição'
      }
    } else {
      // Gols
      icon = '⚽'
      const isOwn = detailLower.includes('own') || detailLower.includes('contra')
      const isPen = detailLower.includes('penal')
      if (isOwn) {
        eventTitle = playerName ? `${playerName} (contra)` : 'Gol Contra'
      } else if (isPen) {
        eventTitle = playerName ? `${playerName} (pênalti)` : 'Gol de Pênalti'
      } else {
        eventTitle = playerName || 'Gol'
      }
      if (assistOrIn && !isOwn) {
        subInfo = `Assistência: ${assistOrIn}`
      }
    }

    // Identifica se é do time mandante ou visitante
    const teamName = ev.team?.name || ''
    const isHome =
      teamName &&
      homeName &&
      teamName.toLowerCase().includes(homeName.toLowerCase().substring(0, 4))
    const isAway =
      teamName &&
      awayName &&
      teamName.toLowerCase().includes(awayName.toLowerCase().substring(0, 4))

    return (
      <div
        key={idx}
        className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white p-2.5 shadow-2xs hover:border-slate-200 transition"
      >
        <span className="text-lg shrink-0" role="img" aria-label="evento">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-slate-800 truncate">{eventTitle}</span>
            {teamName && (
              <Badge
                variant="outline"
                className={`text-[9px] px-1.5 py-0 h-4 font-normal ${
                  isHome
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : isAway
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'text-slate-500'
                }`}
              >
                {teamName}
              </Badge>
            )}
          </div>
          {subInfo && <p className="text-[11px] text-slate-500 truncate mt-0.5">{subInfo}</p>}
        </div>
        {minuteDisplay && (
          <span className="shrink-0 font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-sm">
            {minuteDisplay}
          </span>
        )}
      </div>
    )
  }

  // Filtragem dos eventos em categorias
  const golsList = events.filter((ev) => {
    const t = (ev.type || '').toLowerCase()
    const d = (ev.detail || '').toLowerCase()
    return t.includes('goal') || d.includes('goal') || (!t.includes('card') && !t.includes('sub'))
  })

  const cartoesList = events.filter((ev) => {
    const t = (ev.type || '').toLowerCase()
    const d = (ev.detail || '').toLowerCase()
    return t.includes('card') || d.includes('card') || d.includes('yellow') || d.includes('red')
  })

  const subsList = events.filter((ev) => {
    const t = (ev.type || '').toLowerCase()
    const d = (ev.detail || '').toLowerCase()
    return t.includes('sub') || d.includes('sub')
  })

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] p-0 overflow-hidden rounded-xl border border-slate-200 shadow-2xl bg-white">
        {/* Top Header com Placar e Times */}
        <div className="bg-[#0F2A43] text-white p-5 sm:p-6">
          <DialogHeader className="text-left mb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                {match.league?.name || 'Futebol'}
                {match.league?.round ? ` • ${match.league.round}` : ''}
              </span>
              {isLive ? (
                <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold">
                  AO VIVO {match.fixture?.status?.elapsed ? `${match.fixture.status.elapsed}'` : ''}
                </Badge>
              ) : isFinished ? (
                <Badge variant="secondary" className="bg-white/20 text-white text-[10px] font-bold">
                  Finalizado
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-white/20 text-white text-[10px] font-bold">
                  {match.fixture?.status?.short || 'Agendado'}
                </Badge>
              )}
            </div>
            <DialogTitle className="sr-only">
              Detalhes de {homeName} x {awayName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Linha do tempo e eventos da partida de futebol
            </DialogDescription>
          </DialogHeader>

          {/* Placar Confronto */}
          <div className="flex items-center justify-between gap-3 pt-1">
            {/* Home */}
            <div className="flex-1 flex flex-col items-center text-center">
              {match.teams?.home?.logo ? (
                <img
                  src={match.teams.home.logo}
                  alt={homeName}
                  className="h-12 w-12 object-contain mb-1.5"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center mb-1.5">
                  <Shield className="h-6 w-6 text-white/70" />
                </div>
              )}
              <span className="font-bold text-sm leading-tight text-white line-clamp-2">
                {homeName}
              </span>
            </div>

            {/* Score */}
            <div className="flex flex-col items-center px-3">
              <div className="flex items-center gap-2 font-mono text-2xl sm:text-3xl font-black bg-white/10 px-4 py-1.5 rounded-lg border border-white/15">
                <span>{homeScore}</span>
                <span className="text-white/60">:</span>
                <span>{awayScore}</span>
              </div>
              <span className="text-[10px] font-medium text-slate-300 mt-1">
                {match.fixture?.status?.long || 'Ficha do Jogo'}
              </span>
            </div>

            {/* Away */}
            <div className="flex-1 flex flex-col items-center text-center">
              {match.teams?.away?.logo ? (
                <img
                  src={match.teams.away.logo}
                  alt={awayName}
                  className="h-12 w-12 object-contain mb-1.5"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center mb-1.5">
                  <Shield className="h-6 w-6 text-white/70" />
                </div>
              )}
              <span className="font-bold text-sm leading-tight text-white line-clamp-2">
                {awayName}
              </span>
            </div>
          </div>

          {/* Abas Superiores: Lances e Ficha vs Escalações */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                activeTab === 'timeline'
                  ? 'bg-white text-[#0F2A43] shadow-xs'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <span>⚽</span> Lances e Ficha
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('escalacoes')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                activeTab === 'escalacoes'
                  ? 'bg-white text-[#0F2A43] shadow-xs'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <Users className="h-3.5 w-3.5" /> Escalações
              {lineup?.status === 'confirmada' && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>
        </div>

        {/* Conteúdo dinâmico de acordo com a aba ativa */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-5 bg-slate-50/50">
          {activeTab === 'timeline' ? (
            /* ABA 1: LANCES E FICHA */
            loading ? (
              <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-7 w-7 animate-spin text-[#0F2A43]" />
                <p className="text-xs font-semibold text-slate-600">
                  Carregando ficha e lances da partida...
                </p>
              </div>
            ) : errorMessage && events.length === 0 ? (
              <div className="py-10 text-center flex flex-col items-center justify-center gap-3">
                <AlertCircle className="h-8 w-8 text-amber-500" />
                <p className="text-xs text-slate-600 max-w-xs">{errorMessage}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchDetails(match, false, true)}
                  className="text-xs h-8 gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" /> Tentar novamente
                </Button>
              </div>
            ) : events.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-slate-500 font-medium">
                  Nenhum lance registrado até o momento para esta partida.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fetchDetails(match, false, true)}
                  className="text-xs text-slate-600 mt-2 gap-1"
                >
                  <RefreshCw className="h-3 w-3" /> Atualizar
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Seção de Gols */}
                {golsList.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                      <span>⚽</span> Gols e Marcadores ({golsList.length})
                    </h4>
                    <div className="space-y-1.5">
                      {golsList.map((ev, idx) => renderEventItem(ev, idx))}
                    </div>
                  </div>
                )}

                {/* Seção de Cartões */}
                {cartoesList.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                      <span>🟨 / 🟥</span> Cartões ({cartoesList.length})
                    </h4>
                    <div className="space-y-1.5">
                      {cartoesList.map((ev, idx) => renderEventItem(ev, idx))}
                    </div>
                  </div>
                )}

                {/* Seção de Substituições */}
                {subsList.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                      <span>🔄</span> Substituições ({subsList.length})
                    </h4>
                    <div className="space-y-1.5">
                      {subsList.map((ev, idx) => renderEventItem(ev, idx))}
                    </div>
                  </div>
                )}

                {/* Atualização e fonte */}
                <div className="pt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Total de {events.length} evento(s) registrado(s)</span>
                  <button
                    type="button"
                    onClick={() => fetchDetails(match, false, true)}
                    className="hover:text-slate-600 flex items-center gap-1 underline font-medium cursor-pointer"
                  >
                    <RefreshCw className="h-2.5 w-2.5" /> Reconsultar
                  </button>
                </div>
              </div>
            )
          ) : /* ABA 2: ESCALAÇÕES */
          lineupLoading ? (
            <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-7 w-7 animate-spin text-[#0F2A43]" />
              <p className="text-xs font-semibold text-slate-600">
                Buscando escalações oficiais...
              </p>
            </div>
          ) : !lineup ||
            (!lineup.teams?.[0]?.starters?.length && !lineup.teams?.[1]?.starters?.length) ? (
            <div className="py-8 text-center flex flex-col items-center justify-center gap-2">
              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                <HelpCircle className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                Escalações ainda não confirmadas pelas equipes
              </p>
              <p className="text-xs text-slate-400 max-w-xs">
                As escalações oficiais costumam ser liberadas pelos clubes cerca de 30 a 60 minutos
                antes do início da partida.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => loadModalLineup(match, true)}
                className="text-xs h-8 gap-1.5 mt-2 text-[#0F2A43]"
              >
                <RefreshCw className="h-3 w-3" /> Verificar agora
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Seletor de time Mandante / Visitante */}
              {(() => {
                const teamHome = lineup.teams?.[0]
                const teamAway = lineup.teams?.[1]
                return (
                  <div className="grid grid-cols-2 gap-2 bg-slate-200/60 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setLineupTab('home')}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold truncate transition ${
                        lineupTab === 'home'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {teamHome?.teamName || homeName}
                      {teamHome?.formation ? ` (${teamHome.formation})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLineupTab('away')}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold truncate transition ${
                        lineupTab === 'away'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {teamAway?.teamName || awayName}
                      {teamAway?.formation ? ` (${teamAway.formation})` : ''}
                    </button>
                  </div>
                )
              })()}

              {/* Lista de Titulares e Reservas da equipe selecionada */}
              {(() => {
                const selectedTeam = lineupTab === 'home' ? lineup.teams?.[0] : lineup.teams?.[1]
                const starters = selectedTeam?.starters || []
                const substitutes = selectedTeam?.substitutes || []

                if (starters.length === 0 && substitutes.length === 0) {
                  return (
                    <div className="py-6 text-center text-xs text-slate-400">
                      Nenhum jogador listado para esta equipe no momento.
                    </div>
                  )
                }

                return (
                  <div className="space-y-3">
                    {/* Titulares */}
                    {starters.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Titulares ({starters.length})
                          </span>
                          {selectedTeam?.formation && (
                            <Badge variant="outline" className="text-[10px] h-5 bg-white">
                              Formação {selectedTeam.formation}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {starters.map((pl, pIdx) => (
                            <div
                              key={pIdx}
                              className="flex items-center gap-2 p-2 rounded-md bg-white border border-slate-200/80 shadow-2xs text-xs"
                            >
                              {pl.number != null && (
                                <span className="font-mono font-bold text-[11px] text-slate-500 w-5 text-right shrink-0">
                                  {pl.number}
                                </span>
                              )}
                              <span className="font-medium text-slate-800 truncate flex-1">
                                {pl.name}
                              </span>
                              {pl.pos && (
                                <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1 py-0.5 rounded shrink-0">
                                  {pl.pos}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reservas */}
                    {substitutes.length > 0 && (
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                          Banco de Reservas ({substitutes.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {substitutes.map((pl, pIdx) => (
                            <div
                              key={pIdx}
                              className="flex items-center gap-2 p-2 rounded-md bg-white/70 border border-slate-200/60 shadow-2xs text-xs"
                            >
                              {pl.number != null && (
                                <span className="font-mono font-bold text-[11px] text-slate-400 w-5 text-right shrink-0">
                                  {pl.number}
                                </span>
                              )}
                              <span className="text-slate-700 truncate flex-1">{pl.name}</span>
                              {pl.pos && (
                                <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1 py-0.5 rounded shrink-0">
                                  {pl.pos}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Treinador */}
                    {selectedTeam?.coach && (
                      <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 flex items-center justify-between">
                        <span>
                          Treinador:{' '}
                          <strong className="text-slate-700">{selectedTeam.coach}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => loadModalLineup(match, true)}
                          className="hover:text-slate-800 flex items-center gap-1 underline cursor-pointer"
                        >
                          <RefreshCw className="h-2.5 w-2.5" /> Atualizar
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* Rodapé com Fechar */}
        <div className="p-3 bg-white border-t border-slate-200 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs h-8"
          >
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default MatchDetailsModal
