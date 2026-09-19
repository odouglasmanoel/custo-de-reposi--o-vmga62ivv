// -------------------------------------------------------------
// CIRCUIT BREAKER GLOBAL EM MEMÓRIA PARA API-FOOTBALL
// Evita requisições 429 em loop quando a cota diária estiver esgotada.
// Backoff padrão: 20 minutos. Permite 1 probe (half-open) após a janela.
// -------------------------------------------------------------
if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballCircuitBreaker) {
  globalThis.__apiFootballCircuitBreaker = {
    isBlocked: false,
    blockedUntil: 0,
    probing: false,
    reason: '',
  }
}

/**
 * Hook dedicado para busca dos detalhes/eventos de uma partida (API-Football com fallback Football-Data.org, TheSportsDB e Banco local).
 * Rota: GET /backend/v1/detalhes-partida
 * Parâmetros: fixture_id, time_a, time_b, data
 * Retorna: {
 *   fixtureId,
 *   events: Array<{
 *     time: { elapsed: number, extra: number | null },
 *     team: { id: string, name: string, logo: string },
 *     player: { id: string, name: string },
 *     assist: { id: string, name: string },
 *     type: 'Goal' | 'Card' | 'subst' | string,
 *     detail: 'Normal Goal' | 'Yellow Card' | 'Red Card' | 'Substitution 1' | string,
 *     comments: string | null
 *   }>,
 *   status: string
 * }
 */

