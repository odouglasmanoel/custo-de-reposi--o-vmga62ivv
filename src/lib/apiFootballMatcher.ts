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
  matchedBy?: 'fixture_id' | 'text'
}

/**
 * Converte diretamente uma fixture da API em um MatchedLiveScore para um confronto específico.
 * Se jogoTimeA e jogoTimeB forem informados, alinha o placar com base na correspondência de time A = home ou away.
 */
export function formatFixtureToLiveScore(
  fixture: ApiFootballFixture,
  jogoTimeA?: string,
  jogoTimeB?: string,
): MatchedLiveScore {
  const homeName = fixture.teams?.home?.name || ''
  const awayName = fixture.teams?.away?.name || ''

  // Extrai goals reais atualizados
  const rawHome =
    fixture.goals?.home != null && !isNaN(Number(fixture.goals.home))
      ? Number(fixture.goals.home)
      : fixture.score?.fulltime?.home != null && !isNaN(Number(fixture.score.fulltime.home))
        ? Number(fixture.score.fulltime.home)
        : fixture.score?.halftime?.home != null && !isNaN(Number(fixture.score.halftime.home))
          ? Number(fixture.score.halftime.home)
          : 0

  const rawAway =
    fixture.goals?.away != null && !isNaN(Number(fixture.goals.away))
      ? Number(fixture.goals.away)
      : fixture.score?.fulltime?.away != null && !isNaN(Number(fixture.score.fulltime.away))
        ? Number(fixture.score.fulltime.away)
        : fixture.score?.halftime?.away != null && !isNaN(Number(fixture.score.halftime.away))
          ? Number(fixture.score.halftime.away)
          : 0

  // Se informado os nomes cadastrados, verifica se time A é home ou away
  let isHomeA = true
  if (jogoTimeA && jogoTimeB && homeName && awayName) {
    const simAHome = stringSimilarity(jogoTimeA, homeName)
    const simAAway = stringSimilarity(jogoTimeA, awayName)
    if (simAAway > simAHome) {
      isHomeA = false
    }
  }

  const placarA = isHomeA ? rawHome : rawAway
  const placarB = isHomeA ? rawAway : rawHome

  const statusShort = fixture.fixture?.status?.short || ''
  const statusLong = fixture.fixture?.status?.long || ''
  const elapsed = fixture.fixture?.status?.elapsed ?? null
  const isLive = isFixtureLive(statusShort)
  const isFinished = isFixtureFinished(statusShort, statusLong)

  let displayLabel = `AO VIVO ${placarA} x ${placarB}`
  if (statusShort === 'HT' || statusShort === 'PAUSED' || statusLong.toUpperCase() === 'PAUSED') {
    displayLabel = `AO VIVO (Intervalo) ${placarA} x ${placarB}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarA} x ${placarB}`
  } else if (isFinished) {
    displayLabel = `Encerrado ${placarA} x ${placarB}`
  }

  const scorers: LiveScorerItem[] = []
  if (Array.isArray(fixture.scorers) && fixture.scorers.length > 0) {
    for (const s of fixture.scorers) {
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
  } else if (Array.isArray(fixture.events) && fixture.events.length > 0) {
    for (const ev of fixture.events) {
      const evAny = ev as any
      const rawPlayerName =
        evAny.player?.name ||
        evAny.playerName ||
        evAny.player_name ||
        evAny.scorer?.name ||
        evAny.scorer?.shortName ||
        evAny.player?.shortName ||
        evAny.strPlayer ||
        evAny.strPlayerName ||
        evAny.scorer ||
        ''
      if (ev && ev.type === 'Goal' && rawPlayerName) {
        const isOwnGoal = ev.detail && ev.detail.toLowerCase().includes('own')
        let scorerNameStr = String(rawPlayerName).trim()
        if (isOwnGoal) {
          scorerNameStr += ' (contra)'
        }
        scorers.push({
          name: scorerNameStr,
          minute: ev.time?.elapsed != null ? Number(ev.time.elapsed) : null,
          teamId: ev.team?.id ?? null,
          teamName: ev.team?.name ?? null,
          teamSide:
            fixture.teams?.home && ev.team && ev.team.id === fixture.teams.home.id
              ? 'home'
              : fixture.teams?.away && ev.team && ev.team.id === fixture.teams.away.id
                ? 'away'
                : null,
        })
      }
    }
  }

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
    homeTeamName: homeName,
    awayTeamName: awayName,
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
    matchedBy: 'fixture_id',
  }
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
  'u de quito': 'ldu quito',
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
  'club athletico paranaense': 'athletico paranaense',
  cap: 'athletico paranaense',
  // Atlético Mineiro
  'atletico mg': 'atletico mineiro',
  'atletico mineiro': 'atletico mineiro',
  'club atletico mineiro': 'atletico mineiro',
  'clube atletico mineiro': 'atletico mineiro',
  galo: 'atletico mineiro',
  cam: 'atletico mineiro',
  // América Mineiro
  'america mg': 'america mineiro',
  'america mineiro': 'america mineiro',
  coelho: 'america mineiro',
  // Botafogo
  'botafogo rj': 'botafogo',
  'botafogo fr': 'botafogo',
  bfr: 'botafogo',
  // Vasco
  'vasco da gama': 'vasco',
  'cr vasco da gama': 'vasco',
  crvg: 'vasco',
  // Palmeiras
  'se palmeiras': 'palmeiras',
  'palmeiras sp': 'palmeiras',
  'sociedade esportiva palmeiras': 'palmeiras',
  // Flamengo
  'cr flamengo': 'flamengo',
  'flamengo rj': 'flamengo',
  'clube de regatas do flamengo': 'flamengo',
  fla: 'flamengo',
  // Fluminense
  'fluminense fc': 'fluminense',
  'fluminense rj': 'fluminense',
  flu: 'fluminense',
  // Corinthians
  'sc corinthians': 'corinthians',
  'corinthians sp': 'corinthians',
  'sport club corinthians paulista': 'corinthians',
  timao: 'corinthians',
  // São Paulo
  'sao paulo fc': 'sao paulo',
  'sao paulo sp': 'sao paulo',
  spfc: 'sao paulo',
  // Santos
  'santos fc': 'santos',
  'santos sp': 'santos',
  // Grêmio
  'gremio fbpa': 'gremio',
  'gremio rs': 'gremio',
  'gremio porto alegrense': 'gremio',
  // Internacional
  'sc internacional': 'internacional',
  'internacional rs': 'internacional',
  'inter rs': 'internacional',
  inter: 'internacional',
  // Cruzeiro
  'cruzeiro ec': 'cruzeiro',
  'cruzeiro mg': 'cruzeiro',
  // Bahia
  'ec bahia': 'bahia',
  'bahia ba': 'bahia',
  // Fortaleza
  'fortaleza ec': 'fortaleza',
  'fortaleza ce': 'fortaleza',
  // River Plate
  'ca river plate': 'river plate',
  river: 'river plate',
  // Boca Juniors
  'ca boca juniors': 'boca juniors',
  boca: 'boca juniors',
  // Peñarol
  'ca penarol': 'penarol',
  'penarol uru': 'penarol',
  // Nacional
  'club nacional de football': 'nacional',
  'nacional uru': 'nacional',
  // Colo-Colo
  'csd colo colo': 'colo colo',
  'colo colo': 'colo colo',
  colocolo: 'colo colo',
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
    'del',
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

  // Substring / Subpalavra exata (ex: "LDU" dentro de "LDU Quito", "Atlético-MG" vs "Atletico-MG")
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    return 0.92
  }

  // Token matching: se qualquer palavra significativa coincide
  // Ex: "atletico mg" vs "atletico", ou "ldu" vs "ldu quito"
  const tokensA = cleanA.split(/\s+/).filter((t) => t.length >= 3)
  const tokensB = cleanB.split(/\s+/).filter((t) => t.length >= 3)
  const hasCommonToken = tokensA.some((tA) => tokensB.includes(tA))
  if (hasCommonToken && (tokensA.length <= 2 || tokensB.length <= 2)) {
    return 0.85
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
  return getFixtureDateSaoPaulo(rawDate)
}

