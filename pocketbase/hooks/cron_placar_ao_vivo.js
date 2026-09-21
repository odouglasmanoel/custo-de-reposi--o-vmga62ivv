/**
 * Cron Job: Sincronização periódica do Placar ao Vivo a cada 15 minutos.
 *
 * Dispara GET no endpoint público /backend/v1/placar-ao-vivo com a data
 * atual no fuso horário America/Sao_Paulo (UTC-3), garantindo que os jogos
 * e pontuações do bolão sejam atualizados mesmo sem usuários com a aba aberta.
 */
onBootstrap((e) => {
  e.next()
  try {
    console.log('[bootstrap placar-ao-vivo] Instância inicializada e pronta.')

    // =============================================================
    // TESTE IMEDIATO DE REQUISIÇÃO REAL COM A CHAVE ATUALIZADA
    // Header: x-apisports-key
    // 1. GET https://v3.football.api-sports.io/status
    // 2. GET https://v3.football.api-sports.io/fixtures?id=1492382
    // 3. GET https://v3.football.api-sports.io/fixtures?live=all
    // =============================================================
    let currentApiKey = ''
    try {
      const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (cfgRec) {
        currentApiKey = (cfgRec.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!currentApiKey) {
      console.log('[bootstrap placar-ao-vivo] Chave não encontrada no banco.')
      return
    }

    const masked =
      currentApiKey.length > 8 ? currentApiKey.slice(0, 4) + '...' + currentApiKey.slice(-4) : '...'
    console.log(
      '[bootstrap placar-ao-vivo] Iniciando teste de conexão real com a API-Football (chave ' +
        masked +
        ')...',
    )

    const testHeaders = {
      'x-apisports-key': currentApiKey,
    }

    // 1. Teste no endpoint /status
    try {
      console.log(
        '[bootstrap placar-ao-vivo] Disparando GET https://v3.football.api-sports.io/status',
      )
      const resStatus = $http.send({
        url: 'https://v3.football.api-sports.io/status',
        method: 'GET',
        headers: testHeaders,
        timeout: 10,
      })
      console.log(
        '[bootstrap placar-ao-vivo] Resposta /status: HTTP ' +
          (resStatus ? resStatus.statusCode : 'sem resposta'),
      )
      if (resStatus && resStatus.json) {
        console.log(
          '[bootstrap placar-ao-vivo] Detalhes /status: ' + JSON.stringify(resStatus.json),
        )
      }
    } catch (errStatus) {
      console.log('[bootstrap placar-ao-vivo] Erro ao chamar /status:', errStatus)
    }

    // 2. Teste no fixture ativo do bolão (ex: 1492382)
    try {
      console.log(
        '[bootstrap placar-ao-vivo] Disparando GET https://v3.football.api-sports.io/fixtures?id=1492382&timezone=America%2FSao_Paulo',
      )
      const resFixture = $http.send({
        url: 'https://v3.football.api-sports.io/fixtures?id=1492382&timezone=America%2FSao_Paulo',
        method: 'GET',
        headers: testHeaders,
        timeout: 10,
      })
      console.log(
        '[bootstrap placar-ao-vivo] Resposta /fixtures?id=1492382: HTTP ' +
          (resFixture ? resFixture.statusCode : 'sem resposta'),
      )
      if (resFixture && resFixture.json) {
        console.log(
          '[bootstrap placar-ao-vivo] Detalhes /fixtures?id=1492382: ' +
            JSON.stringify(resFixture.json),
        )
      }
    } catch (errFix) {
      console.log('[bootstrap placar-ao-vivo] Erro ao chamar /fixtures?id=1492382:', errFix)
    }

    // 3. Teste no live=all
    try {
      console.log(
        '[bootstrap placar-ao-vivo] Disparando GET https://v3.football.api-sports.io/fixtures?live=all&timezone=America%2FSao_Paulo',
      )
      const resLive = $http.send({
        url: 'https://v3.football.api-sports.io/fixtures?live=all&timezone=America%2FSao_Paulo',
        method: 'GET',
        headers: testHeaders,
        timeout: 10,
      })
      console.log(
        '[bootstrap placar-ao-vivo] Resposta /fixtures?live=all: HTTP ' +
          (resLive ? resLive.statusCode : 'sem resposta'),
      )
      if (resLive && resLive.json) {
        const liveCount = Array.isArray(resLive.json.response) ? resLive.json.response.length : 0
        console.log(
          '[bootstrap placar-ao-vivo] Resposta /fixtures?live=all: ' +
            liveCount +
            ' jogos ao vivo. Erros: ' +
            JSON.stringify(resLive.json.errors || {}),
        )
      }
    } catch (errLive) {
      console.log('[bootstrap placar-ao-vivo] Erro ao chamar /fixtures?live=all:', errLive)
    }
  } catch (errBoot) {
    console.log('[bootstrap placar-ao-vivo] Erro no bootstrap:', errBoot)
  }
})

cronAdd('placar_ao_vivo_sync', '*/10 * * * *', () => {
  try {
    // Dispara também a rotina pré-jogo de escalações
    if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.__sincronizarEscalacoesPreJogo === 'function'
    ) {
      try {
        globalThis.__sincronizarEscalacoesPreJogo()
      } catch (errEscCron) {
        console.log('[cron placar-ao-vivo] rotina pré-jogo de escalações aviso:', errEscCron)
      }
    }

    var siteUrl = ''
    try {
      if ($secrets && $secrets.has && $secrets.has('SITE_URL')) {
        siteUrl = ($secrets.get('SITE_URL') || '').trim()
      }
    } catch (_) {}
    if (!siteUrl) {
      siteUrl = ($os.getenv('SITE_URL') || '').trim()
    }
    if (!siteUrl) {
      siteUrl = ($os.getenv('PB_INSTANCE_URL') || '').trim()
    }
    // Fallback garantido para ambiente interno do PocketBase (execução incondicional)
    if (!siteUrl) {
      siteUrl = 'http://127.0.0.1:8090'
    }

    siteUrl = siteUrl.replace(/\/+$/, '')

    // Data de hoje no fuso America/Sao_Paulo (UTC-3)
    var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    var ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    var yd = ('0' + nowSp.getUTCDate()).slice(-2)
    var todaySp = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

    var targetUrl = siteUrl + '/backend/v1/placar-ao-vivo?date=' + encodeURIComponent(todaySp)

    var res = $http.send({
      url: targetUrl,
      method: 'GET',
      headers: {
        'x-internal-secret': 'skip-cron',
      },
      timeout: 30,
    })

    console.log('[cron placar-ao-vivo] disparo: status ' + (res ? res.statusCode : 0))
  } catch (errCron) {
    console.log(
      '[cron placar-ao-vivo] disparo: erro ao executar sync:',
      errCron ? errCron.message || errCron : errCron,
    )
  }
})
