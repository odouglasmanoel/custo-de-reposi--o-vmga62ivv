// pocketbase/hooks/auto_fixture_id.js
// Hook executado antes ou durante a criação e atualização de registros em 'jogos' e 'enquete_jogos'.
// Se fixture_id vier vazio, tenta buscar automaticamente pelo cruzamento de data + nomes dos times na API-Football / jogos_do_dia.
// Em caso de falha ou cota esgotada, persiste o jogo normalmente com fixture_id vazio, SEM erro para o usuário.
// ZERO declarações top-level: 100% da lógica e dos helpers inlined dentro de cada callback.

// 1. Hook para 'jogos' (Create)
onRecordCreate((e) => {
  var rec = e.record
  try {
    var curFixtureId = (rec.getString('fixture_id') || '').trim()
    if (!curFixtureId) {
      var timeA = (rec.getString('time_a') || '').trim()
      var timeB = (rec.getString('time_b') || '').trim()
      var dataVal = (rec.getString('data') || '').trim()

      if (timeA && timeB && dataVal) {
        var autoNormStr = function (str) {
          if (!str) return ''
          var s = String(str).toLowerCase()
          if (typeof s.normalize === 'function') {
            try {
              s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            } catch (_) {}
          }
          s = s.replace(/[^a-z0-9\s]/g, ' ')
          var rawTokens = s.split(/\s+/).filter(Boolean)
          var stopWords = [
            'afc',
            'fc',
            'sc',
            'cf',
            'clube',
            'club',
            'de',
            'do',
            'da',
            'dos',
            'das',
            'futebol',
            'ec',
            'cr',
            'ca',
            'sp',
            'rj',
            'mg',
            'rs',
            'pr',
            'esporte',
            'atletico',
            'atletica',
            'associacao',
            'united',
            'city',
          ]
          var cleanTokens = []
          for (var i = 0; i < rawTokens.length; i++) {
            if (stopWords.indexOf(rawTokens[i]) === -1) {
              cleanTokens.push(rawTokens[i])
            }
          }
          return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
        }

        var autoLevenshtein = function (a, b) {
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

        var autoTimesCoincidem = function (a, b) {
          var normA = autoNormStr(a)
          var normB = autoNormStr(b)
          if (!normA || !normB) return false
          if (normA === normB) return true
          if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true

          var rawA = normA.split(/\s+/)
          var rawB = normB.split(/\s+/)
          var tA = []
          for (var ia = 0; ia < rawA.length; ia++) {
            if (rawA[ia].length >= 3) tA.push(rawA[ia])
          }
          var tB = []
          for (var ib = 0; ib < rawB.length; ib++) {
            if (rawB[ib].length >= 3) tB.push(rawB[ib])
          }

          for (var ti = 0; ti < tA.length; ti++) {
            if (tB.indexOf(tA[ti]) !== -1) return true
          }

          var maxLen = Math.max(normA.length, normB.length)
          if (maxLen === 0) return true
          var dist = autoLevenshtein(normA, normB)
          return 1 - dist / maxLen >= 0.75
        }

        var autoFormatarDataISO = function (dataRaw) {
          if (!dataRaw) return ''
          var str = String(dataRaw).trim()
          var brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
          if (brMatch) return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
          var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
          if (isoMatch) return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3]
          return ''
        }

        var isoDateLocal = autoFormatarDataISO(dataVal)
        var foundId = ''

        // 1. Tenta resolver via jogos_do_dia local (sem custo de cota)
        try {
          var filt = ''
          if (isoDateLocal) filt = "data = '" + isoDateLocal + "'"
          var jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
          for (var i = 0; i < jdds.length; i++) {
            var tc = jdds[i].getString('time_casa') || ''
            var tv = jdds[i].getString('time_visitante') || ''
            var matchDir = autoTimesCoincidem(timeA, tc) && autoTimesCoincidem(timeB, tv)
            var matchInv = autoTimesCoincidem(timeA, tv) && autoTimesCoincidem(timeB, tc)
            if (matchDir || matchInv) {
              var fid = (jdds[i].getString('fixture_id') || '').trim()
              if (fid && /^\d+$/.test(fid)) {
                foundId = fid
                break
              }
            }
          }
        } catch (_) {}

        // 2. Busca na API-Football por data se não encontrou localmente
        if (!foundId && isoDateLocal) {
          try {
            var apiKey = ''
            try {
              var cfgRec = $app.findFirstRecordByData(
                'config_integracoes',
                'chave',
                'placar_ao_vivo',
              )
              if (cfgRec) apiKey = (cfgRec.getString('api_key') || '').trim()
            } catch (_) {}

            if (!apiKey) {
              try {
                if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
                  apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
                } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
                  apiKey = ($secrets.get('RAPIDAPI_KEY') || '').trim()
                } else if ($os && $os.getenv) {
                  apiKey = (
                    $os.getenv('API_FOOTBALL_KEY') ||
                    $os.getenv('RAPIDAPI_KEY') ||
                    ''
                  ).trim()
                }
              } catch (_) {}
            }

            if (apiKey) {
              var limiterMod = null
              try {
                limiterMod = require(__hooks + '/api_football_limiter.js')
              } catch (_) {
                try {
                  limiterMod = require('./api_football_limiter.js')
                } catch (_) {}
              }

              if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
                var isRapid = apiKey.length > 40
                var url = isRapid
                  ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                    encodeURIComponent(isoDateLocal) +
                    '&timezone=America%2FSao_Paulo'
                  : 'https://v3.football.api-sports.io/fixtures?date=' +
                    encodeURIComponent(isoDateLocal) +
                    '&timezone=America%2FSao_Paulo'
                var headers = isRapid
                  ? {
                      'x-rapidapi-key': apiKey,
                      'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                    }
                  : { 'x-apisports-key': apiKey }

                var limiterRes = limiterMod.enviarRequisicaoApiFootball(
                  url,
                  { headers: headers, timeout: 12 },
                  2,
                )
                if (
                  !limiterRes.blocked &&
                  limiterRes.json &&
                  Array.isArray(limiterRes.json.response)
                ) {
                  for (var k = 0; k < limiterRes.json.response.length; k++) {
                    var item = limiterRes.json.response[k]
                    var hName = (item.teams && item.teams.home && item.teams.home.name) || ''
                    var aName = (item.teams && item.teams.away && item.teams.away.name) || ''
                    if (
                      (autoTimesCoincidem(timeA, hName) && autoTimesCoincidem(timeB, aName)) ||
                      (autoTimesCoincidem(timeA, aName) && autoTimesCoincidem(timeB, hName))
                    ) {
                      var fidFound = item.fixture && item.fixture.id ? String(item.fixture.id) : ''
                      if (fidFound && /^\d+$/.test(fidFound)) {
                        foundId = fidFound
                        break
                      }
                    }
                  }
                }
              }
            }
          } catch (errApi) {
            console.log('[auto_fixture_id jogos] Erro na busca API:', errApi)
          }
        }

        if (foundId) {
          rec.set('fixture_id', foundId)
          console.log(
            '[auto_fixture_id jogos] fixture_id ' +
              foundId +
              ' atribuído a ' +
              timeA +
              ' x ' +
              timeB,
          )
        }
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id jogos] Aviso não-bloqueante:', err)
  }

  e.next()
}, 'jogos')

