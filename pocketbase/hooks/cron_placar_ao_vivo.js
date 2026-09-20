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
    var siteUrl = (
      $os.getenv('PB_INSTANCE_URL') ||
      $os.getenv('SITE_URL') ||
      'http://127.0.0.1:8090'
    ).replace(/\/+$/, '')
    var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    var ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    var yd = ('0' + nowSp.getUTCDate()).slice(-2)
    var todaySp = nowSp.getUTCFullYear() + '-' + ym + '-' + yd
    var targetUrl = siteUrl + '/backend/v1/placar-ao-vivo?date=' + encodeURIComponent(todaySp)
    console.log(
      '[bootstrap placar-ao-vivo] Disparando chamada real imediata pós-deploy:',
      targetUrl,
    )
    var res = $http.send({
      url: targetUrl,
      method: 'GET',
      headers: { 'x-internal-secret': 'skip-cron' },
      timeout: 30,
    })
    console.log('[bootstrap placar-ao-vivo] Resposta status: ' + (res ? res.statusCode : 0))
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
