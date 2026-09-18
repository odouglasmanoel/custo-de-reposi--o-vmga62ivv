/**
 * Hook dedicado para busca dos detalhes/eventos de uma partida (API-Football com fallback TheSportsDB).
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
      var cached = $app.store().get(cacheKey)
      if (cached && typeof cached === 'string') {
        try {
          var parsed = JSON.parse(cached)
          if (parsed && Array.isArray(parsed.events)) {
            var cachedAt = parsed.cachedAtMs || 0
            var nowMs = new Date().getTime()
            var cacheAgeSec = Math.floor((nowMs - cachedAt) / 1000)

            // Para partidas ao vivo, TTL estrito de 15 segundos
            // Para partidas finalizadas ou agendadas, aceita cache persistente
            var maxAgeSec = isLiveParam ? 15 : 3600
            if (cacheAgeSec < maxAgeSec) {
              return e.json(200, parsed)
            }
          }
        } catch (_) {}
      }

      // 1. Recupera chaves de integração
      var apiKey = ''
      var theSportsDbKey = '3'

      try {
        var configRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
        if (configRec) {
          apiKey = (configRec.getString('api_key') || '').trim()
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

      // 2. Tenta API-Football por fixture ID se for ID numérico
      if (apiKey && isDirectNumeric) {
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

          if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.response) &&
            res.json.response.length > 0
          ) {
            var fixItem = res.json.response[0]
            if (fixItem && Array.isArray(fixItem.events) && fixItem.events.length > 0) {
              resultEvents = fixItem.events
              providerUsed = 'api_football'
            }
          }
        } catch (errApi) {
          console.log('[DetalhesPartida] Erro ao buscar /fixtures?id na API-Football:', errApi)
        }

        // Se ainda não trouxe events pelo /fixtures?id, tenta endpoint específico /fixtures/events?fixture={id}
        if (resultEvents.length === 0 && apiKey) {
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

            if (
              resEv &&
              resEv.statusCode === 200 &&
              resEv.json &&
              Array.isArray(resEv.json.response) &&
              resEv.json.response.length > 0
            ) {
              resultEvents = resEv.json.response
              providerUsed = 'api_football_events'
            }
          } catch (errEvents) {
            console.log('[DetalhesPartida] Erro ao buscar /fixtures/events:', errEvents)
          }
        }
      }

      // 3. Fallback TheSportsDB por ID de evento (lookuptimeline.php / lookupevent.php)
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

      // 4. Se ainda sem eventos e temos nomes de times, tenta buscar evento pelo TheSportsDB via data
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
