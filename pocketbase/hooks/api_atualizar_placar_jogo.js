// pocketbase/hooks/api_atualizar_placar_jogo.js
// Endpoint: POST /backend/v1/placar-ao-vivo/atualizar-jogo
// Atualização pontual do placar ao vivo e marcadores da partida via API-Sports
// Exclusivo para admin Douglas (douglas, douglas@repress.com.br, douglas.manoel@repress.com.br)
// Sem require dinâmico (tudo inline para respeitar o JSVM do PocketBase)

routerAdd(
  'POST',
  '/backend/v1/placar-ao-vivo/atualizar-jogo',
  (e) => {
    // No PocketBase JSVM routerAdd, o contexto do evento 'e' possui e.auth populado quando o middleware $apis.requireAuth() está ativo
    const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
    if (!authRecord) {
      return e.json(401, { error: 'Sua sessão expirou. Faça login novamente.' })
    }

    const nome = (
      (authRecord.getString ? authRecord.getString('name') : authRecord.get('name')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()
    const email = (
      (authRecord.getString ? authRecord.getString('email') : authRecord.get('email')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()
    const username = (
      (authRecord.getString ? authRecord.getString('username') : authRecord.get('username')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()

    const isAdmin =
      nome === 'douglas' ||
      username === 'douglas' ||
      email === 'douglas@repress.com.br' ||
      email === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.json(403, { error: 'Acesso negado. Recurso restrito ao administrador.' })
    }

    let body = {}
    try {
      body =
        (e.requestInfo ? e.requestInfo().body : null) ||
        (e.requestInfo ? e.requestInfo().data : null) ||
        $apis.requestInfo(e).data ||
        {}
    } catch (_) {
      body = {}
    }
    const jogoId = (body.jogoId || body.jogo_id || body.id || '').toString().trim()
    const apiFixtureId = (body.api_fixture_id || body.fixture_id || '').toString().trim()

    if (!jogoId) {
      return e.json(400, { error: 'ID do jogo é obrigatório.' })
    }

    let jogoRecord
    try {
      jogoRecord = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.json(404, { error: 'Jogo não encontrado no sistema.' })
    }

    const fixtureIdParaUso = apiFixtureId || (jogoRecord.get('fixture_id') || '').toString().trim()

    if (!fixtureIdParaUso) {
      return e.json(400, {
        error:
          'Este jogo não possui ID da partida (fixture_id) vinculado. Vincule o ID antes de atualizar.',
      })
    }

    // Rate limiter check inline sem require dinâmico (respeita registro com count/max_limit/blocked)
    const dNow = new Date()
    const yyyy = dNow.getUTCFullYear()
    const mm = String(dNow.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(dNow.getUTCDate()).padStart(2, '0')
    const hojeUtc = `${yyyy}-${mm}-${dd}`
    const USAGE_RECORD_CHAVE = 'api_football_daily_usage'
    const DAILY_LIMIT = 80

    let recUsage = null
    let usageData = {
      date_utc: hojeUtc,
      count: 0,
      max_limit: DAILY_LIMIT,
      trava_desativada: false,
      blocked: false,
      last_reset_utc: new Date().toISOString(),
      last_request_utc: null,
    }

    try {
      recUsage = $app.findFirstRecordByFilter(
        'config_integracoes',
        `chave = '${USAGE_RECORD_CHAVE}'`,
      )
      if (recUsage && recUsage.get('api_key')) {
        const parsed = JSON.parse(recUsage.get('api_key'))
        if (parsed && typeof parsed === 'object') {
          usageData = Object.assign(usageData, parsed)
        }
      }
    } catch (_) {
      recUsage = null
    }

    // Reset diário às 00:00 UTC se mudou a data
    if (usageData.date_utc !== hojeUtc) {
      usageData.date_utc = hojeUtc
      usageData.count = 0
      usageData.blocked = false
      if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
        usageData.max_limit = DAILY_LIMIT
      }
      usageData.last_reset_utc = new Date().toISOString()
      if (recUsage) {
        recUsage.set('api_key', JSON.stringify(usageData))
        $app.save(recUsage)
      }
    }

    const currentCount = Number(usageData.count) || 0
    const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
    const travaDesativada = Boolean(usageData.trava_desativada)

    if (!travaDesativada && (usageData.blocked || currentCount >= maxLimit)) {
      return e.json(429, {
        error:
          'Limite diário de requisições da API-Sports atingido (80/dia). A cota é reiniciada às 21h (horário de Brasília). Placar mantido em segurança.',
        rate_limited: true,
        count: currentCount,
        max_limit: maxLimit,
      })
    }

    // Buscar chave da API-Sports
    // 1) Registro principal: chave = "placar_ao_vivo" && provedor = "api_football" && ativo = true
    let apiKey = ''
    try {
      const recPlacar = $app.findFirstRecordByFilter(
        'config_integracoes',
        "chave = 'placar_ao_vivo' && provedor = 'api_football' && ativo = true",
      )
      if (recPlacar) {
        apiKey = (recPlacar.getString('api_key') || recPlacar.get('api_key') || '')
          .toString()
          .trim()
      }
    } catch (_) {}

    // Fallback caso não encontre por filtro ou api_key esteja em branco:
    if (!apiKey) {
      try {
        const recPlacarDirect = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
        if (recPlacarDirect && recPlacarDirect.getBool('ativo')) {
          apiKey = (recPlacarDirect.getString('api_key') || recPlacarDirect.get('api_key') || '')
            .toString()
            .trim()
        }
      } catch (_) {}
    }

    // Fallback: qualquer registro provedor = "api_football" && ativo = true com api_key preenchido,
    // ignorando registros com JSON de metadados (como sobrescrita_jogos, api_validada, api_football_daily_usage)
    if (!apiKey) {
      try {
        const configs = $app.findRecordsByFilter(
          'config_integracoes',
          "provedor = 'api_football' && ativo = true",
          '-updated',
          20,
          0,
        )
        for (let ci = 0; ci < configs.length; ci++) {
          const cfg = configs[ci]
          const chv = (cfg.getString('chave') || '').trim()
          if (
            chv === 'sobrescrita_jogos' ||
            chv === 'api_validada' ||
            chv === 'api_football_daily_usage'
          ) {
            continue
          }
          const candidateKey = (cfg.getString('api_key') || cfg.get('api_key') || '')
            .toString()
            .trim()
          // Chave válida não começa com { nem [ (não é JSON)
          if (candidateKey && !candidateKey.startsWith('{') && !candidateKey.startsWith('[')) {
            apiKey = candidateKey
            break
          }
        }
      } catch (_) {}
    }

    if (!apiKey) {
      return e.json(400, {
        error: 'Chave da API-Football não configurada em config_integracoes (placar_ao_vivo).',
      })
    }
    // Consulta fixture por ID
    let fixtureData = null
    try {
      const isRapid = apiKey.length > 40
      const url = isRapid
        ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?id=${encodeURIComponent(fixtureIdParaUso)}`
        : `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureIdParaUso)}`
      const headers = isRapid
        ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
        : { 'x-apisports-key': apiKey }

      console.log(`[atualizar-jogo] [API-Sports] URL: ${url} | Fixture ID: ${fixtureIdParaUso}`)

      const res = $http.send({
        url,
        method: 'GET',
        headers,
        timeout: 15,
      })

      // Registra consumo da cota
      try {
        usageData.count = currentCount + 1
        usageData.last_request_utc = new Date().toISOString()
        if (recUsage) {
          recUsage.set('api_key', JSON.stringify(usageData))
          $app.save(recUsage)
        } else {
          const colIntegracoes = $app.findCollectionByNameOrId('config_integracoes')
          const novo = new Record(colIntegracoes)
          novo.set('chave', USAGE_RECORD_CHAVE)
          novo.set('provedor', 'api_football')
          novo.set('ativo', true)
          novo.set('api_key', JSON.stringify(usageData))
          $app.save(novo)
        }
      } catch (_) {}

      if (res.statusCode !== 200) {
        return e.json(502, {
          error: `A API-Sports retornou status ${res.statusCode}. Tente novamente mais tarde.`,
        })
      }

      const json = JSON.parse(res.raw)
      try {
        console.log(`[atualizar-jogo] [API-Sports] JSON exato:`, JSON.stringify(json))
      } catch (_) {}
      if (json.errors && Object.keys(json.errors).length > 0) {
        const errStr = JSON.stringify(json.errors)
        if (errStr.includes('rate') || errStr.includes('Requests')) {
          usageData.blocked = true
          if (recUsage) {
            recUsage.set('api_key', JSON.stringify(usageData))
            $app.save(recUsage)
          }
          return e.json(429, {
            error:
              'Limite de requisições da API-Sports atingido. A cota reinicia às 21h (Brasília).',
          })
        }
        return e.json(502, { error: `Erro da API-Sports: ${errStr}` })
      }

      if (!Array.isArray(json.response) || json.response.length === 0) {
        return e.json(404, {
          error: `Nenhuma partida encontrada na API-Sports para o fixture_id ${fixtureIdParaUso}.`,
        })
      }

      fixtureData = json.response[0]
    } catch (err) {
      return e.json(500, {
        error: 'Falha na comunicação com a API-Sports: ' + (err.message || String(err)),
      })
    }

    if (!fixtureData) {
      return e.json(404, { error: 'Dados da partida não puderam ser processados.' })
    }

    // Verifica horário de kickoff do jogo no horário de Brasília (UTC-3)
    const dataStr = (jogoRecord.getString('data') || '').trim()
    const horaStr = (jogoRecord.getString('hora') || '').trim()
    let kickoffMs = 0
    try {
      const horaParts = horaStr.split(':')
      const hh = (horaParts[0] || '16').padStart(2, '0')
      const mm = (horaParts[1] || '00').padStart(2, '0')
      const ss = (horaParts[2] || '00').padStart(2, '0')
      const isoStr = dataStr + 'T' + hh + ':' + mm + ':' + ss + '-03:00'
      const parsedKickoff = new Date(isoStr).getTime()
      if (!isNaN(parsedKickoff)) {
        kickoffMs = parsedKickoff
      }
    } catch (_) {}

    const kickoffJaChegou = kickoffMs > 0 ? Date.now() >= kickoffMs : true

    const goals = fixtureData.goals || {}
    const score = fixtureData.score || {}
    const statusInfo = fixtureData.fixture?.status || {}
    const statusShort = (statusInfo.short || '').toString().toUpperCase().trim()

    // Parser robusto de gols: goals.home/away com fallback para score.fulltime.home/away
    let rawHome = goals.home !== null && goals.home !== undefined ? goals.home : null
    let rawAway = goals.away !== null && goals.away !== undefined ? goals.away : null
    if (
      rawHome === null &&
      score.fulltime &&
      score.fulltime.home !== null &&
      score.fulltime.home !== undefined
    ) {
      rawHome = score.fulltime.home
    }
    if (
      rawAway === null &&
      score.fulltime &&
      score.fulltime.away !== null &&
      score.fulltime.away !== undefined
    ) {
      rawAway = score.fulltime.away
    }

    const homeGoals =
      rawHome !== null && !isNaN(parseInt(rawHome, 10)) ? parseInt(rawHome, 10) : null
    const awayGoals =
      rawAway !== null && !isNaN(parseInt(rawAway, 10)) ? parseInt(rawAway, 10) : null
    const hasOfficialScore = homeGoals !== null && awayGoals !== null

    const isLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(statusShort)
    const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)

    if (homeGoals !== null) {
      jogoRecord.set('placar_a', homeGoals)
    }
    if (awayGoals !== null) {
      jogoRecord.set('placar_b', awayGoals)
    }

    // Atualização de logos/escudos dos times via API-Football
    const homeTeamLogo = (fixtureData.teams?.home?.logo || '').toString().trim()
    const awayTeamLogo = (fixtureData.teams?.away?.logo || '').toString().trim()

    if (homeTeamLogo) {
      jogoRecord.set('url_escudo_mandante', homeTeamLogo)
    }
    if (awayTeamLogo) {
      jogoRecord.set('url_escudo_visitante', awayTeamLogo)
    }

    // Se houver registros vinculados na tabela jogos_do_dia ou enquete_jogos com o mesmo fixture_id, atualiza lá também
    try {
      if (fixtureIdParaUso && (homeTeamLogo || awayTeamLogo)) {
        try {
          const jdds = $app.findRecordsByFilter(
            'jogos_do_dia',
            `fixture_id = '${fixtureIdParaUso}'`,
            '-created',
            5,
            0,
          )
          for (let jdi = 0; jdi < jdds.length; jdi++) {
            const jdd = jdds[jdi]
            let mudouJdd = false
            if (homeTeamLogo && !jdd.getString('logo_casa')) {
              jdd.set('logo_casa', homeTeamLogo)
              mudouJdd = true
            }
            if (awayTeamLogo && !jdd.getString('logo_visitante')) {
              jdd.set('logo_visitante', awayTeamLogo)
              mudouJdd = true
            }
            if (mudouJdd) $app.save(jdd)
          }
        } catch (_) {}

        try {
          const enqs = $app.findRecordsByFilter(
            'enquete_jogos',
            `fixture_id = '${fixtureIdParaUso}'`,
            '-created',
            5,
            0,
          )
          for (let eqi = 0; eqi < enqs.length; eqi++) {
            const eq = enqs[eqi]
            let mudouEq = false
            if (homeTeamLogo && !eq.getString('logo_casa')) {
              eq.set('logo_casa', homeTeamLogo)
              mudouEq = true
            }
            if (awayTeamLogo && !eq.getString('logo_visitante')) {
              eq.set('logo_visitante', awayTeamLogo)
              mudouEq = true
            }
            if (mudouEq) $app.save(eq)
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Regra 1: Se o jogo já tiver sido encerrado na API (FT / AET / PEN),
    // altera automaticamente o status de "Pendente" para "Encerrado" (status: 'finalizado'),
    // marcando resultado_finalizado = true no banco de dados.
    if (isFinished) {
      jogoRecord.set('status', 'finalizado')
      jogoRecord.set('resultado_finalizado', true)
    } else if (kickoffJaChegou && isLive) {
      jogoRecord.set('status', 'ao_vivo')
    }

    // Extrair eventos de gols e marcadores no mesmo formato
    const events = Array.isArray(fixtureData.events) ? fixtureData.events : []
    const homeTeamId = fixtureData.teams?.home?.id
    const awayTeamId = fixtureData.teams?.away?.id

    const golsA = []
    const golsB = []
    const marcadoresGerais = []

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if ((ev.type || '').toString().toLowerCase() === 'goal') {
        const detail = (ev.detail || '').toString().toLowerCase()
        if (detail.includes('missed') || detail.includes('perdido')) {
          continue
        }
        const isContra = detail.includes('own') || detail.includes('contra')
        const playerName = (ev.player?.name || '').toString().trim()
        const minute = ev.time?.elapsed ? String(ev.time.elapsed) : ''
        const teamId = ev.team?.id

        if (playerName) {
          let posicao = 'Atacante/Meia'
          if (isContra) {
            posicao = 'Gol Contra'
          }

          const item = {
            nome: playerName,
            posicao: posicao,
            quantidade: 1,
            minuto: minute ? `${minute}'` : '',
          }

          if (teamId === homeTeamId) {
            golsA.push(item)
          } else if (teamId === awayTeamId) {
            golsB.push(item)
          }

          marcadoresGerais.push(minute ? `${playerName} ${minute}'` : playerName)
        }
      }
    }

    if (golsA.length > 0) {
      jogoRecord.set('gols_time_a', golsA)
    }
    if (golsB.length > 0) {
      jogoRecord.set('gols_time_b', golsB)
    }
    if (marcadoresGerais.length > 0) {
      jogoRecord.set('marcadores', marcadoresGerais)
    }

    if (
      fixtureIdParaUso &&
      (!jogoRecord.get('fixture_id') || jogoRecord.get('fixture_id') !== fixtureIdParaUso)
    ) {
      jogoRecord.set('fixture_id', fixtureIdParaUso)
    }

    // Salvar alterações no registro de jogo
    try {
      $app.save(jogoRecord)
    } catch (err) {
      return e.json(500, {
        error: 'Erro ao persistir dados do jogo no banco: ' + (err.message || String(err)),
      })
    }

    // Leitura de confirmação pós-gravação diretamente do banco de dados
    let savedJogoRecord = null
    try {
      savedJogoRecord = $app.findRecordById('jogos', jogoRecord.id)
    } catch (errRead) {
      return e.json(500, {
        error: 'Erro ao confirmar persistência no banco: ' + (errRead.message || String(errRead)),
      })
    }

    const savedPlacarA = savedJogoRecord.get('placar_a')
    const savedPlacarB = savedJogoRecord.get('placar_b')
    const savedStatus = savedJogoRecord.getString('status')
    const savedFinalizado = savedJogoRecord.getBool('resultado_finalizado')

    // Dispara o recálculo de pontuação dos palpites e ranking (reaproveitando rotina inline idêntica a admin_salvar_marcadores)
    let recalculou = false
    try {
      const statusAtualJogo = (jogoRecord.getString('status') || '').toLowerCase().trim()
      const STATUS_INICIADOS = [
        'em_andamento',
        'ao_vivo',
        '1h',
        '2h',
        'ht',
        'finalizado',
        'encerrado',
        'ft',
        'finished',
      ]
      const statusIniciado = STATUS_INICIADOS.indexOf(statusAtualJogo) >= 0
      const jogoIniciou = (kickoffMs > 0 && Date.now() >= kickoffMs) || statusIniciado

      const placarRealA = jogoRecord.getInt('placar_a')
      const placarRealB = jogoRecord.getInt('placar_b')
      const bolaoId = jogoRecord.getString('bolao')
      const temPenaltis = jogoRecord.getBool('tem_penaltis')
      const vencedorPenaltisReal = (jogoRecord.getString('vencedor_penaltis') || '')
        .toUpperCase()
        .trim()

      const stripAccents = (str) => {
        if (!str) return ''
        let s = String(str)
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        return s
          .replace(/[áàâãä]/gi, 'a')
          .replace(/[éèêë]/gi, 'e')
          .replace(/[íìîï]/gi, 'i')
          .replace(/[óòôõö]/gi, 'o')
          .replace(/[úùûü]/gi, 'u')
          .replace(/[ç]/gi, 'c')
          .replace(/[ñ]/gi, 'n')
      }

      const parseJsonField = (rec, fieldName) => {
        try {
          const raw = rec.get(fieldName)
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
            const str = String.fromCharCode.apply(null, raw)
            const parsed = JSON.parse(str)
            if (Array.isArray(parsed)) return parsed
          }
          if (Array.isArray(raw)) return raw
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            const parsed = JSON.parse(strVal)
            if (Array.isArray(parsed)) return parsed
          }
        } catch (_) {}
        try {
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            return strVal
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          }
        } catch (_) {}
        return []
      }

      const golsTimeA = parseJsonField(jogoRecord, 'gols_time_a')
      const golsTimeB = parseJsonField(jogoRecord, 'gols_time_b')

      let normMap = {}
      try {
        const normalizacoes = $app.findRecordsByFilter(
          'normalizacoes',
          "bolao = '" + bolaoId + "'",
          '',
          500,
          0,
        )
        for (let ni = 0; ni < normalizacoes.length; ni++) {
          const n = normalizacoes[ni]
          const orig = stripAccents(n.getString('nome_original') || '')
            .toLowerCase()
            .trim()
          const corr = stripAccents(n.getString('nome_correto') || '')
            .toLowerCase()
            .trim()
          if (orig && corr) {
            normMap[orig] = corr
          }
        }
      } catch (_) {}

      const normalizePlayerName = (name) => {
        if (!name) return ''
        let clean = stripAccents(String(name).toLowerCase().trim())
        if (normMap[clean]) {
          clean = stripAccents(normMap[clean])
        }
        return clean
      }

      const getWinner = (a, b) => {
        if (a > b) return 1
        if (b > a) return -1
        return 0
      }

      const realWinner = getWinner(placarRealA, placarRealB)
      const realDiff = Math.abs(placarRealA - placarRealB)

      const realScorersMap = {}
      const processScorer = (item) => {
        if (!item || !item.nome) return
        const rawNome = String(item.nome).trim()
        const cleanNome = rawNome
          .replace(/\s*\d+\s*['’]/g, '')
          .replace(/\(gol contra\)|\(contra\)/gi, '')
          .trim()
        const norm = normalizePlayerName(cleanNome)
        if (!norm) return

        const count = parseInt(item.quantidade, 10) || 1
        const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
        let pts = 1
        if (
          pos.indexOf('zagueiro') >= 0 ||
          pos.indexOf('lateral') >= 0 ||
          pos.indexOf('defensor') >= 0
        ) {
          pts = 3
        } else if (pos.indexOf('goleiro') >= 0) {
          pts = 10
        } else if (pos.indexOf('contra') >= 0) {
          pts = 5
        }

        const posLabel =
          item.posicao ||
          (pts === 3 ? 'Defensor' : pts === 10 ? 'Goleiro' : pts === 5 ? 'Gol Contra' : 'Atacante')

        const mins = []
        const minRegex = /(\d+)\s*['’]/g
        let mMatch
        while ((mMatch = minRegex.exec(rawNome)) !== null) {
          const num = parseInt(mMatch[1], 10)
          if (!isNaN(num)) mins.push(num)
        }

        if (realScorersMap[norm]) {
          realScorersMap[norm].countReal += count
          if (mins.length > 0) {
            realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
          }
        } else {
          realScorersMap[norm] = {
            displayName: cleanNome,
            norm: norm,
            points: pts,
            position: posLabel,
            countReal: count,
            minutes: mins,
          }
        }
      }

      for (let gi = 0; gi < golsTimeA.length; gi++) processScorer(golsTimeA[gi])
      for (let gi = 0; gi < golsTimeB.length; gi++) processScorer(golsTimeB[gi])

      // Recalcula todos os palpites do jogo (trava jogoPontua intacta: !jogoIniciou zera pontuação)
      const palpitesDoJogo = $app.findRecordsByFilter(
        'palpites',
        "jogo = '" + jogoId + "'",
        '',
        100,
        0,
      )
      for (let pi = 0; pi < palpitesDoJogo.length; pi++) {
        const palpite = palpitesDoJogo[pi]
        let pontos = 0
        const detalhamento = []

        if (!jogoIniciou) {
          palpite.set('pontuacao_jogo', 0)
          palpite.set('detalhamento', ['Aguardando início'])
          $app.save(palpite)
          continue
        }

        const palpiteA = palpite.getInt('placar_a')
        const palpiteB = palpite.getInt('placar_b')
        const predWinner = getWinner(palpiteA, palpiteB)
        const predDiff = Math.abs(palpiteA - palpiteB)

        const isExact = palpiteA === placarRealA && palpiteB === placarRealB

        if (isExact) {
          pontos += 8
          detalhamento.push('Placar Exato (+8 pts)')
        } else {
          if (predWinner === realWinner) {
            if (realWinner === 0) {
              pontos += 2
              detalhamento.push('Empate (+2 pts)')
            } else {
              pontos += 2
              detalhamento.push('Vencedor (+2 pts)')
            }
          }

          if (predDiff === realDiff && predWinner === realWinner) {
            pontos += 1
            detalhamento.push('Diferença de Gols (+1 pt)')
          }

          if (palpiteA === placarRealA || palpiteB === placarRealB) {
            pontos += 1
            detalhamento.push('Metade do Placar (+1 pt)')
          }
        }

        const predScorersA = parseJsonField(palpite, 'goleadores_a')
        const predScorersB = parseJsonField(palpite, 'goleadores_b')

        const predInfo = {}
        const addPredScorer = (p) => {
          if (!p) return
          const pStr = typeof p === 'string' ? p : String(p.nome || '')
          const cleanP = pStr
            .replace(/\s*\d+\s*['’]/g, '')
            .replace(/\(gol contra\)|\(contra\)/gi, '')
            .trim()
          const normP = normalizePlayerName(cleanP)
          if (!normP) return

          const pPos = typeof p === 'object' && p !== null ? p.posicao : undefined
          const pContra =
            (typeof p === 'object' && p !== null && p.gol_contra === true) ||
            /\(gol contra\)|\(contra\)/i.test(pStr) ||
            String(pPos || '')
              .toLowerCase()
              .indexOf('contra') >= 0

          if (predInfo[normP]) {
            predInfo[normP].count += 1
            if (!predInfo[normP].posicao && pPos) predInfo[normP].posicao = pPos
            if (pContra) predInfo[normP].golContra = true
          } else {
            predInfo[normP] = {
              count: 1,
              posicao: pPos,
              golContra: pContra,
            }
          }
        }

        for (let sa = 0; sa < predScorersA.length; sa++) addPredScorer(predScorersA[sa])
        for (let sb = 0; sb < predScorersB.length; sb++) addPredScorer(predScorersB[sb])

        const matchedScorers = []
        for (const normPred in predInfo) {
          const itemInfo = predInfo[normPred]
          const countPalpite = itemInfo.count
          let matchedReal = realScorersMap[normPred]
          if (!matchedReal) {
            for (const rNorm in realScorersMap) {
              if (rNorm.indexOf(normPred) >= 0 || normPred.indexOf(rNorm) >= 0) {
                matchedReal = realScorersMap[rNorm]
                break
              }
            }
          }

          if (matchedReal && matchedReal.countReal > 0) {
            const g = Math.min(matchedReal.countReal, countPalpite)
            if (g > 0) {
              const targetPosStr = String(itemInfo.posicao || matchedReal.position || '')
                .toLowerCase()
                .trim()
              let unitPoints = matchedReal.points
              let displayPos = matchedReal.position

              if (itemInfo.golContra || targetPosStr.indexOf('contra') >= 0) {
                unitPoints = 5
                displayPos = 'Gol Contra'
              } else if (
                targetPosStr.indexOf('defensor') >= 0 ||
                targetPosStr.indexOf('zagueiro') >= 0 ||
                targetPosStr.indexOf('lateral') >= 0 ||
                targetPosStr === 'd'
              ) {
                unitPoints = 3
                displayPos = 'Defensor'
              } else if (targetPosStr.indexOf('goleiro') >= 0 || targetPosStr === 'g') {
                unitPoints = 10
                displayPos = 'Goleiro'
              } else if (
                targetPosStr.indexOf('atacante') >= 0 ||
                targetPosStr.indexOf('meia') >= 0 ||
                targetPosStr.indexOf('meio') >= 0 ||
                targetPosStr === 'a'
              ) {
                unitPoints = 1
                displayPos = 'Atacante'
              }

              const ptsTotal = g * unitPoints
              pontos += ptsTotal

              const minsToUse = (matchedReal.minutes || []).slice(0, g)
              let txt = ''
              if (minsToUse.length > 0) {
                const minsStr = minsToUse.map((m) => m + "'").join(', ')
                txt =
                  matchedReal.displayName +
                  ' ' +
                  minsStr +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else if (g > 1) {
                txt =
                  matchedReal.displayName +
                  ' ×' +
                  g +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else {
                txt =
                  matchedReal.displayName +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              }
              matchedScorers.push(txt)
            }
          }
        }

        if (matchedScorers.length > 0) {
          detalhamento.push('Gols acertados: ' + matchedScorers.join(', '))
        }

        if (temPenaltis) {
          const predPenaltis = (palpite.getString('vencedor_penaltis') || '').toUpperCase().trim()
          if (
            predPenaltis &&
            predPenaltis === vencedorPenaltisReal &&
            (predPenaltis === 'A' || predPenaltis === 'B')
          ) {
            pontos += 2
            detalhamento.push('Vencedor nos Pênaltis (+2 pts)')
          }
        }

        palpite.set('pontuacao_jogo', pontos)
        palpite.set('detalhamento', detalhamento)
        $app.save(palpite)
      }

      // Reacumula pontuação total dos participantes
      const participantes = $app.findRecordsByFilter(
        'participantes',
        "bolao = '" + bolaoId + "'",
        '',
        200,
        0,
      )
      for (let pi = 0; pi < participantes.length; pi++) {
        const part = participantes[pi]
        const partPalpites = $app.findRecordsByFilter(
          'palpites',
          "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
          '',
          500,
          0,
        )

        let totalPoints = 0
        for (let ppi = 0; ppi < partPalpites.length; ppi++) {
          const p = partPalpites[ppi]
          const pJogoId = p.getString('jogo')
          try {
            const gameRec = $app.findRecordById('jogos', pJogoId)
            if (gameRec && gameRec.getBool('resultado_finalizado')) {
              totalPoints += p.getInt('pontuacao_jogo')
            }
          } catch (_) {}
        }

        const importedPts = part.getInt('pontos_importados') || 0
        part.set('pontuacao_total', importedPts + totalPoints)
        $app.save(part)
      }

      try {
        const bolao = $app.findRecordById('boloes', bolaoId)
        bolao.set('ultima_atualizacao', new Date().toISOString())
        $app.save(bolao)
      } catch (_) {}

      recalculou = true
    } catch (errRecalc) {
      console.log('[atualizar-jogo] Erro ao recalcular pontuação:', errRecalc)
    }

    // Regra 2: Se o retorno da API trouxer placar null (jogo ainda não iniciado ou sem placar oficial),
    // NÃO exibir "Placar sincronizado com sucesso", informar mensagem específica
    if (!hasOfficialScore) {
      return e.json(200, {
        success: true,
        tem_placar_oficial: false,
        message:
          'A API retornou a consulta, mas o placar oficial do jogo ainda não foi disponibilizado na API-Sports.',
        jogo: {
          id: savedJogoRecord.id,
          bolao: savedJogoRecord.get('bolao'),
          placar_a: savedPlacarA,
          placar_b: savedPlacarB,
          status: savedStatus,
          resultado_finalizado: savedFinalizado,
          gols_time_a: savedJogoRecord.get('gols_time_a'),
          gols_time_b: savedJogoRecord.get('gols_time_b'),
          marcadores: savedJogoRecord.get('marcadores'),
          url_escudo_mandante: savedJogoRecord.get('url_escudo_mandante'),
          url_escudo_visitante: savedJogoRecord.get('url_escudo_visitante'),
          fixture_id: savedJogoRecord.get('fixture_id'),
        },
        status_fixture: statusShort,
        elapsed: statusInfo.elapsed || null,
        recalculou,
      })
    }

    const encerrouAgora = isFinished ? ' Jogo marcado como Encerrado.' : ''
    return e.json(200, {
      success: true,
      tem_placar_oficial: true,
      message: `Placar sincronizado com sucesso: ${savedPlacarA} x ${savedPlacarB}.${encerrouAgora}`,
      jogo: {
        id: savedJogoRecord.id,
        bolao: savedJogoRecord.get('bolao'),
        placar_a: savedPlacarA,
        placar_b: savedPlacarB,
        status: savedStatus,
        resultado_finalizado: savedFinalizado,
        gols_time_a: savedJogoRecord.get('gols_time_a'),
        gols_time_b: savedJogoRecord.get('gols_time_b'),
        marcadores: savedJogoRecord.get('marcadores'),
        url_escudo_mandante: savedJogoRecord.get('url_escudo_mandante'),
        url_escudo_visitante: savedJogoRecord.get('url_escudo_visitante'),
        fixture_id: savedJogoRecord.get('fixture_id'),
      },
      status_fixture: statusShort,
      elapsed: statusInfo.elapsed || null,
      recalculou,
    })
  },
  $apis.requireAuth(),
)