/**
 * Converte qualquer string ISO ou Date de partida para YYYY-MM-DD no fuso America/Sao_Paulo (UTC-3).
 */
export function getFixtureDateSaoPaulo(dateInput?: string | Date | null): string | null {
  if (!dateInput) return null
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
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
 * Verifica se a partida está adiada (PST / POSTPONED).
 */
export function isFixturePostponed(statusShort?: string, statusLong?: string): boolean {
  const s = (statusShort || '').toUpperCase().trim()
  const l = (statusLong || '').toUpperCase().trim()
  return s === 'PST' || s === 'POSTP' || l === 'POSTPONED' || l === 'MATCH POSTPONED'
}

/**
 * Verifica se a partida foi cancelada ou suspensa (CANC / CANCELLED / SUSP / ABD).
 */
export function isFixtureCancelled(statusShort?: string, statusLong?: string): boolean {
  const s = (statusShort || '').toUpperCase().trim()
  const l = (statusLong || '').toUpperCase().trim()
  return (
    s === 'CANC' ||
    s === 'CANCELLED' ||
    s === 'SUSP' ||
    s === 'ABD' ||
    l === 'CANCELLED' ||
    l === 'MATCH CANCELLED' ||
    l === 'SUSPENDED' ||
    l === 'MATCH SUSPENDED' ||
    l === 'ABANDONED' ||
    l === 'MATCH ABANDONED'
  )
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
  // Extrai goals reais atualizados. Se fixture.goals.home/away for null ou undefined,
  // tenta obter de score.fulltime ou score.halftime antes de recorrer a 0.
  const rawHome =
    fixture.goals?.home != null && !isNaN(Number(fixture.goals.home))
      ? Number(fixture.goals.home)
      : fixture.score?.fulltime?.home != null && !isNaN(Number(fixture.score.fulltime.home))
        ? Number(fixture.score.fulltime.home)
        : fixture.score?.halftime?.home != null && !isNaN(Number(fixture.score.halftime.home))
          ? Number(fixture.score.halftime.home)
          : 0

  const rawAway =
    fixture.goals?.away != null && !isNaN(Number(fixture.goals.away))
      ? Number(fixture.goals.away)
      : fixture.score?.fulltime?.away != null && !isNaN(Number(fixture.score.fulltime.away))
        ? Number(fixture.score.fulltime.away)
        : fixture.score?.halftime?.away != null && !isNaN(Number(fixture.score.halftime.away))
          ? Number(fixture.score.halftime.away)
          : 0

  const placarA = isHomeA ? rawHome : rawAway
  const placarB = isHomeA ? rawAway : rawHome

  const statusShort = fixture.fixture?.status?.short || ''
  const statusLong = fixture.fixture?.status?.long || ''
  const elapsed = fixture.fixture?.status?.elapsed ?? null
  const isLive = isFixtureLive(statusShort)
  const isFinished = isFixtureFinished(statusShort, statusLong)

  // Label amigável de exibição
  const stUpper = statusShort.toUpperCase().trim()
  const longUpper = statusLong.toUpperCase().trim()
  const isPostponed =
    stUpper === 'PST' ||
    stUpper === 'POSTP' ||
    longUpper === 'POSTPONED' ||
    longUpper === 'MATCH POSTPONED'
  const isCancelled =
    stUpper === 'CANC' ||
    stUpper === 'CANCELLED' ||
    stUpper === 'SUSP' ||
    stUpper === 'ABD' ||
    longUpper === 'CANCELLED' ||
    longUpper === 'MATCH CANCELLED' ||
    longUpper === 'SUSPENDED' ||
    longUpper === 'MATCH SUSPENDED' ||
    longUpper === 'ABANDONED' ||
    longUpper === 'MATCH ABANDONED'

  let displayLabel = `AO VIVO ${placarA} x ${placarB}`
  if (isPostponed) {
    displayLabel = 'Adiado'
  } else if (isCancelled) {
    displayLabel = 'Cancelado'
  } else if (
    statusShort === 'HT' ||
    statusShort === 'PAUSED' ||
    statusLong.toUpperCase() === 'PAUSED'
  ) {
    displayLabel = `AO VIVO (Intervalo) ${placarA} x ${placarB}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarA} x ${placarB}`
  } else if (isFinished) {
    displayLabel = `Encerrado ${placarA} x ${placarB}`
  }

  // Processamento e formatação de autores dos gols
  // Prioridade 1: se fixture.scorers já veio pré-processado do backend
  // Prioridade 2: se fixture.events contiver eventos do tipo Goal
  const scorers: LiveScorerItem[] = []

  if (Array.isArray(fixture.scorers) && fixture.scorers.length > 0) {
    for (const s of fixture.scorers) {
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
  } else if (Array.isArray(fixture.events) && fixture.events.length > 0) {
    for (const ev of fixture.events) {
      const evAny = ev as any
      const rawPlayerName =
        evAny.player?.name ||
        evAny.playerName ||
        evAny.player_name ||
        evAny.scorer?.name ||
        evAny.scorer?.shortName ||
        evAny.player?.shortName ||
        evAny.strPlayer ||
        evAny.strPlayerName ||
        evAny.scorer ||
        ''
      if (ev && ev.type === 'Goal' && rawPlayerName) {
        const isOwnGoal = ev.detail && ev.detail.toLowerCase().includes('own')
        let scorerNameStr = String(rawPlayerName).trim()
        if (isOwnGoal) {
          scorerNameStr += ' (contra)'
        }
        scorers.push({
          name: scorerNameStr,
          minute: ev.time?.elapsed != null ? Number(ev.time.elapsed) : null,
          teamId: ev.team?.id ?? null,
          teamName: ev.team?.name ?? null,
          teamSide:
            fixture.teams?.home && ev.team && ev.team.id === fixture.teams.home.id
              ? 'home'
              : fixture.teams?.away && ev.team && ev.team.id === fixture.teams.away.id
                ? 'away'
                : null,
        })
      }
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
    matchedBy: 'text',
  }
}

/**
 * Resolve o placar ao vivo para um jogo do Bolão respeitando a prioridade:
 * 1. Se o jogo possui `fixture_id` preenchido, busca a fixture correspondente por ID exato.
 * 2. Se não houver fixture_id ou se o ID não for encontrado na lista de fixtures,
 *    executa o matching por texto / sinônimos como fallback.
 */
export function resolveLiveScoreForGame(
  jogo: { time_a: string; time_b: string; fixture_id?: string | null; data?: string },
  apiFixtures: ApiFootballFixture[],
  minSimilarity = 0.55,
  jogoDataISO?: string | null,
): MatchedLiveScore | null {
  const cleanFixtureId = (jogo.fixture_id || '').trim()

  // Prioridade 1: ID direto da partida
  if (cleanFixtureId && Array.isArray(apiFixtures) && apiFixtures.length > 0) {
    const directMatch = apiFixtures.find((f) => {
      const fId = f.fixture?.id
      return fId != null && String(fId).trim() === cleanFixtureId
    })

    if (directMatch) {
      return formatFixtureToLiveScore(directMatch, jogo.time_a, jogo.time_b)
    }
  }

  // Prioridade 2 (Fallback): Matching por texto / sinônimos
  return matchGameWithApiFixtures(jogo.time_a, jogo.time_b, apiFixtures, minSimilarity, jogoDataISO)
}
