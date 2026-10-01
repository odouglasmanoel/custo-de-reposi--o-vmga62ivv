// src/lib/flags.ts
// Helper de bandeiras de seleções nacionais via FlagCDN
// Retorna a URL https://flagcdn.com/w80/{iso}.png para seleções conhecidas

/**
 * Normaliza o nome do time para comparação:
 * - lowercase
 * - remove acentos (NFD)
 * - remove caracteres que não sejam letras ou números
 * - remove termos comuns como 'selecao', 'selecao de', 'national team'
 */
export function normalizeCountryName(name?: string | null): string {
  if (!name) return ''
  let s = String(name).toLowerCase()
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch {
    /* ignore */
  }
  // Remove pontuações e espaços extras
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  const tokens = s.split(/\s+/).filter(Boolean)
  const stopWords = new Set([
    'selecao',
    'national',
    'team',
    'de',
    'da',
    'do',
    'dos',
    'das',
    'e',
    'the',
  ])
  const filtered = tokens.filter((t) => !stopWords.has(t))
  return filtered.join('') || tokens.join('')
}

/**
 * Mapeamento normalizado de seleções para códigos ISO 3166-1 alpha-2 (ou códigos específicos do FlagCDN, ex: gb-eng, gb-sct, gb-wls, gb-nir)
 */
