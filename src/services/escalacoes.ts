import pb from '@/lib/pocketbase/client'

export interface LineupPlayer {
  id?: string
  name: string
  number?: number | null
  pos?: string
  grid?: string | null
}

export interface LineupTeam {
  teamId?: string
  teamName: string
  teamLogo?: string
  formation?: string
  coach?: string
  starters: LineupPlayer[]
  substitutes: LineupPlayer[]
}

export type LineupStatus = 'confirmada' | 'provavel' | 'indisponivel'

export interface LineupResponse {
  status: LineupStatus
  provider?: string
  fixtureId?: string
  teams: LineupTeam[]
  updatedAt?: string
  cached?: boolean
  error?: string
}

// Cache em memória (SWR) com TTL de 10 minutos para confirmadas e 2-3 minutos para prováveis/vazio
import { setWithBoundedCapacity } from '@/lib/cacheManager'

interface CacheItem {
  data: LineupResponse
  timestamp: number
}

const lineupsMemoryCache = new Map<string, CacheItem>()
const inflightRequests = new Map<string, Promise<LineupResponse>>()

const TTL_CONFIRMADA_MS = 10 * 60 * 1000 // 10 minutos
const TTL_PROVAVEL_MS = 3 * 60 * 1000 // 3 minutos
const TTL_INDISPONIVEL_MS = 2 * 60 * 1000 // 2 minutos

export function getLineupsCacheKey(jogoId: string, fixtureId?: string): string {
  if (fixtureId && fixtureId.trim()) {
    return `lineup_${fixtureId.trim()}`
  }
  return `lineup_jogo_${jogoId}`
}

/**
 * Normaliza nome de jogador para matching flexível
 * Ex: "Pedro Raul Garay" -> "pedro raul garay" sem acentos e minúsculo
 */
export function normalizePlayerName(name: string): string {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Verifica se um nome digitado (ex: "Pedro Raul", "Veiga", "R. Veiga")
 * coincide com algum jogador da escalação (titular ou reserva)
 */
export function checkPlayerInLineup(
  playerName: string,
  lineupTeam?: LineupTeam,
): { role: 'titular' | 'reserva' | null; matchedPlayer?: LineupPlayer } {
  if (!playerName || !lineupTeam) return { role: null }
  const cleanInput = normalizePlayerName(playerName)
  if (!cleanInput || cleanInput.length < 2) return { role: null }

  // 1. Checa titulares
  for (const starter of lineupTeam.starters) {
    const cleanStarter = normalizePlayerName(starter.name)
    if (!cleanStarter) continue
    if (
      cleanStarter === cleanInput ||
      cleanStarter.includes(cleanInput) ||
      cleanInput.includes(cleanStarter)
    ) {
      return { role: 'titular', matchedPlayer: starter }
    }
    // Match por sobrenome se entrada tiver mais de 3 letras
    const parts = cleanStarter.split(' ')
    const lastPart = parts[parts.length - 1]
    if (lastPart && lastPart.length >= 4 && cleanInput === lastPart) {
      return { role: 'titular', matchedPlayer: starter }
    }
  }

  // 2. Checa reservas
  for (const sub of lineupTeam.substitutes) {
    const cleanSub = normalizePlayerName(sub.name)
    if (!cleanSub) continue
    if (cleanSub === cleanInput || cleanSub.includes(cleanInput) || cleanInput.includes(cleanSub)) {
      return { role: 'reserva', matchedPlayer: sub }
    }
    const parts = cleanSub.split(' ')
    const lastPart = parts[parts.length - 1]
    if (lastPart && lastPart.length >= 4 && cleanInput === lastPart) {
      return { role: 'reserva', matchedPlayer: sub }
    }
  }

  return { role: null }
}

/**
 * Consulta de escalação on-demand via backend com cache em memória e deduplicação de requisições.
 */
export async function fetchGameLineup(params: {
  jogoId?: string
  fixtureId?: string
  timeA?: string
  timeB?: string
  data?: string
  forceRefresh?: boolean
}): Promise<LineupResponse> {
  const {
    jogoId = '',
    fixtureId = '',
    timeA = '',
    timeB = '',
    data = '',
    forceRefresh = false,
  } = params
  // Chave canônica unificada que considera também times e data para evitar colisões
  const fallbackKey = timeA && timeB ? `${timeA}_${timeB}_${data}` : ''
  const cacheKey = getLineupsCacheKey(jogoId, fixtureId) || fallbackKey
  const now = Date.now()

  if (!forceRefresh && cacheKey && lineupsMemoryCache.has(cacheKey)) {
    const cached = lineupsMemoryCache.get(cacheKey)!
    const ttl =
      cached.data.status === 'confirmada'
        ? TTL_CONFIRMADA_MS
        : cached.data.status === 'provavel'
          ? TTL_PROVAVEL_MS
          : TTL_INDISPONIVEL_MS
    if (now - cached.timestamp < ttl) {
      return { ...cached.data, cached: true }
    }
  }

  // Deduplicação de requisições em voo
  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey)!
  }

  const queryParams = new URLSearchParams()
  if (jogoId) queryParams.set('jogo_id', jogoId)
  if (fixtureId) queryParams.set('fixture_id', fixtureId)
  if (timeA) queryParams.set('time_a', timeA)
  if (timeB) queryParams.set('time_b', timeB)
  if (data) queryParams.set('data', data)

  const fetchPromise = (async (): Promise<LineupResponse> => {
    try {
      const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
      const token = pb.authStore.token || ''

      const response = await fetch(`${baseUrl}/backend/v1/escalacoes?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        const fallback: LineupResponse = {
          status: 'indisponivel',
          teams: [
            { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
            { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
          ],
          error: errorJson.error || 'Não foi possível carregar a escalação.',
        }
        setWithBoundedCapacity(
          lineupsMemoryCache,
          cacheKey,
          { data: fallback, timestamp: now },
          100,
        )
        return fallback
      }

      const dataJson: LineupResponse = await response.json()
      setWithBoundedCapacity(lineupsMemoryCache, cacheKey, { data: dataJson, timestamp: now }, 100)
      return dataJson
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Falha na conexão com o servidor'
      const fallback: LineupResponse = {
        status: 'indisponivel',
        teams: [
          { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
          { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
        ],
        error: errorMsg,
      }
      setWithBoundedCapacity(lineupsMemoryCache, cacheKey, { data: fallback, timestamp: now }, 100)
      return fallback
    } finally {
      inflightRequests.delete(cacheKey)
    }
  })()

  inflightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
