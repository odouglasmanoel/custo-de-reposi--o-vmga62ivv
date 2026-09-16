routerAdd('GET', '/backend/v1/placar-ao-vivo', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    // Lê chaves suportadas via $os.getenv / $secrets.get
    // Suporta: API_FOOTBALL_KEY ou RAPIDAPI_KEY
    let apiKey = ''
    try {
      apiKey = $secrets.get('API_FOOTBALL_KEY') || $secrets.get('RAPIDAPI_KEY') || ''
    } catch (_) {}

    if (!apiKey) {
      try {
        apiKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
      } catch (_) {}
    }

    if (!apiKey) {
      return e.json(200, {
        configured: false,
        message:
          'Chave da API-Football não configurada. Defina o secret API_FOOTBALL_KEY ou RAPIDAPI_KEY.',
        live: [],
        dateFixtures: [],
      })
    }

    const isRapidApi =
      ($secrets.has && $secrets.has('RAPIDAPI_KEY')) ||
      Boolean($os.getenv('RAPIDAPI_KEY')) ||
      apiKey.length > 40

    // Data opcional vinda da query string (YYYY-MM-DD)
    const dateQuery = (e.requestInfo().query.date || '').trim()

    let urlLive = 'https://v3.football.api-sports.io/fixtures?live=all'
    let headers = {
      'x-apisports-key': apiKey,
    }

    if (isRapidApi) {
      urlLive = 'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all'
      headers = {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
      }
    }

    let liveFixtures = []
    try {
      const resLive = $http.send({
        url: urlLive,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      if (resLive.statusCode === 200 && resLive.json && Array.isArray(resLive.json.response)) {
        liveFixtures = resLive.json.response
      }
    } catch (errLive) {
      console.log('Aviso ao consultar live fixtures:', errLive ? errLive.message : errLive)
    }

    // Se uma data específica foi solicitada, busca fixtures dessa data também
    let dateFixtures = []
    if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      let urlDate =
        'https://v3.football.api-sports.io/fixtures?date=' + encodeURIComponent(dateQuery)
      if (isRapidApi) {
        urlDate =
          'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' + encodeURIComponent(dateQuery)
      }
      try {
        const resDate = $http.send({
          url: urlDate,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })
        if (resDate.statusCode === 200 && resDate.json && Array.isArray(resDate.json.response)) {
          dateFixtures = resDate.json.response
        }
      } catch (errDate) {
        console.log('Aviso ao consultar date fixtures:', errDate ? errDate.message : errDate)
      }
    }

    return e.json(200, {
      configured: true,
      live: liveFixtures,
      dateFixtures: dateFixtures,
    })
  } catch (err) {
    return e.json(500, {
      configured: false,
      error: err ? err.message : 'Falha ao consultar API-Football',
    })
  }
})
