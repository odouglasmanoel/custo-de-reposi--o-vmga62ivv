/**
 * Hook dedicado para busca de escalações (lineups) de partidas (API-Football com fallback TheSportsDB).
 * Permite buscar por fixture_id ou por data + nomes dos times.
 * Retorna status: 'confirmada' | 'provavel' | 'indisponivel'.
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

      var jogoId = (e.request.url.query().get('jogo_id') || '').trim()
      var fixtureIdParam = (e.request.url.query().get('fixture_id') || '').trim()
      var timeA = (e.request.url.query().get('time_a') || '').trim()
      var timeB = (e.request.url.query().get('time_b') || '').trim()
      var dataParam = (e.request.url.query().get('data') || '').trim()

      var targetGame = null
      if (jogoId) {
        try {
          targetGame = $app.findRecordById('jogos', jogoId)
        } catch (_) {}
      }

      if (targetGame) {
        if (!fixtureIdParam) fixtureIdParam = (targetGame.getString('fixture_id') || '').trim()
        if (!timeA) timeA = (targetGame.getString('time_a') || '').trim()
        if (!timeB) timeB = (targetGame.getString('time_b') || '').trim()
        if (!dataParam) {
          var rawData = targetGame.getString('data') || ''
          dataParam = rawData.slice(0, 10)
        }
      }

      if (!fixtureIdParam && (!timeA || !timeB)) {
        return e.json(400, {
          error: 'Informe jogo_id, fixture_id ou time_a e time_b',
        })
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

      var result = null

      // Função auxiliar de limpeza de nome
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

      // 2. Se for fixture_id numérico direto da API-Football
      var isDirectNumeric = /^\d+$/.test(fixtureIdParam)
      var isTsdbId =
        fixtureIdParam.indexOf('tsdb_') === 0 || fixtureIdParam.indexOf('thesportsdb_') === 0
      var rawTsdbEventId = isTsdbId ? fixtureIdParam.replace(/^tsdb_|^thesportsdb_/, '') : ''

      // Tenta buscar no API-Football se tiver chave e for ID numérico direto
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

      // 3. Fallback TheSportsDB lookuplineup.php se tiver ID de evento do TSDB ou se API-Football não retornou
      if (!result && (rawTsdbEventId || isTsdbId)) {
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

                // Determina lado
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

      // 4. Se ainda não há escalação confirmada e temos nomes de times, tenta buscar o elenco/jogadores disponíveis (Prováveis / Elenco)
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

      // 5. Se nenhuma fonte retornou dados, retorna status indisponivel de forma elegante
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
