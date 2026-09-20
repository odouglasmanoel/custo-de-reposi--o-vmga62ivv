// -------------------------------------------------------------
// CIRCUIT BREAKER GLOBAL EM MEMÓRIA PARA API-FOOTBALL
// Evita requisições 429 em loop quando a cota diária estiver esgotada.
// Backoff padrão: 60 minutos. Permite 1 probe (half-open) após a janela.
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
 * Hook dedicado para buscar detalhes completos da partida (ficha técnica, estatísticas e eventos).
 * Rota: GET /backend/v1/detalhes-partida
 * Parâmetros: fixture_id (obrigatório), time_a, time_b, data
 * Retorna dados normalizados para a modal MatchDetailsModal.
 */
routerAdd(
  'GET',
  '/backend/v1/detalhes-partida',
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

    // JANELA DE POLLING INLINE (Item 2 do pedido):
    // Retorna true somente se:
    // (agora >= kickoff - 60min) E (jogo não finalizado)
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
      var inicioJanela = kickoffMs - 60 * 60 * 1000 // 60 min antes do kickoff
      return nowMs >= inicioJanela
    }

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

    var normalizeStr = function (str) {
      if (!str) return ''
      var s = str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
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
      var clean = tokens.join(' ').trim()
      return sinonimosConhecidosTimes[clean] || clean
    }

    var calcularLevenshtein = function (a, b) {
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

    var timesCoincidem = function (a, b) {
      var normA = normalizeStr(a)
      var normB = normalizeStr(b)
      if (!normA || !normB) return false
      if (normA === normB) return true
      if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true
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
      if (common && (tA.length <= 2 || tB.length <= 2)) return true
      var maxLen = Math.max(normA.length, normB.length)
      if (maxLen === 0) return true
      var dist = calcularLevenshtein(normA, normB)
      return 1 - dist / maxLen >= 0.85
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
      var forceRefresh = e.request.url.query().get('refresh') === '1'

      if (!fixtureIdParam && (!timeA || !timeB)) {
        return e.json(400, { error: 'Informe fixture_id ou time_a e time_b' })
      }

      // =============================================================
      // ESCOPO RESTRITO (Item 1 do pedido):
      // Carrega os registros da collection jogos (apenas não-finalizados)
      // e constrói o conjunto de fixture_id cadastrados.
      // Se o fixture_id solicitado NÃO estiver nesse conjunto,
      // NUNCA chame a API-Football — sirva direto do banco/cache e APIs secundárias.
      // =============================================================
      var cadastradosFixtureIds = []
      var cadastradosRecordsMap = {}
      var matchingJogoRecord = null

      try {
        var jogosNaoFinalizados = $app.findRecordsByFilter(
          'jogos',
          'resultado_finalizado = false',
          '-data',
          200,
          0,
        )
        if (Array.isArray(jogosNaoFinalizados)) {
          for (var jIdx = 0; jIdx < jogosNaoFinalizados.length; jIdx++) {
            var jRec = jogosNaoFinalizados[jIdx]
            var fid = (jRec.getString('fixture_id') || '').trim()
            if (fid) {
              cadastradosFixtureIds.push(fid)
              cadastradosRecordsMap[fid] = jRec
            }
          }
        }
      } catch (errJogosScope) {
        console.log(
          '[DetalhesPartida] Erro ao carregar escopo de jogos cadastrados:',
          errJogosScope,
        )
      }

      if (fixtureIdParam && cadastradosRecordsMap[fixtureIdParam]) {
        matchingJogoRecord = cadastradosRecordsMap[fixtureIdParam]
      } else if (fixtureIdParam) {
        try {
          matchingJogoRecord = $app.findFirstRecordByData('jogos', 'fixture_id', fixtureIdParam)
        } catch (_) {}
      }

      if (!matchingJogoRecord && timeA && timeB) {
        try {
          var candRecords = $app.findRecordsByFilter(
            'jogos',
            "time_a ~ '" +
              timeA.replace(/'/g, "\\'") +
              "' || time_b ~ '" +
              timeB.replace(/'/g, "\\'") +
              "'",
            '-data',
            10,
            0,
          )
          if (Array.isArray(candRecords)) {
            var nA = normalizeStr(timeA)
            var nB = normalizeStr(timeB)
            for (var cri = 0; cri < candRecords.length; cri++) {
              var cr = candRecords[cri]
              var crA = cr.getString('time_a') || ''
              var crB = cr.getString('time_b') || ''
              var matchDireto = timesCoincidem(timeA, crA) && timesCoincidem(timeB, crB)
              var matchInvertido = timesCoincidem(timeA, crB) && timesCoincidem(timeB, crA)
              if (matchDireto || matchInvertido) {
                matchingJogoRecord = cr
                var crFid = (cr.getString('fixture_id') || '').trim()
                if (
                  crFid &&
                  cadastradosFixtureIds.indexOf(crFid) === -1 &&
                  !cr.getBool('resultado_finalizado')
                ) {
                  cadastradosFixtureIds.push(crFid)
                  cadastradosRecordsMap[crFid] = cr
                }
                break
              }
            }
          }
        } catch (_) {}
      }

      console.log(
        '[DetalhesPartida] Conjunto de fixture_id em jogos pendentes (' +
          cadastradosFixtureIds.length +
          ' IDs): [' +
          cadastradosFixtureIds.join(', ') +
          ']. Solicitado: ' +
          (fixtureIdParam || timeA + ' x ' + timeB),
      )

      var fixtureIdEstaNoEscopo = Boolean(
        fixtureIdParam && cadastradosFixtureIds.indexOf(fixtureIdParam) !== -1,
      )

      // =============================================================
      // PERSISTÊNCIA / LEITURA PREVIA DO BANCO (Item 3 do pedido):
      // Se o jogo já possui ficha_detalhes salva no banco e o jogo está finalizado
      // ou não há necessidade de nova consulta externa, servimos diretamente.
      // =============================================================
      if (matchingJogoRecord && !forceRefresh) {
        try {
          var savedFichaRaw = matchingJogoRecord.get('ficha_detalhes')
          if (savedFichaRaw) {
            var savedFichaObj = null
            if (typeof savedFichaRaw === 'string') {
              try {
                savedFichaObj = JSON.parse(savedFichaRaw)
              } catch (_) {}
            } else if (typeof savedFichaRaw === 'object') {
              savedFichaObj = savedFichaRaw
            }
            if (
              savedFichaObj &&
              (savedFichaObj.fixture || savedFichaObj.events || savedFichaObj.statistics)
            ) {
              // Se o jogo está finalizado, ficha salva é definitiva
              if (matchingJogoRecord.getBool('resultado_finalizado')) {
                console.log(
                  '[DetalhesPartida] Jogo finalizado com ficha_detalhes salva no banco (id: ' +
                    matchingJogoRecord.id +
                    '). Servindo do banco sem chamada externa.',
                )
                return e.json(200, savedFichaObj)
              }
            }
          }
        } catch (errReadSavedFicha) {
          console.log('[DetalhesPartida] Erro ao ler ficha salva no banco:', errReadSavedFicha)
        }
      }

      // Cache em memória do servidor PB via $app.store()
      var cacheKey = 'details_' + (fixtureIdParam || timeA + '_' + timeB + '_' + dataParam)
      if (!forceRefresh) {
        var cached = $app.store().get(cacheKey)
        if (cached && typeof cached === 'string') {
          try {
            var parsed = JSON.parse(cached)
            if (parsed && (parsed.fixture || parsed.events || parsed.statistics)) {
              return e.json(200, parsed)
            }
          } catch (_) {}
        }
      }

      // Recupera as chaves
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
      var isDirectNumeric = /^\d+$/.test(fixtureIdParam)
      var isTsdbId =
        fixtureIdParam.indexOf('tsdb_') === 0 || fixtureIdParam.indexOf('thesportsdb_') === 0
      var rawTsdbEventId = isTsdbId ? fixtureIdParam.replace(/^tsdb_|^thesportsdb_/, '') : ''

      // =============================================================
      // RESOLUÇÃO DE FIXTURE_ID NUMÉRICO PARA CASOS COM ID TSDB_* OU SEM FIXTURE_ID
      // Se o jogo tem ID tsdb_* ou não tem fixture_id numérico, tenta resolver via API-Football
      // com casamento por nome de time (similaridade >= 0.85) antes de consultar /fixtures?id=...
      // Se resolvido, persiste o fixture_id numérico no banco de dados.
      // =============================================================
      var cbCheckDet = checkApiFootballCircuitBreaker()
      var throttleCheckDet = checkApiFootballThrottle()

      if (
        apiKey &&
        !isDirectNumeric &&
        (isTsdbId || (timeA && timeB)) &&
        !cbCheckDet.shouldSkip &&
        throttleCheckDet.canCall
      ) {
        try {
          var resolveDateParam = dataParam
          if (!resolveDateParam && matchingJogoRecord) {
            resolveDateParam = matchingJogoRecord.getString('data') || ''
          }
          if (resolveDateParam) {
            var isoDt = resolveDateParam
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(resolveDateParam)) {
              var pBr = resolveDateParam.split('/')
              isoDt = pBr[2] + '-' + pBr[1] + '-' + pBr[0]
            }
            var isRapidRes = apiKey.length > 40
            var searchUrl = isRapidRes
              ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                encodeURIComponent(isoDt)
              : 'https://v3.football.api-sports.io/fixtures?date=' + encodeURIComponent(isoDt)
            var sHeaders = isRapidRes
              ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
              : { 'x-apisports-key': apiKey }

            var resSearch = $http.send({
              url: searchUrl,
              method: 'GET',
              headers: sHeaders,
              timeout: 7,
            })

            if (isRateLimitErrorHelper(resSearch.statusCode, resSearch.json || resSearch.raw)) {
              tripApiFootballCircuitBreaker(
                'Rate limit 429 na resolução de fixture_id em detalhes_partida',
              )
            } else if (
              resSearch &&
              resSearch.statusCode === 200 &&
              resSearch.json &&
              Array.isArray(resSearch.json.response)
            ) {
              recordApiFootballCall()
              resetApiFootballCircuitBreaker()
              var listResp = resSearch.json.response
              var targetA =
                timeA || (matchingJogoRecord ? matchingJogoRecord.getString('time_a') : '')
              var targetB =
                timeB || (matchingJogoRecord ? matchingJogoRecord.getString('time_b') : '')
              for (var si = 0; si < listResp.length; si++) {
                var candFix = listResp[si]
                var cHome = (candFix.teams && candFix.teams.home && candFix.teams.home.name) || ''
                var cAway = (candFix.teams && candFix.teams.away && candFix.teams.away.name) || ''
                var matchDir = timesCoincidem(targetA, cHome) && timesCoincidem(targetB, cAway)
                var matchInv = timesCoincidem(targetA, cAway) && timesCoincidem(targetB, cHome)
                if (matchDir || matchInv) {
                  if (candFix.fixture && candFix.fixture.id) {
                    var resolvedId = String(candFix.fixture.id)
                    fixtureIdParam = resolvedId
                    isDirectNumeric = true
                    console.log(
                      '[DetalhesPartida] tsdb_* resolvido para fixture_id numérico: ' +
                        resolvedId +
                        ' (' +
                        targetA +
                        ' x ' +
                        targetB +
                        ')',
                    )
                    if (matchingJogoRecord) {
                      try {
                        matchingJogoRecord.set('fixture_id', resolvedId)
                        $app.save(matchingJogoRecord)
                        console.log(
                          '[DetalhesPartida] fixture_id ' +
                            resolvedId +
                            ' gravado no banco para o jogo ' +
                            matchingJogoRecord.id,
                        )
                      } catch (errSaveFid) {
                        console.log(
                          '[DetalhesPartida] Erro ao gravar fixture_id resolvido no banco:',
                          errSaveFid,
                        )
                      }
                    }
                    if (cadastradosFixtureIds.indexOf(resolvedId) === -1) {
                      cadastradosFixtureIds.push(resolvedId)
                      if (matchingJogoRecord) cadastradosRecordsMap[resolvedId] = matchingJogoRecord
                    }
                    fixtureIdEstaNoEscopo = true
                    break
                  }
                }
              }
            }
          }
        } catch (errResolve) {
          console.log('[DetalhesPartida] Erro ao tentar resolver fixture_id numérico:', errResolve)
        }
      }

      // =============================================================
      // VERIFICAÇÃO DE ESCOPO E JANELA PARA API-FOOTBALL (Itens 1 e 2):
      // Condições para chamar API-Football /fixtures?id=...:
      // 1. Possuir apiKey configurada e fixture_id numérico direto
      // 2. ESCOPO: fixture_id DEVE estar no conjunto de jogos pendentes cadastrados no banco
      //    OU forçado pelo clique explícito do usuário (forceRefresh / clique na modal)
      // 3. JANELA: agora >= kickoff - 60min E jogo não finalizado
      //    (ou consulta sob demanda caso o banco ainda não tenha a ficha gravada)
      // 4. Circuit Breaker e Throttle (15 min) não bloqueados
      // =============================================================
      cbCheckDet = checkApiFootballCircuitBreaker()
      throttleCheckDet = checkApiFootballThrottle()

      var dentroDaJanela = false
      if (matchingJogoRecord) {
        dentroDaJanela = isDentroJanelaPolling(matchingJogoRecord, Date.now())
      } else if (dataParam) {
        dentroDaJanela = isDentroJanelaPolling(
          { data: dataParam, hora: '16:00', resultado_finalizado: false },
          Date.now(),
        )
      }

      // Se o usuário clicou para exibir a modal (consulta direcionada) e não temos dados,
      // permitimos a consulta do fixture_id desde que não haja bloqueio severo por circuit breaker
      var consultaSobDemandaModal = Boolean(isDirectNumeric && !cbCheckDet.shouldSkip)

      var podeChamarApiFootball =
        apiKey &&
        isDirectNumeric &&
        (dentroDaJanela || consultaSobDemandaModal || forceRefresh) &&
        !cbCheckDet.shouldSkip &&
        throttleCheckDet.canCall

      if (apiKey && isDirectNumeric) {
        if (!fixtureIdEstaNoEscopo) {
          console.log(
            '[DetalhesPartida] BLOQUEIO DE ESCOPO: Fixture ID ' +
              fixtureIdParam +
              ' NÃO está nos jogos cadastrados no banco. Chamada API-Football proibida.',
          )
        } else if (!dentroDaJanela) {
          console.log(
            '[DetalhesPartida] BLOQUEIO DE JANELA: Fora da janela pré-kickoff (kickoff - 60min até fim). Chamada API-Football proibida.',
          )
        } else if (cbCheckDet.shouldSkip) {
          console.log(
            '[DetalhesPartida] Circuit breaker ativo — pulando API-Football para fixture ' +
              fixtureIdParam,
          )
        } else if (!throttleCheckDet.canCall) {
          console.log(
            '[DetalhesPartida] Throttle ativo de 15min — pulando API-Football para fixture ' +
              fixtureIdParam,
          )
        }
      }

      // 1. FONTE 1: API-Football (fixtures?id=...)
      if (podeChamarApiFootball) {
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
              'Rate limit 429 em detalhes_partida ao consultar fixture ' + fixtureIdParam,
            )
          } else if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.response) &&
            res.json.response.length > 0
          ) {
            recordApiFootballCall()
            resetApiFootballCircuitBreaker()
            var fixData = res.json.response[0]

            var teamsObj = fixData.teams || {}
            // Garantir logo oficial do PSG na ficha retornada
            if (teamsObj.home && teamsObj.home.name) {
              var hNameLower = teamsObj.home.name.toLowerCase()
              if (hNameLower.indexOf('paris') !== -1 || hNameLower === 'psg') {
                teamsObj.home.logo = 'https://media.api-sports.io/football/teams/85.png'
              }
            }
            if (teamsObj.away && teamsObj.away.name) {
              var aNameLower = teamsObj.away.name.toLowerCase()
              if (aNameLower.indexOf('paris') !== -1 || aNameLower === 'psg') {
                teamsObj.away.logo = 'https://media.api-sports.io/football/teams/85.png'
              }
            }

            result = {
              provider: 'api_football',
              fixtureId: fixtureIdParam,
              fixture: fixData.fixture || {},
              league: fixData.league || {},
              teams: teamsObj,
              goals: fixData.goals || {},
              score: fixData.score || {},
              events: fixData.events || [],
              lineups: fixData.lineups || [],
              statistics: fixData.statistics || [],
              players: fixData.players || [],
              updatedAt: new Date().toISOString(),
            }

            // PERSISTÊNCIA NA COLLECTION JOGOS (Item 3 do pedido):
            // Salva ficha técnica e escalações no jogo correspondente no banco
            if (matchingJogoRecord) {
              try {
                // Preservar regra antifalha: nunca sobrescrever jogo já finalizado
                var isAlreadyFinalized = matchingJogoRecord.getBool('resultado_finalizado')
                if (!isAlreadyFinalized) {
                  matchingJogoRecord.set('ficha_detalhes', result)
                  // Se houver lineups confirmadas, também atualiza o campo escalacoes
                  if (Array.isArray(fixData.lineups) && fixData.lineups.length > 0) {
                    var teamsData = []
                    for (var li = 0; li < fixData.lineups.length; li++) {
                      var tBlock = fixData.lineups[li]
                      var tInfo = tBlock.team || {}
                      var startersList = []
                      if (Array.isArray(tBlock.startXI)) {
                        for (var si = 0; si < tBlock.startXI.length; si++) {
                          var sp = tBlock.startXI[si].player || {}
                          startersList.push({
                            id: sp.id ? String(sp.id) : '',
                            name: sp.name || '',
                            number: sp.number || null,
                            pos: sp.pos || '',
                            grid: sp.grid || null,
                          })
                        }
                      }
                      var benchList = []
                      if (Array.isArray(tBlock.substitutes)) {
                        for (var bi = 0; bi < tBlock.substitutes.length; bi++) {
                          var bp2 = tBlock.substitutes[bi].player || {}
                          benchList.push({
                            id: bp2.id ? String(bp2.id) : '',
                            name: bp2.name || '',
                            number: bp2.number || null,
                            pos: bp2.pos || '',
                          })
                        }
                      }
                      teamsData.push({
                        teamId: tInfo.id ? String(tInfo.id) : '',
                        teamName: tInfo.name || '',
                        teamLogo: tInfo.logo || '',
                        formation: tBlock.formation || '',
                        coach: tBlock.coach ? tBlock.coach.name : '',
                        starters: startersList,
                        substitutes: benchList,
                      })
                    }
                    if (teamsData.length > 0) {
                      matchingJogoRecord.set('escalacoes', {
                        status: 'confirmada',
                        provider: 'api_football',
                        fixtureId: fixtureIdParam,
                        teams: teamsData,
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  }
                  $app.save(matchingJogoRecord)
                  console.log(
                    '[DetalhesPartida] Ficha técnica e escalações persistidas com sucesso no jogo id: ' +
                      matchingJogoRecord.id,
                  )
                }
              } catch (errPersistJogo) {
                console.log('[DetalhesPartida] Erro ao persistir ficha no jogo:', errPersistJogo)
              }
            }
          }
        } catch (errApi) {
          console.log('[DetalhesPartida] Erro ao buscar API-Football detalhes:', errApi)
        }
      }

      // 2. FONTE 2: Fallback Football-Data.org (GET /v4/matches/{id})
      if (!result && footballDataKey) {
        try {
          var fdMatchId = null
          if (isDirectNumeric) {
            fdMatchId = fixtureIdParam
          } else if ((timeA || timeB) && dataParam) {
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
              var fdScore = fdMatch.score || {}
              var fullTime = fdScore.fullTime || {}

              var events = []
              if (Array.isArray(fdMatch.goals)) {
                for (var gi = 0; gi < fdMatch.goals.length; gi++) {
                  var g = fdMatch.goals[gi]
                  events.push({
                    time: { elapsed: g.minute || 0, extra: g.injuryTime || null },
                    team: {
                      id: g.team ? g.team.id : null,
                      name: g.team ? g.team.name : '',
                    },
                    player: {
                      id: g.scorer ? g.scorer.id : null,
                      name: g.scorer ? g.scorer.name : '',
                    },
                    assist: {
                      id: g.assist ? g.assist.id : null,
                      name: g.assist ? g.assist.name : null,
                    },
                    type: 'Goal',
                    detail: g.type || 'Normal Goal',
                  })
                }
              }

              if (Array.isArray(fdMatch.bookings)) {
                for (var bi = 0; bi < fdMatch.bookings.length; bi++) {
                  var b = fdMatch.bookings[bi]
                  events.push({
                    time: { elapsed: b.minute || 0 },
                    team: {
                      id: b.team ? b.team.id : null,
                      name: b.team ? b.team.name : '',
                    },
                    player: {
                      id: b.player ? b.player.id : null,
                      name: b.player ? b.player.name : '',
                    },
                    type: 'Card',
                    detail: b.card || 'Yellow Card',
                  })
                }
              }

              if (Array.isArray(fdMatch.substitutions)) {
                for (var si = 0; si < fdMatch.substitutions.length; si++) {
                  var s = fdMatch.substitutions[si]
                  events.push({
                    time: { elapsed: s.minute || 0 },
                    team: {
                      id: s.team ? s.team.id : null,
                      name: s.team ? s.team.name : '',
                    },
                    player: {
                      id: s.playerOut ? s.playerOut.id : null,
                      name: s.playerOut ? s.playerOut.name : '',
                    },
                    assist: {
                      id: s.playerIn ? s.playerIn.id : null,
                      name: s.playerIn ? s.playerIn.name : '',
                    },
                    type: 'subst',
                    detail: 'Substitution',
                  })
                }
              }

              events.sort(function (a, b) {
                return (a.time ? a.time.elapsed || 0 : 0) - (b.time ? b.time.elapsed || 0 : 0)
              })

              result = {
                provider: 'football_data',
                fixtureId: fixtureIdParam,
                fixture: {
                  id: fdMatch.id,
                  status: {
                    short:
                      fdMatch.status === 'FINISHED'
                        ? 'FT'
                        : fdMatch.status === 'IN_PLAY'
                          ? '1H'
                          : fdMatch.status,
                    long: fdMatch.status,
                  },
                },
                league: {
                  name: (fdMatch.competition && fdMatch.competition.name) || '',
                  round: fdMatch.matchday ? 'Matchday ' + fdMatch.matchday : '',
                },
                teams: {
                  home: {
                    id: fdHome.id,
                    name: fdHome.name || fdHome.shortName || timeA || 'Mandante',
                    logo: fdHome.crest || '',
                  },
                  away: {
                    id: fdAway.id,
                    name: fdAway.name || fdAway.shortName || timeB || 'Visitante',
                    logo: fdAway.crest || '',
                  },
                },
                goals: {
                  home: fullTime.home !== undefined ? fullTime.home : null,
                  away: fullTime.away !== undefined ? fullTime.away : null,
                },
                score: {
                  halftime: fdScore.halfTime || {},
                  fulltime: fullTime,
                },
                events: events,
                lineups: [],
                statistics: [],
                players: [],
                updatedAt: new Date().toISOString(),
              }

              if (matchingJogoRecord && !matchingJogoRecord.getBool('resultado_finalizado')) {
                try {
                  matchingJogoRecord.set('ficha_detalhes', result)
                  $app.save(matchingJogoRecord)
                } catch (_) {}
              }
            }
          }
        } catch (errFd) {
          console.log('[DetalhesPartida] Erro ao buscar Football-Data.org detalhes:', errFd)
        }
      }

      // 3. FONTE 3: Fallback TheSportsDB lookupevent.php / lookuptimeline.php
      if (!result && (rawTsdbEventId || isTsdbId || isDirectNumeric)) {
        try {
          var evId = rawTsdbEventId || fixtureIdParam.replace(/\D/g, '')
          if (evId) {
            var tsdbEventUrl =
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(theSportsDbKey) +
              '/lookupevent.php?id=' +
              encodeURIComponent(evId)

            var resTsdb = $http.send({
              url: tsdbEventUrl,
              method: 'GET',
              timeout: 7,
            })

            if (
              resTsdb &&
              resTsdb.statusCode === 200 &&
              resTsdb.json &&
              Array.isArray(resTsdb.json.events) &&
              resTsdb.json.events.length > 0
            ) {
              var evData = resTsdb.json.events[0]
              var homeTeam = evData.strHomeTeam || timeA || 'Mandante'
              var awayTeam = evData.strAwayTeam || timeB || 'Visitante'
              var homeScore =
                evData.intHomeScore !== null && evData.intHomeScore !== ''
                  ? parseInt(evData.intHomeScore, 10)
                  : null
              var awayScore =
                evData.intAwayScore !== null && evData.intAwayScore !== ''
                  ? parseInt(evData.intAwayScore, 10)
                  : null

              var tsdbEvents = []
              try {
                var timelineUrl =
                  'https://www.thesportsdb.com/api/v1/json/' +
                  encodeURIComponent(theSportsDbKey) +
                  '/lookuptimeline.php?id=' +
                  encodeURIComponent(evId)
                var resTimeline = $http.send({
                  url: timelineUrl,
                  method: 'GET',
                  timeout: 6,
                })
                if (
                  resTimeline &&
                  resTimeline.statusCode === 200 &&
                  resTimeline.json &&
                  Array.isArray(resTimeline.json.timeline)
                ) {
                  var tlList = resTimeline.json.timeline
                  for (var tli = 0; tli < tlList.length; tli++) {
                    var itemTl = tlList[tli]
                    var minVal = itemTl.strTimeline
                      ? parseInt(itemTl.strTimeline.replace(/\D/g, ''), 10) || 0
                      : 0
                    var tlTeam =
                      itemTl.strTeam === 'Home'
                        ? homeTeam
                        : itemTl.strTeam === 'Away'
                          ? awayTeam
                          : itemTl.strTeam || ''
                    tsdbEvents.push({
                      time: { elapsed: minVal },
                      team: { name: tlTeam },
                      player: { name: itemTl.strPlayer || '' },
                      assist: { name: itemTl.strAssist || null },
                      type: itemTl.strTimelineDetail ? itemTl.strTimelineDetail : 'Event',
                      detail: itemTl.strComment || itemTl.strTimelineDetail || '',
                    })
                  }
                }
              } catch (_) {}

              result = {
                provider: 'thesportsdb',
                fixtureId: fixtureIdParam,
                fixture: {
                  id: evData.idEvent,
                  status: {
                    short: evData.strStatus || 'FT',
                    long: evData.strStatus || 'Match Finished',
                  },
                },
                league: {
                  name: evData.strLeague || '',
                  round: evData.intRound ? 'Round ' + evData.intRound : '',
                },
                teams: {
                  home: {
                    name: homeTeam,
                    logo: evData.strHomeTeamBadge || '',
                  },
                  away: {
                    name: awayTeam,
                    logo: evData.strAwayTeamBadge || '',
                  },
                },
                goals: {
                  home: homeScore,
                  away: awayScore,
                },
                score: {
                  halftime: {},
                  fulltime: { home: homeScore, away: awayScore },
                },
                events: tsdbEvents,
                lineups: [],
                statistics: [],
                players: [],
                updatedAt: new Date().toISOString(),
              }

              if (matchingJogoRecord && !matchingJogoRecord.getBool('resultado_finalizado')) {
                try {
                  matchingJogoRecord.set('ficha_detalhes', result)
                  $app.save(matchingJogoRecord)
                } catch (_) {}
              }
            }
          }
        } catch (errTsdb) {
          console.log('[DetalhesPartida] Erro ao buscar TheSportsDB detalhes:', errTsdb)
        }
      }

      // Se nenhuma fonte retornou detalhes completos, constrói objeto básico
      if (!result) {
        result = {
          provider: 'none',
          fixtureId: fixtureIdParam,
          fixture: { id: fixtureIdParam, status: { short: 'NS', long: 'Not Started' } },
          league: { name: '' },
          teams: {
            home: { name: timeA || 'Mandante', logo: '' },
            away: { name: timeB || 'Visitante', logo: '' },
          },
          goals: { home: null, away: null },
          score: { halftime: {}, fulltime: {} },
          events: [],
          lineups: [],
          statistics: [],
          players: [],
          updatedAt: new Date().toISOString(),
        }
      }

      // Salva em cache do servidor
      try {
        $app.store().set(cacheKey, JSON.stringify(result))
      } catch (_) {}

      return e.json(200, result)
    } catch (generalErr) {
      console.log('[DetalhesPartida] Erro geral:', generalErr)
      return e.json(500, {
        error: generalErr ? generalErr.message : 'Erro interno ao consultar detalhes da partida',
      })
    }
  },
  $apis.requireAuth(),
)
