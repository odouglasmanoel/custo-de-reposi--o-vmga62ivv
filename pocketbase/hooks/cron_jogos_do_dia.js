/**
 * Cron Job: Sincronização Diária Matinal dos Jogos do Dia da API-Football.
 *
 * Agenda: Executa 1 vez ao dia pelas manhãs às 07:00 fuso de Brasília (America/Sao_Paulo -> UTC-3).
 * Horário UTC: 10:00 UTC (10:00 UTC = 07:00 America/Sao_Paulo).
 * Expressão Cron: 0 10 * * *
 *
 * REGRA DE OURO DO USUÁRIO:
 * - Não faz requisições diretas à API a cada clique do usuário.
 * - Busca os jogos do dia uma vez pelas manhãs APENAS para as ligas ativas do Bolão.
 * - Salva na tabela local `jogos_do_dia` do banco de dados.
 * - A tela 'Jogos do Dia' lê exclusivamente essa tabela local.
 * - Cota respeitada: 1 execução matinal por dia (1 chamada /fixtures?date=...&timezone=America/Sao_Paulo).
 */

// -------------------------------------------------------------
// Endpoint seguro para acionamento/teste interno da rotina
// POST /backend/v1/jogos-do-dia/sincronizar-matinal
// Permite que admins ou testes locais disparem a rotina sob demanda
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/jogos-do-dia/sincronizar-matinal', (e) => {
  var authRecord = e.auth
  var internalSecretHeader = e.requestInfo().headers['x-internal-secret'] || ''
  var isLocalCall =
    e.requestInfo().remoteAddr === '127.0.0.1' || e.requestInfo().remoteAddr === '::1'

  if (!authRecord && !internalSecretHeader && !isLocalCall) {
    return e.unauthorizedError('Acesso não autorizado')
  }

  try {
    console.log('[cron jogos-do-dia endpoint] Iniciando rotina matinal de sincronização...')

    // 1. Obtém chave ativa da API-Football
    var apiKey = ''
    try {
      var cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
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
      return e.json(200, { success: false, error: 'Chave não configurada' })
    }

    // 2. Data no fuso America/Sao_Paulo (UTC-3)
    var dataForcada = (e.requestInfo().query.date || '').trim()
    var dateTarget = ''
    if (dataForcada && /^\d{4}-\d{2}-\d{2}$/.test(dataForcada)) {
      dateTarget = dataForcada
    } else {
      var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
      var ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
      var yd = ('0' + nowSp.getUTCDate()).slice(-2)
      dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd
    }

    console.log('[cron jogos-do-dia endpoint] Data de destino (America/Sao_Paulo): ' + dateTarget)

    // 3. IDs e Nomes Exatos das ligas ativas do Bolão
    var targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    var targetLeagueSet = {}
    for (var lsi = 0; lsi < targetLeagueIds.length; lsi++) {
      targetLeagueSet[targetLeagueIds[lsi]] = true
    }

    var classificarRegiao = function (leagueId, leagueName, countryName) {
      var id = Number(leagueId)
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
        var p = 'Europa'
        if (id === 39 || id === 45 || id === 48) p = 'Inglaterra'
        else if (id === 140 || id === 143) p = 'Espanha'
        else if (id === 135 || id === 137) p = 'Itália'
        else if (id === 78 || id === 81) p = 'Alemanha'
        else if (id === 61 || id === 66) p = 'França'
        return { regiao: 'Futebol Europeu', pais: p }
      }
      return { regiao: 'Outros', pais: countryName || 'Internacional' }
    }

    // 4. Executa UMA chamada à API-Football no endpoint /fixtures?date=...&timezone=America/Sao_Paulo
    var isRapid = apiKey.length > 40
    var url = isRapid
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'
      : 'https://v3.football.api-sports.io/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'

    var hdrs = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    console.log('[cron jogos-do-dia endpoint] Disparando GET ' + url)
    var res = $http.send({
      url: url,
      method: 'GET',
      headers: hdrs,
      timeout: 15,
    })

    if (!res || res.statusCode !== 200 || !res.json) {
      console.log(
        '[cron jogos-do-dia endpoint] Falha na resposta da API-Football. HTTP Status: ' +
          (res ? res.statusCode : 'sem resposta'),
      )
      return e.json(200, { success: false, error: 'HTTP ' + (res ? res.statusCode : 0) })
    }

    var fixturesArray = Array.isArray(res.json.response) ? res.json.response : []
    console.log(
      '[cron jogos-do-dia endpoint] Total de fixtures brutas retornadas no dia: ' +
        fixturesArray.length,
    )

    // 5. Filtra fixtures APENAS para as ligas ativas do bolão
    var jogosFiltrados = []
    for (var fi = 0; fi < fixturesArray.length; fi++) {
      var fixItem = fixturesArray[fi]
      if (!fixItem || !fixItem.fixture || !fixItem.league) continue
      var lId = Number(fixItem.league.id)
      var lName = (fixItem.league.name || '').trim().toLowerCase()
      var lCountry = (fixItem.league.country || '').trim().toLowerCase()

      var ehLigaAtiva = Boolean(targetLeagueSet[lId])
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

    console.log(
      '[cron jogos-do-dia endpoint] Fixtures correspondentes às ligas ativas do bolão: ' +
        jogosFiltrados.length,
    )

    // 6. Gravação/Upsert na collection local `jogos_do_dia`
    var colJogosDoDia = $app.findCollectionByNameOrId('jogos_do_dia')
    var inseridos = 0
    var atualizados = 0

    var extrairHoraSP = function (dateIso) {
      if (!dateIso) return '16:00'
      try {
        var d = new Date(dateIso)
        if (isNaN(d.getTime())) return '16:00'
        var spTime = new Date(d.getTime() - 3 * 3600 * 1000)
        var h = ('0' + spTime.getUTCHours()).slice(-2)
        var m = ('0' + spTime.getUTCMinutes()).slice(-2)
        return h + ':' + m
      } catch (_) {
        return '16:00'
      }
    }

    var extrairScorers = function (events) {
      var scorers = []
      if (!Array.isArray(events)) return scorers
      for (var evi = 0; evi < events.length; evi++) {
        var ev = events[evi]
        if (!ev) continue
        var evType = (ev.type || '').toLowerCase()
        var evDetail = (ev.detail || '').toLowerCase()
        if (evType === 'goal' || evType === 'gol') {
          if (evDetail.indexOf('missed') !== -1) continue
          var pName = (ev.player && (ev.player.name || ev.player.shortName)) || ''
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

    for (var ji = 0; ji < jogosFiltrados.length; ji++) {
      var item = jogosFiltrados[ji]
      var fidStr = String(item.fixture.id)
      var tCasa = (item.teams && item.teams.home && item.teams.home.name) || ''
      var tVis = (item.teams && item.teams.away && item.teams.away.name) || ''
      if (!tCasa || !tVis) continue

      var lInfo = classificarRegiao(item.league.id, item.league.name, item.league.country)
      var rawDate = item.fixture.date || ''
      var horaSP = extrairHoraSP(rawDate)

      var pCasa = item.goals && item.goals.home != null ? item.goals.home : null
      var pVis = item.goals && item.goals.away != null ? item.goals.away : null
      var stShort = (item.fixture.status && item.fixture.status.short) || 'NS'
      var stLong = (item.fixture.status && item.fixture.status.long) || 'Agendado'
      var stElapsed =
        item.fixture.status && item.fixture.status.elapsed != null
          ? item.fixture.status.elapsed
          : null
      var logoCasa = (item.teams && item.teams.home && item.teams.home.logo) || ''
      var logoVis = (item.teams && item.teams.away && item.teams.away.logo) || ''
      var logoCamp = (item.league && item.league.logo) || ''

      if (tCasa.toLowerCase().indexOf('paris') !== -1 || tCasa.toLowerCase() === 'psg') {
        logoCasa = 'https://media.api-sports.io/football/teams/85.png'
      }
      if (tVis.toLowerCase().indexOf('paris') !== -1 || tVis.toLowerCase() === 'psg') {
        logoVis = 'https://media.api-sports.io/football/teams/85.png'
      }

      var scorersList = extrairScorers(item.events)

      var recordToSave = null
      try {
        var existing = $app.findRecordsByFilter(
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
        console.log('[cron jogos-do-dia endpoint] Erro ao salvar jogo ' + fidStr + ':', errSaveRec)
      }
    }

    console.log(
      '[cron jogos-do-dia endpoint] Sincronização matinal concluída. Gravados no banco: ' +
        inseridos +
        ' inseridos, ' +
        atualizados +
        ' atualizados.',
    )
    return e.json(200, {
      success: true,
      data: dateTarget,
      total_retornado: fixturesArray.length,
      total_ligas_ativas: jogosFiltrados.length,
      inseridos: inseridos,
      atualizados: atualizados,
    })
  } catch (errGeral) {
    console.log('[cron jogos-do-dia endpoint] Erro crítico na rotina matinal:', errGeral)
    return e.json(500, {
      success: false,
      error: errGeral ? errGeral.message || String(errGeral) : 'Erro desconhecido',
    })
  }
})

// -------------------------------------------------------------
// Registro do Cron Diário Matinal: 07:00 America/Sao_Paulo (10:00 UTC)
// Expressão: 0 10 * * *
// -------------------------------------------------------------
cronAdd('jogos_do_dia_sync_matinal', '0 10 * * *', () => {
  try {
    console.log('[cron jogos-do-dia] Disparo agendado das 07:00 SP (10:00 UTC)...')

    var apiKey = ''
    try {
      var cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
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

    var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    var ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    var yd = ('0' + nowSp.getUTCDate()).slice(-2)
    var dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

    var targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    var targetLeagueSet = {}
    for (var lsi = 0; lsi < targetLeagueIds.length; lsi++) {
      targetLeagueSet[targetLeagueIds[lsi]] = true
    }

    var classificarRegiao = function (leagueId, leagueName, countryName) {
      var id = Number(leagueId)
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
        var p = 'Europa'
        if (id === 39 || id === 45 || id === 48) p = 'Inglaterra'
        else if (id === 140 || id === 143) p = 'Espanha'
        else if (id === 135 || id === 137) p = 'Itália'
        else if (id === 78 || id === 81) p = 'Alemanha'
        else if (id === 61 || id === 66) p = 'França'
        return { regiao: 'Futebol Europeu', pais: p }
      }
      return { regiao: 'Outros', pais: countryName || 'Internacional' }
    }

    var isRapid = apiKey.length > 40
    var url = isRapid
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'
      : 'https://v3.football.api-sports.io/fixtures?date=' +
        encodeURIComponent(dateTarget) +
        '&timezone=America%2FSao_Paulo'

    var hdrs = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    var res = $http.send({
      url: url,
      method: 'GET',
      headers: hdrs,
      timeout: 15,
    })

    if (!res || res.statusCode !== 200 || !res.json) {
      console.log('[cron jogos-do-dia] Falha na resposta da API-Football no cron.')
      return
    }

    var fixturesArray = Array.isArray(res.json.response) ? res.json.response : []
    var colJogosDoDia = $app.findCollectionByNameOrId('jogos_do_dia')
    var inseridos = 0
    var atualizados = 0

    var extrairHoraSP = function (dateIso) {
      if (!dateIso) return '16:00'
      try {
        var d = new Date(dateIso)
        if (isNaN(d.getTime())) return '16:00'
        var spTime = new Date(d.getTime() - 3 * 3600 * 1000)
        var h = ('0' + spTime.getUTCHours()).slice(-2)
        var m = ('0' + spTime.getUTCMinutes()).slice(-2)
        return h + ':' + m
      } catch (_) {
        return '16:00'
      }
    }

    var extrairScorers = function (events) {
      var scorers = []
      if (!Array.isArray(events)) return scorers
      for (var evi = 0; evi < events.length; evi++) {
        var ev = events[evi]
        if (!ev) continue
        var evType = (ev.type || '').toLowerCase()
        var evDetail = (ev.detail || '').toLowerCase()
        if (evType === 'goal' || evType === 'gol') {
          if (evDetail.indexOf('missed') !== -1) continue
          var pName = (ev.player && (ev.player.name || ev.player.shortName)) || ''
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

    for (var fi = 0; fi < fixturesArray.length; fi++) {
      var fixItem = fixturesArray[fi]
      if (!fixItem || !fixItem.fixture || !fixItem.league) continue
      var lId = Number(fixItem.league.id)
      var lName = (fixItem.league.name || '').trim().toLowerCase()
      var lCountry = (fixItem.league.country || '').trim().toLowerCase()

      var ehLigaAtiva = Boolean(targetLeagueSet[lId])
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

      if (!ehLigaAtiva) continue

      var fidStr = String(fixItem.fixture.id)
      var tCasa = (fixItem.teams && fixItem.teams.home && fixItem.teams.home.name) || ''
      var tVis = (fixItem.teams && fixItem.teams.away && fixItem.teams.away.name) || ''
      if (!tCasa || !tVis) continue

      var lInfo = classificarRegiao(fixItem.league.id, fixItem.league.name, fixItem.league.country)
      var rawDate = fixItem.fixture.date || ''
      var horaSP = extrairHoraSP(rawDate)

      var pCasa = fixItem.goals && fixItem.goals.home != null ? fixItem.goals.home : null
      var pVis = fixItem.goals && fixItem.goals.away != null ? fixItem.goals.away : null
      var stShort = (fixItem.fixture.status && fixItem.fixture.status.short) || 'NS'
      var stLong = (fixItem.fixture.status && fixItem.fixture.status.long) || 'Agendado'
      var stElapsed =
        fixItem.fixture.status && fixItem.fixture.status.elapsed != null
          ? fixItem.fixture.status.elapsed
          : null
      var logoCasa = (fixItem.teams && fixItem.teams.home && fixItem.teams.home.logo) || ''
      var logoVis = (fixItem.teams && fixItem.teams.away && fixItem.teams.away.logo) || ''
      var logoCamp = (fixItem.league && fixItem.league.logo) || ''

      if (tCasa.toLowerCase().indexOf('paris') !== -1 || tCasa.toLowerCase() === 'psg') {
        logoCasa = 'https://media.api-sports.io/football/teams/85.png'
      }
      if (tVis.toLowerCase().indexOf('paris') !== -1 || tVis.toLowerCase() === 'psg') {
        logoVis = 'https://media.api-sports.io/football/teams/85.png'
      }

      var scorersList = extrairScorers(fixItem.events)

      var recordToSave = null
      try {
        var existing = $app.findRecordsByFilter(
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
      recordToSave.set('campeonato', fixItem.league.name || 'Futebol')
      recordToSave.set('campeonato_logo', logoCamp)
      recordToSave.set('league_id', Number(fixItem.league.id) || 0)
      recordToSave.set('round', (fixItem.league && fixItem.league.round) || '')
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
      recordToSave.set('events', fixItem.events || [])
      recordToSave.set('raw_payload', fixItem)

      try {
        $app.save(recordToSave)
      } catch (errSaveRec) {
        console.log('[cron jogos-do-dia] Erro ao salvar jogo:', errSaveRec)
      }
    }

    console.log(
      '[cron jogos-do-dia] Cron matinal concluído com sucesso. Inseridos: ' +
        inseridos +
        ', Atualizados: ' +
        atualizados,
    )
  } catch (errCron) {
    console.log('[cron jogos-do-dia] Erro no cron matinal:', errCron)
  }
})
