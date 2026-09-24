// pocketbase/hooks/admin_editar_jogo.js
// Endpoint administrativo seguro para edição cadastral de partida e vinculação automática de fixture/escudos.
// Protegido por checagem de Admin (Douglas).
//
// REGRAS GOJA / POCKETBASE:
// - Toda lógica e helpers inline dentro do callback (SEM requires externos dinâmicos)
// - NENHUM spread ({ ...obj }) nem funções transpiladas globais
// - Atribuição direta de propriedades

routerAdd('POST', '/backend/v1/admin/editar-jogo', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Acesso não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Apenas o Administrador pode editar jogos.')
    }

    const body = e.requestInfo().body || {}
    const jogoId = (body.jogo_id || '').trim()
    const timeA = (body.time_a || '').trim()
    const timeB = (body.time_b || '').trim()
    const dataVal = (body.data || '').trim()
    const horaVal = (body.hora || '').trim()
    const competicaoVal = (body.competicao || '').trim()
    const manualFixtureId = body.fixture_id !== undefined ? String(body.fixture_id).trim() : null

    if (!jogoId) {
      return e.badRequestError('ID do jogo é obrigatório (jogo_id).')
    }
    if (!timeA || !timeB) {
      return e.badRequestError('Nomes dos times mandante e visitante são obrigatórios.')
    }

    let jogoRec = null
    try {
      jogoRec = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.notFoundError('Jogo não encontrado.')
    }

    // REGRA IMPORTANTE: Persistência e trava de fixture_id
    // 1) Se o admin enviou fixture_id manualmente preenchido (numérico), atribui e persiste diretamente.
    // 2) Se o admin não enviou ou enviou vazio/espaços, mas o jogo JÁ possui fixture_id gravado no banco,
    //    NUNCA apagar nem sobrescrever! Manter o fixture_id gravado intacto.
    // 3) Se o jogo não possuía fixture_id e nenhum foi informado, permanece vazio (candidato à busca automática se aplicável).
    const existingFixtureId = (jogoRec.getString('fixture_id') || '').trim()
    let effectiveFixtureId = existingFixtureId
    let fixtureManualInformado = false

    if (manualFixtureId && /^\d+$/.test(manualFixtureId)) {
      effectiveFixtureId = manualFixtureId
      jogoRec.set('fixture_id', manualFixtureId)
      fixtureManualInformado = true
    } else if (existingFixtureId) {
      // Garante que o fixture_id existente nunca seja zerado ou sobrescrito
      jogoRec.set('fixture_id', existingFixtureId)
    }

    // Salva os dados cadastrais no registro da coleção jogos
    jogoRec.set('time_a', timeA)
    jogoRec.set('time_b', timeB)
    if (dataVal) {
      jogoRec.set('data', dataVal)
    }
    if (horaVal) {
      jogoRec.set('hora', horaVal)
    }
    if (body.competicao !== undefined) {
      jogoRec.set('competicao', competicaoVal)
    }
    $app.save(jogoRec)

    // Variáveis de controle de retorno
    let fixtureVinculado = Boolean(fixtureManualInformado)
    let escudosAtualizados = false
    let aviso = ''

    // Helper inline de normalização e similaridade
    const normalizarNome = (str) => {
      if (!str) return ''
      let s = String(str).toLowerCase()
      if (typeof s.normalize === 'function') {
        try {
          s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}
      }
      return s
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const calcularLevenshtein = (a, b) => {
      const m = a.length
      const n = b.length
      if (m === 0) return n
      if (n === 0) return m
      const d = []
      for (let i = 0; i <= m; i++) d[i] = [i]
      for (let j = 0; j <= n; j++) d[0][j] = j
      for (let i1 = 1; i1 <= m; i1++) {
        for (let j1 = 1; j1 <= n; j1++) {
          const cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
          d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
        }
      }
      return d[m][n]
    }

    const calcularSimilaridade = (a, b) => {
      const s1 = normalizarNome(a)
      const s2 = normalizarNome(b)
      if (!s1 || !s2) return 0
      if (s1 === s2) return 1
      if (s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1) return 0.9

      const m = s1.length
      const n = s2.length
      const maxLen = Math.max(m, n)
      if (maxLen === 0) return 1
      const dist = calcularLevenshtein(s1, s2)
      return 1 - dist / maxLen
    }

    const formatarDataISO = (dataRaw) => {
      if (!dataRaw) return ''
      const str = String(dataRaw).trim()
      const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (brMatch) {
        return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
      }
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (isoMatch) {
        return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3]
      }
      return ''
    }

    // Normalização com remoção de stopwords (pt/en) para correspondência de times
    const normalizarTimeComStopwords = (str) => {
      if (!str) return ''
      let s = String(str).toLowerCase()
      if (typeof s.normalize === 'function') {
        try {
          s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}
      }
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      const rawTokens = s.split(/\s+/).filter(Boolean)
      const stopWords = [
        'afc',
        'fc',
        'sc',
        'cf',
        'cd',
        'sd',
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
        'se',
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
      const cleanTokens = rawTokens.filter((t) => stopWords.indexOf(t) === -1)
      return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
    }

    const timesCoincidem = (a, b) => {
      const normA = normalizarTimeComStopwords(a)
      const normB = normalizarTimeComStopwords(b)
      if (!normA || !normB) return false
      if (normA === normB) return true
      if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true

      const tA = normA.split(/\s+/).filter((t) => t.length >= 3)
      const tB = normB.split(/\s+/).filter((t) => t.length >= 3)
      for (let ti = 0; ti < tA.length; ti++) {
        if (tB.indexOf(tA[ti]) !== -1) {
          return true
        }
      }

      const maxLen = Math.max(normA.length, normB.length)
      if (maxLen === 0) return true
      const dist = calcularLevenshtein(normA, normB)
      return 1 - dist / maxLen >= 0.75
    }

    // Helper inline para checar e incrementar cota da API-Football
    const checarCotaApiFootball = () => {
      const hojeUtc = new Date().toISOString().slice(0, 10)
      const DAILY_LIMIT = 80
      let rec = null
      try {
        rec = $app.findFirstRecordByFilter(
          'config_integracoes',
          "chave = 'api_football_daily_usage'",
        )
      } catch (_) {
        rec = null
      }

      let usageData = {
        date_utc: hojeUtc,
        count: 0,
        max_limit: DAILY_LIMIT,
        trava_desativada: false,
        blocked: false,
        last_reset_utc: new Date().toISOString(),
        last_request_utc: null,
      }

      if (rec) {
        try {
          const rawKey = rec.get('api_key')
          if (rawKey) {
            const parsed = JSON.parse(rawKey)
            if (parsed && typeof parsed === 'object') {
              usageData = Object.assign(usageData, parsed)
            }
          }
        } catch (_) {}

        if (usageData.date_utc !== hojeUtc) {
          usageData.date_utc = hojeUtc
          usageData.count = 0
          usageData.blocked = false
          if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
            usageData.max_limit = DAILY_LIMIT
          }
          usageData.last_reset_utc = new Date().toISOString()
          rec.set('api_key', JSON.stringify(usageData))
          rec.set('ativo', true)
          rec.set('provedor', 'api_football')
          $app.save(rec)
        }
      } else {
        try {
          const col = $app.findCollectionByNameOrId('config_integracoes')
          rec = new Record(col)
          rec.set('chave', 'api_football_daily_usage')
          rec.set('provedor', 'api_football')
          rec.set('ativo', true)
          rec.set('api_key', JSON.stringify(usageData))
          $app.save(rec)
        } catch (_) {}
      }

      const count = Number(usageData.count) || 0
      const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
      const travaDesativada = Boolean(usageData.trava_desativada)
      const isBlocked = Boolean(usageData.blocked) || (!travaDesativada && count >= maxLimit)

      return {
        rec: rec,
        usageData: usageData,
        count: count,
        max_limit: maxLimit,
        trava_desativada: travaDesativada,
        blocked: isBlocked,
      }
    }

    const incrementarCotaApiFootball = (cotaState) => {
      try {
        if (!cotaState || !cotaState.rec) return
        const usageData = cotaState.usageData || {}
        usageData.count = (Number(usageData.count) || 0) + 1
        usageData.last_request_utc = new Date().toISOString()
        cotaState.rec.set('api_key', JSON.stringify(usageData))
        $app.save(cotaState.rec)
      } catch (errInc) {
        console.log('[admin_editar_jogo] Erro ao incrementar uso da API:', errInc)
      }
    }

    // REGRA DE TRAVA:
    // Se o jogo já possui fixture_id (seja já existente no banco ou recém-informado manualmente),
    // NUNCA fazer busca automática de fixture_id por texto/data para não gastar cota desnecessariamente.
    // A busca automática SÓ roda quando effectiveFixtureId estiver vazio.
    // NOTA: Na edição cadastral pelo Admin, NÃO bloqueamos por tentativa diária ao salvar. O administrador
    // pode reexecutar a busca sempre que ajustar os nomes ou datas (local primeiro, API só se necessário com cota).
    if (!effectiveFixtureId) {
      const curDataRaw = dataVal || jogoRec.getString('data') || ''
      const curIsoDate = formatarDataISO(curDataRaw)

      let fixtureResultado = null

      try {
        // (a) Busca local primeiro na coleção jogos_do_dia por data + similaridade (sem custo de API)
        try {
          let filt = ''
          if (curIsoDate) filt = "data = '" + curIsoDate + "'"
          const jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
          for (let i = 0; i < jdds.length; i++) {
            const tc = jdds[i].getString('time_casa') || ''
            const tv = jdds[i].getString('time_visitante') || ''
            const matchDir = timesCoincidem(timeA, tc) && timesCoincidem(timeB, tv)
            const matchInv = timesCoincidem(timeA, tv) && timesCoincidem(timeB, tc)
            if (matchDir || matchInv) {
              const fid = (jdds[i].getString('fixture_id') || '').trim()
              if (fid && /^\d+$/.test(fid)) {
                const logoA = matchDir
                  ? jdds[i].getString('logo_casa')
                  : jdds[i].getString('logo_visitante')
                const logoB = matchDir
                  ? jdds[i].getString('logo_visitante')
                  : jdds[i].getString('logo_casa')
                fixtureResultado = {
                  fixture_id: fid,
                  logo_mandante: logoA || '',
                  logo_visitante: logoB || '',
                  origem: 'jogos_do_dia',
                }
                console.log(
                  '[admin_editar_jogo] Fixture encontrada localmente em jogos_do_dia: ' +
                    fid +
                    ' (' +
                    timeA +
                    ' x ' +
                    timeB +
                    ')',
                )
                break
              }
            }
          }
        } catch (errLocal) {
          console.log('[admin_editar_jogo] Aviso na busca local em jogos_do_dia:', errLocal)
        }

        // (b) Se nada encontrado localmente e temos data válida, checa cota e busca na API externa
        if (!fixtureResultado && curIsoDate) {
          const cota = checarCotaApiFootball()
          const cotaBloqueada =
            cota.blocked || (!cota.trava_desativada && cota.count >= cota.max_limit)
          if (cotaBloqueada) {
            aviso = 'Cota diária da API-Football esgotada. Dados salvos, busca de fixture adiada.'
          } else {
            // Obter API Key
            let apiKey = ''
            try {
              const cfgRec = $app.findFirstRecordByData(
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
              const isRapid = apiKey.length > 40
              const url = isRapid
                ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                  encodeURIComponent(curIsoDate) +
                  '&timezone=America%2FSao_Paulo'
                : 'https://v3.football.api-sports.io/fixtures?date=' +
                  encodeURIComponent(curIsoDate) +
                  '&timezone=America%2FSao_Paulo'
              const headers = isRapid
                ? {
                    'x-rapidapi-key': apiKey,
                    'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                  }
                : { 'x-apisports-key': apiKey }

              console.log(
                '[admin_editar_jogo] Chamando API-Football por data ' +
                  curIsoDate +
                  ' para ' +
                  timeA +
                  ' x ' +
                  timeB,
              )
              const resApi = $http.send({
                url: url,
                method: 'GET',
                headers: headers,
                timeout: 12,
              })

              incrementarCotaApiFootball(cota)

              if (resApi.statusCode === 200 && resApi.json && Array.isArray(resApi.json.response)) {
                const fixturesList = resApi.json.response
                for (let k = 0; k < fixturesList.length; k++) {
                  const item = fixturesList[k]
                  const hName = (item.teams && item.teams.home && item.teams.home.name) || ''
                  const aName = (item.teams && item.teams.away && item.teams.away.name) || ''
                  const matchDir = timesCoincidem(timeA, hName) && timesCoincidem(timeB, aName)
                  const matchInv = timesCoincidem(timeA, aName) && timesCoincidem(timeB, hName)

                  if (matchDir || matchInv) {
                    const fid = item.fixture && item.fixture.id ? String(item.fixture.id) : ''
                    if (fid && /^\d+$/.test(fid)) {
                      const hLogo = (item.teams && item.teams.home && item.teams.home.logo) || ''
                      const aLogo = (item.teams && item.teams.away && item.teams.away.logo) || ''
                      fixtureResultado = {
                        fixture_id: fid,
                        logo_mandante: matchDir ? hLogo : aLogo,
                        logo_visitante: matchDir ? aLogo : hLogo,
                        origem: 'api_football',
                      }
                      console.log(
                        '[admin_editar_jogo] Fixture ' +
                          fid +
                          ' encontrada na API para ' +
                          timeA +
                          ' x ' +
                          timeB,
                      )
                      break
                    }
                  }
                }
              }
            }
          }
        }

        // Aplica o resultado da fixture encontrada
        if (fixtureResultado && fixtureResultado.fixture_id) {
          jogoRec.set('fixture_id', fixtureResultado.fixture_id)
          effectiveFixtureId = fixtureResultado.fixture_id
          fixtureVinculado = true
          console.log(
            '[admin_editar_jogo] Fixture ' +
              fixtureResultado.fixture_id +
              ' vinculada ao jogo ' +
              jogoId,
          )

          if (fixtureResultado.logo_mandante) {
            jogoRec.set('url_escudo_mandante', fixtureResultado.logo_mandante)
            escudosAtualizados = true
          }
          if (fixtureResultado.logo_visitante) {
            jogoRec.set('url_escudo_visitante', fixtureResultado.logo_visitante)
            escudosAtualizados = true
          }
          $app.save(jogoRec)
        } else if (!aviso) {
          aviso = 'Nenhuma fixture correspondente encontrada para estes nomes/data.'
        }
      } catch (errFixture) {
        console.log('[admin_editar_jogo] Aviso na consulta de fixture:', errFixture)
        aviso = 'Aviso ao consultar fixture: ' + (errFixture ? errFixture.message : 'indisponível')
      }
    } else {
      console.log(
        '[admin_editar_jogo] Jogo já possui fixture_id (' +
          effectiveFixtureId +
          '). Busca automática de fixture por data pulada para economizar cota.',
      )
    }

    // Se o fixture_id foi informado manualmente e os escudos ainda estão vazios,
    // tenta buscar os escudos diretamente da fixture correspondente na API-Football (se houver cota disponível),
    // sem bloquear o salvamento se não houver cota.
    let curLogoCasa = (jogoRec.getString('url_escudo_mandante') || '').trim()
    let curLogoVis = (jogoRec.getString('url_escudo_visitante') || '').trim()

    if (fixtureManualInformado && (!curLogoCasa || !curLogoVis) && effectiveFixtureId) {
      try {
        const cotaFixture = checarCotaApiFootball()
        const cotaFixBloqueada =
          cotaFixture.blocked ||
          (!cotaFixture.trava_desativada && cotaFixture.count >= cotaFixture.max_limit)
        if (!cotaFixBloqueada) {
          let apiKey = ''
          try {
            const cfgRec = $app.findFirstRecordByData(
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
                apiKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
              }
            } catch (_) {}
          }

          if (apiKey) {
            const isRapid = apiKey.length > 40
            const urlFixture = isRapid
              ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?id=' +
                encodeURIComponent(effectiveFixtureId)
              : 'https://v3.football.api-sports.io/fixtures?id=' +
                encodeURIComponent(effectiveFixtureId)
            const headers = isRapid
              ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
              : { 'x-apisports-key': apiKey }

            const resFix = $http.send({
              url: urlFixture,
              method: 'GET',
              headers: headers,
              timeout: 10,
            })
            incrementarCotaApiFootball(cotaFixture)

            if (
              resFix.statusCode === 200 &&
              resFix.json &&
              Array.isArray(resFix.json.response) &&
              resFix.json.response.length > 0
            ) {
              const fItem = resFix.json.response[0]
              const hLogo = (fItem.teams && fItem.teams.home && fItem.teams.home.logo) || ''
              const aLogo = (fItem.teams && fItem.teams.away && fItem.teams.away.logo) || ''
              if (!curLogoCasa && hLogo) {
                jogoRec.set('url_escudo_mandante', hLogo)
                curLogoCasa = hLogo
                escudosAtualizados = true
              }
              if (!curLogoVis && aLogo) {
                jogoRec.set('url_escudo_visitante', aLogo)
                curLogoVis = aLogo
                escudosAtualizados = true
              }
              if (escudosAtualizados) {
                $app.save(jogoRec)
              }
            }
          }
        }
      } catch (errEscudosFix) {
        console.log('[admin_editar_jogo] Aviso ao buscar escudos da fixture manual:', errEscudosFix)
      }
    }

    // (2) Se escudos não foram obtidos pela fixture, busca pela cascata existente:
    // cache em memória -> TheSportsDB (strTeamBadge) -> Football-Data.org (crest) -> jogos_do_dia / enquete_jogos
    curLogoCasa = (jogoRec.getString('url_escudo_mandante') || '').trim()
    curLogoVis = (jogoRec.getString('url_escudo_visitante') || '').trim()

    if (!curLogoCasa || !curLogoVis) {
      const buscarEscudoCascata = (teamName) => {
        if (!teamName) return ''
        const cleanKey = normalizarNome(teamName)

        // 0) PSG especial
        if (cleanKey === 'paris saint germain' || cleanKey === 'psg') {
          return 'https://media.api-sports.io/football/teams/85.png'
        }

        // 1) Cache em memória global
        if (typeof globalThis !== 'undefined' && !globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache = {}
        }
        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey]
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey]
        }

        let badge = ''

        // 2) TheSportsDB (strTeamBadge)
        let tsdbKey = ''
        try {
          const tsdbRec = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'thesportsdb_fallback',
          )
          if (tsdbRec) tsdbKey = (tsdbRec.getString('api_key') || '').trim()
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
        if (!tsdbKey) tsdbKey = '3'

        try {
          const resTsdb = $http.send({
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
            for (let i = 0; i < resTsdb.json.teams.length; i++) {
              const cand = resTsdb.json.teams[i]
              const candName = cand.strTeam || ''
              if (calcularSimilaridade(teamName, candName) >= 0.75) {
                badge = (cand.strTeamBadge || cand.strBadge || cand.strLogo || '').trim()
                if (badge) break
              }
            }
          }
        } catch (errTsdb) {
          console.log('[admin_editar_jogo] Erro TheSportsDB para ' + teamName + ':', errTsdb)
        }

        // 3) Football-Data.org (crest)
        if (!badge) {
          let fdKey = ''
          try {
            const fdRec = $app.findFirstRecordByData(
              'config_integracoes',
              'chave',
              'football_data_fallback',
            )
            if (fdRec) fdKey = (fdRec.getString('api_key') || '').trim()
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
              const resFD = $http.send({
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
                for (let j = 0; j < resFD.json.teams.length; j++) {
                  const fdTeam = resFD.json.teams[j]
                  const fdName = (fdTeam && (fdTeam.name || fdTeam.shortName)) || ''
                  if (calcularSimilaridade(teamName, fdName) >= 0.75 && fdTeam.crest) {
                    badge = String(fdTeam.crest).trim()
                    if (badge) break
                  }
                }
              }
            } catch (errFD) {
              console.log('[admin_editar_jogo] Erro Football-Data para ' + teamName + ':', errFD)
            }
          }
        }

        // 4) Tabela jogos_do_dia ou enquete_jogos
        if (!badge) {
          try {
            const jdds = $app.findRecordsByFilter('jogos_do_dia', '', '-created', 100, 0)
            for (let k = 0; k < jdds.length; k++) {
              const tc = jdds[k].getString('time_casa') || ''
              const tv = jdds[k].getString('time_visitante') || ''
              if (calcularSimilaridade(teamName, tc) >= 0.8) {
                badge = (jdds[k].getString('logo_casa') || '').trim()
                if (badge) break
              }
              if (calcularSimilaridade(teamName, tv) >= 0.8) {
                badge = (jdds[k].getString('logo_visitante') || '').trim()
                if (badge) break
              }
            }
          } catch (_) {}
        }

        if (!badge) {
          try {
            const enqs = $app.findRecordsByFilter('enquete_jogos', '', '-created', 100, 0)
            for (let m = 0; m < enqs.length; m++) {
              const tA = enqs[m].getString('time_a') || ''
              const tB = enqs[m].getString('time_b') || ''
              if (calcularSimilaridade(teamName, tA) >= 0.8) {
                badge = (enqs[m].getString('logo_casa') || '').trim()
                if (badge) break
              }
              if (calcularSimilaridade(teamName, tB) >= 0.8) {
                badge = (enqs[m].getString('logo_visitante') || '').trim()
                if (badge) break
              }
            }
          } catch (_) {}
        }

        if (badge && typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache[cleanKey] = badge
        }

        return badge
      }

      let alterouEscudo = false
      if (!curLogoCasa) {
        const foundA = buscarEscudoCascata(timeA)
        if (foundA) {
          jogoRec.set('url_escudo_mandante', foundA)
          alterouEscudo = true
          escudosAtualizados = true
        }
      }

      if (!curLogoVis) {
        const foundB = buscarEscudoCascata(timeB)
        if (foundB) {
          jogoRec.set('url_escudo_visitante', foundB)
          alterouEscudo = true
          escudosAtualizados = true
        }
      }

      if (alterouEscudo) {
        $app.save(jogoRec)
      }
    }

    return e.json(200, {
      success: true,
      jogo: {
        id: jogoRec.id,
        bolao: jogoRec.getString('bolao'),
        time_a: jogoRec.getString('time_a'),
        time_b: jogoRec.getString('time_b'),
        data: jogoRec.getString('data'),
        hora: jogoRec.getString('hora'),
        competicao: jogoRec.getString('competicao'),
        fixture_id: jogoRec.getString('fixture_id'),
        url_escudo_mandante: jogoRec.getString('url_escudo_mandante'),
        url_escudo_visitante: jogoRec.getString('url_escudo_visitante'),
        placar_a: jogoRec.getInt('placar_a'),
        placar_b: jogoRec.getInt('placar_b'),
        resultado_finalizado: jogoRec.getBool('resultado_finalizado'),
        updated: jogoRec.getString('updated'),
      },
      fixture_vinculado: fixtureVinculado,
      escudos_atualizados: escudosAtualizados,
      aviso: aviso || null,
    })
  } catch (err) {
    console.log('[admin_editar_jogo] Erro fatal:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao editar jogo.',
    })
  }
})
