// pocketbase/hooks/admin_vincular_fixtures.js
// Endpoint administrativo para varrer jogos do bolão ativo sem fixture_id,
// cruzando data e nomes dos times para persistir o fixture_id no banco.
// Regras:
// - Apenas admin autenticado (Douglas)
// - Máximo 1 tentativa por jogo por dia (marcado em store interna ou campo auxiliar)
// - Respeita o limitador centralizador e cota diária (api_football_limiter.js)
// - Não crasha e retorna resumo da varredura

routerAdd('POST', '/backend/v1/admin/vincular-fixtures', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Acesso não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Apenas o Administrador pode executar o vínculo de fixtures.')
    }

    const body = e.requestInfo().body || {}
    let bolaoId = (body.bolao_id || '').trim()

    // Se bolaoId não fornecido ou for 'geral', busca o bolão ativo
    if (!bolaoId || bolaoId === 'geral') {
      try {
        const activeBoloes = $app.findRecordsByFilter('boloes', 'ativo = true', '-created', 1, 0)
        if (activeBoloes && activeBoloes.length > 0) {
          bolaoId = activeBoloes[0].id
        }
      } catch (_) {}
    }

    let filterExpr = 'fixture_id = "" || fixture_id = null'
    if (bolaoId && bolaoId !== 'geral') {
      filterExpr = `bolao = '${bolaoId.replace(/'/g, "\\'")}' && (${filterExpr})`
    }

    const jogosSemFixture = $app.findRecordsByFilter('jogos', filterExpr, 'data,hora', 100, 0)

    if (!jogosSemFixture || jogosSemFixture.length === 0) {
      return e.json(200, {
        success: true,
        message: 'Todos os jogos já possuem fixture_id vinculado ou nenhum jogo encontrado.',
        total_verificados: 0,
        vinculados: 0,
        detalhes: [],
      })
    }

    const { buscarFixtureIdNaApi } = require(`${__hooks}/fixtures_matcher.js`)
    const { obterStatusLimiter } = require(`${__hooks}/api_football_limiter.js`)

    const hojeStr = new Date().toISOString().slice(0, 10)
    let vinculadosCount = 0
    let puladosLimiteCount = 0
    let puladosTentativaCount = 0
    const detalhes = []

    for (let i = 0; i < jogosSemFixture.length; i++) {
      const jRec = jogosSemFixture[i]
      const tA = (jRec.getString('time_a') || '').trim()
      const tB = (jRec.getString('time_b') || '').trim()
      const dt = (jRec.getString('data') || '').trim()

      // Limitador: no máximo 1 tentativa por jogo por dia
      const storeKey = `fixture_scan_${jRec.id}_${hojeStr}`
      if ($app.store().get(storeKey) === '1') {
        puladosTentativaCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'ignorado_tentativa_hoje',
        })
        continue
      }

      // Checa se limiter já bloqueou novas chamadas hoje
      const statusLimiter = obterStatusLimiter()
      const bloqueado =
        statusLimiter.blocked ||
        (!statusLimiter.trava_desativada && statusLimiter.count >= statusLimiter.max_limit)
      if (bloqueado) {
        puladosLimiteCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'cota_diaria_esgotada',
        })
        break
      }
      // Marca tentativa diária no store
      $app.store().set(storeKey, '1')

      const foundFid = buscarFixtureIdNaApi(tA, tB, dt)
      if (foundFid) {
        jRec.set('fixture_id', foundFid)
        $app.save(jRec)
        vinculadosCount++
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          fixture_id: foundFid,
          status: 'vinculado_com_sucesso',
        })
      } else {
        detalhes.push({
          jogo_id: jRec.id,
          time_a: tA,
          time_b: tB,
          status: 'nao_encontrado_ou_indisponivel',
        })
      }
    }

    return e.json(200, {
      success: true,
      message: `Varredura concluída. ${vinculadosCount} jogo(s) vinculado(s) com fixture_id.`,
      total_verificados: jogosSemFixture.length,
      vinculados: vinculadosCount,
      pulados_tentativa_hoje: puladosTentativaCount,
      pulados_limite_cota: puladosLimiteCount,
      detalhes: detalhes,
    })
  } catch (err) {
    console.log('[admin_vincular_fixtures] Erro fatal:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao vincular fixtures.',
    })
  }
})
