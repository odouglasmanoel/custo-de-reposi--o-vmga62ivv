// pocketbase/hooks/enquetes_fixture_detalhes.js
// Endpoint: GET /backend/v1/enquetes/fixture-detalhes
// Suporta 2 modos de consulta:
// 1. Por ID: ?id=12345 (ou ?fixture_id=12345)
//    Busca detalhes e escudos oficiais da fixture na API-Sports.
// 2. Por Times + Data (Auto-Lookup): ?mandante=TimeA&visitante=TimeB&data=YYYY-MM-DD
//    Busca fixtures na data informada, normaliza os nomes e, se encontrar EXATAMENTE UM confronto,
//    retorna a fixture correspondente com o ID e os logos oficiais.
// Respeita estritamente a cota diária (80/dia, reset às 21h Brasília / 00h UTC).
// Exclusivo para usuários autenticados / Admin.

routerAdd('GET', '/backend/v1/enquetes/fixture-detalhes', (e) => {
  const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
  if (!authRecord) {
    return e.json(401, { error: 'Usuário não autenticado.' })
  }

  const q = (e.requestInfo && e.requestInfo().query) || {}
  const fixtureId = (q.id || q.fixture_id || '').toString().replace(/\D/g, '').trim()
  const mandante = (q.mandante || q.time_a || '').toString().trim()
  const visitante = (q.visitante || q.time_b || '').toString().trim()
  let dataRaw = (q.data || q.date || '').toString().trim()

  // Converte data para formato YYYY-MM-DD se vier em DD/MM/YYYY
  const brMatch = dataRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (brMatch) {
    const dd = String(brMatch[1]).padStart(2, '0')
    const mm = String(brMatch[2]).padStart(2, '0')
    const yyyy = brMatch[3]
    dataRaw = `${yyyy}-${mm}-${dd}`
  } else {
    const isoMatch = dataRaw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      dataRaw = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    }
  }

  const isLookupMode = !fixtureId && Boolean(mandante && visitante && dataRaw)

  if (!fixtureId && !isLookupMode) {
    return e.json(400, {
      error:
        'Parâmetros insuficientes. Informe o ID da partida (?id=...) ou o confronto (?mandante=...&visitante=...&data=YYYY-MM-DD).',
    })
  }

  // Rate limiter check inline sem require dinâmico
  const dNow = new Date()
  const yyyy = dNow.getUTCFullYear()
  const mm = String(dNow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dNow.getUTCDate()).padStart(2, '0')
  const hojeUtc = `${yyyy}-${mm}-${dd}`
  const USAGE_RECORD_CHAVE = 'api_football_daily_usage'
  const DAILY_LIMIT = 80

  let recUsage = null
  let usageData = {
    date_utc: hojeUtc,
    count: 0,
    max_limit: DAILY_LIMIT,
    trava_desativada: false,
    blocked: false,
    last_reset_utc: new Date().toISOString(),
    last_request_utc: null,
  }

  try {
    recUsage = $app.findFirstRecordByFilter('config_integracoes', `chave = '${USAGE_RECORD_CHAVE}'`)
    if (recUsage && recUsage.get('api_key')) {
      const parsed = JSON.parse(recUsage.get('api_key'))
      if (parsed && typeof parsed === 'object') {
        usageData = Object.assign(usageData, parsed)
      }
    }
  } catch (_) {
    recUsage = null
  }

  // Reset diário às 00:00 UTC se virou o dia
  if (usageData.date_utc !== hojeUtc) {
    usageData.date_utc = hojeUtc
    usageData.count = 0
    usageData.blocked = false
    if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
      usageData.max_limit = DAILY_LIMIT
    }
    usageData.last_reset_utc = new Date().toISOString()
    if (recUsage) {
      recUsage.set('api_key', JSON.stringify(usageData))
      $app.save(recUsage)
    }
  }

  const currentCount = Number(usageData.count) || 0
  const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
  const travaDesativada = Boolean(usageData.trava_desativada)

  if (!travaDesativada && (usageData.blocked || currentCount >= maxLimit)) {
    return e.json(429, {
      error:
        'Limite diário de requisições da API-Sports atingido (80/dia). A cota é reiniciada às 21h (horário de Brasília).',
      rate_limited: true,
      count: currentCount,
      max_limit: maxLimit,
    })
  }

  // Buscar chave da API-Sports
  let apiKey = ''
  try {
    const recPlacar = $app.findFirstRecordByFilter(
      'config_integracoes',
      "chave = 'placar_ao_vivo' && provedor = 'api_football' && ativo = true",
    )
    if (recPlacar) {
      apiKey = (recPlacar.getString('api_key') || recPlacar.get('api_key') || '').toString().trim()
    }
  } catch (_) {}

  if (!apiKey) {
    try {
      const recPlacarDirect = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (recPlacarDirect && recPlacarDirect.getBool('ativo')) {
        apiKey = (recPlacarDirect.getString('api_key') || recPlacarDirect.get('api_key') || '')
          .toString()
          .trim()
      }
    } catch (_) {}
  }

  if (!apiKey) {
    try {
      const configs = $app.findRecordsByFilter(
        'config_integracoes',
        "provedor = 'api_football' && ativo = true",
        '-updated',
        20,
        0,
      )
      for (let ci = 0; ci < configs.length; ci++) {
        const cfg = configs[ci]
        const chv = (cfg.getString('chave') || '').trim()
        if (
          chv === 'sobrescrita_jogos' ||
          chv === 'api_validada' ||
          chv === 'api_football_daily_usage'
        ) {
          continue
        }
        const candidateKey = (cfg.getString('api_key') || cfg.get('api_key') || '')
          .toString()
          .trim()
        if (candidateKey && !candidateKey.startsWith('{') && !candidateKey.startsWith('[')) {
          apiKey = candidateKey
          break
        }
      }
    } catch (_) {}
  }

  if (!apiKey) {
    return e.json(400, {
      error: 'Chave da API-Football não configurada em config_integracoes.',
    })
  }

  // Registrador seguro de consumo de cota
  const registrarConsumoCota = () => {
    try {
      usageData.count = currentCount + 1
      usageData.last_request_utc = new Date().toISOString()
      if (recUsage) {
        recUsage.set('api_key', JSON.stringify(usageData))
        $app.save(recUsage)
      } else {
        const colIntegracoes = $app.findCollectionByNameOrId('config_integracoes')
        const novo = new Record(colIntegracoes)
        novo.set('chave', USAGE_RECORD_CHAVE)
        novo.set('provedor', 'api_football')
        novo.set('ativo', true)
        novo.set('api_key', JSON.stringify(usageData))
        $app.save(novo)
      }
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // Helpers de Comparação de Times com tolerância e sinônimos
  // -------------------------------------------------------------
  const DICIONARIO_PAISES_E_CLUBES = {
    turquia: 'turkey',
    turkiye: 'turkey',
    tuerkei: 'turkey',
    estadosunidos: 'usa',
    unitedstates: 'usa',
    eua: 'usa',
    us: 'usa',
    inglaterra: 'england',
    alemanha: 'germany',
    deutschland: 'germany',
    franca: 'france',
    espanha: 'spain',
    espana: 'spain',
    italia: 'italy',
    holanda: 'netherlands',
    paisesbaixos: 'netherlands',
    belgica: 'belgium',
    croacia: 'croatia',
    dinamarca: 'denmark',
    noruega: 'norway',
    portugal: 'portugal',
    paisdegales: 'wales',
    gales: 'wales',
    coreiadosul: 'south korea',
    coreiadonorte: 'north korea',
    japao: 'japan',
    catar: 'qatar',
    marrocos: 'morocco',
    mexico: 'mexico',
    argentina: 'argentina',
    brasil: 'brazil',
    uruguai: 'uruguay',
    paraguai: 'paraguay',
    chile: 'chile',
    colombia: 'colombia',
    equador: 'ecuador',
    venezuela: 'venezuela',
    bolivia: 'bolivia',
    peru: 'peru',
    psg: 'paris saint germain',
    ldu: 'ldu quito',
    idv: 'independiente del valle',
    athleticopr: 'athletico paranaense',
    atleticopr: 'athletico paranaense',
    atleticomg: 'atletico mineiro',
    americamg: 'america mineiro',
  }

  const normalizarNome = (raw) => {
    if (!raw) return ''
    let s = String(raw).toLowerCase()
    if (typeof s.normalize === 'function') {
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
    }
    s = s.replace(/[^a-z0-9\s]/g, ' ')
    const tokens = s.split(/\s+/).filter(Boolean)
    const stopWords = [
      'fc',
      'cf',
      'sc',
      'ec',
      'cr',
      'ca',
      'se',
      'afc',
      'club',
      'clube',
      'de',
      'do',
      'da',
      'dos',
      'das',
      'del',
      'futebol',
      'futbol',
      'football',
      'esporte',
      'atletico',
      'atletica',
      'associacao',
      'united',
      'city',
      'republic',
      'national',
      'selecao',
    ]
    const cleanTokens = tokens.filter((t) => stopWords.indexOf(t) === -1)
    const keyCompact = (cleanTokens.join('') || s.replace(/[^a-z0-9]/g, '')).trim()
    if (DICIONARIO_PAISES_E_CLUBES[keyCompact]) {
      return DICIONARIO_PAISES_E_CLUBES[keyCompact]
    }
    const cleanStr = cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
    if (DICIONARIO_PAISES_E_CLUBES[cleanStr]) {
      return DICIONARIO_PAISES_E_CLUBES[cleanStr]
    }
    return cleanStr
  }

  const calcularLevenshtein = (a, b) => {
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

  const timesSaoEquivalentes = (timeDigitado, timeApi) => {
    const normA = normalizarNome(timeDigitado)
    const normB = normalizarNome(timeApi)
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
    const dist = calcularLevenshtein(normA, normB)
    return 1 - dist / maxLen >= 0.72
  }

  // -------------------------------------------------------------
  // MODO 1: Consulta direta por ID da fixture
  // -------------------------------------------------------------
  if (fixtureId) {
    try {
      const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureId)}`
      const res = $http.send({
        url,
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
        },
        timeout: 15,
      })

      registrarConsumoCota()

      if (res.statusCode !== 200) {
        return e.json(502, {
          error: `A API-Sports retornou status ${res.statusCode}.`,
        })
      }

      const json = JSON.parse(res.raw)
      if (json.errors && Object.keys(json.errors).length > 0) {
        const errStr = JSON.stringify(json.errors)
        if (errStr.includes('rate') || errStr.includes('Requests')) {
          usageData.blocked = true
          if (recUsage) {
            recUsage.set('api_key', JSON.stringify(usageData))
            $app.save(recUsage)
          }
          return e.json(429, {
            error: 'Limite de requisições da API-Sports atingido.',
            rate_limited: true,
          })
        }
        return e.json(502, { error: `Erro da API-Sports: ${errStr}` })
      }

      if (!Array.isArray(json.response) || json.response.length === 0) {
        return e.json(404, {
          error: `Nenhuma partida encontrada na API-Sports para o fixture_id ${fixtureId}.`,
        })
      }

      const f = json.response[0]
      const homeName = (f.teams?.home?.name || '').toString().trim()
      const awayName = (f.teams?.away?.name || '').toString().trim()
      const homeLogo = (f.teams?.home?.logo || '').toString().trim()
      const awayLogo = (f.teams?.away?.logo || '').toString().trim()
      const leagueName = (f.league?.name || '').toString().trim()

      return e.json(200, {
        success: true,
        fixture: {
          id: f.fixture?.id,
          homeTeamName: homeName,
          awayTeamName: awayName,
          homeTeamLogo: homeLogo,
          awayTeamLogo: awayLogo,
          leagueName: leagueName,
          date: f.fixture?.date,
        },
      })
    } catch (err) {
      return e.json(500, {
        error: 'Falha na comunicação com a API-Sports: ' + (err.message || String(err)),
      })
    }
  }

  // -------------------------------------------------------------
  // MODO 2: Auto-lookup por Mandante, Visitante e Data
  // -------------------------------------------------------------
  try {
    const isRapid = apiKey.length > 40
    const url = isRapid
      ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${encodeURIComponent(dataRaw)}&timezone=America%2FSao_Paulo`
      : `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(dataRaw)}&timezone=America%2FSao_Paulo`

    const headers = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    const res = $http.send({
      url,
      method: 'GET',
      headers,
      timeout: 15,
    })

    registrarConsumoCota()

    if (res.statusCode !== 200) {
      return e.json(502, {
        error: `A API-Sports retornou status ${res.statusCode}.`,
      })
    }

    const json = JSON.parse(res.raw)
    if (json.errors && Object.keys(json.errors).length > 0) {
      const errStr = JSON.stringify(json.errors)
      if (errStr.includes('rate') || errStr.includes('Requests')) {
        usageData.blocked = true
        if (recUsage) {
          recUsage.set('api_key', JSON.stringify(usageData))
          $app.save(recUsage)
        }
        return e.json(429, {
          error: 'Limite de requisições da API-Sports atingido.',
          rate_limited: true,
        })
      }
      return e.json(502, { error: `Erro da API-Sports: ${errStr}` })
    }

    const fixturesList = Array.isArray(json.response) ? json.response : []
    const correspondencias = []

    for (let k = 0; k < fixturesList.length; k++) {
      const item = fixturesList[k]
      const hName = (item.teams && item.teams.home && item.teams.home.name) || ''
      const aName = (item.teams && item.teams.away && item.teams.away.name) || ''

      const matchDireto =
        timesSaoEquivalentes(mandante, hName) && timesSaoEquivalentes(visitante, aName)
      const matchInvertido =
        timesSaoEquivalentes(mandante, aName) && timesSaoEquivalentes(visitante, hName)

      if (matchDireto || matchInvertido) {
        correspondencias.push({
          item,
          isHomeMandante: matchDireto,
        })
      }
    }

    if (correspondencias.length === 0) {
      return e.json(404, {
        error: `Nenhuma partida encontrada entre "${mandante}" e "${visitante}" na data ${dataRaw}.`,
        matches_found: 0,
      })
    }

    if (correspondencias.length > 1) {
      return e.json(409, {
        error: `Mais de uma partida encontrada (${correspondencias.length}) para esses times na data informada. Especifique o ID manualmente.`,
        matches_found: correspondencias.length,
      })
    }

    // Exatamente uma partida correspondente!
    const match = correspondencias[0]
    const item = match.item
    const fId = item.fixture && item.fixture.id ? item.fixture.id : null
    const hLogo = (item.teams && item.teams.home && item.teams.home.logo) || ''
    const aLogo = (item.teams && item.teams.away && item.teams.away.logo) || ''
    const hName = (item.teams && item.teams.home && item.teams.home.name) || ''
    const aName = (item.teams && item.teams.away && item.teams.away.name) || ''

    // Se a ordem digitada foi invertida (fora x casa), mapeia correspondendo mandante x visitante do form
    const logoMandante = match.isHomeMandante ? hLogo : aLogo
    const logoVisitante = match.isHomeMandante ? aLogo : hLogo

    return e.json(200, {
      success: true,
      auto_lookup: true,
      fixture: {
        id: fId,
        homeTeamName: hName,
        awayTeamName: aName,
        homeTeamLogo: logoMandante,
        awayTeamLogo: logoVisitante,
        leagueName: (item.league && item.league.name) || '',
        date: item.fixture && item.fixture.date,
      },
    })
  } catch (errLookup) {
    return e.json(500, {
      error: 'Falha na busca automática da partida: ' + (errLookup.message || String(errLookup)),
    })
  }
})
