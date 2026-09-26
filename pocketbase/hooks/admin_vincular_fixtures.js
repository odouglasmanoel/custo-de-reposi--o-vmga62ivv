// pocketbase/hooks/admin_vincular_fixtures.js
// Endpoint administrativo para varrer jogos do bolão ativo sem fixture_id,
// cruzando data e nomes dos times para persistir o fixture_id no banco.
// Regras:
// - Apenas admin autenticado (Douglas)
// - Totalmente autônomo e inline (não depende de require externo que pode falhar no goja JSVM)
// - Busca primeiro localmente em jogos_do_dia (zero custo de cota)
// - Se necessário busca na API-Football respeitando cota diária (api_football_daily_usage)
// - Atualiza também url_escudo_mandante e url_escudo_visitante se disponíveis
// - Não crasha e retorna resumo da varredura

routerAdd('POST', '/backend/v1/admin/vincular-fixtures', (e) => {
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
      return e.forbiddenError('Apenas o Administrador pode executar o vínculo de fixtures.')
    }

    const body = e.requestInfo().body || {}
    let bolaoId = (body.bolao_id || '').trim()

    // Se bolaoId não fornecido ou for 'geral', busca o bolão ativo
    if (!bolaoId || bolaoId === 'geral') {
      try {
        const activeBoloes = $app.findRecordsByFilter('boloes', 'ativo = true', '-created', 1, 0)
        if (activeBoloes && activeBoloes.length > 0) {
          bolaoId = activeBoloes[0].id
        }
      } catch (_) {}
    }

    let filterExpr = 'fixture_id = "" || fixture_id = null'
    if (bolaoId && bolaoId !== 'geral') {
      filterExpr = `bolao = '${bolaoId.replace(/'/g, "\\'")}' && (${filterExpr})`
    }

    const jogosSemFixture = $app.findRecordsByFilter('jogos', filterExpr, 'data,hora', 100, 0)

    if (!jogosSemFixture || jogosSemFixture.length === 0) {
      return e.json(200, {
        success: true,
        message: 'Todos os jogos já possuem fixture_id vinculado ou nenhum jogo encontrado.',
        total_verificados: 0,
        vinculados: 0,
        detalhes: [],
      })
    }

    // Helpers inline robustos para normalização e similaridade
    const normalizeStr = (str) => {
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
      const cleanTokens = rawTokens.filter((t) => stopWords.indexOf(t) === -1)
      return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
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

    const timesCoincidem = (a, b) => {
      const normA = normalizeStr(a)
      const normB = normalizeStr(b)
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

    const formatarDataISO = (dataRaw) => {
      if (!dataRaw) return ''
      const str = String(dataRaw).trim()
      const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (brMatch) {
        return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
      }
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
      }
      return ''
    }

    // Gerenciador inline da cota da API-Football
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
        console.log('[admin_vincular_fixtures] Erro ao incrementar uso da API:', errInc)
      }
    }

    const obterApiKeyApiFootball = () => {
      let apiKey = ''
      try {
        const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
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
      return apiKey
    }

    // Busca fixture com prioridade local (jogos_do_dia) e depois na API-Football
    const buscarFixtureJogo = (timeA, timeB, dataRaw) => {
      if (!timeA || !timeB) return null
      const isoDate = formatarDataISO(dataRaw)

      // 1. Local em jogos_do_dia (zero chamada à API externa)
      try {
        let filt = ''
        if (isoDate) filt = `data = '${isoDate}'`
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
              console.log(
                `[admin_vincular_fixtures] Fixture encontrada localmente em jogos_do_dia: ${fid} (${timeA} x ${timeB})`,
              )
              return {
                fixture_id: fid,
                logo_mandante: logoA || '',
                logo_visitante: logoB || '',
                origem: 'jogos_do_dia',
              }
            }
          }
        }
      } catch (errLocal) {
        console.log('[admin_vincular_fixtures] Aviso na busca local em jogos_do_dia:', errLocal)
      }

      // 2. Busca na API-Football por data
      if (!isoDate) return null
      const cota = checarCotaApiFootball()
      if (cota.blocked) {
        console.log('[admin_vincular_fixtures] Cota diária atingida. Busca na API pulada.')
        return { cota_esgotada: true }
      }

      const apiKey = obterApiKeyApiFootball()
      if (!apiKey) {
        console.log('[admin_vincular_fixtures] API Key ausente para consulta de fixture.')
        return null
      }

      try {
        const limiterMod = (function () {
          try {
            return require('./api_football_limiter.js')
          } catch (_) {
            return null
          }
        })()

        const url = `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(isoDate)}&timezone=America%2FSao_Paulo`

        console.log(
          `[admin_vincular_fixtures] Consultando API-Football por data ${isoDate} para ${timeA} x ${timeB}...`,
        )
        let respCall = null
        if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
          respCall = limiterMod.enviarRequisicaoApiFootball(url, { timeout: 12 }, 3)
        } else {
          const sRes = $http.send({ url: url, method: 'GET', timeout: 12 })
          let j = null
          try {
            j =
              typeof sRes.json === 'object' && sRes.json !== null ? sRes.json : JSON.parse(sRes.raw)
          } catch (_) {}
          respCall = {
            blocked: false,
            statusCode: sRes ? sRes.statusCode : 500,
            rawResponse: sRes,
            json: j,
          }
        }

        if (respCall.blocked) {
          return { cota_esgotada: true }
        }

        const resApi = respCall.rawResponse
        const jsonApi = respCall.json

        if (respCall.statusCode === 200 && jsonApi && Array.isArray(jsonApi.response)) {
          const fixturesList = jsonApi.response
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
                console.log(
                  `[admin_vincular_fixtures] Fixture ${fid} encontrada na API para ${timeA} x ${timeB}!`,
                )
                return {
                  fixture_id: fid,
                  logo_mandante: matchDir ? hLogo : aLogo,
                  logo_visitante: matchDir ? aLogo : hLogo,
                  origem: 'api_football',
                }
              }
            }
          }
        }
      } catch (errApi) {
        console.log('[admin_vincular_fixtures] Erro na busca de fixture na API:', errApi)
      }

      return null
    }

    const hojeStr = new Date().toISOString().slice(0, 10)
    let vinculadosCount = 0
    let puladosLimiteCount = 0
    let puladosTentativaCount = 0
    const detalhes = []

    for (let i = 0; i < jogosSemFixture.length; i++) {
      const jRec = jogosSemFixture[i]
      const tA = (jRec.getString('time_a') || '').trim()
      const tB = (jRec.getString('time_b') || '').trim()
      const dt = (jRec.getString('data') || '').trim()

      // Limitador: no máximo 1 tentativa externa por jogo por dia
      const storeKey = `fixture_scan_${jRec.id}_${hojeStr}`
      if ($app.store().get(storeKey) === '1') {
        puladosTentativaCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'ignorado_tentativa_hoje',
        })
        continue
      }

      const fixtureRes = buscarFixtureJogo(tA, tB, dt)

      if (fixtureRes && fixtureRes.cota_esgotada) {
        puladosLimiteCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'cota_diaria_esgotada',
        })
        break
      }

      // Marca tentativa diária no store
      $app.store().set(storeKey, '1')

      if (fixtureRes && fixtureRes.fixture_id) {
        jRec.set('fixture_id', fixtureRes.fixture_id)
        if (fixtureRes.logo_mandante && !jRec.getString('url_escudo_mandante')) {
          jRec.set('url_escudo_mandante', fixtureRes.logo_mandante)
        }
        if (fixtureRes.logo_visitante && !jRec.getString('url_escudo_visitante')) {
          jRec.set('url_escudo_visitante', fixtureRes.logo_visitante)
        }
        $app.save(jRec)
        vinculadosCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          fixture_id: fixtureRes.fixture_id,
          origem: fixtureRes.origem,
          status: 'vinculado_com_sucesso',
        })
      } else {
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'nao_encontrado_ou_indisponivel',
        })
      }
    }

    return e.json(200, {
      success: true,
      message: `Varredura concluída. ${vinculadosCount} jogo(s) vinculado(s) com fixture_id.`,
      total_verificados: jogosSemFixture.length,
      vinculados: vinculadosCount,
      pulados_tentativa_hoje: puladosTentativaCount,
      pulados_limite_cota: puladosLimiteCount,
      detalhes: detalhes,
    })
  } catch (err) {
    console.log('[admin_vincular_fixtures] Erro fatal:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao vincular fixtures.',
    })
  }
})
