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

export interface MatchScoreDerivationResult {
  homeScore: number | null
  awayScore: number | null
  derivedFromEvents: boolean
  validGoalEventsCount: number
}

/**
 * Deriva os placares de mandante e visitante a partir dos eventos oficiais da partida.
 * Regras:
 * - Filtra apenas eventos válidos do tipo 'Goal' / 'goal'.
 * - Exclui expressamente pênalti perdido ('missed penalty', 'pênalti perdido', 'penalty missed').
 * - Exclui disputas de pênaltis pós-jogo ('shootout', 'penalty shootout', 'disputa de pênaltis').
 * - Gol normal e pênalti convertido creditam ao time do evento (prioritariamente por team ID).
 * - Gol contra ('own goal', 'gol contra') credita ao ADVERSÁRIO do time do evento.
 * - Se não houver eventos de gol válidos, preserva o placar bruto (rawHomeScore / rawAwayScore).
 * - Se houver eventos de gol válidos, o placar derivado é a soma exata por time.
 */
export function deriveScoresFromEvents(
  events?: any[] | null,
  homeTeamId?: number | string | null,
  awayTeamId?: number | string | null,
  rawHomeScore?: number | null,
  rawAwayScore?: number | null,
  homeTeamName?: string | null,
  awayTeamName?: string | null,
): MatchScoreDerivationResult {
  const normHomeId =
    homeTeamId != null && String(homeTeamId).trim() ? String(homeTeamId).trim() : null
  const normAwayId =
    awayTeamId != null && String(awayTeamId).trim() ? String(awayTeamId).trim() : null
  const cleanHome = homeTeamName ? cleanTeamName(homeTeamName) : ''
  const cleanAway = awayTeamName ? cleanTeamName(awayTeamName) : ''

  if (!Array.isArray(events) || events.length === 0) {
    return {
      homeScore: rawHomeScore ?? null,
      awayScore: rawAwayScore ?? null,
      derivedFromEvents: false,
      validGoalEventsCount: 0,
    }
  }

  let derivedHome = 0
  let derivedAway = 0
  let validGoalEventsCount = 0

  for (const ev of events) {
    if (!ev) continue
    const typeStr = (ev.type || ev.category || '').toString().toLowerCase().trim()
    const detailStr = (ev.detail || '').toString().toLowerCase().trim()
    const commentsStr = (ev.comments || '').toString().toLowerCase().trim()

    // Considera apenas eventos de gol
    if (!typeStr.includes('goal') && typeStr !== 'gol') {
      continue
    }

    // Exclui pênaltis perdidos
    if (
      detailStr.includes('missed') ||
      detailStr.includes('perdido') ||
      commentsStr.includes('missed') ||
      commentsStr.includes('perdido')
    ) {
      continue
    }

    // Exclui disputa de pênaltis pós-tempo normal/prorrogação
    if (
      detailStr.includes('shootout') ||
      detailStr.includes('penalty shootout') ||
      commentsStr.includes('shootout') ||
      typeStr.includes('shootout')
    ) {
      continue
    }

    // É um gol válido
    validGoalEventsCount++

    const isOwnGoal =
      detailStr.includes('own') ||
      detailStr.includes('contra') ||
      commentsStr.includes('own goal') ||
      commentsStr.includes('contra')

    const evTeamId =
      ev.team?.id != null && String(ev.team.id).trim() ? String(ev.team.id).trim() : null
    const evTeamName = (ev.team?.name || '').toString().trim()
    const cleanEvTeam = evTeamName ? cleanTeamName(evTeamName) : ''
    const evTeamSide = ev.team?.side || ev.teamSide || null

    // 1. Determina se o evento pertence ao mandante ou visitante
    let isEventHome: boolean | null = null

    // Prioridade máxima: ID
    if (evTeamId && (normHomeId || normAwayId)) {
      if (normHomeId && evTeamId === normHomeId) {
        isEventHome = true
      } else if (normAwayId && evTeamId === normAwayId) {
        isEventHome = false
      }
    }

    // Prioridade 2: Flag explícita side
    if (isEventHome === null && evTeamSide) {
      if (evTeamSide === 'home') isEventHome = true
      else if (evTeamSide === 'away') isEventHome = false
    }

    // Prioridade 3: Nome limpo / sinônimos
    if (isEventHome === null && cleanEvTeam) {
      const matchHome =
        cleanHome && (cleanHome.includes(cleanEvTeam) || cleanEvTeam.includes(cleanHome))
      const matchAway =
        cleanAway && (cleanAway.includes(cleanEvTeam) || cleanEvTeam.includes(cleanAway))
      if (matchHome && !matchAway) {
        isEventHome = true
      } else if (matchAway && !matchHome) {
        isEventHome = false
      }
    }

    // Se ainda não casou e temos fallback de times
    if (isEventHome === null) {
      // Default conservador: se não casar de jeito nenhum, assume mandante apenas se não houver visitante
      isEventHome = true
    }

    // 2. Destino do gol: se for gol contra, credita ao adversário
    let creditedToHome = isEventHome
    if (isOwnGoal) {
      creditedToHome = !isEventHome
    }

    if (creditedToHome) {
      derivedHome++
    } else {
      derivedAway++
    }
  }

  if (validGoalEventsCount === 0) {
    return {
      homeScore: rawHomeScore ?? null,
      awayScore: rawAwayScore ?? null,
      derivedFromEvents: false,
      validGoalEventsCount: 0,
    }
  }

  return {
    homeScore: derivedHome,
    awayScore: derivedAway,
    derivedFromEvents: true,
    validGoalEventsCount,
  }
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
  homeTeamLogo?: string
  awayTeamLogo?: string
  placarA: number | null
  placarB: number | null
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
  const homeTeamId = fixture.teams?.home?.id ?? null
  const awayTeamId = fixture.teams?.away?.id ?? null

  // Extrai goals reais atualizados. Quando null/undefined/indisponível na API, retorna null (nunca 0 falso).
  const rawHome: number | null =
    fixture.goals?.home != null && !isNaN(Number(fixture.goals.home))
      ? Number(fixture.goals.home)
      : fixture.score?.fulltime?.home != null && !isNaN(Number(fixture.score.fulltime.home))
        ? Number(fixture.score.fulltime.home)
        : fixture.score?.halftime?.home != null && !isNaN(Number(fixture.score.halftime.home))
          ? Number(fixture.score.halftime.home)
          : null

  const rawAway: number | null =
    fixture.goals?.away != null && !isNaN(Number(fixture.goals.away))
      ? Number(fixture.goals.away)
      : fixture.score?.fulltime?.away != null && !isNaN(Number(fixture.score.fulltime.away))
        ? Number(fixture.score.fulltime.away)
        : fixture.score?.halftime?.away != null && !isNaN(Number(fixture.score.halftime.away))
          ? Number(fixture.score.halftime.away)
          : null

  // Deriva o placar dos eventos oficiais da partida (gols válidos, excluindo pênaltis perdidos e disputa pós-jogo; gol contra vai pro adversário)
  const scoreDerivation = deriveScoresFromEvents(
    fixture.events,
    homeTeamId,
    awayTeamId,
    rawHome,
    rawAway,
    homeName,
    awayName,
  )

  const effectiveHomeScore = scoreDerivation.homeScore
  const effectiveAwayScore = scoreDerivation.awayScore

  // Se informado os nomes cadastrados, verifica se time A é home ou away
  let isHomeA = true
  if (jogoTimeA && jogoTimeB && homeName && awayName) {
    const simAHome = stringSimilarity(jogoTimeA, homeName)
    const simAAway = stringSimilarity(jogoTimeA, awayName)
    if (simAAway > simAHome) {
      isHomeA = false
    }
  }

  const placarA = isHomeA ? effectiveHomeScore : effectiveAwayScore
  const placarB = isHomeA ? effectiveAwayScore : effectiveHomeScore

  const statusShort = fixture.fixture?.status?.short || ''
  const statusLong = fixture.fixture?.status?.long || ''
  const elapsed = fixture.fixture?.status?.elapsed ?? null
  const isLive = isFixtureLive(statusShort)
  const isFinished = isFixtureFinished(statusShort, statusLong)

  const placarLabelStr = placarA !== null && placarB !== null ? `${placarA} x ${placarB}` : '— x —'

  let displayLabel = `AO VIVO ${placarLabelStr}`
  if (statusShort === 'HT' || statusShort === 'PAUSED' || statusLong.toUpperCase() === 'PAUSED') {
    displayLabel = `AO VIVO (Intervalo) ${placarLabelStr}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarLabelStr}`
  } else if (isFinished) {
    displayLabel = `Encerrado ${placarLabelStr}`
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
      const evDetail = (ev?.detail || '').toString().toLowerCase()
      const isMissedPenalty = evDetail.includes('missed') || evDetail.includes('perdido')
      if (ev && ev.type === 'Goal' && rawPlayerName && !isMissedPenalty) {
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

  const homeLogo = isHomeA ? fixture.teams?.home?.logo || '' : fixture.teams?.away?.logo || ''
  const awayLogo = isHomeA ? fixture.teams?.away?.logo || '' : fixture.teams?.home?.logo || ''

  return {
    found: true,
    fixtureId: fixture.fixture?.id,
    provider: fixture.provider,
    homeTeamName: homeName,
    awayTeamName: awayName,
    homeTeamLogo: homeLogo,
    awayTeamLogo: awayLogo,
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
  // PSG / Paris Saint-Germain
  psg: 'paris saint germain',
  'paris sg': 'paris saint germain',
  'paris saint germain': 'paris saint germain',
  'paris saint-germain': 'paris saint germain',
  'paris s.g.': 'paris saint germain',
  // Olympique de Marseille / Marseille
  marseille: 'olympique marseille',
  'olympique marseille': 'olympique marseille',
  'olympique de marseille': 'olympique marseille',
  'olimpia de marsella': 'olympique marseille',
  om: 'olympique marseille',
  // Bournemouth / AFC Bournemouth
  bournemouth: 'bournemouth',
  'afc bournemouth': 'bournemouth',
  // Atlético de Madrid / Atlético Madrid
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'club atletico de madrid': 'atletico madrid',
  atleti: 'atletico madrid',
  // Liverpool
  liverpool: 'liverpool',
  'liverpool fc': 'liverpool',
  // Internazionale / Inter de Milão
  internazionale: 'inter milan',
  'inter milan': 'inter milan',
  'inter de milao': 'inter milan',
  'fc internazionale': 'inter milan',
  // Sporting
  'sporting cp': 'sporting lisbon',
  'sporting lisbon': 'sporting lisbon',
  'sporting clube de portugal': 'sporting lisbon',
  // Athletic Club
  'athletic club': 'athletic bilbao',
  'athletic bilbao': 'athletic club',
  // Bayern
  'bayern munich': 'bayern munchen',
  'bayern de munique': 'bayern munchen',
  'fc bayern': 'bayern munchen',
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

  // Remove partículas e prefixos genéricos (NÃO remover "real")
  const noiseWords = [
    'afc',
    'fc',
    'f.c.',
    'sc',
    's.c.',
    'ac',
    'a.c.',
    'cf',
    'c.f.',
    'cd',
    'c.d.',
    'sd',
    's.d.',
    'clube',
    'club',
    'ec',
    'e.c.',
    'cr',
    'c.r.',
    'se',
    's.e.',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'del',
    'esporte',
    'futebol',
    'futbol',
    'sport',
    'association',
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
  // PROIBIDO matching de substring cega para siglas/palavras muito curtas (<= 3 letras como cfc/acf) que causam colisões
  const minCleanLen = Math.min(cleanA.length, cleanB.length)
  if (minCleanLen >= 4 && (cleanA.includes(cleanB) || cleanB.includes(cleanA))) {
    return 0.92
  }

  // Token matching: apenas palavras significativas com pelo menos 4 caracteres para evitar colisão por siglas curtas
  const tokensA = cleanA.split(/\s+/).filter((t) => t.length >= 4)
  const tokensB = cleanB.split(/\s+/).filter((t) => t.length >= 4)
  const hasCommonToken = tokensA.some((tA) => tokensB.includes(tA))
  if (hasCommonToken && (tokensA.length <= 2 || tokensB.length <= 2)) {
    return 0.88
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
const FINISHED_STATUSES = new Set([
  'FT',
  'AET',
  'PEN',
  'FINISHED',
  'AOT',
  'POST',
  'MATCH FINISHED',
  'ENCERRADO',
  'FINALIZADO',
  'FULL TIME',
  'ENDED',
])

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
  // Extrai goals reais atualizados. Quando null/undefined/indisponível na API, retorna null (nunca 0 falso).
  const rawHome: number | null =
    fixture.goals?.home != null && !isNaN(Number(fixture.goals.home))
      ? Number(fixture.goals.home)
      : fixture.score?.fulltime?.home != null && !isNaN(Number(fixture.score.fulltime.home))
        ? Number(fixture.score.fulltime.home)
        : fixture.score?.halftime?.home != null && !isNaN(Number(fixture.score.halftime.home))
          ? Number(fixture.score.halftime.home)
          : null

  const rawAway: number | null =
    fixture.goals?.away != null && !isNaN(Number(fixture.goals.away))
      ? Number(fixture.goals.away)
      : fixture.score?.fulltime?.away != null && !isNaN(Number(fixture.score.fulltime.away))
        ? Number(fixture.score.fulltime.away)
        : fixture.score?.halftime?.away != null && !isNaN(Number(fixture.score.halftime.away))
          ? Number(fixture.score.halftime.away)
          : null

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

  const placarLabelStr = placarA !== null && placarB !== null ? `${placarA} x ${placarB}` : '— x —'

  let displayLabel = `AO VIVO ${placarLabelStr}`
  if (isPostponed) {
    displayLabel = 'Adiado'
  } else if (isCancelled) {
    displayLabel = 'Cancelado'
  } else if (
    statusShort === 'HT' ||
    statusShort === 'PAUSED' ||
    statusLong.toUpperCase() === 'PAUSED'
  ) {
    displayLabel = `AO VIVO (Intervalo) ${placarLabelStr}`
  } else if (elapsed && isLive) {
    displayLabel = `AO VIVO ${elapsed}' • ${placarLabelStr}`
  } else if (isFinished) {
    displayLabel = `Encerrado ${placarLabelStr}`
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
      const evDetail = (ev?.detail || '').toString().toLowerCase()
      const isMissedPenalty = evDetail.includes('missed') || evDetail.includes('perdido')
      if (ev && ev.type === 'Goal' && rawPlayerName && !isMissedPenalty) {
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

  const homeLogo = isHomeA ? fixture.teams?.home?.logo || '' : fixture.teams?.away?.logo || ''
  const awayLogo = isHomeA ? fixture.teams?.away?.logo || '' : fixture.teams?.home?.logo || ''

  return {
    found: true,
    fixtureId: fixture.fixture?.id,
    provider: fixture.provider,
    homeTeamName: fixture.teams?.home?.name || '',
    awayTeamName: fixture.teams?.away?.name || '',
    homeTeamLogo: homeLogo,
    awayTeamLogo: awayLogo,
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
