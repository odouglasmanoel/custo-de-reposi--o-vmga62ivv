/**
 * Hook dedicado para busca de jogos em intervalo de datas para Enquetes da Copa Coni.
 * Reutiliza os provedores esportivos (API-Football -> Football-Data.org -> TheSportsDB)
 * com cache em memória (TTL 30 min por data), deduplicação e filtragem das principais competições:
 * - Série A do Brasileirão
 * - Champions League
 * - Grandes da Europa (Premier League, La Liga, Serie A Itália, Bundesliga, Ligue 1)
 */

routerAdd(
  'GET',
  '/backend/v1/enquetes/buscar-jogos',
  (e) => {
    try {
      const authRecord = e.auth
      if (!authRecord) {
        return e.unauthorizedError('Usuário não autenticado')
      }

      // Coleta data_inicio e data_fim (formato YYYY-MM-DD)
      var dataInicio = (e.requestInfo().query.data_inicio || '').trim()
      var dataFim = (e.requestInfo().query.data_fim || '').trim()

      // Valida formato das datas
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return e.badRequestError(
          'Formato de data inválido. Use YYYY-MM-DD para data_inicio e data_fim.',
        )
      }

      if (dataInicio > dataFim) {
        return e.badRequestError('data_inicio não pode ser posterior a data_fim.')
      }

      // Limita intervalo a no máximo 14 dias para evitar estouro de chamadas
      var d1 = new Date(dataInicio + 'T00:00:00Z')
      var d2 = new Date(dataFim + 'T00:00:00Z')
      var diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24))
      if (diffDays > 14) {
        return e.badRequestError('O intervalo máximo permitido para busca é de 14 dias.')
      }

      // Gera lista de datas no intervalo
      var dates = []
      var cur = new Date(d1.getTime())
      while (cur <= d2) {
        var ym = ('0' + (cur.getUTCMonth() + 1)).slice(-2)
        var yd = ('0' + cur.getUTCDate()).slice(-2)
        dates.push(cur.getUTCFullYear() + '-' + ym + '-' + yd)
        cur.setUTCDate(cur.getUTCDate() + 1)
      }

      // Lê configurações de integração do banco
      var provedor = 'api_football'
      var apiKey = ''
      var fallbackApiKey = ''
      var isRapidApi = false

      try {
        var configRecord = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
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

      // Chave do TheSportsDB
      var theSportsDbKey = ''
      try {
        var tsdbRec = $app.findFirstRecordByData(
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
      if (!theSportsDbKey) {
        theSportsDbKey = '3'
      }

      // Helper: Converte data UTC para YYYY-MM-DD em America/Sao_Paulo (UTC-3)
      var toDateStringSaoPaulo = function (dateInput) {
        if (!dateInput) return null
        try {
          var d = new Date(dateInput)
          if (isNaN(d.getTime())) return null
          var spTime = new Date(d.getTime() - 3 * 3600 * 1000)
          var ySP = spTime.getUTCFullYear()
          var mSP = ('0' + (spTime.getUTCMonth() + 1)).slice(-2)
          var dSP = ('0' + spTime.getUTCDate()).slice(-2)
          return ySP + '-' + mSP + '-' + dSP
        } catch (_) {
          return null
        }
      }

      var toTimeStringSaoPaulo = function (dateInput) {
        if (!dateInput) return '16:00'
        try {
          var d = new Date(dateInput)
          if (isNaN(d.getTime())) return '16:00'
          var spTime = new Date(d.getTime() - 3 * 3600 * 1000)
          var h = ('0' + spTime.getUTCHours()).slice(-2)
          var m = ('0' + spTime.getUTCMinutes()).slice(-2)
          return h + ':' + m
        } catch (_) {
          return '16:00'
        }
      }

      // Normalizador de nome de time para deduplicação
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
        return tokens.length > 0 ? tokens.join(' ').trim() : s.replace(/[^a-z0-9]/g, '').trim()
      }

      var isSameTeamName = function (a, b) {
        var na = normalizeTeamDedup(a)
        var nb = normalizeTeamDedup(b)
        if (!na || !nb) return false
        return na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1
      }

      // Ligas prioritárias para Copa Coni:
      // 1. Série A do Brasileirão
      // 2. Champions League
      // 3. Grandes da Europa (Premier League, La Liga, Serie A Itália, Bundesliga, Ligue 1)
      var isTargetCompetition = function (leagueId, leagueName, compCode) {
        var name = (leagueName || '').toLowerCase()
        var code = (compCode || '').toUpperCase()

        // Brasileirão Série A
        if (
          leagueId === 71 ||
          leagueId === 2013 ||
          code === 'BSA' ||
          name.indexOf('brasileiro serie a') !== -1 ||
          name.indexOf('brasileirão') !== -1
        ) {
          return { valid: true, categoria: 'Brasileirão Série A', prioridade: 1 }
        }
        // Champions League
        if (
          leagueId === 2 ||
          leagueId === 2001 ||
          code === 'CL' ||
          name.indexOf('champions league') !== -1 ||
          name.indexOf('uefa champions') !== -1
        ) {
          return { valid: true, categoria: 'Champions League', prioridade: 2 }
        }
        // Premier League
        if (
          leagueId === 39 ||
          leagueId === 2021 ||
          code === 'PL' ||
          name.indexOf('premier league') !== -1
        ) {
          return { valid: true, categoria: 'Premier League (Inglaterra)', prioridade: 3 }
        }
        // La Liga
        if (
          leagueId === 140 ||
          leagueId === 2014 ||
          code === 'PD' ||
          name.indexOf('la liga') !== -1 ||
          name.indexOf('primera division') !== -1
        ) {
          return { valid: true, categoria: 'La Liga (Espanha)', prioridade: 4 }
        }
        // Serie A Itália
        if (
          leagueId === 135 ||
          leagueId === 2019 ||
          code === 'SA' ||
          (name.indexOf('serie a') !== -1 && name.indexOf('ital') !== -1)
        ) {
          return { valid: true, categoria: 'Serie A (Itália)', prioridade: 5 }
        }
        // Bundesliga
        if (
          leagueId === 78 ||
          leagueId === 2002 ||
          code === 'BL1' ||
          name.indexOf('bundesliga') !== -1
        ) {
          return { valid: true, categoria: 'Bundesliga (Alemanha)', prioridade: 6 }
        }
        // Ligue 1
        if (
          leagueId === 61 ||
          leagueId === 2015 ||
          code === 'FL1' ||
          name.indexOf('ligue 1') !== -1
        ) {
          return { valid: true, categoria: 'Ligue 1 (França)', prioridade: 7 }
        }
        // Libertadores
        if (leagueId === 13 || name.indexOf('libertadores') !== -1) {
          return { valid: true, categoria: 'Copa Libertadores', prioridade: 8 }
        }
        // Copa do Brasil
        if (leagueId === 73 || name.indexOf('copa do brasil') !== -1) {
          return { valid: true, categoria: 'Copa do Brasil', prioridade: 9 }
        }

        return { valid: false, categoria: '', prioridade: 99 }
      }

      // Store global de cache de jogos do dia
      if (typeof globalThis !== 'undefined' && !globalThis.__jogosDoDiaStore) {
        globalThis.__jogosDoDiaStore = {}
      }
      var dayStore = typeof globalThis !== 'undefined' ? globalThis.__jogosDoDiaStore : null
      var nowMs = Date.now()

      var allFixtures = []
      var seenConfrontations = {}

      // Itera pelas datas do intervalo
      for (var di = 0; di < dates.length; di++) {
        var targetDate = dates[di]
        var dayFixturesForDate = []

        // 1. Tenta recuperar do cache de jogos do dia existente
        var cachedEntry = dayStore ? dayStore[targetDate] : null
        if (
          cachedEntry &&
          cachedEntry.payload &&
          Array.isArray(cachedEntry.payload.fixtures) &&
          cachedEntry.payload.fixtures.length > 0
        ) {
          var cAge = nowMs - cachedEntry.timestamp
          // Cache válido por até 6 horas para datas passadas/futuras de busca de enquetes
          if (cAge < 6 * 3600 * 1000) {
            dayFixturesForDate = cachedEntry.payload.fixtures
          }
        }

        // 2. Se não está em cache, faz chamada ao endpoint de API correspondente respeitando contingência
        if (dayFixturesForDate.length === 0) {
          // Tenta Football-Data.org para intervalo se configurado ou se API-Football não disponível
          if (provedor === 'football_data' || !apiKey) {
            var fdToken = apiKey || fallbackApiKey
            if (fdToken) {
              try {
                var resFD = $http.send({
                  url:
                    'https://api.football-data.org/v4/matches?dateFrom=' +
                    encodeURIComponent(targetDate) +
                    '&dateTo=' +
                    encodeURIComponent(targetDate),
                  method: 'GET',
                  headers: { 'X-Auth-Token': fdToken },
                  timeout: 8,
                })

                if (
                  resFD &&
                  resFD.statusCode === 200 &&
                  resFD.json &&
                  Array.isArray(resFD.json.matches)
                ) {
                  for (var fmi = 0; fmi < resFD.json.matches.length; fmi++) {
                    var m = resFD.json.matches[fmi]
                    var mDateSP = toDateStringSaoPaulo(m.utcDate) || targetDate
                    var mTimeSP = toTimeStringSaoPaulo(m.utcDate)
                    var compCode = (m.competition && m.competition.code) || ''
                    var compName = (m.competition && m.competition.name) || ''
                    var compId = (m.competition && m.competition.id) || 0

                    var targetCheck = isTargetCompetition(compId, compName, compCode)
                    if (!targetCheck.valid) continue

                    dayFixturesForDate.push({
                      fixture: {
                        id: String(m.id),
                        date: m.utcDate,
                        status: { short: m.status || 'NS' },
                      },
                      league: {
                        id: compId,
                        name: targetCheck.categoria,
                        categoria: targetCheck.categoria,
                        prioridade: targetCheck.prioridade,
                        logo: (m.competition && m.competition.emblem) || '',
                        region:
                          targetCheck.categoria.indexOf('Brasileir') !== -1
                            ? 'Brasileirão & Copas'
                            : 'Futebol Europeu',
                      },
                      teams: {
                        home: {
                          id: m.homeTeam ? m.homeTeam.id : 0,
                          name: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
                          logo: (m.homeTeam && m.homeTeam.crest) || '',
                        },
                        away: {
                          id: m.awayTeam ? m.awayTeam.id : 0,
                          name: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
                          logo: (m.awayTeam && m.awayTeam.crest) || '',
                        },
                      },
                      dateSP: mDateSP,
                      timeSP: mTimeSP,
                      provider: 'football_data',
                    })
                  }
                }
              } catch (errFD) {
                console.log(
                  '[Enquetes] Erro ao consultar Football-Data para ' + targetDate + ':',
                  errFD,
                )
              }
            }
          }

          // Tenta API-Football se provedor for api_football ou se Football-Data retornou vazio
          if (dayFixturesForDate.length === 0 && apiKey && apiKey !== fallbackApiKey) {
            var baseUrl = isRapidApi
              ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
              : 'https://v3.football.api-sports.io/fixtures'
            var headersApi = isRapidApi
              ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
              : { 'x-apisports-key': apiKey }

            try {
              var resAF = $http.send({
                url:
                  baseUrl +
                  '?date=' +
                  encodeURIComponent(targetDate) +
                  '&timezone=America%2FSao_Paulo',
                method: 'GET',
                headers: headersApi,
                timeout: 8,
              })

              if (
                resAF &&
                resAF.statusCode === 200 &&
                resAF.json &&
                Array.isArray(resAF.json.response)
              ) {
                for (var afi = 0; afi < resAF.json.response.length; afi++) {
                  var item = resAF.json.response[afi]
                  var lId = item.league ? item.league.id : 0
                  var lName = item.league ? item.league.name : ''
                  var tCheck = isTargetCompetition(lId, lName, '')
                  if (!tCheck.valid) continue

                  var fixDate = item.fixture && item.fixture.date ? String(item.fixture.date) : ''
                  var dateSP = toDateStringSaoPaulo(fixDate) || targetDate
                  var timeSP = toTimeStringSaoPaulo(fixDate)

                  dayFixturesForDate.push({
                    fixture: {
                      id: item.fixture ? String(item.fixture.id) : '',
                      date: fixDate,
                      status: {
                        short:
                          (item.fixture && item.fixture.status && item.fixture.status.short) ||
                          'NS',
                      },
                    },
                    league: {
                      id: lId,
                      name: tCheck.categoria,
                      categoria: tCheck.categoria,
                      prioridade: tCheck.prioridade,
                      logo: item.league ? item.league.logo : '',
                      region:
                        tCheck.categoria.indexOf('Brasileir') !== -1
                          ? 'Brasileirão & Copas'
                          : 'Futebol Europeu',
                    },
                    teams: {
                      home: {
                        id: item.teams && item.teams.home ? item.teams.home.id : 0,
                        name: (item.teams && item.teams.home && item.teams.home.name) || '',
                        logo: (item.teams && item.teams.home && item.teams.home.logo) || '',
                      },
                      away: {
                        id: item.teams && item.teams.away ? item.teams.away.id : 0,
                        name: (item.teams && item.teams.away && item.teams.away.name) || '',
                        logo: (item.teams && item.teams.away && item.teams.away.logo) || '',
                      },
                    },
                    dateSP: dateSP,
                    timeSP: timeSP,
                    provider: 'api_football',
                  })
                }
              }
            } catch (errAF) {
              console.log(
                '[Enquetes] Erro ao consultar API-Football para ' + targetDate + ':',
                errAF,
              )
            }
          }
        }

        // Adiciona jogos encontrados filtrando e deduplicando
        for (var j = 0; j < dayFixturesForDate.length; j++) {
          var f = dayFixturesForDate[j]
          var homeName = (f.teams && f.teams.home && f.teams.home.name) || ''
          var awayName = (f.teams && f.teams.away && f.teams.away.name) || ''
          if (!homeName || !awayName) continue

          var lIdCheck = f.league ? f.league.id : 0
          var lNameCheck = f.league ? f.league.name : ''
          var tEval = isTargetCompetition(lIdCheck, lNameCheck, '')
          if (!tEval.valid) continue

          var gameDate = f.dateSP || toDateStringSaoPaulo(f.fixture && f.fixture.date) || targetDate
          var gameTime = f.timeSP || toTimeStringSaoPaulo(f.fixture && f.fixture.date) || '16:00'

          // Chave de confronto única (data + par de times)
          var normH = normalizeTeamDedup(homeName)
          var normA = normalizeTeamDedup(awayName)
          var pairKey = [normH, normA].sort().join('___')
          var confrontationKey = gameDate + '::' + pairKey

          if (seenConfrontations[confrontationKey]) {
            continue
          }
          seenConfrontations[confrontationKey] = true

          allFixtures.push({
            id: (f.fixture && f.fixture.id) || 'match_' + allFixtures.length,
            fixture_id: f.fixture && f.fixture.id ? String(f.fixture.id) : '',
            time_a: homeName,
            time_b: awayName,
            campeonato: tEval.categoria || f.league.name || 'Futebol',
            prioridade: tEval.prioridade || 10,
            regiao:
              tEval.categoria.indexOf('Brasileir') !== -1
                ? 'Brasileirão & Copas'
                : 'Futebol Europeu',
            data: gameDate,
            horario: gameTime,
            logo_casa: (f.teams && f.teams.home && f.teams.home.logo) || '',
            logo_visitante: (f.teams && f.teams.away && f.teams.away.logo) || '',
            campeonato_logo: (f.league && f.league.logo) || '',
          })
        }
      }

      // Ordena por: 1) Data ascendente, 2) Prioridade do campeonato, 3) Horário
      allFixtures.sort(function (a, b) {
        if (a.data !== b.data) return a.data.localeCompare(b.data)
        if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade
        return a.horario.localeCompare(b.horario)
      })

      return e.json(200, {
        success: true,
        data_inicio: dataInicio,
        data_fim: dataFim,
        total: allFixtures.length,
        fixtures: allFixtures,
      })
    } catch (err) {
      console.log('[Enquetes] Erro geral ao buscar jogos por intervalo:', err)
      return e.json(500, {
        success: false,
        error: err ? err.message : 'Erro ao buscar jogos do intervalo',
      })
    }
  },
  $apis.requireAuth(),
)
