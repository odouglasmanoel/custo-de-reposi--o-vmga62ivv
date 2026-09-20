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

      // 1. Recupera exclusivamente a chave da API-Football
      var apiKey = ''

      try {
        var configRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
        if (configRec) {
          apiKey = (configRec.getString('api_key') || '').trim()
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

      // ESPECIFICAÇÃO 2a: Fallbacks TheSportsDB e Football-Data.org removidos.
      // API-Football é a ÚNICA fonte de escalações.

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

// =============================================================
// EDIÇÃO 2b: ROTINA PRÉ-JOGO DE ESCALAÇÕES
// Para cada jogo pendente do bolão com kickoff a menos de 60 min (ou iniciado),
// garante fixture_id numérico (resolve se preciso via /v3/fixtures?date= ou match)
// e busca/salva escalação completa (11 titulares + reservas + formação) em jogos.escalacoes.
// Persiste imediatamente no banco via $app.save.
// =============================================================
var sincronizarEscalacoesPreJogo = function () {
  try {
    var agora = Date.now()
    var cfgRec = null
    try {
      cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    } catch (_) {}

    var apiKey = ''
    if (cfgRec) {
      apiKey = (cfgRec.getString('api_key') || '').trim()
    }
    if (!apiKey) {
      if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
        apiKey = $secrets.get('API_FOOTBALL_KEY')
      } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
        apiKey = $secrets.get('RAPIDAPI_KEY')
      } else if ($os && $os.getenv) {
        apiKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
      }
    }
    if (!apiKey) return

    var isRapid = apiKey.length > 40
    var headers = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    var jogosPendentes = $app.findRecordsByFilter(
      'jogos',
      'resultado_finalizado = false',
      '-data',
      100,
      0,
    )
    if (!Array.isArray(jogosPendentes) || jogosPendentes.length === 0) return

    for (var ji = 0; ji < jogosPendentes.length; ji++) {
      var jRec = jogosPendentes[ji]
      var dtVal = (jRec.getString('data') || '').trim()
      var hrVal = (jRec.getString('hora') || '').trim()
      var timeA = (jRec.getString('time_a') || '').trim()
      var timeB = (jRec.getString('time_b') || '').trim()
      var fixtureId = (jRec.getString('fixture_id') || '').trim()

      // Calcula kickoff timestamp em ms
      var kickoffMs = null
      if (dtVal) {
        var y = 0,
          m = 0,
          d = 0
        var brM = dtVal.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (brM) {
          d = parseInt(brM[1], 10)
          m = parseInt(brM[2], 10)
          y = parseInt(brM[3], 10)
        } else {
          var isoM = dtVal.match(/^(\d{4})-(\d{2})-(\d{2})/)
          if (isoM) {
            y = parseInt(isoM[1], 10)
            m = parseInt(isoM[2], 10)
            d = parseInt(isoM[3], 10)
          }
        }
        var hrs = 16,
          mins = 0
        if (hrVal) {
          var hrM = hrVal.match(/^(\d{1,2}):(\d{2})/)
          if (hrM) {
            hrs = parseInt(hrM[1], 10)
            mins = parseInt(hrM[2], 10)
          }
        }
        if (y && m && d) {
          // Horário de Brasília (UTC-3): soma 3h para obter UTC
          kickoffMs = Date.UTC(y, m - 1, d, hrs + 3, mins, 0, 0)
        }
      }

      // Critério pré-jogo: kickoff a menos de 60 min (ou já iniciado há até 4h)
      if (!kickoffMs) continue
      var janelaInicio = kickoffMs - 60 * 60 * 1000
      var janelaFim = kickoffMs + 4 * 60 * 60 * 1000
      if (agora < janelaInicio || agora > janelaFim) continue

      // Se já possui escalação confirmada completa persistida, não repete chamada desnecessária
      var escAtual = jRec.get('escalacoes')
      if (escAtual) {
        var objEsc = typeof escAtual === 'string' ? JSON.parse(escAtual) : escAtual
        if (
          objEsc &&
          objEsc.status === 'confirmada' &&
          Array.isArray(objEsc.teams) &&
          objEsc.teams.length > 0
        ) {
          var temStarters =
            objEsc.teams[0] &&
            Array.isArray(objEsc.teams[0].starters) &&
            objEsc.teams[0].starters.length > 0
          if (temStarters) continue
        }
      }

      // Se o fixture_id não for numérico (tsdb_* ou vazio), tenta resolver via /v3/fixtures?date=
      var isNumerico = fixtureId && /^\d+$/.test(fixtureId)
      if (!isNumerico && dtVal) {
        var isoData = dtVal
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dtVal)) {
          var pBr = dtVal.split('/')
          isoData = pBr[2] + '-' + pBr[1] + '-' + pBr[0]
        }
        try {
          var resDateUrl = isRapid
            ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
              encodeURIComponent(isoData) +
              '&timezone=America%2FSao_Paulo'
            : 'https://v3.football.api-sports.io/fixtures?date=' +
              encodeURIComponent(isoData) +
              '&timezone=America%2FSao_Paulo'
          var resFix = $http.send({
            url: resDateUrl,
            method: 'GET',
            headers: headers,
            timeout: 8,
          })
          if (
            resFix &&
            resFix.statusCode === 200 &&
            resFix.json &&
            Array.isArray(resFix.json.response)
          ) {
            var candList = resFix.json.response
            for (var cli = 0; cli < candList.length; cli++) {
              var cItem = candList[cli]
              var cH = (cItem.teams && cItem.teams.home && cItem.teams.home.name) || ''
              var cA = (cItem.teams && cItem.teams.away && cItem.teams.away.name) || ''
              if (
                (timesCoincidem(timeA, cH) && timesCoincidem(timeB, cA)) ||
                (timesCoincidem(timeA, cA) && timesCoincidem(timeB, cH))
              ) {
                if (cItem.fixture && cItem.fixture.id) {
                  fixtureId = String(cItem.fixture.id)
                  isNumerico = true
                  jRec.set('fixture_id', fixtureId)
                  if (
                    cItem.teams &&
                    cItem.teams.home &&
                    cItem.teams.home.logo &&
                    !jRec.getString('escudo_time_a')
                  ) {
                    jRec.set('escudo_time_a', cItem.teams.home.logo)
                  }
                  if (
                    cItem.teams &&
                    cItem.teams.away &&
                    cItem.teams.away.logo &&
                    !jRec.getString('escudo_time_b')
                  ) {
                    jRec.set('escudo_time_b', cItem.teams.away.logo)
                  }
                  try {
                    $app.save(jRec)
                    console.log(
                      '[Escalacoes Pré-Jogo] fixture_id numérico ' +
                        fixtureId +
                        ' resolvido e persistido para jogo ' +
                        jRec.id,
                    )
                  } catch (errSaveFid) {
                    console.log('[Escalacoes Pré-Jogo] Erro ao salvar fixture_id:', errSaveFid)
                  }
                  break
                }
              }
            }
          }
        } catch (errResFix) {
          console.log('[Escalacoes Pré-Jogo] Erro ao resolver fixture_id por data:', errResFix)
        }
      }

      if (!isNumerico) continue

      // Busca escalação na API-Football
      try {
        var urlLineups = isRapid
          ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/lineups?fixture=' +
            encodeURIComponent(fixtureId)
          : 'https://v3.football.api-sports.io/fixtures/lineups?fixture=' +
            encodeURIComponent(fixtureId)
        var resLineups = $http.send({
          url: urlLineups,
          method: 'GET',
          headers: headers,
          timeout: 8,
        })

        if (
          resLineups &&
          resLineups.statusCode === 200 &&
          resLineups.json &&
          Array.isArray(resLineups.json.response) &&
          resLineups.json.response.length > 0
        ) {
          var rawLineups = resLineups.json.response
          var teamsData = []
          for (var ti = 0; ti < rawLineups.length; ti++) {
            var tb = rawLineups[ti]
            var tInfo = tb.team || {}
            var formation = tb.formation || ''
            var coach = tb.coach ? tb.coach.name : ''
            var starters = []
            if (Array.isArray(tb.startXI)) {
              for (var si = 0; si < tb.startXI.length; si++) {
                var sp = tb.startXI[si].player || {}
                starters.push({
                  id: sp.id ? String(sp.id) : '',
                  name: sp.name || '',
                  number: sp.number || null,
                  pos: sp.pos || '',
                  grid: sp.grid || null,
                })
              }
            }
            var substitutes = []
            if (Array.isArray(tb.substitutes)) {
              for (var bi = 0; bi < tb.substitutes.length; bi++) {
                var bp = tb.substitutes[bi].player || {}
                substitutes.push({
                  id: bp.id ? String(bp.id) : '',
                  name: bp.name || '',
                  number: bp.number || null,
                  pos: bp.pos || '',
                })
              }
            }

            var tName = tInfo.name || ''
            var tLogo = tInfo.logo || ''
            if (tName.toLowerCase().indexOf('paris') !== -1 || tName.toLowerCase() === 'psg') {
              tLogo = 'https://media.api-sports.io/football/teams/85.png'
            }

            teamsData.push({
              teamId: tInfo.id ? String(tInfo.id) : '',
              teamName: tName,
              teamLogo: tLogo,
              formation: formation,
              coach: coach,
              starters: starters,
              substitutes: substitutes,
            })
          }

          if (teamsData.length > 0) {
            var lineupPayload = {
              status: 'confirmada',
              provider: 'api_football',
              fixtureId: fixtureId,
              teams: teamsData,
              updatedAt: new Date().toISOString(),
            }
            jRec.set('escalacoes', lineupPayload)
            try {
              $app.save(jRec)
              console.log(
                '[Escalacoes Pré-Jogo] Escalação confirmada salva com sucesso para jogo ' +
                  jRec.id +
                  ' (' +
                  timeA +
                  ' x ' +
                  timeB +
                  ')',
              )
            } catch (errSaveEsc) {
              console.log(
                '[Escalacoes Pré-Jogo] Erro ao persistir escalações no jogo ' + jRec.id + ':',
                errSaveEsc,
              )
            }
          }
        }
      } catch (errFetchLineup) {
        console.log(
          '[Escalacoes Pré-Jogo] Erro ao buscar lineups para fixture ' + fixtureId + ':',
          errFetchLineup,
        )
      }
    }
  } catch (errSync) {
    console.log('[Escalacoes Pré-Jogo] Erro geral na sincronização:', errSync)
  }
}

// Expõe rotina pré-jogo no escopo global para acionamento por cron e disparador
if (typeof globalThis !== 'undefined') {
  globalThis.__sincronizarEscalacoesPreJogo = sincronizarEscalacoesPreJogo
}
