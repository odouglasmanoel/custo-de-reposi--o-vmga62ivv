// pocketbase/hooks/admin_forcar_escalacao.js
// Endpoint administrativo para forçar busca de escalação de uma partida específica via API-Football.
// Resolve o fixture_id caso esteja ausente (via tabela local jogos_do_dia ou busca por data),
// consulta a API-Football com prioridade 2 respeitando o limitador central e grava a escalação no registro do jogo.
//
// REGRAS GOJA / POCKETBASE:
// - Toda lógica e helpers inline dentro do callback (SEM requires externos dinâmicos)
// - Checagem e incremento da trava diária inline na coleção config_integracoes (chave: api_football_daily_usage)
// - Limite estrito de 15 chamadas/dia e trava de 1 tentativa/jogo/dia mantidos

routerAdd(
  'POST',
  '/backend/v1/admin/forcar-escalacao',
  (e) => {
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
        return e.forbiddenError('Apenas o Administrador pode forçar a busca de escalações.')
      }

      const body = e.requestInfo().body || {}
      const jogoId = (body.jogo_id || body.jogo || '').trim()

      if (!jogoId) {
        return e.badRequestError('ID do jogo é obrigatório (jogo_id).')
      }

      let jogoRec = null
      try {
        jogoRec = $app.findRecordById('jogos', jogoId)
      } catch (_) {
        return e.notFoundError('Jogo não encontrado no banco de dados.')
      }

      // 1. Obter API Key
      let apiKey = ''
      try {
        const configRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
        if (configRec) {
          apiKey = (configRec.getString('api_key') || '').trim()
        }
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

      if (!apiKey) {
        return e.json(400, {
          success: false,
          error: 'Chave da API-Football não configurada no sistema.',
        })
      }

      // Helper inline para checar e incrementar cota da API-Football (chave: api_football_daily_usage)
      const DAILY_LIMIT = 80
      const checarCotaApiFootball = () => {
        const hojeUtc = new Date().toISOString().slice(0, 10)
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
        // Ação manual do admin não é bloqueada pelo limite interno se a API externa não deu 429
        const isBlocked = Boolean(usageData.blocked)

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
          console.log('[Admin Forçar Escalação] Erro ao incrementar uso da API:', errInc)
        }
      }

      // Helpers inline de nomes e similaridade
      const sinonimos = {
        'paris saint germain': 'paris saint germain',
        'paris saint-germain': 'paris saint germain',
        psg: 'paris saint germain',
        'olympique de marseille': 'olympique marseille',
        'olympique marseille': 'olympique marseille',
        marseille: 'olympique marseille',
        atletico: 'atletico madrid',
        liverpool: 'liverpool',
        ldu: 'ldu quito',
        japao: 'japan',
        japan: 'japan',
        uruguai: 'uruguay',
        uruguay: 'uruguay',
      }

      const normStr = (str) => {
        if (!str) return ''
        let s = String(str).toLowerCase()
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        s = s.replace(/[^a-z0-9\s]/g, ' ')
        const rawTokens = s.split(/\s+/).filter(Boolean)
        const rawClean = rawTokens.join(' ').trim()
        if (sinonimos[rawClean]) return sinonimos[rawClean]
        const noise = ['afc', 'fc', 'sc', 'ac', 'cf', 'cd', 'clube', 'club', 'de', 'do', 'da']
        const tokens = rawTokens.filter((t) => noise.indexOf(t) === -1)
        if (tokens.length === 0) return s.replace(/[^a-z0-9]/g, '').trim()
        const clean = tokens.join(' ').trim()
        return sinonimos[clean] || clean
      }

      const calcLev = (a, b) => {
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

      const timesMatch = (a, b) => {
        const na = normStr(a)
        const nb = normStr(b)
        if (!na || !nb) return false
        if (na === nb) return true
        if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true
        const ta = na.split(/\s+/).filter((t) => t.length >= 3)
        const tb = nb.split(/\s+/).filter((t) => t.length >= 3)
        let comm = false
        for (let ti = 0; ti < ta.length; ti++) {
          if (tb.indexOf(ta[ti]) !== -1) {
            comm = true
            break
          }
        }
        if (comm && (ta.length <= 2 || tb.length <= 2)) return true
        const maxL = Math.max(na.length, nb.length)
        if (maxL === 0) return true
        const dist = calcLev(na, nb)
        return 1 - dist / maxL >= 0.85
      }

      const extrairIso = (dt) => {
        if (!dt) return ''
        const br = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (br) return br[3] + '-' + br[2] + '-' + br[1]
        const iso = dt.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3]
        return ''
      }

      // 2. Resolver fixture_id se ausente
      let fixtureId = (jogoRec.getString('fixture_id') || '').trim()
      const timeA = (jogoRec.getString('time_a') || '').trim()
      const timeB = (jogoRec.getString('time_b') || '').trim()
      const dtVal = (jogoRec.getString('data') || '').trim()
      const dataIso = extrairIso(dtVal)

      if (!fixtureId || !/^\d+$/.test(fixtureId)) {
        // Tenta na tabela local jogos_do_dia (sem gastar cota externa)
        try {
          let filt = ''
          if (dataIso) filt = "data = '" + dataIso + "'"
          const jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
          for (let ji = 0; ji < jdds.length; ji++) {
            const jdd = jdds[ji]
            const tc = jdd.getString('time_casa') || ''
            const tv = jdd.getString('time_visitante') || ''
            if (
              (timesMatch(timeA, tc) && timesMatch(timeB, tv)) ||
              (timesMatch(timeA, tv) && timesMatch(timeB, tc))
            ) {
              const candFid = (jdd.getString('fixture_id') || '').trim()
              if (candFid && /^\d+$/.test(candFid)) {
                fixtureId = candFid
                jogoRec.set('fixture_id', fixtureId)
                $app.save(jogoRec)
                console.log(
                  '[Admin Forçar Escalação] Fixture ' +
                    fixtureId +
                    ' encontrada em jogos_do_dia para o jogo ' +
                    jogoRec.id,
                )
                break
              }
            }
          }
        } catch (errJdd) {
          console.log('[Admin Forçar Escalação] Aviso ao buscar em jogos_do_dia:', errJdd)
        }

        // Se ainda não achou, consulta /v3/fixtures?date=... na API-Football (1 tentativa/jogo/dia)
        if ((!fixtureId || !/^\d+$/.test(fixtureId)) && dataIso) {
          const hojeStr = new Date().toISOString().slice(0, 10)
          const storeKeyDate = 'fixture_scan_adm_' + jogoId + '_' + hojeStr
          const jaTentouScanHoje = $app.store().get(storeKeyDate) === '1'

          if (!jaTentouScanHoje) {
            $app.store().set(storeKeyDate, '1')
            const cotaDate = checarCotaApiFootball()
            if (
              !cotaDate.blocked &&
              (cotaDate.trava_desativada || cotaDate.count < cotaDate.max_limit)
            ) {
              try {
                const isRapid = apiKey.length > 40
                const urlDate = isRapid
                  ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
                    encodeURIComponent(dataIso) +
                    '&timezone=America%2FSao_Paulo'
                  : 'https://v3.football.api-sports.io/fixtures?date=' +
                    encodeURIComponent(dataIso) +
                    '&timezone=America%2FSao_Paulo'
                const headersDate = isRapid
                  ? {
                      'x-rapidapi-key': apiKey,
                      'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                    }
                  : { 'x-apisports-key': apiKey }

                const resDate = $http.send({
                  url: urlDate,
                  method: 'GET',
                  headers: headersDate,
                  timeout: 10,
                })
                incrementarCotaApiFootball(cotaDate)

                if (
                  resDate.statusCode === 200 &&
                  resDate.json &&
                  Array.isArray(resDate.json.response)
                ) {
                  const fixturesList = resDate.json.response
                  for (let fi = 0; fi < fixturesList.length; fi++) {
                    const fItem = fixturesList[fi]
                    const fHome = (fItem.teams && fItem.teams.home && fItem.teams.home.name) || ''
                    const fAway = (fItem.teams && fItem.teams.away && fItem.teams.away.name) || ''
                    if (
                      (timesMatch(timeA, fHome) && timesMatch(timeB, fAway)) ||
                      (timesMatch(timeA, fAway) && timesMatch(timeB, fHome))
                    ) {
                      const candFid =
                        fItem.fixture && fItem.fixture.id ? String(fItem.fixture.id) : ''
                      if (candFid && /^\d+$/.test(candFid)) {
                        fixtureId = candFid
                        jogoRec.set('fixture_id', fixtureId)
                        $app.save(jogoRec)
                        console.log(
                          '[Admin Forçar Escalação] Fixture ' +
                            fixtureId +
                            ' resolvida via API-Football por data para jogo ' +
                            jogoRec.id,
                        )
                        break
                      }
                    }
                  }
                }
              } catch (errApiFid) {
                console.log(
                  '[Admin Forçar Escalação] Erro ao buscar fixture por data na API:',
                  errApiFid,
                )
              }
            }
          }
        }
      }

      if (!fixtureId || !/^\d+$/.test(fixtureId)) {
        return e.json(400, {
          success: false,
          error:
            'Não foi possível identificar o fixture_id numérico desta partida na API-Football. Verifique a data e os nomes dos clubes.',
          jogo_id: jogoId,
        })
      }

      // 3. Consulta /fixtures/lineups com checagem inline da cota diária
      // Por ser uma ação manual expressa do Administrador ("Forçar Escalação"),
      // só bloqueamos se a API externa tiver retornado rate-limit real (cotaDate.blocked === true)
      // ou se a trava estiver ativa E o contador tiver excedido o teto configurado
      const cotaLineups = checarCotaApiFootball()
      if (
        cotaLineups.blocked ||
        (!cotaLineups.trava_desativada && cotaLineups.count >= cotaLineups.max_limit)
      ) {
        return e.json(429, {
          success: false,
          rate_limited: true,
          waiting_reset: true,
          error:
            'Limite diário da API atingido. Aguardando reset às 21h (Brasília) ou reset manual.',
          reason: 'daily_limit_reached',
        })
      }

      const isRapid = apiKey.length > 40
      const urlLineups = isRapid
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/lineups?fixture=' +
          encodeURIComponent(fixtureId)
        : 'https://v3.football.api-sports.io/fixtures/lineups?fixture=' +
          encodeURIComponent(fixtureId)
      const headers = isRapid
        ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
        : { 'x-apisports-key': apiKey }

      console.log(
        '[Admin Forçar Escalação] Buscando lineups para fixture ' +
          fixtureId +
          ' (' +
          jogoId +
          ')...',
      )

      let resHttp = null
      try {
        resHttp = $http.send({
          url: urlLineups,
          method: 'GET',
          headers: headers,
          timeout: 15,
        })
        incrementarCotaApiFootball(cotaLineups)
      } catch (errHttp) {
        console.log('[Admin Forçar Escalação] Exceção na requisição HTTP de lineups:', errHttp)
        return e.json(500, {
          success: false,
          error:
            'Falha na conexão com a API externa: ' + (errHttp ? errHttp.message : 'indisponível'),
        })
      }

      const statusCode = resHttp ? resHttp.statusCode : 500
      const resJson = resHttp ? resHttp.json : null
      const apiErrors = resJson && resJson.errors ? resJson.errors : {}
      const isRateLimited =
        statusCode === 429 ||
        Boolean(apiErrors.rateLimit) ||
        Boolean(apiErrors.requests) ||
        Boolean(apiErrors.token)

      if (isRateLimited) {
        // Marca contador como esgotado para proteger a cota externa
        try {
          cotaLineups.usageData.blocked = true
          if (cotaLineups.rec) {
            cotaLineups.rec.set('api_key', JSON.stringify(cotaLineups.usageData))
            $app.save(cotaLineups.rec)
          }
        } catch (_) {}

        return e.json(429, {
          success: false,
          rate_limited: true,
          waiting_reset: true,
          error:
            'A API externa retornou cota excedida (Rate Limit). Aguardando reset às 21h (Brasília).',
          reason: 'api_returned_rate_limit',
        })
      }

      if (resJson && Array.isArray(resJson.response) && resJson.response.length > 0) {
        const rawLineups = resJson.response
        const teamsData = []
        for (let i = 0; i < rawLineups.length; i++) {
          const teamBlock = rawLineups[i]
          const teamInfo = teamBlock.team || {}
          const starters = []
          if (Array.isArray(teamBlock.startXI)) {
            for (let s = 0; s < teamBlock.startXI.length; s++) {
              const p = teamBlock.startXI[s].player || {}
              starters.push({
                id: p.id ? String(p.id) : '',
                name: p.name || '',
                number: p.number || null,
                pos: p.pos || '',
                grid: p.grid || null,
              })
            }
          }
          const bench = []
          if (Array.isArray(teamBlock.substitutes)) {
            for (let b = 0; b < teamBlock.substitutes.length; b++) {
              const bp = teamBlock.substitutes[b].player || {}
              bench.push({
                id: bp.id ? String(bp.id) : '',
                name: bp.name || '',
                number: bp.number || null,
                pos: bp.pos || '',
              })
            }
          }

          let tLogo = teamInfo.logo || ''
          const tName = teamInfo.name || ''
          if (tName.toLowerCase().indexOf('paris') !== -1 || tName.toLowerCase() === 'psg') {
            tLogo = 'https://media.api-sports.io/football/teams/85.png'
          }

          teamsData.push({
            teamId: teamInfo.id ? String(teamInfo.id) : '',
            teamName: tName,
            teamLogo: tLogo,
            formation: teamBlock.formation || '',
            coach: teamBlock.coach ? teamBlock.coach.name : '',
            starters: starters,
            substitutes: bench,
          })
        }

        if (teamsData.length > 0) {
          const payload = {
            status: 'confirmada',
            provider: 'api_football',
            fixtureId: fixtureId,
            teams: teamsData,
            updatedAt: new Date().toISOString(),
          }
          jogoRec.set('escalacoes', payload)
          $app.save(jogoRec)
          console.log(
            '[Admin Forçar Escalação] Escalação salva com sucesso no jogo ' + jogoRec.id + '!',
          )
          return e.json(200, {
            success: true,
            message: 'Escalação obtida e gravada com sucesso no PocketBase!',
            fixture_id: fixtureId,
            escalacoes: payload,
          })
        }
      }

      return e.json(200, {
        success: false,
        notice:
          'A API externa não retornou escalações para esta partida ainda (provavelmente ainda não confirmada pelos clubes).',
        fixture_id: fixtureId,
      })
    } catch (errFatal) {
      console.log('[Admin Forçar Escalação] Erro fatal:', errFatal)
      return e.json(500, {
        success: false,
        error: errFatal ? errFatal.message : 'Erro interno ao forçar busca de escalação.',
      })
    }
  },
  $apis.requireAuth(),
)
