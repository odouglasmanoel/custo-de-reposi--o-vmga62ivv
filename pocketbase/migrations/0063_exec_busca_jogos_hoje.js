/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Executar a busca de hoje (efeito real no banco) respeitando limiter e gravando em jogos_do_dia
  // Se houver zero jogos para as ligas ativas, grava a marca '__data_consultada_zero_jogos__'
  try {
    console.log('[migration 0063] Iniciando busca real dos jogos de hoje na API-Football...')

    let apiKey = ''
    try {
      const cfgRec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
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
      console.log('[migration 0063] Chave da API-Football não encontrada.')
      return
    }

    // Obter data de hoje no fuso America/Sao_Paulo (UTC-3)
    const nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    const ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    const yd = ('0' + nowSp.getUTCDate()).slice(-2)
    const dateTarget = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

    console.log('[migration 0063] Data alvo da busca:', dateTarget)

    // Controle de cota do limiter via config_integracoes
    const USAGE_CHAVE = 'api_football_daily_usage'
    let usageRec = null
    try {
      usageRec = app.findFirstRecordByFilter('config_integracoes', "chave = '" + USAGE_CHAVE + "'")
    } catch (_) {}

    let usageData = {
      date_utc: new Date().toISOString().slice(0, 10),
      count: 0,
      max_limit: 15,
      last_reset_utc: new Date().toISOString(),
      last_request_utc: null,
    }

    if (usageRec) {
      try {
        const rawJson = usageRec.getString('api_key')
        if (rawJson) {
          usageData = Object.assign(usageData, JSON.parse(rawJson))
        }
      } catch (_) {}
    }

    const todayUtc = new Date().toISOString().slice(0, 10)
    if (usageData.date_utc !== todayUtc) {
      usageData.date_utc = todayUtc
      usageData.count = 0
    }

    // Trava do limiter (max 15/dia)
    if (usageData.count >= 15) {
      console.log(
        '[migration 0063] Cota diária atingida (' +
          usageData.count +
          '/15). Abortando requisição externa.',
      )
      return
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

    console.log('[migration 0063] Disparando 1 requisição para:', url)
    const res = $http.send({
      url: url,
      method: 'GET',
      headers: hdrs,
      timeout: 15,
    })

    // Incrementa contador de uso no banco
    usageData.count = (Number(usageData.count) || 0) + 1
    usageData.last_request_utc = new Date().toISOString()
    if (!usageRec) {
      try {
        const colCfg = app.findCollectionByNameOrId('config_integracoes')
        usageRec = new Record(colCfg)
        usageRec.set('chave', USAGE_CHAVE)
        usageRec.set('provedor', 'api_football')
        usageRec.set('ativo', true)
      } catch (_) {}
    }
    if (usageRec) {
      usageRec.set('api_key', JSON.stringify(usageData))
      try {
        app.save(usageRec)
      } catch (_) {}
    }

    if (!res || res.statusCode !== 200 || !res.json) {
      console.log(
        '[migration 0063] Falha na resposta HTTP: ' + (res ? res.statusCode : 'sem resposta'),
      )
      return
    }

    const resJson = res.json
    const fixturesArray = Array.isArray(resJson.response) ? resJson.response : []
    console.log('[migration 0063] Total de fixtures retornadas pela API:', fixturesArray.length)

    const targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    const targetLeagueSet = {}
    for (let lsi = 0; lsi < targetLeagueIds.length; lsi++) {
      targetLeagueSet[targetLeagueIds[lsi]] = true
    }

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

    console.log('[migration 0063] Jogos de ligas ativas hoje:', jogosFiltrados.length)

    const colJogosDoDia = app.findCollectionByNameOrId('jogos_do_dia')

    // Se a busca retornar 0 jogos para as ligas ativas, marcar '__data_consultada_zero_jogos__'
    if (jogosFiltrados.length === 0) {
      console.log(
        '[migration 0063] Zero jogos em ligas ativas hoje. Marcando __data_consultada_zero_jogos__ no banco.',
      )
      let recZero = null
      try {
        recZero = app.findFirstRecordByFilter(
          'jogos_do_dia',
          "data = '" + dateTarget + "' && fixture_id = '__data_consultada_zero_jogos__'",
        )
      } catch (_) {}

      if (!recZero) {
        recZero = new Record(colJogosDoDia)
        recZero.set('fixture_id', '__data_consultada_zero_jogos__')
        recZero.set('data', dateTarget)
      }

      recZero.set('campeonato', 'Data Consultada (0 Jogos)')
      recZero.set('time_casa', 'Nenhum')
      recZero.set('time_visitante', 'Nenhum')
      recZero.set('horario', '00:00')
      recZero.set('regiao', 'Outros')
      recZero.set('raw_payload', {
        consultado_em: new Date().toISOString(),
        zero_jogos: true,
        fixtures_total_api: fixturesArray.length,
      })

      app.save(recZero)
      console.log('[migration 0063] Registro __data_consultada_zero_jogos__ salvo com sucesso.')
      return
    }

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
        const existing = app.findRecordsByFilter(
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
        app.save(recordToSave)
      } catch (errSaveRec) {
        console.log('[migration 0063] Erro ao salvar jogo ' + fidStr + ':', errSaveRec)
      }
    }

    console.log(
      `[migration 0063] Concluído com sucesso: ${jogosFiltrados.length} jogos processados (${inseridos} inseridos, ${atualizados} atualizados).`,
    )
  } catch (errGeral) {
    console.log('[migration 0063] Exceção na migração:', errGeral)
  }
})