export const SELECAO_FLAG_MAP: Record<string, string> = {
  // Mapeamento mínimo estritamente exigido pelo usuário:
  jamaica: 'jm',
  honduras: 'hn',
  elsalvador: 'sv',
  salvador: 'sv',
  martinica: 'mq',
  martinique: 'mq',
  montserrat: 'ms',
  ilhasvirgensbritanicas: 'vg',
  virgensbritanicas: 'vg',
  britishvirginislands: 'vg',
  saomartinho: 'sx',
  saintmartin: 'sx',
  sintmaarten: 'sx',
  ilhasvirgensamericanas: 'vi',
  virgensamericanas: 'vi',
  usvirginislands: 'vi',
  saovicentegranadinas: 'vc',
  saovicenteegranadinas: 'vc',
  saintvincent: 'vc',
  saintvincentandthegrenadines: 'vc',
  saintvincentgrenadines: 'vc',
  guianafrancesa: 'gf',
  frenchguiana: 'gf',
  tchequia: 'cz',
  czechia: 'cz',
  czechrepublic: 'cz',
  republicatcheca: 'cz',
  croacia: 'hr',
  croatia: 'hr',
  georgia: 'ge',
  irlandadonorte: 'gb-nir',
  northernireland: 'gb-nir',
  italia: 'it',
  italy: 'it',
  belgica: 'be',
  belgium: 'be',
  turquia: 'tr',
  turkey: 'tr',
  turkiye: 'tr',
  franca: 'fr',
  france: 'fr',
  portugal: 'pt',
  dinamarca: 'dk',
  denmark: 'dk',
  noruega: 'no',
  norway: 'no',
  inglaterra: 'gb-eng',
  england: 'gb-eng',
  espanha: 'es',
  spain: 'es',
  escocia: 'gb-sct',
  scotland: 'gb-sct',
  paisdegales: 'gb-wls',
  gales: 'gb-wls',
  wales: 'gb-wls',
  cymru: 'gb-wls',
  alba: 'gb-sct',
  japao: 'jp',
  japan: 'jp',
  uruguai: 'uy',
  uruguay: 'uy',

  // Seleções comuns adicionais:
  brasil: 'br',
  brazil: 'br',
  argentina: 'ar',
  alemanha: 'de',
  germany: 'de',
  deutschland: 'de',
  holanda: 'nl',
  paisesbaixos: 'nl',
  netherlands: 'nl',
  estadosunidos: 'us',
  usa: 'us',
  eua: 'us',
  mexico: 'mx',
  canada: 'ca',
  colombia: 'co',
  chile: 'cl',
  peru: 'pe',
  equador: 'ec',
  ecuador: 'ec',
  paraguai: 'py',
  paraguay: 'py',
  venezuela: 've',
  bolivia: 'bo',
  catar: 'qa',
  qatar: 'qa',
  marrocos: 'ma',
  morocco: 'ma',
  senegal: 'sn',
  gana: 'gh',
  ghana: 'gh',
  nigeria: 'ng',
  camaroes: 'cm',
  cameroon: 'cm',
  coreiadosul: 'kr',
  southkorea: 'kr',
  coreiadonorte: 'kp',
  arabiasaudita: 'sa',
  saudiarabia: 'sa',
  ira: 'ir',
  iran: 'ir',
  australia: 'au',
  suica: 'ch',
  switzerland: 'ch',
  suecia: 'se',
  sweden: 'se',
  polonia: 'pl',
  poland: 'pl',
  servia: 'rs',
  serbia: 'rs',
  ucrania: 'ua',
  ukraine: 'ua',
  austria: 'at',
  hungria: 'hu',
  hungary: 'hu',
  eslovenia: 'si',
  slovenia: 'si',
  eslovaquia: 'sk',
  slovakia: 'sk',
  romenia: 'ro',
  romania: 'ro',
  albania: 'al',
  costarica: 'cr',
  panama: 'pa',
  guatemala: 'gt',
  trinidadetobago: 'tt',
  trinidadandtobago: 'tt',
  trinidadtobago: 'tt',
  haiti: 'ht',
  cuba: 'cu',
  curacao: 'cw',
  curacau: 'cw',
  suriname: 'sr',
  guiana: 'gy',
  guyana: 'gy',
  emiradosarabesunidos: 'ae',
  emiradosarabes: 'ae',
  uae: 'ae',
  bahrein: 'bh',
  bahrain: 'bh',
  iemen: 'ye',
  yemen: 'ye',
  oma: 'om',
  oman: 'om',
  kuwait: 'kw',
  iraque: 'iq',
  iraq: 'iq',
  jordania: 'jo',
  jordan: 'jo',
  egito: 'eg',
  egypt: 'eg',
  argelia: 'dz',
  algeria: 'dz',
  tunisia: 'tn',
  africadosul: 'za',
  southafrica: 'za',
  costadomarfim: 'ci',
  ivorycoast: 'ci',
  grecia: 'gr',
  greece: 'gr',
  irlanda: 'ie',
  ireland: 'ie',
  republicofireland: 'ie',
  republicadeirlanda: 'ie',
  republicairlanda: 'ie',
  finlandia: 'fi',
  finland: 'fi',
  islandia: 'is',
  iceland: 'is',

  // Novas seleções solicitadas (PT -> EN -> ISO 3166-1 alpha-2):
  // Letônia / Latvia -> lv
  letonia: 'lv',
  latvia: 'lv',
  latvija: 'lv',

  // Chipre / Cyprus -> cy
  chipre: 'cy',
  cyprus: 'cy',
  kypros: 'cy',

  // Armênia / Armenia -> am
  armenia: 'am',
  hayastan: 'am',

  // Montenegro -> me
  montenegro: 'me',
  crnagora: 'me',

  // Zimbábue / Zimbabwe -> zw
  zimbabue: 'zw',
  zimbabwe: 'zw',

  // República Democrática do Congo / DR Congo / Democratic Republic of the Congo / RD Congo / Congo Democrático -> cd
  republicademocraticadocongo: 'cd',
  republicademocraticacongo: 'cd',
  democraticrepublicofthecongo: 'cd',
  democraticrepubliccongo: 'cd',
  drcongo: 'cd',
  rdcongo: 'cd',
  congodemocratico: 'cd',
  congodr: 'cd',
  drc: 'cd',

  // República do Congo / Congo (Brazzaville) para evitar ambiguidade com RD Congo -> cg
  republicadocongo: 'cg',
  republicacongo: 'cg',
  republicofthecongo: 'cg',
  congo: 'cg',
  congobrazzaville: 'cg',

  // Guiné Equatorial / Equatorial Guinea -> gq
  guineequatorial: 'gq',
  equatorialguinea: 'gq',

  // Serra Leoa / Sierra Leone -> sl
  serraleoa: 'sl',
  sierraleone: 'sl',

  // República Centro-Africana / Central African Republic / Centro-Africana -> cf
  republicacentroafricana: 'cf',
  centroafricana: 'cf',
  centralafricanrepublic: 'cf',
  republiquecentrafricaine: 'cf',
  car: 'cf',

  // Burkina Faso -> bf
  burkinafaso: 'bf',
  burkina: 'bf',

  // Lituânia / Lithuania -> lt
  lituania: 'lt',
  lithuania: 'lt',
  lietuva: 'lt',

  // Azerbaijão / Azerbaijan -> az
  azerbaijao: 'az',
  azerbaijan: 'az',
  azerbaycan: 'az',
}

