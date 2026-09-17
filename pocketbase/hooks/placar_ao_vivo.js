/**
 * Hook do Placar Ao Vivo e Configurações de Integrações Esportivas.
 * Suporta 3 provedores:
 * 1. football_data (Football-Data.org - recomendado, headers: X-Auth-Token)
 * 2. thesportsdb (TheSportsDB - API v1/livescore.php e eventsday.php com chave pública ou privada)
 * 3. api_football (API-Football / api-sports / RapidAPI - mantido como fallback/opção)
 *
 * REGRAS CRÍTICAS DE ECONOMIA DE COTA E CACHE:
 * 1. Cache obrigatório server-side de 30 minutos para calendário/dia e 5 minutos enquanto houver jogos ao vivo.
 * 2. Deduplicação de requisições externas e proteção contra loop / recarregamentos simultâneos.
 * 3. Tratamento elegante de cota excedida (HTTP 429 ou corpo com "requests limit reached" / plano esgotado)
 *    retornando HTTP 200 com rate_limited: true sem quebrar telas nem inventar placar falso.
 * 4. Carregamento passivo serve SEMPRE do cache interno se válido; revalidação externa sob demanda.
 */

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo
// -------------------------------------------------------------
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
            try {
              const r = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
              if (!r || !r.getString('api_key')) {
                provedor = 'api_football'
              }
            } catch (_) {
              provedor = 'api_football'
            }
          }
        } catch (_) {}
      }
    }

    // Provedor TheSportsDB pode funcionar com a chave pública "3" se nenhuma outra for inserida
    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = '3'
    }

    // Lê também a sobrescrita manual de partidas salva pelo Admin Douglas (se houver)
    var sobrescritasMap = {}
    try {
      var sobRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'sobrescrita_jogos')
      if (sobRec) {
        var rawJson = sobRec.getString('api_key') || ''
        if (rawJson && rawJson.trim()) {
          sobrescritasMap = JSON.parse(rawJson)
        }
      }
    } catch (_) {}

    if (!ativo) {
      return e.json(200, {
        configured: false,
        disabled: true,
        provider: provedor,
        message: 'Integração de placar ao vivo desativada nas configurações.',
        live: [],
        dateFixtures: [],
        directFixtures: [],
        sobrescritas: sobrescritasMap,
      })
    }

    if (!apiKey) {
      return e.json(200, {
        configured: false,
        provider: provedor,
        message: 'Chave da API de futebol não configurada.',
        live: [],
        dateFixtures: [],
        directFixtures: [],
        sobrescritas: sobrescritasMap,
      })
    }

    var dateQuery = (e.requestInfo().query.date || '').trim()
    var directFixtureParam = (
      e.requestInfo().query.fixture_id ||
      e.requestInfo().query.ids ||
      ''
    ).trim()
    var forceRefresh = e.requestInfo().query.refresh === '1'

    // Garante que a data padrão seja a data de hoje em Brasília (America/Sao_Paulo)
    if (!dateQuery || !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var nowSP = new Date(Date.now() - 3 * 3600 * 1000)
      var ymSP = ('0' + (nowSP.getUTCMonth() + 1)).slice(-2)
      var ydSP = ('0' + nowSP.getUTCDate()).slice(-2)
      dateQuery = nowSP.getUTCFullYear() + '-' + ymSP + '-' + ydSP
    }

    // Coleta IDs diretos enviados na query e pendentes no banco
    var directFixtureIds = []
    if (directFixtureParam) {
      var rawIds = directFixtureParam.split(',')
      for (var idi = 0; idi < rawIds.length; idi++) {
        var cleanId = rawIds[idi].trim()
        if (cleanId && directFixtureIds.indexOf(cleanId) === -1) {
          directFixtureIds.push(cleanId)
        }
      }
    }

    try {
      var pendentesComId = $app.findRecordsByFilter(
        'jogos',
        "resultado_finalizado = false && fixture_id != ''",
        '-data',
        50,
        0,
      )
      if (Array.isArray(pendentesComId)) {
        for (var pii = 0; pii < pendentesComId.length; pii++) {
          var fIdFromDb = (pendentesComId[pii].getString('fixture_id') || '').trim()
          if (fIdFromDb && directFixtureIds.indexOf(fIdFromDb) === -1) {
            directFixtureIds.push(fIdFromDb)
          }
        }
      }
    } catch (_) {}
    directFixtureIds.sort()

    // -------------------------------------------------------------
    // CAMADA DE CACHE SERVER-SIDE COM TTL DINÂMICO E DEDUPLICAÇÃO
    // -------------------------------------------------------------
    if (typeof globalThis !== 'undefined' && !globalThis.__placarAoVivoCacheStore) {
      globalThis.__placarAoVivoCacheStore = {}
    }
    var cacheStore = typeof globalThis !== 'undefined' ? globalThis.__placarAoVivoCacheStore : null
    var cacheKey = provedor + '_' + dateQuery + '_' + directFixtureIds.join('-')
    var cacheEntry = cacheStore ? cacheStore[cacheKey] : null
    var nowMs = Date.now()

    var isLiveStatus = function (st) {
      if (!st) return false
      var s = String(st).toUpperCase().trim()
      return (
        s === '1H' ||
        s === 'HT' ||
        s === '2H' ||
        s === 'ET' ||
        s === 'BT' ||
        s === 'P' ||
        s === 'LIVE' ||
        s === 'IN_PLAY' ||
        s === 'PAUSED'
      )
    }

    // Verifica se os dados em cache têm qualquer jogo ao vivo
    var entryHasLive = false
    if (cacheEntry && cacheEntry.data) {
      if (Array.isArray(cacheEntry.data.live) && cacheEntry.data.live.length > 0) {
        entryHasLive = true
      }
      if (!entryHasLive && Array.isArray(cacheEntry.data.directFixtures)) {
        for (var dxi = 0; dxi < cacheEntry.data.directFixtures.length; dxi++) {
          var dfSt =
            cacheEntry.data.directFixtures[dxi].fixture &&
            cacheEntry.data.directFixtures[dxi].fixture.status &&
            cacheEntry.data.directFixtures[dxi].fixture.status.short
          if (isLiveStatus(dfSt)) {
            entryHasLive = true
            break
          }
        }
      }
      if (!entryHasLive && Array.isArray(cacheEntry.data.dateFixtures)) {
        for (var dti = 0; dti < cacheEntry.data.dateFixtures.length; dti++) {
          var dtSt =
            cacheEntry.data.dateFixtures[dti].fixture &&
            cacheEntry.data.dateFixtures[dti].fixture.status &&
            cacheEntry.data.dateFixtures[dti].fixture.status.short
          if (isLiveStatus(dtSt)) {
            entryHasLive = true
            break
          }
        }
      }
    }

    // TTL: ~30 min para jogos agendados/calendário, 5 min enquanto houver jogo ao vivo
    var effectiveTTL = entryHasLive ? 5 * 60 * 1000 : 30 * 60 * 1000
    var cacheAgeMs = cacheEntry ? nowMs - cacheEntry.timestamp : 999999999

    // Se o cache é válido, serve diretamente do cache interno SEM fazer nenhuma chamada externa
    if (cacheEntry && cacheEntry.data) {
      if (!forceRefresh || cacheAgeMs < effectiveTTL) {
        var cachedPayload = Object.assign({}, cacheEntry.data, {
          sobrescritas: sobrescritasMap,
          cached: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(effectiveTTL / 1000),
          hasLive: entryHasLive,
        })
        return e.json(200, cachedPayload)
      }
    }

    // DEDUPLICAÇÃO DE REQUISIÇÕES EM CURSO: se outra requisição já iniciou a busca externa há menos de 10s, serve o cache anterior imediatamente
    if (cacheEntry && cacheEntry.fetching && nowMs - cacheEntry.fetching < 10000) {
      if (cacheEntry.data) {
        var dedupPayload = Object.assign({}, cacheEntry.data, {
          sobrescritas: sobrescritasMap,
          cached: true,
          deduplicated: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(effectiveTTL / 1000),
          hasLive: entryHasLive,
        })
        return e.json(200, dedupPayload)
      }
    }

    // Marca início de requisição externa para deduplicar
    if (cacheStore) {
      if (!cacheStore[cacheKey]) {
        cacheStore[cacheKey] = { timestamp: 0, data: null, fetching: nowMs }
      } else {
        cacheStore[cacheKey].fetching = nowMs
      }
    }

    // -------------------------------------------------------------
    // HELPER PARA DETECÇÃO DE RATE LIMIT / COTA EXCEDIDA (429)
    // -------------------------------------------------------------
    var isRateLimitError = function (statusCode, responseBody) {
      if (statusCode === 429) return true
      if (!responseBody) return false
      var strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch (_) {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      if (
        strBody.indexOf('requests limit reached') !== -1 ||
        strBody.indexOf('request limit reached') !== -1 ||
        strBody.indexOf('rate limit') !== -1 ||
        strBody.indexOf('plan reached') !== -1 ||
        strBody.indexOf('too many requests') !== -1 ||
        strBody.indexOf('quota exceeded') !== -1 ||
        strBody.indexOf('exceeded the maximum') !== -1 ||
        strBody.indexOf('free-tier limit') !== -1
      ) {
        return true
      }
      return false
    }

    var rateLimitDetected = false
    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    // -------------------------------------------------------------
    // PROVEDOR 1: Football-Data.org
    // -------------------------------------------------------------
    if (provedor === 'football_data') {
      let liveFixtures = []
      let dateFixtures = []

      try {
        const resLive = $http.send({
          url: 'https://api.football-data.org/v4/matches?status=LIVE',
          method: 'GET',
          headers: { 'X-Auth-Token': apiKey },
          timeout: 10,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.matches)
        ) {
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
                home: typeof homeScore === 'number' ? homeScore : null,
                away: typeof awayScore === 'number' ? awayScore : null,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live Football-Data.org:', errLive)
      }

      if (!rateLimitDetected) {
        try {
          let urlDate = 'https://api.football-data.org/v4/matches'
          if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
            var pFD = dateQuery.split('-')
            var yFD = parseInt(pFD[0], 10)
            var mFD = parseInt(pFD[1], 10) - 1
            var dFD = parseInt(pFD[2], 10)

            var prevFD = new Date(Date.UTC(yFD, mFD, dFD - 1))
            var prevFDM = ('0' + (prevFD.getUTCMonth() + 1)).slice(-2)
            var prevFDD = ('0' + prevFD.getUTCDate()).slice(-2)
            var dateFrom = prevFD.getUTCFullYear() + '-' + prevFDM + '-' + prevFDD

            var nextFD = new Date(Date.UTC(yFD, mFD, dFD + 1))
            var nextFDM = ('0' + (nextFD.getUTCMonth() + 1)).slice(-2)
            var nextFDD = ('0' + nextFD.getUTCDate()).slice(-2)
            var dateTo = nextFD.getUTCFullYear() + '-' + nextFDM + '-' + nextFDD

            urlDate +=
              '?dateFrom=' + encodeURIComponent(dateFrom) + '&dateTo=' + encodeURIComponent(dateTo)
          }

          const resDate = $http.send({
            url: urlDate,
            method: 'GET',
            headers: { 'X-Auth-Token': apiKey },
            timeout: 10,
          })

          if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
            rateLimitDetected = true
          } else if (
            resDate.statusCode === 200 &&
            resDate.json &&
            Array.isArray(resDate.json.matches)
          ) {
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
                  home: typeof homeScore === 'number' ? homeScore : null,
                  away: typeof awayScore === 'number' ? awayScore : null,
                },
                scorers: scorersList,
              }
            })
          }
        } catch (errDate) {
          console.log('Aviso ao consultar date Football-Data.org:', errDate)
        }
      }

      if (rateLimitDetected) {
        if (cacheEntry && cacheEntry.data) {
          return e.json(200, {
            configured: true,
            provider: 'football_data',
            live: cacheEntry.data.live || [],
            dateFixtures: cacheEntry.data.dateFixtures || [],
            directFixtures: cacheEntry.data.directFixtures || [],
            sobrescritas: sobrescritasMap,
            cached: true,
            fallback: true,
            rate_limited: true,
            warning: rateLimitMessage,
          })
        }
        return e.json(200, {
          configured: true,
          provider: 'football_data',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          rate_limited: true,
          error: rateLimitMessage,
        })
      }

      var fdPayload = {
        configured: true,
        provider: 'football_data',
        live: liveFixtures,
        dateFixtures: dateFixtures,
        directFixtures: [],
        updatedAt: new Date().toISOString(),
      }

      if (cacheStore) {
        cacheStore[cacheKey] = {
          timestamp: Date.now(),
          data: fdPayload,
          fetching: 0,
        }
      }

      return e.json(
        200,
        Object.assign({}, fdPayload, {
          sobrescritas: sobrescritasMap,
          cached: false,
        }),
      )
    }

    // -------------------------------------------------------------
    // PROVEDOR 2: TheSportsDB
    // -------------------------------------------------------------
    if (provedor === 'thesportsdb') {
      let liveFixtures = []
      let dateFixtures = []

      try {
        const resLive = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(apiKey) +
            '/livescore.php?s=Soccer',
          method: 'GET',
          timeout: 10,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.livescore)
        ) {
          liveFixtures = resLive.json.livescore.map(function (item) {
            const hScore = parseInt(item.intHomeScore, 10)
            const aScore = parseInt(item.intAwayScore, 10)
            const elapsed = parseInt(item.strProgress, 10)
            const st = (item.strStatus || 'LIVE').toUpperCase()

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
                home: isNaN(hScore) ? null : hScore,
                away: isNaN(aScore) ? null : aScore,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live TheSportsDB:', errLive)
      }

      if (rateLimitDetected) {
        if (cacheEntry && cacheEntry.data) {
          return e.json(200, {
            configured: true,
            provider: 'thesportsdb',
            live: cacheEntry.data.live || [],
            dateFixtures: cacheEntry.data.dateFixtures || [],
            directFixtures: cacheEntry.data.directFixtures || [],
            sobrescritas: sobrescritasMap,
            cached: true,
            fallback: true,
            rate_limited: true,
            warning: rateLimitMessage,
          })
        }
        return e.json(200, {
          configured: true,
          provider: 'thesportsdb',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          rate_limited: true,
          error: rateLimitMessage,
        })
      }

      var tsdbPayload = {
        configured: true,
        provider: 'thesportsdb',
        live: liveFixtures,
        dateFixtures: dateFixtures,
        directFixtures: [],
        updatedAt: new Date().toISOString(),
      }

      if (cacheStore) {
        cacheStore[cacheKey] = {
          timestamp: Date.now(),
          data: tsdbPayload,
          fetching: 0,
        }
      }

      return e.json(
        200,
        Object.assign({}, tsdbPayload, {
          sobrescritas: sobrescritasMap,
          cached: false,
        }),
      )
    }

    // -------------------------------------------------------------
    // PROVEDOR 3: API-Football (Legado / Principal de Jogos)
    // -------------------------------------------------------------
    const isRapidApi =
      ($secrets.has && $secrets.has('RAPIDAPI_KEY')) ||
      Boolean($os.getenv('RAPIDAPI_KEY')) ||
      apiKey.length > 40

    let urlLive = 'https://v3.football.api-sports.io/fixtures?live=all&timezone=America%2FSao_Paulo'
    let headers = {
      'x-apisports-key': apiKey,
    }

    if (isRapidApi) {
      urlLive =
        'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all&timezone=America%2FSao_Paulo'
      headers = {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
      }
    }

    // Helper interno para converter fixtures da API-Football
    var mapApiFootballItem = function (item) {
      var scorersList = []
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

    var directFixtures = []
    var seenDirectIds = {}

    // Executa busca direta de fixtures com proteção contra 429
    for (var fxi = 0; fxi < directFixtureIds.length; fxi++) {
      var targetFixtureId = directFixtureIds[fxi]
      if (!targetFixtureId || seenDirectIds[targetFixtureId]) continue

      var baseDirectUrl = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'
      var urlDirect =
        baseDirectUrl +
        '?id=' +
        encodeURIComponent(targetFixtureId) +
        '&timezone=America%2FSao_Paulo'

      try {
        var resDirect = $http.send({
          url: urlDirect,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })

        if (isRateLimitError(resDirect.statusCode, resDirect.json || resDirect.raw)) {
          rateLimitDetected = true
          break
        }

        if (
          resDirect.statusCode === 200 &&
          resDirect.json &&
          Array.isArray(resDirect.json.response)
        ) {
          for (var dri = 0; dri < resDirect.json.response.length; dri++) {
            var directItem = resDirect.json.response[dri]
            var parsedDirect = mapApiFootballItem(directItem)
            var actualId =
              directItem.fixture && directItem.fixture.id
                ? String(directItem.fixture.id)
                : targetFixtureId
            seenDirectIds[actualId] = true
            directFixtures.push(parsedDirect)
          }
        }
      } catch (errDirect) {
        console.log('Aviso ao consultar fixture_id direto (' + targetFixtureId + '):', errDirect)
      }
    }

    let liveFixtures = []
    if (!rateLimitDetected) {
      try {
        const resLive = $http.send({
          url: urlLive,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.response)
        ) {
          liveFixtures = resLive.json.response.map(mapApiFootballItem)
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live fixtures API-Football:', errLive)
      }
    }

    let dateFixtures = []
    if (!rateLimitDetected && dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var baseUrlDate = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'
      var urlDate =
        baseUrlDate + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'

      try {
        var resDate = $http.send({
          url: urlDate,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })

        if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
          rateLimitDetected = true
        } else if (
          resDate.statusCode === 200 &&
          resDate.json &&
          Array.isArray(resDate.json.response)
        ) {
          for (var ri = 0; ri < resDate.json.response.length; ri++) {
            dateFixtures.push(mapApiFootballItem(resDate.json.response[ri]))
          }
        }
      } catch (errDate) {
        console.log('Aviso ao consultar date fixtures API-Football:', errDate)
      }
    }

    // Se rate limit foi detectado em qualquer uma das chamadas da API-Football
    if (rateLimitDetected) {
      if (cacheEntry && cacheEntry.data) {
        return e.json(200, {
          configured: true,
          provider: 'api_football',
          directFixtures: cacheEntry.data.directFixtures || [],
          live: cacheEntry.data.live || [],
          dateFixtures: cacheEntry.data.dateFixtures || [],
          sobrescritas: sobrescritasMap,
          cached: true,
          fallback: true,
          rate_limited: true,
          warning: rateLimitMessage,
        })
      }
      return e.json(200, {
        configured: true,
        provider: 'api_football',
        directFixtures: [],
        live: [],
        dateFixtures: [],
        sobrescritas: sobrescritasMap,
        rate_limited: true,
        error: rateLimitMessage,
      })
    }

    var apiFootballPayload = {
      configured: true,
      provider: 'api_football',
      directFixtures: directFixtures,
      live: liveFixtures,
      dateFixtures: dateFixtures,
      updatedAt: new Date().toISOString(),
    }

    if (cacheStore) {
      cacheStore[cacheKey] = {
        timestamp: Date.now(),
        data: apiFootballPayload,
        fetching: 0,
      }
    }

    return e.json(
      200,
      Object.assign({}, apiFootballPayload, {
        sobrescritas: sobrescritasMap,
        cached: false,
      }),
    )
  } catch (err) {
    console.log('Aviso ao consultar placar ao vivo:', err ? err.message : err)
    return e.json(200, {
      configured: true,
      provider: 'api_football',
      directFixtures: [],
      live: [],
      dateFixtures: [],
      sobrescritas: {},
      error: 'Instabilidade momentânea ao consultar partidas. O sistema tentará novamente.',
    })
  }
})

