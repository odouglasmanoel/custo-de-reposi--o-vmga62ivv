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
import {
  Loader2,
  AlertCircle,
  Shield,
  Users,
  MapPin,
  UserCheck,
  Calendar,
  Clock,
  Info,
  RefreshCw,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/context/AuthContext'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import { isFixtureLive, cleanTeamName } from '@/lib/apiFootballMatcher'
import type { DayFixture } from '@/pages/JogosDoDia'
import { setWithBoundedCapacity } from '@/lib/cacheManager'

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
  type?: string | null
  detail?: string | null
  comments?: string | null
}

export interface LineupPlayerItem {
  id?: string
  name: string
  number?: number | null
  pos?: string
  grid?: string | null
}

export interface LineupTeamItem {
  teamId?: string
  teamName: string
  teamLogo?: string
  formation?: string
  coach?: string
  starters: LineupPlayerItem[]
  substitutes: LineupPlayerItem[]
}

export interface LineupData {
  status: 'confirmada' | 'provavel' | 'indisponivel'
  provider?: string
  fixtureId?: string
  teams: LineupTeamItem[]
  updatedAt?: string
}

interface MatchDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  match: DayFixture | null
}

// Cache local em memória (PocketBase cache-first) para evitar leituras repetidas desnecessárias
interface CachedPBDetails {
  events: MatchEventItem[]
  lineup: LineupData | null
  estadio: string | null
  arbitro: string | null
  statusInfo: { short: string; long: string; elapsed?: number | null }
  timestamp: number
}

const pbDetailsMemoryCache = new Map<string, CachedPBDetails>()

function getCacheKey(match: DayFixture | null): string {
  if (!match) return ''
  const fixId = match.fixture?.id ? String(match.fixture.id).trim() : ''
  if (fixId) return `pb_details_${fixId}`
  const h = (match.teams?.home?.name || '').trim().toLowerCase()
  const a = (match.teams?.away?.name || '').trim().toLowerCase()
  const d = (match.fixture?.date || '').split('T')[0] || ''
  return `pb_details_${h}__${a}__${d}`
}

