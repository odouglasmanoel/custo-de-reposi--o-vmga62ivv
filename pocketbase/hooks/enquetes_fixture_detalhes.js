// pocketbase/hooks/enquetes_fixture_detalhes.js
// Endpoint: GET /backend/v1/enquetes/fixture-detalhes?id=12345
// Busca informações e logos oficiais da fixture pelo ID na API-Sports,
// respeitando o limitador diário (80/dia, reset às 21h Brasília).
// Exclusivo para usuários autenticados / Admin.

routerAdd('GET', '/backend/v1/enquetes/fixture-detalhes', (e) => {
  const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
  if (!authRecord) {
    return e.json(401, { error: 'Usuário não autenticado.' })
  }

  let fixtureId = ''
  try {
    const q = e.requestInfo().query || {}
    fixtureId = (q.id || q.fixture_id || '').toString().replace(/\D/g, '').trim()
  } catch (_) {
    fixtureId = ''
  }

  if (!fixtureId) {
    return e.json(400, { error: 'ID da fixture é obrigatório.' })
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

  // Consulta fixture por ID
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

    // Registra consumo de cota
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
})