// 2. Hook para 'enquete_jogos' (Create)
onRecordCreate((e) => {
  var rec = e.record
  try {
    var curFixtureId = (rec.getString('fixture_id') || '').trim()
    var timeA = (rec.getString('time_a') || '').trim()
    var timeB = (rec.getString('time_b') || '').trim()
    var dataVal = (rec.getString('data') || '').trim()

    if (!curFixtureId && timeA && timeB && dataVal) {
      var autoNormStr = function (str) {
        if (!str) return ''
        var s = String(str).toLowerCase()
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        s = s.replace(/[^a-z0-9\s]/g, ' ')
        var rawTokens = s.split(/\s+/).filter(Boolean)
        var stopWords = [
          'afc',
          'fc',
          'sc',
          'cf',
          'clube',
          'club',
          'de',
          'do',
          'da',
          'dos',
          'das',
          'futebol',
          'ec',
          'cr',
          'ca',
          'sp',
          'rj',
          'mg',
          'rs',
          'pr',
          'esporte',
          'atletico',
          'atletica',
          'associacao',
          'united',
          'city',
        ]
        var cleanTokens = []
        for (var i = 0; i < rawTokens.length; i++) {
          if (stopWords.indexOf(rawTokens[i]) === -1) {
            cleanTokens.push(rawTokens[i])
          }
        }
        var cStr = cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
        var compact = cStr.replace(/\s+/g, '')
        var paisesMap = {
          jamaica: 'jamaica',
          honduras: 'honduras',
          elsalvador: 'el salvador',
          martinica: 'martinique',
          martinique: 'martinique',
          montserrat: 'montserrat',
          ilhasvirgensbritanicas: 'british virgin islands',
          virgensbritanicas: 'british virgin islands',
          britishvirginislands: 'british virgin islands',
          ilhasvirgensamericanas: 'us virgin islands',
          virgensamericanas: 'us virgin islands',
          usvirginislands: 'us virgin islands',
          saomartinho: 'saint martin',
          saintmartin: 'saint martin',
          sintmaarten: 'sint maarten',
          saovicenteegranadinas: 'saint vincent and the grenadines',
          saovicente: 'saint vincent',
          saintvincent: 'saint vincent',
          guianafrancesa: 'french guiana',
          frenchguiana: 'french guiana',
          tchequia: 'czech republic',
          republicatcheca: 'czech republic',
          czechrepublic: 'czech republic',
          georgia: 'georgia',
          irlandadonorte: 'northern ireland',
          northernireland: 'northern ireland',
          italia: 'italy',
          belgica: 'belgium',
          turquia: 'turkey',
          franca: 'france',
          portugal: 'portugal',
          dinamarca: 'denmark',
          noruega: 'norway',
          inglaterra: 'england',
          espanha: 'spain',
          escocia: 'scotland',
          paisdegales: 'wales',
          japao: 'japan',
          uruguai: 'uruguay',
        }
        if (paisesMap[compact]) return paisesMap[compact]
        return cStr
      }

      var autoLevenshtein = function (a, b) {
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

      var autoTimesCoincidem = function (a, b) {
        var normA = autoNormStr(a)
        var normB = autoNormStr(b)
        if (!normA || !normB) return false
        if (normA === normB) return true
        if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true

        var rawA = normA.split(/\s+/)
        var rawB = normB.split(/\s+/)
        var tA = []
        for (var ia = 0; ia < rawA.length; ia++) {
          if (rawA[ia].length >= 3) tA.push(rawA[ia])
        }
        var tB = []
        for (var ib = 0; ib < rawB.length; ib++) {
          if (rawB[ib].length >= 3) tB.push(rawB[ib])
        }

        for (var ti = 0; ti < tA.length; ti++) {
          if (tB.indexOf(tA[ti]) !== -1) return true
        }

        var maxLen = Math.max(normA.length, normB.length)
        if (maxLen === 0) return true
        var dist = autoLevenshtein(normA, normB)
        return 1 - dist / maxLen >= 0.75
      }

      var autoFormatarDataISO = function (dataRaw) {
        if (!dataRaw) return ''
        var str = String(dataRaw).trim()
        var brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (brMatch) return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
        var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (isoMatch) return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3]
        return ''
      }

      var isoDate = autoFormatarDataISO(dataVal)
      var foundResult = null

      // 1. Tenta resolver via jogos_do_dia local (sem custo de cota)
      try {
        var filt = ''
        if (isoDate) filt = "data = '" + isoDate + "'"
        var jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
        for (var i = 0; i < jdds.length; i++) {
          var tc = jdds[i].getString('time_casa') || ''
          var tv = jdds[i].getString('time_visitante') || ''
          var matchDir = autoTimesCoincidem(timeA, tc) && autoTimesCoincidem(timeB, tv)
          var matchInv = autoTimesCoincidem(timeA, tv) && autoTimesCoincidem(timeB, tc)
          if (matchDir || matchInv) {
            var fid = (jdds[i].getString('fixture_id') || '').trim()
            if (fid && /^\d+$/.test(fid)) {
              var logoA = matchDir
                ? jdds[i].getString('logo_casa')
                : jdds[i].getString('logo_visitante')
              var logoB = matchDir
                ? jdds[i].getString('logo_visitante')
                : jdds[i].getString('logo_casa')
              if (logoA && logoA.indexOf('thesportsdb.com') !== -1) logoA = ''
              if (logoB && logoB.indexOf('thesportsdb.com') !== -1) logoB = ''
              foundResult = {
                fixture_id: fid,
                logo_mandante: logoA || '',
                logo_visitante: logoB || '',
              }
              break
            }
          }
        }
      } catch (_) {}

      // 2. Busca na API-Football por data se não encontrou localmente
      if (!foundResult && isoDate) {
        try {
          var apiKey = ''
          try {
            var cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
            if (cfgRec) apiKey = (cfgRec.getString('api_key') || '').trim()
          } catch (_) {}

          if (!apiKey) {
            try {
              if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
                apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
              } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
                apiKey = ($secrets.get('RAPIDAPI_KEY') || '').trim()
              } else if ($os && $os.getenv) {
                apiKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
              }
            } catch (_) {}
          }

          if (apiKey) {
            var limiterMod = null
            try {
              limiterMod = require(__hooks + '/api_football_limiter.js')
            } catch (_) {
              try {
                limiterMod = require('./api_football_limiter.js')
              } catch (_) {}
            }

            if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
              var isRapid = apiKey.length > 40
              var datesToTry = [isoDate]
              try {
                var p = isoDate.split('-')
                if (p.length === 3) {
                  var nd = new Date(
                    Date.UTC(
                      parseInt(p[0], 10),
                      parseInt(p[1], 10) - 1,
                      parseInt(p[2], 10) + 1,
                      12,
                      0,
                      0,
                    ),
                  )
                  var ndIso = nd.toISOString().slice(0, 10)
                  if (ndIso && datesToTry.indexOf(ndIso) === -1) datesToTry.push(ndIso)
                }
              } catch (_) {}

              var headers = isRapid
                ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
                : { 'x-apisports-key': apiKey }

              for (var dtIdx = 0; dtIdx < datesToTry.length; dtIdx++) {
                var dTarget = datesToTry[dtIdx]
                var url = isRapid
                  ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                    encodeURIComponent(dTarget) +
                    '&timezone=America%2FSao_Paulo'
                  : 'https://v3.football.api-sports.io/fixtures?date=' +
                    encodeURIComponent(dTarget) +
                    '&timezone=America%2FSao_Paulo'

                var limiterRes = limiterMod.enviarRequisicaoApiFootball(
                  url,
                  { headers: headers, timeout: 12 },
                  2,
                )
                if (
                  !limiterRes.blocked &&
                  limiterRes.json &&
                  Array.isArray(limiterRes.json.response)
                ) {
                  for (var k = 0; k < limiterRes.json.response.length; k++) {
                    var item = limiterRes.json.response[k]
                    var hName = (item.teams && item.teams.home && item.teams.home.name) || ''
                    var aName = (item.teams && item.teams.away && item.teams.away.name) || ''
                    var matchDirApi =
                      autoTimesCoincidem(timeA, hName) && autoTimesCoincidem(timeB, aName)
                    var matchInvApi =
                      autoTimesCoincidem(timeA, aName) && autoTimesCoincidem(timeB, hName)
                    if (matchDirApi || matchInvApi) {
                      var fidFound = item.fixture && item.fixture.id ? String(item.fixture.id) : ''
                      if (fidFound && /^\d+$/.test(fidFound)) {
                        var hLogo = (item.teams && item.teams.home && item.teams.home.logo) || ''
                        var aLogo = (item.teams && item.teams.away && item.teams.away.logo) || ''
                        foundResult = {
                          fixture_id: fidFound,
                          logo_mandante: matchDirApi ? hLogo : aLogo,
                          logo_visitante: matchDirApi ? aLogo : hLogo,
                        }
                        break
                      }
                    }
                  }
                }
                if (foundResult) break
              }
            }
          }
        } catch (errApi) {
          console.log('[auto_fixture_id enquete_jogos] Erro na busca API:', errApi)
        }
      }

      if (foundResult && foundResult.fixture_id) {
        rec.set('fixture_id', foundResult.fixture_id)
        if (foundResult.logo_mandante) {
          rec.set('logo_casa', foundResult.logo_mandante)
        }
        if (foundResult.logo_visitante) {
          rec.set('logo_visitante', foundResult.logo_visitante)
        }
        console.log(
          '[auto_fixture_id enquete_jogos:create] fixture_id ' +
            foundResult.fixture_id +
            ' e escudos oficiais atribuídos a ' +
            timeA +
            ' x ' +
            timeB,
        )
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id enquete_jogos:create] Aviso não-bloqueante:', err)
  }
  e.next()
}, 'enquete_jogos')