// -------------------------------------------------------------
// GET /backend/v1/jogos-do-dia
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/jogos-do-dia', (e) => {
  try {
    var dateQuery = (e.requestInfo().query.date || '').trim()
    var forceRefresh = e.requestInfo().query.refresh === '1'

    // Formato de data padrão YYYY-MM-DD no fuso de Brasília (UTC-3)
    if (!dateQuery || !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var now = new Date(Date.now() - 3 * 3600 * 1000)
      var ym = ('0' + (now.getUTCMonth() + 1)).slice(-2)
      var yd = ('0' + now.getUTCDate()).slice(-2)
      dateQuery = now.getUTCFullYear() + '-' + ym + '-' + yd
    }

    // Inicializa store global de cache de jogos do dia
    if (typeof globalThis !== 'undefined' && !globalThis.__jogosDoDiaStore) {
      globalThis.__jogosDoDiaStore = {}
    }
    var dayStore = typeof globalThis !== 'undefined' ? globalThis.__jogosDoDiaStore : null
    var dayEntry = dayStore ? dayStore[dateQuery] : null
    var nowMs = Date.now()
    var cacheAgeMs = dayEntry ? nowMs - dayEntry.timestamp : 999999999

    var entryHasLive = Boolean(dayEntry && dayEntry.payload && dayEntry.payload.hasLive === true)
    // TTL OBRIGATÓRIO: Topo da faixa (~30 minutos para o calendário; 5 min enquanto houver jogo "Ao Vivo")
    var maxAgeMs = entryHasLive ? 5 * 60 * 1000 : 30 * 60 * 1000

    // REGRA DE ON-DEMAND FETCHING E CARREGAMENTO PASSIVO:
    // Carregamento passivo da página deve servir SEMPRE do cache interno do servidor se válido.
    // O botão Atualizar (forceRefresh) pode forçar revalidação apenas quando o TTL já expirou;
    // se o TTL ainda estiver válido, mostra os dados em cache imediatamente.
    if (dayEntry && dayEntry.payload) {
      // Se forceRefresh não foi solicitado OU se o TTL ainda está válido, retorna o cache
      if (!forceRefresh || cacheAgeMs < maxAgeMs) {
        var cachedResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
          ttlRemainingSeconds: Math.max(0, Math.round((maxAgeMs - cacheAgeMs) / 1000)),
        })
        return e.json(200, cachedResp)
      }
    }

    // Deduplicação de requisições externas para o mesmo dia
    if (dayEntry && dayEntry.fetching && nowMs - dayEntry.fetching < 10000) {
      if (dayEntry.payload) {
        var dedupResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          deduplicated: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
        })
        return e.json(200, dedupResp)
      }
    }

    // Marca início de fetch para evitar que múltiplas abas chamem a API-Football ao mesmo tempo
    if (dayStore) {
      if (!dayStore[dateQuery]) {
        dayStore[dateQuery] = { timestamp: 0, payload: null, fetching: nowMs }
      } else {
        dayStore[dateQuery].fetching = nowMs
      }
    }

    // Buscar credenciais configuradas
    var apiKey = ''
    var isRapidApi = false
    try {
      var configRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (configRecord) {
        apiKey = (configRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!apiKey) {
      if ($secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
        apiKey = $secrets.get('API_FOOTBALL_KEY')
      } else if ($secrets.has && $secrets.has('RAPIDAPI_KEY')) {
        apiKey = $secrets.get('RAPIDAPI_KEY')
        isRapidApi = true
      } else if ($os.getenv('API_FOOTBALL_KEY')) {
        apiKey = $os.getenv('API_FOOTBALL_KEY')
      } else if ($os.getenv('RAPIDAPI_KEY')) {
        apiKey = $os.getenv('RAPIDAPI_KEY')
        isRapidApi = true
      }
    }

    if (apiKey.length > 40) {
      isRapidApi = true
    }

    if (!apiKey) {
      return e.json(200, {
        configured: false,
        date: dateQuery,
        fixtures: [],
        message: 'API de futebol não configurada pelo administrador.',
      })
    }

    var baseUrl = isRapidApi
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
      : 'https://v3.football.api-sports.io/fixtures'

    var headers = isRapidApi
      ? {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
        }
      : {
          'x-apisports-key': apiKey,
        }

    var callUrl =
      baseUrl + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'
    var isRateLimitErrorDay = function (statusCode, responseBody) {
      if (statusCode === 429) return true
      if (!responseBody) return false
      var strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch (_) {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      if (
        strBody.indexOf('requests limit reached') !== -1 ||
        strBody.indexOf('request limit reached') !== -1 ||
        strBody.indexOf('rate limit') !== -1 ||
        strBody.indexOf('plan reached') !== -1 ||
        strBody.indexOf('too many requests') !== -1 ||
        strBody.indexOf('quota exceeded') !== -1 ||
        strBody.indexOf('exceeded the maximum') !== -1 ||
        strBody.indexOf('free-tier limit') !== -1
      ) {
        return true
      }
      return false
    }

    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    var allFixtures = null
    var rateLimitHit = false

    try {
      var resp = $http.send({
        url: callUrl,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })

      if (isRateLimitErrorDay(resp.statusCode, resp.json || resp.raw)) {
        rateLimitHit = true
      } else if (
        resp &&
        resp.statusCode === 200 &&
        resp.json &&
        Array.isArray(resp.json.response)
      ) {
        allFixtures = resp.json.response
      }
    } catch (eH) {
      console.log('Aviso ao consultar data ' + dateQuery + ':', eH)
    }

    // Tratamento Gracioso para cota excedida (429 ou mensagem de limite)
    if (rateLimitHit) {
      if (dayEntry && dayEntry.payload) {
        var fallbackResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          fallback: true,
          rate_limited: true,
          warning: rateLimitMessage,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
        })
        return e.json(200, fallbackResp)
      }

      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        rate_limited: true,
        error: rateLimitMessage,
      })
    }

    // Se falhou e temos cache antigo, entrega stale
    if (!allFixtures) {
      if (dayEntry && dayEntry.payload) {
        var staleResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          fallback: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
        })
        return e.json(200, staleResp)
      }

      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        error:
          'A API externa de futebol está temporariamente instável ou indisponível. Tente novamente em instantes.',
      })
    }

    var rawFixtures = []
    var hasLiveMatch = false
    var seenFixtureIds = {}

    for (var i = 0; i < allFixtures.length; i++) {
      var item = allFixtures[i]
      var fId = (item.fixture && item.fixture.id) || i
      if (seenFixtureIds[fId]) continue
      seenFixtureIds[fId] = true

      var statusShort = (item.fixture && item.fixture.status && item.fixture.status.short) || ''
      var isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(statusShort) !== -1
      if (isLive) {
        hasLiveMatch = true
      }

      var scorersList = []
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
              extraMinute: ev.time ? ev.time.extra : null,
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

      var leagueId = item.league ? item.league.id : null
      var region = 'Outros'
      if (
        leagueId === 71 ||
        leagueId === 72 ||
        leagueId === 73 ||
        leagueId === 74 ||
        leagueId === 75 ||
        leagueId === 76
      ) {
        region = 'Brasileirão & Copas'
      } else if (leagueId === 13 || leagueId === 11 || leagueId === 450) {
        region = 'Sul-Americana'
      } else if (
        leagueId === 2 ||
        leagueId === 3 ||
        leagueId === 848 ||
        leagueId === 39 ||
        leagueId === 140 ||
        leagueId === 135 ||
        leagueId === 78 ||
        leagueId === 61 ||
        leagueId === 45 ||
        leagueId === 48 ||
        leagueId === 143 ||
        leagueId === 137 ||
        leagueId === 81 ||
        leagueId === 66
      ) {
        region = 'Futebol Europeu'
      }

      rawFixtures.push({
        fixture: item.fixture,
        league: {
          id: item.league ? item.league.id : null,
          name: item.league ? item.league.name : '',
          country: item.league ? item.league.country : '',
          logo: item.league ? item.league.logo : '',
          flag: item.league ? item.league.flag : '',
          round: item.league ? item.league.round : '',
          region: region,
        },
        teams: item.teams,
        goals: item.goals,
        score: item.score,
        scorers: scorersList,
        isLive: isLive,
      })
    }

    var payload = {
      configured: true,
      date: dateQuery,
      total: rawFixtures.length,
      hasLive: hasLiveMatch,
      fixtures: rawFixtures,
      updatedAt: new Date().toISOString(),
    }

    if (dayStore) {
      dayStore[dateQuery] = {
        timestamp: Date.now(),
        payload: payload,
        fetching: 0,
      }
    }

    return e.json(
      200,
      Object.assign({}, payload, {
        cached: false,
        ttlSeconds: Math.round((hasLiveMatch ? 5 * 60 * 1000 : 30 * 60 * 1000) / 1000),
      }),
    )
  } catch (err) {
    console.log('Erro capturado no endpoint jogos-do-dia:', err)
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.__jogosDoDiaStore &&
      globalThis.__jogosDoDiaStore[dateQuery] &&
      globalThis.__jogosDoDiaStore[dateQuery].payload
    ) {
      return e.json(
        200,
        Object.assign({}, globalThis.__jogosDoDiaStore[dateQuery].payload, {
          cached: true,
          fallback: true,
        }),
      )
    }

    return e.json(200, {
      configured: true,
      date: dateQuery || '',
      total: 0,
      hasLive: false,
      fixtures: [],
      error: 'Não foi possível carregar as partidas agora. Tente novamente mais tarde.',
    })
  }
})

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo/config
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/config
// -------------------------------------------------------------
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
    if (apiKey !== undefined) {
      record.set('api_key', apiKey)
    }

    $app.save(record)

    // Invalida caches ao salvar nova chave para que o admin possa testar imediatamente
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__placarAoVivoCacheStore = {}
        globalThis.__jogosDoDiaStore = {}
      }
    } catch (_) {}

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

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/test
// -------------------------------------------------------------
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
          headers: { 'X-Auth-Token': apiKey },
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
        } else if (res.statusCode === 429) {
          return e.json(200, {
            success: false,
            rate_limited: true,
            provider: 'api_football',
            statusCode: 429,
            message:
              'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.',
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

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/sobrescrever
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/sobrescrever', (e) => {
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
    const jogoId = (body.jogo_id || '').trim()
    if (!jogoId) {
      return e.badRequestError('jogo_id é obrigatório.')
    }

    const col = $app.findCollectionByNameOrId('config_integracoes')
    let record
    try {
      record = $app.findFirstRecordByData('config_integracoes', 'chave', 'sobrescrita_jogos')
    } catch (_) {
      record = new Record(col)
      record.set('chave', 'sobrescrita_jogos')
      record.set('provedor', 'api_football')
      record.set('ativo', true)
    }

    let map = {}
    try {
      const raw = record.getString('api_key') || ''
      if (raw && raw.trim()) {
        map = JSON.parse(raw)
      }
    } catch (_) {}

    if (body.remover === true) {
      delete map[jogoId]
    } else {
      var parseNamesList = function (input) {
        if (!input) return []
        if (Array.isArray(input)) {
          return input
            .map(function (m) {
              return String(m || '').trim()
            })
            .filter(Boolean)
        }
        if (typeof input === 'string') {
          return input
            .split(',')
            .map(function (m) {
              return m.trim()
            })
            .filter(Boolean)
        }
        return []
      }

      var marcadoresListA = parseNamesList(body.marcadores_a)
      var marcadoresListB = parseNamesList(body.marcadores_b)
      var marcadoresList = parseNamesList(body.marcadores)

      if (
        marcadoresList.length === 0 &&
        (marcadoresListA.length > 0 || marcadoresListB.length > 0)
      ) {
        marcadoresList = marcadoresListA.concat(marcadoresListB)
      }

      map[jogoId] = {
        jogo_id: jogoId,
        placar_a:
          typeof body.placar_a === 'number' ? body.placar_a : parseInt(body.placar_a, 10) || 0,
        placar_b:
          typeof body.placar_b === 'number' ? body.placar_b : parseInt(body.placar_b, 10) || 0,
        marcadores: marcadoresList,
        marcadores_a: marcadoresListA,
        marcadores_b: marcadoresListB,
        status: (body.status || 'Ao Vivo').trim(),
        updated_at: new Date().toISOString(),
      }
    }

    record.set('api_key', JSON.stringify(map))
    $app.save(record)

    return e.json(200, {
      success: true,
      message: 'Sobrescrita manual salva com sucesso pelo administrador.',
      sobrescritas: map,
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao salvar sobrescrita manual',
    })
  }
})