/**
 * Retorna o código ISO do país se o nome fornecido for uma seleção nacional conhecida.
 * Suporta busca direta por código ISO alpha-2, nome normalizado no dicionário e busca sanitizada.
 */
export function getCountryIsoCode(teamName?: string | null): string | null {
  if (!teamName) return null
  const trimmed = teamName.trim()
  if (!trimmed) return null

  // Se o próprio texto informado já for um código ISO de 2 letras (ex: 'lv', 'cy', 'ie', 'am')
  // ou um subcódigo FlagCDN de 6 caracteres (ex: 'gb-nir', 'gb-eng', 'gb-sct', 'gb-wls')
  const rawLower = trimmed.toLowerCase()
  if (/^[a-z]{2}$/.test(rawLower)) {
    // Verifica se esse código ISO de 2 letras existe como valor no SELECAO_FLAG_MAP
    const validCodes = new Set(Object.values(SELECAO_FLAG_MAP))
    if (validCodes.has(rawLower)) {
      return rawLower
    }
  }
  if (/^gb-(nir|eng|sct|wls)$/.test(rawLower)) {
    return rawLower
  }

  // 1. Busca normalizada direta (remove acentos, stop words de/da/do/the/national/team/seleção, etc.)
  const key = normalizeCountryName(trimmed)
  if (key && SELECAO_FLAG_MAP[key]) {
    return SELECAO_FLAG_MAP[key]
  }

  // 2. Busca sanitizada simples (apenas sem acentos e sem caracteres não-alfanuméricos, preservando palavras)
  try {
    const rawSanitized = trimmed
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (rawSanitized && SELECAO_FLAG_MAP[rawSanitized]) {
      return SELECAO_FLAG_MAP[rawSanitized]
    }
  } catch {
    /* ignore */
  }

  return null
}

// Versão/timestamp estável da sessão para cache-busting de bandeiras FlagCDN
export const FLAG_CDN_CACHE_VERSION = '20260925_v1'

/**
 * Retorna a URL FlagCDN https://flagcdn.com/w80/{iso}.png para seleções conhecidas, ou null se não for seleção.
 * Suporta parâmetro opcional cacheBust (ex: ?v=...) para prevenir cache quebrado em navegadores mobile.
 */
export function getFlagCdnUrl(
  teamName?: string | null,
  options?: { cacheBust?: boolean | string },
): string | null {
  const iso = getCountryIsoCode(teamName)
  if (!iso) return null
  const base = `https://flagcdn.com/w80/${iso.toLowerCase()}.png`
  if (options?.cacheBust) {
    const v = typeof options.cacheBust === 'string' ? options.cacheBust : FLAG_CDN_CACHE_VERSION
    return `${base}?v=${v}`
  }
  return base
}

/**
 * Verifica se um time é uma seleção nacional conhecida
 */
export function isNationalTeam(teamName?: string | null): boolean {
  return Boolean(getCountryIsoCode(teamName))
}

/**
 * IDs conhecidos e verificados da API-Sports exclusivos de Seleções Nacionais.
 * URLs com estes IDs específicos podem ser usadas para seleções sem risco de contaminação por clubes.
 */
/**
 * Mapeamento estático local dos principais clubes brasileiros e internacionais
 * para resolução imediata de escudos oficiais na API-Football (media.api-sports.io).
 */
export const OFFICIAL_CLUB_TEAM_IDS: Record<string, number> = {
  botafogo: 120,
  'botafogo rj': 120,
  'botafogo fr': 120,
  bfr: 120,
  vasco: 133,
  'vasco da gama': 133,
  'cr vasco da gama': 133,
  flamengo: 127,
  fluminense: 124,
  palmeiras: 121,
  corinthians: 131,
  saopaulo: 126,
  'sao paulo': 126,
  santos: 128,
  gremio: 130,
  internacional: 119,
  inter: 119,
  atleticomineiro: 1062,
  'atletico mineiro': 1062,
  'atletico-mg': 1062,
  cruzeiro: 135,
  bahia: 118,
  fortaleza: 154,
  athleticopr: 134,
  'athletico paranaense': 134,
  'athletico-pr': 134,
  coritiba: 132,
  'coritiba fbc': 132,
  cfc: 132,
  coxa: 132,
  chapecoense: 147,
  'chapecoense af': 147,
  chape: 147,
  acf: 147,
  vitoria: 140,
  cuiaba: 1200,
  criciuma: 141,
  juventude: 152,
  goias: 144,
  sport: 794,
  ceara: 129,
  avai: 138,
  psg: 85,
  'paris saint germain': 85,
  'paris saint-germain': 85,
  realmadrid: 541,
  'real madrid': 541,
  barcelona: 529,
  manchestercity: 50,
  'manchester city': 50,
  liverpool: 40,
}

