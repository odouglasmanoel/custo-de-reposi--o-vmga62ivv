import pb from '@/lib/pocketbase/client'

export type EventCategory = 'goal' | 'card' | 'subst' | 'other'

export interface MatchEvent {
  time: {
    elapsed: number | null
    extra?: number | null
  }
  team: {
    id?: number | null
    name: string
    logo?: string
    side?: 'home' | 'away'
  }
  player: {
    id?: number | null
    name: string
  }
  assist?: {
    id?: number | null
    name: string | null
  }
  type: string // "Goal", "Card", "subst"
  detail: string // "Normal Goal", "Yellow Card", "Red Card", "Substitution 1", "Own Goal", "Penalty"
  comments?: string | null
  category?: EventCategory
}

export interface FichaJogoResponse {
  success: boolean
  cached?: boolean
  source?: string
  rate_limited?: boolean
  waiting_reset?: boolean
  notice?: string
  error?: string
  fixture_id?: string
  events: MatchEvent[]
  teams?: {
    home?: { name?: string; logo?: string; id?: number }
    away?: { name?: string; logo?: string; id?: number }
  }
  goals?: {
    home?: number | null
    away?: number | null
  }
  updated_at?: string
}

// Cache local em memória por fixture_id
const FICHA_CACHE = new Map<string, { data: FichaJogoResponse; timestamp: number }>()
const CACHE_TTL_MS = 60 * 1000 // 1 minuto para jogos ao vivo, finalizados permanecem indefinidamente se tiver eventos

/**
 * Busca os eventos da partida (Ficha do Jogo) com lazy loading e cache por fixture_id / jogo_id
 */
export async function fetchEventosJogo(params: {
  fixtureId?: string | null
  jogoId?: string | null
  forceRefresh?: boolean
}): Promise<FichaJogoResponse> {
  const { fixtureId, jogoId, forceRefresh } = params
  const key = (fixtureId || jogoId || '').trim()

  if (!key) {
    return {
      success: false,
      error: 'ID da partida não informado.',
      events: [],
    }
  }

  // 1. Verifica cache local do cliente
  if (!forceRefresh) {
    const cached = FICHA_CACHE.get(key)
    if (cached) {
      const isFresh = Date.now() - cached.timestamp < CACHE_TTL_MS
      if (isFresh || (cached.data.events && cached.data.events.length > 0)) {
        return cached.data
      }
    }
  }

  // 2. Consulta o backend Skip Cloud
  try {
    const queryParts: string[] = []
    if (fixtureId) queryParts.push(`fixture_id=${encodeURIComponent(fixtureId.trim())}`)
    if (jogoId) queryParts.push(`jogo_id=${encodeURIComponent(jogoId.trim())}`)
    if (forceRefresh) queryParts.push('refresh=1')

    const path = `/backend/v1/eventos-jogo?${queryParts.join('&')}`
    const response = await pb.send<FichaJogoResponse>(path, {
      method: 'GET',
    })

    if (response) {
      // Normaliza categorias caso venha sem
      const events = (response.events || []).map((ev) => {
        const typeStr = (ev.type || '').toLowerCase()
        let category: EventCategory = 'other'
        if (typeStr.includes('goal')) category = 'goal'
        else if (typeStr.includes('card')) category = 'card'
        else if (typeStr.includes('sub')) category = 'subst'
        return {
          ...ev,
          category: ev.category || category,
        }
      })

      const finalData: FichaJogoResponse = {
        ...response,
        events,
      }

      FICHA_CACHE.set(key, { data: finalData, timestamp: Date.now() })
      return finalData
    }

    return {
      success: false,
      error: 'Não foi possível carregar os eventos da partida.',
      events: [],
    }
  } catch (err: any) {
    // Tratamento amigável em pt-BR sem quebrar
    const msg =
      err?.data?.error ||
      err?.message ||
      'Não foi possível conectar ao servidor para obter os eventos.'
    return {
      success: false,
      error: msg,
      events: [],
    }
  }
}

/**
 * Limpa o cache de eventos de uma fixture ou de todas
 */
export function clearFichaJogoCache(fixtureId?: string) {
  if (fixtureId) {
    FICHA_CACHE.delete(fixtureId.trim())
  } else {
    FICHA_CACHE.clear()
  }
}
