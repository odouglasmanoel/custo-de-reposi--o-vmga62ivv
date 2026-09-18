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

      // Helper para normalizar data para YYYY-MM-DD
      var normalizeDateInput = function (raw) {
        if (!raw) return ''
        var s = String(raw).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
        var br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
        if (br) {
          var dia = ('0' + br[1]).slice(-2)
          var mes = ('0' + br[2]).slice(-2)
          var ano = br[3]
          return ano + '-' + mes + '-' + dia
        }
        return s
      }

      // Coleta data_inicio e data_fim
      var dataInicio = normalizeDateInput(e.requestInfo().query.data_inicio || '')
      var dataFim = normalizeDateInput(e.requestInfo().query.data_fim || '')
      // Parâmetro sem_corte: quando true ou "1", não descarta jogos passados ou que começam em menos de 3h
      // Utilizado pela aba Jogos do Dia (/jogos-do-dia) para visualização completa de partidas do dia
      var semCorte =
        e.requestInfo().query.sem_corte === '1' || e.requestInfo().query.sem_corte === 'true'

      // Valida formato das datas
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return e.badRequestError(
          'Formato de data inválido. Use YYYY-MM-DD ou DD/MM/YYYY para data_inicio e data_fim.',
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

      // Helper: Converte horário UTC para HH:mm em America/Sao_Paulo (UTC-3)
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

      // Helper: Converte data (YYYY-MM-DD) e hora (HH:mm) do fuso America/Sao_Paulo (UTC-3)
      // para timestamp numérico UTC absoluto do kickoff
      var getKickoffTimestampSaoPaulo = function (dateStrSP, timeStrSP, rawUtcDate) {
        if (rawUtcDate) {
          try {
            var rawD = new Date(rawUtcDate)
            if (!isNaN(rawD.getTime())) {
              return rawD.getTime()
            }
          } catch (_) {}
        }
        if (!dateStrSP) return null
        try {
          var dParts = dateStrSP.split('-')
          if (dParts.length !== 3) return null
          var yr = parseInt(dParts[0], 10)
          var mo = parseInt(dParts[1], 10) - 1
          var dy = parseInt(dParts[2], 10)
          var hr = 16
          var mn = 0
          if (timeStrSP) {
            var tParts = timeStrSP.split(':')
            if (tParts.length >= 1) hr = parseInt(tParts[0], 10) || 0
            if (tParts.length >= 2) mn = parseInt(tParts[1], 10) || 0
          }
          // America/Sao_Paulo (UTC-3): horário local + 3 horas = UTC
          return Date.UTC(yr, mo, dy, hr + 3, mn, 0, 0)
        } catch (_) {
          return null
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
              'ac',
              'as',
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
      // Normalizador de texto para checagem flexível de ligas
      var normalizeLeagueName = function (s) {
        if (!s) return ''
        var str = String(s).toLowerCase()
        try {
          str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}
        return str
      }

      // Classificador de ligas para atribuição de categoria e prioridade
      // Quando semCorte for true (ex: Jogos do Dia), toda partida é válida (valid: true global)
      // Para enquetes padrão com lista restrita, mantém prioridades e permite todos os jogos se semCorte
      var isTargetCompetition = function (leagueId, leagueName, compCode) {
        var name = normalizeLeagueName(leagueName)
        var code = (compCode || '').toUpperCase()

        // Brasileirão Série A
        if (
          leagueId === 71 ||
          leagueId === 2013 ||
          code === 'BSA' ||
          name.indexOf('brasileiro serie a') !== -1 ||
          (name.indexOf('serie a') !== -1 &&
            (name.indexOf('brasil') !== -1 || name.indexOf('brazil') !== -1)) ||
          name.indexOf('brasileirao') !== -1
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
          (name.indexOf('serie a') !== -1 && (name.indexOf('ital') !== -1 || code === 'SA'))
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
        if (
          leagueId === 13 ||
          leagueId === 4501 ||
          code === 'CLI' ||
          name.indexOf('libertadores') !== -1
        ) {
          return { valid: true, categoria: 'Copa Libertadores', prioridade: 8 }
        }
        // Copa do Brasil
        if (
          leagueId === 73 ||
          name.indexOf('copa do brasil') !== -1 ||
          name.indexOf('copa de brasil') !== -1
        ) {
          return { valid: true, categoria: 'Copa do Brasil', prioridade: 9 }
        }
        // Europa League
        if (
          leagueId === 3 ||
          leagueId === 2146 ||
          leagueId === 4481 ||
          code === 'EL' ||
          name.indexOf('europa league') !== -1
        ) {
          return { valid: true, categoria: 'UEFA Europa League', prioridade: 10 }
        }
        // Copa Sudamericana
        if (
          leagueId === 11 ||
          leagueId === 4724 ||
          name.indexOf('sudamericana') !== -1 ||
          name.indexOf('sul-americana') !== -1
        ) {
          return { valid: true, categoria: 'Copa Sul-Americana', prioridade: 11 }
        }

        // Se semCorte for true (Jogos do Dia / busca global sem restrição), aceita qualquer competição
        if (semCorte) {
          var catName = leagueName || 'Outras Ligas'
          return { valid: true, categoria: catName, prioridade: 50 }
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

        // 2. Se não está em cache, faz chamada aos provedores externos com contingência
        if (dayFixturesForDate.length === 0) {
          // A) API-Football: se configurada, tenta consultar a data
          if (apiKey && apiKey !== fallbackApiKey) {
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

          // B) Football-Data.org: se API-Football não retornou jogos (ou estourou cota/vazio), aciona contingência
          var fdTokenToUse = fallbackApiKey || (provedor === 'football_data' ? apiKey : '')
          if (dayFixturesForDate.length === 0 && fdTokenToUse) {
            try {
              // Converte data alvo para intervalo dateFrom/dateTo
              var resFD = $http.send({
                url:
                  'https://api.football-data.org/v4/matches?dateFrom=' +
                  encodeURIComponent(targetDate) +
                  '&dateTo=' +
                  encodeURIComponent(targetDate),
                method: 'GET',
                headers: { 'X-Auth-Token': fdTokenToUse },
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

          // C) TheSportsDB: se ainda assim estiver vazio, ou para complementar ligas
          // Se semCorte=true ou busca global, consulta primeiro eventsday.php?d={targetDate} sem filtro de liga
          // para trazer todos os eventos disponíveis do dia mundo afora
          try {
            var tsdbKeyToUse = theSportsDbKey || '3'
            var tsdbDayEvents = []

            // 1. Chamada global eventsday.php sem parâmetro de liga se semCorte
            if (semCorte) {
              try {
                var resTsdbAll = $http.send({
                  url:
                    'https://www.thesportsdb.com/api/v1/json/' +
                    encodeURIComponent(tsdbKeyToUse) +
                    '/eventsday.php?d=' +
                    encodeURIComponent(targetDate),
                  method: 'GET',
                  timeout: 8,
                })
                if (
                  resTsdbAll &&
                  resTsdbAll.statusCode === 200 &&
                  resTsdbAll.json &&
                  Array.isArray(resTsdbAll.json.events)
                ) {
                  tsdbDayEvents = resTsdbAll.json.events
                }
              } catch (errTsdbGlobal) {
                console.log('[TheSportsDB Global Enquetes] Erro:', errTsdbGlobal)
              }
            }

            if (tsdbDayEvents.length > 0) {
              for (var teiGlobal = 0; teiGlobal < tsdbDayEvents.length; teiGlobal++) {
                var evGlobal = tsdbDayEvents[teiGlobal]
                var hNameG = (evGlobal.strHomeTeam || '').trim()
                var aNameG = (evGlobal.strAwayTeam || '').trim()
                if (!hNameG || !aNameG) continue

                var tsdbRawUtcG = evGlobal.strTimestamp
                  ? evGlobal.strTimestamp.indexOf('Z') === -1
                    ? evGlobal.strTimestamp + 'Z'
                    : evGlobal.strTimestamp
                  : evGlobal.dateEvent
                    ? evGlobal.dateEvent + 'T' + (evGlobal.strTime || '20:00:00') + 'Z'
                    : targetDate + 'T20:00:00Z'

                var tsdbDateSPG =
                  toDateStringSaoPaulo(tsdbRawUtcG) || evGlobal.dateEvent || targetDate
                var tsdbTimeSPG = toTimeStringSaoPaulo(tsdbRawUtcG)
                var leagueNameG = evGlobal.strLeague || 'Futebol'

                dayFixturesForDate.push({
                  fixture: {
                    id: 'tsdb_' + (evGlobal.idEvent || 'ev_' + teiGlobal),
                    date: tsdbRawUtcG,
                    status: { short: 'NS' },
                  },
                  league: {
                    id: parseInt(evGlobal.idLeague, 10) || 0,
                    name: leagueNameG,
                    categoria: leagueNameG,
                    prioridade: 30,
                    logo: evGlobal.strLeagueBadge || evGlobal.strBadge || '',
                    region: 'Futebol',
                  },
                  teams: {
                    home: {
                      id: parseInt(evGlobal.idHomeTeam, 10) || 0,
                      name: hNameG,
                      logo: evGlobal.strHomeTeamBadge || '',
                    },
                    away: {
                      id: parseInt(evGlobal.idAwayTeam, 10) || 0,
                      name: aNameG,
                      logo: evGlobal.strAwayTeamBadge || '',
                    },
                  },
                  dateSP: tsdbDateSPG,
                  timeSP: tsdbTimeSPG,
                  provider: 'thesportsdb',
                })
              }
            } else {
              var tsdbConmebolLeagues = [
                { id: 4501, name: 'Copa Libertadores', cat: 'Copa Libertadores', prio: 8 },
                { id: 4724, name: 'Copa Sudamericana', cat: 'Copa Sul-Americana', prio: 11 },
                {
                  id: 4328,
                  name: 'English Premier League',
                  cat: 'Premier League (Inglaterra)',
                  prio: 3,
                },
                { id: 4335, name: 'Spanish La Liga', cat: 'La Liga (Espanha)', prio: 4 },
                { id: 4332, name: 'Italian Serie A', cat: 'Serie A (Itália)', prio: 5 },
                { id: 4331, name: 'German Bundesliga', cat: 'Bundesliga (Alemanha)', prio: 6 },
                { id: 4334, name: 'French Ligue 1', cat: 'Ligue 1 (França)', prio: 7 },
                { id: 4481, name: 'UEFA Europa League', cat: 'UEFA Europa League', prio: 10 },
                { id: 4480, name: 'UEFA Champions League', cat: 'Champions League', prio: 2 },
              ]

              for (var tli = 0; tli < tsdbConmebolLeagues.length; tli++) {
                var tLeague = tsdbConmebolLeagues[tli]
                var resTsdb = $http.send({
                  url:
                    'https://www.thesportsdb.com/api/v1/json/' +
                    encodeURIComponent(tsdbKeyToUse) +
                    '/eventsday.php?d=' +
                    encodeURIComponent(targetDate) +
                    '&l=' +
                    encodeURIComponent(tLeague.id),
                  method: 'GET',
                  timeout: 8,
                })
                if (
                  resTsdb &&
                  resTsdb.statusCode === 200 &&
                  resTsdb.json &&
                  Array.isArray(resTsdb.json.events)
                ) {
                  for (var tei = 0; tei < resTsdb.json.events.length; tei++) {
                    var ev = resTsdb.json.events[tei]
                    var hName = (ev.strHomeTeam || '').trim()
                    var aName = (ev.strAwayTeam || '').trim()
                    if (!hName || !aName) continue

                    // TheSportsDB: strTimestamp é UTC ISO "2026-06-15T19:00:00". Se ausente, usa dateEvent + strTime + Z (UTC)
                    var tsdbRawUtc = ev.strTimestamp
                      ? ev.strTimestamp.indexOf('Z') === -1
                        ? ev.strTimestamp + 'Z'
                        : ev.strTimestamp
                      : ev.dateEvent
                        ? ev.dateEvent + 'T' + (ev.strTime || '20:00:00') + 'Z'
                        : targetDate + 'T20:00:00Z'

                    var tsdbDateSP = toDateStringSaoPaulo(tsdbRawUtc) || ev.dateEvent || targetDate
                    var tsdbTimeSP = toTimeStringSaoPaulo(tsdbRawUtc)

                    dayFixturesForDate.push({
                      fixture: {
                        id: 'tsdb_' + (ev.idEvent || tLeague.id + '_' + tei),
                        date: tsdbRawUtc,
                        status: { short: 'NS' },
                      },
                      league: {
                        id: tLeague.id,
                        name: tLeague.cat,
                        categoria: tLeague.cat,
                        prioridade: tLeague.prio,
                        logo: ev.strLeagueBadge || ev.strBadge || '',
                        region:
                          tLeague.cat.indexOf('Brasileir') !== -1 ||
                          tLeague.cat.indexOf('Copa') !== -1
                            ? 'Brasileirão & Copas'
                            : 'Futebol Europeu',
                      },
                      teams: {
                        home: {
                          id: parseInt(ev.idHomeTeam, 10) || 0,
                          name: hName,
                          logo: ev.strHomeTeamBadge || '',
                        },
                        away: {
                          id: parseInt(ev.idAwayTeam, 10) || 0,
                          name: aName,
                          logo: ev.strAwayTeamBadge || '',
                        },
                      },
                      dateSP: tsdbDateSP,
                      timeSP: tsdbTimeSP,
                      provider: 'thesportsdb',
                    })
                  }
                }
              }
            }
          } catch (errTsdb) {
            console.log(
              '[Enquetes] Erro ao consultar TheSportsDB para ' + targetDate + ':',
              errTsdb,
            )
          }

          // Se encontramos partidas para a data, grava no store em memória
          if (dayStore && dayFixturesForDate.length > 0) {
            dayStore[targetDate] = {
              timestamp: nowMs,
              payload: { fixtures: dayFixturesForDate },
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
          if (!tEval.valid && !semCorte) continue
          var rawDateSource = f.fixture && f.fixture.date ? String(f.fixture.date) : ''
          var gameDate = f.dateSP || toDateStringSaoPaulo(rawDateSource) || targetDate
          var gameTime = f.timeSP || toTimeStringSaoPaulo(rawDateSource) || '16:00'

          // -----------------------------------------------------------------
          // REGRA DE FILTRO: Margem Mínima de Tempo (+3 Horas)
          // "Ao buscar os jogos no período selecionado, ignore qualquer partida
          // que comece em menos de 3 horas a partir do exato momento em que a
          // busca/enquete é criada."
          // Cutoff: agora + 3 horas.
          // O jogo só é incluído se kickoffTimestamp >= agora + 3 horas.
          // Se semCorte == true (usado por Jogos do Dia), NÃO aplica o descarte de 3h!
          // -----------------------------------------------------------------
          var kickoffTs = getKickoffTimestampSaoPaulo(gameDate, gameTime, rawDateSource)
          var minAllowedKickoff = nowMs + 3 * 3600 * 1000
          if (!semCorte && kickoffTs !== null && kickoffTs < minAllowedKickoff) {
            // Partida começa em menos de 3 horas (ou já começou/terminou): filtrar fora
            continue
          }

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

// -------------------------------------------------------------
// Endpoint para busca de escudos por nome de time (team search)
// Cascata: Cache em memória -> TheSportsDB -> API-Football
// Usado na adição/edição manual de jogos na Enquete
// -------------------------------------------------------------
routerAdd(
  'GET',
  '/backend/v1/enquetes/buscar-escudo',
  (e) => {
    try {
      const authRecord = e.auth
      if (!authRecord) {
        return e.unauthorizedError('Usuário não autenticado')
      }

      var teamName = (e.requestInfo().query.team || '').trim()
      if (!teamName) {
        return e.badRequestError('Parâmetro "team" é obrigatório.')
      }

      var cleanKey = teamName.toLowerCase().trim()
      try {
        cleanKey = cleanKey.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}

      // Cache em memória compartilhado
      if (typeof globalThis !== 'undefined' && !globalThis.__tsdbBadgeCache) {
        globalThis.__tsdbBadgeCache = {}
      }
      if (
        typeof globalThis !== 'undefined' &&
        globalThis.__tsdbBadgeCache &&
        globalThis.__tsdbBadgeCache[cleanKey] !== undefined
      ) {
        return e.json(200, {
          team: teamName,
          badgeUrl: globalThis.__tsdbBadgeCache[cleanKey] || '',
          cached: true,
        })
      }

      // Lê chaves de integração
      var tsdbKey = ''
      try {
        var tsdbRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'thesportsdb_fallback',
        )
        if (tsdbRec) {
          tsdbKey = (tsdbRec.getString('api_key') || '').trim()
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

      var badgeFound = ''

      // 1. Consulta TheSportsDB searchteams.php (timeout curto de 4s)
      try {
        var resTsdb = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(tsdbKey) +
            '/searchteams.php?t=' +
            encodeURIComponent(teamName),
          method: 'GET',
          timeout: 4,
        })

        if (
          resTsdb.statusCode === 200 &&
          resTsdb.json &&
          Array.isArray(resTsdb.json.teams) &&
          resTsdb.json.teams.length > 0
        ) {
          var tObj = resTsdb.json.teams[0]
          badgeFound = (tObj.strBadge || tObj.strTeamBadge || tObj.strLogo || '').trim()
        }
      } catch (errTsdb) {
        console.log('[TSDB Escudo Enquete endpoint] Erro na busca por ' + teamName + ':', errTsdb)
      }

      // 2. Se não encontrou no TheSportsDB, tenta API-Football se disponível
      if (!badgeFound) {
        var afKey = ''
        var isRapid = false
        try {
          var cfg = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
          if (cfg) {
            afKey = (cfg.getString('api_key') || '').trim()
          }
        } catch (_) {}
        if (!afKey) {
          try {
            if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
              afKey = $secrets.get('API_FOOTBALL_KEY')
            } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
              afKey = $secrets.get('RAPIDAPI_KEY')
              isRapid = true
            } else if ($os && $os.getenv) {
              afKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
              if ($os.getenv('RAPIDAPI_KEY')) isRapid = true
            }
          } catch (_) {}
        }
        if (afKey.length > 40) isRapid = true

        if (afKey) {
          try {
            var urlAF = isRapid
              ? 'https://api-football-v1.p.rapidapi.com/v3/teams?search=' +
                encodeURIComponent(teamName)
              : 'https://v3.football.api-sports.io/teams?search=' + encodeURIComponent(teamName)
            var hdrs = isRapid
              ? { 'x-rapidapi-key': afKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
              : { 'x-apisports-key': afKey }

            var resAF = $http.send({
              url: urlAF,
              method: 'GET',
              headers: hdrs,
              timeout: 4,
            })

            if (
              resAF.statusCode === 200 &&
              resAF.json &&
              Array.isArray(resAF.json.response) &&
              resAF.json.response.length > 0
            ) {
              var tAfObj = resAF.json.response[0]
              if (tAfObj && tAfObj.team && tAfObj.team.logo) {
                badgeFound = String(tAfObj.team.logo).trim()
              }
            }
          } catch (errAF) {
            console.log(
              '[API-Football Escudo Enquete endpoint] Erro na busca por ' + teamName + ':',
              errAF,
            )
          }
        }
      }

      // Armazena no cache se globalThis estiver disponível
      if (typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
        globalThis.__tsdbBadgeCache[cleanKey] = badgeFound
      }

      return e.json(200, {
        team: teamName,
        badgeUrl: badgeFound,
        cached: false,
      })
    } catch (err) {
      console.log('[Enquetes Escudo] Erro geral ao buscar escudo:', err)
      return e.json(500, {
        team: (e.requestInfo().query.team || '').trim(),
        badgeUrl: '',
        error: err ? err.message : 'Falha ao buscar escudo',
      })
    }
  },
  $apis.requireAuth(),
)

// -------------------------------------------------------------
// Hooks do Ciclo de Vida de Jogos da Enquete (enquete_jogos):
// Busca automática de escudos via TheSportsDB / API-Football
// quando logo_casa / logo_visitante estiverem vazios na criação ou edição.
// -------------------------------------------------------------

onRecordCreate((e) => {
  var rec = e.record
  try {
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    var timeCasa = (rec.getString('time_a') || '').trim()
    var timeVis = (rec.getString('time_b') || '').trim()

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

      var fetchBadgeInline = function (teamName) {
        if (!teamName) return ''
        var cleanKey = teamName.toLowerCase().trim()
        try {
          cleanKey = cleanKey.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}

        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey] !== undefined
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey] || ''
        }

        var found = ''
        // 1. TheSportsDB
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

          if (
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.teams) &&
            res.json.teams.length > 0
          ) {
            var teamObj = res.json.teams[0]
            found = (teamObj.strBadge || teamObj.strTeamBadge || teamObj.strLogo || '').trim()
          }
        } catch (errSearch) {
          console.log('[TSDB Escudo enquete_jogos] Erro na busca por ' + teamName + ':', errSearch)
        }

        // 2. Fallback API-Football se vazio
        if (!found) {
          try {
            var afKey = ''
            var isRapid = false
            try {
              var cfg = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
              if (cfg) afKey = (cfg.getString('api_key') || '').trim()
            } catch (_) {}
            if (!afKey) {
              if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
                afKey = $secrets.get('API_FOOTBALL_KEY')
              } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
                afKey = $secrets.get('RAPIDAPI_KEY')
                isRapid = true
              } else if ($os && $os.getenv) {
                afKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
                if ($os.getenv('RAPIDAPI_KEY')) isRapid = true
              }
            }
            if (afKey.length > 40) isRapid = true

            if (afKey) {
              var urlAF = isRapid
                ? 'https://api-football-v1.p.rapidapi.com/v3/teams?search=' +
                  encodeURIComponent(teamName)
                : 'https://v3.football.api-sports.io/teams?search=' + encodeURIComponent(teamName)
              var hdrs = isRapid
                ? { 'x-rapidapi-key': afKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
                : { 'x-apisports-key': afKey }

              var resAF = $http.send({
                url: urlAF,
                method: 'GET',
                headers: hdrs,
                timeout: 4,
              })

              if (
                resAF.statusCode === 200 &&
                resAF.json &&
                Array.isArray(resAF.json.response) &&
                resAF.json.response.length > 0
              ) {
                var tAfObj = resAF.json.response[0]
                if (tAfObj && tAfObj.team && tAfObj.team.logo) {
                  found = String(tAfObj.team.logo).trim()
                }
              }
            }
          } catch (errAF) {
            console.log(
              '[API-Football Escudo enquete_jogos] Erro na busca por ' + teamName + ':',
              errAF,
            )
          }
        }

        if (typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache[cleanKey] = found
        }
        return found
      }

      if (!logoCasa && timeCasa) {
        var foundCasa = fetchBadgeInline(timeCasa)
        if (foundCasa) {
          rec.set('logo_casa', foundCasa)
        }
      }

      if (!logoVis && timeVis) {
        var foundVis = fetchBadgeInline(timeVis)
        if (foundVis) {
          rec.set('logo_visitante', foundVis)
        }
      }
    }
  } catch (errBadge) {
    console.log('[Escudo enquete_jogos onRecordCreate] Aviso:', errBadge)
  }

  e.next()
}, 'enquete_jogos')

onRecordUpdate((e) => {
  var rec = e.record
  try {
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    var timeCasa = (rec.getString('time_a') || '').trim()
    var timeVis = (rec.getString('time_b') || '').trim()

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

      var fetchBadgeInline = function (teamName) {
        if (!teamName) return ''
        var cleanKey = teamName.toLowerCase().trim()
        try {
          cleanKey = cleanKey.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}

        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey] !== undefined
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey] || ''
        }

        var found = ''
        // 1. TheSportsDB
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

          if (
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.teams) &&
            res.json.teams.length > 0
          ) {
            var teamObj = res.json.teams[0]
            found = (teamObj.strBadge || teamObj.strTeamBadge || teamObj.strLogo || '').trim()
          }
        } catch (errSearch) {
          console.log(
            '[TSDB Escudo enquete_jogos update] Erro na busca por ' + teamName + ':',
            errSearch,
          )
        }

        // 2. Fallback API-Football se vazio
        if (!found) {
          try {
            var afKey = ''
            var isRapid = false
            try {
              var cfg = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
              if (cfg) afKey = (cfg.getString('api_key') || '').trim()
            } catch (_) {}
            if (!afKey) {
              if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
                afKey = $secrets.get('API_FOOTBALL_KEY')
              } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
                afKey = $secrets.get('RAPIDAPI_KEY')
                isRapid = true
              } else if ($os && $os.getenv) {
                afKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
                if ($os.getenv('RAPIDAPI_KEY')) isRapid = true
              }
            }
            if (afKey.length > 40) isRapid = true

            if (afKey) {
              var urlAF = isRapid
                ? 'https://api-football-v1.p.rapidapi.com/v3/teams?search=' +
                  encodeURIComponent(teamName)
                : 'https://v3.football.api-sports.io/teams?search=' + encodeURIComponent(teamName)
              var hdrs = isRapid
                ? { 'x-rapidapi-key': afKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
                : { 'x-apisports-key': afKey }

              var resAF = $http.send({
                url: urlAF,
                method: 'GET',
                headers: hdrs,
                timeout: 4,
              })

              if (
                resAF.statusCode === 200 &&
                resAF.json &&
                Array.isArray(resAF.json.response) &&
                resAF.json.response.length > 0
              ) {
                var tAfObj = resAF.json.response[0]
                if (tAfObj && tAfObj.team && tAfObj.team.logo) {
                  found = String(tAfObj.team.logo).trim()
                }
              }
            }
          } catch (errAF) {
            console.log(
              '[API-Football Escudo enquete_jogos update] Erro na busca por ' + teamName + ':',
              errAF,
            )
          }
        }

        if (typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache[cleanKey] = found
        }
        return found
      }

      if (!logoCasa && timeCasa) {
        var foundCasa = fetchBadgeInline(timeCasa)
        if (foundCasa) {
          rec.set('logo_casa', foundCasa)
        }
      }

      if (!logoVis && timeVis) {
        var foundVis = fetchBadgeInline(timeVis)
        if (foundVis) {
          rec.set('logo_visitante', foundVis)
        }
      }
    }
  } catch (errBadge) {
    console.log('[Escudo enquete_jogos onRecordUpdate] Aviso:', errBadge)
  }

  e.next()
}, 'enquete_jogos')