export function getClubTeamId(teamName?: string | null): number | null {
  if (!teamName) return null
  const clean = normalizeCountryName(teamName)
  if (OFFICIAL_CLUB_TEAM_IDS[clean]) {
    return OFFICIAL_CLUB_TEAM_IDS[clean]
  }
  const stripped = clean.replace(/[^a-z0-9]/g, '')
  if (OFFICIAL_CLUB_TEAM_IDS[stripped]) {
    return OFFICIAL_CLUB_TEAM_IDS[stripped]
  }
  return null
}

export function getClubLogoUrl(teamName?: string | null): string | null {
  const teamId = getClubTeamId(teamName)
  return teamId ? `https://media.api-sports.io/football/teams/${teamId}.png` : null
}

export const OFFICIAL_NATIONAL_TEAM_IDS: Record<string, number> = {
  franca: 2,
  france: 2,
  belgica: 1,
  belgium: 1,
  croacia: 3,
  croatia: 3,
  brasil: 6,
  brazil: 6,
  uruguai: 7,
  uruguay: 7,
  espanha: 9,
  spain: 9,
  inglaterra: 10,
  england: 10,
  dinamarca: 21,
  denmark: 21,
  alemanha: 25,
  germany: 25,
  argentina: 26,
  portugal: 27,
  turquia: 777,
  turkey: 777,
  turkiye: 777,
  italia: 768,
  italy: 768,
  paisdegales: 767,
  gales: 767,
  wales: 767,
  escocia: 1108,
  scotland: 1108,
  irlandadonorte: 771,
  northernireland: 771,
  noruega: 1090,
  norway: 1090,
  georgia: 1104,
  holanda: 1118,
  paisesbaixos: 1118,
  netherlands: 1118,
  lituania: 1097,
  lithuania: 1097,
  azerbaijao: 1096,
  azerbaijan: 1096,
}

/**
 * Valida se uma URL da API-Sports é comprovadamente o escudo oficial da seleção nacional
 */
export function isOfficialNationalTeamBadge(teamName: string, url?: string | null): boolean {
  if (!url) return false
  const norm = normalizeCountryName(teamName)
  const expectedId = OFFICIAL_NATIONAL_TEAM_IDS[norm]
  if (expectedId && url.includes(`/teams/${expectedId}.`)) {
    return true
  }
  return false
}

/**
 * Verifica se uma URL é sabidamente escudo de clube incorreto/contaminado
 * (ex: Köln 192.png, B.S.C., TheSportsDB, ou outros escudos genéricos de clubes associados a seleções)
 */
export function isContaminatedBadge(teamName: string, url?: string | null): boolean {
  if (!url) return false
  const lowerUrl = url.toLowerCase()

  // TheSportsDB é estritamente proibido
  if (lowerUrl.includes('thesportsdb.com')) return true

  // Köln / Cologne (192.png) nunca deve aparecer para seleções como Turquia, Bélgica, PSG etc.
  if (
    lowerUrl.includes('/192.') ||
    lowerUrl.includes('/192_') ||
    lowerUrl.includes('koln') ||
    lowerUrl.includes('cologne')
  ) {
    return true
  }

  // B.S.C. corrompido (ex.: z3v04x)
  if (lowerUrl.includes('z3v04x') || lowerUrl.includes('bsc') || lowerUrl.includes('b.s.c')) {
    return true
  }

  return false
}

