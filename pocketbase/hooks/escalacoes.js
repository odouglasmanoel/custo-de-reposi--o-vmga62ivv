// -------------------------------------------------------------
// CIRCUIT BREAKER GLOBAL EM MEMÓRIA PARA ESCALAÇÕES (API-FOOTBALL)
// Desacoplado do circuit breaker de escudos (__badgeCircuitBreaker)
// Evita requisições 429 em loop quando a cota diária estiver esgotada.
// Backoff padrão: 60 minutos. Permite 1 probe (half-open) após a janela.
// -------------------------------------------------------------
if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballLineupsCircuitBreaker) {
  globalThis.__apiFootballLineupsCircuitBreaker = {
    isBlocked: false,
    blockedUntil: 0,
    probing: false,
    reason: '',
  }
}

// Anti-spam leve por partida (30 a 60 segundos por fixture_id)
if (typeof globalThis !== 'undefined' && !globalThis.__apiFootballLineupsSpamMap) {
  globalThis.__apiFootballLineupsSpamMap = {}
}

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
    // Anti-spam leve por fixture (30s) para chamadas sob demanda
    var FIXTURE_SPAM_WINDOW_MS = 30 * 1000

    var checkFixtureAntiSpam = function (fixtureId) {
      if (!fixtureId) return { canCall: true, waitMs: 0 }
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballLineupsSpamMap) {
        return { canCall: true, waitMs: 0 }
      }
      var now = Date.now()
      var lastCall = globalThis.__apiFootballLineupsSpamMap[String(fixtureId)] || 0
      var diff = now - lastCall
      if (diff < FIXTURE_SPAM_WINDOW_MS) {
        return { canCall: false, waitMs: FIXTURE_SPAM_WINDOW_MS - diff }
      }
      return { canCall: true, waitMs: 0 }
    }

    var recordFixtureCall = function (fixtureId) {
      if (!fixtureId) return
      if (typeof globalThis !== 'undefined' && globalThis.__apiFootballLineupsSpamMap) {
        globalThis.__apiFootballLineupsSpamMap[String(fixtureId)] = Date.now()
      }
    }

    var API_FOOTBALL_BACKOFF_DURATION_MS = 60 * 60 * 1000 // 1 HORA

    var checkApiFootballCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballLineupsCircuitBreaker) {
        return { shouldSkip: false, isProbe: false }
      }
      var cb = globalThis.__apiFootballLineupsCircuitBreaker
      if (!cb.isBlocked) {
        return { shouldSkip: false, isProbe: false }
      }
      var now = Date.now()
      if (now < cb.blockedUntil) {
        return {
          shouldSkip: true,
          reason: cb.reason || 'Cota da API-Football esgotada (Lineups Circuit Breaker ativo)',
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
      if (!globalThis.__apiFootballLineupsCircuitBreaker) {
        globalThis.__apiFootballLineupsCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
      }
      var cb = globalThis.__apiFootballLineupsCircuitBreaker
      cb.isBlocked = true
      cb.blockedUntil = Date.now() + API_FOOTBALL_BACKOFF_DURATION_MS
      cb.probing = false
      cb.reason = reason || 'Rate limit / quota exceeded (429)'
      console.log(
        '[CircuitBreaker API-Football Escalações] TRIP ATIVADO por 60 minutos até ' +
          new Date(cb.blockedUntil).toISOString() +
          '. Motivo: ' +
          cb.reason,
      )
    }

    var resetApiFootballCircuitBreaker = function () {
      if (typeof globalThis === 'undefined' || !globalThis.__apiFootballLineupsCircuitBreaker)
        return
      var cb = globalThis.__apiFootballLineupsCircuitBreaker
      if (cb.isBlocked || cb.probing) {
        console.log(
          '[CircuitBreaker API-Football Escalações] RESET: Conexão normalizada com resposta 200.',
        )
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
        return e.json(400, {
          error: 'Informe fixture_id ou time_a e time_b',
        })
      }

      var matchingJogoRecord = null

      if (fixtureIdParam) {
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
            for (var cri = 0; cri < candRecords.length; cri++) {
              var cr = candRecords[cri]
              var crA = cr.getString('time_a') || ''
              var crB = cr.getString('time_b') || ''
              var matchDireto = timesCoincidem(timeA, crA) && timesCoincidem(timeB, crB)
              var matchInvertido = timesCoincidem(timeA, crB) && timesCoincidem(timeB, crA)
              if (matchDireto || matchInvertido) {
                matchingJogoRecord = cr
                break
              }
            }
          }
        } catch (_) {}
      }

      // =============================================================
      // PERSISTÊNCIA / LEITURA PREVIA DO BANCO:
      // Se o jogo já possui escalações confirmadas salvas na collection jogos,
      // servimos direto do banco (economiza 100% de chamadas à API-Football).
      // =============================================================
      if (matchingJogoRecord && !forceRefresh) {
        try {
          var savedEscalacoesRaw = matchingJogoRecord.get('escalacoes')
          if (savedEscalacoesRaw) {
            var savedEscalacoesObj = null
            if (typeof savedEscalacoesRaw === 'string') {
              try {
                savedEscalacoesObj = JSON.parse(savedEscalacoesRaw)
              } catch (_) {}
            } else if (typeof savedEscalacoesRaw === 'object') {
              savedEscalacoesObj = savedEscalacoesRaw
            }
            if (
              savedEscalacoesObj &&
              savedEscalacoesObj.status === 'confirmada' &&
              Array.isArray(savedEscalacoesObj.teams) &&
              savedEscalacoesObj.teams.length > 0 &&
              savedEscalacoesObj.teams[0].starters &&
              savedEscalacoesObj.teams[0].starters.length > 0
            ) {
              console.log(
                '[Escalacoes] Escalação confirmada encontrada diretamente no registro do banco (jogos id: ' +
                  matchingJogoRecord.id +
                  '). Servindo do banco sem chamada externa.',
              )
              return e.json(200, savedEscalacoesObj)
            }
          }
        } catch (errReadSaved) {
          console.log('[Escalacoes] Erro ao ler escalações salvas no banco:', errReadSaved)
        }
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
      var isDirectNumeric = /^\d+$/.test(fixtureIdParam)
      var isTsdbId =
        fixtureIdParam.indexOf('tsdb_') === 0 || fixtureIdParam.indexOf('thesportsdb_') === 0
      var rawTsdbEventId = isTsdbId ? fixtureIdParam.replace(/^tsdb_|^thesportsdb_/, '') : ''

      // =============================================================
      // RESOLUÇÃO DE FIXTURE_ID NUMÉRICO PARA CASOS COM ID TSDB_* OU SEM FIXTURE_ID
      // Se o jogo tem ID tsdb_* ou não tem fixture_id numérico, tenta resolver via API-Football
      // com busca reversa por data + similaridade Levenshtein >= 0.85 antes de consultar lineups.
      // Se resolvido, persiste o fixture_id numérico no banco de dados.
      // =============================================================
      var cbCheckEsc = checkApiFootballCircuitBreaker()

      if (apiKey && !isDirectNumeric && (isTsdbId || (timeA && timeB)) && !cbCheckEsc.shouldSkip) {
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
                'Rate limit 429 na resolução de fixture_id em escalacoes',
              )
            } else if (
              resSearch &&
              resSearch.statusCode === 200 &&
              resSearch.json &&
              Array.isArray(resSearch.json.response)
            ) {
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
                      '[Escalacoes] tsdb_* resolvido para fixture_id numérico: ' +
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
                          '[Escalacoes] fixture_id ' +
                            resolvedId +
                            ' gravado no banco para o jogo ' +
                            matchingJogoRecord.id,
                        )
                      } catch (errSaveFid) {
                        console.log(
                          '[Escalacoes] Erro ao gravar fixture_id resolvido no banco:',
                          errSaveFid,
                        )
                      }
                    }
                    break
                  }
                }
              }
            }
          }
        } catch (errResolve) {
          console.log('[Escalacoes] Erro ao tentar resolver fixture_id numérico:', errResolve)
        }
      }

      // =============================================================
      // CONSULTA SOB DEMANDA NA API-FOOTBALL (Sem throttle global de 15min e sem bloqueio de janela/escopo):
      // Anti-spam leve por fixture_id (30s) para cliques repetidos no mesmo jogo.
      // Permite consultas sob demanda a qualquer jogo do dia, bolão ou lista.
      // =============================================================
      cbCheckEsc = checkApiFootballCircuitBreaker()
      var spamCheckEsc = checkFixtureAntiSpam(fixtureIdParam)

      var podeChamarApiFootball =
        apiKey &&
        isDirectNumeric &&
        !cbCheckEsc.shouldSkip &&
        (spamCheckEsc.canCall || forceRefresh)

      if (apiKey && isDirectNumeric && !spamCheckEsc.canCall && !forceRefresh) {
        console.log(
          '[Escalacoes] Anti-spam ativo para fixture ' +
            fixtureIdParam +
            ' (aguarde ' +
            Math.round(spamCheckEsc.waitMs / 1000) +
            's). Servindo do cache/banco se disponível.',
        )
      }

      // 2. FONTE 1: API-Football (lineups) sob demanda
      if (podeChamarApiFootball) {
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

          if (isRateLimitErrorHelper(res.statusCode, res.json || res.raw)) {
            tripApiFootballCircuitBreaker(
              'Rate limit 429 em escalacoes ao consultar fixture ' + fixtureIdParam,
            )
          } else if (
            res &&
            res.statusCode === 200 &&
            res.json &&
            Array.isArray(res.json.response) &&
            res.json.response.length > 0
          ) {
            recordFixtureCall(fixtureIdParam)
            resetApiFootballCircuitBreaker()
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

              var tNameStr = teamInfo.name || ''
              var tLogoStr = teamInfo.logo || ''
              if (
                tNameStr.toLowerCase().indexOf('paris') !== -1 ||
                tNameStr.toLowerCase() === 'psg'
              ) {
                tLogoStr = 'https://media.api-sports.io/football/teams/85.png'
              }

              teamsData.push({
                teamId: teamInfo.id ? String(teamInfo.id) : '',
                teamName: tNameStr,
                teamLogo: tLogoStr,
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

              // PERSISTÊNCIA NA COLLECTION JOGOS:
              // Salva escalações confirmadas na collection jogos
              if (matchingJogoRecord) {
                try {
                  matchingJogoRecord.set('escalacoes', result)
                  $app.save(matchingJogoRecord)
                  console.log(
                    '[Escalacoes] Escalação confirmada salva com sucesso na collection jogos (id: ' +
                      matchingJogoRecord.id +
                      ').',
                  )
                } catch (errSaveJogo) {
                  console.log('[Escalacoes] Erro ao salvar escalações no jogo:', errSaveJogo)
                }
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

                if (matchingJogoRecord) {
                  try {
                    matchingJogoRecord.set('escalacoes', result)
                    $app.save(matchingJogoRecord)
                  } catch (_) {}
                }
              }
            }
          }
        } catch (errFdLineup) {
          console.log('[Escalacoes] Erro ao buscar Football-Data.org lineups:', errFdLineup)
        }
      }

      // 4. FONTE 3: Fallback TheSportsDB lookuplineup.php / eventslineup.php
      if (!result && (rawTsdbEventId || isTsdbId || isDirectNumeric)) {
        try {
          var evId = rawTsdbEventId || fixtureIdParam.replace(/\D/g, '')
          if (evId) {
            var tsdbLineupUrls = [
              'https://www.thesportsdb.com/api/v1/json/' +
                encodeURIComponent(theSportsDbKey) +
                '/lookuplineup.php?id=' +
                encodeURIComponent(evId),
              'https://www.thesportsdb.com/api/v1/json/' +
                encodeURIComponent(theSportsDbKey) +
                '/eventslineup.php?id=' +
                encodeURIComponent(evId),
            ]

            var list = null
            for (var uIdx = 0; uIdx < tsdbLineupUrls.length; uIdx++) {
              var tsdbLineupUrl = tsdbLineupUrls[uIdx]
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
                list = resTsdb.json.lineup
                break
              }
            }

            if (list && list.length > 0) {
              var homeStarters = []
              var homeBench = []
              var awayStarters = []
              var awayBench = []
              var homeTeamName = timeA
              var awayTeamName = timeB

              // Determina idTeam ou nomes canônicos de mandante/visitante a partir dos itens do lineup
              var homeTeamIdDetected = null
              var awayTeamIdDetected = null

              // Primeiro passo: identificar idTeam ou strTeam correspondente a timeA e timeB
              for (var di = 0; di < list.length; di++) {
                var dItem = list[di]
                var dTeamName = dItem.strTeam || ''
                var dTeamId = dItem.idTeam ? String(dItem.idTeam) : null
                var dSide = (dItem.strHome || dItem.strSide || '').toLowerCase()

                if (dTeamId) {
                  if (timeA && timesCoincidem(dTeamName, timeA)) {
                    homeTeamIdDetected = dTeamId
                    if (dTeamName) homeTeamName = dTeamName
                  } else if (timeB && timesCoincidem(dTeamName, timeB)) {
                    awayTeamIdDetected = dTeamId
                    if (dTeamName) awayTeamName = dTeamName
                  } else if (dSide === 'yes' || dSide === 'home' || dSide === 'h') {
                    if (!homeTeamIdDetected) homeTeamIdDetected = dTeamId
                    if (dTeamName && !homeTeamName) homeTeamName = dTeamName
                  } else if (dSide === 'no' || dSide === 'away' || dSide === 'a') {
                    if (!awayTeamIdDetected) awayTeamIdDetected = dTeamId
                    if (dTeamName && !awayTeamName) awayTeamName = dTeamName
                  }
                }
              }

              // Segundo passo: iterar 100% dos jogadores do array lineup, sem cortes
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
                var itemTeamId = item.idTeam ? String(item.idTeam) : null

                // Agrupamento robusto:
                // 1) idTeam bate com homeTeamIdDetected ou awayTeamIdDetected
                // 2) Similaridade do nome do time com timeA / timeB (timesCoincidem)
                // 3) Flag strHome / strSide como desempate
                var isHome = false
                if (itemTeamId && homeTeamIdDetected && itemTeamId === homeTeamIdDetected) {
                  isHome = true
                } else if (itemTeamId && awayTeamIdDetected && itemTeamId === awayTeamIdDetected) {
                  isHome = false
                } else if (itemTeamName && timeA && timesCoincidem(itemTeamName, timeA)) {
                  isHome = true
                } else if (itemTeamName && timeB && timesCoincidem(itemTeamName, timeB)) {
                  isHome = false
                } else if (side === 'yes' || side === 'home' || side === 'h') {
                  isHome = true
                } else if (side === 'no' || side === 'away' || side === 'a') {
                  isHome = false
                } else {
                  // Fallback: se o lado da casa tiver menos titulares, agrupa no mandante
                  isHome = homeStarters.length <= awayStarters.length
                }

                if (isHome) {
                  if (itemTeamName && !homeTeamName) homeTeamName = itemTeamName
                  if (isSub) homeBench.push(playerObj)
                  else homeStarters.push(playerObj)
                } else {
                  if (itemTeamName && !awayTeamName) awayTeamName = itemTeamName
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

                if (matchingJogoRecord) {
                  try {
                    matchingJogoRecord.set('escalacoes', result)
                    $app.save(matchingJogoRecord)
                  } catch (_) {}
                }
              }
            }
          }
        } catch (errTsdb) {
          console.log('[Escalacoes] Erro ao buscar TheSportsDB lineups:', errTsdb)
        }
      }

      // 5. FONTE 4: Prováveis / Elenco no TheSportsDB searchplayers.php
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
                } else {
                  // Sem corte prematuro no banco — preenche todos os reservas disponíveis
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

            if (matchingJogoRecord) {
              try {
                matchingJogoRecord.set('escalacoes', result)
                $app.save(matchingJogoRecord)
                console.log(
                  '[Escalacoes] Elenco provável persistido no jogo id: ' + matchingJogoRecord.id,
                )
              } catch (_) {}
            }
          }
        } catch (errSquad) {
          console.log('[Escalacoes] Erro ao buscar elenco/prováveis:', errSquad)
        }
      }

      // 6. Se nenhuma fonte possuir a escalação no momento, retorna indisponível
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

      // Salva em cache do servidor
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
