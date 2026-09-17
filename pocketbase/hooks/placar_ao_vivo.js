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
        sobrescritas: sobrescritasMap,
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

      // 1.2 Partidas da data atual/especificada (com margem de fuso dateFrom / dateTo)
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
        sobrescritas: sobrescritasMap,
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

      // 2.2 Se solicitou data específica ou para complementar com eventos do dia (-1/+1 dia)
      if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
        var tsdbDates = [dateQuery]
        try {
          var pTS = dateQuery.split('-')
          var yTS = parseInt(pTS[0], 10)
          var mTS = parseInt(pTS[1], 10) - 1
          var dTS = parseInt(pTS[2], 10)

          var prevTS = new Date(Date.UTC(yTS, mTS, dTS - 1))
          var prevTSM = ('0' + (prevTS.getUTCMonth() + 1)).slice(-2)
          var prevTSD = ('0' + prevTS.getUTCDate()).slice(-2)
          tsdbDates.push(prevTS.getUTCFullYear() + '-' + prevTSM + '-' + prevTSD)

          var nextTS = new Date(Date.UTC(yTS, mTS, dTS + 1))
          var nextTSM = ('0' + (nextTS.getUTCMonth() + 1)).slice(-2)
          var nextTSD = ('0' + nextTS.getUTCDate()).slice(-2)
          tsdbDates.push(nextTS.getUTCFullYear() + '-' + nextTSM + '-' + nextTSD)
        } catch (_) {}

        var seenTsdbIds = {}
        for (var ti = 0; ti < tsdbDates.length; ti++) {
          var currentTsdbDate = tsdbDates[ti]
          try {
            const resDay = $http.send({
              url:
                'https://www.thesportsdb.com/api/v1/json/' +
                encodeURIComponent(apiKey) +
                '/eventsday.php?d=' +
                encodeURIComponent(currentTsdbDate) +
                '&s=Soccer',
              method: 'GET',
              timeout: 10,
            })
            if (resDay.statusCode === 200 && resDay.json && Array.isArray(resDay.json.events)) {
              for (var evi = 0; evi < resDay.json.events.length; evi++) {
                var item = resDay.json.events[evi]
                var evId = item.idEvent || currentTsdbDate + '_' + evi
                if (seenTsdbIds[evId]) continue
                seenTsdbIds[evId] = true

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

                dateFixtures.push({
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
                })
              }
            }
          } catch (errDay) {
            console.log(
              'Aviso ao consultar eventsday TheSportsDB:',
              errDay ? errDay.message : errDay,
            )
          }
        }
      }

      return e.json(200, {
        configured: true,
        provider: 'thesportsdb',
        live: liveFixtures,
        dateFixtures: dateFixtures,
        sobrescritas: sobrescritasMap,
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

    // -------------------------------------------------------------
    // CONSULTA DIRETA POR FIXTURE_ID (prioridade máxima via API-Football)
    // Se o cliente enviar ?fixture_id=123 ou ?ids=123,456 ou se houver partidas pendentes
    // cadastradas no banco com fixture_id preenchido.
    // Endpoint direto da API-Football: https://v3.football.api-sports.io/fixtures?id=FIXTURE_ID
    // -------------------------------------------------------------
    var directFixtureParam = (
      e.requestInfo().query.fixture_id ||
      e.requestInfo().query.ids ||
      ''
    ).trim()
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

    // Também verifica no banco todos os jogos pendentes (resultado_finalizado = false) que possuem fixture_id preenchido
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

    var directFixtures = []
    var seenDirectIds = {}

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
        console.log(
          'Aviso ao consultar fixture_id direto (' + targetFixtureId + '):',
          errDirect ? errDirect.message : errDirect,
        )
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
    // Sempre consulta data informada (ou hoje) considerando margem de fuso (-1 dia e +1 dia)
    // e com o parâmetro timezone=America/Sao_Paulo
    if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var computeNeighborDates = function (baseDateStr) {
        var dates = [baseDateStr]
        try {
          var p = baseDateStr.split('-')
          var y = parseInt(p[0], 10)
          var m = parseInt(p[1], 10) - 1
          var d = parseInt(p[2], 10)

          // -1 dia
          var prev = new Date(Date.UTC(y, m, d - 1))
          var prevM = ('0' + (prev.getUTCMonth() + 1)).slice(-2)
          var prevD = ('0' + prev.getUTCDate()).slice(-2)
          dates.push(prev.getUTCFullYear() + '-' + prevM + '-' + prevD)

          // +1 dia
          var next = new Date(Date.UTC(y, m, d + 1))
          var nextM = ('0' + (next.getUTCMonth() + 1)).slice(-2)
          var nextD = ('0' + next.getUTCDate()).slice(-2)
          dates.push(next.getUTCFullYear() + '-' + nextM + '-' + nextD)
        } catch (_) {}
        return dates
      }

      var datesToFetch = computeNeighborDates(dateQuery)
      var seenFixtureIds = {}

      for (var di = 0; di < datesToFetch.length; di++) {
        var dStr = datesToFetch[di]
        var baseUrlDate = isRapidApi
          ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
          : 'https://v3.football.api-sports.io/fixtures'
        var urlDate =
          baseUrlDate + '?date=' + encodeURIComponent(dStr) + '&timezone=America%2FSao_Paulo'

        try {
          var resDate = $http.send({
            url: urlDate,
            method: 'GET',
            headers: headers,
            timeout: 10,
          })
          if (resDate.statusCode === 200 && resDate.json && Array.isArray(resDate.json.response)) {
            for (var ri = 0; ri < resDate.json.response.length; ri++) {
              var rawItem = resDate.json.response[ri]
              var fId = (rawItem.fixture && rawItem.fixture.id) || ri
              if (!seenFixtureIds[fId]) {
                seenFixtureIds[fId] = true
                dateFixtures.push(mapApiFootballItem(rawItem))
              }
            }
          }
        } catch (errDate) {
          console.log(
            'Aviso ao consultar date fixtures API-Football para ' + dStr + ':',
            errDate ? errDate.message : errDate,
          )
        }
      }
    }

    return e.json(200, {
      configured: true,
      provider: 'api_football',
      directFixtures: directFixtures,
      live: liveFixtures,
      dateFixtures: dateFixtures,
      sobrescritas: sobrescritasMap,
    })
  } catch (err) {
    console.log(
      'Aviso ao consultar placar ao vivo (recuperado de forma segura):',
      err ? err.message : err,
    )
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

/**
 * POST /backend/v1/placar-ao-vivo/sobrescrever
 * Salva ou limpa sobrescrita manual de placar e marcadores feita pelo Admin Douglas
 * para partidas em andamento.
 * Body esperado: { jogo_id: string, placar_a?: number, placar_b?: number, marcadores?: string[] | string, ativo?: boolean }
 */
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

    // Se remover ou limpar
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

      // Se marcadores_a ou marcadores_b foram enviados, compõe marcadoresList caso esteja vazio
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

/**
 * GET /backend/v1/jogos-do-dia
 * Calendário e acompanhamento ao vivo dos jogos do dia centralizado via API-Football
 * com cache em memória no servidor (globalThis.__jogosDoDiaCache).
 */
routerAdd('GET', '/backend/v1/jogos-do-dia', (e) => {
  try {
    var dateQuery = (e.requestInfo().query.date || '').trim()
    var forceRefresh = e.requestInfo().query.refresh === '1'

    // Formato de data padrão YYYY-MM-DD
    if (!dateQuery || !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      // Data de hoje em São Paulo (UTC-3)
      var now = new Date(Date.now() - 3 * 3600 * 1000)
      var ym = ('0' + (now.getUTCMonth() + 1)).slice(-2)
      var yd = ('0' + now.getUTCDate()).slice(-2)
      dateQuery = now.getUTCFullYear() + '-' + ym + '-' + yd
    }

    // Cache em tabela ou em objeto global seguro
    var cacheObj = null
    try {
      if (typeof globalThis !== 'undefined' && globalThis.__jogosDoDiaCache) {
        cacheObj = globalThis.__jogosDoDiaCache
      }
    } catch (_) {}

    var nowMs = Date.now()
    var cacheAge = cacheObj && cacheObj.timestamp ? nowMs - cacheObj.timestamp : 9999999

    // Verificar se podemos retornar cache (5 minutos se ao vivo, 15 minutos se calendário/agendado)
    if (!forceRefresh && cacheObj && cacheObj.payload && cacheObj.dataKey === dateQuery) {
      var hasAnyLive = cacheObj.payload.hasLive === true
      var maxAge = hasAnyLive ? 5 * 60 * 1000 : 15 * 60 * 1000
      if (cacheAge < maxAge) {
        var cachedResp = Object.assign({}, cacheObj.payload, {
          cached: true,
          cacheAgeSeconds: Math.round(cacheAge / 1000),
        })
        return e.json(200, cachedResp)
      }
    }

    // Lista oficial de IDs de ligas requeridas (API-Football v3):
    // Brasileirão Série A (71), Série B (72), Série C (73 / 75), Série D (74 / 76), Copa do Brasil (73 / 74)
    // Libertadores (13) e Sul-Americana (450 / 11) -> filtrando confrontos com clubes brasileiros
    // Premier League (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61)
    // Copas nacionais: Copa da Inglaterra (45), Copa da Liga Inglesa (48), Copa do Rei (143), Copa da Itália (137), Copa da Alemanha (81), Copa da França (66)
    // UEFA Champions League (2), Europa League (3), Conference League (848)
    var targetLeagueSet = {
      71: true, // Brasileirão Série A
      72: true, // Brasileirão Série B
      73: true, // Copa do Brasil (ou Série C em algumas numerações)
      74: true, // Copa do Brasil / Série D
      75: true, // Brasileirão Série C
      76: true, // Brasileirão Série D
      13: true, // Copa Libertadores
      11: true, // CONMEBOL Sudamericana (legado)
      450: true, // Copa Sudamericana (API-Football v3 oficial)
      39: true, // Premier League
      140: true, // La Liga
      135: true, // Serie A Itália
      78: true, // Bundesliga
      61: true, // Ligue 1
      45: true, // FA Cup
      48: true, // EFL Cup
      143: true, // Copa del Rey
      137: true, // Coppa Italia
      81: true, // DFB Pokal
      66: true, // Coupe de France
      2: true, // UEFA Champions League
      3: true, // UEFA Europa League
      848: true, // UEFA Conference League
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

    // Se nenhuma chave estiver configurada, retornar indicativo claro
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

    // Buscar partidas da data no fuso de São Paulo com try/catch e margem -1/+1 dia se necessário.
    // Primeiro consulta a data solicitada (com timezone=America/Sao_Paulo).
    // Para garantir que partidas da noite no fuso do Brasil ou partidas internacionais sejam
    // encontradas mesmo com pequenas divergências de fuso horário, buscamos a data do dia corrente.
    var baseUrlDate = baseUrl + '?timezone=America%2FSao_Paulo&date='
    var res = null
    try {
      res = $http.send({
        url: baseUrlDate + encodeURIComponent(dateQuery),
        method: 'GET',
        headers: headers,
        timeout: 9,
      })
    } catch (errHttp) {
      console.log(
        'Aviso ao consultar API-Football para jogos do dia (' + dateQuery + '):',
        errHttp ? errHttp.message : errHttp,
      )
    }

    if (!res || res.statusCode !== 200 || !res.json || !Array.isArray(res.json.response)) {
      // Se tiver cache expirado mas falhar a chamada externa, serve o cache como stale-while-revalidate fallback
      if (cacheObj && cacheObj.payload && cacheObj.dataKey === dateQuery) {
        var staleResp = Object.assign({}, cacheObj.payload, {
          cached: true,
          fallback: true,
          cacheAgeSeconds: Math.round(cacheAge / 1000),
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
          'A API externa de futebol está temporariamente instável ou indisponível (status ' +
          (res ? res.statusCode : 'timeout') +
          '). Tente novamente em instantes.',
      })
    }

    var allFixtures = res.json.response
    var filtered = []
    var hasLiveMatch = false

    // Clubes brasileiros conhecidos em torneios CONMEBOL (Libertadores / Sul-Americana)
    var brazilianClubsRegex =
      /(Flamengo|Palmeiras|São Paulo|Sao Paulo|Corinthians|Fluminense|Grêmio|Gremio|Internacional|Atlético Mineiro|Atletico Mineiro|Atlético-MG|Botafogo|Cruzeiro|Vasco|Athletico Paranaense|Athletico-PR|Fortaleza|Bahia|Bragantino|Red Bull Bragantino|Cuiabá|Cuiaba|Goiás|Goias|Coritiba|Santos|América Mineiro|America-MG|Ceará|Ceara|Juventude|Vitória|Vitoria|Sport|Chapecoense|Avaí|Avai|Ponte Preta)/i

    for (var i = 0; i < allFixtures.length; i++) {
      var item = allFixtures[i]
      var leagueId = item.league ? item.league.id : null
      if (!leagueId || !targetLeagueSet[leagueId]) {
        continue
      }

      // Regra especial Libertadores (13) e Sul-Americana (11 / 450):
      // Exibir SOMENTE confrontos que envolvam clubes brasileiros
      if (leagueId === 13 || leagueId === 11 || leagueId === 450) {
        var homeName = (item.teams && item.teams.home && item.teams.home.name) || ''
        var awayName = (item.teams && item.teams.away && item.teams.away.name) || ''
        var homeCountry = (item.teams && item.teams.home && item.teams.home.country) || ''
        var awayCountry = (item.teams && item.teams.away && item.teams.away.country) || ''

        var isHomeBrazilian = homeCountry === 'Brazil' || brazilianClubsRegex.test(homeName)
        var isAwayBrazilian = awayCountry === 'Brazil' || brazilianClubsRegex.test(awayName)

        if (!isHomeBrazilian && !isAwayBrazilian) {
          continue
        }
      }

      // Extrair status e verificar se está ao vivo
      var statusShort = (item.fixture && item.fixture.status && item.fixture.status.short) || ''
      var isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(statusShort) !== -1
      if (isLive) {
        hasLiveMatch = true
      }

      // Extrair marcadores dos gols com minutagem
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

      // Categorizar região da liga
      var region = 'Outros'
      if (
        leagueId === 71 || // Série A
        leagueId === 72 || // Série B
        leagueId === 73 || // Copa do Brasil / Série C
        leagueId === 74 || // Copa do Brasil / Série D
        leagueId === 75 || // Série C
        leagueId === 76 // Série D
      ) {
        region = 'Brasileirão & Copas'
      } else if (leagueId === 13 || leagueId === 11 || leagueId === 450) {
        region = 'Sul-Americana'
      } else {
        region = 'Futebol Europeu'
      }

      filtered.push({
        fixture: item.fixture,
        league: {
          id: item.league.id,
          name: item.league.name,
          country: item.league.country,
          logo: item.league.logo,
          flag: item.league.flag,
          round: item.league.round,
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
      total: filtered.length,
      hasLive: hasLiveMatch,
      fixtures: filtered,
      updatedAt: new Date().toISOString(),
    }

    // Salva em cache na memória do hook
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__jogosDoDiaCache = {
          dataKey: dateQuery,
          timestamp: Date.now(),
          payload: payload,
        }
      }
    } catch (_) {}

    var finalSuccessResp = Object.assign({}, payload, {
      cached: false,
    })
    return e.json(200, finalSuccessResp)
  } catch (err) {
    console.log('Erro capturado no endpoint jogos-do-dia:', err ? err.message : err)

    // Se houver qualquer cache anterior, retorna ele em vez de 500
    try {
      if (
        typeof globalThis !== 'undefined' &&
        globalThis.__jogosDoDiaCache &&
        globalThis.__jogosDoDiaCache.payload
      ) {
        var fallbackResp = Object.assign({}, globalThis.__jogosDoDiaCache.payload, {
          cached: true,
          fallback: true,
        })
        return e.json(200, fallbackResp)
      }
    } catch (_) {}

    return e.json(200, {
      configured: true,
      date: dateQuery || '',
      total: 0,
      hasLive: false,
      fixtures: [],
      error:
        'Não foi possível carregar as partidas agora: ' +
        (err ? err.message : 'instabilidade momentânea'),
    })
  }
})
