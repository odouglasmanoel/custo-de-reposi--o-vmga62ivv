/**
 * pocketbase/hooks/cron_jogos_do_dia.js
 * Sincronização Diária Matinal dos Jogos do Dia da API-Football.
 *
 * Agenda: Executa EXATAMENTE 1 ÚNICA chamada matinal por dia (0 10 * * * UTC = 07:00 Brasília).
 * Sem re-tentativas.
 * Roteada pelo limitador centralizador api_football_limiter (Prioridade 3).
 * Se o uso no dia já estiver >= 10, o limiter suprime preventivamente para preservar cota ao bolão.
 *
 * REGRA DO POCKETBASE JSVM:
 * Funções declaradas FORA do callback do cron não são acessíveis em tempo de execução
 * (VM pool isolado). Toda a lógica do cronAdd DEVE estar 100% inline dentro do callback.
 */

// -------------------------------------------------------------
// Endpoint seguro para acionamento/teste interno da rotina
// POST /backend/v1/jogos-do-dia/sincronizar-matinal
// Permite que admins ou testes locais disparem a rotina sob demanda
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/jogos-do-dia/sincronizar-matinal', (e) => {
  const { enviarRequisicaoApiFootball } = require(`${__hooks}/api_football_limiter.js`)

  const classificarRegiao = function (leagueId, leagueName, countryName) {
    const id = Number(leagueId)
    if (
      id === 71 ||
      id === 73 ||
      (leagueName && leagueName.toLowerCase().indexOf('brasileir') !== -1)
    ) {
      return { regiao: 'Brasileirão & Copas', pais: 'Brasil' }
    }
    if (
      id === 13 ||
      id === 11 ||
      (leagueName &&
        (leagueName.toLowerCase().indexOf('libertadores') !== -1 ||
          leagueName.toLowerCase().indexOf('sudamericana') !== -1))
    ) {
      return { regiao: 'Sul-Americana', pais: 'América do Sul' }
    }
    if (
      id === 2 ||
      id === 3 ||
      id === 39 ||
      id === 140 ||
      id === 135 ||
      id === 78 ||
      id === 61 ||
      id === 45 ||
      id === 48 ||
      id === 143 ||
      id === 137 ||
      id === 81 ||
      id === 66
    ) {
      let p = 'Europa'
      if (id === 39 || id === 45 || id === 48) p = 'Inglaterra'
      else if (id === 140 || id === 143) p = 'Espanha'
      else if (id === 135 || id === 137) p = 'Itália'
      else if (id === 78 || id === 81) p = 'Alemanha'
      else if (id === 61 || id === 66) p = 'França'
      return { regiao: 'Futebol Europeu', pais: p }
    }
    return { regiao: 'Outros', pais: countryName || 'Internacional' }
  }

  const extrairHoraSP = function (dateIso) {
    if (!dateIso) return '16:00'
    try {
      const d = new Date(dateIso)
      if (isNaN(d.getTime())) return '16:00'
      const spTime = new Date(d.getTime() - 3 * 3600 * 1000)
      const h = ('0' + spTime.getUTCHours()).slice(-2)
      const m = ('0' + spTime.getUTCMinutes()).slice(-2)
      return h + ':' + m
    } catch (_) {
      return '16:00'
    }
  }

  const extrairScorers = function (events) {
    const scorers = []
    if (!Array.isArray(events)) return scorers
    for (let evi = 0; evi < events.length; evi++) {
      const ev = events[evi]
      if (!ev) continue
      const evType = (ev.type || '').toLowerCase()
      const evDetail = (ev.detail || '').toLowerCase()
      if (evType === 'goal' || evType === 'gol') {
        if (evDetail.indexOf('missed') !== -1) continue
        const pName = (ev.player && (ev.player.name || ev.player.shortName)) || ''
        if (pName) {
          scorers.push({
            nome: pName,
            minuto: ev.time && ev.time.elapsed != null ? String(ev.time.elapsed) : '',
            posicao: 'Atacante',
            quantidade: 1,
            teamId: ev.team ? ev.team.id : null,
            teamName: ev.team ? ev.team.name : null,
          })
        }
      }
    }
    return scorers
  }

  const processarGravacaoJogosDoDia = function (fixturesArray, dateTarget) {
    const targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    const targetLeagueSet = {}
    for (let lsi = 0; lsi < targetLeagueIds.length; lsi++) {
      targetLeagueSet[targetLeagueIds[lsi]] = true
    }

    const jogosFiltrados = []
    for (let fi = 0; fi < fixturesArray.length; fi++) {
      const fixItem = fixturesArray[fi]
      if (!fixItem || !fixItem.fixture || !fixItem.league) continue
      const lId = Number(fixItem.league.id)
      const lName = (fixItem.league.name || '').trim().toLowerCase()
      const lCountry = (fixItem.league.country || '').trim().toLowerCase()

      let ehLigaAtiva = Boolean(targetLeagueSet[lId])
      if (!ehLigaAtiva) {
        if (lCountry === 'brazil' || lCountry === 'brasil') {
          if (
            lName.indexOf('brasileir') !== -1 ||
            lName.indexOf('copa do brasil') !== -1 ||
            lName.indexOf('serie a') !== -1
          ) {
            ehLigaAtiva = true
          }
        } else if (lCountry === 'england') {
          if (
            lName === 'premier league' ||
            lName === 'fa cup' ||
            lName === 'efl cup' ||
            lName === 'league cup'
          ) {
            ehLigaAtiva = true
          }
        } else if (lCountry === 'spain') {
          if (lName === 'la liga' || lName === 'copa del rey') ehLigaAtiva = true
        } else if (lCountry === 'italy') {
          if (lName === 'serie a' || lName === 'coppa italia') ehLigaAtiva = true
        } else if (lCountry === 'germany') {
          if (lName === 'bundesliga' || lName === 'dfb pokal') ehLigaAtiva = true
        } else if (lCountry === 'france') {
          if (lName === 'ligue 1' || lName === 'coupe de france') ehLigaAtiva = true
        } else if (
          lName.indexOf('champions league') !== -1 ||
          lName.indexOf('copa libertadores') !== -1 ||
          lName.indexOf('copa sudamericana') !== -1 ||
          lName.indexOf('europa league') !== -1
        ) {
          ehLigaAtiva = true
        }
      }

      if (ehLigaAtiva) {
        jogosFiltrados.push(fixItem)
      }
    }

    const colJogosDoDia = $app.findCollectionByNameOrId('jogos_do_dia')
    let inseridos = 0
    let atualizados = 0

    for (let ji = 0; ji < jogosFiltrados.length; ji++) {
      const item = jogosFiltrados[ji]
      const fidStr = String(item.fixture.id)
      const tCasa = (item.teams && item.teams.home && item.teams.home.name) || ''
      const tVis = (item.teams && item.teams.away && item.teams.away.name) || ''
      if (!tCasa || !tVis) continue

      const lInfo = classificarRegiao(item.league.id, item.league.name, item.league.country)
      const rawDate = item.fixture.date || ''
      const horaSP = extrairHoraSP(rawDate)

      const pCasa = item.goals && item.goals.home != null ? item.goals.home : null
      const pVis = item.goals && item.goals.away != null ? item.goals.away : null
      const stShort = (item.fixture.status && item.fixture.status.short) || 'NS'
      const stLong = (item.fixture.status && item.fixture.status.long) || 'Agendado'
      const stElapsed =
        item.fixture.status && item.fixture.status.elapsed != null
          ? item.fixture.status.elapsed
          : null
      let logoCasa = (item.teams && item.teams.home && item.teams.home.logo) || ''
      let logoVis = (item.teams && item.teams.away && item.teams.away.logo) || ''
      const logoCamp = (item.league && item.league.logo) || ''

      if (tCasa.toLowerCase().indexOf('paris') !== -1 || tCasa.toLowerCase() === 'psg') {
        logoCasa = 'https://media.api-sports.io/football/teams/85.png'
      }
      if (tVis.toLowerCase().indexOf('paris') !== -1 || tVis.toLowerCase() === 'psg') {
        logoVis = 'https://media.api-sports.io/football/teams/85.png'
      }

      const scorersList = extrairScorers(item.events)

      let recordToSave = null
      try {
        const existing = $app.findRecordsByFilter(
          'jogos_do_dia',
          "data = '" + dateTarget + "' && fixture_id = '" + fidStr + "'",
          'created',
          1,
          0,
        )
        if (existing && existing.length > 0) {
          recordToSave = existing[0]
          atualizados++
        }
      } catch (_) {}

      if (!recordToSave) {
        recordToSave = new Record(colJogosDoDia)
        recordToSave.set('fixture_id', fidStr)
        recordToSave.set('data', dateTarget)
        inseridos++
      }

      recordToSave.set('horario', horaSP)
      recordToSave.set('data_hora_iso', rawDate)
      recordToSave.set('campeonato', item.league.name || 'Futebol')
      recordToSave.set('campeonato_logo', logoCamp)
      recordToSave.set('league_id', Number(item.league.id) || 0)
      recordToSave.set('round', (item.league && item.league.round) || '')
      recordToSave.set('regiao', lInfo.regiao)
      recordToSave.set('pais', lInfo.pais)
      recordToSave.set('time_casa', tCasa)
      recordToSave.set('time_visitante', tVis)
      recordToSave.set('logo_casa', logoCasa)
      recordToSave.set('logo_visitante', logoVis)
      recordToSave.set('placar_casa', pCasa)
      recordToSave.set('placar_visitante', pVis)
      recordToSave.set('status_short', stShort)
      recordToSave.set('status_long', stLong)
      recordToSave.set('status_elapsed', stElapsed)
      recordToSave.set('scorers', scorersList)
      recordToSave.set('events', item.events || [])
      recordToSave.set('raw_payload', item)

      try {
        $app.save(recordToSave)
      } catch (errSaveRec) {
        console.log('[cron jogos-do-dia] Erro ao salvar jogo ' + fidStr + ':', errSaveRec)
      }
    }

    return { total: fixturesArray.length, ativas: jogosFiltrados.length, inseridos, atualizados }
  }

  const authRecord = e.auth
  const internalSecretHeader = e.requestInfo().headers['x-internal-secret'] || ''
  const isLocalCall =
    e.requestInfo().remoteAddr === '127.0.0.1' || e.requestInfo().remoteAddr === '::1'

  if (!authRecord && !internalSecretHeader && !isLocalCall) {
    return e.unauthorizedError('Acesso não autorizado')
  }

  try {
    console.log('[cron jogos-do-dia endpoint] Iniciando rotina matinal de sincronização...')

    let apiKey = ''
    try {
      const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (cfgRec && cfgRec.getBool('ativo')) {
        apiKey = (cfgRec.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!apiKey) {
      try {
        if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
          apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
        } else if ($os && $os.getenv) {
          apiKey = ($os.getenv('API_FOOTBALL_KEY') || '').trim()
        }
      } catch (_) {}
    }

    if (!apiKey) {
      console.log('[cron jogos-do-dia endpoint] Chave da API-Football não encontrada ou inativa.')
      return e.json(200, {
        success: false,
        cached: true,
        notice: 'Chave não configurada. Exibindo jogos locais.',
      })
    }

    const dataForcada = (e.requestInfo().query.date || '').trim()
    let dateTarget = ''
    if (dataForcada && /^\d{4}-\d{2}-\d{2}$/.test(dataForcada)) {
      dateTarget = dataForcada
    } else {
      const nowSp = new Date(Date.now() - 3 * 3600 * 1000)
      const ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
      const yd = ('0' + nowSp.getUTCDate()).slice(-2)
      dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd
    }

    const isRapid = apiKey.length > 40
    const url = isRapid
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'
      : 'https://v3.football.api-sports.io/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'

    const hdrs = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    // Executa via limitador centralizador com Prioridade 3
    const limiterRes = enviarRequisicaoApiFootball(url, { headers: hdrs }, 3)

    if (limiterRes.blocked) {
      console.log(
        '[cron jogos-do-dia endpoint] Chamada bloqueada/suprimida pelo limiter:',
        limiterRes.reason,
      )
      return e.json(200, {
        success: false,
        cached: true,
        rate_limited: true,
        waiting_reset: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
        usage: limiterRes.usage,
      })
    }

    const resJson = limiterRes.json
    const fixturesArray = resJson && Array.isArray(resJson.response) ? resJson.response : []
    const stats = processarGravacaoJogosDoDia(fixturesArray, dateTarget)

    return e.json(200, {
      success: true,
      data: dateTarget,
      total_retornado: stats.total,
      total_ligas_ativas: stats.ativas,
      inseridos: stats.inseridos,
      atualizados: stats.atualizados,
    })
  } catch (errGeral) {
    console.log('[cron jogos-do-dia endpoint] Aviso na rotina matinal:', errGeral)
    return e.json(200, {
      success: false,
      cached: true,
      notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
      error: String(errGeral),
    })
  }
})