// 3. Hook para 'enquete_jogos' (Update)
onRecordUpdate((e) => {
  var rec = e.record
  try {
    var curFixtureId = (rec.getString('fixture_id') || '').trim()
    var timeA = (rec.getString('time_a') || '').trim()
    var timeB = (rec.getString('time_b') || '').trim()
    var dataVal = (rec.getString('data') || '').trim()

    if (!curFixtureId && timeA && timeB && dataVal) {
      var autoNormStr = function (str) {
        if (!str) return ''
        var s = String(str).toLowerCase()
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        s = s.replace(/[^a-z0-9\s]/g, ' ')
        var rawTokens = s.split(/\s+/).filter(Boolean)
        var stopWords = [
          'afc',
          'fc',
          'sc',
          'cf',
          'clube',
          'club',
          'de',
          'do',
          'da',
          'dos',
          'das',
          'futebol',
          'ec',
          'cr',
          'ca',
          'sp',
          'rj',
          'mg',
          'rs',
          'pr',
          'esporte',
          'atletico',
          'atletica',
          'associacao',
          'united',
          'city',
        ]
        var cleanTokens = []
        for (var i = 0; i < rawTokens.length; i++) {
          if (stopWords.indexOf(rawTokens[i]) === -1) {
            cleanTokens.push(rawTokens[i])
          }
        }
        var cStr = cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
        var compact = cStr.replace(/\s+/g, '')
        var paisesMap = {
          jamaica: 'jamaica',
          honduras: 'honduras',
          elsalvador: 'el salvador',
          martinica: 'martinique',
          martinique: 'martinique',
          montserrat: 'montserrat',
          ilhasvirgensbritanicas: 'british virgin islands',
          virgensbritanicas: 'british virgin islands',
          britishvirginislands: 'british virgin islands',
          ilhasvirgensamericanas: 'us virgin islands',
          virgensamericanas: 'us virgin islands',
          usvirginislands: 'us virgin islands',
          saomartinho: 'saint martin',
          saintmartin: 'saint martin',
          sintmaarten: 'sint maarten',
          saovicenteegranadinas: 'saint vincent and the grenadines',
          saovicente: 'saint vincent',
          saintvincent: 'saint vincent',
          guianafrancesa: 'french guiana',
          frenchguiana: 'french guiana',
          tchequia: 'czech republic',
          republicatcheca: 'czech republic',
          czechrepublic: 'czech republic',
          georgia: 'georgia',
          irlandadonorte: 'northern ireland',
          northernireland: 'northern ireland',
          italia: 'italy',
          belgica: 'belgium',
          turquia: 'turkey',
          franca: 'france',
          portugal: 'portugal',
          dinamarca: 'denmark',
          noruega: 'norway',
          inglaterra: 'england',
          espanha: 'spain',
          escocia: 'scotland',
          paisdegales: 'wales',
          japao: 'japan',
          uruguai: 'uruguay',
        }
        if (paisesMap[compact]) return paisesMap[compact]
        return cStr
      }

      var autoLevenshtein = function (a, b) {
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

      var autoTimesCoincidem = function (a, b) {
        var normA = autoNormStr(a)
        var normB = autoNormStr(b)
        if (!normA || !normB) return false
        if (normA === normB) return true
        if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true

        var rawA = normA.split(/\s+/)
        var rawB = normB.split(/\s+/)
        var tA = []
        for (var ia = 0; ia < rawA.length; ia++) {
          if (rawA[ia].length >= 3) tA.push(rawA[ia])
        }
        var tB = []
        for (var ib = 0; ib < rawB.length; ib++) {
          if (rawB[ib].length >= 3) tB.push(rawB[ib])
        }

        for (var ti = 0; ti < tA.length; ti++) {
          if (tB.indexOf(tA[ti]) !== -1) return true
        }

        var maxLen = Math.max(normA.length, normB.length)
        if (maxLen === 0) return true
        var dist = autoLevenshtein(normA, normB)
        return 1 - dist / maxLen >= 0.75
      }

      var autoFormatarDataISO = function (dataRaw) {
        if (!dataRaw) return ''
        var str = String(dataRaw).trim()
        var brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (brMatch) return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
        var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (isoMatch) return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3]
        return ''
      }

      var isoDate = autoFormatarDataISO(dataVal)
      var foundResult = null

      // 1. Tenta resolver via jogos_do_dia local (sem custo de cota)
      try {
        var filt = ''
        if (isoDate) filt = "data = '" + isoDate + "'"
        var jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
        for (var i = 0; i < jdds.length; i++) {
          var tc = jdds[i].getString('time_casa') || ''
          var tv = jdds[i].getString('time_visitante') || ''
          var matchDir = autoTimesCoincidem(timeA, tc) && autoTimesCoincidem(timeB, tv)
          var matchInv = autoTimesCoincidem(timeA, tv) && autoTimesCoincidem(timeB, tc)
          if (matchDir || matchInv) {
            var fid = (jdds[i].getString('fixture_id') || '').trim()
            if (fid && /^\d+$/.test(fid)) {
              var logoA = matchDir
                ? jdds[i].getString('logo_casa')
                : jdds[i].getString('logo_visitante')
              var logoB = matchDir
                ? jdds[i].getString('logo_visitante')
                : jdds[i].getString('logo_casa')
              if (logoA && logoA.indexOf('thesportsdb.com') !== -1) logoA = ''
              if (logoB && logoB.indexOf('thesportsdb.com') !== -1) logoB = ''
              foundResult = {
                fixture_id: fid,
                logo_mandante: logoA || '',
                logo_visitante: logoB || '',
              }
              break
            }
          }
        }
      } catch (_) {}

      // 2. Busca na API-Football por data se não encontrou localmente
      if (!foundResult && isoDate) {
        try {
          var apiKey = ''
          try {
            var cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
            if (cfgRec) apiKey = (cfgRec.getString('api_key') || '').trim()
          } catch (_) {}

          if (!apiKey) {
            try {
              if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
                apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
              } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
                apiKey = ($secrets.get('RAPIDAPI_KEY') || '').trim()
              } else if ($os && $os.getenv) {
                apiKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
              }
            } catch (_) {}
          }

          if (apiKey) {
            var limiterMod = null
            try {
              limiterMod = require(__hooks + '/api_football_limiter.js')
            } catch (_) {
              try {
                limiterMod = require('./api_football_limiter.js')
              } catch (_) {}
            }

            if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
              var isRapid = apiKey.length > 40
              var url = isRapid
                ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                  encodeURIComponent(isoDate) +
                  '&timezone=America%2FSao_Paulo'
                : 'https://v3.football.api-sports.io/fixtures?date=' +
                  encodeURIComponent(isoDate) +
                  '&timezone=America%2FSao_Paulo'
              var headers = isRapid
                ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
                : { 'x-apisports-key': apiKey }

              var limiterRes = limiterMod.enviarRequisicaoApiFootball(
                url,
                { headers: headers, timeout: 12 },
                2,
              )
              if (
                !limiterRes.blocked &&
                limiterRes.json &&
                Array.isArray(limiterRes.json.response)
              ) {
                for (var k = 0; k < limiterRes.json.response.length; k++) {
                  var item = limiterRes.json.response[k]
                  var hName = (item.teams && item.teams.home && item.teams.home.name) || ''
                  var aName = (item.teams && item.teams.away && item.teams.away.name) || ''
                  var matchDirApi =
                    autoTimesCoincidem(timeA, hName) && autoTimesCoincidem(timeB, aName)
                  var matchInvApi =
                    autoTimesCoincidem(timeA, aName) && autoTimesCoincidem(timeB, hName)
                  if (matchDirApi || matchInvApi) {
                    var fidFound = item.fixture && item.fixture.id ? String(item.fixture.id) : ''
                    if (fidFound && /^\d+$/.test(fidFound)) {
                      var hLogo = (item.teams && item.teams.home && item.teams.home.logo) || ''
                      var aLogo = (item.teams && item.teams.away && item.teams.away.logo) || ''
                      foundResult = {
                        fixture_id: fidFound,
                        logo_mandante: matchDirApi ? hLogo : aLogo,
                        logo_visitante: matchDirApi ? aLogo : hLogo,
                      }
                      break
                    }
                  }
                }
              }
            }
          }
        } catch (errApi) {
          console.log('[auto_fixture_id enquete_jogos:update] Erro na busca API:', errApi)
        }
      }

      if (foundResult && foundResult.fixture_id) {
        rec.set('fixture_id', foundResult.fixture_id)
        if (foundResult.logo_mandante) {
          rec.set('logo_casa', foundResult.logo_mandante)
        }
        if (foundResult.logo_visitante) {
          rec.set('logo_visitante', foundResult.logo_visitante)
        }
        console.log(
          '[auto_fixture_id enquete_jogos:update] fixture_id ' +
            foundResult.fixture_id +
            ' e escudos atribuídos a ' +
            timeA +
            ' x ' +
            timeB,
        )
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id enquete_jogos:update] Aviso não-bloqueante:', err)
  }
  e.next()
}, 'enquete_jogos')
