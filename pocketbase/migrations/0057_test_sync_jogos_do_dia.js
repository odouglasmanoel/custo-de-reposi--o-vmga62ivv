/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Disparo inline único na migração para validar e pré-popular jogos_do_dia imediatamente
  try {
    console.log('[migration 0057] Executando sincronização inicial de jogos_do_dia...')
    var cfgRec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    var apiKey = cfgRec && cfgRec.getBool('ativo') ? (cfgRec.getString('api_key') || '').trim() : ''

    if (!apiKey) {
      console.log('[migration 0057] Sem chave de API')
      return
    }

    // Data de hoje fuso SP (UTC-3)
    var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    var ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    var yd = ('0' + nowSp.getUTCDate()).slice(-2)
    var dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

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
      console.log('[migration 0057] Falha HTTP: ' + (res ? res.statusCode : 'none'))
      return
    }

    var fixturesArray = Array.isArray(res.json.response) ? res.json.response : []
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

    var colJogosDoDia = app.findCollectionByNameOrId('jogos_do_dia')
    var inseridos = 0

    for (var fi = 0; fi < fixturesArray.length; fi++) {
      var fixItem = fixturesArray[fi]
      if (!fixItem || !fixItem.fixture || !fixItem.league) continue
      var lId = Number(fixItem.league.id)
      var lName = fixItem.league.name || ''

      var ehLigaAtiva = Boolean(targetLeagueSet[lId])
      if (!ehLigaAtiva) {
        var lLower = lName.toLowerCase()
        if (
          lLower.indexOf('brasileir') !== -1 ||
          lLower.indexOf('copa do brasil') !== -1 ||
          lLower.indexOf('libertadores') !== -1 ||
          lLower.indexOf('sudamericana') !== -1 ||
          lLower.indexOf('champions league') !== -1 ||
          lLower.indexOf('premier league') !== -1 ||
          lLower.indexOf('la liga') !== -1 ||
          lLower.indexOf('serie a') !== -1 ||
          lLower.indexOf('bundesliga') !== -1 ||
          lLower.indexOf('ligue 1') !== -1
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

      var recordToSave = new Record(colJogosDoDia)
      recordToSave.set('fixture_id', fidStr)
      recordToSave.set('data', dateTarget)
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
        app.save(recordToSave)
        inseridos++
      } catch (errRec) {
        console.log('[migration 0057] Erro ao salvar: ' + errRec)
      }
    }

    console.log(
      '[migration 0057] Sincronização de teste concluída. Jogos salvos na collection jogos_do_dia: ' +
        inseridos,
    )
  } catch (errAll) {
    console.log('[migration 0057] Erro geral: ' + errAll)
  }
})