// -------------------------------------------------------------
// Registro do Cron Diário Matinal: 07:00 America/Sao_Paulo (10:00 UTC)
// Expressão: 0 10 * * * — EXATAMENTE 1 ÚNICA CHAMADA MATINAL, sem retentativas
// 100% DAS FUNÇÕES E VARIÁVEIS INLINE DENTRO DO CORPO DO CALLBACK
// -------------------------------------------------------------
cronAdd('jogos_do_dia_sync_matinal', '0 10 * * *', () => {
  const { enviarRequisicaoApiFootball } = require(`${__hooks}/api_football_limiter.js`)

  const classificarRegiao = function (leagueId, leagueName, countryName) {
    const id = Number(leagueId)
    if (
      id === 71 ||
      id === 73 ||
      (leagueName && leagueName.toLowerCase().indexOf('brasileir') !== -1)
    ) {
      return { regiao: 'Brasileirão & Copas', pais: 'Brasil' }
    }
    if (
      id === 13 ||
      id === 11 ||
      (leagueName &&
        (leagueName.toLowerCase().indexOf('libertadores') !== -1 ||
          leagueName.toLowerCase().indexOf('sudamericana') !== -1))
    ) {
      return { regiao: 'Sul-Americana', pais: 'América do Sul' }
    }
    if (
      id === 2 ||
      id === 3 ||
      id === 39 ||
      id === 140 ||
      id === 135 ||
      id === 78 ||
      id === 61 ||
      id === 45 ||
      id === 48 ||
      id === 143 ||
      id === 137 ||
      id === 81 ||
      id === 66
    ) {
      let p = 'Europa'
      if (id === 39 || id === 45 || id === 48) p = 'Inglaterra'
      else if (id === 140 || id === 143) p = 'Espanha'
      else if (id === 135 || id === 137) p = 'Itália'
      else if (id === 78 || id === 81) p = 'Alemanha'
      else if (id === 61 || id === 66) p = 'França'
      return { regiao: 'Futebol Europeu', pais: p }
    }
    return { regiao: 'Outros', pais: countryName || 'Internacional' }
  }

  const extrairHoraSP = function (dateIso) {
    if (!dateIso) return '16:00'
    try {
      const d = new Date(dateIso)
      if (isNaN(d.getTime())) return '16:00'
      const spTime = new Date(d.getTime() - 3 * 3600 * 1000)
      const h = ('0' + spTime.getUTCHours()).slice(-2)
      const m = ('0' + spTime.getUTCMinutes()).slice(-2)
      return h + ':' + m
    } catch (_) {
      return '16:00'
    }
  }

  const extrairScorers = function (events) {
    const scorers = []
    if (!Array.isArray(events)) return scorers
    for (let evi = 0; evi < events.length; evi++) {
      const ev = events[evi]
      if (!ev) continue
      const evType = (ev.type || '').toLowerCase()
      const evDetail = (ev.detail || '').toLowerCase()
      if (evType === 'goal' || evType === 'gol') {
        if (evDetail.indexOf('missed') !== -1) continue
        const pName = (ev.player && (ev.player.name || ev.player.shortName)) || ''
        if (pName) {
          scorers.push({
            nome: pName,
            minuto: ev.time && ev.time.elapsed != null ? String(ev.time.elapsed) : '',
            posicao: 'Atacante',
            quantidade: 1,
            teamId: ev.team ? ev.team.id : null,
            teamName: ev.team ? ev.team.name : null,
          })
        }
      }
    }
    return scorers
  }

  const processarGravacaoJogosDoDia = function (fixturesArray, dateTarget) {
    const targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    const targetLeagueSet = {}
    for (let lsi = 0; lsi < targetLeagueIds.length; lsi++) {
      targetLeagueSet[targetLeagueIds[lsi]] = true
    }

    const jogosFiltrados = []
    for (let fi = 0; fi < fixturesArray.length; fi++) {
      const fixItem = fixturesArray[fi]
      if (!fixItem || !fixItem.fixture || !fixItem.league) continue
      const lId = Number(fixItem.league.id)
      const lName = (fixItem.league.name || '').trim().toLowerCase()
      const lCountry = (fixItem.league.country || '').trim().toLowerCase()

      let ehLigaAtiva = Boolean(targetLeagueSet[lId])
      if (!ehLigaAtiva) {
        if (lCountry === 'brazil' || lCountry === 'brasil') {
          if (
            lName.indexOf('brasileir') !== -1 ||
            lName.indexOf('copa do brasil') !== -1 ||
            lName.indexOf('serie a') !== -1
          ) {
            ehLigaAtiva = true
          }
        } else if (lCountry === 'england') {
          if (
            lName === 'premier league' ||
            lName === 'fa cup' ||
            lName === 'efl cup' ||
            lName === 'league cup'
          ) {
            ehLigaAtiva = true
          }
        } else if (lCountry === 'spain') {
          if (lName === 'la liga' || lName === 'copa del rey') ehLigaAtiva = true
        } else if (lCountry === 'italy') {
          if (lName === 'serie a' || lName === 'coppa italia') ehLigaAtiva = true
        } else if (lCountry === 'germany') {
          if (lName === 'bundesliga' || lName === 'dfb pokal') ehLigaAtiva = true
        } else if (lCountry === 'france') {
          if (lName === 'ligue 1' || lName === 'coupe de france') ehLigaAtiva = true
        } else if (
          lName.indexOf('champions league') !== -1 ||
          lName.indexOf('copa libertadores') !== -1 ||
          lName.indexOf('copa sudamericana') !== -1 ||
          lName.indexOf('europa league') !== -1
        ) {
          ehLigaAtiva = true
        }
      }

      if (ehLigaAtiva) {
        jogosFiltrados.push(fixItem)
      }
    }

    const colJogosDoDia = $app.findCollectionByNameOrId('jogos_do_dia')
    let inseridos = 0
    let atualizados = 0

    for (let ji = 0; ji < jogosFiltrados.length; ji++) {
      const item = jogosFiltrados[ji]
      const fidStr = String(item.fixture.id)
      const tCasa = (item.teams && item.teams.home && item.teams.home.name) || ''
      const tVis = (item.teams && item.teams.away && item.teams.away.name) || ''
      if (!tCasa || !tVis) continue

      const lInfo = classificarRegiao(item.league.id, item.league.name, item.league.country)
      const rawDate = item.fixture.date || ''
      const horaSP = extrairHoraSP(rawDate)

      const pCasa = item.goals && item.goals.home != null ? item.goals.home : null
      const pVis = item.goals && item.goals.away != null ? item.goals.away : null
      const stShort = (item.fixture.status && item.fixture.status.short) || 'NS'
      const stLong = (item.fixture.status && item.fixture.status.long) || 'Agendado'
      const stElapsed =
        item.fixture.status && item.fixture.status.elapsed != null
          ? item.fixture.status.elapsed
          : null
      let logoCasa = (item.teams && item.teams.home && item.teams.home.logo) || ''
      let logoVis = (item.teams && item.teams.away && item.teams.away.logo) || ''
      const logoCamp = (item.league && item.league.logo) || ''

      if (tCasa.toLowerCase().indexOf('paris') !== -1 || tCasa.toLowerCase() === 'psg') {
        logoCasa = 'https://media.api-sports.io/football/teams/85.png'
      }
      if (tVis.toLowerCase().indexOf('paris') !== -1 || tVis.toLowerCase() === 'psg') {
        logoVis = 'https://media.api-sports.io/football/teams/85.png'
      }

      const scorersList = extrairScorers(item.events)

      let recordToSave = null
      try {
        const existing = $app.findRecordsByFilter(
          'jogos_do_dia',
          "data = '" + dateTarget + "' && fixture_id = '" + fidStr + "'",
          'created',
          1,
          0,
        )
        if (existing && existing.length > 0) {
          recordToSave = existing[0]
          atualizados++
        }
      } catch (_) {}

      if (!recordToSave) {
        recordToSave = new Record(colJogosDoDia)
        recordToSave.set('fixture_id', fidStr)
        recordToSave.set('data', dateTarget)
        inseridos++
      }

      recordToSave.set('horario', horaSP)
      recordToSave.set('data_hora_iso', rawDate)
      recordToSave.set('campeonato', item.league.name || 'Futebol')
      recordToSave.set('campeonato_logo', logoCamp)
      recordToSave.set('league_id', Number(item.league.id) || 0)
      recordToSave.set('round', (item.league && item.league.round) || '')
      recordToSave.set('regiao', lInfo.regiao)
      recordToSave.set('pais', lInfo.pais)
      recordToSave.set('time_casa', tCasa)
      recordToSave.set('time_visitante', tVis)
      recordToSave.set('logo_casa', logoCasa)
      recordToSave.set('logo_visitante', logoVis)
      recordToSave.set('placar_casa', pCasa)
      recordToSave.set('placar_visitante', pVis)
      recordToSave.set('status_short', stShort)
      recordToSave.set('status_long', stLong)
      recordToSave.set('status_elapsed', stElapsed)
      recordToSave.set('scorers', scorersList)
      recordToSave.set('events', item.events || [])
      recordToSave.set('raw_payload', item)

      try {
        $app.save(recordToSave)
      } catch (errSaveRec) {
        console.log('[cron jogos-do-dia] Erro ao salvar jogo ' + fidStr + ':', errSaveRec)
      }
    }

    return { total: fixturesArray.length, ativas: jogosFiltrados.length, inseridos, atualizados }
  }

  try {
    console.log('[cron jogos-do-dia] Disparo agendado das 07:00 SP (10:00 UTC)...')

    let apiKey = ''
    try {
      const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (cfgRec && cfgRec.getBool('ativo')) {
        apiKey = (cfgRec.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!apiKey) {
      try {
        if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
          apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
        } else if ($os && $os.getenv) {
          apiKey = ($os.getenv('API_FOOTBALL_KEY') || '').trim()
        }
      } catch (_) {}
    }

    if (!apiKey) {
      console.log('[cron jogos-do-dia] Chave da API-Football não encontrada ou inativa. Abortando.')
      return
    }

    const nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    const ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    const yd = ('0' + nowSp.getUTCDate()).slice(-2)
    const dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

    const isRapid = apiKey.length > 40
    const url = isRapid
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'
      : 'https://v3.football.api-sports.io/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'

    const hdrs = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    // 1 ÚNICA CHAMADA MATINAL via limitador, Prioridade 3
    const limiterRes = enviarRequisicaoApiFootball(url, { headers: hdrs }, 3)

    if (limiterRes.blocked) {
      console.log(
        '[cron jogos-do-dia] Chamada matinal suprimida pelo limitador diário:',
        limiterRes.reason,
      )
      return
    }

    const resJson = limiterRes.json
    const fixturesArray = resJson && Array.isArray(resJson.response) ? resJson.response : []
    const stats = processarGravacaoJogosDoDia(fixturesArray, dateTarget)
    console.log(
      `[cron jogos-do-dia] Cron matinal concluído: ${stats.total} fixtures, ${stats.ativas} ligas ativas, ${stats.inseridos} inseridos, ${stats.atualizados} atualizados.`,
    )
  } catch (errCron) {
    console.log('[cron jogos-do-dia] Erro no cron matinal:', errCron)
  }
})