/**
 * Retorna a melhor URL de escudo com a prioridade estrita exigida:
 * - Se for Seleção Nacional:
 *     1. Se a URL fornecida (savedBadge ou liveOrCacheBadge) for comprovadamente da seleção na API-Sports
 *        (sem contaminação de clubes conhecidos) -> pode ser utilizada.
 *     2. Caso contrário -> SEMPRE retorna FlagCDN (https://flagcdn.com/w80/{iso}.png).
 *     3. Seleção nacional NUNCA recebe logo de clube, de cache local contaminado ou TheSportsDB.
 *     4. Se não houver bandeira no mapa -> null (monograma).
 * - Se for Clube:
 *     1. Escudo oficial salvo (media.api-sports.io)
 *     2. Dados ao vivo / cache existentes (se válidos)
 *     3. null (caindo para monograma)
 */
// Cache em memória compartilhado para logos buscados por fixtureId / fichaDetalhes
export const fixtureLogosMemoryCache = new Map<string, { home: string; away: string }>()

// In-flight promises para deduplicar requisições para a mesma fixture
const inFlightFixtureRequests = new Map<string, Promise<{ home: string; away: string } | null>>()

/**
 * Extrai logo de mandante/visitante do campo ficha_detalhes (JSON da API-Sports).
 */
