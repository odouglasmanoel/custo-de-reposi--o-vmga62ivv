/**
 * Hook do Placar Ao Vivo e Configurações de Integrações Esportivas.
 * Suporta 3 provedores:
 * 1. football_data (Football-Data.org - recomendado, headers: X-Auth-Token)
 * 2. thesportsdb (TheSportsDB - API v1/livescore.php e eventsday.php com chave pública ou privada)
 * 3. api_football (API-Football / api-sports / RapidAPI - mantido como fallback/opção)
 *
 * Ordem de prioridade da API Key:
 * 1. Chave salva no banco de dados na collection `config_integracoes` (gerenciada pelo Admin no próprio app)
 * 2. Secrets/Env existentes (API_FOOTBALL_KEY / RAPIDAPI_KEY / FOOTBALL_DATA_KEY / THESPORTSDB_KEY)
 *
 * Endpoints:
 * - GET  /backend/v1/placar-ao-vivo: Consulta partidas ao vivo e do dia
 * - GET  /backend/v1/placar-ao-vivo/config: Consulta status da config (apenas admin, chave mascarada)
 * - POST /backend/v1/placar-ao-vivo/config: Salva provedor e nova chave (apenas admin)
 * - POST /backend/v1/placar-ao-vivo/test: Testa conexão com a API externa (apenas admin)
 */

