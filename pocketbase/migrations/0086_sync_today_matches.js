/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log('[migration 0086] Executando sincronização dos jogos de hoje...')

    const NOVA_CHAVE = 'c751e27823d47d81ff5e52f658755c58'

    // Jogos do dia de hoje (2026-09-26 / 2026-09-27)
    // Buscamos jogos com fixture_id cadastrado
    const fixturesAlvo = ['1528891', '1528892', '1628997', '1528895']

    for (let i = 0; i < fixturesAlvo.length; i++) {
      const fid = fixturesAlvo[i]
      try {
        const url = 'https://v3.football.api-sports.io/fixtures?id=' + fid
        const res = $http.send({
          url: url,
          method: 'GET',
          headers: {
            'x-apisports-key': NOVA_CHAVE,
          },
          timeout: 12,
        })

        if (!res || res.statusCode !== 200) {
          console.log(
            '[migration 0086] Fixture ' + fid + ' status HTTP:',
            res ? res.statusCode : 'null',
          )
          continue
        }

        let json = null
        try {
          json = typeof res.json === 'object' && res.json !== null ? res.json : JSON.parse(res.raw)
        } catch (_) {}

        if (!json || !Array.isArray(json.response) || json.response.length === 0) {
          console.log('[migration 0086] Fixture ' + fid + ' sem response no JSON.')
          continue
        }

        const fixData = json.response[0]
        const statusInfo = fixData.fixture?.status || {}
        const statusShort = (statusInfo.short || '').toString().toUpperCase().trim()
        const goals = fixData.goals || {}
        const score = fixData.score || {}

        let rawHome = goals.home !== null && goals.home !== undefined ? goals.home : null
        let rawAway = goals.away !== null && goals.away !== undefined ? goals.away : null
        if (rawHome === null && score.fulltime && score.fulltime.home !== null) {
          rawHome = score.fulltime.home
        }
        if (rawAway === null && score.fulltime && score.fulltime.away !== null) {
          rawAway = score.fulltime.away
        }

        const homeGoals =
          rawHome !== null && !isNaN(parseInt(rawHome, 10)) ? parseInt(rawHome, 10) : null
        const awayGoals =
          rawAway !== null && !isNaN(parseInt(rawAway, 10)) ? parseInt(rawAway, 10) : null

        const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(statusShort)
        const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)
        const isNotStarted = ['NS', 'TBD', ''].includes(statusShort)

        const homeTeamLogo = (fixData.teams?.home?.logo || '').toString().trim()
        const awayTeamLogo = (fixData.teams?.away?.logo || '').toString().trim()

        // Buscar jogos no banco com esse fixture_id
        const matchingJogos = app.findRecordsByFilter(
          'jogos',
          "fixture_id = '" + fid + "'",
          '',
          10,
          0,
        )
        console.log(
          '[migration 0086] Fixture ' +
            fid +
            ' encontrada na API (status: ' +
            statusShort +
            '), atualizando ' +
            matchingJogos.length +
            ' jogos no banco...',
        )

        for (let j = 0; j < matchingJogos.length; j++) {
          const jRec = matchingJogos[j]

          if (homeTeamLogo) jRec.set('url_escudo_mandante', homeTeamLogo)
          if (awayTeamLogo) jRec.set('url_escudo_visitante', awayTeamLogo)

          if (isFinished) {
            jRec.set('status', 'finalizado')
            jRec.set('resultado_finalizado', true)
            if (homeGoals !== null) jRec.set('placar_a', homeGoals)
            if (awayGoals !== null) jRec.set('placar_b', awayGoals)
          } else if (isLive) {
            jRec.set('status', 'ao_vivo')
            jRec.set('resultado_finalizado', false)
            if (homeGoals !== null) jRec.set('placar_a', homeGoals)
            if (awayGoals !== null) jRec.set('placar_b', awayGoals)
          } else if (isNotStarted) {
            // Mantém pendente, não marca como ao vivo nem grava 0x0
            const curSt = (jRec.getString('status') || '').toLowerCase().trim()
            if (curSt === 'ao_vivo') {
              jRec.set('status', 'pendente')
            }
            jRec.set('resultado_finalizado', false)
          }

          app.save(jRec)
        }
      } catch (errLoop) {
        console.log('[migration 0086] Erro ao sincronizar fixture ' + fid + ':', errLoop)
      }
    }
  },
  (app) => {},
)
