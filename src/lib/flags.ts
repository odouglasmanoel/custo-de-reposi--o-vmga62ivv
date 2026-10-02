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
  // --- Série A & B Brasil ---
  botafogo: 120,
  'botafogo rj': 120,
  'botafogo fr': 120,
  bfr: 120,
  vasco: 133,
  'vasco da gama': 133,
  'cr vasco da gama': 133,
  flamengo: 127,
  'cr flamengo': 127,
  fluminense: 124,
  'fluminense fc': 124,
  palmeiras: 121,
  'se palmeiras': 121,
  corinthians: 131,
  'sc corinthians': 131,
  'corinthians paulista': 131,
  sccp: 131,
  saopaulo: 126,
  'sao paulo': 126,
  'sao paulo fc': 126,
  spfc: 126,
  santos: 128,
  'santos fc': 128,
  santosfc: 128,
  gremio: 130,
  'gremio fbpa': 130,
  internacional: 119,
  inter: 119,
  'sc internacional': 119,
  sci: 119,
  atleticomineiro: 1062,
  'atletico mineiro': 1062,
  'atletico-mg': 1062,
  cam: 1062,
  cruzeiro: 135,
  'cruzeiro ec': 135,
  bahia: 118,
  'ec bahia': 118,
  fortaleza: 154,
  'fortaleza ec': 154,
  athleticopr: 134,
  'athletico paranaense': 134,
  'athletico-pr': 134,
  athletico: 134,
  'atletico paranaense': 134,
  'atletico-pr': 134,
  atleticopr: 134,
  coritiba: 132,
  'coritiba fbc': 132,
  cfc: 132,
  'coritiba fc': 132,
  coxa: 132,
  chapecoense: 147,
  'chapecoense af': 147,
  chape: 147,
  acf: 147,
  'chapecoense f': 147,
  vitoria: 136,
  'ec vitoria': 136,
  'esporte clube vitoria': 136,
  'e c vitoria': 136,
  criciuma: 140,
  'criciuma ec': 140,
  'criciuma esporte clube': 140,
  cuiaba: 1200,
  'cuiaba ec': 1200,
  juventude: 152,
  'ec juventude': 152,
  redbullbragantino: 1199,
  'red bull bragantino': 1199,
  bragantino: 1199,
  'r b bragantino': 1199,
  'rb bragantino': 1199,
  mirassol: 10214,
  'mirassol fc': 10214,
  remo: 10213,
  'clube do remo': 10213,
  goias: 144,
  'goias ec': 144,
  sport: 794,
  'sport recife': 794,
  ceara: 129,
  'ceara sc': 129,
  avai: 138,
  'avai fc': 138,
  pontepreta: 148,
  'ponte preta': 148,
  novorizontino: 10215,
  'gremio novorizontino': 10215,
  vila_nova: 141,
  'vila nova': 141,
  vilanova: 141,
  operario: 143,
  'operario pr': 143,
  'operario-pr': 143,
  'operario ferroviario': 143,
  amazonas: 18561,
  'amazonas fc': 18561,
  paysandu: 149,
  'paysandu sc': 149,
  brusque: 10216,
  'brusque fc': 10216,
  ituanofc: 145,
  ituano: 145,
  guarani: 146,
  'guarani fc': 146,
  botafogosp: 142,
  'botafogo sp': 142,
  'botafogo-sp': 142,
  crb: 150,
  'crb al': 150,
  america_mg: 137,
  'america mineiro': 137,
  'america-mg': 137,
  americamg: 137,
  londrina: 139,
  'londrina ec': 139,
  nautico: 151,
  'nautico pe': 151,
  figueirense: 153,
  'figueirense fc': 153,
  csa: 155,
  'csa al': 155,
  sampaio_correa: 156,
  'sampaio correa': 156,
  sampaiocorrea: 156,
  confianca: 157,
  'ad confianca': 157,
  brasil_de_pelotas: 158,
  'brasil de pelotas': 158,
  brasildepelotas: 158,
  oeste: 159,
  'oeste fc': 159,
  ferroviaria: 10218,
  'ferroviaria sp': 10218,
  athletic_club: 18560,
  'athletic club': 18560,
  athleticclub: 18560,
  volta_redonda: 10217,
  'volta redonda': 10217,
  voltaredonda: 10217,
  saobernardo: 10219,
  'sao bernardo': 10219,
  'sao bernardo fc': 10219,
  botafogopb: 10220,
  'botafogo pb': 10220,
  'botafogo-pb': 10220,
  ypiranga: 10221,
  'ypiranga rs': 10221,
  'ypiranga-rs': 10221,
  aprecidense: 10222,
  aparecidense: 10222,
  tombense: 10223,
  'tombense fc': 10223,
  ferroviario: 10224,
  'ferroviario ac': 10224,
  abc: 10225,
  'abc fc': 10225,
  caxias: 10226,
  'ser caxias': 10226,

  // --- Sul-Americana & Libertadores (CONMEBOL) ---
  bocajuniors: 451,
  'boca juniors': 451,
  'ca boca juniors': 451,
  boca: 451,
  riverplate: 435,
  'river plate': 435,
  'ca river plate': 435,
  river: 435,
  estudiantes: 450,
  'estudiantes de la plata': 450,
  'estudiantes lp': 450,
  'estudiantes l.p.': 450,
  estudianteslp: 450,
  montevideocitytorque: 2365,
  'montevideo city torque': 2365,
  'montevideo city': 2365,
  torque: 2365,
  'atletico torque': 2365,
  atletictorque: 2365,
  penarol: 2348,
  peñarol: 2348,
  nacional: 2356,
  'nacional montevideo': 2347,
  'club nacional': 2356,
  racingclub: 436,
  'racing club': 436,
  racing: 436,
  independiente: 453,
  'ca independiente': 453,
  sanlorenzo: 460,
  'san lorenzo': 460,
  velez: 438,
  'velez sarsfield': 438,
  lanus: 446,
  rosariocentral: 437,
  'rosario central': 437,
  newells: 455,
  'newells old boys': 455,
  "newell's old boys": 455,
  olimpia: 1182,
  'club olimpia': 1182,
  cerroporteno: 1176,
  'cerro porteño': 1176,
  'cerro porteno': 1176,
  libertad: 1179,
  'libertad asuncion': 1179,
  ldu: 1158,
  'ldu quito': 1158,
  'ldu de quito': 1158,
  universidadcentral: 3710,
  'universidad central': 3710,
  'universidad central de venezuela': 3710,
  ucv: 3710,
  'ucv fc': 3710,
  independientemedellin: 1137,
  'independiente medellin': 1137,
  'indep medellin': 1137,
  dim: 1137,
  independienterivadavia: 440,
  'independiente rivadavia': 440,
  independientesantafe: 1138,
  'independiente santa fe': 1138,
  'santa fe': 1138,
  macara: 1162,
  'cd macara': 1162,
  platense: 448,
  'ca platense': 448,
  cienciano: 2548,
  'club cienciano': 2548,
  independientedelvalle: 1153,
  'independiente del valle': 1153,
  barcelonasc: 1152,
  'barcelona sc': 1152,
  'barcelona de guayaquil': 1152,
  colo_colo: 2315,
  'colo colo': 2315,
  colocolo: 2315,
  universidaddechile: 2314,
  'universidad de chile': 2314,
  udechile: 2314,
  ucatolica: 2994,
  'universidad catolica': 2994,
  'u catolica': 2994,
  bolivar: 3702,
  thestrongest: 3703,
  'the strongest': 3703,
  sportingcristal: 2546,
  'sporting cristal': 2546,
  alianzalima: 2541,
  'alianza lima': 2541,
  universitario: 2540,
  'universitario de deportes': 2540,

  // --- Internacionais Europeus & Mundiais ---
  psg: 85,
  'paris saint germain': 85,
  'paris saint-germain': 85,
  realmadrid: 541,
  'real madrid': 541,
  barcelona: 529,
  'fc barcelona': 529,
  atleticodemadrid: 530,
  'atletico de madrid': 530,
  'atletico madrid': 530,
  manchestercity: 50,
  'manchester city': 50,
  manchesterunited: 33,
  'manchester united': 33,
  liverpool: 40,
  arsenal: 42,
  chelsea: 49,
  tottenham: 47,
  newcastle: 34,
  'newcastle united': 34,
  fulham: 36,
  'fulham fc': 36,
  lens: 116,
  'rc lens': 116,
  bayernmunique: 157,
  'bayern munique': 157,
  'bayern munich': 157,
  'bayern munchen': 157,
  borussiadortmund: 165,
  'borussia dortmund': 165,
  juventus: 496,
  milan: 489,
  'ac milan': 489,
  interdemilao: 505,
  'inter de milao': 505,
  'inter milan': 505,
  roma: 497,
  'as roma': 497,
  napoli: 492,
  benfica: 211,
  'sl benfica': 211,
  porto: 212,
  'fc porto': 212,
  sporting: 228,
  'sporting cp': 228,
  'sporting lisbon': 228,
  ajax: 194,
  alhilal: 2939,
  'al hilal': 2939,
  'al-hilal': 2939,
  alnassr: 2938,
  'al nassr': 2938,
  'al-nassr': 2938,
  intermiami: 8983,
  'inter miami': 8983,
  'inter miami cf': 8983,
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
  suica: 15,
  switzerland: 15,
  polonia: 24,
  poland: 24,
  servia: 14,
  serbia: 14,
  suecia: 29,
  sweden: 29,
  austria: 30,
  hungria: 769,
  hungary: 769,
  republicatcheca: 770,
  tchequia: 770,
  czechrepublic: 770,
  czechia: 770,
  romenia: 772,
  romania: 772,
  eslovaquia: 773,
  slovakia: 773,
  eslovenia: 774,
  slovenia: 774,
  albania: 775,
  grecia: 776,
  greece: 776,
  finlandia: 778,
  finland: 778,
  irlanda: 779,
  ireland: 779,
  islandia: 780,
  iceland: 780,
  ucrania: 781,
  ukraine: 781,
  estadosunidos: 2384,
  usa: 2384,
  mexico: 16,
  canada: 2382,
  colombia: 8,
  chile: 11,
  peru: 12,
  equador: 2381,
  ecuador: 2381,
  paraguai: 2383,
  paraguay: 2383,
  venezuela: 2380,
  bolivia: 2379,
  marrocos: 31,
  morocco: 31,
  senegal: 13,
  gana: 1504,
  ghana: 1504,
  nigeria: 19,
  camaroes: 1530,
  cameroon: 1530,
  costadomarfim: 1501,
  ivorycoast: 1501,
  egito: 32,
  egypt: 32,
  argelia: 28,
  algeria: 28,
  tunisia: 23,
  africadosul: 1507,
  southafrica: 1507,
  japao: 17,
  japan: 17,
  coreiadosul: 20,
  southkorea: 20,
  australia: 18,
  arabiasaudita: 22,
  saudiarabia: 22,
  catar: 1569,
  qatar: 1569,
  ira: 2385,
  iran: 2385,
  iraque: 1567,
  iraq: 1567,
}

