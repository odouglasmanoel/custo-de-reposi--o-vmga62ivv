/**
 * Utilitários para correspondência fuzzy entre jogos cadastrados manualmente no Bolão
 * e fixtures da API-Football (api-sports / RapidAPI).
 */

export interface LiveScorerItem {
  name: string
  minute?: number | null
  teamId?: number | string | null
  teamName?: string | null
  teamSide?: 'home' | 'away' | null
}

export interface ApiFootballFixture {
  provider?: 'football_data' | 'thesportsdb' | 'api_football'
  fixture?: {
    id?: number | string
    date?: string
    timestamp?: number
    status?: {
      long?: string
      short?: string
      elapsed?: number | null
    }
  }
  teams?: {
    home?: {
      id?: number | string
      name?: string
      logo?: string
    }
    away?: {
      id?: number | string
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
  events?: Array<{
    type?: string
    detail?: string
    time?: { elapsed?: number | null }
    team?: { id?: number | string; name?: string }
    player?: { id?: number | string; name?: string }
  }>
  scorers?: LiveScorerItem[]
}

export interface MatchedLiveScore {
  found: boolean
  fixtureId?: number | string
  provider?: string
  homeTeamName: string
  awayTeamName: string
  placarA: number
  placarB: number
  statusShort: string
  statusLong: string
  elapsed: number | null
  isLive: boolean
  isFinished: boolean
  displayLabel: string
  scorers: LiveScorerItem[]
  golsSummary: string
}

/**
 * Remove acentos, pontuação, prefixos/sufixos comuns de clubes e espaços extras.
 */
/**
 * Tabela de sinônimos conhecidos e normalizações canônicas de times.
 * Muito comum em Libertadores e competições sul-americanas / brasileiras,
 * ex: "LDU" vs "Liga de Quito", "Athletico-PR" vs "Atlético Paranaense", etc.
 */
const TEAM_SYNONYMS: Record<string, string> = {
  // LDU Quito
  ldu: 'ldu quito',
  'ldu de quito': 'ldu quito',
  'ldu quito': 'ldu quito',
  'liga de quito': 'ldu quito',
  'liga deportiva universitaria': 'ldu quito',
  'liga deportiva universitaria de quito': 'ldu quito',
  // Independiente del Valle
  idv: 'independiente del valle',
  'independiente valle': 'independiente del valle',
  'independiente del valle': 'independiente del valle',
  // Cerro Porteño
  cerro: 'cerro porteno',
  'cerro porteno': 'cerro porteno',
  // Sporting Cristal
  'sporting cristal': 'cristal',
  // Red Bull Bragantino
  'red bull bragantino': 'bragantino',
  'rb bragantino': 'bragantino',
  bragantino: 'bragantino',
  // Athletico Paranaense
  athletico: 'athletico paranaense',
  'athletico pr': 'athletico paranaense',
  'atletico pr': 'athletico paranaense',
  'atletico paranaense': 'athletico paranaense',
  // Atlético Mineiro
  'atletico mg': 'atletico mineiro',
  'atletico mineiro': 'atletico mineiro',
  // América Mineiro
  'america mg': 'america mineiro',
  'america mineiro': 'america mineiro',
  // Botafogo
  'botafogo rj': 'botafogo',
  'botafogo fr': 'botafogo',
  // Vasco
  'vasco da gama': 'vasco',
  'cr vasco da gama': 'vasco',
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

  // Remove pontuação isolada mantendo caracteres alfanuméricos
  s = s.replace(/[^a-z0-9\s]/g, ' ')

  const rawTokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const rawClean = rawTokens.join(' ')

  // 1. Checa se a string inteira bate com algum sinônimo
  if (TEAM_SYNONYMS[rawClean]) {
    return TEAM_SYNONYMS[rawClean]
  }

  // Remove termos genéricos de clubes de futebol
  const noiseWords = [
    'fc',
    'f.c.',
    'ec',
    'e.c.',
    'cr',
    'c.r.',
    'se',
    's.e.',
    'sc',
    's.c.',
    'clube',
    'club',
    'de',
    'da',
    'do',
    'dos',
    'das',
    'esporte',
    'futebol',
    'futbol',
    'sport',
    'association',
    'afc',
    'cf',
    'c.f.',
    'sociedade',
    'esportiva',
  ]

  const tokens = rawTokens.filter((t) => !noiseWords.includes(t))

  // Se todos foram removidos por ruído (ex: time "Clube"), mantém original sanitizado
  if (tokens.length === 0) {
    return s.replace(/[^a-z0-9]/g, '').trim()
  }

  const result = tokens.join(' ')
  return TEAM_SYNONYMS[result] || result
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
const LIVE_STATUSES = new Set([
  '1H',
  '2H',
  'HT',
  'ET',
  'BT',
  'P',
  'LIVE',
  'INT',
  'IN_PLAY',
  'PAUSED',
  'IN PLAY',
])

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
/**
 * Converte data da fixture para string YYYY-MM-DD no fuso America/Sao_Paulo (UTC-3).
 */
export function extractFixtureDateSP(fixture: ApiFootballFixture): string | null {
  const rawDate = fixture.fixture?.date
  if (!rawDate) return null
  try {
    const d = new Date(rawDate)
    if (isNaN(d.getTime())) return null
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return formatter.format(d)
  } catch {
    return null
  }
}

/**
 * Status finalizados oficiais reconhecidos por Football-Data.org, TheSportsDB e API-Football.
 */
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FINISHED', 'AOT', 'POST', 'MATCH FINISHED'])

export function isFixtureFinished(statusShort?: string, statusLong?: string): boolean {
  if (statusShort && FINISHED_STATUSES.has(statusShort.toUpperCase().trim())) return true
  if (statusLong && FINISHED_STATUSES.has(statusLong.toUpperCase().trim())) return true
  return false
}

/**
 * Realiza o matching fuzzy de um jogo do bolão contra a lista de fixtures da API-Football.
 * Suporta filtro opcional por data (America/Sao_Paulo) para evitar cruzar confrontos
 * homônimos de datas/temporadas diferentes.
 *
 * @param jogoTimeA Nome do time A cadastrado no bolão
 * @param jogoTimeB Nome do time B cadastrado no bolão
 * @param fixtures Lista de fixtures retornadas pela API-Football
 * @param minSimilarity Limiar mínimo de similaridade para cada time (padrão 0.6)
 * @param jogoDataISO Data do jogo em formato YYYY-MM-DD (opcional)
 */
export function matchGameWithApiFixtures(
  jogoTimeA: string,
  jogoTimeB: string,
  fixtures: ApiFootballFixture[],
  minSimilarity = 0.6,
  jogoDataISO?: string | null,
): MatchedLiveScore | null {
  if (!fixtures || fixtures.length === 0 || !jogoTimeA || !jogoTimeB) {
    return null
  }

  let bestMatch: {
    fixture: ApiFootballFixture
    score: number
    isHomeA: boolean
    dateMatches: boolean
  } | null = null

  for (const f of fixtures) {
    const homeName = f.teams?.home?.name || ''
    const awayName = f.teams?.away?.name || ''
    if (!homeName || !awayName) continue

    // Verifica compatibilidade de data se informada
    const fixtureDateSP = extractFixtureDateSP(f)
    const dateMatches = Boolean(jogoDataISO && fixtureDateSP && jogoDataISO === fixtureDateSP)

    // Tentativa 1: jogoTimeA = Home, jogoTimeB = Away
    const simAHome = stringSimilarity(jogoTimeA, homeName)
    const simBAway = stringSimilarity(jogoTimeB, awayName)
    let directScore = (simAHome + simBAway) / 2

    // Tentativa 2: jogoTimeA = Away, jogoTimeB = Home (ordem invertida no cadastro manual)
    const simAAway = stringSimilarity(jogoTimeA, awayName)
    const simBHome = stringSimilarity(jogoTimeB, homeName)
    let invertedScore = (simAAway + simBHome) / 2

    // Bônus se a data for idêntica (fuso America/Sao_Paulo)
    if (dateMatches) {
      directScore += 0.15
      invertedScore += 0.15
    }

    if (
      simAHome >= minSimilarity &&
      simBAway >= minSimilarity &&
      (!bestMatch || directScore > bestMatch.score)
    ) {
      bestMatch = { fixture: f, score: directScore, isHomeA: true, dateMatches }
    } else if (
      simAAway >= minSimilarity &&
      simBHome >= minSimilarity &&
      (!bestMatch || invertedScore > bestMatch.score)
    ) {
      bestMatch = { fixture: f, score: invertedScore, isHomeA: false, dateMatches }
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
  const isFinished = isFixtureFinished(statusShort, statusLong)

  // Label amigável de exibição
  let displayLabel = `AO VIVO ${placarA} x ${placarB}`
  if (statusShort === 'HT' || statusShort === 'PAUSED' || statusLong.toUpperCase() === 'PAUSED') {
    displayLabel = `AO VIVO (Intervalo) ${placarA} x ${placarB}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarA} x ${placarB}`
  } else if (isFinished) {
    displayLabel = `Encerrado ${placarA} x ${placarB}`
  }

  // Processamento e formatação de autores dos gols
  const rawScorers = Array.isArray(fixture.scorers) ? fixture.scorers : []
  const scorers: LiveScorerItem[] = []

  for (const s of rawScorers) {
    if (s && s.name && s.name.trim()) {
      scorers.push({
        name: s.name.trim(),
        minute: s.minute != null && !isNaN(Number(s.minute)) ? Number(s.minute) : null,
        teamId: s.teamId ?? null,
        teamName: s.teamName ?? null,
        teamSide: s.teamSide ?? null,
      })
    }
  }

  // Monta resumo textual no formato: "Gols: Luis Segovia, Marlon Freitas" ou com minuto se disponível
  // Ex: "Gols: Luis Segovia 23', Marlon Freitas 45'" ou "Gols: Luis Segovia, Marlon Freitas"
  let golsSummary = ''
  if (scorers.length > 0) {
    const scorerTokens = scorers.map((s) => {
      if (s.minute) {
        return `${s.name} ${s.minute}'`
      }
      return s.name
    })
    golsSummary = `Gols: ${scorerTokens.join(', ')}`
  }

  return {
    found: true,
    fixtureId: fixture.fixture?.id,
    provider: fixture.provider,
    homeTeamName: fixture.teams?.home?.name || '',
    awayTeamName: fixture.teams?.away?.name || '',
    placarA,
    placarB,
    statusShort,
    statusLong,
    elapsed,
    isLive,
    isFinished,
    displayLabel,
    scorers,
    golsSummary,
  }
}
