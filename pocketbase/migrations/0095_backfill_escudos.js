/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log('[migration 0095] Iniciando backfill de escudos dos times...')

    // 1. Atualização prioritária e garantida do confronto Botafogo x Vasco (registro bcvlbbjtycwywts)
    const TARGET_RECORD_ID = 'bcvlbbjtycwywts'
    const BOTAFOGO_LOGO = 'https://media.api-sports.io/football/teams/120.png'
    const VASCO_LOGO = 'https://media.api-sports.io/football/teams/133.png'

    try {
      const jogoAlvo = app.findRecordById('jogos', TARGET_RECORD_ID)
      if (jogoAlvo) {
        console.log(
          '[migration 0095] Registro alvo bcvlbbjtycwywts encontrado. Atualizando escudos...',
        )
        jogoAlvo.set('url_escudo_mandante', BOTAFOGO_LOGO)
        jogoAlvo.set('url_escudo_visitante', VASCO_LOGO)
        if (!jogoAlvo.getString('fixture_id')) {
          jogoAlvo.set('fixture_id', '2398472')
        }
        app.save(jogoAlvo)
        console.log('[migration 0095] Registro bcvlbbjtycwywts atualizado com sucesso!')
      }
    } catch (errAlvo) {
      console.log(
        '[migration 0095] Registro bcvlbbjtycwywts não encontrado por ID, procurando por fixture 2398472 ou nomes:',
        errAlvo,
      )
      try {
        const jogosPorFixture = app.findRecordsByFilter(
          'jogos',
          "fixture_id = '2398472' || (time_a ~ 'Botafogo' && time_b ~ 'Vasco')",
          '',
          10,
          0,
        )
        for (let i = 0; i < jogosPorFixture.length; i++) {
          const rec = jogosPorFixture[i]
          rec.set('url_escudo_mandante', BOTAFOGO_LOGO)
          rec.set('url_escudo_visitante', VASCO_LOGO)
          if (!rec.getString('fixture_id')) {
            rec.set('fixture_id', '2398472')
          }
          app.save(rec)
          console.log(
            '[migration 0095] Registro de Botafogo x Vasco atualizado via filtro ID=' + rec.id,
          )
        }
      } catch (errFiltro) {
        console.log('[migration 0095] Erro ao buscar Botafogo x Vasco por filtro:', errFiltro)
      }
    }

    // 2. Backfill para todos os demais jogos da collection jogos com fixture_id preenchido e campos vazios
    let apiKey = ''
    try {
      const cfgRec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
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

    if (!apiKey) {
      apiKey = 'c751e27823d47d81ff5e52f658755c58'
    }

    try {
      const jogosSemEscudo = app.findRecordsByFilter(
        'jogos',
        "fixture_id != '' && (url_escudo_mandante = '' || url_escudo_visitante = '')",
        '',
        100,
        0,
      )

      console.log(
        '[migration 0095] Encontrados ' +
          jogosSemEscudo.length +
          ' jogos com fixture_id e escudo(s) em branco para backfill.',
      )

      for (let j = 0; j < jogosSemEscudo.length; j++) {
        const jRec = jogosSemEscudo[j]
        const fid = (jRec.getString('fixture_id') || '').trim()
        if (!fid) continue

        const timeA = jRec.getString('time_a') || ''
        const timeB = jRec.getString('time_b') || ''
        if (
          timeA.toLowerCase().indexOf('botafogo') >= 0 &&
          !jRec.getString('url_escudo_mandante')
        ) {
          jRec.set('url_escudo_mandante', BOTAFOGO_LOGO)
        }
        if (timeB.toLowerCase().indexOf('vasco') >= 0 && !jRec.getString('url_escudo_visitante')) {
          jRec.set('url_escudo_visitante', VASCO_LOGO)
        }

        const curM = (jRec.getString('url_escudo_mandante') || '').trim()
        const curV = (jRec.getString('url_escudo_visitante') || '').trim()
        if (curM && curV) {
          app.save(jRec)
          continue
        }

        // Tenta buscar via API-Football
        try {
          const isRapid = apiKey.length > 40
          const urlFixture = isRapid
            ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures?id=' + encodeURIComponent(fid)
            : 'https://v3.football.api-sports.io/fixtures?id=' + encodeURIComponent(fid)
          const headers = isRapid
            ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
            : { 'x-apisports-key': apiKey }

          const resFix = $http.send({
            url: urlFixture,
            method: 'GET',
            headers: headers,
            timeout: 8,
          })

          if (resFix && resFix.statusCode === 200) {
            let json = null
            try {
              json =
                typeof resFix.json === 'object' && resFix.json !== null
                  ? resFix.json
                  : JSON.parse(resFix.raw)
            } catch (_) {}

            if (json && Array.isArray(json.response) && json.response.length > 0) {
              const fItem = json.response[0]
              const hLogo = (fItem.teams && fItem.teams.home && fItem.teams.home.logo) || ''
              const aLogo = (fItem.teams && fItem.teams.away && fItem.teams.away.logo) || ''

              if (!curM && hLogo) {
                jRec.set('url_escudo_mandante', hLogo)
              }
              if (!curV && aLogo) {
                jRec.set('url_escudo_visitante', aLogo)
              }
              app.save(jRec)
              console.log(
                '[migration 0095] Fixture ' +
                  fid +
                  ' consultada na API. Escudos salvos no jogo ' +
                  jRec.id,
              )
            }
          }
        } catch (errReq) {
          console.log(
            '[migration 0095] Chamada externa para fixture ' +
              fid +
              ' falhou, pulando jogo ' +
              jRec.id +
              ':',
            errReq,
          )
        }
      }
    } catch (errGeral) {
      console.log('[migration 0095] Erro ao varrer jogos para backfill de escudos:', errGeral)
    }

    console.log('[migration 0095] Concluído backfill de escudos!')
  },
  (app) => {},
)