/**
 * Dicionário multilíngue bidirecional de seleções e variações de nomes
 * (Português <-> Inglês <-> Espanhol <-> variações comuns)
 */
export const MULTILINGUAL_COUNTRY_SYNONYMS: Record<string, string[]> = {
  turquia: ['turkey', 'turkiye', 'tuerkei', 'turquia'],
  turkey: ['turquia', 'turkiye', 'tuerkei', 'turkey'],
  turkiye: ['turquia', 'turkey', 'tuerkei', 'turkiye'],
  belgica: ['belgium', 'belgique', 'belgien', 'belgica'],
  belgium: ['belgica', 'belgique', 'belgien', 'belgium'],
  alemanha: ['germany', 'deutschland', 'allemagne', 'alemanha'],
  germany: ['alemanha', 'deutschland', 'allemagne', 'germany'],
  franca: ['france', 'frankreich', 'francia', 'franca'],
  france: ['franca', 'frankreich', 'francia', 'france'],
  espanha: ['spain', 'espana', 'spanien', 'espagne', 'espanha'],
  spain: ['espanha', 'espana', 'spanien', 'espagne', 'spain'],
  inglaterra: ['england', 'angleterre', 'england', 'inglaterra'],
  england: ['inglaterra', 'angleterre', 'england'],
  italia: ['italy', 'italien', 'italie', 'italia'],
  italy: ['italia', 'italien', 'italie', 'italy'],
  holanda: ['netherlands', 'holland', 'paises baixos', 'paisesbaixos', 'pays bas', 'holanda'],
  netherlands: ['holanda', 'holland', 'paises baixos', 'paisesbaixos', 'pays bas', 'netherlands'],
  paisesbaixos: ['netherlands', 'holland', 'holanda', 'paises baixos', 'paisesbaixos'],
  croacia: ['croatia', 'kroatien', 'croatie', 'croacia'],
  croatia: ['croacia', 'kroatien', 'croatie', 'croatia'],
  dinamarca: ['denmark', 'danemark', 'daenemark', 'dinamarca'],
  denmark: ['dinamarca', 'danemark', 'daenemark', 'denmark'],
  portugal: ['portugal'],
  suica: ['switzerland', 'schweiz', 'suisse', 'svizzera', 'suica'],
  switzerland: ['suica', 'schweiz', 'suisse', 'svizzera', 'switzerland'],
  suecia: ['sweden', 'schweden', 'suede', 'suecia'],
  sweden: ['suecia', 'schweden', 'suede', 'sweden'],
  polonia: ['poland', 'polen', 'pologne', 'polonia'],
  poland: ['polonia', 'polen', 'pologne', 'poland'],
  servia: ['serbia', 'serbien', 'serbie', 'servia'],
  serbia: ['servia', 'serbien', 'serbie', 'serbia'],
  tchequia: [
    'czechia',
    'czech republic',
    'czechrepublic',
    'republica tcheca',
    'republicatcheca',
    'tchequia',
  ],
  czechia: [
    'tchequia',
    'czech republic',
    'czechrepublic',
    'republica tcheca',
    'republicatcheca',
    'czechia',
  ],
  czechrepublic: ['tchequia', 'czechia', 'republica tcheca', 'republicatcheca', 'czech republic'],
  austria: ['austria', 'oesterreich', 'autriche'],
  hungria: ['hungary', 'ungarn', 'hongrie', 'hungria'],
  hungary: ['hungria', 'ungarn', 'hongrie', 'hungary'],
  eslovenia: ['slovenia', 'slowenien', 'slovenie', 'eslovenia'],
  slovenia: ['eslovenia', 'slowenien', 'slovenie', 'slovenia'],
  eslovaquia: ['slovakia', 'slowakei', 'slovaquie', 'eslovaquia'],
  slovakia: ['eslovaquia', 'slowakei', 'slovaquie', 'slovakia'],
  romenia: ['romania', 'rumaenien', 'roumanie', 'romenia'],
  romania: ['romenia', 'rumaenien', 'roumanie', 'romania'],
  escocia: ['scotland', 'schottland', 'ecosse', 'escocia'],
  scotland: ['escocia', 'schottland', 'ecosse', 'scotland'],
  gales: ['wales', 'pays de gales', 'pais de gales', 'paisdegales', 'cymru', 'gales'],
  wales: ['gales', 'pays de gales', 'pais de gales', 'paisdegales', 'cymru', 'wales'],
  paisdegales: ['wales', 'gales', 'pays de gales', 'pais de gales', 'cymru'],
  irlandadonorte: [
    'northern ireland',
    'northernireland',
    'irlande du nord',
    'nordirland',
    'irlandadonorte',
  ],
  northernireland: ['irlanda do norte', 'irlandadonorte', 'northern ireland'],
  irlanda: ['ireland', 'irland', 'irlande', 'republic of ireland', 'irlanda'],
  ireland: ['irlanda', 'irland', 'irlande', 'republic of ireland', 'ireland'],
  grecia: ['greece', 'griechenland', 'grece', 'grecia'],
  greece: ['grecia', 'griechenland', 'grece', 'greece'],
  finlandia: ['finland', 'finnland', 'finlande', 'finlandia'],
  finland: ['finlandia', 'finnland', 'finlande', 'finland'],
  islandia: ['iceland', 'island', 'islande', 'islandia'],
  iceland: ['islandia', 'island', 'islande', 'iceland'],
  noruega: ['norway', 'norwegen', 'norvege', 'noruega'],
  norway: ['noruega', 'norwegen', 'norvege', 'norway'],
  ucrania: ['ukraine', 'ukraina', 'ucrania'],
  ukraine: ['ucrania', 'ukraina', 'ukraine'],
  georgia: ['georgia', 'georgie'],
  albania: ['albania', 'albanie', 'albanien'],
  estadosunidos: [
    'united states',
    'usa',
    'us',
    'eua',
    'etats unis',
    'estados unidos',
    'estadosunidos',
  ],
  usa: ['estados unidos', 'estadosunidos', 'united states', 'eua', 'usa'],
  mexico: ['mexico', 'mexique'],
  canada: ['canada'],
  brasil: ['brazil', 'brasilien', 'bresil', 'brasil'],
  brazil: ['brasil', 'brasilien', 'bresil', 'brazil'],
  argentina: ['argentina', 'argentine', 'argentinien'],
  uruguai: ['uruguay', 'uruguai'],
  uruguay: ['uruguai', 'uruguay'],
  colombia: ['colombia', 'colombie'],
  chile: ['chile', 'chili'],
  peru: ['peru', 'perou'],
  equador: ['ecuador', 'equateur', 'equador'],
  ecuador: ['equador', 'equateur', 'ecuador'],
  paraguai: ['paraguay', 'paraguai'],
  paraguay: ['paraguai', 'paraguay'],
  venezuela: ['venezuela'],
  bolivia: ['bolivia', 'bolivie'],
  marrocos: ['morocco', 'marokko', 'maroc', 'marruecos', 'marrocos'],
  morocco: ['marrocos', 'marokko', 'maroc', 'marruecos', 'morocco'],
  senegal: ['senegal'],
  gana: ['ghana', 'gana'],
  ghana: ['gana', 'ghana'],
  nigeria: ['nigeria'],
  camaroes: ['cameroon', 'kamerun', 'cameroun', 'camaroes'],
  cameroon: ['camaroes', 'kamerun', 'cameroun', 'cameroon'],
  costadomarfim: [
    'ivory coast',
    'cote d ivoire',
    'cotedivoire',
    'ivorycoast',
    'costa do marfim',
    'costadomarfim',
  ],
  ivorycoast: ['costa do marfim', 'costadomarfim', 'cote d ivoire', 'ivory coast'],
  egito: ['egypt', 'aegypten', 'egypte', 'egipto', 'egito'],
  egypt: ['egito', 'aegypten', 'egypte', 'egipto', 'egypt'],
  argelia: ['algeria', 'algerie', 'algerien', 'argelia'],
  algeria: ['argelia', 'algerie', 'algerien', 'algeria'],
  tunisia: ['tunisia', 'tunesien', 'tunisie'],
  africadosul: [
    'south africa',
    'southafrica',
    'suedafrika',
    'afrique du sud',
    'africa do sul',
    'africadosul',
  ],
  southafrica: ['africa do sul', 'africadosul', 'south africa'],
  japao: ['japan', 'japon', 'japao'],
  japan: ['japao', 'japon', 'japan'],
  coreiadosul: [
    'south korea',
    'southkorea',
    'suedkorea',
    'coree du sud',
    'coreia do sul',
    'coreiadosul',
  ],
  southkorea: ['coreia do sul', 'coreiadosul', 'south korea'],
  australia: ['australia', 'australie', 'australien'],
  arabiasaudita: [
    'saudi arabia',
    'saudiarabia',
    'saudi arabien',
    'arabie saoudite',
    'arabia saudita',
    'arabiasaudita',
  ],
  saudiarabia: ['arabia saudita', 'arabiasaudita', 'saudi arabia'],
  catar: ['qatar', 'catar'],
  qatar: ['catar', 'qatar'],
  ira: ['iran', 'ira'],
  iran: ['ira', 'iran'],
  lituania: ['lithuania', 'lietuva', 'litauen', 'lituanie', 'lituania'],
  lithuania: ['lituania', 'lietuva', 'litauen', 'lituanie', 'lithuania'],
  azerbaijao: ['azerbaijan', 'azerbaycan', 'aserbaidschan', 'azerbaidjan', 'azerbaijao'],
  azerbaijan: ['azerbaijao', 'azerbaycan', 'aserbaidschan', 'azerbaidjan', 'azerbaijan'],
}

