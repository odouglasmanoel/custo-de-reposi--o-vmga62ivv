/**
 * Hook dedicado para busca de jogos em intervalo de datas para Enquetes da Copa Coni.
 * Reutiliza os provedores esportivos (API-Football -> Football-Data.org -> TheSportsDB)
 * com cache em memória (TTL 7 min por data), deduplicação e filtragem das principais competições:
 * - Série A do Brasileirão
 * - Champions League
 * - Grandes da Europa (Premier League, La Liga, Serie A Itália, Bundesliga, Ligue 1)
 */

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

routerAdd(
  'GET',
  '/backend/v1/enquetes/buscar-jogos',
  (e) => {
    if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballThrottle) {
      globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 15 * 60 * 1000 }
    }
    var checkApiFootballThrottle = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballThrottle) {
        return { canCall: true, waitMs: 0 }
      }
      var now = Date.now()
      var diff = now - (globalThis.__apiFootballThrottle.lastCallTimestamp || 0)
      var interval = globalThis.__apiFootballThrottle.minIntervalMs || 900000
      if (diff < interval) {
        return { canCall: false, waitMs: interval - diff }
      }
      return { canCall: true, waitMs: 0 }
    }
    var recordApiFootballCall = function () {
      if (typeof globalThis !== 'undefined' && globalThis.__apiFootballThrottle) {
        globalThis.__apiFootballThrottle.lastCallTimestamp = Date.now()
      }
    }

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

        // Serie A Itália (Checar ANTES de checagens genéricas de Serie A para garantir desambiguação)
        if (
          leagueId === 135 ||
          leagueId === 2019 ||
          code === 'SA' ||
          (name.indexOf('serie a') !== -1 && (name.indexOf('ital') !== -1 || code === 'SA'))
        ) {
          return { valid: true, categoria: 'Serie A (Itália)', prioridade: 5 }
        }

        // Brasileirão Série A (Apenas com indicador EXPLÍCITO do Brasil)
        if (
          leagueId === 71 ||
          leagueId === 2013 ||
          code === 'BSA' ||
          name.indexOf('brasileiro serie a') !== -1 ||
          name.indexOf('brasileirao') !== -1 ||
          (name.indexOf('serie a') !== -1 &&
            (name.indexOf('brasil') !== -1 ||
              name.indexOf('brazil') !== -1 ||
              name.indexOf('brasileir') !== -1))
        ) {
          return { valid: true, categoria: 'Brasileirão Série A', prioridade: 1 }
        } // Champions League
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
        // Serie A Itália já avaliada acima
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
          // Se for entrada em contingência/degradada, respeita TTL curto de 60s
          var isDegradedEntry = Boolean(
            cachedEntry.payload.fallback_active === true ||
            cachedEntry.payload.is_contingency === true ||
            cachedEntry.payload.contingency === true,
          )
          var allowedStoreAge = isDegradedEntry ? 60 * 1000 : 7 * 60 * 1000
          if (cAge < allowedStoreAge) {
            dayFixturesForDate = cachedEntry.payload.fixtures
          }
        }

        // 2. Se não está em cache, faz chamada aos provedores externos combinando todas as fontes (Merge Multi-API)
        if (dayFixturesForDate.length === 0) {
          // Listas coletadas por cada fonte externa para unificação com prioridade
          var afCollected = []
          var fdCollected = []
          var tsdbCollected = []

          // A) EDIÇÃO 3: NUNCA mais chamar API-Football com /fixtures?date=
          // Para enquetes, a busca de partidas do dia usa TheSportsDB e Football-Data.org (que suportam listagem diária sem esgotar cota).
          // A API-Football é preservada 100% para os jogos cadastrados do bolão por ID direto (/fixtures?id=...).

          // B) Football-Data.org: sempre consultado para merge quando token disponível
          var fdTokenToUse = fallbackApiKey || (provedor === 'football_data' ? apiKey : '')
          if (fdTokenToUse) {
            try {
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

                  var authenticFdName = compName || targetCheck.categoria || 'Futebol'

                  fdCollected.push({
                    fixture: {
                      id: String(m.id),
                      date: m.utcDate,
                      status: { short: m.status || 'NS' },
                    },
                    league: {
                      id: compId,
                      name: authenticFdName,
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
                    sourcePriority: 2,
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

          // C) TheSportsDB: consultado para completar e expandir o merge de todas as ligas mundiais
          try {
            var tsdbKeyToUse = theSportsDbKey || '3'
            var tsdbDayEvents = []

            // 1. Chamada global eventsday.php com filtro s=Soccer
            try {
              var resTsdbAll = $http.send({
                url:
                  'https://www.thesportsdb.com/api/v1/json/' +
                  encodeURIComponent(tsdbKeyToUse) +
                  '/eventsday.php?d=' +
                  encodeURIComponent(targetDate) +
                  '&s=Soccer',
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

                tsdbCollected.push({
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
                      logo: '', // TheSportsDB eliminado: nunca persistir escudos dessa fonte
                    },
                    away: {
                      id: parseInt(evGlobal.idAwayTeam, 10) || 0,
                      name: aNameG,
                      logo: '', // TheSportsDB eliminado: nunca persistir escudos dessa fonte
                    },
                  },
                  dateSP: tsdbDateSPG,
                  timeSP: tsdbTimeSPG,
                  provider: 'thesportsdb',
                  sourcePriority: 3,
                })
              }
            } else {
              var tsdbConmebolLeagues = [
                { id: 4501, name: 'Copa Libertadores', cat: 'Copa Libertadores', prio: 8 },
                { id: 4724, name: 'Copa Sudamericana', cat: 'Copa Sul-Americana', prio: 11 },
                {
                  id: 4406,
                  name: 'Argentinian Primera Division',
                  cat: 'Campeonato Argentino',
                  prio: 12,
                },
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
                    '&s=Soccer&l=' +
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

                    var tsdbRawUtc = ev.strTimestamp
                      ? ev.strTimestamp.indexOf('Z') === -1
                        ? ev.strTimestamp + 'Z'
                        : ev.strTimestamp
                      : ev.dateEvent
                        ? ev.dateEvent + 'T' + (ev.strTime || '20:00:00') + 'Z'
                        : targetDate + 'T20:00:00Z'

                    var tsdbDateSP = toDateStringSaoPaulo(tsdbRawUtc) || ev.dateEvent || targetDate
                    var tsdbTimeSP = toTimeStringSaoPaulo(tsdbRawUtc)

                    tsdbCollected.push({
                      fixture: {
                        id: 'tsdb_' + (ev.idEvent || tLeague.id + '_' + tei),
                        date: tsdbRawUtc,
                        status: { short: 'NS' },
                      },
                      league: {
                        id: tLeague.id,
                        name: tLeague.name || tLeague.cat,
                        categoria: tLeague.cat,
                        prioridade: tLeague.prio,
                        logo: ev.strLeagueBadge || ev.strBadge || '',
                        region:
                          tLeague.cat.indexOf('Brasileir') !== -1 ||
                          (tLeague.cat.indexOf('Copa') !== -1 &&
                            tLeague.cat.indexOf('Europa') === -1) ||
                          tLeague.id === 4406 ||
                          tLeague.cat.indexOf('Argentin') !== -1
                            ? 'Sul-Americana'
                            : 'Futebol Europeu',
                      },
                      teams: {
                        home: {
                          id: parseInt(ev.idHomeTeam, 10) || 0,
                          name: hName,
                          logo: '', // TheSportsDB eliminado: nunca persistir escudos dessa fonte
                        },
                        away: {
                          id: parseInt(ev.idAwayTeam, 10) || 0,
                          name: aName,
                          logo: '', // TheSportsDB eliminado: nunca persistir escudos dessa fonte
                        },
                      },
                      dateSP: tsdbDateSP,
                      timeSP: tsdbTimeSP,
                      provider: 'thesportsdb',
                      sourcePriority: 3,
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

          // D) Banco de Dados Local (jogos manuais cadastrados)
          var dbCollected = []
          try {
            var dbManualRecs = $app.findRecordsByFilter(
              'jogos_do_dia_manuais',
              "data = '" + targetDate + "'",
              'horario',
              100,
              0,
            )
            for (var dbmi = 0; dbmi < dbManualRecs.length; dbmi++) {
              var dbr = dbManualRecs[dbmi]
              var dbHome = dbr.getString('time_casa') || ''
              var dbAway = dbr.getString('time_visitante') || ''
              var dbHora = dbr.getString('horario') || '16:00'
              var dbCamp = dbr.getString('campeonato') || 'Futebol'
              var dbReg = dbr.getString('regiao') || 'Brasileirão & Copas'
              var dbIso =
                targetDate + 'T' + (dbHora.length === 5 ? dbHora + ':00' : dbHora) + '-03:00'

              if (dbHome && dbAway) {
                dbCollected.push({
                  fixture: {
                    id: 'manual_' + dbr.id,
                    date: dbIso,
                    status: { short: (dbr.getString('status') || 'NS').trim().toUpperCase() },
                  },
                  league: {
                    id: 99990 + dbmi,
                    name: dbCamp,
                    categoria: dbCamp,
                    prioridade: 20,
                    logo: '',
                    region: dbReg,
                  },
                  teams: {
                    home: {
                      id: 0,
                      name: dbHome,
                      logo:
                        (dbr.getString('logo_casa') || '').indexOf('thesportsdb.com') !== -1
                          ? ''
                          : dbr.getString('logo_casa') || '',
                    },
                    away: {
                      id: 0,
                      name: dbAway,
                      logo:
                        (dbr.getString('logo_visitante') || '').indexOf('thesportsdb.com') !== -1
                          ? ''
                          : dbr.getString('logo_visitante') || '',
                    },
                  },
                  dateSP: targetDate,
                  timeSP: dbHora,
                  provider: 'local_db',
                  sourcePriority: 4,
                })
              }
            }
          } catch (_) {}

          // =================================================================
          // UNIFICAÇÃO & COMBINAÇÃO DAS FONTES (Merge com Priorização)
          // Prioridade em duplicados: API-Football (1) > Football-Data (2) > TheSportsDB (3) > Banco (4)
          // Deduplicação por time_casa + time_fora (normalizados, independente da ordem) + data
          // =================================================================
          var combinedCandidates = []
            .concat(afCollected)
            .concat(fdCollected)
            .concat(tsdbCollected)
            .concat(dbCollected)

          var dedupStoreMap = {}
          for (var cci = 0; cci < combinedCandidates.length; cci++) {
            var cand = combinedCandidates[cci]
            var cHName = (cand.teams && cand.teams.home && cand.teams.home.name) || ''
            var cAName = (cand.teams && cand.teams.away && cand.teams.away.name) || ''
            if (!cHName || !cAName) continue

            var cDate = cand.dateSP || targetDate
            var nHome = normalizeTeamDedup(cHName)
            var nAway = normalizeTeamDedup(cAName)
            var confrontationKey = cDate + '::' + [nHome, nAway].sort().join('___')

            if (!dedupStoreMap[confrontationKey]) {
              dedupStoreMap[confrontationKey] = cand
            } else {
              // Se já temos esse jogo, mantém o de maior prioridade (menor sourcePriority)
              // e enriquece campos faltantes (logos de times, logo de campeonato)
              var existingItem = dedupStoreMap[confrontationKey]
              if (cand.sourcePriority < existingItem.sourcePriority) {
                // Candidato tem maior prioridade: substitui mantendo logos se o novo não tiver
                if (!cand.teams.home.logo && existingItem.teams.home.logo) {
                  cand.teams.home.logo = existingItem.teams.home.logo
                }
                if (!cand.teams.away.logo && existingItem.teams.away.logo) {
                  cand.teams.away.logo = existingItem.teams.away.logo
                }
                if (!cand.league.logo && existingItem.league.logo) {
                  cand.league.logo = existingItem.league.logo
                }
                dedupStoreMap[confrontationKey] = cand
              } else {
                // Item existente tem maior prioridade: enriquece com dados do candidato se faltantes
                if (!existingItem.teams.home.logo && cand.teams.home.logo) {
                  existingItem.teams.home.logo = cand.teams.home.logo
                }
                if (!existingItem.teams.away.logo && cand.teams.away.logo) {
                  existingItem.teams.away.logo = cand.teams.away.logo
                }
                if (!existingItem.league.logo && cand.league.logo) {
                  existingItem.league.logo = cand.league.logo
                }
              }
            }
          }

          var dedupKeys = Object.keys(dedupStoreMap)
          for (var dki = 0; dki < dedupKeys.length; dki++) {
            dayFixturesForDate.push(dedupStoreMap[dedupKeys[dki]])
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

          var displayedCampeonato = (f.league && f.league.name) || tEval.categoria || 'Futebol'
          allFixtures.push({
            id: (f.fixture && f.fixture.id) || 'match_' + allFixtures.length,
            fixture_id: f.fixture && f.fixture.id ? String(f.fixture.id) : '',
            time_a: homeName,
            time_b: awayName,
            campeonato: displayedCampeonato,
            categoria_interna: tEval.categoria || displayedCampeonato,
            prioridade: tEval.prioridade || 10,
            regiao:
              tEval.categoria.indexOf('Brasileir') !== -1
                ? 'Brasileirão & Copas'
                : 'Futebol Europeu',
            data: gameDate,
            horario: gameTime,
            logo_casa:
              f.teams &&
              f.teams.home &&
              f.teams.home.logo &&
              f.teams.home.logo.indexOf('thesportsdb.com') === -1
                ? f.teams.home.logo
                : '',
            logo_visitante:
              f.teams &&
              f.teams.away &&
              f.teams.away.logo &&
              f.teams.away.logo.indexOf('thesportsdb.com') === -1
                ? f.teams.away.logo
                : '',
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
    if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballThrottle) {
      globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 15 * 60 * 1000 }
    }
    var checkApiFootballThrottle = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballThrottle) {
        return { canCall: true, waitMs: 0 }
      }
      var now = Date.now()
      var diff = now - (globalThis.__apiFootballThrottle.lastCallTimestamp || 0)
      var interval = globalThis.__apiFootballThrottle.minIntervalMs || 900000
      if (diff < interval) {
        return { canCall: false, waitMs: interval - diff }
      }
      return { canCall: true, waitMs: 0 }
    }
    var recordApiFootballCall = function () {
      if (typeof globalThis !== 'undefined' && globalThis.__apiFootballThrottle) {
        globalThis.__apiFootballThrottle.lastCallTimestamp = Date.now()
      }
    }

    var BADGE_BACKOFF_DURATION_MS = 60 * 60 * 1000 // 1 HORA PARA ESCUDOS

    var checkBadgeCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__badgeCircuitBreaker) {
        return { shouldSkip: false, isProbe: false }
      }
      var cb = globalThis.__badgeCircuitBreaker
      if (!cb.isBlocked) {
        return { shouldSkip: false, isProbe: false }
      }
      var now = Date.now()
      if (now < cb.blockedUntil) {
        return {
          shouldSkip: true,
          reason: cb.reason || 'Cota de escudos da API-Football esgotada (Badge Breaker ativo)',
        }
      }
      if (!cb.probing) {
        cb.probing = true
        return { shouldSkip: false, isProbe: true }
      }
      return { shouldSkip: true, reason: 'Badge Circuit Breaker em sondagem por outra requisição' }
    }

    var tripBadgeCircuitBreaker = function (reason) {
      if (typeof globalThis === 'undefined') return
      if (!globalThis.__badgeCircuitBreaker) {
        globalThis.__badgeCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
      }
      var cb = globalThis.__badgeCircuitBreaker
      cb.isBlocked = true
      cb.blockedUntil = Date.now() + BADGE_BACKOFF_DURATION_MS
      cb.probing = false
      cb.reason = reason || 'Rate limit / quota exceeded em escudos (429)'
      console.log(
        '[CircuitBreaker Escudos] TRIP ATIVADO por 60 minutos até ' +
          new Date(cb.blockedUntil).toISOString() +
          '. Motivo: ' +
          cb.reason,
      )
    }

    var resetBadgeCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__badgeCircuitBreaker) return
      var cb = globalThis.__badgeCircuitBreaker
      if (cb.isBlocked || cb.probing) {
        console.log('[CircuitBreaker Escudos] RESET: Conexão normalizada com resposta 200.')
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

    // Helper de normalização e similaridade para validação rigorosa de escudos (Edições 4 e 5)
    var sinonimosEscudos = {
      'paris saint germain': 'paris saint germain',
      'paris saint-germain': 'paris saint germain',
      'paris sg': 'paris saint germain',
      psg: 'paris saint germain',
      'olympique de marseille': 'olympique marseille',
      'olympique marseille': 'olympique marseille',
      marseille: 'olympique marseille',
      'olimpia de marsella': 'olympique marseille',
      om: 'olympique marseille',
      'afc bournemouth': 'bournemouth',
      bournemouth: 'bournemouth',
      'atletico madrid': 'atletico madrid',
      'atletico de madrid': 'atletico madrid',
      'club atletico de madrid': 'atletico madrid',
      atleti: 'atletico madrid',
      'liverpool fc': 'liverpool',
      liverpool: 'liverpool',
      internazionale: 'inter milan',
      'inter milan': 'inter milan',
      'inter de milao': 'inter milan',
      'fc internazionale': 'inter milan',
      'sporting cp': 'sporting lisbon',
      'sporting lisbon': 'sporting lisbon',
      'sporting clube de portugal': 'sporting lisbon',
      'athletic club': 'athletic bilbao',
      'athletic bilbao': 'athletic club',
      'real madrid': 'real madrid',
      'real madrid cf': 'real madrid',
      ldu: 'ldu quito',
      'liga de quito': 'ldu quito',
    }

    var normalizarNomeEscudo = function (nome) {
      if (!nome) return ''
      var s = String(nome).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      var rawTokens = s.split(/\s+/).filter(Boolean)
      var rawClean = rawTokens.join(' ').trim()
      if (sinonimosEscudos[rawClean]) return sinonimosEscudos[rawClean]
      var noise = [
        'afc',
        'fc',
        'sc',
        'ac',
        'cf',
        'cd',
        'sd',
        'clube',
        'club',
        'ec',
        'cr',
        'se',
        'de',
        'do',
        'da',
        'dos',
        'das',
        'del',
        'futebol',
        'futbol',
        'sport',
        'association',
        'sociedade',
        'esportiva',
      ]
      var tokens = rawTokens.filter(function (t) {
        return noise.indexOf(t) === -1
      })
      if (tokens.length === 0) return s.replace(/[^a-z0-9]/g, '').trim()
      var clean = tokens.join(' ').trim()
      return sinonimosEscudos[clean] || clean
    }

    var levenshteinBadge = function (a, b) {
      var m = a.length
      var n = b.length
      if (m === 0) return n
      if (n === 0) return m
      var d = []
      for (var i = 0; i <= m; i++) d[i] = [i]
      for (var j = 0; j <= n; j++) d[0][j] = j
      for (var i1 = 1; i1 <= m; i1++) {
        for (var j1 = 1; j1 <= n; j1++) {
          var cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
          d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
        }
      }
      return d[m][n]
    }

    var similaridadeEscudo = function (a, b) {
      var normA = normalizarNomeEscudo(a)
      var normB = normalizarNomeEscudo(b)
      if (!normA || !normB) return 0
      if (normA === normB) return 1
      if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return 0.92
      var tA = normA.split(/\s+/).filter(function (t) {
        return t.length >= 3
      })
      var tB = normB.split(/\s+/).filter(function (t) {
        return t.length >= 3
      })
      var common = false
      for (var ti = 0; ti < tA.length; ti++) {
        if (tB.indexOf(tA[ti]) !== -1) {
          common = true
          break
        }
      }
      if (common && (tA.length <= 2 || tB.length <= 2)) return 0.88
      var maxLen = Math.max(normA.length, normB.length)
      if (maxLen === 0) return 1
      var dist = levenshteinBadge(normA, normB)
      return Math.max(0, 1 - dist / maxLen)
    }

    // Helper unificado de busca de escudo respeitando a ordem e exigindo similaridade >= 0.85:
    // TheSportsDB ELIMINADO TOTALMENTE por diretriz do usuário Douglas.
    // Fontes permitidas:
    // 0) Escudos oficiais conhecidos (PSG, Dinamarca, etc. na API-Sports)
    // 1) Cache em memória (validado, descartando TheSportsDB)
    // 2) Football-Data.org (crest) com similaridade >= 0.85
    var fetchTeamBadgeOrdered = function (teamName) {
      if (!teamName) return ''
      var cleanKey = normalizarNomeEscudo(teamName)

      // 0) Tratamento explícito para escudos oficiais conhecidos da API-Sports
      var KNOWN_OFFICIAL_BADGES = {
        coritiba: 'https://media.api-sports.io/football/teams/132.png',
        chapecoense: 'https://media.api-sports.io/football/teams/147.png',
        'paris saint germain': 'https://media.api-sports.io/football/teams/85.png',
        psg: 'https://media.api-sports.io/football/teams/85.png',
        dinamarca: 'https://media.api-sports.io/football/teams/21.png',
        denmark: 'https://media.api-sports.io/football/teams/21.png',
      }
      if (KNOWN_OFFICIAL_BADGES[cleanKey]) {
        return KNOWN_OFFICIAL_BADGES[cleanKey]
      }

      // 1) Cache em memória
      if (typeof globalThis !== 'undefined' && !globalThis.__officialBadgeCache) {
        globalThis.__officialBadgeCache = {}
      }
      if (
        typeof globalThis !== 'undefined' &&
        globalThis.__officialBadgeCache &&
        globalThis.__officialBadgeCache[cleanKey] !== undefined
      ) {
        var cachedVal = globalThis.__officialBadgeCache[cleanKey] || ''
        // Elimina qualquer resíduo de TheSportsDB
        if (cachedVal && cachedVal.indexOf('thesportsdb.com') !== -1) {
          cachedVal = ''
          globalThis.__officialBadgeCache[cleanKey] = ''
        }
        if (cachedVal) return cachedVal
      }

      var badgeFound = ''

      // 2) Football-Data.org (crest)
      var fdKey = ''
      try {
        var fdRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'football_data_fallback',
        )
        if (fdRec) {
          fdKey = (fdRec.getString('api_key') || '').trim()
        }
      } catch (_) {}
      if (!fdKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('FOOTBALL_DATA_KEY')) {
            fdKey = ($secrets.get('FOOTBALL_DATA_KEY') || '').trim()
          } else if ($os && $os.getenv) {
            fdKey = ($os.getenv('FOOTBALL_DATA_KEY') || '').trim()
          }
        } catch (_) {}
      }

      if (fdKey) {
        try {
          var resFD = $http.send({
            url: 'https://api.football-data.org/v4/teams?name=' + encodeURIComponent(teamName),
            method: 'GET',
            headers: { 'X-Auth-Token': fdKey },
            timeout: 4,
          })
          if (
            resFD.statusCode === 200 &&
            resFD.json &&
            Array.isArray(resFD.json.teams) &&
            resFD.json.teams.length > 0
          ) {
            for (var fdi = 0; fdi < resFD.json.teams.length; fdi++) {
              var fdTeamObj = resFD.json.teams[fdi]
              var fdName = (fdTeamObj && (fdTeamObj.name || fdTeamObj.shortName)) || ''
              if (similaridadeEscudo(teamName, fdName) >= 0.85 && fdTeamObj.crest) {
                badgeFound = String(fdTeamObj.crest).trim()
                if (badgeFound) break
              }
            }
          }
        } catch (errFD) {
          console.log('[Football-Data Escudo] Erro na busca por ' + teamName + ':', errFD)
        }
      }

      // Se a URL encontrada contiver TheSportsDB, anula para nunca devolver essa fonte
      if (badgeFound && badgeFound.indexOf('thesportsdb.com') !== -1) {
        badgeFound = ''
      }

      if (typeof globalThis !== 'undefined' && globalThis.__officialBadgeCache) {
        globalThis.__officialBadgeCache[cleanKey] = badgeFound
      }

      return badgeFound
    }

    try {
      const authRecord = e.auth
      if (!authRecord) {
        return e.unauthorizedError('Usuário não autenticado')
      }

      var teamName = (e.requestInfo().query.team || '').trim()
      if (!teamName) {
        return e.badRequestError('Parâmetro "team" é obrigatório.')
      }

      var badgeResult = fetchTeamBadgeOrdered(teamName)

      return e.json(200, {
        team: teamName,
        badgeUrl: badgeResult,
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
// Busca automática de escudos via cache -> TheSportsDB -> Football-Data.org -> API-Football
// quando logo_casa / logo_visitante estiverem vazios na criação ou edição.
// -------------------------------------------------------------

onRecordCreate((e) => {
  var rec = e.record
  try {
    // Purga escudos do TheSportsDB se porventura vierem no payload
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    if (logoCasa.indexOf('thesportsdb.com') !== -1) {
      rec.set('logo_casa', '')
    }
    if (logoVis.indexOf('thesportsdb.com') !== -1) {
      rec.set('logo_visitante', '')
    }
  } catch (errBadge) {
    console.log('[Escudo enquete_jogos onRecordCreate] Aviso:', errBadge)
  }

  e.next()

  // Recalcula dinamicamente o título da enquete após inserção do jogo
  try {
    var enqueteId = rec.getString('enquete')
    if (enqueteId) {
      var enq = $app.findRecordById('enquetes', enqueteId)
      if (enq) {
        var formatBR = function (iso) {
          if (!iso) return ''
          var parts = iso.split('-')
          if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0]
          return iso
        }
        var jogos = $app.findRecordsByFilter(
          'enquete_jogos',
          "enquete = '" + enqueteId + "'",
          'data,horario',
          500,
          0,
        )
        if (jogos.length > 0) {
          var dMin = jogos[0].getString('data')
          var dMax = jogos[jogos.length - 1].getString('data')
          if (dMin && dMax) {
            enq.set('data_inicio', dMin)
            enq.set('data_fim', dMax)
            $app.save(enq)
          }
        }
      }
    }
  } catch (errRecalc) {
    console.log('[enquete_jogos onRecordCreate] Erro ao recalcular datas da enquete:', errRecalc)
  }
}, 'enquete_jogos')

onRecordUpdate((e) => {
  var rec = e.record
  try {
    // Purga escudos do TheSportsDB se porventura vierem no payload
    var logoCasa = (rec.getString('logo_casa') || '').trim()
    var logoVis = (rec.getString('logo_visitante') || '').trim()
    if (logoCasa.indexOf('thesportsdb.com') !== -1) {
      rec.set('logo_casa', '')
    }
    if (logoVis.indexOf('thesportsdb.com') !== -1) {
      rec.set('logo_visitante', '')
    }
  } catch (errBadge) {
    console.log('[Escudo enquete_jogos onRecordUpdate] Aviso:', errBadge)
  }

  e.next()

  // Recalcula dinamicamente o título da enquete caso data/horário do jogo tenha sido editado
  try {
    var enqueteId = rec.getString('enquete')
    if (enqueteId) {
      var enq = $app.findRecordById('enquetes', enqueteId)
      if (enq) {
        var formatBR = function (iso) {
          if (!iso) return ''
          var parts = iso.split('-')
          if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0]
          return iso
        }
        var jogos = $app.findRecordsByFilter(
          'enquete_jogos',
          "enquete = '" + enqueteId + "'",
          'data,horario',
          500,
          0,
        )
        if (jogos.length > 0) {
          var dMin = jogos[0].getString('data')
          var dMax = jogos[jogos.length - 1].getString('data')
          if (dMin && dMax) {
            enq.set('data_inicio', dMin)
            enq.set('data_fim', dMax)
            $app.save(enq)
          }
        }
      }
    }
  } catch (errRecalc) {
    console.log('[enquete_jogos onRecordUpdate] Erro ao recalcular datas da enquete:', errRecalc)
  }
}, 'enquete_jogos')

onRecordDelete((e) => {
  var rec = e.record
  var enqueteId = rec.getString('enquete')
  var jogoId = rec.id

  e.next()

  // Recalcula dinamicamente o título da enquete após a exclusão do jogo
  try {
    if (enqueteId) {
      var enq = $app.findRecordById('enquetes', enqueteId)
      if (enq) {
        var formatBR = function (iso) {
          if (!iso) return ''
          var parts = iso.split('-')
          if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0]
          return iso
        }
        var jogos = $app.findRecordsByFilter(
          'enquete_jogos',
          "enquete = '" + enqueteId + "'",
          'data,horario',
          500,
          0,
        )
        // Filtra o jogo deletado caso ainda retorne
        var restantes = []
        for (var i = 0; i < jogos.length; i++) {
          if (jogos[i].id !== jogoId) {
            restantes.push(jogos[i])
          }
        }
        var nomeCopa = 'Copa Coni'
        var curTitulo = enq.getString('titulo') || ''
        var matchPrefixo = curTitulo.match(/^(?:Enquete\s+)?([^\-—–]+)/i)
        if (matchPrefixo && matchPrefixo[1].trim()) {
          var parsedPrefixo = matchPrefixo[1].trim()
          if (!/\d/.test(parsedPrefixo)) {
            nomeCopa = parsedPrefixo.replace(/^Enquete\s+/i, '').trim() || nomeCopa
          }
        }
        if (restantes.length > 0) {
          var dMin = restantes[0].getString('data')
          var dMax = restantes[restantes.length - 1].getString('data')
          if (dMin && dMax) {
            enq.set('data_inicio', dMin)
            enq.set('data_fim', dMax)
            $app.save(enq)
          }
        }
      }
    }
  } catch (errRecalc) {
    console.log('[enquete_jogos onRecordDelete] Erro ao recalcular datas da enquete:', errRecalc)
  }
}, 'enquete_jogos')
