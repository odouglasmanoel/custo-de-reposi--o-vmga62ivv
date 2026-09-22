/**
 * pocketbase/hooks/cron_placar_ao_vivo.js
 * Sincronização periódica do Placar ao Vivo do Bolão a cada 10 minutos.
 *
 * REGRAS APROVADAS CONTRA ESTOURO DE COTA:
 * 1. ZERO chamadas externas no onBootstrap (eliminadas todas as 3 chamadas /status, /fixtures?id, /live=all).
 * 2. Todas as chamadas roteadas pelo limitador estrito api_football_limiter (Prioridade 1 = placar ao vivo).
 * 3. Se não houver jogos em andamento ou próximos hoje, evita chamadas redundantes.
 */

onBootstrap((e) => {
  e.next()
  console.log(
    '[bootstrap placar-ao-vivo] Instância inicializada e pronta. (Chamadas externas suprimidas no boot para preservar cota diária).',
  )
})

cronAdd('placar_ao_vivo_sync', '*/10 * * * *', () => {
  try {
    // 1. Aciona rotina consolidada de escalações pré-jogo (janela 60 min, apenas se houver jogos pendentes)
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

    let siteUrl = ''
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
    if (!siteUrl) {
      siteUrl = 'http://127.0.0.1:8090'
    }

    siteUrl = siteUrl.replace(/\/+$/, '')

    // Data de hoje no fuso America/Sao_Paulo (UTC-3)
    const nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    const ym = ('0' + (nowSp.getUTCMonth() + 1)).slice(-2)
    const yd = ('0' + nowSp.getUTCDate()).slice(-2)
    const todaySp = nowSp.getUTCFullYear() + '-' + ym + '-' + yd

    const targetUrl = siteUrl + '/backend/v1/placar-ao-vivo?date=' + encodeURIComponent(todaySp)

    const res = $http.send({
      url: targetUrl,
      method: 'GET',
      headers: {
        'x-internal-secret': 'skip-cron',
      },
      timeout: 30,
    })

    console.log('[cron placar-ao-vivo] disparo sync 10min: status ' + (res ? res.statusCode : 0))
  } catch (errCron) {
    console.log(
      '[cron placar-ao-vivo] disparo: erro ao executar sync:',
      errCron ? errCron.message || errCron : errCron,
    )
  }
})