/**
 * Verifica se dois nomes de equipes casam considerando grafias multilíngues (ex: Turkey <-> Turquia)
 */
export function matchTeamNamesMultilingual(nameA?: string | null, nameB?: string | null): boolean {
  if (!nameA || !nameB) return false
  const normA = normalizeCountryName(nameA)
  const normB = normalizeCountryName(nameB)
  if (!normA || !normB) return false
  if (normA === normB) return true

  // Substring simples
  if (normA.includes(normB) || normB.includes(normA)) return true

  // Verifica via dicionário multilíngue
  const synonymsA = MULTILINGUAL_COUNTRY_SYNONYMS[normA] || []
  for (const syn of synonymsA) {
    const normSyn = normalizeCountryName(syn)
    if (normSyn === normB || normSyn.includes(normB) || normB.includes(normSyn)) {
      return true
    }
  }

  const synonymsB = MULTILINGUAL_COUNTRY_SYNONYMS[normB] || []
  for (const syn of synonymsB) {
    const normSyn = normalizeCountryName(syn)
    if (normSyn === normA || normSyn.includes(normA) || normA.includes(normSyn)) {
      return true
    }
  }

  return false
}

/**
 * Resolve o Team ID oficial da API-Sports / API-Football para um time (seleção ou clube)
 */