export function extractLogosFromFichaDetalhes(
  fichaDetalhes?: any,
): { home?: string; away?: string } | null {
  if (!fichaDetalhes) return null
  let data = fichaDetalhes
  // Desembrulha recursivamente caso chegue serializado como string JSON dupla ou simples
  while (typeof data === 'string') {
    const trimmed = data.trim()
    if (!trimmed) return null
    try {
      data = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  if (!data || typeof data !== 'object') return null

  // Se o objeto envolver uma resposta padrão { teams: { home: { logo }, away: { logo } } }
  // ou { fixture: ..., teams: ... } ou resposta direta de array
  const item = Array.isArray(data) ? data[0] : data
  if (!item || typeof item !== 'object') return null

  const teams =
    item.teams ||
    (item.fixture && item.fixture.teams) ||
    (item.response && Array.isArray(item.response) && item.response[0]?.teams) ||
    (item.response && !Array.isArray(item.response) && item.response?.teams)

  if (teams) {
    const home = teams.home?.logo || teams.home?.badge || undefined
    const away = teams.away?.logo || teams.away?.badge || undefined
    if (home || away) {
      return { home, away }
    }
  }
  return null
}

/**
 * Busca e memoiza escudos de um jogo por fixture_id de forma assíncrona.
 * Consulta fixtureLogosMemoryCache primeiro, depois o endpoint autenticado /backend/v1/enquetes/fixture-detalhes.
 */
export async function fetchAndCacheFixtureLogos(
  fixtureId: string | number,
): Promise<{ home: string; away: string } | null> {
  const cleanId = String(fixtureId || '')
    .replace(/\D/g, '')
    .trim()
  if (!cleanId) return null

  if (fixtureLogosMemoryCache.has(cleanId)) {
    return fixtureLogosMemoryCache.get(cleanId)!
  }

  if (inFlightFixtureRequests.has(cleanId)) {
    return inFlightFixtureRequests.get(cleanId)!
  }

  const p = (async () => {
    try {
      // Importa dinamicamente ou faz fetch direto ao endpoint oficial memoizado
      const token =
        typeof window !== 'undefined' ? (window as any).pocketbase?.authStore?.token : ''
      const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
      const res = await fetch(
        `${baseUrl}/backend/v1/enquetes/fixture-detalhes?id=${encodeURIComponent(cleanId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
      if (!res.ok) return null
      const json = await res.json().catch(() => null)
      if (json?.success && json?.fixture) {
        const home = json.fixture.homeTeamLogo || ''
        const away = json.fixture.awayTeamLogo || ''
        const result = { home, away }
        fixtureLogosMemoryCache.set(cleanId, result)
        return result
      }
      return null
    } catch {
      return null
    } finally {
      inFlightFixtureRequests.delete(cleanId)
    }
  })()

  inFlightFixtureRequests.set(cleanId, p)
  return p
}

/**
 * Retorna a melhor URL de escudo com a prioridade estrita em 4 níveis:
 * 1. Logo salvo em ficha_detalhes do registro do jogo ou url_escudo salva no banco (grátis, sem API)
 * 2. Logo em cache de fixture_id (fixtureLogosMemoryCache) ou busca sob demanda associada à fixture
 * 3. Cache local (readEscudoCache / liveOrCacheBadge)
 * 4. Bandeira oficial da seleção (FlagCDN) ou sigla/monograma (null)
 */
export function resolveTeamBadgeUrl(params: {
  teamName: string
  savedBadge?: string | null
  liveOrCacheBadge?: string | null
  fixtureId?: string | number | null
  fichaDetalhes?: any
  isSide?: 'home' | 'away'
  isCorrompido?: (name: string, url?: string | null) => boolean
  cacheBust?: boolean | string
}): string | null {
  const {
    teamName,
    savedBadge,
    liveOrCacheBadge,
    fixtureId,
    fichaDetalhes,
    isSide,
    isCorrompido,
    cacheBust,
  } = params
  if (!teamName) return null

  const checkCorrompido = isCorrompido || (() => false)
  const isSelecao = isNationalTeam(teamName)
  const flagUrl = getFlagCdnUrl(teamName, { cacheBust })

  // 1. Extrai logos de ficha_detalhes se fornecido (custo zero de cota)
  let fichaBadge: string | null = null
  if (fichaDetalhes) {
    const extracted = extractLogosFromFichaDetalhes(fichaDetalhes)
    if (extracted) {
      if (isSide === 'home' && extracted.home) {
        fichaBadge = extracted.home
      } else if (isSide === 'away' && extracted.away) {
        fichaBadge = extracted.away
      } else if (!isSide) {
        // Se isSide não foi passado explicitamente, tenta deduzir ou usa home se compatível
        fichaBadge = extracted.home || extracted.away || null
      }
    }
  }

  // 2. Extrai de fixtureLogosMemoryCache se fixtureId fornecido
  let fixtureCachedBadge: string | null = null
  if (fixtureId) {
    const cleanId = String(fixtureId).replace(/\D/g, '').trim()
    if (cleanId && fixtureLogosMemoryCache.has(cleanId)) {
      const c = fixtureLogosMemoryCache.get(cleanId)!
      if (isSide === 'home' && c.home) {
        fixtureCachedBadge = c.home
      } else if (isSide === 'away' && c.away) {
        fixtureCachedBadge = c.away
      } else if (!isSide) {
        fixtureCachedBadge = c.home || c.away || null
      }
    }
  }

  // Se tiver fichaBadge ou fixtureCachedBadge que não seja corrompido, podemos usar como candidato de alta prioridade
  const badgeLevel1 =
    fichaBadge &&
    !checkCorrompido(teamName, fichaBadge) &&
    !isContaminatedBadge(teamName, fichaBadge)
      ? fichaBadge
      : null
  const badgeLevel2 =
    fixtureCachedBadge &&
    !checkCorrompido(teamName, fixtureCachedBadge) &&
    !isContaminatedBadge(teamName, fixtureCachedBadge)
      ? fixtureCachedBadge
      : null

  if (isSelecao) {
    // 1. Nível 1: ficha_detalhes ou savedBadge oficial da seleção (ou URL válida media.api-sports.io que não seja contaminada)
    if (badgeLevel1) {
      if (isOfficialNationalTeamBadge(teamName, badgeLevel1)) {
        return badgeLevel1
      }
      if (badgeLevel1.includes('media.api-sports.io')) {
        return badgeLevel1
      }
    }
    if (
      savedBadge &&
      !isContaminatedBadge(teamName, savedBadge) &&
      !checkCorrompido(teamName, savedBadge)
    ) {
      if (isOfficialNationalTeamBadge(teamName, savedBadge)) {
        return savedBadge
      }
      if (savedBadge.includes('media.api-sports.io')) {
        return savedBadge
      }
    }

    // Nível 2: fixture memoizada com logo oficial da seleção
    if (badgeLevel2) {
      if (isOfficialNationalTeamBadge(teamName, badgeLevel2)) {
        return badgeLevel2
      }
      if (badgeLevel2.includes('media.api-sports.io')) {
        return badgeLevel2
      }
    }

    // Nível 3: liveOrCacheBadge oficial da seleção sem contaminação
    if (
      liveOrCacheBadge &&
      !isContaminatedBadge(teamName, liveOrCacheBadge) &&
      !checkCorrompido(teamName, liveOrCacheBadge)
    ) {
      if (isOfficialNationalTeamBadge(teamName, liveOrCacheBadge)) {
        return liveOrCacheBadge
      }
      if (liveOrCacheBadge.includes('media.api-sports.io')) {
        return liveOrCacheBadge
      }
    }

    // Nível 4: Bandeira FlagCDN da seleção nacional
    if (flagUrl) {
      return flagUrl
    }

    if (badgeLevel1) return badgeLevel1
    if (
      savedBadge &&
      !isContaminatedBadge(teamName, savedBadge) &&
      !checkCorrompido(teamName, savedBadge)
    )
      return savedBadge
    if (badgeLevel2) return badgeLevel2
    if (
      liveOrCacheBadge &&
      !isContaminatedBadge(teamName, liveOrCacheBadge) &&
      !checkCorrompido(teamName, liveOrCacheBadge)
    )
      return liveOrCacheBadge

    return null
  }

  // --- Caso Clube ---
  // Mapeamento estrito prioritário para Coritiba e Chapecoense (evita qualquer inversão residual ou heurística de sigla)
  const normLower = normalizeCountryName(teamName)
  const normClean = normLower.replace(/[^a-z0-9]/g, '')
  if (
    normLower === 'coritiba' ||
    normClean === 'coritiba' ||
    normClean === 'cfc' ||
    normClean === 'coxa' ||
    normClean === 'coritibafbc'
  ) {
    // Se o savedBadge ou badgeLevel1 aponta erroneamente para 147 (Chapecoense), descarta e usa 132
    if (badgeLevel1 && (badgeLevel1.includes('/147.') || badgeLevel1.includes('/147_'))) {
      // Ignora badgeLevel1 invertido
    } else if (badgeLevel1 && badgeLevel1.includes('/132.')) {
      return badgeLevel1
    }
    if (savedBadge && (savedBadge.includes('/147.') || savedBadge.includes('/147_'))) {
      // Ignora savedBadge invertido
    } else if (savedBadge && savedBadge.includes('/132.')) {
      return savedBadge
    }
    return 'https://media.api-sports.io/football/teams/132.png'
  }

  if (
    normLower === 'chapecoense' ||
    normClean === 'chapecoense' ||
    normClean === 'chape' ||
    normClean === 'acf' ||
    normClean === 'chapecoenseaf'
  ) {
    // Se o savedBadge ou badgeLevel1 aponta erroneamente para 132 (Coritiba), descarta e usa 147
    if (badgeLevel1 && (badgeLevel1.includes('/132.') || badgeLevel1.includes('/132_'))) {
      // Ignora badgeLevel1 invertido
    } else if (badgeLevel1 && badgeLevel1.includes('/147.')) {
      return badgeLevel1
    }
    if (savedBadge && (savedBadge.includes('/132.') || savedBadge.includes('/132_'))) {
      // Ignora savedBadge invertido
    } else if (savedBadge && savedBadge.includes('/147.')) {
      return savedBadge
    }
    return 'https://media.api-sports.io/football/teams/147.png'
  }

  // Nível 1: ficha_detalhes do banco ou url salva oficial (media.api-sports.io)
  if (badgeLevel1 && badgeLevel1.includes('media.api-sports.io')) {
    return badgeLevel1
  }
  if (
    savedBadge &&
    savedBadge.includes('media.api-sports.io') &&
    !isContaminatedBadge(teamName, savedBadge) &&
    !checkCorrompido(teamName, savedBadge)
  ) {
    return savedBadge
  }
  if (badgeLevel1) {
    return badgeLevel1
  }
  if (
    savedBadge &&
    !isContaminatedBadge(teamName, savedBadge) &&
    !checkCorrompido(teamName, savedBadge)
  ) {
    return savedBadge
  }

  // Nível 2: Busca por fixtureId em cache memoizado
  if (badgeLevel2) {
    return badgeLevel2
  }

  // Nível 3: Dados ao vivo ou cache local existente
  if (
    liveOrCacheBadge &&
    !isContaminatedBadge(teamName, liveOrCacheBadge) &&
    !checkCorrompido(teamName, liveOrCacheBadge)
  ) {
    return liveOrCacheBadge
  }

  // Nível 3.5: Dicionário estático de clubes (Botafogo -> 120, Vasco -> 133, etc.)
  const clubFallback = getClubLogoUrl(teamName)
  if (clubFallback) {
    return clubFallback
  }

  // Nível 4: Fallback final (null => monograma / sigla)
  return null
}
