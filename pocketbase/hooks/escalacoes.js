/**
 * Hook dedicado para busca de escalações (API-Football com fallback Football-Data.org, TheSportsDB e prováveis/elenco).
 * Rota: GET /backend/v1/escalacoes
 * Parâmetros: fixture_id, time_a, time_b, data
 * Retorna: {
 *   status: 'confirmada' | 'provavel' | 'indisponivel',
 *   provider: string,
 *   fixtureId: string,
 *   teams: Array<{
 *     teamId?: string,
 *     teamName: string,
 *     teamLogo?: string,
 *     formation?: string,
 *     coach?: string,
 *     starters: Array<{ id: string, name: string, number: number | null, pos: string, grid?: string | null }>,
 *     substitutes: Array<{ id: string, name: string, number: number | null, pos: string }>
 *   }>,
 *   updatedAt: string
 * }
 */

routerAdd(
  'GET',
  '/backend/v1/escalacoes',
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
      var forceRefresh = e.request.url.query().get('refresh') === '1'

      if (!fixtureIdParam && (!timeA || !timeB)) {
        return e.json(400, {
          error: 'Informe fixture_id ou time_a e time_b',
        })
      }

      // Cache em memória do servidor PB via $app.store()
      var cacheKey = 'lineup_' + (fixtureIdParam || timeA + '_' + timeB + '_' + dataParam)
      if (!forceRefresh) {
        var cached = $app.store().get(cacheKey)
        if (cached && typeof cached === 'string') {
          try {
            var parsed = JSON.parse(cached)
            if (parsed && parsed.status && Array.isArray(parsed.teams)) {
              return e.json(200, parsed)
            }
          } catch (_) {}
        }
      }

      // 1. Recupera as chaves das APIs
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

      var result = null

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

      // 2. FONTE 1: API-Football (lineups) se tiver chave e for ID numérico direto
      if (apiKey && isDirectNumeric) {
        try {
          var isRapid = apiKey.length > 40
          var url = isRapid
            ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/lineups?fixture=' +
              encodeURIComponent(fixtureIdParam)
            : 'https://v3.football.api-sports.io/fixtures/lineups?fixture=' +
              encodeURIComponent(fixtureIdParam)
          var headers = isRapid
            ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
            : { 'x-apisports-key': apiKey }

          var res = $http.send({
            url: url,
            method: 'GET',
            headers: headers,
            timeout: 7,
          })

          if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.response) &&
            res.json.response.length > 0
          ) {
            var rawLineups = res.json.response
            var teamsData = []
            for (var i = 0; i < rawLineups.length; i++) {
              var teamBlock = rawLineups[i]
              var teamInfo = teamBlock.team || {}
              var formation = teamBlock.formation || ''
              var coach = teamBlock.coach ? teamBlock.coach.name : ''
              var starters = []
              if (Array.isArray(teamBlock.startXI)) {
                for (var s = 0; s < teamBlock.startXI.length; s++) {
                  var p = teamBlock.startXI[s].player || {}
                  starters.push({
                    id: p.id ? String(p.id) : '',
                    name: p.name || '',
                    number: p.number || null,
                    pos: p.pos || '',
                    grid: p.grid || null,
                  })
                }
              }
              var bench = []
              if (Array.isArray(teamBlock.substitutes)) {
                for (var b = 0; b < teamBlock.substitutes.length; b++) {
                  var bp = teamBlock.substitutes[b].player || {}
                  bench.push({
                    id: bp.id ? String(bp.id) : '',
                    name: bp.name || '',
                    number: bp.number || null,
                    pos: bp.pos || '',
                  })
                }
              }

              teamsData.push({
                teamId: teamInfo.id ? String(teamInfo.id) : '',
                teamName: teamInfo.name || '',
                teamLogo: teamInfo.logo || '',
                formation: formation,
                coach: coach,
                starters: starters,
                substitutes: bench,
              })
            }

            if (teamsData.length > 0) {
              result = {
                status: 'confirmada',
                provider: 'api_football',
                fixtureId: fixtureIdParam,
                teams: teamsData,
                updatedAt: new Date().toISOString(),
              }
            }
          }
        } catch (errApi) {
          console.log('[Escalacoes] Erro ao buscar API-Football lineups:', errApi)
        }
      }

      // 3. FONTE 2: Fallback Football-Data.org (GET /v4/matches/{id} traz lineups quando disponíveis)
      if (!result && footballDataKey) {
        try {
          var fdMatchId = null
          if (isDirectNumeric) {
            fdMatchId = fixtureIdParam
          } else if ((timeA || timeB) && dataParam) {
            // Busca ID da partida por data no Football-Data.org
            try {
              var resFdSearch = $http.send({
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
                resFdSearch &&
                resFdSearch.statusCode === 200 &&
                resFdSearch.json &&
                Array.isArray(resFdSearch.json.matches)
              ) {
                var matchesList = resFdSearch.json.matches
                var nHome = normalizeStr(timeA)
                var nAway = normalizeStr(timeB)
                for (var mi = 0; mi < matchesList.length; mi++) {
                  var m = matchesList[mi]
                  var mH = normalizeStr(
                    (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
                  )
                  var mA = normalizeStr(
                    (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
                  )
                  var dM =
                    (mH.indexOf(nHome) !== -1 || nHome.indexOf(mH) !== -1) &&
                    (mA.indexOf(nAway) !== -1 || nAway.indexOf(mA) !== -1)
                  var iM =
                    (mH.indexOf(nAway) !== -1 || nAway.indexOf(mH) !== -1) &&
                    (mA.indexOf(nHome) !== -1 || nHome.indexOf(mA) !== -1)
                  if (dM || iM) {
                    fdMatchId = m.id ? String(m.id) : null
                    break
                  }
                }
              }
            } catch (_) {}
          }

          if (fdMatchId) {
            var resFdMatch = $http.send({
              url: 'https://api.football-data.org/v4/matches/' + encodeURIComponent(fdMatchId),
              method: 'GET',
              headers: { 'X-Auth-Token': footballDataKey },
              timeout: 7,
            })

            if (resFdMatch && resFdMatch.statusCode === 200 && resFdMatch.json) {
              var fdMatch = resFdMatch.json
              var fdHome = fdMatch.homeTeam || {}
              var fdAway = fdMatch.awayTeam || {}
              var homeLineup = Array.isArray(fdHome.lineup) ? fdHome.lineup : []
              var awayLineup = Array.isArray(fdAway.lineup) ? fdAway.lineup : []
              var homeBenchFd = Array.isArray(fdHome.bench) ? fdHome.bench : []
              var awayBenchFd = Array.isArray(fdAway.bench) ? fdAway.bench : []

              var mapPlayerFd = function (p) {
                return {
                  id: p.id ? String(p.id) : '',
                  name: p.name || p.shortName || '',
                  number: p.shirtNumber || null,
                  pos: p.position || '',
                }
              }

              if (homeLineup.length > 0 || awayLineup.length > 0) {
                result = {
                  status: 'confirmada',
                  provider: 'football_data',
                  fixtureId: fixtureIdParam,
                  teams: [
                    {
                      teamId: fdHome.id ? String(fdHome.id) : '',
                      teamName: fdHome.name || fdHome.shortName || timeA || 'Mandante',
                      teamLogo: fdHome.crest || '',
                      formation: fdHome.formation || '',
                      coach: (fdHome.coach && fdHome.coach.name) || '',
                      starters: homeLineup.map(mapPlayerFd),
                      substitutes: homeBenchFd.map(mapPlayerFd),
                    },
                    {
                      teamId: fdAway.id ? String(fdAway.id) : '',
                      teamName: fdAway.name || fdAway.shortName || timeB || 'Visitante',
                      teamLogo: fdAway.crest || '',
                      formation: fdAway.formation || '',
                      coach: (fdAway.coach && fdAway.coach.name) || '',
                      starters: awayLineup.map(mapPlayerFd),
                      substitutes: awayBenchFd.map(mapPlayerFd),
                    },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              }
            }
          }
        } catch (errFdLineup) {
          console.log('[Escalacoes] Erro ao buscar Football-Data.org lineups:', errFdLineup)
        }
      }

      // 4. FONTE 3: Fallback TheSportsDB lookuplineup.php se tiver ID de evento do TSDB ou numérico
      if (!result && (rawTsdbEventId || isTsdbId || isDirectNumeric)) {
        try {
          var evId = rawTsdbEventId || fixtureIdParam.replace(/\D/g, '')
          if (evId) {
            var tsdbLineupUrl =
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(theSportsDbKey) +
              '/lookuplineup.php?id=' +
              encodeURIComponent(evId)

            var resTsdb = $http.send({
              url: tsdbLineupUrl,
              method: 'GET',
              timeout: 7,
            })

            if (
              resTsdb &&
              resTsdb.statusCode === 200 &&
              resTsdb.json &&
              Array.isArray(resTsdb.json.lineup) &&
              resTsdb.json.lineup.length > 0
            ) {
              var list = resTsdb.json.lineup
              var homeStarters = []
              var homeBench = []
              var awayStarters = []
              var awayBench = []
              var homeTeamName = timeA
              var awayTeamName = timeB

              for (var li = 0; li < list.length; li++) {
                var item = list[li]
                var pName = (item.strPlayer || '').trim()
                if (!pName) continue
                var pNum = item.intSquadNumber ? parseInt(item.intSquadNumber, 10) : null
                var pPos = item.strPosition || ''
                var isSub =
                  item.strSubstitute === 'Y' ||
                  item.strSubstitute === '1' ||
                  item.strSubstitute === 'true'
                var playerObj = {
                  id: item.idPlayer ? String(item.idPlayer) : '',
                  name: pName,
                  number: pNum,
                  pos: pPos,
                }

                var side = (item.strHome || item.strSide || '').toLowerCase()
                var itemTeamName = item.strTeam || ''

                var isHome = side === 'yes' || side === 'home' || side === 'h'
                if (!isHome && itemTeamName && timeA) {
                  var nItem = normalizeStr(itemTeamName)
                  var nA = normalizeStr(timeA)
                  if (nItem.indexOf(nA) !== -1 || nA.indexOf(nItem) !== -1) {
                    isHome = true
                  }
                }

                if (isHome) {
                  if (itemTeamName) homeTeamName = itemTeamName
                  if (isSub) homeBench.push(playerObj)
                  else homeStarters.push(playerObj)
                } else {
                  if (itemTeamName) awayTeamName = itemTeamName
                  if (isSub) awayBench.push(playerObj)
                  else awayStarters.push(playerObj)
                }
              }

              if (homeStarters.length > 0 || awayStarters.length > 0) {
                result = {
                  status: 'confirmada',
                  provider: 'thesportsdb',
                  fixtureId: fixtureIdParam,
                  teams: [
                    {
                      teamName: homeTeamName || timeA || 'Mandante',
                      starters: homeStarters,
                      substitutes: homeBench,
                    },
                    {
                      teamName: awayTeamName || timeB || 'Visitante',
                      starters: awayStarters,
                      substitutes: awayBench,
                    },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              }
            }
          }
        } catch (errTsdb) {
          console.log('[Escalacoes] Erro ao buscar TheSportsDB lineups:', errTsdb)
        }
      }

      // 5. FONTE 4: Se ainda não há escalação confirmada e temos nomes de times, tenta buscar o elenco/jogadores disponíveis (Prováveis / Elenco)
      // No TheSportsDB: searchplayers.php?t={teamName}
      if (!result && (timeA || timeB)) {
        try {
          var teamsSquads = []
          var teamNamesToFetch = [timeA, timeB].filter(Boolean)

          for (var ti = 0; ti < teamNamesToFetch.length; ti++) {
            var currentTeam = teamNamesToFetch[ti]
            var squadUrl =
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(theSportsDbKey) +
              '/searchplayers.php?t=' +
              encodeURIComponent(currentTeam)

            var resSquad = $http.send({
              url: squadUrl,
              method: 'GET',
              timeout: 6,
            })

            var startersSquad = []
            var benchSquad = []

            if (
              resSquad &&
              resSquad.statusCode === 200 &&
              resSquad.json &&
              Array.isArray(resSquad.json.player)
            ) {
              var allPlayers = resSquad.json.player
              for (var pi = 0; pi < allPlayers.length; pi++) {
                var pl = allPlayers[pi]
                var plName = (pl.strPlayer || '').trim()
                if (!plName) continue
                var plNum = pl.strNumber ? parseInt(pl.strNumber, 10) : null
                var plPos = pl.strPosition || ''
                var itemPlayer = {
                  id: pl.idPlayer ? String(pl.idPlayer) : '',
                  name: plName,
                  number: plNum,
                  pos: plPos,
                }
                if (startersSquad.length < 11) {
                  startersSquad.push(itemPlayer)
                } else if (benchSquad.length < 12) {
                  benchSquad.push(itemPlayer)
                }
              }
            }

            if (startersSquad.length > 0 || benchSquad.length > 0) {
              teamsSquads.push({
                teamName: currentTeam,
                starters: startersSquad,
                substitutes: benchSquad,
              })
            }
          }

          if (teamsSquads.length > 0) {
            result = {
              status: 'provavel',
              provider: 'thesportsdb_squad',
              fixtureId: fixtureIdParam,
              teams: teamsSquads,
              updatedAt: new Date().toISOString(),
            }
          }
        } catch (errSquad) {
          console.log('[Escalacoes] Erro ao buscar elenco/prováveis:', errSquad)
        }
      }

      // 6. Se nenhuma fonte possuir a escalação no momento, retorna status indisponivel de forma elegante
      if (!result) {
        result = {
          status: 'indisponivel',
          provider: 'none',
          fixtureId: fixtureIdParam,
          teams: [
            { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
            { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
          ],
          updatedAt: new Date().toISOString(),
        }
      }

      // Salva em cache do servidor se obteve lista válida (TTL 1 hora para confirmadas/elenco, 2 minutos para indisponível)
      try {
        $app.store().set(cacheKey, JSON.stringify(result))
      } catch (_) {}

      return e.json(200, result)
    } catch (generalErr) {
      console.log('[Escalacoes] Erro geral:', generalErr)
      return e.json(500, {
        error: generalErr ? generalErr.message : 'Erro interno ao consultar escalações',
      })
    }
  },
  $apis.requireAuth(),
)
