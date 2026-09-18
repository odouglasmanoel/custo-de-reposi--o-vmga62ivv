/**
 * Hook do Placar Ao Vivo e Configurações de Integrações Esportivas.
 * Suporta 3 provedores principais e contingência automática:
 * 1. api_football (API-Football / api-sports / RapidAPI - provedor padrão com ampla cobertura)
 * 2. football_data (Football-Data.org - fallback automático de contingência quando API-Football estourar cota 429)
 * 3. thesportsdb (TheSportsDB - API v1 com chave pública ou privada)
 *
 * REGRAS CRÍTICAS DE ECONOMIA DE COTA, TIMEOUT E CACHE:
 * 1. Cache server-side obrigatório: 30 minutos para calendário/dia e 5 minutos enquanto houver jogos ao vivo.
 * 2. Deduplicação de requisições externas e proteção contra loop / recarregamentos simultâneos (janela mínima 10s).
 * 3. Timeout estrito de 8s para qualquer chamada externa para evitar travar requisições em 120s.
 * 4. Rota de contingência: Quando API-Football retornar 429 ou "requests limit reached", redirecionar AUTOMATICAMENTE
 *    para o Football-Data.org usando a chave de contingência configurada (ou chave primária se football_data),
 *    normalizando os dados para a mesma estrutura interna consumida pelo frontend.
 * 5. Se ambos falharem por 429/cota, retornar HTTP 200 com rate_limited: true e mensagem amigável sem inventar 0x0.
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

    // 1. Lê configurações salvas no banco de dados (registro principal e chave secundária de contingência)
    let provedor = 'api_football'
    let apiKey = ''
    let fallbackApiKey = ''
    let ativo = true

    try {
      const configRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'api_football'
        apiKey = (configRecord.getString('api_key') || '').trim()
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // Busca chave secundária de contingência (Football-Data.org) salva em config_integracoes
    try {
      const fallbackRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fallbackRecord) {
        fallbackApiKey = (fallbackRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    // Fallbacks para env / secrets
    if (!fallbackApiKey) {
      try {
        fallbackApiKey =
          ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
            ? $secrets.get('FOOTBALL_DATA_KEY')
            : '') ||
          $os.getenv('FOOTBALL_DATA_KEY') ||
          ''
      } catch (_) {}
    }

    if (!apiKey) {
      if (provedor === 'football_data') {
        apiKey = fallbackApiKey
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
            provedor = 'api_football'
          }
        } catch (_) {}
      }
    }

    // Chave do TheSportsDB (pode ser chave própria em config_integracoes 'thesportsdb_fallback' ou env ou '3')
    let theSportsDbKey = ''
    try {
      const tsdbRec = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'thesportsdb_fallback',
      )
      if (tsdbRec) {
        theSportsDbKey = (tsdbRec.getString('api_key') || '').trim()
      }
    } catch (_) {}
    if (!theSportsDbKey) {
      try {
        theSportsDbKey =
          ($secrets.has && $secrets.has('THESPORTSDB_KEY')
            ? $secrets.get('THESPORTSDB_KEY')
            : '') ||
          $os.getenv('THESPORTSDB_KEY') ||
          ''
      } catch (_) {}
    }
    if (!theSportsDbKey && provedor === 'thesportsdb' && apiKey) {
      theSportsDbKey = apiKey
    }
    if (!theSportsDbKey) {
      theSportsDbKey = '3'
    }

    // Provedor TheSportsDB pode funcionar com chave pública "3" se nenhuma outra for inserida
    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = theSportsDbKey
    }

    // Função utilitária para buscar partidas no TheSportsDB (CONMEBOL + UEFA secundárias)
    // Converte para a estrutura esperada de rawFixtures (formato API-Football)
    // Cobre targetDate e também targetDate + 1 dia (para compensar fuso UTC vs Brasília UTC-3)
    var fetchConmebolFromTheSportsDb = function (targetDate, apiKeyTsdb) {
      if (!targetDate) return []
      var key = apiKeyTsdb || '3'
      var conmebolFixtures = []
      var conmebolLeagues = [
        {
          id: 4501,
          name: 'Copa Libertadores',
          shortId: 13,
          region: 'Sul-Americana',
          country: 'South America',
        },
        {
          id: 4724,
          name: 'Copa Sudamericana',
          shortId: 11,
          region: 'Sul-Americana',
          country: 'South America',
        },
        {
          id: 4351,
          name: 'Brazilian Serie A',
          shortId: 71,
          region: 'Brasileirão & Copas',
          country: 'Brazil',
        },
        {
          id: 4404,
          name: 'Brazilian Serie B',
          shortId: 72,
          region: 'Brasileirão & Copas',
          country: 'Brazil',
        },
        {
          id: 4725,
          name: 'Copa do Brasil',
          shortId: 73,
          region: 'Brasileirão & Copas',
          country: 'Brazil',
        },
        {
          id: 4480,
          name: 'UEFA Champions League',
          shortId: 2,
          region: 'Futebol Europeu',
          country: 'Europe',
        },
        {
          id: 4481,
          name: 'UEFA Europa League',
          shortId: 3,
          region: 'Futebol Europeu',
          country: 'Europe',
        },
        {
          id: 5071,
          name: 'UEFA Europa Conference League',
          shortId: 848,
          region: 'Futebol Europeu',
          country: 'Europe',
        },
        {
          id: 4335,
          name: 'La Liga',
          shortId: 140,
          region: 'Futebol Europeu',
          country: 'Spain',
        },
        {
          id: 4400,
          name: 'Spanish La Liga 2',
          shortId: 141,
          region: 'Futebol Europeu',
          country: 'Spain',
        },
        {
          id: 4483,
          name: 'Copa del Rey',
          shortId: 143,
          region: 'Futebol Europeu',
          country: 'Spain',
        },
        {
          id: 4328,
          name: 'Premier League',
          shortId: 39,
          region: 'Futebol Europeu',
          country: 'England',
        },
        {
          id: 4332,
          name: 'Serie A',
          shortId: 135,
          region: 'Futebol Europeu',
          country: 'Italy',
        },
        {
          id: 4331,
          name: 'Bundesliga',
          shortId: 78,
          region: 'Futebol Europeu',
          country: 'Germany',
        },
        {
          id: 4334,
          name: 'Ligue 1',
          shortId: 61,
          region: 'Futebol Europeu',
          country: 'France',
        },
      ]

      // Gera targetDate e targetDate seguinte (UTC+1) para cobrir jogos noturnos (ex: 21h30 Brasília = 00h30 UTC seguinte)
      var targetDatesList = [targetDate]
      try {
        var pDateParts = targetDate.split('-')
        if (pDateParts.length === 3) {
          var yBase = parseInt(pDateParts[0], 10)
          var mBase = parseInt(pDateParts[1], 10) - 1
          var dBase = parseInt(pDateParts[2], 10)
          var nextDayUtc = new Date(Date.UTC(yBase, mBase, dBase + 1))
          var nextDayStr =
            nextDayUtc.getUTCFullYear() +
            '-' +
            ('0' + (nextDayUtc.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + nextDayUtc.getUTCDate()).slice(-2)
          if (nextDayStr && targetDatesList.indexOf(nextDayStr) === -1) {
            targetDatesList.push(nextDayStr)
          }
        }
      } catch (_) {}

      var seenEventIds = {}

      for (var tdi = 0; tdi < targetDatesList.length; tdi++) {
        var currDate = targetDatesList[tdi]
        for (var cli = 0; cli < conmebolLeagues.length; cli++) {
          var cl = conmebolLeagues[cli]
          try {
            var tsdbUrl =
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(key) +
              '/eventsday.php?d=' +
              encodeURIComponent(currDate) +
              '&s=Soccer&l=' +
              encodeURIComponent(cl.id)

            var resTsdb = $http.send({
              url: tsdbUrl,
              method: 'GET',
              timeout: 8,
            })

            if (!resTsdb || resTsdb.statusCode !== 200) {
              console.log(
                '[TheSportsDB Fallback] HTTP ' +
                  (resTsdb ? resTsdb.statusCode : 0) +
                  ' ao buscar liga ' +
                  cl.name +
                  ' (ignorado silenciosamente)',
              )
              continue
            }

            if (resTsdb.json && Array.isArray(resTsdb.json.events)) {
              var events = resTsdb.json.events
              for (var ei = 0; ei < events.length; ei++) {
                var ev = events[ei]
                var eventKey = ev.idEvent
                  ? String(ev.idEvent)
                  : ev.strHomeTeam + '_' + ev.strAwayTeam + '_' + (ev.dateEvent || currDate)
                if (seenEventIds[eventKey]) continue
                seenEventIds[eventKey] = true

                var homeTeam = (ev.strHomeTeam || '').trim()
                var awayTeam = (ev.strAwayTeam || '').trim()
                if (!homeTeam || !awayTeam) continue

                var evDate = ev.dateEvent || targetDate
                var evTime = ev.strTime || '20:00:00'
                // Monta ISO string aproximada (UTC)
                var isoDateStr =
                  evDate + 'T' + (evTime.indexOf(':') !== -1 ? evTime : '20:00:00') + 'Z'

                var hScore =
                  ev.intHomeScore !== null &&
                  ev.intHomeScore !== undefined &&
                  ev.intHomeScore !== ''
                    ? parseInt(ev.intHomeScore, 10)
                    : null
                var aScore =
                  ev.intAwayScore !== null &&
                  ev.intAwayScore !== undefined &&
                  ev.intAwayScore !== ''
                    ? parseInt(ev.intAwayScore, 10)
                    : null

                var rawStatus = (ev.strStatus || '').trim().toUpperCase()
                var shortStatus = 'NS'
                if (
                  rawStatus === 'FT' ||
                  rawStatus === 'AOT' ||
                  rawStatus === 'FINISHED' ||
                  rawStatus === 'MATCH FINISHED'
                ) {
                  shortStatus = 'FT'
                } else if (
                  rawStatus === '1H' ||
                  rawStatus === '2H' ||
                  rawStatus === 'HT' ||
                  rawStatus === 'LIVE' ||
                  rawStatus === 'IN PROGRESS'
                ) {
                  shortStatus = rawStatus === 'HT' ? 'HT' : '1H'
                } else if (rawStatus === 'POSTPONED' || rawStatus === 'PST') {
                  shortStatus = 'PST'
                } else if (rawStatus === 'CANCELLED' || rawStatus === 'CANC') {
                  shortStatus = 'CANC'
                }

                var tsdbScorers = []
                var tsdbEvents = []
                var parseTsdbGoalStr = function (detailStr, teamSide, teamId, teamName) {
                  if (typeof detailStr !== 'string' || !detailStr.trim()) return
                  var parts = detailStr.split(';')
                  for (var pi = 0; pi < parts.length; pi++) {
                    var rawPart = parts[pi].trim()
                    if (!rawPart) continue
                    var plusMatch = rawPart.match(/(\d+)\s*\+\s*(\d+)/)
                    var extractedMin = null
                    var extractedExtra = null
                    if (plusMatch) {
                      extractedMin = parseInt(plusMatch[1], 10)
                      extractedExtra = parseInt(plusMatch[2], 10)
                    } else {
                      var minMatch = rawPart.match(/(\d+)'?/)
                      extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                    }
                    var nameClean = rawPart
                      .replace(/^\d+(\+\d+)?'?:?/, '')
                      .replace(/\s*\d+(\+\d+)?'?$/, '')
                      .replace(/\s*\(pen\.?\)/i, '')
                      .trim()
                    var isOwnGoal = /contra|own\s*goal|o\.?g\.?/i.test(rawPart)
                    if (isOwnGoal && nameClean.toLowerCase().indexOf('contra') === -1) {
                      nameClean += ' (contra)'
                    }
                    if (nameClean) {
                      tsdbScorers.push({
                        name: nameClean,
                        minute: extractedMin,
                        extraMinute: extractedExtra,
                        teamId: teamId || null,
                        teamName: teamName || null,
                        teamSide: teamSide,
                      })
                      tsdbEvents.push({
                        type: 'Goal',
                        detail: isOwnGoal ? 'Own Goal' : 'Normal Goal',
                        time: { elapsed: extractedMin, extra: extractedExtra },
                        team: { id: teamId || null, name: teamName || '' },
                        player: { id: null, name: nameClean },
                      })
                    }
                  }
                }

                var hTeamId = parseInt(ev.idHomeTeam, 10) || null
                var aTeamId = parseInt(ev.idAwayTeam, 10) || null
                parseTsdbGoalStr(ev.strHomeGoalDetails, 'home', hTeamId, homeTeam)
                parseTsdbGoalStr(ev.strAwayGoalDetails, 'away', aTeamId, awayTeam)

                // FIX 1: Se houver gols marcados no placar mas nenhum marcador veio em strHomeGoalDetails/strAwayGoalDetails
                var needsTimelineLookup =
                  ((hScore !== null && hScore > 0) || (aScore !== null && aScore > 0)) &&
                  tsdbScorers.length === 0 &&
                  ev.idEvent

                if (needsTimelineLookup) {
                  try {
                    // Tenta lookuptimeline.php?id={idEvent}
                    var tlUrl =
                      'https://www.thesportsdb.com/api/v1/json/' +
                      encodeURIComponent(key) +
                      '/lookuptimeline.php?id=' +
                      encodeURIComponent(ev.idEvent)
                    var tlRes = $http.send({
                      url: tlUrl,
                      method: 'GET',
                      timeout: 4,
                    })

                    var tlItems = null
                    if (
                      tlRes &&
                      tlRes.statusCode === 200 &&
                      tlRes.json &&
                      Array.isArray(tlRes.json.timeline)
                    ) {
                      tlItems = tlRes.json.timeline
                    } else if (tlRes && tlRes.statusCode !== 200) {
                      console.log(
                        '[TheSportsDB Timeline] HTTP ' +
                          tlRes.statusCode +
                          ' no evento ' +
                          ev.idEvent +
                          ' (ignorado silenciosamente)',
                      )
                    }

                    // Fallback para lookupevent.php?id={idEvent} se lookuptimeline não retornar timeline
                    if (!tlItems || tlItems.length === 0) {
                      var lkUrl =
                        'https://www.thesportsdb.com/api/v1/json/' +
                        encodeURIComponent(key) +
                        '/lookupevent.php?id=' +
                        encodeURIComponent(ev.idEvent)
                      var lkRes = $http.send({
                        url: lkUrl,
                        method: 'GET',
                        timeout: 4,
                      })
                      if (
                        lkRes &&
                        lkRes.statusCode === 200 &&
                        lkRes.json &&
                        Array.isArray(lkRes.json.events) &&
                        lkRes.json.events[0]
                      ) {
                        var singleEv = lkRes.json.events[0]
                        parseTsdbGoalStr(singleEv.strHomeGoalDetails, 'home', hTeamId, homeTeam)
                        parseTsdbGoalStr(singleEv.strAwayGoalDetails, 'away', aTeamId, awayTeam)
                      } else if (lkRes && lkRes.statusCode !== 200) {
                        console.log(
                          '[TheSportsDB LookupEvent] HTTP ' +
                            lkRes.statusCode +
                            ' no evento ' +
                            ev.idEvent +
                            ' (ignorado silenciosamente)',
                        )
                      }
                    } else {
                      for (var tli = 0; tli < tlItems.length; tli++) {
                        var itemTl = tlItems[tli]
                        var tlType = String(itemTl.strTimeline || itemTl.strType || '')
                          .trim()
                          .toLowerCase()
                        if (
                          tlType === 'goal' ||
                          tlType === 'gol' ||
                          tlType.indexOf('goal') !== -1
                        ) {
                          var pName = (itemTl.strPlayer || itemTl.strPlayerName || '').trim()
                          if (!pName) continue
                          var tlTime =
                            itemTl.intTime !== null && itemTl.intTime !== undefined
                              ? parseInt(itemTl.intTime, 10)
                              : itemTl.intMinute !== null && itemTl.intMinute !== undefined
                                ? parseInt(itemTl.intMinute, 10)
                                : null
                          var tlTeamId = parseInt(itemTl.idTeam, 10) || null
                          var tlSide = null
                          if (tlTeamId && hTeamId && tlTeamId === hTeamId) {
                            tlSide = 'home'
                          } else if (tlTeamId && aTeamId && tlTeamId === aTeamId) {
                            tlSide = 'away'
                          } else {
                            var tlSideStr = String(
                              itemTl.strTimelineDetail || itemTl.strSide || '',
                            ).toLowerCase()
                            if (tlSideStr.indexOf('home') !== -1) tlSide = 'home'
                            else if (tlSideStr.indexOf('away') !== -1) tlSide = 'away'
                          }
                          var tlIsOwn = /contra|own/i.test(itemTl.strTimelineDetail || '')
                          var pureScorerName = pName
                          if (tlIsOwn && pureScorerName.toLowerCase().indexOf('contra') === -1) {
                            pureScorerName += ' (contra)'
                          }
                          tsdbScorers.push({
                            name: pureScorerName,
                            rawName: pName,
                            minute: tlTime,
                            extraMinute: null,
                            teamId: tlTeamId || (tlSide === 'home' ? hTeamId : aTeamId),
                            teamName: tlSide === 'home' ? homeTeam : awayTeam,
                            teamSide: tlSide || 'home',
                          })
                          tsdbEvents.push({
                            type: 'Goal',
                            detail: tlIsOwn ? 'Own Goal' : 'Normal Goal',
                            time: { elapsed: tlTime, extra: null },
                            team: {
                              id: tlTeamId || (tlSide === 'home' ? hTeamId : aTeamId),
                              name: tlSide === 'home' ? homeTeam : awayTeam,
                            },
                            player: { id: null, name: pName },
                          })
                        }
                      }
                    }
                  } catch (errTimeline) {
                    console.log(
                      '[TheSportsDB Timeline] Erro ignorado ao consultar timeline do evento ' +
                        ev.idEvent +
                        ':',
                      errTimeline,
                    )
                  }
                }

                conmebolFixtures.push({
                  fixture: {
                    id: 'tsdb_' + (ev.idEvent || cli + '_' + ei),
                    date: isoDateStr,
                    timestamp: Math.floor(new Date(isoDateStr).getTime() / 1000) || 0,
                    status: {
                      short: shortStatus,
                      long: ev.strStatus || 'Not Started',
                      elapsed: null,
                    },
                  },
                  league: {
                    id: cl.shortId,
                    name: ev.strLeague || cl.name,
                    country: cl.country || 'Europe',
                    logo: ev.strLeagueBadge || ev.strBadge || '',
                    flag: '',
                    round: ev.strRound || '',
                    region: cl.region || 'Sul-Americana',
                  },
                  teams: {
                    home: {
                      id: hTeamId || 0,
                      name: homeTeam,
                      logo: ev.strHomeTeamBadge || '',
                      country: cl.country || 'Europe',
                    },
                    away: {
                      id: aTeamId || 0,
                      name: awayTeam,
                      logo: ev.strAwayTeamBadge || '',
                      country: cl.country || 'Europe',
                    },
                  },
                  goals: {
                    home: !isNaN(hScore) ? hScore : null,
                    away: !isNaN(aScore) ? aScore : null,
                  },
                  score: {
                    halftime: { home: null, away: null },
                    fulltime: {
                      home: !isNaN(hScore) ? hScore : null,
                      away: !isNaN(aScore) ? aScore : null,
                    },
                  },
                  events: tsdbEvents,
                  scorers: tsdbScorers,
                  isLive: ['1H', 'HT', '2H', 'LIVE'].indexOf(shortStatus) !== -1,
                  provider: 'thesportsdb',
                })
              }
            }
          } catch (errTsdbLeague) {
            console.log(
              '[TheSportsDB Fallback] Erro ao buscar liga ' + cl.name + ':',
              errTsdbLeague,
            )
          }
        }
      }

      return conmebolFixtures
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

    if (!apiKey && !fallbackApiKey) {
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

    // Registra timestamp da última partida ao vivo conhecida nesta chave para transição suave
    if (entryHasLive && cacheEntry) {
      cacheEntry.lastLiveTimestamp = nowMs
    }
    // Se havia jogo ao vivo nos últimos 10 minutos (transição Ao Vivo -> Finalizado), usa TTL curto
    var hadRecentLive = Boolean(
      cacheEntry &&
      cacheEntry.lastLiveTimestamp &&
      nowMs - cacheEntry.lastLiveTimestamp < 10 * 60 * 1000,
    )

    // TTL: 1-2 min (90.000 ms) se houver jogo ao vivo ou transição recente; 30 min para dias/jogos agendados
    var effectiveTTL = entryHasLive || hadRecentLive ? 90 * 1000 : 30 * 60 * 1000
    var cacheAgeMs = cacheEntry ? nowMs - cacheEntry.timestamp : 999999999

    // Se o cache é válido, serve diretamente do cache interno SEM fazer nenhuma chamada externa
    // (Apenas se o cache possuir dados válidos)
    if (cacheEntry && cacheEntry.data) {
      var totalCachedFixtures =
        (Array.isArray(cacheEntry.data.live) ? cacheEntry.data.live.length : 0) +
        (Array.isArray(cacheEntry.data.dateFixtures) ? cacheEntry.data.dateFixtures.length : 0) +
        (Array.isArray(cacheEntry.data.directFixtures) ? cacheEntry.data.directFixtures.length : 0)
      if (totalCachedFixtures > 0) {
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

    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    // -------------------------------------------------------------
    // ADAPTER E NORMALIZAÇÃO DO FOOTBALL-DATA.ORG
    // Transforma matches da v4 da Football-Data.org na mesma estrutura
    // consumida pelo front e pelo matcher fuzzy
    // -------------------------------------------------------------
    var mapFootballDataItem = function (m) {
      var homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
      var awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
      var htHome = m.score && m.score.halfTime ? m.score.halfTime.home : null
      var htAway = m.score && m.score.halfTime ? m.score.halfTime.away : null

      var scorersList = []
      var eventsList = []

      var homeId = m.homeTeam ? m.homeTeam.id : undefined
      var awayId = m.awayTeam ? m.awayTeam.id : undefined
      var homeName = (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || ''
      var awayName = (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || ''

      if (Array.isArray(m.goals)) {
        for (var gi = 0; gi < m.goals.length; gi++) {
          var g = m.goals[gi]
          var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
          var isOwnGoal = (g.type || '').toUpperCase() === 'OWN'
          if (scorerName && isOwnGoal) {
            scorerName += ' (contra)'
          }

          var gTeamId = g.team ? g.team.id : null
          var gTeamSide = null
          if (gTeamId != null) {
            if (homeId != null && gTeamId === homeId) gTeamSide = 'home'
            else if (awayId != null && gTeamId === awayId) gTeamSide = 'away'
          }

          if (scorerName) {
            var gExtraMin =
              g.extraTime != null ? g.extraTime : g.injuryTime != null ? g.injuryTime : null
            scorersList.push({
              name: scorerName,
              minute: g.minute || null,
              extraMinute: gExtraMin,
              teamId: gTeamId,
              teamName: g.team ? g.team.name || g.team.shortName : null,
              teamSide: gTeamSide,
            })
            eventsList.push({
              type: 'Goal',
              detail: isOwnGoal ? 'Own Goal' : 'Normal Goal',
              time: { elapsed: g.minute || null, extra: gExtraMin },
              team: { id: gTeamId, name: g.team ? g.team.name : '' },
              player: { id: g.scorer ? g.scorer.id : null, name: scorerName },
            })
          }
        }
      }

      var rawStatus = (m.status || '').toUpperCase().trim()
      var stShort = rawStatus
      if (rawStatus === 'PAUSED') {
        stShort = 'HT'
      } else if (rawStatus === 'IN_PLAY') {
        stShort = '1H'
      } else if (rawStatus === 'FINISHED') {
        stShort = 'FT'
      } else if (rawStatus === 'POSTPONED' || rawStatus === 'PST') {
        stShort = 'PST'
      } else if (rawStatus === 'CANCELLED' || rawStatus === 'CANC') {
        stShort = 'CANC'
      } else if (rawStatus === 'SUSPENDED' || rawStatus === 'SUSP') {
        stShort = 'SUSP'
      }

      return {
        provider: 'football_data',
        fixture: {
          id: m.id,
          date: m.utcDate,
          status: {
            short: stShort,
            long: m.status,
            elapsed: m.minute || null,
          },
        },
        teams: {
          home: {
            id: homeId,
            name: homeName,
            logo: m.homeTeam ? m.homeTeam.crest : '',
          },
          away: {
            id: awayId,
            name: awayName,
            logo: m.awayTeam ? m.awayTeam.crest : '',
          },
        },
        goals: {
          home: typeof homeScore === 'number' ? homeScore : null,
          away: typeof awayScore === 'number' ? awayScore : null,
        },
        score: {
          halftime: { home: htHome, away: htAway },
          fulltime: { home: homeScore, away: awayScore },
        },
        events: eventsList,
        scorers: scorersList,
      }
    }

    // Função interna que executa busca completa no Football-Data.org
    var fetchFootballDataFixtures = function (fdKey, targetDate, targetDirectIds) {
      var result = {
        live: [],
        dateFixtures: [],
        directFixtures: [],
        rateLimited: false,
      }

      if (!fdKey) return result

      // 1. Busca partidas ao vivo
      try {
        var resLive = $http.send({
          url: 'https://api.football-data.org/v4/matches?status=LIVE',
          method: 'GET',
          headers: { 'X-Auth-Token': fdKey },
          timeout: 8,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          result.rateLimited = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.matches)
        ) {
          result.live = resLive.json.matches.map(mapFootballDataItem)
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live Football-Data.org:', errLive)
      }

      // 2. Busca partidas por data (intervalo de 1 dia antes a 1 dia depois para cobrir fuso SP)
      if (!result.rateLimited && targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        try {
          var pFD = targetDate.split('-')
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

          var urlDate =
            'https://api.football-data.org/v4/matches?dateFrom=' +
            encodeURIComponent(dateFrom) +
            '&dateTo=' +
            encodeURIComponent(dateTo)

          var resDate = $http.send({
            url: urlDate,
            method: 'GET',
            headers: { 'X-Auth-Token': fdKey },
            timeout: 8,
          })

          if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
            result.rateLimited = true
          } else if (
            resDate.statusCode === 200 &&
            resDate.json &&
            Array.isArray(resDate.json.matches)
          ) {
            var rawDateMatches = resDate.json.matches
            for (var rmi = 0; rmi < rawDateMatches.length; rmi++) {
              var rm = rawDateMatches[rmi]
              var rmHome = rm.score && rm.score.fullTime ? rm.score.fullTime.home : null
              var rmAway = rm.score && rm.score.fullTime ? rm.score.fullTime.away : null
              var rmHasScoreOrLive =
                (typeof rmHome === 'number' && rmHome > 0) ||
                (typeof rmAway === 'number' && rmAway > 0) ||
                rm.status === 'IN_PLAY' ||
                rm.status === 'PAUSED'
              if (
                rmHasScoreOrLive &&
                (!Array.isArray(rm.goals) || rm.goals.length === 0) &&
                rm.id &&
                fdKey
              ) {
                try {
                  var resDetailRm = $http.send({
                    url: 'https://api.football-data.org/v4/matches/' + encodeURIComponent(rm.id),
                    method: 'GET',
                    headers: { 'X-Auth-Token': fdKey },
                    timeout: 6,
                  })
                  if (
                    resDetailRm &&
                    resDetailRm.statusCode === 200 &&
                    resDetailRm.json &&
                    Array.isArray(resDetailRm.json.goals)
                  ) {
                    rm.goals = resDetailRm.json.goals
                    if (resDetailRm.json.score && resDetailRm.json.score.fullTime) {
                      rm.score = resDetailRm.json.score
                    }
                  }
                } catch (errRmSingle) {
                  console.log('[Football-Data Date Match Detail] Erro:', errRmSingle)
                }
              }
            }
            result.dateFixtures = rawDateMatches.map(mapFootballDataItem)
          }
        } catch (errDate) {
          console.log('Aviso ao consultar date Football-Data.org:', errDate)
        }
      }

      // 3. Busca partidas por ID direto se houver targetDirectIds
      if (!result.rateLimited && Array.isArray(targetDirectIds) && targetDirectIds.length > 0) {
        var seenFdIds = {}
        for (var fdi = 0; fdi < targetDirectIds.length; fdi++) {
          var targetFdId = targetDirectIds[fdi]
          if (!targetFdId || seenFdIds[targetFdId]) continue
          seenFdIds[targetFdId] = true

          try {
            var resFdDirect = $http.send({
              url: 'https://api.football-data.org/v4/matches/' + encodeURIComponent(targetFdId),
              method: 'GET',
              headers: { 'X-Auth-Token': fdKey },
              timeout: 8,
            })

            if (isRateLimitError(resFdDirect.statusCode, resFdDirect.json || resFdDirect.raw)) {
              result.rateLimited = true
              break
            } else if (resFdDirect.statusCode === 200 && resFdDirect.json && resFdDirect.json.id) {
              result.directFixtures.push(mapFootballDataItem(resFdDirect.json))
            }
          } catch (errFdDirect) {
            console.log(
              'Aviso ao consultar match id direto no Football-Data.org (' + targetFdId + '):',
              errFdDirect,
            )
          }
        }
      }

      return result
    }

    var rateLimitDetected = false

    // -------------------------------------------------------------
    // PROVEDOR: Football-Data.org Selecionado Primariamente (com contingência para API-Football se falhar)
    // -------------------------------------------------------------
    if (provedor === 'football_data') {
      var fdKeyToUse = apiKey || fallbackApiKey
      var fdResults = fetchFootballDataFixtures(fdKeyToUse, dateQuery, directFixtureIds)

      var totalFdMatches =
        (fdResults.live ? fdResults.live.length : 0) +
        (fdResults.dateFixtures ? fdResults.dateFixtures.length : 0) +
        (fdResults.directFixtures ? fdResults.directFixtures.length : 0)

      // Fallback para API-Football caso Football-Data.org falhe ou sofra rate-limit
      if ((fdResults.rateLimited || totalFdMatches === 0) && !fdResults.rateLimited) {
        // Se 0 partidas ou erro, tenta API-Football como contingência se houver chave
        var altKey = ''
        try {
          var fbRec = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'football_data_fallback',
          )
          // Se football_data é principal, chave alternativa pode vir de API-Football
          if (apiKey && apiKey !== fdKeyToUse) altKey = apiKey
        } catch (_) {}
        if (!altKey) {
          try {
            altKey =
              ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
                ? $secrets.get('API_FOOTBALL_KEY')
                : '') ||
              ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
              $os.getenv('API_FOOTBALL_KEY') ||
              $os.getenv('RAPIDAPI_KEY') ||
              ''
          } catch (_) {}
        }
        if (altKey) {
          console.log(
            '[Contingência Reversa] Football-Data.org retornou 0 partidas. Tentando API-Football...',
          )
          // (Deixa seguir para API-Football como contingência caso necessário)
        }
      }

      if (fdResults.rateLimited) {
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

      // REGRA: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
      if (totalFdMatches === 0) {
        console.log(
          '[Aviso Cache] Football-Data.org retornou 0 partidas. Não gravando array vazio no cache.',
        )
        if (cacheEntry && cacheEntry.data) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
              warning:
                'Nenhuma nova partida retornada pela Football-Data.org; mantendo último resultado válido.',
            }),
          )
        }
        return e.json(200, {
          configured: true,
          provider: 'football_data',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          cached: false,
          warning: 'Nenhuma partida encontrada no Football-Data.org para os critérios informados.',
        })
      }

      var fdPayload = {
        configured: true,
        provider: 'football_data',
        live: fdResults.live,
        dateFixtures: fdResults.dateFixtures,
        directFixtures: fdResults.directFixtures,
        updatedAt: new Date().toISOString(),
      }

      // Só grava no cache se houver pelo menos 1 partida!
      if (cacheStore && totalFdMatches > 0) {
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
    // PROVEDOR: TheSportsDB Selecionado Primariamente
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
          timeout: 8,
        })

        if (resLive && isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive &&
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
            var parseTsdbDetails = function (detailStr, teamSide, tId, tName) {
              if (typeof detailStr !== 'string' || !detailStr.trim()) return
              var parts = detailStr.split(';')
              for (var pi = 0; pi < parts.length; pi++) {
                var rawPart = parts[pi].trim()
                if (!rawPart) continue
                var plusMatch = rawPart.match(/(\d+)\s*\+\s*(\d+)/)
                var extractedMin = null
                var extractedExtra = null
                if (plusMatch) {
                  extractedMin = parseInt(plusMatch[1], 10)
                  extractedExtra = parseInt(plusMatch[2], 10)
                } else {
                  var minMatch = rawPart.match(/(\d+)'?/)
                  extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                }
                var nameClean = rawPart
                  .replace(/^\d+(\+\d+)?'?:?/, '')
                  .replace(/\s*\d+(\+\d+)?'?$/, '')
                  .replace(/\s*\(pen\.?\)/i, '')
                  .trim()
                var isOwnGoal = /contra|own\s*goal|o\.?g\.?/i.test(rawPart)
                if (isOwnGoal && nameClean.toLowerCase().indexOf('contra') === -1) {
                  nameClean += ' (contra)'
                }
                if (nameClean) {
                  scorersList.push({
                    name: nameClean,
                    minute: extractedMin,
                    extraMinute: extractedExtra,
                    teamId: tId || null,
                    teamName: tName || null,
                    teamSide: teamSide,
                  })
                }
              }
            }
            parseTsdbDetails(item.strHomeGoalDetails, 'home', item.idHomeTeam, item.strHomeTeam)
            parseTsdbDetails(item.strAwayGoalDetails, 'away', item.idAwayTeam, item.strAwayTeam)

            if (Array.isArray(item.golevents)) {
              for (var gei = 0; gei < item.golevents.length; gei++) {
                var gev = item.golevents[gei]
                var gevName = gev.strPlayer || gev.strScorer || ''
                if (gevName && String(gevName).trim()) {
                  var gevMin =
                    gev.intGoalScoredTime != null ? parseInt(gev.intGoalScoredTime, 10) : null
                  var gevSide =
                    gev.strHomeAway === 'Home' || gev.strHomeAway === 'home'
                      ? 'home'
                      : gev.strHomeAway === 'Away' || gev.strHomeAway === 'away'
                        ? 'away'
                        : null
                  scorersList.push({
                    name: String(gevName).trim(),
                    minute: isNaN(gevMin) ? null : gevMin,
                    extraMinute: null,
                    teamId: gev.idTeam || null,
                    teamName: gev.strTeam || null,
                    teamSide: gevSide,
                  })
                }
              }
            }

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

      var totalTsdb = liveFixtures.length + dateFixtures.length
      if (totalTsdb === 0) {
        console.log('[Aviso Cache] TheSportsDB retornou 0 partidas. Não gravando no cache.')
        if (cacheEntry && cacheEntry.data) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
            }),
          )
        }
      }

      var tsdbPayload = {
        configured: true,
        provider: 'thesportsdb',
        live: liveFixtures,
        dateFixtures: dateFixtures,
        directFixtures: [],
        updatedAt: new Date().toISOString(),
      }

      // Só grava no cache se houver pelo menos 1 partida!
      if (cacheStore && totalTsdb > 0) {
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
    // PROVEDOR 3: API-Football (Principal) com CONTINGÊNCIA AUTOMÁTICA
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
          var evType = ev && ev.type ? String(ev.type).toLowerCase() : ''
          var evDetail = ev && ev.detail ? String(ev.detail).toLowerCase() : ''
          if (ev && (evType === 'goal' || evType === 'gol')) {
            var candidates = [
              ev.player && ev.player.name,
              ev.player && ev.player.shortName,
              ev.event_player,
              ev.strPlayer,
              ev.player_name,
              ev.scorer && ev.scorer.name,
              ev.scorer && ev.scorer.shortName,
              typeof ev.scorer === 'string' ? ev.scorer : null,
              ev.name,
              ev.strScorer,
              ev.strEvent,
              ev.detail,
            ]
            var rawName = ''
            for (var ci = 0; ci < candidates.length; ci++) {
              var cand = candidates[ci]
              if (cand && typeof cand === 'string') {
                var cleanCand = cand.trim().toLowerCase()
                if (
                  cleanCand &&
                  cleanCand !== 'gol' &&
                  cleanCand !== 'goal' &&
                  cleanCand !== 'normal goal' &&
                  cleanCand !== 'penalty' &&
                  cleanCand !== 'own goal'
                ) {
                  rawName = cand.trim()
                  break
                }
              }
            }
            if (rawName) {
              var isOwnGoal = evDetail.indexOf('own') !== -1 || evType === 'own'
              var scorerNameStr = rawName
              if (isOwnGoal && scorerNameStr.toLowerCase().indexOf('contra') === -1) {
                scorerNameStr += ' (contra)'
              }
              var evMin =
                ev.time && ev.time.elapsed != null
                  ? ev.time.elapsed
                  : ev.minute != null
                    ? ev.minute
                    : ev.intMinute != null
                      ? ev.intMinute
                      : ev.intGoalScoredTime != null
                        ? ev.intGoalScoredTime
                        : null
              var evExtra = ev.time && ev.time.extra != null ? ev.time.extra : null
              var evTeamId = ev.team ? ev.team.id : null
              var evTeamName = ev.team ? ev.team.name : null
              var evSide = null
              if (item.teams && item.teams.home && evTeamId && evTeamId === item.teams.home.id) {
                evSide = 'home'
              } else if (
                item.teams &&
                item.teams.away &&
                evTeamId &&
                evTeamId === item.teams.away.id
              ) {
                evSide = 'away'
              }

              scorersList.push({
                name: scorerNameStr,
                minute: evMin,
                extraMinute: evExtra,
                teamId: evTeamId,
                teamName: evTeamName,
                teamSide: evSide,
              })
            }
          }
        }
      } else if (Array.isArray(item.scorers)) {
        scorersList = item.scorers
      }

      var fixtureObj = item.fixture || {}
      var rawStatusShort =
        fixtureObj.status && fixtureObj.status.short
          ? String(fixtureObj.status.short).toUpperCase().trim()
          : ''
      var rawStatusLong =
        fixtureObj.status && fixtureObj.status.long
          ? String(fixtureObj.status.long).toUpperCase().trim()
          : ''

      var normShort = rawStatusShort
      if (
        rawStatusShort === 'PST' ||
        rawStatusShort === 'POSTP' ||
        rawStatusLong === 'MATCH POSTPONED' ||
        rawStatusLong === 'POSTPONED'
      ) {
        normShort = 'PST'
      } else if (
        rawStatusShort === 'CANC' ||
        rawStatusShort === 'CANCELLED' ||
        rawStatusLong === 'MATCH CANCELLED' ||
        rawStatusLong === 'CANCELLED'
      ) {
        normShort = 'CANC'
      } else if (rawStatusShort === 'SUSP' || rawStatusLong === 'MATCH SUSPENDED') {
        normShort = 'SUSP'
      } else if (rawStatusShort === 'ABD' || rawStatusLong === 'MATCH ABANDONED') {
        normShort = 'ABD'
      }

      var normalizedFixture = Object.assign({}, fixtureObj, {
        status: Object.assign({}, fixtureObj.status || {}, {
          short: normShort,
        }),
      })

      return {
        provider: 'api_football',
        fixture: normalizedFixture,
        teams: item.teams,
        goals: item.goals,
        score: item.score,
        events: item.events,
        scorers: scorersList,
      }
    }

    var directFixtures = []
    var seenDirectIds = {}

    // Executa busca direta de fixtures com proteção contra 429 e timeout curto (8s)
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
          timeout: 8,
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
          timeout: 8,
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
          timeout: 8,
        })

        if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
          rateLimitDetected = true
        } else if (
          resDate.statusCode === 200 &&
          resDate.json &&
          Array.isArray(resDate.json.response)
        ) {
          var dateResponseList = resDate.json.response
          // Enriquecimento em lote com /fixtures?ids=id1-id2-... para partidas com gols ou ao vivo sem events
          var missingEventsDateFixtures = []
          for (var ri = 0; ri < dateResponseList.length; ri++) {
            var candDate = dateResponseList[ri]
            var candDateShort =
              (candDate.fixture && candDate.fixture.status && candDate.fixture.status.short) || ''
            var candDateIsLive =
              ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(candDateShort) !== -1
            var candDateHasGoals = Boolean(
              (candDate.goals && (candDate.goals.home > 0 || candDate.goals.away > 0)) ||
              (candDate.score &&
                candDate.score.fulltime &&
                (candDate.score.fulltime.home > 0 || candDate.score.fulltime.away > 0)),
            )
            var candDateHasEvents = Array.isArray(candDate.events) && candDate.events.length > 0
            if (
              (candDateIsLive || candDateHasGoals) &&
              !candDateHasEvents &&
              candDate.fixture &&
              candDate.fixture.id
            ) {
              missingEventsDateFixtures.push(candDate)
            }
          }

          if (missingEventsDateFixtures.length > 0) {
            // Agrupa IDs em lotes de até 20 (suportado pela API-Football)
            for (var bi = 0; bi < missingEventsDateFixtures.length; bi += 20) {
              var chunk = missingEventsDateFixtures.slice(bi, bi + 20)
              var chunkIds = chunk.map(function (c) {
                return c.fixture.id
              })
              try {
                var chunkUrl =
                  baseUrlDate +
                  '?ids=' +
                  encodeURIComponent(chunkIds.join('-')) +
                  '&timezone=America%2FSao_Paulo'
                var chunkRes = $http.send({
                  url: chunkUrl,
                  method: 'GET',
                  headers: headers,
                  timeout: 7,
                })
                if (
                  chunkRes &&
                  chunkRes.statusCode === 200 &&
                  chunkRes.json &&
                  Array.isArray(chunkRes.json.response)
                ) {
                  var enrichedDateMap = {}
                  for (var cri = 0; cri < chunkRes.json.response.length; cri++) {
                    var enrItem = chunkRes.json.response[cri]
                    if (enrItem.fixture && enrItem.fixture.id && Array.isArray(enrItem.events)) {
                      enrichedDateMap[enrItem.fixture.id] = enrItem.events
                    }
                  }
                  for (var ci = 0; ci < chunk.length; ci++) {
                    var targetFix = chunk[ci]
                    if (enrichedDateMap[targetFix.fixture.id]) {
                      targetFix.events = enrichedDateMap[targetFix.fixture.id]
                    }
                  }
                }
              } catch (chunkErr) {
                console.log('[Enrich Date Batch Error]:', chunkErr)
              }
            }
          }

          for (var rj = 0; rj < dateResponseList.length; rj++) {
            dateFixtures.push(mapApiFootballItem(dateResponseList[rj]))
          }
        }
      } catch (errDate) {
        console.log('Aviso ao consultar date fixtures API-Football:', errDate)
      }
    }

    // -------------------------------------------------------------
    // CONTINGÊNCIA AUTOMÁTICA SE A API-FOOTBALL ESTOUROU A COTA (429)
    // Se rateLimitDetected for verdadeiro, tenta AUTOMATICAMENTE a
    // Football-Data.org com a chave de contingência antes de falhar
    // -------------------------------------------------------------
    if (rateLimitDetected) {
      console.log('[Contingência] API-Football atingiu cota (429). Acionando Football-Data.org...')
      var contingencyKey = fallbackApiKey || ''
      if (contingencyKey) {
        var fallbackFdData = fetchFootballDataFixtures(contingencyKey, dateQuery, directFixtureIds)

        // Se a Football-Data.org funcionou e não estourou cota
        if (
          !fallbackFdData.rateLimited &&
          (fallbackFdData.live.length > 0 ||
            fallbackFdData.dateFixtures.length > 0 ||
            fallbackFdData.directFixtures.length > 0)
        ) {
          var fbPayload = {
            configured: true,
            provider: 'football_data',
            fallback_active: true,
            original_provider: 'api_football',
            message: 'Contingência ativada: dados providos via Football-Data.org.',
            directFixtures: fallbackFdData.directFixtures,
            live: fallbackFdData.live,
            dateFixtures: fallbackFdData.dateFixtures,
            updatedAt: new Date().toISOString(),
          }

          if (cacheStore) {
            cacheStore[cacheKey] = {
              timestamp: Date.now(),
              data: fbPayload,
              fetching: 0,
            }
          }

          return e.json(
            200,
            Object.assign({}, fbPayload, {
              sobrescritas: sobrescritasMap,
              cached: false,
            }),
          )
        }
      }

      // Se Football-Data.org também falhou por cota ou não há chave
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

    var totalApiFootball = directFixtures.length + liveFixtures.length + dateFixtures.length

    // REGRA DE OURO: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
    if (totalApiFootball === 0) {
      console.log(
        '[Aviso Cache] API-Football retornou 0 partidas. Não gravando no cache e preservando anterior.',
      )
      if (cacheEntry && cacheEntry.data) {
        var existingTotal =
          (Array.isArray(cacheEntry.data.live) ? cacheEntry.data.live.length : 0) +
          (Array.isArray(cacheEntry.data.dateFixtures) ? cacheEntry.data.dateFixtures.length : 0) +
          (Array.isArray(cacheEntry.data.directFixtures)
            ? cacheEntry.data.directFixtures.length
            : 0)
        if (existingTotal > 0) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
              warning: 'API retornou 0 partidas; mantendo último resultado válido em cache.',
            }),
          )
        }
      }

      // Se não havia cache anterior, tenta contingência antes de entregar vazio
      if (fallbackApiKey) {
        var tryFb = fetchFootballDataFixtures(fallbackApiKey, dateQuery, directFixtureIds)
        var tryFbTotal =
          (tryFb.live ? tryFb.live.length : 0) +
          (tryFb.dateFixtures ? tryFb.dateFixtures.length : 0) +
          (tryFb.directFixtures ? tryFb.directFixtures.length : 0)
        if (tryFbTotal > 0) {
          var fbP = {
            configured: true,
            provider: 'football_data',
            fallback_active: true,
            original_provider: 'api_football',
            message: 'Contingência ativada: dados providos via Football-Data.org.',
            directFixtures: tryFb.directFixtures,
            live: tryFb.live,
            dateFixtures: tryFb.dateFixtures,
            updatedAt: new Date().toISOString(),
          }
          if (cacheStore) {
            cacheStore[cacheKey] = {
              timestamp: Date.now(),
              data: fbP,
              fetching: 0,
            }
          }
          return e.json(
            200,
            Object.assign({}, fbP, { sobrescritas: sobrescritasMap, cached: false }),
          )
        }
      }
    }

    // Adiciona partidas secundárias (Europa League, Conference, Libertadores, Sul-Americana) via TheSportsDB
    // se o provedor for Football-Data.org ou não houver partidas
    // Aplica deduplicação por confronto (par de equipes em qualquer ordem + data)
    if (
      provedor === 'football_data' ||
      (directFixtures.length === 0 && liveFixtures.length === 0 && dateFixtures.length === 0)
    ) {
      try {
        var tsdbConmebolLive = fetchConmebolFromTheSportsDb(dateQuery, theSportsDbKey)
        for (var tcl = 0; tcl < tsdbConmebolLive.length; tcl++) {
          var conmebolF = tsdbConmebolLive[tcl]
          var tHome = (conmebolF.teams && conmebolF.teams.home && conmebolF.teams.home.name) || ''
          var tAway = (conmebolF.teams && conmebolF.teams.away && conmebolF.teams.away.name) || ''
          var tDup = false
          for (var dfi = 0; dfi < dateFixtures.length; dfi++) {
            var existingF = dateFixtures[dfi]
            var eHome = (existingF.teams && existingF.teams.home && existingF.teams.home.name) || ''
            var eAway = (existingF.teams && existingF.teams.away && existingF.teams.away.name) || ''
            if (eHome && eAway && tHome && tAway) {
              var sHomeSame = eHome.toLowerCase() === tHome.toLowerCase()
              var sAwaySame = eAway.toLowerCase() === tAway.toLowerCase()
              var sInverted =
                eHome.toLowerCase() === tAway.toLowerCase() &&
                eAway.toLowerCase() === tHome.toLowerCase()
              if ((sHomeSame && sAwaySame) || sInverted) {
                tDup = true
                break
              }
            }
          }
          if (!tDup) {
            dateFixtures.push(conmebolF)
            if (conmebolF.isLive) {
              liveFixtures.push(conmebolF)
            }
          }
        }
      } catch (errConmebolLive) {
        console.log('[TheSportsDB Fallback placar-ao-vivo] Erro:', errConmebolLive)
      }
    }

    var apiFootballPayload = {
      configured: true,
      provider: 'api_football',
      directFixtures: directFixtures,
      live: liveFixtures,
      dateFixtures: dateFixtures,
      updatedAt: new Date().toISOString(),
    }

    // Só grava no cache se houver pelo menos 1 partida!
    if (cacheStore && totalApiFootball > 0) {
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

    // -------------------------------------------------------------
    // BYPASS TOTAL DE CACHE PARA JOGOS MANUAIS:
    // Consulta direta e imediata ao banco (coleção jogos_do_dia_manuais) para a data selecionada.
    // Jogos manuais são buscados em TODA resposta, sem depender de cache externo.
    // -------------------------------------------------------------
    var fetchManualGamesForDate = function (targetDateStr) {
      var manualList = []
      try {
        var mRecs = $app.findRecordsByFilter(
          'jogos_do_dia_manuais',
          "data = '" + targetDateStr + "'",
          'horario',
          100,
          0,
        )
        for (var mi = 0; mi < mRecs.length; mi++) {
          var mRec = mRecs[mi]
          var mTimeCasa = (mRec.getString('time_casa') || '').trim()
          var mTimeVisitante = (mRec.getString('time_visitante') || '').trim()
          var mHorario = (mRec.getString('horario') || '20:00').trim()
          var mCampeonato = (mRec.getString('campeonato') || 'Amistoso').trim()
          var mRegiao = (mRec.getString('regiao') || 'Brasileirão & Copas').trim()
          var mPlacarCasa = mRec.getInt('placar_casa')
          var mPlacarVisitante = mRec.getInt('placar_visitante')
          var mStatus = (mRec.getString('status') || 'NS').trim().toUpperCase()
          var mLogoCasa = (mRec.getString('logo_casa') || '').trim()
          var mLogoVisitante = (mRec.getString('logo_visitante') || '').trim()
          var mObs = (mRec.getString('observacao') || '').trim()

          var mIso =
            targetDateStr + 'T' + (mHorario.length === 5 ? mHorario + ':00' : mHorario) + '-03:00'
          var mIsLive = ['1H', 'HT', '2H', 'LIVE'].indexOf(mStatus) !== -1

          var mLeagueLogo = ''
          if (mCampeonato) {
            var cLower = mCampeonato.toLowerCase()
            if (
              typeof globalThis !== 'undefined' &&
              globalThis.__tsdbLeagueCache &&
              globalThis.__tsdbLeagueCache[cLower] !== undefined
            ) {
              mLeagueLogo = globalThis.__tsdbLeagueCache[cLower] || ''
            }
          }

          manualList.push({
            fixture: {
              id: 'manual_' + mRec.id,
              manualId: mRec.id,
              isManual: true,
              date: mIso,
              timestamp: Math.floor(new Date(mIso).getTime() / 1000) || 0,
              status: {
                short: mStatus,
                long:
                  mStatus === 'FT'
                    ? 'Encerrado'
                    : mIsLive
                      ? 'Ao Vivo'
                      : mStatus === 'PST'
                        ? 'Adiado'
                        : mStatus === 'CANC'
                          ? 'Cancelado'
                          : 'Agendado',
                elapsed: null,
              },
            },
            league: {
              id: 99990 + mi,
              name: mCampeonato,
              country: 'América do Sul',
              logo: mLeagueLogo,
              flag: '',
              round: mObs || 'Manual',
              region: mRegiao,
            },
            teams: {
              home: {
                id: 999000 + mi * 2,
                name: mTimeCasa,
                logo: mLogoCasa,
                country: 'América do Sul',
              },
              away: {
                id: 999001 + mi * 2,
                name: mTimeVisitante,
                logo: mLogoVisitante,
                country: 'América do Sul',
              },
            },
            goals: {
              home:
                mRec.get('placar_casa') !== null && mRec.get('placar_casa') !== undefined
                  ? mPlacarCasa
                  : null,
              away:
                mRec.get('placar_visitante') !== null && mRec.get('placar_visitante') !== undefined
                  ? mPlacarVisitante
                  : null,
            },
            score: {
              halftime: { home: null, away: null },
              fulltime: {
                home:
                  mRec.get('placar_casa') !== null && mRec.get('placar_casa') !== undefined
                    ? mPlacarCasa
                    : null,
                away:
                  mRec.get('placar_visitante') !== null &&
                  mRec.get('placar_visitante') !== undefined
                    ? mPlacarVisitante
                    : null,
              },
            },
            scorers: [],
            isLive: mIsLive,
            isManual: true,
            manualRecordId: mRec.id,
          })
        }
      } catch (errDbMan) {
        console.log('[Jogos Manuais Bypass] Erro ao consultar jogos_do_dia_manuais:', errDbMan)
      }
      return manualList
    }

    // Helper para mesclar jogos manuais sempre no TOPO e sem duplicação de confronto
    var mergeManualFixturesOnTop = function (manualItems, externalFixtures) {
      var merged = []
      var mCount = manualItems ? manualItems.length : 0
      for (var mi = 0; mi < mCount; mi++) {
        merged.push(manualItems[mi])
      }

      if (Array.isArray(externalFixtures)) {
        for (var ei = 0; ei < externalFixtures.length; ei++) {
          var extItem = externalFixtures[ei]
          if (extItem.isManual || (extItem.fixture && extItem.fixture.isManual)) {
            continue // Evita reutilizar manuais que possam ter ficado em snapshot de cache
          }
          var eHome = (extItem.teams && extItem.teams.home && extItem.teams.home.name) || ''
          var eAway = (extItem.teams && extItem.teams.away && extItem.teams.away.name) || ''
          var collidesWithManual = false
          for (var mj = 0; mj < mCount; mj++) {
            var mObj = manualItems[mj]
            var mHome = (mObj.teams && mObj.teams.home && mObj.teams.home.name) || ''
            var mAway = (mObj.teams && mObj.teams.away && mObj.teams.away.name) || ''
            if (
              eHome &&
              mHome &&
              eAway &&
              mAway &&
              (eHome.toLowerCase().indexOf(mHome.toLowerCase()) !== -1 ||
                mHome.toLowerCase().indexOf(eHome.toLowerCase()) !== -1) &&
              (eAway.toLowerCase().indexOf(mAway.toLowerCase()) !== -1 ||
                mAway.toLowerCase().indexOf(eAway.toLowerCase()) !== -1)
            ) {
              collidesWithManual = true
              break
            }
          }
          if (!collidesWithManual) {
            merged.push(extItem)
          }
        }
      }
      return merged
    }

    // Busca os jogos manuais diretamente do banco de dados agora
    var liveManualFixtures = fetchManualGamesForDate(dateQuery)

    // Inicializa store global de cache de jogos do dia
    if (typeof globalThis !== 'undefined' && !globalThis.__jogosDoDiaStore) {
      globalThis.__jogosDoDiaStore = {}
    }
    var dayStore = typeof globalThis !== 'undefined' ? globalThis.__jogosDoDiaStore : null
    var dayEntry = dayStore ? dayStore[dateQuery] : null
    var nowMs = Date.now()
    var cacheAgeMs = dayEntry ? nowMs - dayEntry.timestamp : 999999999

    var entryHasLive = Boolean(dayEntry && dayEntry.payload && dayEntry.payload.hasLive === true)
    if (entryHasLive && dayEntry) {
      dayEntry.lastLiveTimestamp = nowMs
    }
    var dayHadRecentLive = Boolean(
      dayEntry && dayEntry.lastLiveTimestamp && nowMs - dayEntry.lastLiveTimestamp < 10 * 60 * 1000,
    )

    // TTL:
    // - Se a entrada foi gravada por contingência/degradada (is_contingency/fallback_active), TTL é curto (60s)
    //   para revalidar automaticamente e restaurar os 400+ jogos assim que a cota da API-Football renovar.
    // - 1-2 min (90.000 ms) se houver jogo ao vivo ou transição recente; 30 min sem jogo ao vivo
    var isContingencyEntry = Boolean(
      dayEntry &&
      dayEntry.payload &&
      (dayEntry.payload.fallback_active === true ||
        dayEntry.payload.is_contingency === true ||
        dayEntry.payload.contingency === true),
    )
    var maxAgeMs = isContingencyEntry
      ? 60 * 1000
      : entryHasLive || dayHadRecentLive
        ? 90 * 1000
        : 30 * 60 * 1000

    // REGRA DE ON-DEMAND FETCHING E CARREGAMENTO PASSIVO:
    // Se há cache válido para a API externa, concatenamos SEMPRE os jogos manuais do banco no TOPO
    // garantindo bypass absoluto para qualquer jogo manual cadastrado ou alterado recentemente.
    // Se forceRefresh for solicitado (ex: botão Atualizar do usuário), BYPASS no cache para tentar API principal.
    if (dayEntry && dayEntry.payload) {
      var cachedFixturesCount = Array.isArray(dayEntry.payload.fixtures)
        ? dayEntry.payload.fixtures.length
        : 0
      if (cachedFixturesCount > 0) {
        if (!forceRefresh && cacheAgeMs < maxAgeMs) {
          var combinedCachedList = mergeManualFixturesOnTop(
            liveManualFixtures,
            dayEntry.payload.fixtures,
          )
          var cachedResp = Object.assign({}, dayEntry.payload, {
            total: combinedCachedList.length,
            fixtures: combinedCachedList,
            hasLive:
              entryHasLive ||
              liveManualFixtures.some(function (m) {
                return m.isLive
              }),
            cached: true,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
            ttlSeconds: Math.round(maxAgeMs / 1000),
            ttlRemainingSeconds: Math.max(0, Math.round((maxAgeMs - cacheAgeMs) / 1000)),
          })
          return e.json(200, cachedResp)
        } else if (forceRefresh) {
          console.log(
            '[Cache Jogos-do-Dia] forceRefresh solicitado pelo cliente. Ignorando cache e revalidando com API externa.',
          )
        }
      } else {
        console.log(
          '[Cache Jogos-do-Dia] Cache continha 0 partidas (contaminado). Descartando e buscando novamente da API.',
        )
      }
    }

    // Deduplicação de requisições externas para o mesmo dia (janela mínima de 10s)
    if (dayEntry && dayEntry.fetching && nowMs - dayEntry.fetching < 10000) {
      if (dayEntry.payload) {
        var dedupCombined = mergeManualFixturesOnTop(liveManualFixtures, dayEntry.payload.fixtures)
        var dedupResp = Object.assign({}, dayEntry.payload, {
          total: dedupCombined.length,
          fixtures: dedupCombined,
          hasLive:
            entryHasLive ||
            liveManualFixtures.some(function (m) {
              return m.isLive
            }),
          cached: true,
          deduplicated: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
        })
        return e.json(200, dedupResp)
      }
    }

    // Marca início de fetch para evitar que múltiplas abas chamem a API externa ao mesmo tempo
    if (dayStore) {
      if (!dayStore[dateQuery]) {
        dayStore[dateQuery] = { timestamp: 0, payload: null, fetching: nowMs }
      } else {
        dayStore[dateQuery].fetching = nowMs
      }
    }

    // Buscar credenciais configuradas (primária e contingência)
    var provedor = 'api_football'
    var apiKey = ''
    var fallbackApiKey = ''
    var isRapidApi = false
    try {
      var configRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'api_football'
        apiKey = (configRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    try {
      var fallbackRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fallbackRecord) {
        fallbackApiKey = (fallbackRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!fallbackApiKey) {
      try {
        fallbackApiKey =
          ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
            ? $secrets.get('FOOTBALL_DATA_KEY')
            : '') ||
          $os.getenv('FOOTBALL_DATA_KEY') ||
          ''
      } catch (_) {}
    }

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

    if (!apiKey && !fallbackApiKey) {
      return e.json(200, {
        configured: false,
        date: dateQuery,
        fixtures: [],
        message: 'API de futebol não configurada pelo administrador.',
      })
    }

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

    // Helper para converter data UTC para YYYY-MM-DD em America/Sao_Paulo (UTC-3)
    var toDateStringSaoPaulo = function (dateInput) {
      if (!dateInput) return null
      try {
        var d = new Date(dateInput)
        if (isNaN(d.getTime())) return null
        // Subtrai 3 horas (America/Sao_Paulo UTC-3 padrão)
        var spTime = new Date(d.getTime() - 3 * 3600 * 1000)
        var ySP = spTime.getUTCFullYear()
        var mSP = ('0' + (spTime.getUTCMonth() + 1)).slice(-2)
        var dSP = ('0' + spTime.getUTCDate()).slice(-2)
        return ySP + '-' + mSP + '-' + dSP
      } catch (_) {
        return null
      }
    }

    // Normalizador de nome de equipe para deduplicação sem falsos negativos
    var normalizeTeamDedup = function (name) {
      if (!name) return ''
      var s = String(name).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      var tokens = s.split(/\s+/).filter(function (t) {
        return (
          t &&
          [
            'fc',
            'ec',
            'cr',
            'se',
            'sc',
            'clube',
            'club',
            'de',
            'da',
            'do',
            'del',
            'futbol',
            'futebol',
            'sport',
            'afc',
            'cf',
          ].indexOf(t) === -1
        )
      })
      if (tokens.length === 0) {
        return s.replace(/[^a-z0-9]/g, '').trim()
      }
      return tokens.join(' ').trim()
    }

    // Compara se duas equipes são equivalentes
    var isSameTeamName = function (nameA, nameB) {
      var normA = normalizeTeamDedup(nameA)
      var normB = normalizeTeamDedup(nameB)
      if (!normA || !normB) return false
      if (normA === normB) return true
      if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true
      return false
    }

    // Verifica se dois confrontos são o mesmo (mesma data + mesmo par de equipes, ordem invertida inclusa)
    var isSameMatchConfrontation = function (fixA, fixB) {
      if (!fixA || !fixB) return false
      var dateA = toDateStringSaoPaulo(fixA.fixture && fixA.fixture.date)
      var dateB = toDateStringSaoPaulo(fixB.fixture && fixB.fixture.date)
      if (dateA && dateB && dateA !== dateB) return false

      var homeA = (fixA.teams && fixA.teams.home && fixA.teams.home.name) || ''
      var awayA = (fixA.teams && fixA.teams.away && fixA.teams.away.name) || ''
      var homeB = (fixB.teams && fixB.teams.home && fixB.teams.home.name) || ''
      var awayB = (fixB.teams && fixB.teams.away && fixB.teams.away.name) || ''

      if (!homeA || !awayA || !homeB || !awayB) return false

      // Ordem direta
      var direct = isSameTeamName(homeA, homeB) && isSameTeamName(awayA, awayB)
      // Ordem invertida (cadastro invertido entre fontes)
      var inverted = isSameTeamName(homeA, awayB) && isSameTeamName(awayA, homeB)

      return direct || inverted
    }

    // Função interna para normalizar dados do Football-Data.org para jogos-do-dia
    var parseFootballDataToDayFixtures = function (fdMatches, fdAuthToken) {
      var convertedFixtures = []
      var hasLiveMatchFD = false

      for (var fdi = 0; fdi < fdMatches.length; fdi++) {
        var m = fdMatches[fdi]
        var matchDateSP = toDateStringSaoPaulo(m.utcDate)
        // FILTRO ESTRITO DE DATA (America/Sao_Paulo): se o jogo pertence a outro dia no fuso de SP, ignora
        if (dateQuery && matchDateSP && matchDateSP !== dateQuery) {
          continue
        }

        var homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
        var awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
        var htHome = m.score && m.score.halfTime ? m.score.halfTime.home : null
        var htAway = m.score && m.score.halfTime ? m.score.halfTime.away : null

        // Se a partida tem placar > 0 ou está ao vivo mas não possui o array goals detalhado,
        // busca GET /v4/matches/{id} para extrair os marcadores detalhados
        var mHasScoreOrLive =
          (typeof homeScore === 'number' && homeScore > 0) ||
          (typeof awayScore === 'number' && awayScore > 0) ||
          m.status === 'IN_PLAY' ||
          m.status === 'PAUSED'
        if (
          mHasScoreOrLive &&
          (!Array.isArray(m.goals) || m.goals.length === 0) &&
          m.id &&
          fdAuthToken
        ) {
          try {
            var detailMatchRes = $http.send({
              url: 'https://api.football-data.org/v4/matches/' + encodeURIComponent(m.id),
              method: 'GET',
              headers: { 'X-Auth-Token': fdAuthToken },
              timeout: 6,
            })
            if (
              detailMatchRes &&
              detailMatchRes.statusCode === 200 &&
              detailMatchRes.json &&
              Array.isArray(detailMatchRes.json.goals)
            ) {
              m.goals = detailMatchRes.json.goals
              if (detailMatchRes.json.score && detailMatchRes.json.score.fullTime) {
                if (
                  detailMatchRes.json.score.fullTime.home !== null &&
                  detailMatchRes.json.score.fullTime.home !== undefined
                ) {
                  homeScore = detailMatchRes.json.score.fullTime.home
                }
                if (
                  detailMatchRes.json.score.fullTime.away !== null &&
                  detailMatchRes.json.score.fullTime.away !== undefined
                ) {
                  awayScore = detailMatchRes.json.score.fullTime.away
                }
              }
            }
          } catch (errFdSingle) {
            console.log(
              '[Football-Data Detail Match] Erro ao buscar match ' + m.id + ':',
              errFdSingle,
            )
          }
        }

        var rawStatusFD = (m.status || '').toUpperCase().trim()
        var stShort = rawStatusFD
        if (rawStatusFD === 'PAUSED') {
          stShort = 'HT'
        } else if (rawStatusFD === 'IN_PLAY') {
          stShort = '1H'
        } else if (rawStatusFD === 'FINISHED') {
          stShort = 'FT'
        } else if (rawStatusFD === 'POSTPONED' || rawStatusFD === 'PST') {
          stShort = 'PST'
        } else if (rawStatusFD === 'CANCELLED' || rawStatusFD === 'CANC') {
          stShort = 'CANC'
        } else if (rawStatusFD === 'SUSPENDED' || rawStatusFD === 'SUSP') {
          stShort = 'SUSP'
        }

        var isLive =
          ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'].indexOf(stShort) !== -1
        if (isLive) hasLiveMatchFD = true

        var scorersListFD = []
        if (Array.isArray(m.goals)) {
          for (var gi = 0; gi < m.goals.length; gi++) {
            var g = m.goals[gi]
            var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
            var isOwnGoal = (g.type || '').toUpperCase() === 'OWN'
            if (scorerName && isOwnGoal) scorerName += ' (contra)'
            if (scorerName) {
              scorersListFD.push({
                name: scorerName,
                minute: g.minute || null,
                extraMinute: null,
                teamId: g.team ? g.team.id : null,
                teamName: g.team ? g.team.name || g.team.shortName : null,
                teamSide:
                  m.homeTeam && g.team && g.team.id === m.homeTeam.id
                    ? 'home'
                    : m.awayTeam && g.team && g.team.id === m.awayTeam.id
                      ? 'away'
                      : null,
              })
            }
          }
        }

        var compCode = (m.competition && m.competition.code) || ''
        var compName = (m.competition && m.competition.name) || ''
        var compId = (m.competition && m.competition.id) || 1000 + fdi

        var region = 'Outros'
        if (
          compCode === 'BSA' ||
          compName.indexOf('Brasileiro') !== -1 ||
          compName.indexOf('Serie A') !== -1
        ) {
          region = 'Brasileirão & Copas'
          compId = 71
        } else if (compCode === 'CL' || compName.indexOf('Champions') !== -1) {
          region = 'Futebol Europeu'
          compId = 2
        } else if (compCode === 'EL' || compName.indexOf('Europa League') !== -1) {
          region = 'Futebol Europeu'
          compId = 3
        } else if (compCode === 'PL' || compName.indexOf('Premier') !== -1) {
          region = 'Futebol Europeu'
          compId = 39
        } else if (
          compCode === 'PD' ||
          compName.indexOf('La Liga') !== -1 ||
          compName.indexOf('Primera') !== -1
        ) {
          region = 'Futebol Europeu'
          compId = 140
        } else if (compCode === 'SA' || compName.indexOf('Serie A') !== -1) {
          region = 'Futebol Europeu'
          compId = 135
        } else if (compCode === 'BL1' || compName.indexOf('Bundesliga') !== -1) {
          region = 'Futebol Europeu'
          compId = 78
        } else if (compCode === 'FL1' || compName.indexOf('Ligue 1') !== -1) {
          region = 'Futebol Europeu'
          compId = 61
        } else if (compCode === 'CLI' || compName.indexOf('Libertadores') !== -1) {
          region = 'Sul-Americana'
          compId = 13
        }

        convertedFixtures.push({
          fixture: {
            id: m.id,
            date: m.utcDate,
            timestamp: Math.floor(new Date(m.utcDate).getTime() / 1000),
            status: {
              short: stShort,
              long: m.status,
              elapsed: m.minute || null,
            },
          },
          league: {
            id: compId,
            name: compName || 'Competição Externa',
            country: (m.area && m.area.name) || '',
            logo: (m.competition && m.competition.emblem) || '',
            flag: (m.area && m.area.flag) || '',
            round: m.matchday ? 'Rodada ' + m.matchday : '',
            region: region,
          },
          teams: {
            home: {
              id: m.homeTeam ? m.homeTeam.id : 0,
              name: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
              logo: (m.homeTeam && m.homeTeam.crest) || '',
              country: (m.area && m.area.name) || '',
            },
            away: {
              id: m.awayTeam ? m.awayTeam.id : 0,
              name: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
              logo: (m.awayTeam && m.awayTeam.crest) || '',
              country: (m.area && m.area.name) || '',
            },
          },
          goals: {
            home: typeof homeScore === 'number' ? homeScore : null,
            away: typeof awayScore === 'number' ? awayScore : null,
          },
          score: {
            halftime: { home: htHome, away: htAway },
            fulltime: { home: homeScore, away: awayScore },
          },
          events: m.goals,
          goalEvents: m.goals,
          scorers: scorersListFD,
          isLive: isLive,
        })
      }

      return { fixtures: convertedFixtures, hasLive: hasLiveMatchFD }
    }

    // Função utilitária para buscar partidas no TheSportsDB globalmente (sem filtro de ligas)
    // Disponível no escopo da rota /backend/v1/jogos-do-dia
    // Cobre targetDate e também targetDate + 1 dia (para compensar fuso UTC vs Brasília UTC-3)
    // Tenta primeiro o endpoint global /eventsday.php?d={currDate} mantendo TODOS os eventos mundo afora.
    // Se vier vazio, faz fallback iterando por ligas conhecidas.
    var fetchConmebolFromTheSportsDb = function (targetDate, apiKeyTsdb) {
      if (!targetDate) return []
      var key = apiKeyTsdb || '3'
      var conmebolFixtures = []
      var conmebolLeagues = [
        {
          id: 4501,
          name: 'Copa Libertadores',
          shortId: 13,
          region: 'Sul-Americana',
          country: 'South America',
        },
        {
          id: 4724,
          name: 'Copa Sudamericana',
          shortId: 11,
          region: 'Sul-Americana',
          country: 'South America',
        },
        {
          id: 4481,
          name: 'UEFA Europa League',
          shortId: 3,
          region: 'Futebol Europeu',
          country: 'Europe',
        },
        {
          id: 5071,
          name: 'UEFA Europa Conference League',
          shortId: 848,
          region: 'Futebol Europeu',
          country: 'Europe',
        },
        {
          id: 4335,
          name: 'La Liga',
          shortId: 140,
          region: 'Futebol Europeu',
          country: 'Spain',
        },
        {
          id: 4328,
          name: 'Premier League',
          shortId: 39,
          region: 'Futebol Europeu',
          country: 'England',
        },
        {
          id: 4332,
          name: 'Serie A',
          shortId: 135,
          region: 'Futebol Europeu',
          country: 'Italy',
        },
        {
          id: 4331,
          name: 'Bundesliga',
          shortId: 78,
          region: 'Futebol Europeu',
          country: 'Germany',
        },
        {
          id: 4334,
          name: 'Ligue 1',
          shortId: 61,
          region: 'Futebol Europeu',
          country: 'France',
        },
        {
          id: 4351,
          name: 'Brasileirao Serie A',
          shortId: 71,
          region: 'Brasileirão & Copas',
          country: 'Brazil',
        },
      ]

      var targetDatesList = [targetDate]
      try {
        var pDateParts = targetDate.split('-')
        if (pDateParts.length === 3) {
          var yBase = parseInt(pDateParts[0], 10)
          var mBase = parseInt(pDateParts[1], 10) - 1
          var dBase = parseInt(pDateParts[2], 10)
          var nextDayUtc = new Date(Date.UTC(yBase, mBase, dBase + 1))
          var nextDayStr =
            nextDayUtc.getUTCFullYear() +
            '-' +
            ('0' + (nextDayUtc.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + nextDayUtc.getUTCDate()).slice(-2)
          if (nextDayStr && targetDatesList.indexOf(nextDayStr) === -1) {
            targetDatesList.push(nextDayStr)
          }
        }
      } catch (_) {}

      var seenEventIds = {}

      for (var tdi = 0; tdi < targetDatesList.length; tdi++) {
        var currDate = targetDatesList[tdi]

        // 1. TENTA PRIMEIRO A BUSCA GLOBAL COMPLETA DO DIA NO THESPORTSDB SEM RESTRINGIR LIGA
        var globalEventsFound = false
        try {
          var tsdbGlobalUrl =
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(key) +
            '/eventsday.php?d=' +
            encodeURIComponent(currDate) +
            '&s=Soccer'
          var resTsdbGlobal = $http.send({
            url: tsdbGlobalUrl,
            method: 'GET',
            timeout: 8,
          })

          if (
            resTsdbGlobal &&
            resTsdbGlobal.statusCode === 200 &&
            resTsdbGlobal.json &&
            Array.isArray(resTsdbGlobal.json.events) &&
            resTsdbGlobal.json.events.length > 0
          ) {
            globalEventsFound = true
            var gEvents = resTsdbGlobal.json.events
            for (var gei = 0; gei < gEvents.length; gei++) {
              var evG = gEvents[gei]
              var eventKeyG = evG.idEvent
                ? String(evG.idEvent)
                : evG.strHomeTeam + '_' + evG.strAwayTeam + '_' + (evG.dateEvent || currDate)
              if (seenEventIds[eventKeyG]) continue
              seenEventIds[eventKeyG] = true

              var homeTeamG = (evG.strHomeTeam || '').trim()
              var awayTeamG = (evG.strAwayTeam || '').trim()
              if (!homeTeamG || !awayTeamG) continue

              var evDateG = evG.dateEvent || targetDate
              var evTimeG = evG.strTime || '20:00:00'
              var isoDateStrG =
                evDateG + 'T' + (evTimeG.indexOf(':') !== -1 ? evTimeG : '20:00:00') + 'Z'

              var hScoreG =
                evG.intHomeScore !== null &&
                evG.intHomeScore !== undefined &&
                evG.intHomeScore !== ''
                  ? parseInt(evG.intHomeScore, 10)
                  : null
              var aScoreG =
                evG.intAwayScore !== null &&
                evG.intAwayScore !== undefined &&
                evG.intAwayScore !== ''
                  ? parseInt(evG.intAwayScore, 10)
                  : null

              var rawStatusG = (evG.strStatus || '').trim().toUpperCase()
              var shortStatusG = 'NS'
              if (
                rawStatusG === 'FT' ||
                rawStatusG === 'AOT' ||
                rawStatusG === 'FINISHED' ||
                rawStatusG === 'MATCH FINISHED'
              ) {
                shortStatusG = 'FT'
              } else if (
                rawStatusG === '1H' ||
                rawStatusG === '2H' ||
                rawStatusG === 'HT' ||
                rawStatusG === 'LIVE' ||
                rawStatusG === 'IN PROGRESS'
              ) {
                shortStatusG = rawStatusG === 'HT' ? 'HT' : '1H'
              } else if (rawStatusG === 'POSTPONED' || rawStatusG === 'PST') {
                shortStatusG = 'PST'
              } else if (rawStatusG === 'CANCELLED' || rawStatusG === 'CANC') {
                shortStatusG = 'CANC'
              }

              var tsdbScorersG = []
              var tsdbEventsG = []
              var parseTsdbGoalStrG = function (detailStr, teamSide, teamId, teamName) {
                if (typeof detailStr !== 'string' || !detailStr.trim()) return
                var parts = detailStr.split(';')
                for (var pi = 0; pi < parts.length; pi++) {
                  var rawPart = parts[pi].trim()
                  if (!rawPart) continue
                  var plusMatch = rawPart.match(/(\d+)\s*\+\s*(\d+)/)
                  var extractedMin = null
                  var extractedExtra = null
                  if (plusMatch) {
                    extractedMin = parseInt(plusMatch[1], 10)
                    extractedExtra = parseInt(plusMatch[2], 10)
                  } else {
                    var minMatch = rawPart.match(/(\d+)'?/)
                    extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                  }
                  var nameClean = rawPart
                    .replace(/^\d+(\+\d+)?'?:?/, '')
                    .replace(/\s*\d+(\+\d+)?'?$/, '')
                    .replace(/\s*\(pen\.?\)/i, '')
                    .trim()
                  var isOwnGoal = /contra|own\s*goal|o\.?g\.?/i.test(rawPart)
                  if (isOwnGoal && nameClean.toLowerCase().indexOf('contra') === -1) {
                    nameClean += ' (contra)'
                  }
                  if (nameClean) {
                    tsdbScorersG.push({
                      name: nameClean,
                      minute: extractedMin,
                      extraMinute: extractedExtra,
                      teamId: teamId || null,
                      teamName: teamName || null,
                      teamSide: teamSide,
                    })
                    tsdbEventsG.push({
                      type: 'Goal',
                      detail: isOwnGoal ? 'Own Goal' : 'Normal Goal',
                      time: { elapsed: extractedMin, extra: extractedExtra },
                      team: { id: teamId || null, name: teamName || '' },
                      player: { id: null, name: nameClean },
                    })
                  }
                }
              }

              var hTeamIdG = parseInt(evG.idHomeTeam, 10) || null
              var aTeamIdG = parseInt(evG.idAwayTeam, 10) || null
              parseTsdbGoalStrG(evG.strHomeGoalDetails, 'home', hTeamIdG, homeTeamG)
              parseTsdbGoalStrG(evG.strAwayGoalDetails, 'away', aTeamIdG, awayTeamG)

              var leagueNameStr = evG.strLeague || 'Futebol'
              conmebolFixtures.push({
                fixture: {
                  id: 'tsdb_' + (evG.idEvent || gei),
                  date: isoDateStrG,
                  timestamp: Math.floor(new Date(isoDateStrG).getTime() / 1000) || 0,
                  status: {
                    short: shortStatusG,
                    long: evG.strStatus || 'Not Started',
                    elapsed: null,
                  },
                },
                league: {
                  id: parseInt(evG.idLeague, 10) || 0,
                  name: leagueNameStr,
                  country: evG.strCountry || 'Mundo',
                  logo: evG.strLeagueBadge || evG.strBadge || '',
                  flag: '',
                  round: evG.strRound || '',
                  region: 'Futebol',
                },
                teams: {
                  home: {
                    id: hTeamIdG || 0,
                    name: homeTeamG,
                    logo: evG.strHomeTeamBadge || '',
                    country: evG.strCountry || 'Mundo',
                  },
                  away: {
                    id: aTeamIdG || 0,
                    name: awayTeamG,
                    logo: evG.strAwayTeamBadge || '',
                    country: evG.strCountry || 'Mundo',
                  },
                },
                goals: {
                  home: !isNaN(hScoreG) ? hScoreG : null,
                  away: !isNaN(aScoreG) ? aScoreG : null,
                },
                score: {
                  halftime: { home: null, away: null },
                  fulltime: {
                    home: !isNaN(hScoreG) ? hScoreG : null,
                    away: !isNaN(aScoreG) ? aScoreG : null,
                  },
                },
                events: tsdbEventsG,
                scorers: tsdbScorersG,
                isLive: ['1H', 'HT', '2H', 'LIVE'].indexOf(shortStatusG) !== -1,
                provider: 'thesportsdb',
              })
            }
          }
        } catch (errGlobalTsdb) {
          console.log(
            '[TheSportsDB Global] Erro ao buscar dia global ' + currDate + ':',
            errGlobalTsdb,
          )
        }

        // 2. Se a busca global do TheSportsDB não retornou eventos (ex: limitação da chave grátis '3' em queries globais),
        // consulta as ligas prioritárias individualmente
        if (!globalEventsFound) {
          for (var cli = 0; cli < conmebolLeagues.length; cli++) {
            var cl = conmebolLeagues[cli]
            try {
              var tsdbUrl =
                'https://www.thesportsdb.com/api/v1/json/' +
                encodeURIComponent(key) +
                '/eventsday.php?d=' +
                encodeURIComponent(currDate) +
                '&s=Soccer&l=' +
                encodeURIComponent(cl.id)

              var resTsdb = $http.send({
                url: tsdbUrl,
                method: 'GET',
                timeout: 8,
              })

              if (!resTsdb || resTsdb.statusCode !== 200) {
                console.log(
                  '[TheSportsDB Fallback] HTTP ' +
                    (resTsdb ? resTsdb.statusCode : 0) +
                    ' ao buscar liga ' +
                    cl.name +
                    ' (ignorado silenciosamente)',
                )
                continue
              }

              if (resTsdb.json && Array.isArray(resTsdb.json.events)) {
                var events = resTsdb.json.events
                for (var ei = 0; ei < events.length; ei++) {
                  var ev = events[ei]
                  var eventKey = ev.idEvent
                    ? String(ev.idEvent)
                    : ev.strHomeTeam + '_' + ev.strAwayTeam + '_' + (ev.dateEvent || currDate)
                  if (seenEventIds[eventKey]) continue
                  seenEventIds[eventKey] = true

                  var homeTeam = (ev.strHomeTeam || '').trim()
                  var awayTeam = (ev.strAwayTeam || '').trim()
                  if (!homeTeam || !awayTeam) continue

                  var evDate = ev.dateEvent || targetDate
                  var evTime = ev.strTime || '20:00:00'
                  // Monta ISO string aproximada (UTC)
                  var isoDateStr =
                    evDate + 'T' + (evTime.indexOf(':') !== -1 ? evTime : '20:00:00') + 'Z'

                  var hScore =
                    ev.intHomeScore !== null &&
                    ev.intHomeScore !== undefined &&
                    ev.intHomeScore !== ''
                      ? parseInt(ev.intHomeScore, 10)
                      : null
                  var aScore =
                    ev.intAwayScore !== null &&
                    ev.intAwayScore !== undefined &&
                    ev.intAwayScore !== ''
                      ? parseInt(ev.intAwayScore, 10)
                      : null

                  var rawStatus = (ev.strStatus || '').trim().toUpperCase()
                  var shortStatus = 'NS'
                  if (
                    rawStatus === 'FT' ||
                    rawStatus === 'AOT' ||
                    rawStatus === 'FINISHED' ||
                    rawStatus === 'MATCH FINISHED'
                  ) {
                    shortStatus = 'FT'
                  } else if (
                    rawStatus === '1H' ||
                    rawStatus === '2H' ||
                    rawStatus === 'HT' ||
                    rawStatus === 'LIVE' ||
                    rawStatus === 'IN PROGRESS'
                  ) {
                    shortStatus = rawStatus === 'HT' ? 'HT' : '1H'
                  } else if (rawStatus === 'POSTPONED' || rawStatus === 'PST') {
                    shortStatus = 'PST'
                  } else if (rawStatus === 'CANCELLED' || rawStatus === 'CANC') {
                    shortStatus = 'CANC'
                  }

                  var tsdbScorers = []
                  var tsdbEvents = []
                  var parseTsdbGoalStr = function (detailStr, teamSide, teamId, teamName) {
                    if (typeof detailStr !== 'string' || !detailStr.trim()) return
                    var parts = detailStr.split(';')
                    for (var pi = 0; pi < parts.length; pi++) {
                      var rawPart = parts[pi].trim()
                      if (!rawPart) continue
                      var plusMatch = rawPart.match(/(\d+)\s*\+\s*(\d+)/)
                      var extractedMin = null
                      var extractedExtra = null
                      if (plusMatch) {
                        extractedMin = parseInt(plusMatch[1], 10)
                        extractedExtra = parseInt(plusMatch[2], 10)
                      } else {
                        var minMatch = rawPart.match(/(\d+)'?/)
                        extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                      }
                      var nameClean = rawPart
                        .replace(/^\d+(\+\d+)?'?:?/, '')
                        .replace(/\s*\d+(\+\d+)?'?$/, '')
                        .replace(/\s*\(pen\.?\)/i, '')
                        .trim()
                      var isOwnGoal = /contra|own\s*goal|o\.?g\.?/i.test(rawPart)
                      if (isOwnGoal && nameClean.toLowerCase().indexOf('contra') === -1) {
                        nameClean += ' (contra)'
                      }
                      if (nameClean) {
                        tsdbScorers.push({
                          name: nameClean,
                          minute: extractedMin,
                          extraMinute: extractedExtra,
                          teamId: teamId || null,
                          teamName: teamName || null,
                          teamSide: teamSide,
                        })
                        tsdbEvents.push({
                          type: 'Goal',
                          detail: isOwnGoal ? 'Own Goal' : 'Normal Goal',
                          time: { elapsed: extractedMin, extra: extractedExtra },
                          team: { id: teamId || null, name: teamName || '' },
                          player: { id: null, name: nameClean },
                        })
                      }
                    }
                  }

                  var hTeamId = parseInt(ev.idHomeTeam, 10) || null
                  var aTeamId = parseInt(ev.idAwayTeam, 10) || null
                  parseTsdbGoalStr(ev.strHomeGoalDetails, 'home', hTeamId, homeTeam)
                  parseTsdbGoalStr(ev.strAwayGoalDetails, 'away', aTeamId, awayTeam)

                  // FIX 1: Se houver gols marcados no placar mas nenhum marcador veio em strHomeGoalDetails/strAwayGoalDetails
                  var needsTimelineLookup =
                    ((hScore !== null && hScore > 0) || (aScore !== null && aScore > 0)) &&
                    tsdbScorers.length === 0 &&
                    ev.idEvent

                  if (needsTimelineLookup) {
                    try {
                      // Tenta lookuptimeline.php?id={idEvent}
                      var tlUrl =
                        'https://www.thesportsdb.com/api/v1/json/' +
                        encodeURIComponent(key) +
                        '/lookuptimeline.php?id=' +
                        encodeURIComponent(ev.idEvent)
                      var tlRes = $http.send({
                        url: tlUrl,
                        method: 'GET',
                        timeout: 4,
                      })

                      var tlItems = null
                      if (
                        tlRes &&
                        tlRes.statusCode === 200 &&
                        tlRes.json &&
                        Array.isArray(tlRes.json.timeline)
                      ) {
                        tlItems = tlRes.json.timeline
                      } else if (tlRes && tlRes.statusCode !== 200) {
                        console.log(
                          '[TheSportsDB Timeline] HTTP ' +
                            tlRes.statusCode +
                            ' no evento ' +
                            ev.idEvent +
                            ' (ignorado silenciosamente)',
                        )
                      }

                      // Fallback para lookupevent.php?id={idEvent} se lookuptimeline não retornar timeline
                      if (!tlItems || tlItems.length === 0) {
                        var lkUrl =
                          'https://www.thesportsdb.com/api/v1/json/' +
                          encodeURIComponent(key) +
                          '/lookupevent.php?id=' +
                          encodeURIComponent(ev.idEvent)
                        var lkRes = $http.send({
                          url: lkUrl,
                          method: 'GET',
                          timeout: 4,
                        })
                        if (
                          lkRes &&
                          lkRes.statusCode === 200 &&
                          lkRes.json &&
                          Array.isArray(lkRes.json.events) &&
                          lkRes.json.events[0]
                        ) {
                          var singleEv = lkRes.json.events[0]
                          parseTsdbGoalStr(singleEv.strHomeGoalDetails, 'home', hTeamId, homeTeam)
                          parseTsdbGoalStr(singleEv.strAwayGoalDetails, 'away', aTeamId, awayTeam)
                        } else if (lkRes && lkRes.statusCode !== 200) {
                          console.log(
                            '[TheSportsDB LookupEvent] HTTP ' +
                              lkRes.statusCode +
                              ' no evento ' +
                              ev.idEvent +
                              ' (ignorado silenciosamente)',
                          )
                        }
                      } else {
                        for (var tli = 0; tli < tlItems.length; tli++) {
                          var itemTl = tlItems[tli]
                          var tlType = String(itemTl.strTimeline || itemTl.strType || '')
                            .trim()
                            .toLowerCase()
                          if (
                            tlType === 'goal' ||
                            tlType === 'gol' ||
                            tlType.indexOf('goal') !== -1
                          ) {
                            var pName = (itemTl.strPlayer || itemTl.strPlayerName || '').trim()
                            if (!pName) continue
                            var tlTime =
                              itemTl.intTime !== null && itemTl.intTime !== undefined
                                ? parseInt(itemTl.intTime, 10)
                                : itemTl.intMinute !== null && itemTl.intMinute !== undefined
                                  ? parseInt(itemTl.intMinute, 10)
                                  : null
                            var tlTeamId = parseInt(itemTl.idTeam, 10) || null
                            var tlSide = null
                            if (tlTeamId && hTeamId && tlTeamId === hTeamId) {
                              tlSide = 'home'
                            } else if (tlTeamId && aTeamId && tlTeamId === aTeamId) {
                              tlSide = 'away'
                            } else {
                              var tlSideStr = String(
                                itemTl.strTimelineDetail || itemTl.strSide || '',
                              ).toLowerCase()
                              if (tlSideStr.indexOf('home') !== -1) tlSide = 'home'
                              else if (tlSideStr.indexOf('away') !== -1) tlSide = 'away'
                            }
                            var tlIsOwn = /contra|own/i.test(itemTl.strTimelineDetail || '')
                            var pureScorerName = pName
                            if (tlIsOwn && pureScorerName.toLowerCase().indexOf('contra') === -1) {
                              pureScorerName += ' (contra)'
                            }
                            tsdbScorers.push({
                              name: pureScorerName,
                              rawName: pName,
                              minute: tlTime,
                              extraMinute: null,
                              teamId: tlTeamId || (tlSide === 'home' ? hTeamId : aTeamId),
                              teamName: tlSide === 'home' ? homeTeam : awayTeam,
                              teamSide: tlSide || 'home',
                            })
                            tsdbEvents.push({
                              type: 'Goal',
                              detail: tlIsOwn ? 'Own Goal' : 'Normal Goal',
                              time: { elapsed: tlTime, extra: null },
                              team: {
                                id: tlTeamId || (tlSide === 'home' ? hTeamId : aTeamId),
                                name: tlSide === 'home' ? homeTeam : awayTeam,
                              },
                              player: { id: null, name: pName },
                            })
                          }
                        }
                      }
                    } catch (errTimeline) {
                      console.log(
                        '[TheSportsDB Timeline] Erro ignorado ao consultar timeline do evento ' +
                          ev.idEvent +
                          ':',
                        errTimeline,
                      )
                    }
                  }

                  conmebolFixtures.push({
                    fixture: {
                      id: 'tsdb_' + (ev.idEvent || cli + '_' + ei),
                      date: isoDateStr,
                      timestamp: Math.floor(new Date(isoDateStr).getTime() / 1000) || 0,
                      status: {
                        short: shortStatus,
                        long: ev.strStatus || 'Not Started',
                        elapsed: null,
                      },
                    },
                    league: {
                      id: cl.shortId,
                      name: ev.strLeague || cl.name,
                      country: cl.country || 'Europe',
                      logo: ev.strLeagueBadge || ev.strBadge || '',
                      flag: '',
                      round: ev.strRound || '',
                      region: cl.region || 'Sul-Americana',
                    },
                    teams: {
                      home: {
                        id: hTeamId || 0,
                        name: homeTeam,
                        logo: ev.strHomeTeamBadge || '',
                        country: cl.country || 'Europe',
                      },
                      away: {
                        id: aTeamId || 0,
                        name: awayTeam,
                        logo: ev.strAwayTeamBadge || '',
                        country: cl.country || 'Europe',
                      },
                    },
                    goals: {
                      home: !isNaN(hScore) ? hScore : null,
                      away: !isNaN(aScore) ? aScore : null,
                    },
                    score: {
                      halftime: { home: null, away: null },
                      fulltime: {
                        home: !isNaN(hScore) ? hScore : null,
                        away: !isNaN(aScore) ? aScore : null,
                      },
                    },
                    events: tsdbEvents,
                    scorers: tsdbScorers,
                    isLive: ['1H', 'HT', '2H', 'LIVE'].indexOf(shortStatus) !== -1,
                    provider: 'thesportsdb',
                  })
                }
              }
            } catch (errTsdbLeague) {
              console.log(
                '[TheSportsDB Fallback] Erro ao buscar liga ' + cl.name + ':',
                errTsdbLeague,
              )
            }
          }
        }
      }

      return conmebolFixtures
    }

    // Se FOOTBALL_DATA for o provedor principal selecionado
    if (provedor === 'football_data') {
      var fdPrimaryToken = apiKey || fallbackApiKey
      if (fdPrimaryToken) {
        try {
          var pFD1 = dateQuery.split('-')
          var yFD1 = parseInt(pFD1[0], 10)
          var mFD1 = parseInt(pFD1[1], 10) - 1
          var dFD1 = parseInt(pFD1[2], 10)

          var prevFD1 = new Date(Date.UTC(yFD1, mFD1, dFD1 - 1))
          var dateFrom1 =
            prevFD1.getUTCFullYear() +
            '-' +
            ('0' + (prevFD1.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + prevFD1.getUTCDate()).slice(-2)
          var nextFD1 = new Date(Date.UTC(yFD1, mFD1, dFD1 + 1))
          var dateTo1 =
            nextFD1.getUTCFullYear() +
            '-' +
            ('0' + (nextFD1.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + nextFD1.getUTCDate()).slice(-2)

          var resFDPrimary = $http.send({
            url:
              'https://api.football-data.org/v4/matches?dateFrom=' +
              encodeURIComponent(dateFrom1) +
              '&dateTo=' +
              encodeURIComponent(dateTo1),
            method: 'GET',
            headers: { 'X-Auth-Token': fdPrimaryToken },
            timeout: 8,
          })

          if (isRateLimitErrorDay(resFDPrimary.statusCode, resFDPrimary.json || resFDPrimary.raw)) {
            rateLimitHit = true
          } else if (
            resFDPrimary.statusCode === 200 &&
            resFDPrimary.json &&
            Array.isArray(resFDPrimary.json.matches)
          ) {
            var parsedFD = parseFootballDataToDayFixtures(resFDPrimary.json.matches, fdPrimaryToken)

            // REGRA: Se retornar partidas, mescla com TheSportsDB para cobertura de copas secundárias e retorna
            if (parsedFD.fixtures.length > 0) {
              var fdFixturesList = parsedFD.fixtures
              var fdHasLive = parsedFD.hasLive

              try {
                var tsdbExtra = fetchConmebolFromTheSportsDb(dateQuery, theSportsDbKey)
                for (var tsei = 0; tsei < tsdbExtra.length; tsei++) {
                  var extraFix = tsdbExtra[tsei]
                  var extraDup = false
                  for (var fdi2 = 0; fdi2 < fdFixturesList.length; fdi2++) {
                    if (isSameMatchConfrontation(fdFixturesList[fdi2], extraFix)) {
                      extraDup = true
                      break
                    }
                  }
                  if (!extraDup) {
                    fdFixturesList.push(extraFix)
                    if (extraFix.isLive) fdHasLive = true
                  }
                }
              } catch (eTsdbExtra) {
                console.log('[TheSportsDB extra com Football-Data primário] Erro:', eTsdbExtra)
              }

              var freshManFD = fetchManualGamesForDate(dateQuery)
              var finalFdList = mergeManualFixturesOnTop(freshManFD, fdFixturesList)

              var fdPrimaryPayload = {
                configured: true,
                provider: 'football_data',
                date: dateQuery,
                total: finalFdList.length,
                hasLive:
                  fdHasLive ||
                  freshManFD.some(function (m) {
                    return m.isLive
                  }),
                fixtures: finalFdList,
                updatedAt: new Date().toISOString(),
              }

              if (dayStore && finalFdList.length > 0) {
                dayStore[dateQuery] = {
                  timestamp: Date.now(),
                  payload: fdPrimaryPayload,
                  fetching: 0,
                }
              }

              return e.json(
                200,
                Object.assign({}, fdPrimaryPayload, {
                  cached: false,
                  ttlSeconds: Math.round(
                    (fdPrimaryPayload.hasLive ? 90 * 1000 : 30 * 60 * 1000) / 1000,
                  ),
                }),
              )
            } else {
              console.log(
                '[Aviso Jogos-do-Dia] Football-Data.org retornou 0 partidas. Não gravando array vazio no cache.',
              )
              // Se temos cache anterior válido, usa-o
              if (
                dayEntry &&
                dayEntry.payload &&
                Array.isArray(dayEntry.payload.fixtures) &&
                dayEntry.payload.fixtures.length > 0
              ) {
                return e.json(
                  200,
                  Object.assign({}, dayEntry.payload, {
                    cached: true,
                    stale: true,
                    warning:
                      'Football-Data.org retornou 0 partidas; mantendo dados anteriores em cache.',
                  }),
                )
              }
              // Tenta API-Football como contingência reversa se houver chave
              var altApiKey = ''
              try {
                altApiKey =
                  ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
                    ? $secrets.get('API_FOOTBALL_KEY')
                    : '') ||
                  ($secrets.has && $secrets.has('RAPIDAPI_KEY')
                    ? $secrets.get('RAPIDAPI_KEY')
                    : '') ||
                  $os.getenv('API_FOOTBALL_KEY') ||
                  $os.getenv('RAPIDAPI_KEY') ||
                  ''
              } catch (_) {}
              if (!altApiKey && apiKey && apiKey !== fdPrimaryToken) {
                altApiKey = apiKey
              }
              if (altApiKey) {
                console.log(
                  '[Contingência Reversa] Football-Data.org retornou 0 partidas. Tentando API-Football...',
                )
                // Permite seguir para API-Football abaixo
              } else {
                return e.json(200, {
                  configured: true,
                  provider: 'football_data',
                  date: dateQuery,
                  total: 0,
                  hasLive: false,
                  fixtures: [],
                  cached: false,
                  warning: 'Nenhuma partida encontrada no Football-Data.org para a data.',
                })
              }
            }
          }
        } catch (errFDPrimary) {
          console.log('Erro ao consultar Football-Data.org como primário:', errFDPrimary)
        }
      }
    }

    // Chave para TheSportsDB (usada como provedor terciário e cobertura das copas secundárias)
    var theSportsDbKey = ''
    try {
      var tsdbRecDay = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'thesportsdb_fallback',
      )
      if (tsdbRecDay) {
        theSportsDbKey = (tsdbRecDay.getString('api_key') || '').trim()
      }
    } catch (_) {}
    if (!theSportsDbKey) {
      try {
        theSportsDbKey =
          ($secrets.has && $secrets.has('THESPORTSDB_KEY')
            ? $secrets.get('THESPORTSDB_KEY')
            : '') ||
          $os.getenv('THESPORTSDB_KEY') ||
          ''
      } catch (_) {}
    }
    if (!theSportsDbKey) {
      theSportsDbKey = '3'
    }

    // Se API-Football é primária (ou contingência de Football-Data)
    var apiFootballKey = apiKey
    if (provedor === 'football_data') {
      // Se football_data é principal, tenta buscar chave alternativa de API-Football
      try {
        var altKey =
          ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
            ? $secrets.get('API_FOOTBALL_KEY')
            : '') ||
          ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
          $os.getenv('API_FOOTBALL_KEY') ||
          $os.getenv('RAPIDAPI_KEY') ||
          ''
        if (altKey) apiFootballKey = altKey
      } catch (_) {}
    }

    if (apiFootballKey && apiFootballKey !== fallbackApiKey) {
      var baseUrl = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'

      var headers = isRapidApi
        ? {
            'x-rapidapi-key': apiFootballKey,
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
          }
        : {
            'x-apisports-key': apiFootballKey,
          }

      var callUrl =
        baseUrl + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'

      try {
        var resp = $http.send({
          url: callUrl,
          method: 'GET',
          headers: headers,
          timeout: 8,
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
        console.log('Aviso ao consultar data ' + dateQuery + ' na API-Football:', eH)
      }
    } else {
      rateLimitHit = true
    }

    // -------------------------------------------------------------
    // CONTINGÊNCIA AUTOMÁTICA EM JOGOS DO DIA:
    // Cascata API-Football -> Football-Data.org -> TheSportsDB
    // -------------------------------------------------------------
    var contingencyUsed = false
    var contingencyFixtures = []
    var contingencyHasLive = false
    var contingencyProvider = ''

    if ((rateLimitHit || !allFixtures || allFixtures.length === 0) && fallbackApiKey) {
      console.log(
        '[Contingência Jogos-do-Dia] API-Football indisponível ou sem partidas. Acionando Football-Data.org...',
      )
      try {
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

        var resFD = $http.send({
          url:
            'https://api.football-data.org/v4/matches?dateFrom=' +
            encodeURIComponent(dateFrom) +
            '&dateTo=' +
            encodeURIComponent(dateTo),
          method: 'GET',
          headers: { 'X-Auth-Token': fallbackApiKey },
          timeout: 8,
        })

        if (isRateLimitErrorDay(resFD.statusCode, resFD.json || resFD.raw)) {
          rateLimitHit = true
        } else if (resFD.statusCode === 200 && resFD.json && Array.isArray(resFD.json.matches)) {
          var parsedContingency = parseFootballDataToDayFixtures(resFD.json.matches, fallbackApiKey)
          if (parsedContingency.fixtures.length > 0) {
            contingencyUsed = true
            contingencyProvider = 'football_data'
            contingencyFixtures = parsedContingency.fixtures
            contingencyHasLive = parsedContingency.hasLive
          }
        }
      } catch (eFD) {
        console.log('Aviso ao consultar contingência Football-Data.org em jogos-do-dia:', eFD)
      }
    }

    // Se Football-Data.org foi usado OU se mesmo após API-Football e Football-Data.org ainda não temos partidas,
    // aciona TheSportsDB para completar ou fornecer os jogos (Europa League, Conference, Libertadores, Sul-Americana)
    if (contingencyUsed || !allFixtures || allFixtures.length === 0) {
      try {
        var tsdbContingencyFixtures = fetchConmebolFromTheSportsDb(dateQuery, theSportsDbKey)
        if (tsdbContingencyFixtures && tsdbContingencyFixtures.length > 0) {
          if (!contingencyUsed && (!allFixtures || allFixtures.length === 0)) {
            contingencyUsed = true
            contingencyProvider = 'thesportsdb'
            contingencyFixtures = tsdbContingencyFixtures
            contingencyHasLive = tsdbContingencyFixtures.some(function (tf) {
              return tf.isLive
            })
          } else if (contingencyUsed) {
            // Se já tínhamos partidas de Football-Data.org, complementa com TheSportsDB com deduplicação
            for (var tcfi = 0; tcfi < tsdbContingencyFixtures.length; tcfi++) {
              var tcf = tsdbContingencyFixtures[tcfi]
              var isDuplicateConfrontation = false
              for (var cfi = 0; cfi < contingencyFixtures.length; cfi++) {
                if (isSameMatchConfrontation(contingencyFixtures[cfi], tcf)) {
                  isDuplicateConfrontation = true
                  break
                }
              }
              if (!isDuplicateConfrontation) {
                contingencyFixtures.push(tcf)
                if (tcf.isLive) contingencyHasLive = true
              }
            }
          }
        }
      } catch (errTsdbContingency) {
        console.log('[Contingência TheSportsDB em Jogos-do-Dia] Erro:', errTsdbContingency)
      }
    }

    if (contingencyUsed && contingencyFixtures.length > 0) {
      // FIX 2: Deep merge da contingência com o cache existente preservando ligas já obtidas
      var mergedWithExisting = contingencyFixtures.slice(0)
      if (
        dayEntry &&
        dayEntry.payload &&
        Array.isArray(dayEntry.payload.fixtures) &&
        dayEntry.payload.fixtures.length > 0
      ) {
        var existingCachedList = dayEntry.payload.fixtures
        for (var exi = 0; exi < existingCachedList.length; exi++) {
          var exFix = existingCachedList[exi]
          var matchFound = false
          for (var cmi = 0; cmi < mergedWithExisting.length; cmi++) {
            var cFix = mergedWithExisting[cmi]
            if (isSameMatchConfrontation(exFix, cFix)) {
              matchFound = true
              // Atualiza placar se cFix tiver gols e exFix não
              if (
                (exFix.goals.home === null || exFix.goals.home === undefined) &&
                cFix.goals.home !== null &&
                cFix.goals.home !== undefined
              ) {
                exFix.goals.home = cFix.goals.home
                exFix.goals.away = cFix.goals.away
              }
              // Propaga scorers se exFix não tiver
              if (
                (!Array.isArray(exFix.scorers) || exFix.scorers.length === 0) &&
                Array.isArray(cFix.scorers) &&
                cFix.scorers.length > 0
              ) {
                exFix.scorers = cFix.scorers
              }
              // Propaga status ao vivo
              if (cFix.isLive) {
                exFix.isLive = true
                contingencyHasLive = true
              }
              break
            }
          }
          // Se a partida do cache (ex: La Liga, Brasileirão, Premier League) não estiver na contingência, PRESERVA!
          if (!matchFound) {
            mergedWithExisting.push(exFix)
            if (exFix.isLive) contingencyHasLive = true
          }
        }
      }

      // Mescla com eventuais jogos manuais cadastrados
      var freshManualsContingency = fetchManualGamesForDate(dateQuery)
      var finalContingencyFixtures = mergeManualFixturesOnTop(
        freshManualsContingency,
        mergedWithExisting,
      )

      var contingencyPayload = {
        configured: true,
        provider: contingencyProvider,
        fallback_active: true,
        is_contingency: true,
        contingency: true,
        original_provider: provedor,
        message:
          contingencyProvider === 'football_data'
            ? 'Contingência temporária ativada: jogos providos via Football-Data.org e TheSportsDB. Revalidação frequente ativa para restauração global automática.'
            : 'Contingência temporária ativada: jogos providos via TheSportsDB. Revalidação frequente ativa para restauração global automática.',
        date: dateQuery,
        total: finalContingencyFixtures.length,
        hasLive:
          contingencyHasLive ||
          freshManualsContingency.some(function (m) {
            return m.isLive
          }),
        fixtures: finalContingencyFixtures,
        updatedAt: new Date().toISOString(),
      }

      // REGRA: Payload de contingência tem cobertura restrita (ex: cota esgotada na primária).
      // Grava no cache com flag degradada e TTL curto (60s) para revalidar com a API-Football
      // logo que a cota seja renovada, sem prender o usuário em um snapshot reduzido.
      if (dayStore && finalContingencyFixtures.length > 0) {
        dayStore[dateQuery] = {
          timestamp: Date.now(),
          payload: contingencyPayload,
          fetching: 0,
        }
      }

      return e.json(
        200,
        Object.assign({}, contingencyPayload, {
          cached: false,
          ttlSeconds: 60,
        }),
      )
    }

    // Tratamento Gracioso se cota excedida e sem contingência funcional
    if (rateLimitHit && !contingencyUsed) {
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
      // Mesmo se a API falhar completamente, precisamos verificar se há jogos manuais gravados pelo admin!
      var fallbackManualFixtures = []
      try {
        var fbManualRecs = $app.findRecordsByFilter(
          'jogos_do_dia_manuais',
          "data = '" + dateQuery + "'",
          'horario',
          100,
          0,
        )
        for (var fmi = 0; fmi < fbManualRecs.length; fmi++) {
          var fbRec = fbManualRecs[fmi]
          var fbTimeCasa = fbRec.getString('time_casa') || ''
          var fbTimeVisitante = fbRec.getString('time_visitante') || ''
          var fbHorario = fbRec.getString('horario') || '20:00'
          var fbCampeonato = fbRec.getString('campeonato') || 'Amistoso'
          var fbRegiao = fbRec.getString('regiao') || 'Brasileirão & Copas'
          var fbPlacarCasa = fbRec.getInt('placar_casa')
          var fbPlacarVisitante = fbRec.getInt('placar_visitante')
          var fbStatus = (fbRec.getString('status') || 'NS').trim().toUpperCase()
          var fbLogoCasa = fbRec.getString('logo_casa') || ''
          var fbLogoVisitante = fbRec.getString('logo_visitante') || ''
          var fbObs = fbRec.getString('observacao') || ''
          var fbIso =
            dateQuery + 'T' + (fbHorario.length === 5 ? fbHorario + ':00' : fbHorario) + '-03:00'
          var fbIsLive = ['1H', 'HT', '2H', 'LIVE'].indexOf(fbStatus) !== -1

          fallbackManualFixtures.push({
            fixture: {
              id: 'manual_' + fbRec.id,
              manualId: fbRec.id,
              isManual: true,
              date: fbIso,
              timestamp: Math.floor(new Date(fbIso).getTime() / 1000) || 0,
              status: {
                short: fbStatus,
                long:
                  fbStatus === 'FT'
                    ? 'Encerrado'
                    : fbIsLive
                      ? 'Ao Vivo'
                      : fbStatus === 'PST'
                        ? 'Adiado'
                        : fbStatus === 'CANC'
                          ? 'Cancelado'
                          : 'Agendado',
                elapsed: null,
              },
            },
            league: {
              id: 99990 + fmi,
              name: fbCampeonato,
              country: 'América do Sul',
              logo: (function (cName) {
                if (!cName) return ''
                var cLower = cName.toLowerCase()
                if (
                  typeof globalThis !== 'undefined' &&
                  globalThis.__tsdbLeagueCache &&
                  globalThis.__tsdbLeagueCache[cLower] !== undefined
                ) {
                  return globalThis.__tsdbLeagueCache[cLower] || ''
                }
                return ''
              })(fbCampeonato),
              flag: '',
              round: fbObs || 'Manual',
              region: fbRegiao,
            },
            teams: {
              home: {
                id: 999000 + fmi * 2,
                name: fbTimeCasa,
                logo: fbLogoCasa,
                country: 'América do Sul',
              },
              away: {
                id: 999001 + fmi * 2,
                name: fbTimeVisitante,
                logo: fbLogoVisitante,
                country: 'América do Sul',
              },
            },
            goals: {
              home:
                fbRec.get('placar_casa') !== null && fbRec.get('placar_casa') !== undefined
                  ? fbPlacarCasa
                  : null,
              away:
                fbRec.get('placar_visitante') !== null &&
                fbRec.get('placar_visitante') !== undefined
                  ? fbPlacarVisitante
                  : null,
            },
            score: {
              halftime: { home: null, away: null },
              fulltime: {
                home:
                  fbRec.get('placar_casa') !== null && fbRec.get('placar_casa') !== undefined
                    ? fbPlacarCasa
                    : null,
                away:
                  fbRec.get('placar_visitante') !== null &&
                  fbRec.get('placar_visitante') !== undefined
                    ? fbPlacarVisitante
                    : null,
              },
            },
            scorers: [],
            isLive: fbIsLive,
            isManual: true,
            manualRecordId: fbRec.id,
          })
        }
      } catch (errFbMan) {}

      if (fallbackManualFixtures.length > 0) {
        return e.json(200, {
          configured: true,
          date: dateQuery,
          total: fallbackManualFixtures.length,
          hasLive: fallbackManualFixtures.some(function (m) {
            return m.isLive
          }),
          fixtures: fallbackManualFixtures,
          cached: false,
          warning:
            'APIs externas indisponíveis. Exibindo jogos inseridos manualmente pelo administrador.',
        })
      }

      if (dayEntry && dayEntry.payload) {
        var prevTotal = Array.isArray(dayEntry.payload.fixtures)
          ? dayEntry.payload.fixtures.length
          : 0
        if (prevTotal > 0) {
          var staleResp = Object.assign({}, dayEntry.payload, {
            cached: true,
            fallback: true,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          })
          return e.json(200, staleResp)
        }
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

      // FILTRO ESTRITO DE FUSO HORÁRIO (America/Sao_Paulo):
      // Partida cujo horário, convertido para America/Sao_Paulo (UTC-3), pertence a outro dia
      // que não a data consultada (dateQuery) NÃO deve aparecer na listagem.
      var fixtureDateStr = item.fixture && item.fixture.date ? String(item.fixture.date) : ''
      var fixtureDateSP = toDateStringSaoPaulo(fixtureDateStr)
      if (dateQuery && fixtureDateSP && fixtureDateSP !== dateQuery) {
        continue
      }

      seenFixtureIds[fId] = true

      var statusShort = (item.fixture && item.fixture.status && item.fixture.status.short) || ''
      var statusLong = (item.fixture && item.fixture.status && item.fixture.status.long) || ''
      var rawShortUpper = statusShort.toUpperCase().trim()
      var rawLongUpper = statusLong.toUpperCase().trim()

      // Normaliza dialetos de status para PST (Adiado) e CANC (Cancelado)
      if (
        rawShortUpper === 'PST' ||
        rawShortUpper === 'POSTP' ||
        rawLongUpper === 'MATCH POSTPONED' ||
        rawLongUpper === 'POSTPONED'
      ) {
        statusShort = 'PST'
      } else if (
        rawShortUpper === 'CANC' ||
        rawShortUpper === 'CANCELLED' ||
        rawLongUpper === 'MATCH CANCELLED' ||
        rawLongUpper === 'CANCELLED'
      ) {
        statusShort = 'CANC'
      } else if (rawShortUpper === 'SUSP' || rawLongUpper === 'MATCH SUSPENDED') {
        statusShort = 'SUSP'
      } else if (rawShortUpper === 'ABD' || rawLongUpper === 'MATCH ABANDONED') {
        statusShort = 'ABD'
      }

      var isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(statusShort) !== -1
      if (isLive) {
        hasLiveMatch = true
      }

      var scorersList = []
      if (Array.isArray(item.events)) {
        for (var ei = 0; ei < item.events.length; ei++) {
          var ev = item.events[ei]
          var evType = ev && ev.type ? String(ev.type).toLowerCase() : ''
          var evDetail = ev && ev.detail ? String(ev.detail).toLowerCase() : ''
          if (ev && (evType === 'goal' || evType === 'gol')) {
            var candidates = [
              ev.player && ev.player.name,
              ev.player && ev.player.shortName,
              ev.event_player,
              ev.strPlayer,
              ev.player_name,
              ev.scorer && ev.scorer.name,
              ev.scorer && ev.scorer.shortName,
              typeof ev.scorer === 'string' ? ev.scorer : null,
              ev.name,
              ev.strScorer,
              ev.strEvent,
              ev.detail,
            ]
            var rawName = ''
            for (var ci = 0; ci < candidates.length; ci++) {
              var cand = candidates[ci]
              if (cand && typeof cand === 'string') {
                var cleanCand = cand.trim().toLowerCase()
                if (
                  cleanCand &&
                  cleanCand !== 'gol' &&
                  cleanCand !== 'goal' &&
                  cleanCand !== 'normal goal' &&
                  cleanCand !== 'penalty' &&
                  cleanCand !== 'own goal'
                ) {
                  rawName = cand.trim()
                  break
                }
              }
            }
            if (rawName) {
              var isOwnGoal = evDetail.indexOf('own') !== -1 || evType === 'own'
              var scorerNameStr = rawName
              if (isOwnGoal && scorerNameStr.toLowerCase().indexOf('contra') === -1) {
                scorerNameStr += ' (contra)'
              }
              var evMin =
                ev.time && ev.time.elapsed != null
                  ? ev.time.elapsed
                  : ev.minute != null
                    ? ev.minute
                    : ev.intMinute != null
                      ? ev.intMinute
                      : ev.intGoalScoredTime != null
                        ? ev.intGoalScoredTime
                        : null
              var evExtra = ev.time && ev.time.extra != null ? ev.time.extra : null
              var evTeamId = ev.team ? ev.team.id : null
              var evTeamName = ev.team ? ev.team.name : null
              var evSide = null
              if (item.teams && item.teams.home && evTeamId && evTeamId === item.teams.home.id) {
                evSide = 'home'
              } else if (
                item.teams &&
                item.teams.away &&
                evTeamId &&
                evTeamId === item.teams.away.id
              ) {
                evSide = 'away'
              }

              scorersList.push({
                name: scorerNameStr,
                minute: evMin,
                extraMinute: evExtra,
                teamId: evTeamId,
                teamName: evTeamName,
                teamSide: evSide,
              })
            }
          }
        }
      } else if (Array.isArray(item.scorers)) {
        scorersList = item.scorers
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

      var fixedFixtureObj = Object.assign({}, item.fixture || {}, {
        status: Object.assign({}, (item.fixture && item.fixture.status) || {}, {
          short: statusShort,
        }),
      })

      rawFixtures.push({
        fixture: fixedFixtureObj,
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
        events: item.events,
        scorers: scorersList,
        isLive: isLive,
      })
    }

    // REGRA DE OURO: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
    if (rawFixtures.length === 0) {
      console.log(
        '[Aviso Jogos-do-Dia] API retornou 0 partidas. Não gravando no cache e mantendo anterior se houver.',
      )
      if (
        dayEntry &&
        dayEntry.payload &&
        Array.isArray(dayEntry.payload.fixtures) &&
        dayEntry.payload.fixtures.length > 0
      ) {
        return e.json(
          200,
          Object.assign({}, dayEntry.payload, {
            cached: true,
            stale: true,
            warning: 'API retornou 0 partidas; mantendo último resultado válido em cache.',
          }),
        )
      }

      // Se não havia cache anterior, entrega resposta com flag temporária sem salvar no cache store!
      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        cached: false,
        warning: 'Nenhuma partida encontrada para a data informada.',
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

    // CASCATA CONTINUADA: Se a API primária (ex: API-Football) não trouxe os jogos de ligas secundárias
    // (Europa League id 4481, Conference League id 5071, Libertadores id 4501, Sul-Americana id 4724),
    // consulta TheSportsDB e deduplica confrontos (mesma data + par de equipes independente da ordem).
    try {
      var tsdbFallbackFixtures = fetchConmebolFromTheSportsDb(dateQuery, theSportsDbKey)
      for (var tsi = 0; tsi < tsdbFallbackFixtures.length; tsi++) {
        var tFix = tsdbFallbackFixtures[tsi]
        var dupFound = false
        for (var rfi = 0; rfi < rawFixtures.length; rfi++) {
          var rf = rawFixtures[rfi]
          if (isSameMatchConfrontation(rf, tFix)) {
            dupFound = true
            // Atualiza placar/status se o jogo existente estava sem placar e o secundário tem
            if (
              (rf.goals.home === null || rf.goals.home === undefined) &&
              tFix.goals.home !== null &&
              tFix.goals.home !== undefined
            ) {
              rf.goals.home = tFix.goals.home
              rf.goals.away = tFix.goals.away
              if (!rf.score)
                rf.score = {
                  halftime: { home: null, away: null },
                  fulltime: { home: null, away: null },
                }
              if (!rf.score.fulltime) rf.score.fulltime = { home: null, away: null }
              rf.score.fulltime.home =
                tFix.score && tFix.score.fulltime ? tFix.score.fulltime.home : tFix.goals.home
              rf.score.fulltime.away =
                tFix.score && tFix.score.fulltime ? tFix.score.fulltime.away : tFix.goals.away
            }
            // Propaga scorers e events se o jogo existente não os possuir preenchidos
            if (
              (!Array.isArray(rf.scorers) || rf.scorers.length === 0) &&
              Array.isArray(tFix.scorers) &&
              tFix.scorers.length > 0
            ) {
              rf.scorers = tFix.scorers
            }
            if (
              (!Array.isArray(rf.events) || rf.events.length === 0) &&
              Array.isArray(tFix.events) &&
              tFix.events.length > 0
            ) {
              rf.events = tFix.events
            }
            if (tFix.isLive) {
              rf.isLive = true
              hasLiveMatch = true
            }
            break
          }
        }
        if (!dupFound) {
          rawFixtures.push(tFix)
          if (tFix.isLive) {
            hasLiveMatch = true
          }
        }
      }
    } catch (errTsdbDay) {
      console.log('[TheSportsDB Fallback Jogos-do-Dia] Erro:', errTsdbDay)
    }

    // Recalcula/reaplica os jogos manuais diretamente do banco no momento da resposta
    var freshManualList = fetchManualGamesForDate(dateQuery)
    var finalFixtures = mergeManualFixturesOnTop(freshManualList, rawFixtures)

    var finalPayload = Object.assign({}, payload, {
      total: finalFixtures.length,
      fixtures: finalFixtures,
      hasLive:
        hasLiveMatch ||
        freshManualList.some(function (m) {
          return m.isLive
        }),
    })

    // FIX 2: Deep merge também antes de salvar no cache se houver partidas prévias válidas de outras ligas
    var combinedStoreFixtures = finalFixtures.slice(0)
    if (
      dayEntry &&
      dayEntry.payload &&
      Array.isArray(dayEntry.payload.fixtures) &&
      dayEntry.payload.fixtures.length > 0
    ) {
      var prevFixturesToMerge = dayEntry.payload.fixtures
      for (var pfi = 0; pfi < prevFixturesToMerge.length; pfi++) {
        var pf = prevFixturesToMerge[pfi]
        var pfMatched = false
        for (var csi = 0; csi < combinedStoreFixtures.length; csi++) {
          if (isSameMatchConfrontation(pf, combinedStoreFixtures[csi])) {
            pfMatched = true
            break
          }
        }
        if (!pfMatched) {
          combinedStoreFixtures.push(pf)
          if (pf.isLive) {
            finalPayload.hasLive = true
          }
        }
      }
      finalPayload.fixtures = combinedStoreFixtures
      finalPayload.total = combinedStoreFixtures.length
    }

    // Grava no cache se houver pelo menos 1 partida!
    if (dayStore && combinedStoreFixtures.length > 0) {
      dayStore[dateQuery] = {
        timestamp: Date.now(),
        payload: finalPayload,
        fetching: 0,
      }
    }

    return e.json(
      200,
      Object.assign({}, finalPayload, {
        cached: false,
        ttlSeconds: Math.round((hasLiveMatch ? 90 * 1000 : 30 * 60 * 1000) / 1000),
      }),
    )
  } catch (err) {
    console.log('Erro capturado no endpoint jogos-do-dia:', err)
    // Mesmo no bloco de erro/catch, busca jogos manuais do banco para exibir com prioridade
    var fallbackManuals = []
    try {
      fallbackManuals = fetchManualGamesForDate(dateQuery)
    } catch (_) {}

    if (
      typeof globalThis !== 'undefined' &&
      globalThis.__jogosDoDiaStore &&
      globalThis.__jogosDoDiaStore[dateQuery] &&
      globalThis.__jogosDoDiaStore[dateQuery].payload
    ) {
      var cachedPayload = globalThis.__jogosDoDiaStore[dateQuery].payload
      var mergedCatch = mergeManualFixturesOnTop(fallbackManuals, cachedPayload.fixtures)
      return e.json(
        200,
        Object.assign({}, cachedPayload, {
          total: mergedCatch.length,
          fixtures: mergedCatch,
          cached: true,
          fallback: true,
        }),
      )
    }

    return e.json(200, {
      configured: true,
      date: dateQuery || '',
      total: fallbackManuals.length,
      hasLive: fallbackManuals.some(function (m) {
        return m.isLive
      }),
      fixtures: fallbackManuals,
      error:
        fallbackManuals.length > 0
          ? null
          : 'Não foi possível carregar as partidas agora. Tente novamente mais tarde.',
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

    let provedor = 'api_football'
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
        provedor = configRecord.getString('provedor') || 'api_football'
        const k = (configRecord.getString('api_key') || '').trim()
        if (k) {
          hasDbKey = true
          maskedKey = k.length > 8 ? '••••••••' + k.slice(-4) : '••••' + k.slice(-2)
        }
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // Lê chave secundária de contingência (Football-Data.org)
    let hasFallbackDbKey = false
    let maskedFallbackKey = ''
    try {
      const fbRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fbRecord) {
        const fbK = (fbRecord.getString('api_key') || '').trim()
        if (fbK) {
          hasFallbackDbKey = true
          maskedFallbackKey = fbK.length > 8 ? '••••••••' + fbK.slice(-4) : '••••' + fbK.slice(-2)
        }
      }
    } catch (_) {}

    // Lê chave de contingência TheSportsDB (Sul-Americana / Libertadores)
    let hasTsdbDbKey = false
    let maskedTsdbKey = ''
    try {
      const tsdbRec = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'thesportsdb_fallback',
      )
      if (tsdbRec) {
        const tsdbK = (tsdbRec.getString('api_key') || '').trim()
        if (tsdbK) {
          hasTsdbDbKey = true
          maskedTsdbKey = tsdbK.length > 8 ? '••••••••' + tsdbK.slice(-4) : '••••' + tsdbK.slice(-2)
        }
      }
    } catch (_) {}

    let hasSecretFallback = false
    try {
      if (
        ($secrets.has &&
          ($secrets.has('API_FOOTBALL_KEY') ||
            $secrets.has('RAPIDAPI_KEY') ||
            $secrets.has('FOOTBALL_DATA_KEY') ||
            $secrets.has('THESPORTSDB_KEY'))) ||
        $os.getenv('API_FOOTBALL_KEY') ||
        $os.getenv('RAPIDAPI_KEY') ||
        $os.getenv('FOOTBALL_DATA_KEY') ||
        $os.getenv('THESPORTSDB_KEY')
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
      hasFallbackKey:
        hasFallbackDbKey ||
        Boolean($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')) ||
        Boolean($os.getenv('FOOTBALL_DATA_KEY')),
      hasFallbackDbKey: hasFallbackDbKey,
      maskedFallbackKey: maskedFallbackKey,
      hasTsdbKey:
        hasTsdbDbKey ||
        Boolean($secrets.has && $secrets.has('THESPORTSDB_KEY')) ||
        Boolean($os.getenv('THESPORTSDB_KEY')),
      hasTsdbDbKey: hasTsdbDbKey,
      maskedTsdbKey: maskedTsdbKey,
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
    const provedor = (body.provedor || 'api_football').trim()
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : undefined
    const fallbackApiKey =
      typeof body.fallback_api_key === 'string' ? body.fallback_api_key.trim() : undefined
    const tsdbApiKey = typeof body.tsdb_api_key === 'string' ? body.tsdb_api_key.trim() : undefined
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

    // Se fornecida chave secundária para contingência (Football-Data.org)
    let fbRecord
    try {
      fbRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'football_data_fallback')
    } catch (_) {
      fbRecord = new Record(col)
      fbRecord.set('chave', 'football_data_fallback')
      fbRecord.set('provedor', 'football_data')
      fbRecord.set('ativo', true)
    }

    if (fallbackApiKey !== undefined) {
      fbRecord.set('api_key', fallbackApiKey)
      $app.save(fbRecord)
    }

    // Se fornecida chave para TheSportsDB (Sul-Americana / Libertadores)
    let tsdbRecord
    try {
      tsdbRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'thesportsdb_fallback')
    } catch (_) {
      tsdbRecord = new Record(col)
      tsdbRecord.set('chave', 'thesportsdb_fallback')
      tsdbRecord.set('provedor', 'thesportsdb')
      tsdbRecord.set('ativo', true)
    }

    if (tsdbApiKey !== undefined) {
      tsdbRecord.set('api_key', tsdbApiKey)
      $app.save(tsdbRecord)
    }

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

    const savedFallbackKey = fbRecord.getString('api_key') || ''
    const maskedFallbackKey = savedFallbackKey
      ? savedFallbackKey.length > 8
        ? '••••••••' + savedFallbackKey.slice(-4)
        : '••••' + savedFallbackKey.slice(-2)
      : ''

    const savedTsdbKey = tsdbRecord ? tsdbRecord.getString('api_key') || '' : ''
    const maskedTsdbKey = savedTsdbKey
      ? savedTsdbKey.length > 8
        ? '••••••••' + savedTsdbKey.slice(-4)
        : '••••' + savedTsdbKey.slice(-2)
      : ''

    return e.json(200, {
      success: true,
      message: 'Configurações de integração e contingência salvas com sucesso no banco de dados.',
      provedor: provedor,
      hasKey: Boolean(savedKey),
      maskedKey: maskedKey,
      hasFallbackKey: Boolean(savedFallbackKey),
      maskedFallbackKey: maskedFallbackKey,
      hasTsdbKey: Boolean(savedTsdbKey),
      maskedTsdbKey: maskedTsdbKey,
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
    const isFallbackTest = body.is_fallback === true
    let apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    if (!apiKey) {
      if (isFallbackTest || provedor === 'football_data') {
        try {
          const fallbackRecord = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'football_data_fallback',
          )
          if (fallbackRecord) {
            apiKey = (fallbackRecord.getString('api_key') || '').trim()
          }
        } catch (_) {}
      }

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

      if (!apiKey && (isFallbackTest || provedor === 'football_data')) {
        try {
          apiKey =
            ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
              ? $secrets.get('FOOTBALL_DATA_KEY')
              : '') ||
            $os.getenv('FOOTBALL_DATA_KEY') ||
            ''
        } catch (_) {}
      }
    }

    if (provedor === 'thesportsdb') {
      if (!apiKey) {
        try {
          const tsdbRecord = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'thesportsdb_fallback',
          )
          if (tsdbRecord) {
            apiKey = (tsdbRecord.getString('api_key') || '').trim()
          }
        } catch (_) {}
      }
      if (!apiKey) {
        try {
          apiKey =
            ($secrets.has && $secrets.has('THESPORTSDB_KEY')
              ? $secrets.get('THESPORTSDB_KEY')
              : '') ||
            $os.getenv('THESPORTSDB_KEY') ||
            ''
        } catch (_) {}
      }
      if (!apiKey) {
        apiKey = '3'
      }
    }

    if (!apiKey) {
      return e.json(400, {
        success: false,
        message: 'Por favor, informe a API Key para realizar o teste de conexão.',
      })
    }

    // Teste Football-Data.org (usado também no teste da chave de contingência)
    if (provedor === 'football_data' || isFallbackTest) {
      try {
        const res = $http.send({
          url: 'https://api.football-data.org/v4/competitions',
          method: 'GET',
          headers: { 'X-Auth-Token': apiKey },
          timeout: 8,
        })

        if (res.statusCode === 200) {
          const count =
            (res.json && res.json.count) ||
            (res.json && res.json.competitions && res.json.competitions.length) ||
            0
          return e.json(200, {
            success: true,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: res.statusCode,
            message:
              'Conexão com Football-Data.org bem-sucedida! ' + count + ' competições disponíveis.',
          })
        } else if (res.statusCode === 429) {
          return e.json(200, {
            success: false,
            rate_limited: true,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: 429,
            message:
              'Football-Data.org retornou limite de requisições excedido (HTTP 429). Tente novamente mais tarde.',
          })
        } else if (res.statusCode === 403 || res.statusCode === 401) {
          return e.json(400, {
            success: false,
            provider: 'football_data',
            isFallback: isFallbackTest,
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
            isFallback: isFallbackTest,
            statusCode: res.statusCode,
            message:
              'A Football-Data.org retornou status HTTP ' + res.statusCode + ': ' + (res.raw || ''),
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'football_data',
          isFallback: isFallbackTest,
          message:
            'Erro ao conectar à Football-Data.org: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    // Teste TheSportsDB
    if (provedor === 'thesportsdb') {
      try {
        var keyToUse = (apiKey || '').trim() || '3'

        // 1. Tenta lookupleague.php?id=4328 com a chave informada (ou '3')
        var resTsdbTest = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(keyToUse) +
            '/lookupleague.php?id=4328',
          method: 'GET',
          timeout: 8,
        })

        // 2. Se status !== 200, tenta fallback para a chave de demonstração pública 123
        if (!resTsdbTest || resTsdbTest.statusCode !== 200) {
          try {
            resTsdbTest = $http.send({
              url: 'https://www.thesportsdb.com/api/v1/json/123/all_sports.php',
              method: 'GET',
              timeout: 8,
            })
          } catch (_) {}
        }

        if (resTsdbTest && resTsdbTest.statusCode === 200) {
          return e.json(200, {
            success: true,
            provider: 'thesportsdb',
            statusCode: 200,
            message: 'Conexão com TheSportsDB bem-sucedida! Serviço disponível e respondendo.',
          })
        } else {
          var failCode = resTsdbTest ? resTsdbTest.statusCode : 0
          return e.json(200, {
            success: false,
            provider: 'thesportsdb',
            statusCode: failCode,
            message:
              'Não foi possível validar a conexão com a TheSportsDB no momento (status HTTP ' +
              failCode +
              '). Tente novamente mais tarde.',
          })
        }
      } catch (errReq) {
        return e.json(200, {
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
          timeout: 8,
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
              'API-Football atingiu o limite de cota (Status 429). A contingência automática para Football-Data.org assumirá as consultas.',
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
// POST /backend/v1/limpar-cache (ou /backend/v1/placar-ao-vivo/limpar-cache)
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/limpar-cache', (e) => {
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

    let clearedStores = []

    if (typeof globalThis !== 'undefined') {
      if (globalThis.__placarAoVivoCacheStore) {
        globalThis.__placarAoVivoCacheStore = {}
        clearedStores.push('placar_ao_vivo')
      }
      if (globalThis.__jogosDoDiaStore) {
        globalThis.__jogosDoDiaStore = {}
        clearedStores.push('jogos_do_dia')
      }
    }

    console.log(
      '[Cache] Cache do servidor limpo com sucesso pelo administrador Douglas:',
      clearedStores.join(', '),
    )

    return e.json(200, {
      success: true,
      message: 'Cache limpo — próxima busca será direto na API',
      cleared: clearedStores,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao limpar cache do servidor',
    })
  }
})

// Rota de conveniência POST /backend/v1/limpar-cache
routerAdd('POST', '/backend/v1/limpar-cache', (e) => {
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

    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
    }

    console.log('[Cache] POST /backend/v1/limpar-cache executado com sucesso.')

    return e.json(200, {
      success: true,
      message: 'Cache limpo — próxima busca será direto na API',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao limpar cache do servidor',
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

// -------------------------------------------------------------
// Hooks do Ciclo de Vida de Jogos Manuais (jogos_do_dia_manuais):
// 1. Purge imediato do cache de partidas do dia ao criar, editar ou excluir.
// 2. Busca automática de escudos (TheSportsDB searchteams.php) quando logo_casa/logo_visitante estiverem vazios.
// -------------------------------------------------------------

onRecordCreate((e) => {
  var rec = e.record

  // Invalidação imediata do cache em memória do servidor
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
    }
  } catch (_) {}

  // Autocompletar escudos no TheSportsDB se não informados
  try {
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    var timeCasa = (rec.getString('time_casa') || '').trim()
    var timeVis = (rec.getString('time_visitante') || '').trim()

    if (!logoCasa || !logoVis) {
      if (typeof globalThis !== 'undefined' && !globalThis.__tsdbBadgeCache) {
        globalThis.__tsdbBadgeCache = {}
      }

      // Lê chave de contingência TheSportsDB
      var tsdbKey = ''
      try {
        var cRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'thesportsdb_fallback')
        if (cRec) {
          tsdbKey = (cRec.getString('api_key') || '').trim()
        }
      } catch (_) {}

      if (!tsdbKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('THESPORTSDB_KEY')) {
            tsdbKey = ($secrets.get('THESPORTSDB_KEY') || '').trim()
          } else if ($os && $os.getenv) {
            tsdbKey = ($os.getenv('THESPORTSDB_KEY') || '').trim()
          }
        } catch (_) {}
      }
      if (!tsdbKey) {
        tsdbKey = '3'
      }

      var fetchBadge = function (teamName) {
        if (!teamName) return ''
        var cleanKey = teamName.toLowerCase().trim()
        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey] !== undefined
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey] || ''
        }

        try {
          var res = $http.send({
            url:
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(tsdbKey) +
              '/searchteams.php?t=' +
              encodeURIComponent(teamName),
            method: 'GET',
            timeout: 4,
          })

          var badgeUrl = ''
          if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.teams) &&
            res.json.teams.length > 0
          ) {
            var teamObj = res.json.teams[0]
            badgeUrl = (teamObj.strBadge || teamObj.strTeamBadge || teamObj.strLogo || '').trim()
          } else if (res && res.statusCode !== 200) {
            console.log(
              '[TSDB Escudo] HTTP ' +
                res.statusCode +
                ' para ' +
                teamName +
                ' (ignorado silenciosamente)',
            )
          }

          if (typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
            globalThis.__tsdbBadgeCache[cleanKey] = badgeUrl
          }
          return badgeUrl
        } catch (errSearch) {
          console.log('[TSDB Escudo] Erro na busca por ' + teamName + ':', errSearch)
          return ''
        }
      }

      if (!logoCasa && timeCasa) {
        var foundCasa = fetchBadge(timeCasa)
        if (foundCasa) {
          rec.set('logo_casa', foundCasa)
        }
      }

      if (!logoVis && timeVis) {
        var foundVis = fetchBadge(timeVis)
        if (foundVis) {
          rec.set('logo_visitante', foundVis)
        }
      }
    }
  } catch (errBadge) {
    console.log('[TSDB Escudo onRecordCreate] Aviso:', errBadge)
  }

  e.next()
}, 'jogos_do_dia_manuais')

onRecordUpdate((e) => {
  var rec = e.record

  // Invalidação imediata do cache em memória do servidor
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
    }
  } catch (_) {}

  // Autocompletar escudos no TheSportsDB se não informados
  try {
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    var timeCasa = (rec.getString('time_casa') || '').trim()
    var timeVis = (rec.getString('time_visitante') || '').trim()

    if (!logoCasa || !logoVis) {
      if (typeof globalThis !== 'undefined' && !globalThis.__tsdbBadgeCache) {
        globalThis.__tsdbBadgeCache = {}
      }

      var tsdbKey = ''
      try {
        var cRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'thesportsdb_fallback')
        if (cRec) {
          tsdbKey = (cRec.getString('api_key') || '').trim()
        }
      } catch (_) {}

      if (!tsdbKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('THESPORTSDB_KEY')) {
            tsdbKey = ($secrets.get('THESPORTSDB_KEY') || '').trim()
          } else if ($os && $os.getenv) {
            tsdbKey = ($os.getenv('THESPORTSDB_KEY') || '').trim()
          }
        } catch (_) {}
      }
      if (!tsdbKey) {
        tsdbKey = '3'
      }

      var fetchBadge = function (teamName) {
        if (!teamName) return ''
        var cleanKey = teamName.toLowerCase().trim()
        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey] !== undefined
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey] || ''
        }

        try {
          var res = $http.send({
            url:
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(tsdbKey) +
              '/searchteams.php?t=' +
              encodeURIComponent(teamName),
            method: 'GET',
            timeout: 4,
          })

          var badgeUrl = ''
          if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.teams) &&
            res.json.teams.length > 0
          ) {
            var teamObj = res.json.teams[0]
            badgeUrl = (teamObj.strBadge || teamObj.strTeamBadge || teamObj.strLogo || '').trim()
          } else if (res && res.statusCode !== 200) {
            console.log(
              '[TSDB Escudo] HTTP ' +
                res.statusCode +
                ' para ' +
                teamName +
                ' (ignorado silenciosamente)',
            )
          }

          if (typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
            globalThis.__tsdbBadgeCache[cleanKey] = badgeUrl
          }
          return badgeUrl
        } catch (errSearch) {
          console.log('[TSDB Escudo] Erro na busca por ' + teamName + ':', errSearch)
          return ''
        }
      }

      if (!logoCasa && timeCasa) {
        var foundCasa = fetchBadge(timeCasa)
        if (foundCasa) {
          rec.set('logo_casa', foundCasa)
        }
      }

      if (!logoVis && timeVis) {
        var foundVis = fetchBadge(timeVis)
        if (foundVis) {
          rec.set('logo_visitante', foundVis)
        }
      }
    }
  } catch (errBadge) {
    console.log('[TSDB Escudo onRecordUpdate] Aviso:', errBadge)
  }

  e.next()
}, 'jogos_do_dia_manuais')

onRecordDelete((e) => {
  // Invalidação imediata do cache em memória do servidor
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
    }
  } catch (_) {}

  e.next()
}, 'jogos_do_dia_manuais')