routerAdd(
  'GET',
  '/backend/v1/detalhes-partida',
  (e) => {
    var API_FOOTBALL_BACKOFF_DURATION_MS = 60 * 60 * 1000 // 1 HORA

    var checkApiFootballCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballCircuitBreaker) {
        return { shouldSkip: false, isProbe: false }
      }
      var cb = globalThis.__apiFootballCircuitBreaker
      if (!cb.isBlocked) {
        return { shouldSkip: false, isProbe: false }
      }
      var now = Date.now()
      if (now < cb.blockedUntil) {
        return {
          shouldSkip: true,
          reason: cb.reason || 'Cota da API-Football esgotada (Circuit Breaker ativo)',
        }
      }
      if (!cb.probing) {
        cb.probing = true
        return { shouldSkip: false, isProbe: true }
      }
      return { shouldSkip: true, reason: 'Circuit Breaker em sondagem por outra requisição' }
    }

    var tripApiFootballCircuitBreaker = function (reason) {
      if (typeof globalThis === 'undefined') return
      if (!globalThis.__apiFootballCircuitBreaker) {
        globalThis.__apiFootballCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
      }
      var cb = globalThis.__apiFootballCircuitBreaker
      cb.isBlocked = true
      cb.blockedUntil = Date.now() + API_FOOTBALL_BACKOFF_DURATION_MS
      cb.probing = false
      cb.reason = reason || 'Rate limit / quota exceeded (429)'
      console.log(
        '[CircuitBreaker API-Football] TRIP ATIVADO por 60 minutos até ' +
          new Date(cb.blockedUntil).toISOString() +
          '. Motivo: ' +
          cb.reason,
      )
    }

    var resetApiFootballCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballCircuitBreaker) return
      var cb = globalThis.__apiFootballCircuitBreaker
      if (cb.isBlocked || cb.probing) {
        console.log('[CircuitBreaker API-Football] RESET: Conexão normalizada com resposta 200.')
      }
      cb.isBlocked = false
      cb.probing = false
      cb.blockedUntil = 0
      cb.reason = ''
    }

    var isRateLimitErrorHelper = function (statusCode, responseBody) {
      if (statusCode === 429) return true
      if (!responseBody) return false
      var strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch (_) {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      return (
        strBody.indexOf('100% used') !== -1 ||
        strBody.indexOf('100%') !== -1 ||
        strBody.indexOf('requests limit') !== -1 ||
        strBody.indexOf('quota') !== -1 ||
        strBody.indexOf('requests limit reached') !== -1 ||
        strBody.indexOf('request limit reached') !== -1 ||
        strBody.indexOf('rate limit') !== -1 ||
        strBody.indexOf('plan reached') !== -1 ||
        strBody.indexOf('too many requests') !== -1 ||
        strBody.indexOf('quota exceeded') !== -1 ||
        strBody.indexOf('exceeded the maximum') !== -1 ||
        strBody.indexOf('free-tier limit') !== -1
      )
    }

    try {
      var authRecord = e.auth
      if (!authRecord) {
        return e.json(401, { error: 'Usuário não autenticado' })
      }

      var fixtureIdParam = (e.request.url.query().get('fixture_id') || '').trim()
      var timeA = (e.request.url.query().get('time_a') || '').trim()
      var timeB = (e.request.url.query().get('time_b') || '').trim()
      var dataParam = (e.request.url.query().get('data') || '').trim()
      var statusParam = (e.request.url.query().get('status') || '').trim().toUpperCase()
      var forceRefresh = e.request.url.query().get('refresh') === '1'
      var isLiveParam =
        ['1H', '2H', 'HT', 'LIVE', 'ET', 'P', 'BT'].indexOf(statusParam) !== -1 ||
        e.request.url.query().get('isLive') === 'true' ||
        e.request.url.query().get('live') === '1'

      if (!fixtureIdParam && (!timeA || !timeB)) {
        return e.json(400, {
          error: 'Informe fixture_id ou time_a e time_b',
        })
      }

      var cacheKey = 'match_details_' + (fixtureIdParam || timeA + '_' + timeB + '_' + dataParam)
      if (!forceRefresh) {
        var cached = $app.store().get(cacheKey)
        if (cached && typeof cached === 'string') {
          try {
            var parsed = JSON.parse(cached)
            if (parsed && Array.isArray(parsed.events)) {
              var cachedAt = parsed.cachedAtMs || 0
              var nowMs = new Date().getTime()
              var cacheAgeSec = Math.floor((nowMs - cachedAt) / 1000)

              // Para partidas ao vivo, TTL estrito de 15 segundos
              // Para partidas finalizadas ou agendadas, aceita cache de até 1 hora
              var maxAgeSec = isLiveParam ? 15 : 3600
              if (cacheAgeSec < maxAgeSec) {
                return e.json(200, parsed)
              }
            }
          } catch (_) {}
        }
      }

      // 1. Recupera chaves de integração
      var apiKey = ''
      var footballDataKey = ''
      var theSportsDbKey = '3'

      try {
        var configRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
        if (configRec) {
          apiKey = (configRec.getString('api_key') || '').trim()
        }
      } catch (_) {}

      try {
        var fdRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'football_data_fallback',
        )
        if (fdRec) {
          var fKey = (fdRec.getString('api_key') || '').trim()
          if (fKey) footballDataKey = fKey
        }
      } catch (_) {}

      try {
        var tsdbRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'thesportsdb_fallback',
        )
        if (tsdbRec) {
          var k = (tsdbRec.getString('api_key') || '').trim()
          if (k) theSportsDbKey = k
        }
      } catch (_) {}

      if (!apiKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
            apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
          } else {
            apiKey = ($os.getenv('API_FOOTBALL_KEY') || '').trim()
          }
        } catch (_) {}
      }

      if (!footballDataKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('FOOTBALL_DATA_KEY')) {
            footballDataKey = ($secrets.get('FOOTBALL_DATA_KEY') || '').trim()
          } else {
            footballDataKey = ($os.getenv('FOOTBALL_DATA_KEY') || '').trim()
          }
        } catch (_) {}
      }

      if (!theSportsDbKey || theSportsDbKey === '3') {
        try {
          if ($secrets && $secrets.has && $secrets.has('THESPORTSDB_KEY')) {
            var tk = ($secrets.get('THESPORTSDB_KEY') || '').trim()
            if (tk) theSportsDbKey = tk
          } else {
            var tkEnv = ($os.getenv('THESPORTSDB_KEY') || '').trim()
            if (tkEnv) theSportsDbKey = tkEnv
          }
        } catch (_) {}
      }

      var resultEvents = []
      var providerUsed = 'none'

      var normalizeStr = function (str) {
        if (!str) return ''
        return str
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }

      var isDirectNumeric = /^\d+$/.test(fixtureIdParam)
      var isTsdbId =
        fixtureIdParam.indexOf('tsdb_') === 0 || fixtureIdParam.indexOf('thesportsdb_') === 0
      var rawTsdbEventId = isTsdbId ? fixtureIdParam.replace(/^tsdb_|^thesportsdb_/, '') : ''

      // 2. FONTE 1: Tenta API-Football por fixture ID se for ID numérico (e não estiver com circuit breaker bloqueado)
      var cbCheckDet = checkApiFootballCircuitBreaker()
      if (cbCheckDet.shouldSkip) {
        console.log(
          '[DetalhesPartida] Circuit breaker ativo — pulando API-Football para fixture ' +
            fixtureIdParam,
        )
      } else if (apiKey && isDirectNumeric) {
        try {
          var isRapid = apiKey.length > 40
          var url = isRapid
            ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?id=' +
              encodeURIComponent(fixtureIdParam)
            : 'https://v3.football.api-sports.io/fixtures?id=' + encodeURIComponent(fixtureIdParam)
          var headers = isRapid
            ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
            : { 'x-apisports-key': apiKey }

          var res = $http.send({
            url: url,
            method: 'GET',
            headers: headers,
            timeout: 8,
          })

          if (isRateLimitErrorHelper(res.statusCode, res.json || res.raw)) {
            tripApiFootballCircuitBreaker(
              'Rate limit 429 em detalhes-partida ao buscar fixture ' + fixtureIdParam,
            )
          } else if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.response) &&
            res.json.response.length > 0
          ) {
            resetApiFootballCircuitBreaker()
            var fixItem = res.json.response[0]
            if (fixItem && Array.isArray(fixItem.events) && fixItem.events.length > 0) {
              resultEvents = fixItem.events
              providerUsed = 'api_football'
            }
          }
        } catch (errApi) {
          console.log('[DetalhesPartida] Erro ao buscar /fixtures?id na API-Football:', errApi)
        }

        // Se ainda não trouxe events pelo /fixtures?id, tenta endpoint específico /fixtures/events?fixture={id} se CB não caiu
        var cbCheckDet2 = checkApiFootballCircuitBreaker()
        if (resultEvents.length === 0 && apiKey && !cbCheckDet2.shouldSkip) {
          try {
            var urlEvents = isRapid
              ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/events?fixture=' +
                encodeURIComponent(fixtureIdParam)
              : 'https://v3.football.api-sports.io/fixtures/events?fixture=' +
                encodeURIComponent(fixtureIdParam)

            var resEv = $http.send({
              url: urlEvents,
              method: 'GET',
              headers: headers,
              timeout: 7,
            })

            if (isRateLimitErrorHelper(resEv.statusCode, resEv.json || resEv.raw)) {
              tripApiFootballCircuitBreaker(
                'Rate limit 429 em detalhes-partida /fixtures/events para fixture ' +
                  fixtureIdParam,
              )
            } else if (
              resEv &&
              resEv.statusCode === 200 &&
              resEv.json &&
              Array.isArray(resEv.json.response) &&
              resEv.json.response.length > 0
            ) {
              resetApiFootballCircuitBreaker()
              resultEvents = resEv.json.response
              providerUsed = 'api_football_events'
            }
          } catch (errEvents) {
            console.log('[DetalhesPartida] Erro ao buscar /fixtures/events:', errEvents)
          }
        }
      }

      // 3. FONTE 2: Fallback Football-Data.org (por ID numérico ou busca por data e times)
      if (resultEvents.length === 0 && footballDataKey) {
        try {
          var fdMatchData = null
          // Se o fixtureIdParam for numérico e coincidir com ID do Football-Data
          if (isDirectNumeric) {
            try {
              var resFdDirect = $http.send({
                url:
                  'https://api.football-data.org/v4/matches/' + encodeURIComponent(fixtureIdParam),
                method: 'GET',
                headers: { 'X-Auth-Token': footballDataKey },
                timeout: 7,
              })
              if (resFdDirect && resFdDirect.statusCode === 200 && resFdDirect.json) {
                fdMatchData = resFdDirect.json
              }
            } catch (_) {}
          }

          // Se não encontrou por ID numérico direto, busca por data e nomes dos times
          if (!fdMatchData && (timeA || timeB) && dataParam) {
            try {
              var resFdDay = $http.send({
                url:
                  'https://api.football-data.org/v4/matches?dateFrom=' +
                  encodeURIComponent(dataParam) +
                  '&dateTo=' +
                  encodeURIComponent(dataParam),
                method: 'GET',
                headers: { 'X-Auth-Token': footballDataKey },
                timeout: 7,
              })

              if (
                resFdDay &&
                resFdDay.statusCode === 200 &&
                resFdDay.json &&
                Array.isArray(resFdDay.json.matches)
              ) {
                var fdMatches = resFdDay.json.matches
                var nHome = normalizeStr(timeA)
                var nAway = normalizeStr(timeB)
                for (var fdi = 0; fdi < fdMatches.length; fdi++) {
                  var fdm = fdMatches[fdi]
                  var mH = normalizeStr(
                    (fdm.homeTeam && (fdm.homeTeam.name || fdm.homeTeam.shortName)) || '',
                  )
                  var mA = normalizeStr(
                    (fdm.awayTeam && (fdm.awayTeam.name || fdm.awayTeam.shortName)) || '',
                  )
                  var directMatch =
                    (mH.indexOf(nHome) !== -1 || nHome.indexOf(mH) !== -1) &&
                    (mA.indexOf(nAway) !== -1 || nAway.indexOf(mA) !== -1)
                  var invMatch =
                    (mH.indexOf(nAway) !== -1 || nAway.indexOf(mH) !== -1) &&
                    (mA.indexOf(nHome) !== -1 || nHome.indexOf(mA) !== -1)
                  if (directMatch || invMatch) {
                    fdMatchData = fdm
                    break
                  }
                }
              }
            } catch (errFdDay) {
              console.log('[DetalhesPartida] Erro ao buscar Football-Data por data:', errFdDay)
            }
          }

          if (fdMatchData) {
            // Se encontrou a partida no Football-Data mas não veio goals detalhado, consulta GET /matches/{id}
            if (
              (!Array.isArray(fdMatchData.goals) || fdMatchData.goals.length === 0) &&
              fdMatchData.id
            ) {
              try {
                var resSingleFd = $http.send({
                  url:
                    'https://api.football-data.org/v4/matches/' +
                    encodeURIComponent(fdMatchData.id),
                  method: 'GET',
                  headers: { 'X-Auth-Token': footballDataKey },
                  timeout: 7,
                })
                if (
                  resSingleFd &&
                  resSingleFd.statusCode === 200 &&
                  resSingleFd.json &&
                  Array.isArray(resSingleFd.json.goals)
                ) {
                  fdMatchData.goals = resSingleFd.json.goals
                }
              } catch (_) {}
            }

            // Converte gols do Football-Data para o formato unificado de events
            if (Array.isArray(fdMatchData.goals) && fdMatchData.goals.length > 0) {
              for (var gi = 0; gi < fdMatchData.goals.length; gi++) {
                var fdGoal = fdMatchData.goals[gi]
                var pScorer =
                  (fdGoal.scorer && (fdGoal.scorer.name || fdGoal.scorer.shortName)) || ''
                var pAssist =
                  (fdGoal.assist && (fdGoal.assist.name || fdGoal.assist.shortName)) || ''
                var isOwn = (fdGoal.type || '').toUpperCase() === 'OWN'
                var isPen = (fdGoal.type || '').toUpperCase() === 'PENALTY'
                var gDetail = isOwn ? 'Own Goal' : isPen ? 'Penalty' : 'Normal Goal'

                resultEvents.push({
                  time: { elapsed: fdGoal.minute || 0, extra: fdGoal.extraTime || null },
                  team: {
                    id: fdGoal.team ? String(fdGoal.team.id) : '',
                    name: (fdGoal.team && (fdGoal.team.name || fdGoal.team.shortName)) || '',
                    logo: '',
                  },
                  player: {
                    id: fdGoal.scorer ? String(fdGoal.scorer.id) : '',
                    name: pScorer,
                  },
                  assist: {
                    id: fdGoal.assist ? String(fdGoal.assist.id) : '',
                    name: pAssist,
                  },
                  type: 'Goal',
                  detail: gDetail,
                  comments: null,
                })
              }
              providerUsed = 'football_data'
            }
          }
        } catch (errFd) {
          console.log('[DetalhesPartida] Erro ao buscar Football-Data.org:', errFd)
        }
      }

      // 4. FONTE 3: Fallback TheSportsDB por ID de evento (lookuptimeline.php / lookupevent.php)
      if (resultEvents.length === 0 && (rawTsdbEventId || isTsdbId)) {
        try {
          var evId = rawTsdbEventId || fixtureIdParam.replace(/\D/g, '')
          if (evId) {
            var tsdbTimelineUrl =
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(theSportsDbKey) +
              '/lookuptimeline.php?id=' +
              encodeURIComponent(evId)

            var resTl = $http.send({
              url: tsdbTimelineUrl,
              method: 'GET',
              timeout: 7,
            })

            if (
              resTl &&
              resTl.statusCode === 200 &&
              resTl.json &&
              Array.isArray(resTl.json.timeline) &&
              resTl.json.timeline.length > 0
            ) {
              var tlList = resTl.json.timeline
              for (var ti = 0; ti < tlList.length; ti++) {
                var itemTl = tlList[ti]
                var rawType = String(itemTl.strTimeline || itemTl.strType || '').toLowerCase()
                var rawDetail = String(itemTl.strTimelineDetail || '').toLowerCase()
                var rawPlayer = (itemTl.strPlayer || '').trim()
                var rawAssist = (itemTl.strAssist || '').trim()
                var minute = itemTl.intTime ? parseInt(itemTl.intTime, 10) : 0

                var normType = 'Goal'
                var normDetail = itemTl.strTimelineDetail || 'Normal Goal'

                if (
                  rawType.indexOf('card') !== -1 ||
                  rawDetail.indexOf('card') !== -1 ||
                  rawDetail.indexOf('yellow') !== -1 ||
                  rawDetail.indexOf('red') !== -1
                ) {
                  normType = 'Card'
                  if (rawDetail.indexOf('yellow') !== -1) {
                    normDetail = 'Yellow Card'
                  } else if (rawDetail.indexOf('red') !== -1) {
                    normDetail = 'Red Card'
                  }
                } else if (rawType.indexOf('sub') !== -1 || rawDetail.indexOf('sub') !== -1) {
                  normType = 'subst'
                  normDetail = 'Substitution'
                } else if (rawType.indexOf('goal') !== -1 || rawDetail.indexOf('goal') !== -1) {
                  normType = 'Goal'
                  if (rawDetail.indexOf('own') !== -1 || rawDetail.indexOf('contra') !== -1) {
                    normDetail = 'Own Goal'
                  } else if (rawDetail.indexOf('penal') !== -1) {
                    normDetail = 'Penalty'
                  } else {
                    normDetail = 'Normal Goal'
                  }
                }

                resultEvents.push({
                  time: { elapsed: minute, extra: null },
                  team: {
                    id: itemTl.idTeam ? String(itemTl.idTeam) : '',
                    name: itemTl.strTeam || '',
                    logo: '',
                  },
                  player: { id: itemTl.idPlayer ? String(itemTl.idPlayer) : '', name: rawPlayer },
                  assist: { id: '', name: rawAssist },
                  type: normType,
                  detail: normDetail,
                  comments: null,
                })
              }
              providerUsed = 'thesportsdb_timeline'
            }
          }
        } catch (errTsdbTl) {
          console.log('[DetalhesPartida] Erro ao buscar TheSportsDB timeline:', errTsdbTl)
        }
      }

      // 5. FONTE 4: Se ainda sem eventos e temos nomes de times, busca evento no TheSportsDB por data
      if (resultEvents.length === 0 && (timeA || timeB) && dataParam) {
        try {
          var dateQueryUrl =
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(theSportsDbKey) +
            '/eventsday.php?d=' +
            encodeURIComponent(dataParam) +
            '&s=Soccer'

          var resDay = $http.send({
            url: dateQueryUrl,
            method: 'GET',
            timeout: 7,
          })

          if (
            resDay &&
            resDay.statusCode === 200 &&
            resDay.json &&
            Array.isArray(resDay.json.events)
          ) {
            var dayEvs = resDay.json.events
            var matchedEvent = null
            var nA = normalizeStr(timeA)
            var nB = normalizeStr(timeB)

            for (var di = 0; di < dayEvs.length; di++) {
              var dev = dayEvs[di]
              var devHome = normalizeStr(dev.strHomeTeam || '')
              var devAway = normalizeStr(dev.strAwayTeam || '')
              var matchDirect =
                (devHome.indexOf(nA) !== -1 || nA.indexOf(devHome) !== -1) &&
                (devAway.indexOf(nB) !== -1 || nB.indexOf(devAway) !== -1)
              var matchInv =
                (devHome.indexOf(nB) !== -1 || nB.indexOf(devHome) !== -1) &&
                (devAway.indexOf(nA) !== -1 || nA.indexOf(devAway) !== -1)

              if (matchDirect || matchInv) {
                matchedEvent = dev
                break
              }
            }

            if (matchedEvent && matchedEvent.idEvent) {
              // Busca timeline pelo idEvent localizado
              var tlMatchUrl =
                'https://www.thesportsdb.com/api/v1/json/' +
                encodeURIComponent(theSportsDbKey) +
                '/lookuptimeline.php?id=' +
                encodeURIComponent(matchedEvent.idEvent)

              var resTlMatch = $http.send({
                url: tlMatchUrl,
                method: 'GET',
                timeout: 7,
              })

              if (
                resTlMatch &&
                resTlMatch.statusCode === 200 &&
                resTlMatch.json &&
                Array.isArray(resTlMatch.json.timeline) &&
                resTlMatch.json.timeline.length > 0
              ) {
                var listMatch = resTlMatch.json.timeline
                for (var mi = 0; mi < listMatch.length; mi++) {
                  var itemM = listMatch[mi]
                  var rType = String(itemM.strTimeline || itemM.strType || '').toLowerCase()
                  var rDetail = String(itemM.strTimelineDetail || '').toLowerCase()
                  var minM = itemM.intTime ? parseInt(itemM.intTime, 10) : 0

                  var mType = 'Goal'
                  var mDetail = itemM.strTimelineDetail || 'Normal Goal'

                  if (
                    rType.indexOf('card') !== -1 ||
                    rDetail.indexOf('card') !== -1 ||
                    rDetail.indexOf('yellow') !== -1 ||
                    rDetail.indexOf('red') !== -1
                  ) {
                    mType = 'Card'
                    mDetail = rDetail.indexOf('yellow') !== -1 ? 'Yellow Card' : 'Red Card'
                  } else if (rType.indexOf('sub') !== -1 || rDetail.indexOf('sub') !== -1) {
                    mType = 'subst'
                    mDetail = 'Substitution'
                  } else if (rType.indexOf('goal') !== -1 || rDetail.indexOf('goal') !== -1) {
                    mType = 'Goal'
                    mDetail =
                      rDetail.indexOf('own') !== -1 || rDetail.indexOf('contra') !== -1
                        ? 'Own Goal'
                        : 'Normal Goal'
                  }

                  resultEvents.push({
                    time: { elapsed: minM, extra: null },
                    team: {
                      id: itemM.idTeam ? String(itemM.idTeam) : '',
                      name: itemM.strTeam || '',
                      logo: '',
                    },
                    player: {
                      id: itemM.idPlayer ? String(itemM.idPlayer) : '',
                      name: (itemM.strPlayer || '').trim(),
                    },
                    assist: { id: '', name: (itemM.strAssist || '').trim() },
                    type: mType,
                    detail: mDetail,
                    comments: null,
                  })
                }
                providerUsed = 'thesportsdb_event_timeline'
              }
            }
          }
        } catch (errSearchDay) {
          console.log('[DetalhesPartida] Erro ao buscar TheSportsDB por data/times:', errSearchDay)
        }
      }

      // 6. FONTE 5: Fallback no Banco de Dados local (coleção 'jogos' - gols cadastrados manualmente ou importados)
      if (resultEvents.length === 0 && (timeA || timeB)) {
        try {
          var localGame = null
          if (fixtureIdParam) {
            try {
              localGame = $app.findFirstRecordByData('jogos', 'fixture_id', fixtureIdParam)
            } catch (_) {}
          }
          if (!localGame && timeA && timeB) {
            try {
              var records = $app.findRecordsByFilter(
                'jogos',
                "time_a ~ '" +
                  timeA.replace(/'/g, "\\'") +
                  "' || time_b ~ '" +
                  timeB.replace(/'/g, "\\'") +
                  "'",
                '-created',
                5,
                0,
              )
              if (Array.isArray(records)) {
                var targetHomeClean = normalizeStr(timeA)
                var targetAwayClean = normalizeStr(timeB)
                for (var ri = 0; ri < records.length; ri++) {
                  var r = records[ri]
                  var rHA = normalizeStr(r.getString('time_a') || '')
                  var rAA = normalizeStr(r.getString('time_b') || '')
                  if (
                    (rHA.indexOf(targetHomeClean) !== -1 || targetHomeClean.indexOf(rHA) !== -1) &&
                    (rAA.indexOf(targetAwayClean) !== -1 || targetAwayClean.indexOf(rAA) !== -1)
                  ) {
                    localGame = r
                    break
                  }
                }
              }
            } catch (_) {}
          }

          if (localGame) {
            var rawGolsA = localGame.get('gols_time_a')
            var rawGolsB = localGame.get('gols_time_b')
            var nameTimeA = localGame.getString('time_a') || timeA || 'Mandante'
            var nameTimeB = localGame.getString('time_b') || timeB || 'Visitante'

            var parseLocalScorers = function (golsData, sideName) {
              if (!golsData) return
              var list = []
              if (Array.isArray(golsData)) {
                list = golsData
              } else if (typeof golsData === 'string' && golsData.trim()) {
                try {
                  var parsedJson = JSON.parse(golsData)
                  if (Array.isArray(parsedJson)) list = parsedJson
                  else list = [golsData]
                } catch (_) {
                  list = [golsData]
                }
              }

              for (var li = 0; li < list.length; li++) {
                var sc = list[li]
                var scName = ''
                var scMin = null
                if (typeof sc === 'string') {
                  scName = sc.trim()
                } else if (sc && typeof sc === 'object') {
                  scName = (sc.name || sc.jogador || '').trim()
                  scMin = sc.minuto != null ? parseInt(sc.minuto, 10) : null
                }
                if (scName) {
                  resultEvents.push({
                    time: { elapsed: scMin, extra: null },
                    team: { id: '', name: sideName, logo: '' },
                    player: { id: '', name: scName },
                    assist: { id: '', name: '' },
                    type: 'Goal',
                    detail: 'Normal Goal',
                    comments: null,
                  })
                }
              }
            }

            parseLocalScorers(rawGolsA, nameTimeA)
            parseLocalScorers(rawGolsB, nameTimeB)

            if (resultEvents.length > 0) {
              providerUsed = 'local_database'
            }
          }
        } catch (errDb) {
          console.log('[DetalhesPartida] Erro ao buscar banco local:', errDb)
        }
      }

      // Ordenar eventos por minuto decorrido
      resultEvents.sort(function (a, b) {
        var minA = (a.time && a.time.elapsed) || 0
        var minB = (b.time && b.time.elapsed) || 0
        return minA - minB
      })

      var payloadResult = {
        fixtureId: fixtureIdParam,
        provider: providerUsed,
        events: resultEvents,
        total: resultEvents.length,
        isLive: isLiveParam,
        cachedAtMs: new Date().getTime(),
        updatedAt: new Date().toISOString(),
      }

      // Salva no cache com TTL: 15s para partidas ao vivo, 1h para outras
      try {
        $app.store().set(cacheKey, JSON.stringify(payloadResult))
      } catch (_) {}

      return e.json(200, payloadResult)
    } catch (generalErr) {
      console.log('[DetalhesPartida] Erro geral:', generalErr)
      return e.json(500, {
        error: generalErr ? generalErr.message : 'Erro interno ao consultar detalhes da partida',
      })
    }
  },
  $apis.requireAuth(),
)
