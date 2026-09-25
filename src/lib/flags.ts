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
  finlandia: 'fi',
  finland: 'fi',
  islandia: 'is',
  iceland: 'is',
}

/**
 * Retorna o código ISO do país se o nome fornecido for uma seleção nacional conhecida.
 */
export function getCountryIsoCode(teamName?: string | null): string | null {
  if (!teamName) return null
  const key = normalizeCountryName(teamName)
  if (!key) return null
  return SELECAO_FLAG_MAP[key] || null
}

/**
 * Retorna a URL FlagCDN https://flagcdn.com/w80/{iso}.png para seleções conhecidas, ou null se não for seleção.
 */
export function getFlagCdnUrl(teamName?: string | null): string | null {
  const iso = getCountryIsoCode(teamName)
  if (!iso) return null
  return `https://flagcdn.com/w80/${iso.toLowerCase()}.png`
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
  irlandadonorte: 771,
  northernireland: 771,
  noruega: 1090,
  norway: 1090,
  georgia: 1104,
  holanda: 1118,
  paisesbaixos: 1118,
  netherlands: 1118,
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
export function resolveTeamBadgeUrl(params: {
  teamName: string
  savedBadge?: string | null
  liveOrCacheBadge?: string | null
  isCorrompido?: (name: string, url?: string | null) => boolean
}): string | null {
  const { teamName, savedBadge, liveOrCacheBadge, isCorrompido } = params
  if (!teamName) return null

  const checkCorrompido = isCorrompido || (() => false)
  const isSelecao = isNationalTeam(teamName)
  const flagUrl = getFlagCdnUrl(teamName)

  if (isSelecao) {
    // 1. Se houver savedBadge oficial da seleção sem contaminação
    if (
      savedBadge &&
      !isContaminatedBadge(teamName, savedBadge) &&
      !checkCorrompido(teamName, savedBadge)
    ) {
      if (isOfficialNationalTeamBadge(teamName, savedBadge)) {
        return savedBadge
      }
    }

    // 2. Se houver liveOrCacheBadge oficial da seleção sem contaminação
    if (
      liveOrCacheBadge &&
      !isContaminatedBadge(teamName, liveOrCacheBadge) &&
      !checkCorrompido(teamName, liveOrCacheBadge)
    ) {
      if (isOfficialNationalTeamBadge(teamName, liveOrCacheBadge)) {
        return liveOrCacheBadge
      }
    }

    // 3. Para seleção nacional, se não há logo oficial certificado da API-Sports,
    // usar SEMPRE a bandeira oficial via FlagCDN
    if (flagUrl) {
      return flagUrl
    }

    return null
  }

  // --- Caso Clube ---
  // 1º Escudo oficial salvo (media.api-sports.io)
  if (
    savedBadge &&
    savedBadge.includes('media.api-sports.io') &&
    !isContaminatedBadge(teamName, savedBadge) &&
    !checkCorrompido(teamName, savedBadge)
  ) {
    return savedBadge
  }

  // Se salvou outra URL válida de clube
  if (
    savedBadge &&
    !isContaminatedBadge(teamName, savedBadge) &&
    !checkCorrompido(teamName, savedBadge)
  ) {
    return savedBadge
  }

  // 2º Dados ao vivo ou cache existente
  if (
    liveOrCacheBadge &&
    !isContaminatedBadge(teamName, liveOrCacheBadge) &&
    !checkCorrompido(teamName, liveOrCacheBadge)
  ) {
    return liveOrCacheBadge
  }

  return null
}
