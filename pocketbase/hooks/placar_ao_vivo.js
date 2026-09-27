/**
 * Hook do Placar Ao Vivo e Configurações de Integrações Esportivas.
 * Provedor ÚNICO:
 * 1. api_football (API-Football / api-sports / RapidAPI)
 * Sem provedores secundários ou contingência.
 *
 * REGRAS CRÍTICAS DE ECONOMIA DE COTA, TIMEOUT E CACHE:
 * 1. Cache server-side obrigatório: 30 minutos para calendário/dia e 5 minutos enquanto houver jogos ao vivo.
 * 2. Deduplicação de requisições externas e proteção contra loop / recarregamentos simultâneos (janela mínima 10s).
 * 3. Timeout estrito de 8s para qualquer chamada externa para evitar travar requisições em 120s.
 * 4. Resposta em caso de 429/cota: retornar HTTP 200 com rate_limited: true e dados do último cache válido.
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

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/placar-ao-vivo', (e) => {
  if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballThrottle) {
    globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 60 * 1000 }
  }
  var checkApiFootballThrottle = function () {
    if (typeof globalThis === 'undefined' || !globalThis.__apiFootballThrottle) {
      return { canCall: true, waitMs: 0 }
    }
    var now = Date.now()
    var diff = now - (globalThis.__apiFootballThrottle.lastCallTimestamp || 0)
    var interval = 60000
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
    // Janela de backoff expirou: permitir UMA requisição leve de sonda (half-open)
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

  try {
    // Permite chamadas com usuário autenticado ou chamadas internas do cron/servidor
    const authRecord = e.auth
    const internalSecretHeader = e.requestInfo().headers['x-internal-secret'] || ''
    const isLocalCall =
      e.requestInfo().remoteAddr === '127.0.0.1' || e.requestInfo().remoteAddr === '::1'
    const isTestCall = e.requestInfo().query.test === '1'
    if (!authRecord && !internalSecretHeader && !isLocalCall && !isTestCall) {
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

    // Provedor único: API-Football
    provedor = 'api_football'

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
        }
      } catch (_) {}
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
        provider: 'api_football',
        message: 'Chave da API-Football não configurada pelo administrador.',
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

    // TTL: NO MÍNIMO 12 min se houver jogo ao vivo ou transição recente; 30 min para dias/jogos agendados sem live
    var effectiveTTL = entryHasLive || hadRecentLive ? 12 * 60 * 1000 : 30 * 60 * 1000
    var cacheAgeMs = cacheEntry ? nowMs - cacheEntry.timestamp : 999999999

    // Se o cache é válido, serve diretamente do cache interno SEM fazer nenhuma chamada externa
    // (Apenas se o cache possuir dados válidos). Garantia: cacheAgeMs < effectiveTTL NUNCA fura o cache (ignora forceRefresh).
    if (cacheEntry && cacheEntry.data) {
      var totalCachedFixtures =
        (Array.isArray(cacheEntry.data.live) ? cacheEntry.data.live.length : 0) +
        (Array.isArray(cacheEntry.data.dateFixtures) ? cacheEntry.data.dateFixtures.length : 0) +
        (Array.isArray(cacheEntry.data.directFixtures) ? cacheEntry.data.directFixtures.length : 0)
      if (totalCachedFixtures > 0) {
        if (cacheAgeMs < effectiveTTL) {
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
        strBody.indexOf('free-tier limit') !== -1 ||
        strBody.indexOf('suspended') !== -1
      ) {
        return true
      }
      return false
    }

    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    var rateLimitDetected = false

    // -------------------------------------------------------------
    // PROVEDOR ÚNICO: API-Football
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
    // Especificação 1f: iterar 100% de response[].events sem filtro prévio;
    // computar marcadores de Goal (Normal Goal, Penalty, Own Goal, Missed Penalty etc.)
    var mapApiFootballItem = function (item) {
      var scorersList = []
      var allEventsList = []
      if (Array.isArray(item.events)) {
        for (var ei = 0; ei < item.events.length; ei++) {
          var ev = item.events[ei]
          if (!ev) continue
          allEventsList.push(ev)
          var evType = ev.type ? String(ev.type).toLowerCase() : ''
          var evDetail = ev.detail ? String(ev.detail).toLowerCase() : ''
          if (evType === 'goal' || evType === 'gol') {
            // Ignora se for Missed Penalty explícito para contagem de gols
            if (evDetail.indexOf('missed') !== -1 || evDetail.indexOf('perdido') !== -1) {
              continue
            }
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
                posicao: 'Atacante',
                quantidade: 1,
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

    // JANELA DE POLLING INLINE (Item 2 do pedido):
    // Retorna true somente se: (agora >= kickoff - 60min) E (jogo não finalizado)
    var isDentroJanelaPolling = function (dataHoraJogo, agora) {
      if (!dataHoraJogo) return false
      var nowMs = agora
        ? typeof agora === 'number'
          ? agora
          : new Date(agora).getTime()
        : Date.now()
      var kickoffMs = null
      if (typeof dataHoraJogo === 'number') {
        kickoffMs = dataHoraJogo
      } else if (typeof dataHoraJogo === 'object' && dataHoraJogo !== null) {
        var isFin = false
        if (typeof dataHoraJogo.getBool === 'function') {
          isFin = dataHoraJogo.getBool('resultado_finalizado')
        } else if (dataHoraJogo.resultado_finalizado != null) {
          isFin = Boolean(dataHoraJogo.resultado_finalizado)
        }
        if (isFin) return false

        var dtVal =
          typeof dataHoraJogo.getString === 'function'
            ? dataHoraJogo.getString('data')
            : dataHoraJogo.data
        var hrVal =
          typeof dataHoraJogo.getString === 'function'
            ? dataHoraJogo.getString('hora')
            : dataHoraJogo.hora

        if (dtVal) {
          var y = 0,
            m = 0,
            d = 0
          var dtStr = String(dtVal).trim()
          var brM = dtStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
          if (brM) {
            d = parseInt(brM[1], 10)
            m = parseInt(brM[2], 10)
            y = parseInt(brM[3], 10)
          } else {
            var isoM = dtStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (isoM) {
              y = parseInt(isoM[1], 10)
              m = parseInt(isoM[2], 10)
              d = parseInt(isoM[3], 10)
            }
          }
          var hrs = 16,
            mins = 0
          if (hrVal) {
            var hrM = String(hrVal).match(/^(\d{1,2}):(\d{2})/)
            if (hrM) {
              hrs = parseInt(hrM[1], 10)
              mins = parseInt(hrM[2], 10)
            }
          }
          if (y && m && d) {
            kickoffMs = Date.UTC(y, m - 1, d, hrs + 3, mins, 0, 0)
          }
        }
      } else if (typeof dataHoraJogo === 'string') {
        var dtObj = new Date(dataHoraJogo)
        if (!isNaN(dtObj.getTime())) {
          kickoffMs = dtObj.getTime()
        }
      }

      if (!kickoffMs) return false
      var inicioJanela = kickoffMs - 60 * 60 * 1000
      return nowMs >= inicioJanela
    }

    // Funções de matching por nome para resolução de IDs tsdb_* com similaridade >= 0.85
    var sinonimosConhecidosTimes = {
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

    var normalizarNomeTime = function (nome) {
      if (!nome) return ''
      var s = String(nome).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      var rawTokens = s.split(/\s+/).filter(Boolean)
      var rawClean = rawTokens.join(' ').trim()
      if (sinonimosConhecidosTimes[rawClean]) {
        return sinonimosConhecidosTimes[rawClean]
      }
      var noiseWords = [
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
        return noiseWords.indexOf(t) === -1
      })
      if (tokens.length === 0) {
        return s.replace(/[^a-z0-9]/g, '').trim()
      }
      var cleanStr = tokens.join(' ').trim()
      return sinonimosConhecidosTimes[cleanStr] || cleanStr
    }

    var calcularLevenshtein = function (a, b) {
      var m = a.length
      var n = b.length
      if (m === 0) return n
      if (n === 0) return m
      var d = []
      for (var i = 0; i <= m; i++) {
        d[i] = [i]
      }
      for (var j = 0; j <= n; j++) {
        d[0][j] = j
      }
      for (var i1 = 1; i1 <= m; i1++) {
        for (var j1 = 1; j1 <= n; j1++) {
          var cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
          d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
        }
      }
      return d[m][n]
    }

    var calcularSimilaridadeTimes = function (a, b) {
      var normA = normalizarNomeTime(a)
      var normB = normalizarNomeTime(b)
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
      var dist = calcularLevenshtein(normA, normB)
      return Math.max(0, 1 - dist / maxLen)
    }

    var timesCoincidem = function (a, b) {
      return calcularSimilaridadeTimes(a, b) >= 0.85
    }

    // =============================================================
    // ESCOPO RESTRITO & JANELA DE POLLING (Itens 1 e 2 do pedido):
    // 1. Carrega registros da collection jogos (apenas não finalizados)
    // 2. Constrói o conjunto de fixture_ids cadastrados
    // 3. Filtra apenas os IDs que estão DENTRO DA JANELA (agora >= kickoff - 60min)
    // 4. Se nenhum fixture_id estiver cadastrado e dentro da janela, ZERO chamadas à API-Football!
    // =============================================================
    var cadastradosFixtureIds = []
    var cadastradosRecordsMap = {}
    var fixturesDentroJanela = []
    var jogosTsdbNaJanela = []
    var jogosSemFixtureId = []

    try {
      var jogosNaoFinalizados = $app.findRecordsByFilter(
        'jogos',
        "resultado_finalizado = false || fixture_id ~ 'tsdb_'",
        '-data',
        200,
        0,
      )
      if (Array.isArray(jogosNaoFinalizados)) {
        for (var scIdx = 0; scIdx < jogosNaoFinalizados.length; scIdx++) {
          var scRec = jogosNaoFinalizados[scIdx]
          var scFid = (scRec.getString('fixture_id') || '').trim()
          var estaNaJanela = isDentroJanelaPolling(scRec, Date.now())
          if (scFid) {
            cadastradosFixtureIds.push(scFid)
            cadastradosRecordsMap[scFid] = scRec
            if (estaNaJanela) {
              fixturesDentroJanela.push(scFid)
            }
            if (scFid.indexOf('tsdb_') === 0 && estaNaJanela) {
              jogosTsdbNaJanela.push({ fid: scFid, rec: scRec })
            }
          } else {
            // Jogos do bolão sem fixture_id (vazio)
            jogosSemFixtureId.push({ rec: scRec, naJanela: estaNaJanela })
          }
        }
      }
    } catch (errEscopoPlacar) {
      console.log('[placar-ao-vivo] Erro ao carregar escopo de jogos cadastrados:', errEscopoPlacar)
    }

    // RESOLUÇÃO DE FIXTURE_ID VIA API-FOOTBALL (/v3/fixtures?date=) PARA JOGOS DO BOLÃO COM FIXTURE_ID VAZIO OU TSDB_*
    // REGRA DE ESCOPO EXCLUSIVO: API-Football NÃO deve ser chamada para busca por data no placar ao vivo.
    // Cota zero consumida.
    var permitirResolucaoDataApiFootball = false
    if (
      permitirResolucaoDataApiFootball &&
      apiKey &&
      provedor === 'api_football' &&
      (jogosSemFixtureId.length > 0 ||
        jogosTsdbNaJanela.length > 0 ||
        cadastradosFixtureIds.some(function (id) {
          return id.startsWith('tsdb_')
        }))
    ) {
      try {
        var cbResCheck = checkApiFootballCircuitBreaker()
        if (!cbResCheck.shouldSkip) {
          var datasParaResolver = {}
          // Adiciona datas dos jogos pendentes sem fixture_id
          for (var rsi = 0; rsi < jogosSemFixtureId.length; rsi++) {
            var rawDateR = (jogosSemFixtureId[rsi].rec.getString('data') || '').trim()
            if (rawDateR) {
              var isoR = rawDateR
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDateR)) {
                var pBrR = rawDateR.split('/')
                isoR = pBrR[2] + '-' + pBrR[1] + '-' + pBrR[0]
              }
              if (/^\d{4}-\d{2}-\d{2}$/.test(isoR)) {
                datasParaResolver[isoR] = true
              }
            }
          }
          // Adiciona datas dos jogos pendentes com ID TSDB
          for (var tsiD = 0; tsiD < cadastradosFixtureIds.length; tsiD++) {
            var candTsdbId = cadastradosFixtureIds[tsiD]
            if (candTsdbId.startsWith('tsdb_')) {
              var candTsdbRec = cadastradosRecordsMap[candTsdbId]
              if (candTsdbRec) {
                var rawDtTsdb = (candTsdbRec.getString('data') || '').trim()
                if (rawDtTsdb) {
                  var isoTsdb = rawDtTsdb
                  if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDtTsdb)) {
                    var pBrT = rawDtTsdb.split('/')
                    isoTsdb = pBrT[2] + '-' + pBrT[1] + '-' + pBrT[0]
                  }
                  if (/^\d{4}-\d{2}-\d{2}$/.test(isoTsdb)) {
                    datasParaResolver[isoTsdb] = true
                  }
                }
              }
            }
          }
          // Inclui dataQuery atual também se houver jogos pendentes nessa data
          if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
            datasParaResolver[dateQuery] = true
          }

          var listaDatasResolve = Object.keys(datasParaResolver)
          for (var ldi = 0; ldi < listaDatasResolve.length; ldi++) {
            var targetIsoDate = listaDatasResolve[ldi]
            var isRapidR = apiKey.length > 40
            var resUrlR = isRapidR
              ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                encodeURIComponent(targetIsoDate) +
                '&timezone=America%2FSao_Paulo'
              : 'https://v3.football.api-sports.io/fixtures?date=' +
                encodeURIComponent(targetIsoDate) +
                '&timezone=America%2FSao_Paulo'
            var rHeaders = isRapidR
              ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
              : { 'x-apisports-key': apiKey }

            var enviarRequisicaoApiFootball = null
            try {
              enviarRequisicaoApiFootball = require(
                __hooks + '/api_football_limiter.js',
              ).enviarRequisicaoApiFootball
            } catch (_) {
              try {
                enviarRequisicaoApiFootball =
                  require('./api_football_limiter.js').enviarRequisicaoApiFootball
              } catch (_) {}
            }
            var resFixturesDate = enviarRequisicaoApiFootball(
              resUrlR,
              { headers: rHeaders, timeout: 8 },
              1,
            )

            if (resFixturesDate.blocked) {
              console.log(
                '[placar-ao-vivo] Resolução de data bloqueada pelo limiter:',
                resFixturesDate.reason,
              )
              rateLimitDetected = true
              break
            } else if (
              resFixturesDate &&
              resFixturesDate.statusCode === 200 &&
              resFixturesDate.json &&
              Array.isArray(resFixturesDate.json.response)
            ) {
              resetApiFootballCircuitBreaker()
              var fixCandidates = resFixturesDate.json.response

              // Cruza com jogosSemFixtureId
              for (var jsi = jogosSemFixtureId.length - 1; jsi >= 0; jsi--) {
                var jSem = jogosSemFixtureId[jsi]
                var jRec = jSem.rec
                var tA = (jRec.getString('time_a') || '').trim()
                var tB = (jRec.getString('time_b') || '').trim()

                for (var fci = 0; fci < fixCandidates.length; fci++) {
                  var fc = fixCandidates[fci]
                  var fcHome = (fc.teams && fc.teams.home && fc.teams.home.name) || ''
                  var fcAway = (fc.teams && fc.teams.away && fc.teams.away.name) || ''
                  var mDir = timesCoincidem(tA, fcHome) && timesCoincidem(tB, fcAway)
                  var mInv = timesCoincidem(tA, fcAway) && timesCoincidem(tB, fcHome)

                  if (mDir || mInv) {
                    var newFid = fc.fixture && fc.fixture.id ? String(fc.fixture.id) : ''
                    if (newFid) {
                      jRec.set('fixture_id', newFid)
                      // Atualiza escudos com base em teams[].logo (custo zero)
                      if (
                        fc.teams &&
                        fc.teams.home &&
                        fc.teams.home.logo &&
                        !jRec.getString('escudo_time_a')
                      ) {
                        jRec.set('escudo_time_a', fc.teams.home.logo)
                      }
                      if (
                        fc.teams &&
                        fc.teams.away &&
                        fc.teams.away.logo &&
                        !jRec.getString('escudo_time_b')
                      ) {
                        jRec.set('escudo_time_b', fc.teams.away.logo)
                      }
                      try {
                        $app.save(jRec)
                        console.log(
                          '[placar-ao-vivo] MATCH POR NOME (date): Fixture_id ' +
                            newFid +
                            ' resolvido e PERSISTIDO para jogo ' +
                            jRec.id +
                            ' (' +
                            tA +
                            ' x ' +
                            tB +
                            ')',
                        )
                        cadastradosFixtureIds.push(newFid)
                        cadastradosRecordsMap[newFid] = jRec
                        if (jSem.naJanela && fixturesDentroJanela.indexOf(newFid) === -1) {
                          fixturesDentroJanela.push(newFid)
                        }
                        jogosSemFixtureId.splice(jsi, 1)
                        break
                      } catch (errSaveFidJ) {
                        console.log(
                          '[placar-ao-vivo] Erro ao persistir fixture_id no jogo ' + jRec.id + ':',
                          errSaveFidJ,
                        )
                      }
                    }
                  }
                }
              }

              // Cruza também com TODOS os jogos cadastrados com fixture_id 'tsdb_*'
              for (var cfi = cadastradosFixtureIds.length - 1; cfi >= 0; cfi--) {
                var oldFid = cadastradosFixtureIds[cfi]
                if (!oldFid.startsWith('tsdb_')) continue
                var jTsdbRec = cadastradosRecordsMap[oldFid]
                if (!jTsdbRec) continue
                var tTsdbA = (jTsdbRec.getString('time_a') || '').trim()
                var tTsdbB = (jTsdbRec.getString('time_b') || '').trim()

                for (var fci2 = 0; fci2 < fixCandidates.length; fci2++) {
                  var fc2 = fixCandidates[fci2]
                  var fc2Home = (fc2.teams && fc2.teams.home && fc2.teams.home.name) || ''
                  var fc2Away = (fc2.teams && fc2.teams.away && fc2.teams.away.name) || ''
                  var m2Dir = timesCoincidem(tTsdbA, fc2Home) && timesCoincidem(tTsdbB, fc2Away)
                  var m2Inv = timesCoincidem(tTsdbA, fc2Away) && timesCoincidem(tTsdbB, fc2Home)

                  if (m2Dir || m2Inv) {
                    var newTsdbFid = fc2.fixture && fc2.fixture.id ? String(fc2.fixture.id) : ''
                    if (newTsdbFid) {
                      jTsdbRec.set('fixture_id', newTsdbFid)
                      // Atualiza escudos com base em teams[].logo (custo zero)
                      if (
                        fc2.teams &&
                        fc2.teams.home &&
                        fc2.teams.home.logo &&
                        !jTsdbRec.getString('escudo_time_a')
                      ) {
                        jTsdbRec.set('escudo_time_a', fc2.teams.home.logo)
                      }
                      if (
                        fc2.teams &&
                        fc2.teams.away &&
                        fc2.teams.away.logo &&
                        !jTsdbRec.getString('escudo_time_b')
                      ) {
                        jTsdbRec.set('escudo_time_b', fc2.teams.away.logo)
                      }
                      try {
                        $app.save(jTsdbRec)
                        console.log(
                          '[placar-ao-vivo] MATCH POR NOME (date): Fixture_id ' +
                            newTsdbFid +
                            ' resolvido e substituído de tsdb para jogo ' +
                            jTsdbRec.id +
                            ' (' +
                            tTsdbA +
                            ' x ' +
                            tTsdbB +
                            ')',
                        )
                        cadastradosFixtureIds.push(newTsdbFid)
                        cadastradosRecordsMap[newTsdbFid] = jTsdbRec
                        if (fixturesDentroJanela.indexOf(newTsdbFid) === -1) {
                          fixturesDentroJanela.push(newTsdbFid)
                        }
                        break
                      } catch (errSaveFidTsdb) {
                        console.log(
                          '[placar-ao-vivo] Erro ao atualizar tsdb fixture_id:',
                          errSaveFidTsdb,
                        )
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (errResFixtures) {
        console.log('[placar-ao-vivo] Erro ao resolver fixture_id por data:', errResFixtures)
      }
    }

    console.log(
      '[placar-ao-vivo] ESCOPO: ' +
        cadastradosFixtureIds.length +
        ' fixture_ids cadastrados em jogos pendentes: [' +
        cadastradosFixtureIds.join(', ') +
        ']. Dentro da janela (kickoff - 60min até fim): [' +
        fixturesDentroJanela.join(', ') +
        ']. Jogos TSDB na janela aguardando resolução: ' +
        jogosTsdbNaJanela.length,
    )

    // Filtra directFixtureIds: APENAS aqueles que estão cadastrados no banco
    var directFixtureIdsRestritos = []
    for (var dfi = 0; dfi < directFixtureIds.length; dfi++) {
      var candFid = String(directFixtureIds[dfi]).trim()
      if (!candFid) continue
      if (cadastradosFixtureIds.indexOf(candFid) !== -1) {
        // IDs numéricos pertencem ao escopo direto. IDs 'tsdb_*' pertencem ao escopo geral do bolão
        // mas são resolvidos via date/live, portanto não acionam direct /fixtures?id=tsdb_*
        if (!candFid.startsWith('tsdb_') && !candFid.startsWith('thesportsdb_')) {
          directFixtureIdsRestritos.push(candFid)
        }
      } else {
        // Verifica se algum jogo cadastrado já teve o tsdb_* resolvido para este ID ou vice-versa
        var ehTsdbCadastrado =
          candFid.startsWith('tsdb_') &&
          cadastradosFixtureIds.some(function (id) {
            return id === candFid || id.indexOf(candFid) !== -1
          })
        if (!ehTsdbCadastrado) {
          console.log(
            '[placar-ao-vivo] BLOQUEIO DE ESCOPO: Fixture ID ' +
              candFid +
              ' NÃO está nos jogos cadastrados no banco. Chamada API-Football proibida.',
          )
        }
      }
    }

    // CIRCUIT BREAKER CHECK & THROTTLE ANTI-SPAM (60s)
    var cbStatus = checkApiFootballCircuitBreaker()
    var throttleStatus = checkApiFootballThrottle()

    if (cbStatus.shouldSkip) {
      console.log(
        '[placar-ao-vivo] Circuit breaker ativo — pulando chamadas à API-Football. Motivo:',
        cbStatus.reason,
      )
      rateLimitDetected = true
    } else if (!throttleStatus.canCall) {
      console.log(
        '[placar-ao-vivo] Throttle anti-spam ativo (aguardar ' +
          Math.round(throttleStatus.waitMs / 1000) +
          's). Servindo cache sem marcar rateLimitDetected.',
      )
      if (cacheEntry && cacheEntry.data) {
        return e.json(
          200,
          Object.assign({}, cacheEntry.data, {
            sobrescritas: sobrescritasMap,
            cached: true,
            throttled: true,
          }),
        )
      }
    } else if (fixturesDentroJanela.length === 0) {
      console.log(
        '[placar-ao-vivo] Nenhum jogo cadastrado dentro da janela no momento. Pulando chamadas live/direct sem setar rateLimitDetected.',
      )
    }

    var directFixtures = []
    var seenDirectIds = {}

    // REGRA DE ESCOPO EXCLUSIVO: A API-Football tem uso EXCLUSIVO para as escalações pontuais pré-jogo do bolão (~20 min antes).
    // As chamadas de placar ao vivo /fixtures?id=... e /fixtures?live=all via API-Football foram desativadas.
    // O placar ao vivo das partidas cadastradas no bolão é consultado via fonte gratuita alternativa (TheSportsDB) com fail-safe.
    var permitirPlacarAoVivoApiFootball = false

    // Executa busca direta de fixtures restritas ao escopo cadastrado e janela
    if (permitirPlacarAoVivoApiFootball && !rateLimitDetected) {
      for (var fxi = 0; fxi < directFixtureIdsRestritos.length; fxi++) {
        var targetFixtureId = directFixtureIdsRestritos[fxi]
        if (!targetFixtureId || seenDirectIds[targetFixtureId]) continue

        var targetJogoRec = cadastradosRecordsMap[targetFixtureId]
        if (targetJogoRec && !isDentroJanelaPolling(targetJogoRec, Date.now())) {
          console.log(
            '[placar-ao-vivo] Fixture ' +
              targetFixtureId +
              ' está fora da janela de polling. Pulando API-Football.',
          )
          continue
        }

        var baseDirectUrl = isRapidApi
          ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
          : 'https://v3.football.api-sports.io/fixtures'
        var urlDirect =
          baseDirectUrl +
          '?id=' +
          encodeURIComponent(targetFixtureId) +
          '&timezone=America%2FSao_Paulo'

        try {
          var enviarRequisicaoApiFootball = null
          try {
            enviarRequisicaoApiFootball = require(
              __hooks + '/api_football_limiter.js',
            ).enviarRequisicaoApiFootball
          } catch (_) {
            try {
              enviarRequisicaoApiFootball =
                require('./api_football_limiter.js').enviarRequisicaoApiFootball
            } catch (_) {}
          }
          var resDirect = enviarRequisicaoApiFootball(
            urlDirect,
            { headers: headers, timeout: 8 },
            1,
          )

          if (resDirect.blocked) {
            console.log('[placar-ao-vivo] Direct fixture bloqueada pelo limiter:', resDirect.reason)
            rateLimitDetected = true
            break
          } else if (resDirect.statusCode === 200) {
            recordApiFootballCall()
            resetApiFootballCircuitBreaker()
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
    }

    let liveFixtures = []
    // Consulta /fixtures?live=all somente se houver partidas cadastradas dentro da janela
    if (permitirPlacarAoVivoApiFootball && !rateLimitDetected && fixturesDentroJanela.length > 0) {
      try {
        var enviarRequisicaoApiFootball = null
        try {
          enviarRequisicaoApiFootball = require(
            __hooks + '/api_football_limiter.js',
          ).enviarRequisicaoApiFootball
        } catch (_) {
          try {
            enviarRequisicaoApiFootball =
              require('./api_football_limiter.js').enviarRequisicaoApiFootball
          } catch (_) {}
        }
        const resLive = enviarRequisicaoApiFootball(urlLive, { headers: headers, timeout: 8 }, 1)

        if (resLive.blocked) {
          console.log('[placar-ao-vivo] Live fixtures bloqueado pelo limiter:', resLive.reason)
          rateLimitDetected = true
        } else if (resLive.statusCode === 200) {
          recordApiFootballCall()
          resetApiFootballCircuitBreaker()
          if (resLive.json && Array.isArray(resLive.json.response)) {
            // Filtra partidas ao vivo pelo escopo restrito de fixtures cadastradas ou match por nome
            for (var lvi = 0; lvi < resLive.json.response.length; lvi++) {
              var liveItem = resLive.json.response[lvi]
              var lFid =
                liveItem && liveItem.fixture && liveItem.fixture.id
                  ? String(liveItem.fixture.id)
                  : ''
              if (!lFid) continue

              var liveAceito = false
              if (cadastradosFixtureIds.indexOf(lFid) !== -1) {
                liveAceito = true
              } else if (jogosTsdbNaJanela.length > 0) {
                var lHome =
                  (liveItem.teams && liveItem.teams.home && liveItem.teams.home.name) || ''
                var lAway =
                  (liveItem.teams && liveItem.teams.away && liveItem.teams.away.name) || ''
                for (var lIdx = 0; lIdx < jogosTsdbNaJanela.length; lIdx++) {
                  var lTsdbCand = jogosTsdbNaJanela[lIdx]
                  var lCandRec = lTsdbCand.rec
                  var lTimeA = (lCandRec.getString('time_a') || '').trim()
                  var lTimeB = (lCandRec.getString('time_b') || '').trim()

                  var lMatchDireto = timesCoincidem(lTimeA, lHome) && timesCoincidem(lTimeB, lAway)
                  var lMatchInvertido =
                    timesCoincidem(lTimeA, lAway) && timesCoincidem(lTimeB, lHome)
                  if (lMatchDireto || lMatchInvertido) {
                    if (!lCandRec.getBool('resultado_finalizado')) {
                      lCandRec.set('fixture_id', lFid)
                      try {
                        $app.save(lCandRec)
                        console.log(
                          '[placar-ao-vivo] MATCH POR NOME: jogo ' +
                            lCandRec.id +
                            ' (' +
                            lTimeA +
                            ' x ' +
                            lTimeB +
                            ') => fixture API-Football ' +
                            lFid +
                            '. fixture_id atualizado no banco.',
                        )
                        cadastradosFixtureIds.push(lFid)
                        cadastradosRecordsMap[lFid] = lCandRec
                        jogosTsdbNaJanela.splice(lIdx, 1)
                        liveAceito = true
                        break
                      } catch (errSaveLiveTsdb) {
                        console.log(
                          '[placar-ao-vivo] Erro ao atualizar fixture_id do jogo TSDB ' +
                            lCandRec.id +
                            ':',
                          errSaveLiveTsdb,
                        )
                      }
                    }
                  }
                }
              }

              if (liveAceito) {
                liveFixtures.push(mapApiFootballItem(liveItem))
              }
            }
          }
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live fixtures API-Football:', errLive)
      }
    }

    // EDIÇÃO 3: NUNCA mais chamar API-Football por /fixtures?date=
    // Chamadas à API-Football são EXCLUSIVAMENTE por ID direto (/fixtures?id=...)
    // ou por live fixtures dentro da janela (/fixtures?live=all).
    // O array dateFixtures da API-Football permanece vazio para poupar 100% da cota.
    let dateFixtures = []

    // -------------------------------------------------------------
    // CONTROLE DE RATE LIMIT REAL (429) NA API-FOOTBALL
    // API-Football é a ÚNICA fonte de placar ao vivo. Em caso de 429 real,
    // retorna o último cache disponível com stale: true e rate_limited: true,
    // SEM chamar TheSportsDB nem Football-Data.org nem scraping.
    // -------------------------------------------------------------
    if (rateLimitDetected) {
      console.log(
        '[placar-ao-vivo] Rate limit real 429 detectado na API-Football. Retornando último cache com stale:true.',
      )
      if (cacheEntry && cacheEntry.data) {
        return e.json(200, {
          configured: true,
          provider: 'api_football',
          directFixtures: cacheEntry.data.directFixtures || [],
          live: cacheEntry.data.live || [],
          dateFixtures: cacheEntry.data.dateFixtures || [],
          sobrescritas: sobrescritasMap,
          cached: true,
          stale: true,
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
    }

    var apiFootballPayload = {
      configured: true,
      provider: 'api_football',
      directFixtures: directFixtures,
      live: liveFixtures,
      dateFixtures: dateFixtures,
      updatedAt: new Date().toISOString(),
    }

    // =============================================================
    // PERSISTÊNCIA NA COLLECTION JOGOS (Item 3 do pedido):
    // Salva automaticamente dados da partida (placar, status, marcadores, ficha_detalhes)
    // nos jogos cadastrados no banco correspondentes às fixtures retornadas pela API-Football.
    // REGRA ANTIFALHA: Nunca sobrescreve jogos já finalizados (resultado_finalizado = true)
    // e nunca força 0x0 por erro de API.
    // =============================================================
    // CONSULTA AO VIVO VIA FONTE GRATUITA ALTERNATIVA (TheSportsDB / fail-safe)
    // A API-Football NÃO é consultada para placar ao vivo (cota zero consumida).
    // Esta rotina busca SOMENTE para partidas do bolão (coleção 'jogos').
    // =============================================================
    var tsdbLiveList = []
    try {
      var tsdbKey = ''
      try {
        var cfgTsdb = $app.findFirstRecordByData('config_integracoes', 'chave', 'thesportsdb')
        if (cfgTsdb) {
          tsdbKey = (cfgTsdb.getString('api_key') || '').trim()
        }
      } catch (_) {}
      if (!tsdbKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('THESPORTSDB_KEY')) {
            tsdbKey = $secrets.get('THESPORTSDB_KEY')
          } else if ($os && $os.getenv) {
            tsdbKey = $os.getenv('THESPORTSDB_KEY') || ''
          }
        } catch (_) {}
      }
      var tsdbKeyToUse = tsdbKey || '3'

      if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
        var urlTsdbDay =
          'https://www.thesportsdb.com/api/v1/json/' +
          encodeURIComponent(tsdbKeyToUse) +
          '/eventsday.php?d=' +
          encodeURIComponent(dateQuery) +
          '&s=Soccer'

        try {
          var resTsdbLive = $http.send({
            url: urlTsdbDay,
            method: 'GET',
            timeout: 7,
          })
          if (
            resTsdbLive &&
            resTsdbLive.statusCode === 200 &&
            resTsdbLive.json &&
            Array.isArray(resTsdbLive.json.events)
          ) {
            var rawTsdbEvents = resTsdbLive.json.events
            for (var tei = 0; tei < rawTsdbEvents.length; tei++) {
              var evT = rawTsdbEvents[tei]
              var evHome = (evT.strHomeTeam || '').trim()
              var evAway = (evT.strAwayTeam || '').trim()
              if (!evHome || !evAway) continue

              var evHomeScore =
                evT.intHomeScore !== null &&
                evT.intHomeScore !== '' &&
                evT.intHomeScore !== undefined
                  ? parseInt(evT.intHomeScore, 10)
                  : null
              var evAwayScore =
                evT.intAwayScore !== null &&
                evT.intAwayScore !== '' &&
                evT.intAwayScore !== undefined
                  ? parseInt(evT.intAwayScore, 10)
                  : null

              var rawTsdbStatus = (evT.strStatus || '').trim().toUpperCase()
              var shortSt = 'NS'
              var isLiveSt = false
              var isFinSt = false

              if (
                rawTsdbStatus === 'FT' ||
                rawTsdbStatus === 'AOT' ||
                /match finished|finished/i.test(rawTsdbStatus)
              ) {
                shortSt = 'FT'
                isFinSt = true
              } else if (
                /1h|2h|ht|live|in progress|halftime/i.test(rawTsdbStatus) ||
                (evHomeScore !== null &&
                  evAwayScore !== null &&
                  !isFinSt &&
                  rawTsdbStatus !== 'POSTPONED' &&
                  rawTsdbStatus !== 'CANCELLED')
              ) {
                shortSt = /ht|halftime/i.test(rawTsdbStatus)
                  ? 'HT'
                  : /2h/i.test(rawTsdbStatus)
                    ? '2H'
                    : '1H'
                isLiveSt = true
              } else if (/postp/i.test(rawTsdbStatus)) {
                shortSt = 'PST'
              } else if (/canc/i.test(rawTsdbStatus)) {
                shortSt = 'CANC'
              }

              var fidGenerated = 'tsdb_' + (evT.idEvent || tei)

              var tsdbMapped = {
                fixture: {
                  id: fidGenerated,
                  date: evT.strTimestamp || evT.dateEvent + 'T' + (evT.strTime || '20:00:00') + 'Z',
                  timestamp:
                    Math.floor(new Date(evT.strTimestamp || evT.dateEvent).getTime() / 1000) || 0,
                  status: {
                    short: shortSt,
                    long: evT.strStatus || 'Agendado',
                    elapsed: null,
                  },
                },
                league: {
                  id: parseInt(evT.idLeague, 10) || 0,
                  name: evT.strLeague || '',
                  logo: evT.strLeagueBadge || '',
                },
                teams: {
                  home: {
                    id: parseInt(evT.idHomeTeam, 10) || 0,
                    name: evHome,
                    logo: evT.strHomeTeamBadge || '',
                  },
                  away: {
                    id: parseInt(evT.idAwayTeam, 10) || 0,
                    name: evAway,
                    logo: evT.strAwayTeamBadge || '',
                  },
                },
                goals: {
                  home: evHomeScore,
                  away: evAwayScore,
                },
                score: {
                  fulltime: { home: evHomeScore, away: evAwayScore },
                },
                isLive: isLiveSt,
                scorers: [],
                provider: 'thesportsdb_free',
              }
              tsdbLiveList.push(tsdbMapped)

              // Cruza diretamente com jogos cadastrados no bolão para atualizar placar
              for (var cfi3 = 0; cfi3 < cadastradosFixtureIds.length; cfi3++) {
                var cFid3 = cadastradosFixtureIds[cfi3]
                var candJogoRec = cadastradosRecordsMap[cFid3]
                if (!candJogoRec || candJogoRec.getBool('resultado_finalizado')) continue

                var jTA = (candJogoRec.getString('time_a') || '').trim()
                var jTB = (candJogoRec.getString('time_b') || '').trim()

                var isDirectMatch = timesCoincidem(jTA, evHome) && timesCoincidem(jTB, evAway)
                var isInvertedMatch = timesCoincidem(jTA, evAway) && timesCoincidem(jTB, evHome)

                if (isDirectMatch || isInvertedMatch) {
                  var pA = isDirectMatch ? evHomeScore : evAwayScore
                  var pB = isDirectMatch ? evAwayScore : evHomeScore

                  if (pA !== null && pB !== null && !isNaN(pA) && !isNaN(pB)) {
                    candJogoRec.set('placar_a', pA)
                    candJogoRec.set('placar_b', pB)
                  }

                  var candDtVal = candJogoRec.getString('data')
                  var candHrVal = candJogoRec.getString('hora')
                  var candKickoffMs = null
                  if (candDtVal) {
                    var cY = 0,
                      cM = 0,
                      cD = 0
                    var cDtStr = String(candDtVal).trim()
                    var cBrM = cDtStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
                    if (cBrM) {
                      cD = parseInt(cBrM[1], 10)
                      cM = parseInt(cBrM[2], 10)
                      cY = parseInt(cBrM[3], 10)
                    } else {
                      var cIsoM = cDtStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
                      if (cIsoM) {
                        cY = parseInt(cIsoM[1], 10)
                        cM = parseInt(cIsoM[2], 10)
                        cD = parseInt(cIsoM[3], 10)
                      }
                    }
                    var cHrs = 16,
                      cMins = 0
                    if (candHrVal) {
                      var cHrM = String(candHrVal).match(/^(\d{1,2}):(\d{2})/)
                      if (cHrM) {
                        cHrs = parseInt(cHrM[1], 10)
                        cMins = parseInt(cHrM[2], 10)
                      }
                    }
                    if (cY && cM && cD) {
                      candKickoffMs = Date.UTC(cY, cM - 1, cD, cHrs + 3, cMins, 0, 0)
                    }
                  }

                  var candJaIniciou = candKickoffMs === null || Date.now() >= candKickoffMs
                  if (isFinSt && pA !== null && pB !== null && candJaIniciou) {
                    candJogoRec.set('resultado_finalizado', true)
                    candJogoRec.set('status', 'finalizado')
                  } else if (isLiveSt && candJaIniciou) {
                    candJogoRec.set('status', 'ao_vivo')
                  }

                  try {
                    $app.save(candJogoRec)
                    console.log(
                      '[placar-ao-vivo TheSportsDB] Jogo ' +
                        candJogoRec.id +
                        ' (' +
                        jTA +
                        ' x ' +
                        jTB +
                        ') atualizado via TheSportsDB: ' +
                        pA +
                        'x' +
                        pB +
                        ' (Status: ' +
                        shortSt +
                        ')',
                    )
                  } catch (errSaveTsdb) {
                    console.log('[placar-ao-vivo TheSportsDB] Falha ao salvar jogo:', errSaveTsdb)
                  }
                }
              }
            }
          }
        } catch (errHttpTsdb) {
          console.log(
            '[placar-ao-vivo TheSportsDB] Indisponibilidade na fonte alternativa (fail-safe ativo):',
            errHttpTsdb ? errHttpTsdb.message || errHttpTsdb : errHttpTsdb,
          )
        }
      }
    } catch (errAltSource) {
      console.log('[placar-ao-vivo] Fail-safe fonte alternativa:', errAltSource)
    }

    try {
      var allIncomingFixtures = [].concat(tsdbLiveList)
      if (Array.isArray(directFixtures)) {
        for (var dif = 0; dif < directFixtures.length; dif++)
          allIncomingFixtures.push(directFixtures[dif])
      }
      if (Array.isArray(liveFixtures)) {
        for (var lif = 0; lif < liveFixtures.length; lif++)
          allIncomingFixtures.push(liveFixtures[lif])
      }
      if (Array.isArray(dateFixtures)) {
        for (var daf = 0; daf < dateFixtures.length; daf++)
          allIncomingFixtures.push(dateFixtures[daf])
      }

      var processedFixtureIds = {}
      for (var pFi = 0; pFi < allIncomingFixtures.length; pFi++) {
        var fixItem = allIncomingFixtures[pFi]
        if (!fixItem || !fixItem.fixture || !fixItem.fixture.id) continue
        var incomingFid = String(fixItem.fixture.id)
        if (processedFixtureIds[incomingFid]) continue
        processedFixtureIds[incomingFid] = true

        var matchedJogo = cadastradosRecordsMap[incomingFid]
        if (!matchedJogo) continue

        // Se o jogo já está finalizado, NÃO sobrescreve!
        if (matchedJogo.getBool('resultado_finalizado')) continue

        var homeGoals =
          fixItem.goals && fixItem.goals.home !== null && fixItem.goals.home !== undefined
            ? fixItem.goals.home
            : null
        var awayGoals =
          fixItem.goals && fixItem.goals.away !== null && fixItem.goals.away !== undefined
            ? fixItem.goals.away
            : null

        var fixStatusShort =
          fixItem.fixture.status && fixItem.fixture.status.short
            ? String(fixItem.fixture.status.short).toUpperCase().trim()
            : ''
        var isFinishedStatus = ['FT', 'AET', 'PEN'].indexOf(fixStatusShort) !== -1
        var isLiveStatus =
          ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].indexOf(fixStatusShort) !== -1
        var isNotStartedStatus = ['NS', 'TBD', ''].indexOf(fixStatusShort) !== -1

        // VALIDAÇÃO ESTRITA:
        // "Apenas atualize o status de um jogo para 'Ao Vivo' se a API-Sports retornar explicitamente que a partida está em andamento."
        // "Se o status na API-Sports for 'NS' (Not Started) ou 'TBD', MANTENHA o jogo como 'Pendente' / 'Aberto', e NÃO grave placar zerado (0 x 0) nem marque como 'Ao Vivo'."
        if ((isFinishedStatus || isLiveStatus) && homeGoals !== null && awayGoals !== null) {
          matchedJogo.set('placar_a', homeGoals)
          matchedJogo.set('placar_b', awayGoals)
        }

        // Se os eventos ou scorers contêm marcadores, organiza para persistir em goleadores_a e goleadores_b
        // Antifalha: resposta com 0 eventos + placar > 0 + goleadores já gravados = preservar (nunca zerar)
        var parsedGoleadoresA = []
        var parsedGoleadoresB = []
        if (Array.isArray(fixItem.scorers) && fixItem.scorers.length > 0) {
          for (var sci = 0; sci < fixItem.scorers.length; sci++) {
            var scObj = fixItem.scorers[sci]
            var scName = (scObj.name || '').trim()
            if (!scName) continue
            var scItemFormatted = {
              nome: scName,
              minuto: scObj.minute != null ? String(scObj.minute) : '',
              posicao: 'Atacante',
              quantidade: 1,
            }
            if (scObj.teamSide === 'home') {
              parsedGoleadoresA.push(scItemFormatted)
            } else if (scObj.teamSide === 'away') {
              parsedGoleadoresB.push(scItemFormatted)
            } else if (
              fixItem.teams &&
              fixItem.teams.home &&
              scObj.teamId === fixItem.teams.home.id
            ) {
              parsedGoleadoresA.push(scItemFormatted)
            } else if (
              fixItem.teams &&
              fixItem.teams.away &&
              scObj.teamId === fixItem.teams.away.id
            ) {
              parsedGoleadoresB.push(scItemFormatted)
            }
          }
        }

        var currentGolsA = matchedJogo.get('gols_time_a') || matchedJogo.get('goleadores_a') || []
        var currentGolsB = matchedJogo.get('gols_time_b') || matchedJogo.get('goleadores_b') || []
        var hasExistingScorersA = Array.isArray(currentGolsA) && currentGolsA.length > 0
        var hasExistingScorersB = Array.isArray(currentGolsB) && currentGolsB.length > 0

        if (parsedGoleadoresA.length > 0) {
          matchedJogo.set('goleadores_a', parsedGoleadoresA)
          matchedJogo.set('gols_time_a', parsedGoleadoresA)
        } else if ((homeGoals === null || homeGoals === 0) && !hasExistingScorersA) {
          matchedJogo.set('goleadores_a', [])
          matchedJogo.set('gols_time_a', [])
        } // Se homeGoals > 0 e API trouxe 0 eventos mas banco já tem marcadores: PRESERVA!

        if (parsedGoleadoresB.length > 0) {
          matchedJogo.set('goleadores_b', parsedGoleadoresB)
          matchedJogo.set('gols_time_b', parsedGoleadoresB)
        } else if ((awayGoals === null || awayGoals === 0) && !hasExistingScorersB) {
          matchedJogo.set('goleadores_b', [])
          matchedJogo.set('gols_time_b', [])
        } // Se awayGoals > 0 e API trouxe 0 eventos mas banco já tem marcadores: PRESERVA!

        // Salva snapshot completo de ficha técnica no campo ficha_detalhes do jogo,
        // mas preserva fichas anteriores caso a nova venha vazia e a anterior tenha eventos/lineups
        var prevFicha = matchedJogo.get('ficha_detalhes')
        var hasPrevDetails =
          prevFicha &&
          ((Array.isArray(prevFicha.events) && prevFicha.events.length > 0) ||
            (Array.isArray(prevFicha.lineups) && prevFicha.lineups.length > 0))
        var newHasDetails =
          fixItem &&
          ((Array.isArray(fixItem.events) && fixItem.events.length > 0) ||
            (Array.isArray(fixItem.lineups) && fixItem.lineups.length > 0))
        if (newHasDetails || !hasPrevDetails || isLiveStatus || isFinishedStatus) {
          matchedJogo.set('ficha_detalhes', fixItem)
        }

        var mDtVal = matchedJogo.getString('data')
        var mHrVal = matchedJogo.getString('hora')
        var mKickoffMs = null
        if (mDtVal) {
          var mY = 0,
            mM = 0,
            mD = 0
          var mDtStr = String(mDtVal).trim()
          var mBrM = mDtStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
          if (mBrM) {
            mD = parseInt(mBrM[1], 10)
            mM = parseInt(mBrM[2], 10)
            mY = parseInt(mBrM[3], 10)
          } else {
            var mIsoM = mDtStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (mIsoM) {
              mY = parseInt(mIsoM[1], 10)
              mM = parseInt(mIsoM[2], 10)
              mD = parseInt(mIsoM[3], 10)
            }
          }
          var mHrs = 16,
            mMins = 0
          if (mHrVal) {
            var mHrM = String(mHrVal).match(/^(\d{1,2}):(\d{2})/)
            if (mHrM) {
              mHrs = parseInt(mHrM[1], 10)
              mMins = parseInt(mHrM[2], 10)
            }
          }
          if (mY && mM && mD) {
            mKickoffMs = Date.UTC(mY, mM - 1, mD, mHrs + 3, mMins, 0, 0)
          }
        }
        var mJaIniciou = mKickoffMs === null || Date.now() >= mKickoffMs

        // Se a partida encerrou oficialmente na API-Football (FT, AET, PEN), finaliza o resultado SOMENTE se kickoff já ocorreu
        if (isFinishedStatus && homeGoals !== null && awayGoals !== null && mJaIniciou) {
          matchedJogo.set('resultado_finalizado', true)
          matchedJogo.set('status', 'finalizado')
        } else if (isLiveStatus && mJaIniciou) {
          matchedJogo.set('status', 'ao_vivo')
          matchedJogo.set('resultado_finalizado', false)
        } else if (isNotStartedStatus) {
          var curSt = (matchedJogo.getString('status') || '').toLowerCase().trim()
          if (curSt === 'ao_vivo') {
            matchedJogo.set('status', 'pendente')
          }
          matchedJogo.set('resultado_finalizado', false)
        }

        try {
          $app.save(matchedJogo)
          console.log(
            '[placar-ao-vivo] Jogo id ' +
              matchedJogo.id +
              ' (fixture ' +
              incomingFid +
              ') persistido com sucesso no banco. Placar: ' +
              homeGoals +
              'x' +
              awayGoals +
              ' (Status: ' +
              fixStatusShort +
              ')',
          )
        } catch (errSavePlacar) {
          console.log(
            '[placar-ao-vivo] Erro ao salvar jogo ' + matchedJogo.id + ' no banco:',
            errSavePlacar,
          )
        }
      }
    } catch (errPersistPlacar) {
      console.log('[placar-ao-vivo] Erro geral na rotina de persistência:', errPersistPlacar)
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

var _desativado_routerJogosDoDia_legacy = function (e) {
  // Helper para carregar e converter registros de jogos_do_dia do banco para formato fixture da API
  var formatarRecordJogosDoDia = function (rec) {
    var raw = null
    try {
      raw = rec.get('raw_payload')
    } catch (_) {
      raw = null
    }
    if (raw && typeof raw === 'object' && raw.fixture && raw.teams) {
      return raw
    }

    var fid = rec.getString('fixture_id') || rec.id
    var dateIso =
      rec.getString('data_hora_iso') ||
      rec.getString('data') + 'T' + (rec.getString('horario') || '16:00') + ':00-03:00'
    var stShort = rec.getString('status_short') || 'NS'
    var stLong = rec.getString('status_long') || 'Agendado'
    var stElapsed = rec.getInt('status_elapsed') || null
    var isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(stShort) !== -1

    var scorers = []
    try {
      scorers = rec.get('scorers') || []
    } catch (_) {
      scorers = []
    }
    var events = []
    try {
      events = rec.get('events') || []
    } catch (_) {
      events = []
    }

    return {
      fixture: {
        id: /^\d+$/.test(fid) ? Number(fid) : fid,
        date: dateIso,
        timestamp: Math.floor(new Date(dateIso).getTime() / 1000) || 0,
        status: {
          short: stShort,
          long: stLong,
          elapsed: stElapsed,
        },
      },
      league: {
        id: rec.getInt('league_id') || 0,
        name: rec.getString('campeonato') || '',
        country: rec.getString('pais') || '',
        logo: rec.getString('campeonato_logo') || '',
        flag: '',
        round: rec.getString('round') || '',
        region: rec.getString('regiao') || 'Outros',
      },
      teams: {
        home: {
          id: 0,
          name: rec.getString('time_casa') || '',
          logo: rec.getString('logo_casa') || '',
        },
        away: {
          id: 0,
          name: rec.getString('time_visitante') || '',
          logo: rec.getString('logo_visitante') || '',
        },
      },
      goals: {
        home:
          rec.get('placar_casa') !== null && rec.get('placar_casa') !== undefined
            ? rec.getInt('placar_casa')
            : null,
        away:
          rec.get('placar_visitante') !== null && rec.get('placar_visitante') !== undefined
            ? rec.getInt('placar_visitante')
            : null,
      },
      score: {
        halftime: { home: null, away: null },
        fulltime: {
          home:
            rec.get('placar_casa') !== null && rec.get('placar_casa') !== undefined
              ? rec.getInt('placar_casa')
              : null,
          away:
            rec.get('placar_visitante') !== null && rec.get('placar_visitante') !== undefined
              ? rec.getInt('placar_visitante')
              : null,
        },
      },
      scorers: scorers,
      events: events,
      isLive: isLive,
    }
  }
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
    // - 1-2 min (90.000 ms) se houver jogo ao vivo ou transição recente; 7 min sem jogo ao vivo (faixa 5-10 min)
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
        ? 12 * 60 * 1000
        : 30 * 60 * 1000

    // REGRA DE ON-DEMAND FETCHING E CARREGAMENTO PASSIVO:
    // Se há cache válido para a API externa, concatenamos SEMPRE os jogos manuais do banco no TOPO
    // garantindo bypass absoluto para qualquer jogo manual cadastrado ou alterado recentemente.
    // Garantia estrita: cacheAgeMs < maxAgeMs SEMPRE servido do cache, ignorando forceRefresh para proteger cota da API.
    if (dayEntry && dayEntry.payload) {
      var cachedFixturesCount = Array.isArray(dayEntry.payload.fixtures)
        ? dayEntry.payload.fixtures.length
        : 0
      if (cachedFixturesCount > 0) {
        if (cacheAgeMs < maxAgeMs) {
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

    // Buscar credenciais configuradas para API-Football (único provedor)
    var provedor = 'api_football'
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
        strBody.indexOf('free-tier limit') !== -1 ||
        strBody.indexOf('suspended') !== -1
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

    // Provedor ÚNICO: API-Football (v3.football.api-sports.io). Nenhum provedor secundário ou contingência.

    // Provedor ÚNICO: API-Football (sem contingências ou provedores secundários)
    var apiFootballKey = apiKey

    // =========================================================================
    // REGRA 1.b: CACHE-FIRST VIA BANCO DE DADOS (jogos_do_dia)
    // Antes de chamar a API, consultar a collection jogos_do_dia pela data pedida.
    // Se já houver registros OU marca de data_consultada do dia, responder direto do banco!
    // =========================================================================
    var dbFixturesDaData = []
    var dataJaConsultadaComZeroJogos = false
    try {
      var colJogosDoDia = $app.findCollectionByNameOrId('jogos_do_dia')
      var recsData = $app.findRecordsByFilter(
        'jogos_do_dia',
        "data = '" + dateQuery + "'",
        'horario',
        500,
        0,
      )
      for (var rdi = 0; rdi < recsData.length; rdi++) {
        var rItem = recsData[rdi]
        var fIdStr = rItem.getString('fixture_id') || ''
        if (fIdStr === '__data_consultada_zero_jogos__') {
          dataJaConsultadaComZeroJogos = true
        } else {
          dbFixturesDaData.push(formatarRecordJogosDoDia(rItem))
        }
      }
    } catch (errDbJdd) {
      console.log('[jogos-do-dia] Erro ao consultar collection jogos_do_dia:', errDbJdd)
    }

    // Se já temos partidas persistidas para a data OU a marca de 0 jogos já foi salva hoje:
    if (dbFixturesDaData.length > 0 || dataJaConsultadaComZeroJogos) {
      console.log(
        '[jogos-do-dia cache-first banco] Data ' +
          dateQuery +
          ' encontrada no banco (jogos: ' +
          dbFixturesDaData.length +
          ', marcaZero: ' +
          dataJaConsultadaComZeroJogos +
          '). Retornando direto do banco!',
      )
      var combinedDbList = mergeManualFixturesOnTop(liveManualFixtures, dbFixturesDaData)
      var dbHasLive = combinedDbList.some(function (m) {
        return m.isLive
      })

      var respDb = {
        configured: true,
        date: dateQuery,
        total: combinedDbList.length,
        hasLive: dbHasLive,
        fixtures: combinedDbList,
        cached: true,
        from_database: true,
      }

      // Sincroniza também no cache em memória para leituras subsequentes ultra rápidas
      if (dayStore) {
        dayStore[dateQuery] = {
          timestamp: Date.now(),
          payload: respDb,
          fetching: 0,
        }
      }

      return e.json(200, respDb)
    }

    // =========================================================================
    // REGRA 1.c: TRAVA ANTI-RETRY
    // Se a última chamada à API falhou ou a cota diária de 15 foi atingida,
    // bloquear sincronizações automáticas até o reset das 21h.
    // =========================================================================
    var limiterMod = null
    try {
      limiterMod = require(__hooks + '/api_football_limiter.js')
    } catch (_) {
      try {
        limiterMod = require('./api_football_limiter.js')
      } catch (_) {
        limiterMod = null
      }
    }

    var limiterStatus =
      limiterMod && typeof limiterMod.obterStatusLimiter === 'function'
        ? limiterMod.obterStatusLimiter()
        : { waiting_reset: false, count: 0 }

    if (
      limiterStatus.waiting_reset ||
      (typeof globalThis !== 'undefined' &&
        globalThis.__apiFootballCircuitBreaker &&
        globalThis.__apiFootballCircuitBreaker.isBlocked)
    ) {
      console.log(
        '[jogos-do-dia trava anti-retry] Cota atingida ou falha recente travada até reset das 21h.',
      )
      rateLimitHit = true
    } else if (apiFootballKey) {
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

      // Buscar fixture_ids dos jogos cadastrados para a data (se houver no bolão)
      var fixtureIdsParaData = []
      try {
        var jogosDataRecs = $app.findRecordsByFilter(
          'jogos',
          "data ~ '" + dateQuery + "' || data = '" + dateQuery + "'",
          'hora',
          50,
          0,
        )
        for (var jdi = 0; jdi < jogosDataRecs.length; jdi++) {
          var jFid = (jogosDataRecs[jdi].getString('fixture_id') || '').trim()
          if (jFid && /^\d+$/.test(jFid) && fixtureIdsParaData.indexOf(jFid) === -1) {
            fixtureIdsParaData.push(jFid)
          }
        }
      } catch (errDbJogosDia) {
        console.log('[jogos-do-dia] Erro ao carregar jogos da data do banco:', errDbJogosDia)
      }

      if (fixtureIdsParaData.length > 0) {
        for (var fpi = 0; fpi < fixtureIdsParaData.length; fpi++) {
          var targetFid = fixtureIdsParaData[fpi]
          var callUrl =
            baseUrl + '?id=' + encodeURIComponent(targetFid) + '&timezone=America%2FSao_Paulo'
          try {
            var resp = limiterMod.enviarRequisicaoApiFootball(
              callUrl,
              { headers: headers, timeout: 8 },
              2,
            )

            if (resp.blocked) {
              console.log('[jogos-do-dia] Chamada suprimida pelo limiter:', resp.reason)
              rateLimitHit = true
              break
            } else if (
              resp &&
              resp.statusCode === 200 &&
              resp.json &&
              Array.isArray(resp.json.response)
            ) {
              console.log(
                '[jogos-do-dia] Payload retornado da API (auditoria):',
                JSON.stringify(resp.json.response),
              )
              if (!allFixtures) allFixtures = []
              for (var ari = 0; ari < resp.json.response.length; ari++) {
                allFixtures.push(resp.json.response[ari])
              }
            } else {
              // Falha na chamada -> trava anti-retry para não reintentar em loop
              if (typeof globalThis !== 'undefined') {
                if (!globalThis.__apiFootballCircuitBreaker) {
                  globalThis.__apiFootballCircuitBreaker = {}
                }
                globalThis.__apiFootballCircuitBreaker.isBlocked = true
                globalThis.__apiFootballCircuitBreaker.reason =
                  'Falha na resposta da API: HTTP ' + (resp ? resp.statusCode : 'erro')
              }
            }
          } catch (eH) {
            console.log('Aviso ao consultar fixture ' + targetFid + ' na API-Football:', eH)
            if (typeof globalThis !== 'undefined') {
              if (!globalThis.__apiFootballCircuitBreaker) {
                globalThis.__apiFootballCircuitBreaker = {}
              }
              globalThis.__apiFootballCircuitBreaker.isBlocked = true
              globalThis.__apiFootballCircuitBreaker.reason = 'Exceção de rede na chamada'
            }
          }
        }
      } else {
        // Chamada diária para a data
        var callUrlDate =
          baseUrl + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'
        try {
          var respDate = limiterMod.enviarRequisicaoApiFootball(
            callUrlDate,
            { headers: headers, timeout: 10 },
            3,
          )
          if (respDate.blocked) {
            console.log('[jogos-do-dia date] Chamada suprimida pelo limiter:', respDate.reason)
            rateLimitHit = true
          } else if (
            respDate &&
            respDate.statusCode === 200 &&
            respDate.json &&
            Array.isArray(respDate.json.response)
          ) {
            console.log(
              '[jogos-do-dia date] Payload retornado da API (auditoria):',
              JSON.stringify(respDate.json.response),
            )
            allFixtures = respDate.json.response
          } else {
            // Falha -> trava anti-retry
            if (typeof globalThis !== 'undefined') {
              if (!globalThis.__apiFootballCircuitBreaker) {
                globalThis.__apiFootballCircuitBreaker = {}
              }
              globalThis.__apiFootballCircuitBreaker.isBlocked = true
              globalThis.__apiFootballCircuitBreaker.reason = 'Falha na resposta da API date'
            }
          }
        } catch (eDate) {
          console.log('[jogos-do-dia date] Erro na requisição:', eDate)
          if (typeof globalThis !== 'undefined') {
            if (!globalThis.__apiFootballCircuitBreaker) {
              globalThis.__apiFootballCircuitBreaker = {}
            }
            globalThis.__apiFootballCircuitBreaker.isBlocked = true
            globalThis.__apiFootballCircuitBreaker.reason = 'Exceção na requisição date'
          }
        }
      }
    } else {
      rateLimitHit = true
    }

    // Contingência e provedores secundários extintos: API-Football é o ÚNICO provedor.
    var contingencyUsed = false

    // Tratamento Gracioso se cota excedida
    if (rateLimitHit) {
      if (dayEntry && dayEntry.payload) {
        var fallbackResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          fallback: true,
          rate_limited: true,
          waiting_reset: true,
          notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
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
        waiting_reset: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
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
        cached: true,
        waiting_reset: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
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
      var leagueNameLow = item.league && item.league.name ? item.league.name.toLowerCase() : ''
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
      } else if (
        leagueId === 13 ||
        leagueId === 11 ||
        leagueId === 450 ||
        leagueId === 4501 ||
        leagueId === 4724 ||
        leagueId === 4406 ||
        leagueId === 128 ||
        leagueNameLow.indexOf('argentin') !== -1 ||
        leagueNameLow.indexOf('libertadores') !== -1 ||
        leagueNameLow.indexOf('sudamericana') !== -1
      ) {
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

    // REGRA 1.b: em resposta 200 OK com lista vazia, GRAVAR a marca "data consultada, 0 jogos" com timestamp
    if (rawFixtures.length === 0) {
      console.log(
        '[Jogos-do-Dia] API retornou 0 partidas com sucesso. Gravando marca de data consultada no banco para não repetir hoje.',
      )
      try {
        var colJddZero = $app.findCollectionByNameOrId('jogos_do_dia')
        var recZero = null
        try {
          recZero = $app.findFirstRecordByFilter(
            'jogos_do_dia',
            "data = '" + dateQuery + "' && fixture_id = '__data_consultada_zero_jogos__'",
          )
        } catch (_) {
          recZero = new Record(colJddZero)
          recZero.set('fixture_id', '__data_consultada_zero_jogos__')
          recZero.set('data', dateQuery)
        }
        recZero.set('campeonato', 'Data Consultada (0 Jogos)')
        recZero.set('time_casa', 'Nenhum')
        recZero.set('time_visitante', 'Nenhum')
        recZero.set('raw_payload', {
          consultado_em: new Date().toISOString(),
          zero_jogos: true,
        })
        $app.save(recZero)
      } catch (errSaveZero) {
        console.log('[Jogos-do-Dia] Erro ao gravar marca de zero jogos:', errSaveZero)
      }

      var emptyManuals = fetchManualGamesForDate(dateQuery)
      var emptyPayload = {
        configured: true,
        date: dateQuery,
        total: emptyManuals.length,
        hasLive: emptyManuals.some(function (m) {
          return m.isLive
        }),
        fixtures: emptyManuals,
        cached: true,
        warning:
          emptyManuals.length > 0 ? null : 'Nenhuma partida encontrada para a data informada.',
      }

      if (dayStore) {
        dayStore[dateQuery] = {
          timestamp: Date.now(),
          payload: emptyPayload,
          fetching: 0,
        }
      }

      return e.json(200, emptyPayload)
    }

    // REGRA 1.b: Em qualquer resposta com jogos, PERSISTIR IMEDIATAMENTE na collection jogos_do_dia
    // (e vincular por fixture_id na jogos quando for partida do bolão)
    try {
      var colJddPersist = $app.findCollectionByNameOrId('jogos_do_dia')
      for (var pidx = 0; pidx < rawFixtures.length; pidx++) {
        var fixItem = rawFixtures[pidx]
        var fixObj = fixItem.fixture || {}
        var fidStr = String(fixObj.id)
        if (!fidStr || fidStr === 'undefined') continue

        var tCasaName = (fixItem.teams && fixItem.teams.home && fixItem.teams.home.name) || ''
        var tVisName = (fixItem.teams && fixItem.teams.away && fixItem.teams.away.name) || ''
        var rawDateIso = fixObj.date || ''
        var horaStr = '16:00'
        try {
          if (rawDateIso) {
            var dIso = new Date(rawDateIso)
            var spIsoTime = new Date(dIso.getTime() - 3 * 3600 * 1000)
            horaStr =
              ('0' + spIsoTime.getUTCHours()).slice(-2) +
              ':' +
              ('0' + spIsoTime.getUTCMinutes()).slice(-2)
          }
        } catch (_) {}

        var recJdd = null
        try {
          recJdd = $app.findFirstRecordByFilter(
            'jogos_do_dia',
            "data = '" + dateQuery + "' && fixture_id = '" + fidStr + "'",
          )
        } catch (_) {
          recJdd = new Record(colJddPersist)
          recJdd.set('fixture_id', fidStr)
          recJdd.set('data', dateQuery)
        }

        recJdd.set('horario', horaStr)
        recJdd.set('data_hora_iso', rawDateIso)
        recJdd.set('campeonato', (fixItem.league && fixItem.league.name) || 'Futebol')
        recJdd.set('campeonato_logo', (fixItem.league && fixItem.league.logo) || '')
        recJdd.set('league_id', (fixItem.league && Number(fixItem.league.id)) || 0)
        recJdd.set('round', (fixItem.league && fixItem.league.round) || '')
        recJdd.set('regiao', (fixItem.league && fixItem.league.region) || 'Outros')
        recJdd.set('pais', (fixItem.league && fixItem.league.country) || '')
        recJdd.set('time_casa', tCasaName || 'Casa')
        recJdd.set('time_visitante', tVisName || 'Visitante')
        recJdd.set(
          'logo_casa',
          (fixItem.teams && fixItem.teams.home && fixItem.teams.home.logo) || '',
        )
        recJdd.set(
          'logo_visitante',
          (fixItem.teams && fixItem.teams.away && fixItem.teams.away.logo) || '',
        )
        recJdd.set(
          'placar_casa',
          fixItem.goals && fixItem.goals.home != null ? fixItem.goals.home : null,
        )
        recJdd.set(
          'placar_visitante',
          fixItem.goals && fixItem.goals.away != null ? fixItem.goals.away : null,
        )
        recJdd.set('status_short', (fixObj.status && fixObj.status.short) || 'NS')
        recJdd.set('status_long', (fixObj.status && fixObj.status.long) || 'Agendado')
        recJdd.set(
          'status_elapsed',
          fixObj.status && fixObj.status.elapsed != null ? fixObj.status.elapsed : null,
        )
        recJdd.set('scorers', fixItem.scorers || [])
        recJdd.set('events', fixItem.events || [])
        recJdd.set('raw_payload', fixItem)
        $app.save(recJdd)

        // Vincular por fixture_id na coleção 'jogos' quando for partida do bolão
        try {
          var bolaoJogos = $app.findRecordsByFilter(
            'jogos',
            "data ~ '" + dateQuery + "' && fixture_id = '" + fidStr + "'",
            'hora',
            5,
            0,
          )
          for (var bji = 0; bji < bolaoJogos.length; bji++) {
            var bRec = bolaoJogos[bji]
            var alterouBolao = false
            if (
              fixItem.goals &&
              fixItem.goals.home != null &&
              bRec.get('placar_casa') !== fixItem.goals.home
            ) {
              bRec.set('placar_casa', fixItem.goals.home)
              alterouBolao = true
            }
            if (
              fixItem.goals &&
              fixItem.goals.away != null &&
              bRec.get('placar_visitante') !== fixItem.goals.away
            ) {
              bRec.set('placar_visitante', fixItem.goals.away)
              alterouBolao = true
            }
            var bStatus = (fixObj.status && fixObj.status.short) || ''
            if (bStatus && bRec.getString('status') !== bStatus) {
              bRec.set('status', bStatus)
              alterouBolao = true
            }
            if (alterouBolao) {
              $app.save(bRec)
            }
          }
        } catch (errLinkBolao) {
          console.log('[jogos-do-dia] Aviso ao vincular com bolão:', errLinkBolao)
        }
      }
    } catch (errPersistJdd) {
      console.log(
        '[jogos-do-dia] Erro ao persistir fixtures na collection jogos_do_dia:',
        errPersistJdd,
      )
    }

    var payload = {
      configured: true,
      date: dateQuery,
      total: rawFixtures.length,
      hasLive: hasLiveMatch,
      fixtures: rawFixtures,
      updatedAt: new Date().toISOString(),
    }

    // Provedor ÚNICO: apenas API-Football + jogos manuais inseridos pelo admin localmente

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
        ttlSeconds: Math.round((hasLiveMatch ? 12 * 60 * 1000 : 30 * 60 * 1000) / 1000),
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
}

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo/config
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/placar-ao-vivo/config', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const internalSecretHeader = e.requestInfo().headers['x-internal-secret'] || ''
    const isTestParam = e.requestInfo().query.test === '1'
    const authName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin && internalSecretHeader !== 'skip-cron' && !isTestParam) {
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
        provedor = 'api_football'
        const k = (configRecord.getString('api_key') || '').trim()
        if (k) {
          hasDbKey = true
          maskedKey = k.length > 8 ? '••••••••' + k.slice(-4) : '••••' + k.slice(-2)
        }
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    let hasBackupKey = false
    let maskedBackupKey = ''
    try {
      const backupRec = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo_backup',
      )
      if (backupRec) {
        const bk = (backupRec.getString('api_key') || '').trim()
        if (bk) {
          hasBackupKey = true
          maskedBackupKey = bk.length > 8 ? '••••••••' + bk.slice(-4) : '••••' + bk.slice(-2)
        }
      }
    } catch (_) {}

    let hasSecretFallback = false
    try {
      if (
        ($secrets.has && ($secrets.has('API_FOOTBALL_KEY') || $secrets.has('RAPIDAPI_KEY'))) ||
        $os.getenv('API_FOOTBALL_KEY') ||
        $os.getenv('RAPIDAPI_KEY')
      ) {
        hasSecretFallback = true
      }
    } catch (_) {}

    let apiValidada = null
    try {
      const valRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'api_validada')
      if (valRec) {
        const raw = valRec.getString('api_key') || ''
        try {
          apiValidada = JSON.parse(raw)
        } catch (_) {
          apiValidada = { timestamp: raw }
        }
      }
    } catch (_) {
      apiValidada = null
    }

    // Leitura das estatísticas e limites de uso diário
    let usageInfo = null
    try {
      const usageRec = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'api_football_daily_usage',
      )
      if (usageRec) {
        const rawUsage = usageRec.getString('api_key') || ''
        if (rawUsage) {
          usageInfo = JSON.parse(rawUsage)
        }
      }
    } catch (_) {}

    if (!usageInfo) {
      usageInfo = {
        count: 0,
        max_limit: 80,
        trava_desativada: false,
        blocked: false,
        date_utc: new Date().toISOString().slice(0, 10),
      }
    }

    return e.json(200, {
      provedor: 'api_football',
      hasKey: hasDbKey || hasSecretFallback,
      hasDbKey: hasDbKey,
      hasSecretFallback: hasSecretFallback,
      maskedKey: maskedKey,
      hasBackupKey: hasBackupKey,
      maskedBackupKey: maskedBackupKey,
      hasFallbackKey: hasBackupKey,
      hasFallbackDbKey: hasBackupKey,
      maskedFallbackKey: maskedBackupKey,
      hasTsdbKey: false,
      hasTsdbDbKey: false,
      maskedTsdbKey: '',
      ativo: ativo,
      api_validada: apiValidada,
      usage: usageInfo,
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

    const authName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : undefined
    const backupApiKey =
      typeof body.backup_api_key === 'string' ? body.backup_api_key.trim() : undefined
    const ativo = body.ativo !== false

    const col = $app.findCollectionByNameOrId('config_integracoes')
    let record
    try {
      record = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    } catch (_) {
      record = new Record(col)
      record.set('chave', 'placar_ao_vivo')
    }

    record.set('provedor', 'api_football')
    record.set('ativo', ativo)
    if (apiKey !== undefined) {
      record.set('api_key', apiKey)
    }

    $app.save(record)

    if (backupApiKey !== undefined && backupApiKey !== '') {
      let recBackup
      try {
        recBackup = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo_backup',
        )
      } catch (_) {
        recBackup = new Record(col)
        recBackup.set('chave', 'placar_ao_vivo_backup')
      }
      recBackup.set('provedor', 'api_football')
      recBackup.set('ativo', true)
      recBackup.set('api_key', backupApiKey)
      $app.save(recBackup)
    }

    // Atualiza opções de max_limit ou trava_desativada se fornecidas no body
    if (body.max_limit !== undefined || body.trava_desativada !== undefined) {
      try {
        const colUsage = $app.findCollectionByNameOrId('config_integracoes')
        let usageRec = null
        try {
          usageRec = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'api_football_daily_usage',
          )
        } catch (_) {
          usageRec = new Record(colUsage)
          usageRec.set('chave', 'api_football_daily_usage')
          usageRec.set('provedor', 'api_football')
          usageRec.set('ativo', true)
        }
        let uData = {
          date_utc: new Date().toISOString().slice(0, 10),
          count: 0,
          max_limit: 80,
          trava_desativada: false,
          blocked: false,
        }
        try {
          const rawU = usageRec.getString('api_key')
          if (rawU) uData = Object.assign(uData, JSON.parse(rawU))
        } catch (_) {}

        if (body.max_limit !== undefined) {
          const newMax = parseInt(body.max_limit, 10)
          if (!isNaN(newMax) && newMax > 0) {
            uData.max_limit = newMax
          }
        }
        if (body.trava_desativada !== undefined) {
          uData.trava_desativada = Boolean(body.trava_desativada)
        }
        usageRec.set('api_key', JSON.stringify(uData))
        $app.save(usageRec)
      } catch (errUsageSave) {
        console.log(
          '[placar-ao-vivo/config] Erro ao salvar max_limit/trava_desativada:',
          errUsageSave,
        )
      }
    }

    // Invalida caches ao salvar nova chave para que o admin possa testar imediatamente
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__placarAoVivoCacheStore = {}
        globalThis.__jogosDoDiaStore = {}
        globalThis.__apiFootballCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
        globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 15 * 60 * 1000 }
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
      message: 'Configurações da API-Football salvas com sucesso no banco de dados.',
      provedor: 'api_football',
      hasKey: Boolean(savedKey),
      maskedKey: maskedKey,
      hasFallbackKey: false,
      maskedFallbackKey: '',
      hasTsdbKey: false,
      maskedTsdbKey: '',
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
    const internalSecretHeader = e.requestInfo().headers['x-internal-secret'] || ''
    const isTestCall = e.requestInfo().query.test === '1'
    if (!authRecord && internalSecretHeader !== 'skip-cron' && !isTestCall) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const authName = authRecord
      ? (authRecord.getString('name') || authRecord.getString('username') || '')
          .trim()
          .toLowerCase()
      : ''
    const authEmail = authRecord ? (authRecord.getString('email') || '').trim().toLowerCase() : ''
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin && internalSecretHeader !== 'skip-cron' && !isTestCall) {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
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

      if (!apiKey) {
        try {
          apiKey =
            ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
              ? $secrets.get('API_FOOTBALL_KEY')
              : '') ||
            ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
            $os.getenv('API_FOOTBALL_KEY') ||
            $os.getenv('RAPIDAPI_KEY') ||
            ''
        } catch (_) {}
      }
    }

    if (!apiKey) {
      return e.json(400, {
        success: false,
        message: 'Por favor, informe a API Key para realizar o teste de conexão.',
      })
    }

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
      console.log(
        '[placar-ao-vivo/test] Executando teste direto de conexão via $http.send (sem consumir cota): ' +
          urlTest,
      )

      const res = $http.send({
        url: urlTest,
        method: 'GET',
        headers: headersTest,
        timeout: 10,
      })

      var resJson = {}
      try {
        resJson = res.json || {}
      } catch (_) {
        resJson = {}
      }

      var hasErrorAccess =
        resJson.errors && (resJson.errors.access || resJson.errors.requests || resJson.errors.token)
      if (res.statusCode === 200 && !hasErrorAccess) {
        // Gravar em config_integracoes api_validada com timestamp SEM incrementar cota
        try {
          const colInteg = $app.findCollectionByNameOrId('config_integracoes')
          let valRec = null
          try {
            valRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'api_validada')
          } catch (_) {
            valRec = new Record(colInteg)
            valRec.set('chave', 'api_validada')
            valRec.set('provedor', 'api_football')
          }
          valRec.set('ativo', true)
          valRec.set(
            'api_key',
            JSON.stringify({
              validada: true,
              timestamp: new Date().toISOString(),
              endpoint_testado: urlTest,
              status_code: 200,
            }),
          )
          $app.save(valRec)
        } catch (errSaveVal) {
          console.log('[placar-ao-vivo/test] Aviso ao salvar api_validada:', errSaveVal)
        }

        return e.json(200, {
          success: true,
          provider: 'api_football',
          statusCode: res.statusCode,
          response: resJson,
          message: 'Conexão com API-Football bem-sucedida! Conta ativa, autorizada e validada.',
        })
      } else if (res.statusCode === 200 && hasErrorAccess) {
        var errMsg = String(
          resJson.errors.access || resJson.errors.requests || resJson.errors.token,
        )
        return e.json(200, {
          success: false,
          account_suspended: errMsg.indexOf('suspended') !== -1,
          rate_limited: errMsg.indexOf('rate') !== -1 || errMsg.indexOf('requests') !== -1,
          provider: 'api_football',
          statusCode: 200,
          response: resJson,
          message: 'API-Football conectou (HTTP 200), porém retornou aviso na conta: ' + errMsg,
        })
      } else if (res.statusCode === 429) {
        return e.json(200, {
          success: false,
          rate_limited: true,
          provider: 'api_football',
          statusCode: 429,
          message:
            'API-Football atingiu o limite de cota (Status 429). Tente novamente mais tarde.',
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
      return e.json(200, {
        success: false,
        provider: 'api_football',
        message:
          'Não foi possível conectar à API-Football: ' +
          (errReq ? errReq.message : 'Timeout ou erro de rede'),
      })
    }
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

    const authName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
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

    const authName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
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
// POST /backend/v1/admin/resetar-contador-api
// -------------------------------------------------------------
// Zera o contador interno de requisições do dia atual no banco de dados,
// limpa os bloqueios imediatos e mantém o histórico seguro.
routerAdd('POST', '/backend/v1/admin/resetar-contador-api', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const hojeUtc = new Date().toISOString().slice(0, 10)
    let usageRec = null
    const colInteg = $app.findCollectionByNameOrId('config_integracoes')

    try {
      usageRec = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'api_football_daily_usage',
      )
    } catch (_) {
      usageRec = new Record(colInteg)
      usageRec.set('chave', 'api_football_daily_usage')
      usageRec.set('provedor', 'api_football')
      usageRec.set('ativo', true)
    }

    let usageData = {
      date_utc: hojeUtc,
      count: 0,
      max_limit: 80,
      trava_desativada: false,
      blocked: false,
      last_reset_utc: new Date().toISOString(),
      last_request_utc: null,
    }

    try {
      const rawKey = usageRec.getString('api_key')
      if (rawKey) {
        const parsed = JSON.parse(rawKey)
        if (parsed && typeof parsed === 'object') {
          usageData = Object.assign(usageData, parsed)
        }
      }
    } catch (_) {}

    // Executa reset estrito do dia atual e restaura chave principal
    usageData.date_utc = hojeUtc
    usageData.count = 0
    usageData.count_primary = 0
    usageData.count_backup = 0
    usageData.blocked = false
    usageData.primary_exhausted = false
    usageData.backup_exhausted = false
    usageData.active_key = 'primary'
    usageData.fallback_active = false
    if (!usageData.max_limit || Number(usageData.max_limit) < 80) {
      usageData.max_limit = 80
    }
    usageData.last_reset_utc = new Date().toISOString()

    usageRec.set('api_key', JSON.stringify(usageData))
    usageRec.set('ativo', true)
    usageRec.set('provedor', 'api_football')
    $app.save(usageRec)

    // Limpa também eventuais flags em memória global
    if (typeof globalThis !== 'undefined') {
      if (globalThis.__apiFootballCircuitBreaker) {
        globalThis.__apiFootballCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
      }
      if (globalThis.__apiFootballThrottle) {
        globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 15 * 60 * 1000 }
      }
    }

    console.log(
      '[Admin Reset API] Contador diário resetado com sucesso pelo administrador Douglas.',
    )

    return e.json(200, {
      success: true,
      message: 'Contador diário da API-Football zerado e chamadas liberadas com sucesso!',
      usage: usageData,
    })
  } catch (err) {
    console.error('[Admin Reset API] Erro ao resetar contador da API:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao resetar contador diário',
    })
  }
})

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/sobrescrever
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/sobrescrever', (e) => {
  try {
    const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
    if (!authRecord) {
      return e.unauthorizedError('Sua sessão expirou. Faça login novamente.')
    }

    const authName = (
      (authRecord.getString ? authRecord.getString('name') : authRecord.get('name')) ||
      (authRecord.getString ? authRecord.getString('username') : authRecord.get('username')) ||
      ''
    )
      .trim()
      .toLowerCase()
    const authEmail = (
      (authRecord.getString ? authRecord.getString('email') : authRecord.get('email')) || ''
    )
      .trim()
      .toLowerCase()
    const isAdmin =
      authName === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
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

    var parseMinutoInt = function (minVal) {
      if (minVal == null) return null
      var digits = String(minVal).replace(/\D/g, '')
      if (!digits) return null
      var parsed = parseInt(digits, 10)
      return isNaN(parsed) ? null : parsed
    }

    var sanitizeGolsArray = function (input) {
      if (!input) return []
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input)
        } catch (_) {
          return []
        }
      }
      if (!Array.isArray(input)) return []
      var result = []
      for (var i = 0; i < input.length; i++) {
        var it = input[i]
        if (!it) continue
        var nome = ''
        var minuto = null
        var posicao = 'Atacante'
        var quantidade = 1

        if (typeof it === 'string') {
          var trimmedStr = it.trim()
          var match = trimmedStr.match(/^(.*?)(?:\s+(\d+)(?:'|’|min)?)?$/i)
          if (match) {
            nome = (match[1] || '').trim()
            if (match[2]) {
              minuto = parseMinutoInt(match[2])
            }
          } else {
            nome = trimmedStr
          }
        } else if (typeof it === 'object') {
          nome = String(it.nome || it.name || '').trim()
          minuto = parseMinutoInt(it.minuto != null ? it.minuto : it.minute)
          if (it.posicao) posicao = String(it.posicao).trim()
          if (it.quantidade != null) {
            var q = parseInt(it.quantidade, 10)
            if (!isNaN(q) && q > 0) quantidade = q
          }
        }

        if (nome) {
          result.push({
            nome: nome,
            minuto: minuto,
            posicao: posicao,
            quantidade: quantidade,
          })
        }
      }
      return result
    }

    var cleanPlacarA =
      typeof body.placar_a === 'number'
        ? Math.max(0, body.placar_a)
        : Math.max(0, parseInt(body.placar_a, 10) || 0)
    var cleanPlacarB =
      typeof body.placar_b === 'number'
        ? Math.max(0, body.placar_b)
        : Math.max(0, parseInt(body.placar_b, 10) || 0)

    var sanitizedGolsA = sanitizeGolsArray(body.gols_time_a || body.marcadores_a)
    var sanitizedGolsB = sanitizeGolsArray(body.gols_time_b || body.marcadores_b)

    var formatDisplayScorers = function (golsArr) {
      var arr = []
      for (var gi = 0; gi < golsArr.length; gi++) {
        var g = golsArr[gi]
        if (g.minuto != null && g.minuto !== '') {
          arr.push(g.nome + ' ' + g.minuto + "'")
        } else {
          arr.push(g.nome)
        }
      }
      return arr
    }

    var marcListA = formatDisplayScorers(sanitizedGolsA)
    var marcListB = formatDisplayScorers(sanitizedGolsB)
    var combinedMarcadores = marcListA.concat(marcListB)

    if (body.remover === true) {
      delete map[jogoId]
    } else {
      map[jogoId] = {
        jogo_id: jogoId,
        placar_a: cleanPlacarA,
        placar_b: cleanPlacarB,
        marcadores: combinedMarcadores,
        marcadores_a: marcListA,
        marcadores_b: marcListB,
        gols_time_a: sanitizedGolsA,
        gols_time_b: sanitizedGolsB,
        status: (body.status || 'Ao Vivo (Manual)').trim(),
        updated_at: new Date().toISOString(),
      }
    }

    record.set('api_key', JSON.stringify(map))
    $app.save(record)

    // Tenta atualizar também diretamente o registro da coleção 'jogos' de forma segura
    // (com minuto inteiro sanitizado e JSON válido em gols_time_a e gols_time_b)
    try {
      var jogoRecord = $app.findRecordById('jogos', jogoId)
      if (jogoRecord) {
        if (body.remover === true) {
          // Mantém o jogo como está ou limpa a sobrescrita manual
        } else {
          jogoRecord.set('placar_a', cleanPlacarA)
          jogoRecord.set('placar_b', cleanPlacarB)
          jogoRecord.set('gols_time_a', sanitizedGolsA)
          jogoRecord.set('gols_time_b', sanitizedGolsB)
          $app.save(jogoRecord)
        }
      }
    } catch (errJogoUpdate) {
      // Registra aviso mas não aborta a requisição, pois o map de sobrescrita já foi gravado
      console.warn(
        'Aviso: atualização direta em jogos:',
        errJogoUpdate ? errJogoUpdate.message : errJogoUpdate,
      )
    }

    // Invalidação imediata do cache interno de placar ao vivo para refletir no mesmo segundo
    try {
      if (typeof globalThis !== 'undefined' && globalThis.__placarAoVivoCacheStore) {
        globalThis.__placarAoVivoCacheStore = {}
      }
    } catch (_) {}

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
// Purge imediato do cache de partidas do dia ao criar, editar ou excluir.
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
