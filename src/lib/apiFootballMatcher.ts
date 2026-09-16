/**
 * Utilitários para correspondência fuzzy entre jogos cadastrados manualmente no Bolão
 * e fixtures da API-Football (api-sports / RapidAPI).
 */

export interface ApiFootballFixture {
  fixture?: {
    id?: number
    date?: string
    timestamp?: number
    status?: {
      long?: string
      short?: string
      elapsed?: number
    }
  }
  teams?: {
    home?: {
      id?: number
      name?: string
      logo?: string
    }
    away?: {
      id?: number
      name?: string
      logo?: string
    }
  }
  goals?: {
    home?: number | null
    away?: number | null
  }
  score?: {
    halftime?: { home?: number | null; away?: number | null }
    fulltime?: { home?: number | null; away?: number | null }
  }
}

export interface MatchedLiveScore {
  found: boolean
  fixtureId?: number
  homeTeamName: string
  awayTeamName: string
  placarA: number
  placarB: number
  statusShort: string
  statusLong: string
  elapsed: number | null
  isLive: boolean
  displayLabel: string
}

/**
 * Remove acentos, pontuação, prefixos/sufixos comuns de clubes e espaços extras.
 */
export function cleanTeamName(name: string): string {
  if (!name) return ''
  let s = String(name).toLowerCase()
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch {
    /* fallback */
  }

  // Remove caracteres que não sejam letras, números ou espaços
  s = s.replace(/[^a-z0-9\s]/g, ' ')

  // Remove termos genéricos de clubes de futebol
  const noiseWords = [
    'fc',
    'f.c.',
    'ec',
    'e.c.',
    'cr',
    'c.r.',
    'clube',
    'club',
    'atletico',
    'de',
    'da',
    'do',
    'dos',
    'das',
    'esporte',
    'futebol',
    'sport',
    'association',
    'afc',
    'cf',
  ]

  const tokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !noiseWords.includes(t))

  // Se todos foram removidos por ruído (ex: time "Clube"), mantém original sanitizado
  if (tokens.length === 0) {
    return s.replace(/[^a-z0-9]/g, '').trim()
  }

  return tokens.join(' ')
}

/**
 * Calcula a distância de Levenshtein entre duas strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const d: number[][] = []
  for (let i = 0; i <= m; i++) {
    d[i] = [i]
  }
  for (let j = 0; j <= n; j++) {
    d[0][j] = j
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // exclusão
        d[i][j - 1] + 1, // inserção
        d[i - 1][j - 1] + cost, // substituição
      )
    }
  }

  return d[m][n]
}

/**
 * Calcula similaridade entre duas strings de 0 a 1 (1 = idêntico).
 */
export function stringSimilarity(strA: string, strB: string): number {
  const cleanA = cleanTeamName(strA)
  const cleanB = cleanTeamName(strB)

  if (!cleanA || !cleanB) return 0
  if (cleanA === cleanB) return 1

  // Contém subpalavra exata (ex: "Palmeiras" dentro de "SE Palmeiras")
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    const minLen = Math.min(cleanA.length, cleanB.length)
    const maxLen = Math.max(cleanA.length, cleanB.length)
    return Math.max(0.8, minLen / maxLen)
  }

  const maxLen = Math.max(cleanA.length, cleanB.length)
  if (maxLen === 0) return 1
  const dist = levenshteinDistance(cleanA, cleanB)
  return Math.max(0, 1 - dist / maxLen)
}

/**
 * Status ao vivo oficiais reconhecidos pela API-Football.
 * 1H: First Half, 2H: Second Half, ET: Extra Time, P: Penalty in progress,
 * LIVE: Live, HT: Half Time, BT: Break Time.
 */
const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'])

export function isFixtureLive(statusShort?: string): boolean {
  if (!statusShort) return false
  return LIVE_STATUSES.has(statusShort.toUpperCase().trim())
}

/**
 * Realiza o matching fuzzy de um jogo do bolão contra a lista de fixtures da API-Football.
 *
 * @param jogoTimeA Nome do time A cadastrado no bolão
 * @param jogoTimeB Nome do time B cadastrado no bolão
 * @param fixtures Lista de fixtures retornadas pela API-Football
 * @param minSimilarity Limiar mínimo de similaridade para cada time (padrão 0.6)
 */
export function matchGameWithApiFixtures(
  jogoTimeA: string,
  jogoTimeB: string,
  fixtures: ApiFootballFixture[],
  minSimilarity = 0.6,
): MatchedLiveScore | null {
  if (!fixtures || fixtures.length === 0 || !jogoTimeA || !jogoTimeB) {
    return null
  }

  let bestMatch: {
    fixture: ApiFootballFixture
    score: number
    isHomeA: boolean
  } | null = null

  for (const f of fixtures) {
    const homeName = f.teams?.home?.name || ''
    const awayName = f.teams?.away?.name || ''
    if (!homeName || !awayName) continue

    // Tentativa 1: jogoTimeA = Home, jogoTimeB = Away
    const simAHome = stringSimilarity(jogoTimeA, homeName)
    const simBAway = stringSimilarity(jogoTimeB, awayName)
    const directScore = (simAHome + simBAway) / 2

    // Tentativa 2: jogoTimeA = Away, jogoTimeB = Home (ordem invertida no cadastro manual)
    const simAAway = stringSimilarity(jogoTimeA, awayName)
    const simBHome = stringSimilarity(jogoTimeB, homeName)
    const invertedScore = (simAAway + simBHome) / 2

    if (
      simAHome >= minSimilarity &&
      simBAway >= minSimilarity &&
      (!bestMatch || directScore > bestMatch.score)
    ) {
      bestMatch = { fixture: f, score: directScore, isHomeA: true }
    } else if (
      simAAway >= minSimilarity &&
      simBHome >= minSimilarity &&
      (!bestMatch || invertedScore > bestMatch.score)
    ) {
      bestMatch = { fixture: f, score: invertedScore, isHomeA: false }
    }
  }

  if (!bestMatch) {
    return null
  }

  const { fixture, isHomeA } = bestMatch
  const goalsHome = fixture.goals?.home ?? 0
  const goalsAway = fixture.goals?.away ?? 0

  const placarA = isHomeA ? goalsHome : goalsAway
  const placarB = isHomeA ? goalsAway : goalsHome

  const statusShort = fixture.fixture?.status?.short || ''
  const statusLong = fixture.fixture?.status?.long || ''
  const elapsed = fixture.fixture?.status?.elapsed ?? null
  const isLive = isFixtureLive(statusShort)

  // Label amigável de exibição
  let displayLabel = `AO VIVO ${placarA} x ${placarB}`
  if (statusShort === 'HT') {
    displayLabel = `AO VIVO (Intervalo) ${placarA} x ${placarB}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarA} x ${placarB}`
  } else if (!isLive && (statusShort === 'FT' || statusShort === 'AET' || statusShort === 'PEN')) {
    displayLabel = `Fim de Jogo (API) ${placarA} x ${placarB}`
  }

  return {
    found: true,
    fixtureId: fixture.fixture?.id,
    homeTeamName: fixture.teams?.home?.name || '',
    awayTeamName: fixture.teams?.away?.name || '',
    placarA,
    placarB,
    statusShort,
    statusLong,
    elapsed,
    isLive,
    displayLabel,
  }
}
