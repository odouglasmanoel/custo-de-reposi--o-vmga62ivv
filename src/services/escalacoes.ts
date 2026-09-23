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
  notice?: string
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

  // 1. LEITURA 100% POCKETBASE LOCAL (SEM CONSUMO DE COTA / SEM ROTA HTTP EXTERNA)
  if (jogoId && !forceRefresh) {
    try {
      const rec = await pb.collection('jogos').getOne(jogoId, { fields: 'id,escalacoes' })
      if (rec && rec.escalacoes) {
        const esc = typeof rec.escalacoes === 'string' ? JSON.parse(rec.escalacoes) : rec.escalacoes
        if (esc && esc.teams && esc.teams.length > 0) {
          const result: LineupResponse = { ...esc, cached: true }
          setWithBoundedCapacity(
            lineupsMemoryCache,
            cacheKey,
            { data: result, timestamp: now },
            100,
          )
          return result
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // 100% Leitura PocketBase: se não encontrou no getOne acima ou não tem jogoId,
  // consulta pelo fixture_id ou times na coleção jogos do PocketBase diretamente.
  // NENHUMA rota externa ou hook HTTP é acionada a cada render/abertura.
  if (fixtureId || (timeA && timeB)) {
    try {
      let filter = ''
      if (fixtureId) {
        filter = `fixture_id = '${fixtureId.replace(/'/g, "\\'")}'`
      } else if (timeA && timeB) {
        filter = `time_a ~ '${timeA.replace(/'/g, "\\'")}' && time_b ~ '${timeB.replace(/'/g, "\\'")}'`
      }

      const records = await pb.collection('jogos').getList(1, 1, {
        filter: filter,
        fields: 'id,escalacoes,fixture_id,time_a,time_b',
      })

      if (records.items.length > 0 && records.items[0].escalacoes) {
        const escRaw = records.items[0].escalacoes
        const escObj = typeof escRaw === 'string' ? JSON.parse(escRaw) : escRaw
        if (escObj && escObj.teams && escObj.teams.length > 0) {
          const result: LineupResponse = { ...escObj, cached: true }
          setWithBoundedCapacity(
            lineupsMemoryCache,
            cacheKey,
            { data: result, timestamp: now },
            100,
          )
          return result
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // Se não há dados gravados no banco para esta partida, retorna status indisponivel informativo
  const fallback: LineupResponse = {
    status: 'indisponivel',
    provider: 'local',
    fixtureId: fixtureId,
    cached: true,
    teams: [
      { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
      { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
    ],
    notice:
      'Escalação ainda não confirmada pelos clubes. A sincronização automática ocorre antes do início do jogo.',
    updatedAt: new Date().toISOString(),
  }

  setWithBoundedCapacity(lineupsMemoryCache, cacheKey, { data: fallback, timestamp: now }, 100)
  return fallback
}