routerAdd('GET', '/backend/v1/placar-ao-vivo', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    // 1. Lê configuração salva no banco de dados
    let provedor = 'football_data'
    let apiKey = ''
    let ativo = true

    try {
      const configRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'football_data'
        apiKey = (configRecord.getString('api_key') || '').trim()
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // 2. Se não houver chave no banco, faz fallback para secrets/env de acordo com o provedor ou legado
    if (!apiKey) {
      if (provedor === 'football_data') {
        try {
          apiKey =
            ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
              ? $secrets.get('FOOTBALL_DATA_KEY')
              : '') ||
            $os.getenv('FOOTBALL_DATA_KEY') ||
            ''
        } catch (_) {}
      } else if (provedor === 'thesportsdb') {
        try {
          apiKey =
            ($secrets.has && $secrets.has('THESPORTSDB_KEY')
              ? $secrets.get('THESPORTSDB_KEY')
              : '') ||
            $os.getenv('THESPORTSDB_KEY') ||
            ''
        } catch (_) {}
      }

      // Se ainda vazio ou se provedor for api_football, verifica secrets legados
      if (!apiKey) {
        try {
          const legacyKey =
            ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
              ? $secrets.get('API_FOOTBALL_KEY')
              : '') ||
            ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
            $os.getenv('API_FOOTBALL_KEY') ||
            $os.getenv('RAPIDAPI_KEY') ||
            ''
          if (legacyKey) {
            apiKey = legacyKey
            // Se o admin não selecionou explicitamente no banco, preserva o provedor api_football para compatibilidade
            if (!configRecordFound()) {
              provedor = 'api_football'
            }
          }
        } catch (_) {}
      }
    }

    function configRecordFound() {
      try {
        const r = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
        return Boolean(r && r.getString('api_key'))
      } catch (_) {
        return false
      }
    }

    // Provedor TheSportsDB pode funcionar com a chave pública "3" (ou "123") se nenhuma outra for inserida
    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = '3'
    }

    if (!ativo) {
      return e.json(200, {
        configured: false,
        disabled: true,
        provider: provedor,
        message: 'Integração de placar ao vivo desativada nas configurações.',
        live: [],
        dateFixtures: [],
      })
    }

    if (!apiKey) {
      return e.json(200, {
        configured: false,
        provider: provedor,
        message: 'Chave da API de futebol não configurada.',
        live: [],
        dateFixtures: [],
      })
    }

    const dateQuery = (e.requestInfo().query.date || '').trim()

    // -------------------------------------------------------------
    // PROVEDOR 1: Football-Data.org (Recomendada)
    // -------------------------------------------------------------
    if (provedor === 'football_data') {
      let liveFixtures = []
      let dateFixtures = []

      // 1.1 Partidas ao vivo (filtro status=LIVE ou status=IN_PLAY,PAUSED)
      try {
        const resLive = $http.send({
          url: 'https://api.football-data.org/v4/matches?status=LIVE',
          method: 'GET',
          headers: {
            'X-Auth-Token': apiKey,
          },
          timeout: 10,
        })

        if (resLive.statusCode === 200 && resLive.json && Array.isArray(resLive.json.matches)) {
          liveFixtures = resLive.json.matches.map(function (m) {
            const homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
            const awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
            var scorersList = []
            if (Array.isArray(m.goals)) {
              for (var gi = 0; gi < m.goals.length; gi++) {
                var g = m.goals[gi]
                var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
                if (scorerName) {
                  scorersList.push({
                    name: scorerName,
                    minute: g.minute || null,
                    teamId: g.team ? g.team.id : null,
                    teamName: g.team ? g.team.name || g.team.shortName : null,
                  })
                }
              }
            }
            return {
              provider: 'football_data',
              fixture: {
                id: m.id,
                date: m.utcDate,
                status: {
                  short: m.status === 'PAUSED' ? 'HT' : m.status === 'IN_PLAY' ? '1H' : m.status,
                  long: m.status,
                  elapsed: m.minute || null,
                },
              },
              teams: {
                home: {
                  id: m.homeTeam ? m.homeTeam.id : undefined,
                  name: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
                  logo: m.homeTeam ? m.homeTeam.crest : '',
                },
                away: {
                  id: m.awayTeam ? m.awayTeam.id : undefined,
                  name: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
                  logo: m.awayTeam ? m.awayTeam.crest : '',
                },
              },
              goals: {
                home: typeof homeScore === 'number' ? homeScore : 0,
                away: typeof awayScore === 'number' ? awayScore : 0,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errLive) {
        console.log(
          'Aviso ao consultar live Football-Data.org:',
          errLive ? errLive.message : errLive,
        )
      }

      // 1.2 Partidas da data atual/especificada
      try {
        let urlDate = 'https://api.football-data.org/v4/matches'
        if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
          urlDate += '?date=' + encodeURIComponent(dateQuery)
        }

        const resDate = $http.send({
          url: urlDate,
          method: 'GET',
          headers: {
            'X-Auth-Token': apiKey,
          },
          timeout: 10,
        })

        if (resDate.statusCode === 200 && resDate.json && Array.isArray(resDate.json.matches)) {
          dateFixtures = resDate.json.matches.map(function (m) {
            const homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
            const awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
            var scorersList = []
            if (Array.isArray(m.goals)) {
              for (var gi = 0; gi < m.goals.length; gi++) {
                var g = m.goals[gi]
                var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
                if (scorerName) {
                  scorersList.push({
                    name: scorerName,
                    minute: g.minute || null,
                    teamId: g.team ? g.team.id : null,
                    teamName: g.team ? g.team.name || g.team.shortName : null,
                  })
                }
              }
            }
            return {
              provider: 'football_data',
              fixture: {
                id: m.id,
                date: m.utcDate,
                status: {
                  short: m.status === 'PAUSED' ? 'HT' : m.status === 'IN_PLAY' ? '1H' : m.status,
                  long: m.status,
                  elapsed: m.minute || null,
                },
              },
              teams: {
                home: {
                  id: m.homeTeam ? m.homeTeam.id : undefined,
                  name: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
                  logo: m.homeTeam ? m.homeTeam.crest : '',
                },
                away: {
                  id: m.awayTeam ? m.awayTeam.id : undefined,
                  name: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
                  logo: m.awayTeam ? m.awayTeam.crest : '',
                },
              },
              goals: {
                home: typeof homeScore === 'number' ? homeScore : 0,
                away: typeof awayScore === 'number' ? awayScore : 0,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errDate) {
        console.log(
          'Aviso ao consultar date Football-Data.org:',
          errDate ? errDate.message : errDate,
        )
      }

      return e.json(200, {
        configured: true,
        provider: 'football_data',
        live: liveFixtures,
        dateFixtures: dateFixtures,
      })
    }

    // -------------------------------------------------------------
    // PROVEDOR 2: TheSportsDB (Alternativa gratuita)
    // -------------------------------------------------------------
    if (provedor === 'thesportsdb') {
      let liveFixtures = []
      let dateFixtures = []

      // 2.1 Consulta endpoint de livescore do TheSportsDB
      try {
        const resLive = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(apiKey) +
            '/livescore.php?s=Soccer',
          method: 'GET',
          timeout: 10,
        })

        if (resLive.statusCode === 200 && resLive.json && Array.isArray(resLive.json.livescore)) {
          liveFixtures = resLive.json.livescore.map(function (item) {
            const hScore = parseInt(item.intHomeScore, 10)
            const aScore = parseInt(item.intAwayScore, 10)
            const elapsed = parseInt(item.strProgress, 10)
            const st = (item.strStatus || 'LIVE').toUpperCase()

            // Extrai autores de gols caso o TheSportsDB forneça strHomeGoalDetails/strAwayGoalDetails
            var scorersList = []
            var parseTsdbDetails = function (detailStr, teamSide) {
              if (typeof detailStr !== 'string' || !detailStr.trim()) return
              var parts = detailStr.split(';')
              for (var pi = 0; pi < parts.length; pi++) {
                var rawPart = parts[pi].trim()
                if (!rawPart) continue
                // Ex: "23':Neymar", "Neymar 23'", "Neymar"
                var minMatch = rawPart.match(/(\d+)'?/)
                var extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                var nameClean = rawPart
                  .replace(/^\d+'?:?/, '')
                  .replace(/\s*\d+'?$/, '')
                  .trim()
                if (nameClean) {
                  scorersList.push({
                    name: nameClean,
                    minute: extractedMin,
                    teamSide: teamSide,
                  })
                }
              }
            }
            parseTsdbDetails(item.strHomeGoalDetails, 'home')
            parseTsdbDetails(item.strAwayGoalDetails, 'away')

            return {
              provider: 'thesportsdb',
              fixture: {
                id: item.idLiveScore || item.idEvent,
                date: item.strTimestamp || item.dateEvent,
                status: {
                  short: st === 'HT' || st === 'HALF TIME' ? 'HT' : st,
                  long: item.strStatus || 'Live',
                  elapsed: isNaN(elapsed) ? null : elapsed,
                },
              },
              teams: {
                home: {
                  id: item.idHomeTeam,
                  name: item.strHomeTeam || '',
                  logo: item.strHomeTeamBadge || '',
                },
                away: {
                  id: item.idAwayTeam,
                  name: item.strAwayTeam || '',
                  logo: item.strAwayTeamBadge || '',
                },
              },
              goals: {
                home: isNaN(hScore) ? 0 : hScore,
                away: isNaN(aScore) ? 0 : aScore,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live TheSportsDB:', errLive ? errLive.message : errLive)
      }

      // 2.2 Se solicitou data específica ou para complementar com eventos do dia
      if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
        try {
          const resDay = $http.send({
            url:
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(apiKey) +
              '/eventsday.php?d=' +
              encodeURIComponent(dateQuery) +
              '&s=Soccer',
            method: 'GET',
            timeout: 10,
          })

          if (resDay.statusCode === 200 && resDay.json && Array.isArray(resDay.json.events)) {
            dateFixtures = resDay.json.events.map(function (item) {
              const hScore = parseInt(item.intHomeScore, 10)
              const aScore = parseInt(item.intAwayScore, 10)
              const st = (item.strStatus || '').toUpperCase()

              var scorersList = []
              var parseTsdbDetails = function (detailStr, teamSide) {
                if (typeof detailStr !== 'string' || !detailStr.trim()) return
                var parts = detailStr.split(';')
                for (var pi = 0; pi < parts.length; pi++) {
                  var rawPart = parts[pi].trim()
                  if (!rawPart) continue
                  var minMatch = rawPart.match(/(\d+)'?/)
                  var extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                  var nameClean = rawPart
                    .replace(/^\d+'?:?/, '')
                    .replace(/\s*\d+'?$/, '')
                    .trim()
                  if (nameClean) {
                    scorersList.push({
                      name: nameClean,
                      minute: extractedMin,
                      teamSide: teamSide,
                    })
                  }
                }
              }
              parseTsdbDetails(item.strHomeGoalDetails, 'home')
              parseTsdbDetails(item.strAwayGoalDetails, 'away')

              return {
                provider: 'thesportsdb',
                fixture: {
                  id: item.idEvent,
                  date: item.strTimestamp || item.dateEvent,
                  status: {
                    short: st,
                    long: item.strStatus || '',
                    elapsed: null,
                  },
                },
                teams: {
                  home: {
                    id: item.idHomeTeam,
                    name: item.strHomeTeam || '',
                    logo: item.strHomeTeamBadge || '',
                  },
                  away: {
                    id: item.idAwayTeam,
                    name: item.strAwayTeam || '',
                    logo: item.strAwayTeamBadge || '',
                  },
                },
                goals: {
                  home: isNaN(hScore) ? 0 : hScore,
                  away: isNaN(aScore) ? 0 : aScore,
                },
                scorers: scorersList,
              }
            })
          }
        } catch (errDay) {
          console.log('Aviso ao consultar eventsday TheSportsDB:', errDay ? errDay.message : errDay)
        }
      }

      return e.json(200, {
        configured: true,
        provider: 'thesportsdb',
        live: liveFixtures,
        dateFixtures: dateFixtures,
      })
    }

    // -------------------------------------------------------------
    // PROVEDOR 3: API-Football (Legado / Fallback mantido)
    // -------------------------------------------------------------
    const isRapidApi =
      ($secrets.has && $secrets.has('RAPIDAPI_KEY')) ||
      Boolean($os.getenv('RAPIDAPI_KEY')) ||
      apiKey.length > 40

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

    // Helper interno para converter fixtures da API-Football extraindo marcadores de eventos
    var mapApiFootballItem = function (item) {
      var scorersList = []
      // 1. Extrai de item.events
      if (Array.isArray(item.events)) {
        for (var ei = 0; ei < item.events.length; ei++) {
          var ev = item.events[ei]
          if (ev && ev.type === 'Goal' && ev.player && ev.player.name) {
            var isOwnGoal = ev.detail && ev.detail.toLowerCase().indexOf('own') !== -1
            var scorerNameStr = String(ev.player.name).trim()
            if (isOwnGoal) {
              scorerNameStr += ' (contra)'
            }
            scorersList.push({
              name: scorerNameStr,
              minute: ev.time ? ev.time.elapsed : null,
              teamId: ev.team ? ev.team.id : null,
              teamName: ev.team ? ev.team.name : null,
              teamSide:
                item.teams && item.teams.home && ev.team && ev.team.id === item.teams.home.id
                  ? 'home'
                  : item.teams && item.teams.away && ev.team && ev.team.id === item.teams.away.id
                    ? 'away'
                    : null,
            })
          }
        }
      }

      return {
        provider: 'api_football',
        fixture: item.fixture,
        teams: item.teams,
        goals: item.goals,
        score: item.score,
        events: item.events,
        scorers: scorersList,
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
        liveFixtures = resLive.json.response.map(mapApiFootballItem)
      }
    } catch (errLive) {
      console.log(
        'Aviso ao consultar live fixtures API-Football:',
        errLive ? errLive.message : errLive,
      )
    }

    let dateFixtures = []
    // Sempre consulta data de hoje se informada (ou query date)
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
          dateFixtures = resDate.json.response.map(mapApiFootballItem)
        }
      } catch (errDate) {
        console.log(
          'Aviso ao consultar date fixtures API-Football:',
          errDate ? errDate.message : errDate,
        )
      }
    }

    return e.json(200, {
      configured: true,
      provider: 'api_football',
      live: liveFixtures,
      dateFixtures: dateFixtures,
    })
  } catch (err) {
    return e.json(500, {
      configured: false,
      error: err ? err.message : 'Falha ao consultar placar ao vivo',
    })
  }
})

// -------------------------------------------------------------
// ENDPOINTS DE ADMINISTRAÇÃO DAS INTEGRAÇÕES
// -------------------------------------------------------------

/**
 * GET /backend/v1/placar-ao-vivo/config
 * Retorna as configurações atuais (sem vazar a chave em texto plano)
 */
routerAdd('GET', '/backend/v1/placar-ao-vivo/config', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    let provedor = 'football_data'
    let hasDbKey = false
    let maskedKey = ''
    let ativo = true

    try {
      const configRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'football_data'
        const k = (configRecord.getString('api_key') || '').trim()
        if (k) {
          hasDbKey = true
          maskedKey = k.length > 8 ? '••••••••' + k.slice(-4) : '••••' + k.slice(-2)
        }
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // Verifica se há chave em secrets como fallback
    let hasSecretFallback = false
    try {
      if (
        ($secrets.has &&
          ($secrets.has('API_FOOTBALL_KEY') ||
            $secrets.has('RAPIDAPI_KEY') ||
            $secrets.has('FOOTBALL_DATA_KEY'))) ||
        $os.getenv('API_FOOTBALL_KEY') ||
        $os.getenv('RAPIDAPI_KEY') ||
        $os.getenv('FOOTBALL_DATA_KEY')
      ) {
        hasSecretFallback = true
      }
    } catch (_) {}

    return e.json(200, {
      provedor: provedor,
      hasKey: hasDbKey || hasSecretFallback,
      hasDbKey: hasDbKey,
      hasSecretFallback: hasSecretFallback,
      maskedKey: maskedKey,
      ativo: ativo,
    })
  } catch (err) {
    return e.json(500, {
      error: err ? err.message : 'Erro ao ler configurações',
    })
  }
})

/**
 * POST /backend/v1/placar-ao-vivo/config
 * Salva ou atualiza o provedor e a API key na collection config_integracoes
 */
routerAdd('POST', '/backend/v1/placar-ao-vivo/config', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const provedor = (body.provedor || 'football_data').trim()
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : undefined
    const ativo = body.ativo !== false

    const col = $app.findCollectionByNameOrId('config_integracoes')
    let record
    try {
      record = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    } catch (_) {
      record = new Record(col)
      record.set('chave', 'placar_ao_vivo')
    }

    record.set('provedor', provedor)
    record.set('ativo', ativo)
    // Se apiKey for passada (mesmo vazia se o usuário quiser limpar), atualiza; se omitida (undefined), mantém
    if (apiKey !== undefined) {
      record.set('api_key', apiKey)
    }

    $app.save(record)

    const savedKey = record.getString('api_key') || ''
    const maskedKey = savedKey
      ? savedKey.length > 8
        ? '••••••••' + savedKey.slice(-4)
        : '••••' + savedKey.slice(-2)
      : ''

    return e.json(200, {
      success: true,
      message: 'Configurações de integração salvas com sucesso no banco de dados.',
      provedor: provedor,
      hasKey: Boolean(savedKey),
      maskedKey: maskedKey,
      ativo: ativo,
    })
  } catch (err) {
    return e.json(500, {
      error: err ? err.message : 'Erro ao salvar configurações',
    })
  }
})

/**
 * POST /backend/v1/placar-ao-vivo/test
 * Testa a conexão com o provedor escolhido usando a chave informada no body (ou a salva no banco)
 */
routerAdd('POST', '/backend/v1/placar-ao-vivo/test', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const provedor = (body.provedor || 'football_data').trim()
    let apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Se chave não foi enviada no teste, pega a salva no banco
    if (!apiKey) {
      try {
        const configRecord = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
        if (configRecord) {
          apiKey = (configRecord.getString('api_key') || '').trim()
        }
      } catch (_) {}
    }

    // Se for thesportsdb e nenhuma chave foi fornecida, usa chave de teste '3'
    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = '3'
    }

    if (!apiKey) {
      return e.json(400, {
        success: false,
        message: 'Por favor, informe a API Key para realizar o teste de conexão.',
      })
    }

    // Teste Football-Data.org
    if (provedor === 'football_data') {
      try {
        const res = $http.send({
          url: 'https://api.football-data.org/v4/competitions',
          method: 'GET',
          headers: {
            'X-Auth-Token': apiKey,
          },
          timeout: 10,
        })

        if (res.statusCode === 200) {
          const count =
            (res.json && res.json.count) ||
            (res.json && res.json.competitions && res.json.competitions.length) ||
            0
          return e.json(200, {
            success: true,
            provider: 'football_data',
            statusCode: res.statusCode,
            message:
              'Conexão com Football-Data.org bem-sucedida! ' + count + ' competições disponíveis.',
          })
        } else if (res.statusCode === 403 || res.statusCode === 401) {
          return e.json(400, {
            success: false,
            provider: 'football_data',
            statusCode: res.statusCode,
            message:
              'Falha de autenticação: Chave de API inválida ou não autorizada pela Football-Data.org (HTTP ' +
              res.statusCode +
              ').',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'football_data',
            statusCode: res.statusCode,
            message:
              'A Football-Data.org retornou status HTTP ' + res.statusCode + ': ' + (res.raw || ''),
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'football_data',
          message:
            'Erro ao conectar à Football-Data.org: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    // Teste TheSportsDB
    if (provedor === 'thesportsdb') {
      try {
        const res = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(apiKey) +
            '/all_sports.php',
          method: 'GET',
          timeout: 10,
        })

        if (res.statusCode === 200 && res.json && Array.isArray(res.json.sports)) {
          return e.json(200, {
            success: true,
            provider: 'thesportsdb',
            statusCode: res.statusCode,
            message: 'Conexão com TheSportsDB bem-sucedida! Esportes retornados com sucesso.',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'thesportsdb',
            statusCode: res.statusCode,
            message:
              'A TheSportsDB retornou status HTTP ' + res.statusCode + ' ou resposta inesperada.',
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'thesportsdb',
          message:
            'Erro ao conectar à TheSportsDB: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    // Teste API-Football
    if (provedor === 'api_football') {
      const isRapid = apiKey.length > 40
      let urlTest = 'https://v3.football.api-sports.io/status'
      let headersTest = {
        'x-apisports-key': apiKey,
      }
      if (isRapid) {
        urlTest = 'https://api-football-v1.p.rapidapi.com/v3/timezone'
        headersTest = {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
        }
      }

      try {
        const res = $http.send({
          url: urlTest,
          method: 'GET',
          headers: headersTest,
          timeout: 10,
        })

        if (res.statusCode === 200) {
          return e.json(200, {
            success: true,
            provider: 'api_football',
            statusCode: res.statusCode,
            message: 'Conexão com API-Football bem-sucedida! Conta ativa e autorizada.',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'api_football',
            statusCode: res.statusCode,
            message: 'API-Football retornou status HTTP ' + res.statusCode,
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'api_football',
          message:
            'Erro ao conectar à API-Football: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    return e.json(400, {
      success: false,
      message: 'Provedor desconhecido: ' + provedor,
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro inesperado no teste de conexão',
    })
  }
})
