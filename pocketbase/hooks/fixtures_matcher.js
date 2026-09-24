// pocketbase/hooks/fixtures_matcher.js
// Utilitário compartilhado para busca e resolução de fixture_id na API-Football
// Respeita estritamente o limitador centralizador (api_football_limiter.js),
// cota diária (reset às 21h) e normalização robusta com Levenshtein.

function normalizeStrHelper(str) {
  if (!str) return ''
  let s = String(str).toLowerCase()
  if (typeof s.normalize === 'function') {
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    } catch (_) {}
  }
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  const rawTokens = s.split(/\s+/).filter(Boolean)
  const stopWords = [
    'afc',
    'fc',
    'sc',
    'cf',
    'clube',
    'club',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'futebol',
    'ec',
    'cr',
    'ca',
    'sp',
    'rj',
    'mg',
    'rs',
    'pr',
    'esporte',
    'atletico',
    'atletica',
    'associacao',
    'united',
    'city',
  ]
  const cleanTokens = rawTokens.filter((t) => stopWords.indexOf(t) === -1)
  return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
}

function calcularLevenshteinHelper(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d = []
  for (let i = 0; i <= m; i++) d[i] = [i]
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i1 = 1; i1 <= m; i1++) {
    for (let j1 = 1; j1 <= n; j1++) {
      const cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
      d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
    }
  }
  return d[m][n]
}

function timesCoincidemHelper(a, b) {
  const normA = normalizeStrHelper(a)
  const normB = normalizeStrHelper(b)
  if (!normA || !normB) return false
  if (normA === normB) return true
  if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true

  const tA = normA.split(/\s+/).filter((t) => t.length >= 3)
  const tB = normB.split(/\s+/).filter((t) => t.length >= 3)
  for (let ti = 0; ti < tA.length; ti++) {
    if (tB.indexOf(tA[ti]) !== -1) {
      return true
    }
  }

  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return true
  const dist = calcularLevenshteinHelper(normA, normB)
  return 1 - dist / maxLen >= 0.75
}

function formatarDataISO(dataRaw) {
  if (!dataRaw) return ''
  const str = String(dataRaw).trim()
  const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
  }
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }
  return ''
}

function obterApiKeyApiFootball() {
  let apiKey = ''
  try {
    const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    if (cfgRec) apiKey = (cfgRec.getString('api_key') || '').trim()
  } catch (_) {}

  if (!apiKey) {
    if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
      apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
    } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
      apiKey = ($secrets.get('RAPIDAPI_KEY') || '').trim()
    } else if ($os && $os.getenv) {
      apiKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
    }
  }
  return apiKey
}

/**
 * Busca fixture_id na API-Football (ou cache jogos_do_dia) combinando data + timeA + timeB.
 * Retorna string vazia se não encontrar ou cota esgotada.
 * NUNCA lança exceção fatal.
 */
function buscarFixtureIdNaApi(timeA, timeB, dataRaw) {
  if (!timeA || !timeB) return ''

  // 1. Tenta resolver primeiro via jogos_do_dia local (sem gastar cota externa)
  try {
    const isoDate = formatarDataISO(dataRaw)
    let filt = ''
    if (isoDate) filt = `data = '${isoDate}'`
    const jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
    for (let i = 0; i < jdds.length; i++) {
      const tc = jdds[i].getString('time_casa') || ''
      const tv = jdds[i].getString('time_visitante') || ''
      const matchDir = timesCoincidemHelper(timeA, tc) && timesCoincidemHelper(timeB, tv)
      const matchInv = timesCoincidemHelper(timeA, tv) && timesCoincidemHelper(timeB, tc)
      if (matchDir || matchInv) {
        const fid = (jdds[i].getString('fixture_id') || '').trim()
        if (fid && /^\d+$/.test(fid)) {
          console.log(
            `[fixtures_matcher] Fixture encontrada em jogos_do_dia: ${fid} (${timeA} x ${timeB})`,
          )
          return fid
        }
      }
    }
  } catch (errLocal) {
    console.log('[fixtures_matcher] Aviso ao buscar em jogos_do_dia:', errLocal)
  }

  // 2. Busca na API-Football por data
  const isoDate = formatarDataISO(dataRaw)
  if (!isoDate) return ''

  const apiKey = obterApiKeyApiFootball()
  if (!apiKey) {
    console.log('[fixtures_matcher] API Key ausente para consulta de fixture.')
    return ''
  }

  try {
    const { enviarRequisicaoApiFootball } = require(`${__hooks}/api_football_limiter.js`)
    const isRapid = apiKey.length > 40
    const url = isRapid
      ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${encodeURIComponent(isoDate)}&timezone=America%2FSao_Paulo`
      : `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(isoDate)}&timezone=America%2FSao_Paulo`
    const headers = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    console.log(
      `[fixtures_matcher] Consultando API-Football por data ${isoDate} para ${timeA} x ${timeB}...`,
    )
    const limiterRes = enviarRequisicaoApiFootball(url, { headers, timeout: 12 }, 2)

    if (limiterRes.blocked) {
      console.log(
        '[fixtures_matcher] Chamada à API-Football bloqueada pelo limiter:',
        limiterRes.reason,
      )
      return ''
    }

    const resJson = limiterRes.json
    if (resJson && Array.isArray(resJson.response)) {
      for (let k = 0; k < resJson.response.length; k++) {
        const item = resJson.response[k]
        const hName = (item.teams && item.teams.home && item.teams.home.name) || ''
        const aName = (item.teams && item.teams.away && item.teams.away.name) || ''

        const matchDir = timesCoincidemHelper(timeA, hName) && timesCoincidemHelper(timeB, aName)
        const matchInv = timesCoincidemHelper(timeA, aName) && timesCoincidemHelper(timeB, hName)

        if (matchDir || matchInv) {
          const fid = item.fixture && item.fixture.id ? String(item.fixture.id) : ''
          if (fid && /^\d+$/.test(fid)) {
            console.log(
              `[fixtures_matcher] Fixture ${fid} identificada com sucesso na API para ${timeA} x ${timeB}!`,
            )
            return fid
          }
        }
      }
    }
  } catch (errApi) {
    console.log('[fixtures_matcher] Erro na busca de fixture na API:', errApi)
  }

  return ''
}

module.exports = {
  buscarFixtureIdNaApi,
  formatarDataISO,
  timesCoincidemHelper,
  normalizeStrHelper,
}