export function resolveOfficialTeamId(
  teamName?: string | null,
  escudoUrl?: string | null,
): string | null {
  if (escudoUrl) {
    const m = String(escudoUrl).match(/teams\/(\d+)(?:\.png|\.svg|\.jpg|\b)/i)
    if (m) return String(m[1])
  }
  if (!teamName) return null
  const norm = normalizeCountryName(teamName)
  if (OFFICIAL_NATIONAL_TEAM_IDS[norm]) {
    return String(OFFICIAL_NATIONAL_TEAM_IDS[norm])
  }
  const clubId = getClubTeamId(teamName)
  if (clubId) {
    return String(clubId)
  }
  return null
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
    // 0. Nível 0: Dicionário estático canônico ou Bandeira FlagCDN da seleção nacional (PRIORIDADE MÁXIMA)
    if (flagUrl) {
      return flagUrl
    }

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
  // Prioridade 0: Dicionário Canônico Estático Oficial (RESOLUÇÃO SISTÊMICA INFALÍVEL)
  // Mapeia diretamente Red Bull Bragantino, Mirassol, Remo, Chapecoense, Coritiba, Grêmio etc.
  const staticClubBadge = getClubLogoUrl(teamName)
  if (staticClubBadge) {
    return staticClubBadge
  }

  // Mapeamento estrito prioritário e blindagem contra inversão para os 6 clubes específicos:
  // 1. Estudiantes de La Plata -> 450 (e NUNCA River Plate 435)
  // 2. Chapecoense -> 147 (e NUNCA Coritiba 132)
  // 3. Coritiba -> 132 (e NUNCA Chapecoense 147)
  // 4. Red Bull Bragantino -> 1199 (e NUNCA 130 Grêmio ou outros)
  // 5. Mirassol -> 10214
  // 6. Remo -> 10213 (e NUNCA 121 Palmeiras ou outros)
  const normLower = normalizeCountryName(teamName)
  const normClean = normLower.replace(/[^a-z0-9]/g, '')

  // Blindagem Estudiantes (450) x River Plate (435)
  if (
    normLower === 'estudiantes' ||
    normClean === 'estudiantes' ||
    normClean === 'estudiantesdelaplata' ||
    normClean === 'estudianteslp' ||
    normClean === 'est'
  ) {
    if (
      badgeLevel1 &&
      !badgeLevel1.includes('/435.') &&
      !badgeLevel1.includes('/435_') &&
      !badgeLevel1.includes('/435.png') &&
      badgeLevel1.includes('/450.')
    ) {
      return badgeLevel1
    }
    if (
      savedBadge &&
      !savedBadge.includes('/435.') &&
      !savedBadge.includes('/435_') &&
      !savedBadge.includes('/435.png') &&
      savedBadge.includes('/450.')
    ) {
      return savedBadge
    }
    if (
      badgeLevel2 &&
      !badgeLevel2.includes('/435.') &&
      !badgeLevel2.includes('/435_') &&
      !badgeLevel2.includes('/435.png') &&
      badgeLevel2.includes('/450.')
    ) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/435.') &&
      !liveOrCacheBadge.includes('/435_') &&
      !liveOrCacheBadge.includes('/435.png') &&
      liveOrCacheBadge.includes('/450.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/450.png'
  }

  // Blindagem River Plate (435)
  if (
    normLower === 'river plate' ||
    normClean === 'riverplate' ||
    normClean === 'river' ||
    normClean === 'cariverplate'
  ) {
    if (
      badgeLevel1 &&
      !badgeLevel1.includes('/450.') &&
      !badgeLevel1.includes('/450_') &&
      !badgeLevel1.includes('/450.png') &&
      badgeLevel1.includes('/435.')
    ) {
      return badgeLevel1
    }
    if (
      savedBadge &&
      !savedBadge.includes('/450.') &&
      !savedBadge.includes('/450_') &&
      !savedBadge.includes('/450.png') &&
      savedBadge.includes('/435.')
    ) {
      return savedBadge
    }
    if (
      badgeLevel2 &&
      !badgeLevel2.includes('/450.') &&
      !badgeLevel2.includes('/450_') &&
      !badgeLevel2.includes('/450.png') &&
      badgeLevel2.includes('/435.')
    ) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/450.') &&
      !liveOrCacheBadge.includes('/450_') &&
      !liveOrCacheBadge.includes('/450.png') &&
      liveOrCacheBadge.includes('/435.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/435.png'
  }

  // Blindagem Coritiba (132) x Chapecoense (147)
  if (
    normLower === 'coritiba' ||
    normClean === 'coritiba' ||
    normClean === 'cfc' ||
    normClean === 'coxa' ||
    normClean === 'coritibafbc'
  ) {
    if (
      badgeLevel1 &&
      !badgeLevel1.includes('/147.') &&
      !badgeLevel1.includes('/147_') &&
      !badgeLevel1.includes('/147.png') &&
      badgeLevel1.includes('/132.')
    ) {
      return badgeLevel1
    }
    if (
      savedBadge &&
      !savedBadge.includes('/147.') &&
      !savedBadge.includes('/147_') &&
      !savedBadge.includes('/147.png') &&
      savedBadge.includes('/132.')
    ) {
      return savedBadge
    }
    if (
      badgeLevel2 &&
      !badgeLevel2.includes('/147.') &&
      !badgeLevel2.includes('/147_') &&
      !badgeLevel2.includes('/147.png') &&
      badgeLevel2.includes('/132.')
    ) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/147.') &&
      !liveOrCacheBadge.includes('/147_') &&
      !liveOrCacheBadge.includes('/147.png') &&
      liveOrCacheBadge.includes('/132.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/132.png'
  }

  // Blindagem Chapecoense (147) x Coritiba (132)
  if (
    normLower === 'chapecoense' ||
    normClean === 'chapecoense' ||
    normClean === 'chape' ||
    normClean === 'acf' ||
    normClean === 'chapecoenseaf'
  ) {
    if (
      badgeLevel1 &&
      !badgeLevel1.includes('/132.') &&
      !badgeLevel1.includes('/132_') &&
      !badgeLevel1.includes('/132.png') &&
      badgeLevel1.includes('/147.')
    ) {
      return badgeLevel1
    }
    if (
      savedBadge &&
      !savedBadge.includes('/132.') &&
      !savedBadge.includes('/132_') &&
      !savedBadge.includes('/132.png') &&
      savedBadge.includes('/147.')
    ) {
      return savedBadge
    }
    if (
      badgeLevel2 &&
      !badgeLevel2.includes('/132.') &&
      !badgeLevel2.includes('/132_') &&
      !badgeLevel2.includes('/132.png') &&
      badgeLevel2.includes('/147.')
    ) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/132.') &&
      !liveOrCacheBadge.includes('/132_') &&
      !liveOrCacheBadge.includes('/132.png') &&
      liveOrCacheBadge.includes('/147.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/147.png'
  }

  // Blindagem Red Bull Bragantino (1199)
  if (
    normClean === 'redbullbragantino' ||
    normClean === 'bragantino' ||
    normClean === 'rbbragantino'
  ) {
    if (badgeLevel1 && !badgeLevel1.includes('/130.') && badgeLevel1.includes('/1199.')) {
      return badgeLevel1
    }
    if (savedBadge && !savedBadge.includes('/130.') && savedBadge.includes('/1199.')) {
      return savedBadge
    }
    if (badgeLevel2 && !badgeLevel2.includes('/130.') && badgeLevel2.includes('/1199.')) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/130.') &&
      liveOrCacheBadge.includes('/1199.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/1199.png'
  }

  // Blindagem Mirassol (10214)
  if (normClean === 'mirassol' || normClean === 'mirassolfc') {
    if (badgeLevel1 && badgeLevel1.includes('/10214.')) {
      return badgeLevel1
    }
    if (savedBadge && savedBadge.includes('/10214.')) {
      return savedBadge
    }
    if (badgeLevel2 && badgeLevel2.includes('/10214.')) {
      return badgeLevel2
    }
    if (liveOrCacheBadge && liveOrCacheBadge.includes('/10214.')) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/10214.png'
  }

  // Blindagem Remo (10213)
  if (normClean === 'remo' || normClean === 'clubedoremo') {
    if (badgeLevel1 && !badgeLevel1.includes('/121.') && badgeLevel1.includes('/10213.')) {
      return badgeLevel1
    }
    if (savedBadge && !savedBadge.includes('/121.') && savedBadge.includes('/10213.')) {
      return savedBadge
    }
    if (badgeLevel2 && !badgeLevel2.includes('/121.') && badgeLevel2.includes('/10213.')) {
      return badgeLevel2
    }
    if (
      liveOrCacheBadge &&
      !liveOrCacheBadge.includes('/121.') &&
      liveOrCacheBadge.includes('/10213.')
    ) {
      return liveOrCacheBadge
    }
    return 'https://media.api-sports.io/football/teams/10213.png'
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
