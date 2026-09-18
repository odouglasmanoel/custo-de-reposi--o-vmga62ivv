import React, { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, RefreshCw, Shield } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { isFixtureLive } from '@/lib/apiFootballMatcher'
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

export function MatchDetailsModal({ isOpen, onClose, match }: MatchDetailsModalProps) {
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<MatchEventItem[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadedFixtureId, setLoadedFixtureId] = useState<string | number | null>(null)

  const fetchDetails = useCallback(async (currentMatch: DayFixture, silent = false) => {
    if (!currentMatch) return
    const fixtureId = currentMatch.fixture?.id
    const timeA = currentMatch.teams?.home?.name || ''
    const timeB = currentMatch.teams?.away?.name || ''
    const rawDate = currentMatch.fixture?.date || ''
    const datePart = rawDate.split('T')[0] || ''
    const st = (currentMatch.fixture?.status?.short || '').toUpperCase().trim()
    const live = Boolean(currentMatch.isLive || isFixtureLive(st))

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
      if (silent) queryParams.set('refresh', '1')

      const url = `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/detalhes-partida?${queryParams.toString()}`
      const res = await fetch(url, { headers })

      if (!res.ok) {
        throw new Error(`Erro na consulta (${res.status})`)
      }

      const data = await res.json()
      const rawEvents: MatchEventItem[] = Array.isArray(data.events) ? data.events : []

      // Se a resposta vier vazia e a partida já tiver scorers embutidos, usa os scorers como fallback
      if (
        rawEvents.length === 0 &&
        Array.isArray(currentMatch.scorers) &&
        currentMatch.scorers.length > 0
      ) {
        const fallbackGols: MatchEventItem[] = currentMatch.scorers.map((sc) => ({
          time: { elapsed: sc.minute ?? null, extra: sc.extraMinute ?? null },
          team: {
            id: sc.teamId ?? null,
            name:
              sc.teamName ??
              (sc.teamSide === 'home'
                ? currentMatch.teams.home.name
                : currentMatch.teams.away.name),
          },
          player: { name: sc.name },
          type: 'Goal',
          detail: 'Normal Goal',
        }))
        setEvents(fallbackGols)
      } else {
        setEvents(rawEvents)
      }

      setLoadedFixtureId(fixtureId)
    } catch (err: any) {
      // Fallback local se a partida já contiver scorers
      if (Array.isArray(currentMatch.scorers) && currentMatch.scorers.length > 0) {
        const fallbackGols: MatchEventItem[] = currentMatch.scorers.map((sc) => ({
          time: { elapsed: sc.minute ?? null, extra: sc.extraMinute ?? null },
          team: {
            name:
              sc.teamName ??
              (sc.teamSide === 'home'
                ? currentMatch.teams.home.name
                : currentMatch.teams.away.name),
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
  }, [])

  useEffect(() => {
    if (isOpen && match) {
      if (loadedFixtureId !== match.fixture?.id) {
        fetchDetails(match, false)
      }
    }
  }, [isOpen, match, loadedFixtureId, fetchDetails])

  // Revalidação periódica de 35s enquanto o modal estiver aberto E o jogo for ao vivo
  useEffect(() => {
    if (!isOpen || !match) return

    const st = (match.fixture?.status?.short || '').toUpperCase().trim()
    const isLiveGame = Boolean(match.isLive || isFixtureLive(st))

    if (!isLiveGame) return

    const intervalId = setInterval(() => {
      fetchDetails(match, true)
    }, 35000)

    return () => {
      clearInterval(intervalId)
    }
  }, [isOpen, match, fetchDetails])

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
        </div>

        {/* Conteúdo: Linha do Tempo e Eventos */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-5 bg-slate-50/50">
          {loading ? (
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
                onClick={() => fetchDetails(match, false)}
                className="text-xs h-8 gap-1.5"
              >
                <RefreshCw className="h-3 w-3" /> Tentar novamente
              </Button>
            </div>
          ) : events.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-xs text-slate-500 font-medium">
                Nenhum detalhe ou evento disponível no momento para esta partida.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fetchDetails(match, false)}
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
                  onClick={() => fetchDetails(match, false)}
                  className="hover:text-slate-600 flex items-center gap-1 underline font-medium cursor-pointer"
                >
                  <RefreshCw className="h-2.5 w-2.5" /> Reconsultar
                </button>
              </div>
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