export function MatchDetailsModal({ isOpen, onClose, match }: MatchDetailsModalProps) {
  const auth = useAuth()
  const isAdmin = Boolean(auth?.isAdmin)
  const [activeTab, setActiveTab] = useState<'ficha' | 'escalacoes'>('ficha')
  const [loading, setLoading] = useState(false)
  const [forcingEscalacao, setForcingEscalacao] = useState(false)
  const [events, setEvents] = useState<MatchEventItem[]>([])
  const [lineup, setLineup] = useState<LineupData | null>(null)
  const [lineupTab, setLineupTab] = useState<'home' | 'away'>('home')
  const [associatedJogoId, setAssociatedJogoId] = useState<string | null>(null)

  // Metadados da Ficha Técnica (Estádio, Árbitro, Status)
  const [estadio, setEstadio] = useState<string | null>(null)
  const [arbitro, setArbitro] = useState<string | null>(null)
  const [partidaStatus, setPartidaStatus] = useState<{
    short: string
    long: string
    elapsed?: number | null
  }>({
    short: match?.fixture?.status?.short || 'NS',
    long: match?.fixture?.status?.long || 'Agendado',
    elapsed: match?.fixture?.status?.elapsed ?? null,
  })

  // Leitura EXCLUSIVAMENTE do PocketBase (cache-first local). NUNCA chama APIs externas.
  const loadFromPocketBase = useCallback(async (currentMatch: DayFixture, force = false) => {
    if (!currentMatch) return
    const fixtureId = currentMatch.fixture?.id ? String(currentMatch.fixture.id).trim() : ''
    const timeA = (currentMatch.teams?.home?.name || '').trim()
    const timeB = (currentMatch.teams?.away?.name || '').trim()

    const cacheKey = getCacheKey(currentMatch)
    const now = Date.now()

    // 1. Verifica cache local em memória (30s de TTL se ao vivo, 5min se agendado/finalizado)
    if (!force && cacheKey && pbDetailsMemoryCache.has(cacheKey)) {
      const cached = pbDetailsMemoryCache.get(cacheKey)!
      const isLive = isFixtureLive(cached.statusInfo.short)
      const maxAge = isLive ? 30000 : 5 * 60 * 1000
      if (now - cached.timestamp < maxAge) {
        setEvents(cached.events)
        setLineup(cached.lineup)
        setEstadio(cached.estadio)
        setArbitro(cached.arbitro)
        setPartidaStatus(cached.statusInfo)
        return
      }
    }

    setLoading(true)

    try {
      let resolvedLineup: LineupData | null = null
      let resolvedEvents: MatchEventItem[] = Array.isArray(currentMatch.events)
        ? [...currentMatch.events]
        : []
      let resolvedEstadio: string | null = null
      let resolvedArbitro: string | null = null
      let resolvedStatus = {
        short: currentMatch.fixture?.status?.short || 'NS',
        long: currentMatch.fixture?.status?.long || 'Agendado',
        elapsed: currentMatch.fixture?.status?.elapsed ?? null,
      }

      // Consulta 1: Tenta ler registro na collection `jogos_do_dia`
      // para capturar estádio, árbitro, status atualizado e raw_payload
      if (fixtureId) {
        try {
          const jddRecords = await pb.collection('jogos_do_dia').getList(1, 1, {
            filter: `fixture_id = '${fixtureId.replace(/'/g, "\\'")}'`,
            requestKey: null,
          })
          if (jddRecords.items.length > 0) {
            const jdd = jddRecords.items[0] as any
            if (jdd.status_short) {
              resolvedStatus = {
                short: jdd.status_short,
                long: jdd.status_long || resolvedStatus.long,
                elapsed: jdd.status_elapsed != null ? jdd.status_elapsed : resolvedStatus.elapsed,
              }
            }
            if (Array.isArray(jdd.events) && jdd.events.length > 0) {
              resolvedEvents = jdd.events
            }

            // Metadados do estádio e árbitro do raw_payload gravado no banco
            const raw = jdd.raw_payload || {}
            if (raw.fixture) {
              if (raw.fixture.referee && typeof raw.fixture.referee === 'string') {
                resolvedArbitro = raw.fixture.referee.trim()
              }
              if (raw.fixture.venue) {
                const vName = raw.fixture.venue.name || ''
                const vCity = raw.fixture.venue.city || ''
                if (vName && vCity) {
                  resolvedEstadio = `${vName} (${vCity})`
                } else if (vName) {
                  resolvedEstadio = vName
                }
              }
            }
          }
        } catch {
          /* ignore error */
        }
      }

      // Consulta 2: Tenta ler escalações da collection `jogos` do PocketBase
      // Gravadas pelo cron de escalações (`cron_escalacoes_pre_jogo_5m`)
      let pbJogoFilter = ''
      if (fixtureId) {
        pbJogoFilter = `fixture_id = '${fixtureId.replace(/'/g, "\\'")}'`
      } else if (timeA && timeB) {
        pbJogoFilter = `time_a ~ '${timeA.slice(0, 5).replace(/'/g, "\\'")}' && time_b ~ '${timeB.slice(0, 5).replace(/'/g, "\\'")}'`
      }

      if (pbJogoFilter) {
        try {
          const jogosRecords = await pb.collection('jogos').getList(1, 1, {
            filter: pbJogoFilter,
            fields: 'id,fixture_id,time_a,time_b,escalacoes,ficha_detalhes,resultado_finalizado',
            requestKey: null,
          })
          if (jogosRecords.items.length > 0) {
            const jRec = jogosRecords.items[0] as any
            setAssociatedJogoId(jRec.id)
            const rawEsc = jRec.escalacoes
            if (rawEsc) {
              const parsedEsc = typeof rawEsc === 'string' ? JSON.parse(rawEsc) : rawEsc
              if (
                parsedEsc &&
                Array.isArray(parsedEsc.teams) &&
                parsedEsc.teams.length > 0 &&
                (parsedEsc.teams[0]?.starters?.length > 0 ||
                  parsedEsc.teams[1]?.starters?.length > 0)
              ) {
                resolvedLineup = parsedEsc
              }
            }

            // Mescla ficha técnica adicional se presente
            const rawFicha = jRec.ficha_detalhes
            if (rawFicha) {
              const parsedFicha = typeof rawFicha === 'string' ? JSON.parse(rawFicha) : rawFicha
              if (
                parsedFicha &&
                Array.isArray(parsedFicha.events) &&
                parsedFicha.events.length > 0
              ) {
                if (resolvedEvents.length === 0) {
                  resolvedEvents = parsedFicha.events
                }
              }
              if (parsedFicha?.referee && !resolvedArbitro) {
                resolvedArbitro = String(parsedFicha.referee)
              }
              if (parsedFicha?.venue && !resolvedEstadio) {
                resolvedEstadio = String(parsedFicha.venue)
              }
            }
          }
        } catch {
          /* ignore error */
        }
      }

      // Se ainda não temos eventos de gols, injeta os marcadores conhecidos do registro
      const hasGoalEvents = resolvedEvents.some((ev) => {
        const t = (ev.type || '').toLowerCase()
        const d = (ev.detail || '').toLowerCase()
        return t.includes('goal') || d.includes('goal')
      })

      const homeGoalsCount = Number(currentMatch.goals?.home ?? 0)
      const awayGoalsCount = Number(currentMatch.goals?.away ?? 0)
      const totalPlacar =
        (homeGoalsCount > 0 ? homeGoalsCount : 0) + (awayGoalsCount > 0 ? awayGoalsCount : 0)

      if (!hasGoalEvents && totalPlacar > 0 && Array.isArray(currentMatch.scorers)) {
        const scorersEvents: MatchEventItem[] = currentMatch.scorers.map((sc) => ({
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
        resolvedEvents = [...scorersEvents, ...resolvedEvents]
      }

      setEvents(resolvedEvents)
      setLineup(resolvedLineup)
      setEstadio(resolvedEstadio)
      setArbitro(resolvedArbitro)
      setPartidaStatus(resolvedStatus)

      // Atualiza o cache local em memória
      if (cacheKey) {
        setWithBoundedCapacity(
          pbDetailsMemoryCache,
          cacheKey,
          {
            events: resolvedEvents,
            lineup: resolvedLineup,
            estadio: resolvedEstadio,
            arbitro: resolvedArbitro,
            statusInfo: resolvedStatus,
            timestamp: now,
          },
          100,
        )
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Efeito ao abrir o modal: lê exclusivamente do PocketBase
  useEffect(() => {
    if (isOpen && match) {
      loadFromPocketBase(match, false)
    } else if (!isOpen) {
      setEvents([])
      setLineup(null)
      setEstadio(null)
      setArbitro(null)
      setAssociatedJogoId(null)
    }
  }, [isOpen, match, loadFromPocketBase])

  const handleForcarEscalacaoAdmin = async () => {
    if (!match || forcingEscalacao) return
    const targetJogoId = associatedJogoId
    if (!targetJogoId) {
      toast({
        title: 'Jogo não encontrado',
        description: 'Esta partida não está associada a um registro na tabela de jogos do bolão.',
        variant: 'destructive',
      })
      return
    }

    setForcingEscalacao(true)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (pb.authStore.token) {
        headers['Authorization'] = pb.authStore.token
      }

      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/admin/forcar-escalacao`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ jogo_id: targetJogoId }),
        },
      )

      const dataRes = await res.json()
      if (!res.ok || dataRes.success === false) {
        const errorMsg =
          dataRes.error ||
          dataRes.notice ||
          'Não foi possível obter escalações da API externa no momento.'
        toast({
          title: 'Aviso sobre escalação',
          description: errorMsg,
          variant: dataRes.rate_limited ? 'destructive' : 'default',
        })
      } else {
        toast({
          title: 'Escalação sincronizada!',
          description: 'Escalações da partida atualizadas com sucesso no banco de dados.',
        })
        loadFromPocketBase(match, true)
      }
    } catch (err: unknown) {
      console.error('Erro ao forçar escalação:', err)
      toast({
        title: 'Erro na requisição',
        description: 'Falha de comunicação ao solicitar busca de escalação.',
        variant: 'destructive',
      })
    } finally {
      setForcingEscalacao(false)
    }
  }

  // Sincronização em tempo real com PocketBase:
  // Se o cron `cron_escalacoes_pre_jogo_5m` salvar a escalação na collection `jogos`
  // enquanto o modal estiver aberto, atualiza imediatamente sem polling
  useRealtime(
    'jogos',
    () => {
      if (isOpen && match) {
        loadFromPocketBase(match, true)
      }
    },
    isOpen,
  )

  useRealtime(
    'jogos_do_dia',
    () => {
      if (isOpen && match) {
        loadFromPocketBase(match, true)
      }
    },
    isOpen,
  )

  if (!match) return null

  const homeName = match.teams?.home?.name || 'Mandante'
  const awayName = match.teams?.away?.name || 'Visitante'
  const homeScore = match.goals?.home ?? '—'
  const awayScore = match.goals?.away ?? '—'
  const stShort = (partidaStatus.short || match.fixture?.status?.short || '').toUpperCase()
  const isFinished = ['FT', 'AET', 'PEN', 'FINISHED'].includes(stShort)
  const isLive = Boolean(match.isLive || isFixtureLive(stShort))

  // Resolução definitiva de escudo PSG se necessário
  const resolveTeamLogo = (teamName: string, originalLogo?: string | null): string => {
    const t = (teamName || '').toLowerCase()
    if (t.includes('paris') || t === 'psg') {
      return 'https://media.api-sports.io/football/teams/85.png'
    }
    return originalLogo || ''
  }
  const homeLogo = resolveTeamLogo(homeName, match.teams?.home?.logo)
  const awayLogo = resolveTeamLogo(awayName, match.teams?.away?.logo)

  // Formatação de data/hora de Brasília
  const formatKickoffBR = () => {
    const dStr = match.fixture?.date
    if (!dStr) return null
    try {
      const d = new Date(dStr)
      if (isNaN(d.getTime())) return null
      return d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
    } catch {
      return null
    }
  }
  const horaBR = formatKickoffBR()

  // Separar eventos por categoria
  const golsList = events.filter((ev) => {
    const t = (ev.type || '').toLowerCase()
    const d = (ev.detail || '').toLowerCase()
    const isCard =
      t.includes('card') || d.includes('card') || d.includes('yellow') || d.includes('red')
    const isSub = t.includes('sub') || d.includes('sub')
    return t.includes('goal') || d.includes('goal') || t.includes('gol') || (!isCard && !isSub)
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
      if (playerName && assistOrIn) {
        eventTitle = `Entra: ${assistOrIn}`
        subInfo = `Sai: ${playerName}`
      } else {
        eventTitle = playerName || assistOrIn || 'Substituição'
        subInfo = 'Substituição'
      }
    } else {
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

    const teamName = ev.team?.name || ''
    const evTeamId =
      ev.team?.id != null && String(ev.team.id).trim() ? String(ev.team.id).trim() : null
    const homeTeamId =
      match.teams?.home?.id != null && String(match.teams.home.id).trim()
        ? String(match.teams.home.id).trim()
        : null
    const awayTeamId =
      match.teams?.away?.id != null && String(match.teams.away.id).trim()
        ? String(match.teams.away.id).trim()
        : null

    // Determina isHome / isAway priorizando SEMPRE team ID da API Football
    let isHome = false
    let isAway = false

    if (evTeamId && (homeTeamId || awayTeamId)) {
      if (homeTeamId && evTeamId === homeTeamId) {
        isHome = true
      } else if (awayTeamId && evTeamId === awayTeamId) {
        isAway = true
      }
    }

    const evAny = ev as any
    const explicitSide = evAny.teamSide || (ev.team as any)?.side || evAny.side
    if (!isHome && !isAway && explicitSide) {
      if (explicitSide === 'home') isHome = true
      else if (explicitSide === 'away') isAway = true
    }

    if (!isHome && !isAway && teamName) {
      const cleanTeam = cleanTeamName(teamName)
      const cleanHome = homeName ? cleanTeamName(homeName) : ''
      const cleanAway = awayName ? cleanTeamName(awayName) : ''

      const matchH = cleanHome && (cleanHome.includes(cleanTeam) || cleanTeam.includes(cleanHome))
      const matchA = cleanAway && (cleanAway.includes(cleanTeam) || cleanTeam.includes(cleanAway))

      if (matchH && !matchA) {
        isHome = true
      } else if (matchA && !matchH) {
        isAway = true
      }
    }

    // Alinhamento estrito:
    // isHome true => alinhado à esquerda (items-start, text-left)
    // isHome false / isAway => alinhado à direita (items-end, text-right, flex-row-reverse)
    const alignRight = isAway || (!isHome && awayName)

    return (
      <div
        key={idx}
        className={`flex items-center gap-3 rounded-lg border border-slate-100 bg-white p-2.5 shadow-2xs hover:border-slate-200 transition ${
          alignRight ? 'flex-row-reverse text-right' : 'text-left'
        }`}
      >
        <span className="text-base shrink-0" role="img" aria-label="evento">
          {icon}
        </span>
        <div className={`flex-1 min-w-0 flex flex-col ${alignRight ? 'items-end' : 'items-start'}`}>
          <div className={`flex items-center gap-2 ${alignRight ? 'flex-row-reverse' : ''}`}>
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

  const hasLineupTeams =
    Boolean(lineup && Array.isArray(lineup.teams) && lineup.teams.length > 0) &&
    (lineup!.teams[0]?.starters?.length > 0 || lineup!.teams[1]?.starters?.length > 0)

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
                  AO VIVO {partidaStatus.elapsed ? `${partidaStatus.elapsed}'` : ''}
                </Badge>
              ) : isFinished ? (
                <Badge variant="secondary" className="bg-white/20 text-white text-[10px] font-bold">
                  Finalizado
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-white/20 text-white text-[10px] font-bold">
                  {horaBR ? `${horaBR} (Brasília)` : partidaStatus.short || 'Agendado'}
                </Badge>
              )}
            </div>
            <DialogTitle className="sr-only">
              Ficha do Jogo: {homeName} x {awayName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Ficha do jogo, escalações oficiais, estádio, árbitro e status
            </DialogDescription>
          </DialogHeader>

          {/* Placar Confronto */}
          <div className="flex items-center justify-between gap-3 pt-1">
            {/* Home */}
            <div className="flex-1 flex flex-col items-center text-center">
              {homeLogo ? (
                <img
                  src={homeLogo}
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
              <span
                className="font-bold text-sm leading-tight text-white line-clamp-2"
                title={homeName}
              >
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
                {partidaStatus.long || 'Ficha do Jogo'}
              </span>
            </div>

            {/* Away */}
            <div className="flex-1 flex flex-col items-center text-center">
              {awayLogo ? (
                <img
                  src={awayLogo}
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
              <span
                className="font-bold text-sm leading-tight text-white line-clamp-2"
                title={awayName}
              >
                {awayName}
              </span>
            </div>
          </div>

          {/* Informações Rápidas de Ficha Técnica (Estádio e Árbitro) */}
          <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5 truncate">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-400">Estádio:</span>
              <span className="font-semibold text-white truncate">{estadio || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <UserCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-400">Árbitro:</span>
              <span className="font-semibold text-white truncate">{arbitro || '—'}</span>
            </div>
          </div>

          {/* Abas Superiores: Ficha e Lances vs Escalações */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => setActiveTab('ficha')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                activeTab === 'ficha'
                  ? 'bg-white text-[#0F2A43] shadow-xs'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <span>📋</span> Ficha e Lances
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
              {hasLineupTeams && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            </button>
          </div>
        </div>

        {/* Conteúdo dinâmico da modal */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-4 bg-slate-50/50">
          {loading ? (
            <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-7 w-7 animate-spin text-[#0F2A43]" />
              <p className="text-xs font-semibold text-slate-600">
                Lendo dados da partida no banco de dados...
              </p>
            </div>
          ) : activeTab === 'ficha' ? (
            /* ABA 1: FICHA TÉCNICA E LANCES */
            <div className="space-y-4">
              {/* Quadro Resumo da Partida */}
              <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-[#0F2A43]" /> Ficha da Partida
                </h4>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div>
                    <span className="block text-[10px] text-slate-400 font-medium">Campeonato</span>
                    <span className="font-semibold text-slate-800">
                      {match.league?.name || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-medium">Status</span>
                    <span className="font-semibold text-slate-800">
                      {partidaStatus.long || partidaStatus.short || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-medium">Estádio</span>
                    <span className="font-semibold text-slate-800">{estadio || '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-medium">Árbitro</span>
                    <span className="font-semibold text-slate-800">{arbitro || '—'}</span>
                  </div>
                  {horaBR && (
                    <div className="col-span-2">
                      <span className="block text-[10px] text-slate-400 font-medium">
                        Horário de Brasília
                      </span>
                      <span className="font-semibold text-slate-800">{horaBR}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Lances / Eventos da Partida */}
              {events.length === 0 ? (
                <div className="py-6 text-center rounded-lg border border-slate-200/60 bg-white p-4">
                  <p className="text-xs text-slate-500 font-medium">
                    Nenhum lance registrado até o momento para esta partida.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Gols */}
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

                  {/* Cartões */}
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

                  {/* Substituições */}
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
                </div>
              )}
            </div>
          ) : /* ABA 2: ESCALAÇÕES */
          !hasLineupTeams ? (
            /* Se a escalação ainda não tiver sido capturada ou divulgada pela API, exibir mensagem amigável fixa */
            <div className="py-10 text-center flex flex-col items-center justify-center gap-3 bg-white rounded-lg border border-slate-200 p-6">
              <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <Users className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800">
                  Escalação ainda não divulgada (disponível ~20 min antes do jogo)
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Os dados oficiais são sincronizados automaticamente e exibidos assim que
                  publicados pelos clubes.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Seletor de time Mandante / Visitante */}
              {(() => {
                const teamHome = lineup?.teams?.[0]
                const teamAway = lineup?.teams?.[1]
                return (
                  <div className="grid grid-cols-2 gap-2 bg-slate-200/60 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setLineupTab('home')}
                      title={`${teamHome?.teamName || homeName}${teamHome?.formation ? ` (${teamHome.formation})` : ''}`}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold line-clamp-2 leading-tight transition min-w-0 ${
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
                      title={`${teamAway?.teamName || awayName}${teamAway?.formation ? ` (${teamAway.formation})` : ''}`}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold line-clamp-2 leading-tight transition min-w-0 ${
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
                const selectedTeam = lineupTab === 'home' ? lineup?.teams?.[0] : lineup?.teams?.[1]
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
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between">
          <div>
            {isAdmin && associatedJogoId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleForcarEscalacaoAdmin}
                disabled={forcingEscalacao}
                className="text-xs h-8 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900"
                title="Buscar ou forçar atualização de escalação na API-Football (Admin)"
              >
                {forcingEscalacao ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    <span>Buscando Escalação...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    <span>Forçar Escalação</span>
                  </>
                )}
              </Button>
            )}
          </div>
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
