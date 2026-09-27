/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0085] Testando validação da nova chave na API-Sports e sincronização em lote...',
    )

    const NOVA_CHAVE = 'c751e27823d47d81ff5e52f658755c58'

    // 1. Testa endpoint /status da API-Sports
    try {
      const resStatus = $http.send({
        url: 'https://v3.football.api-sports.io/status',
        method: 'GET',
        headers: {
          'x-apisports-key': NOVA_CHAVE,
        },
        timeout: 12,
      })

      console.log(
        '[migration 0085] Status da API-Sports HTTP code:',
        resStatus ? resStatus.statusCode : 'null',
      )
      console.log('[migration 0085] Body de /status:', resStatus ? resStatus.raw : 'null')

      let resJson = null
      try {
        resJson =
          typeof resStatus.json === 'object' && resStatus.json !== null
            ? resStatus.json
            : JSON.parse(resStatus.raw)
      } catch (_) {}

      // Atualiza api_validada
      if (resStatus && resStatus.statusCode === 200) {
        const col = app.findCollectionByNameOrId('config_integracoes')
        let valRec = null
        try {
          valRec = app.findFirstRecordByData('config_integracoes', 'chave', 'api_validada')
        } catch (_) {
          valRec = new Record(col)
          valRec.set('chave', 'api_validada')
          valRec.set('provedor', 'api_football')
        }
        valRec.set('ativo', true)
        valRec.set(
          'api_key',
          JSON.stringify({
            validada: true,
            timestamp: new Date().toISOString(),
            endpoint_testado: 'https://v3.football.api-sports.io/status',
            status_code: 200,
            account_info: resJson ? resJson.response : null,
          }),
        )
        app.save(valRec)
        console.log('[migration 0085] Registro api_validada atualizado com sucesso!')
      }
    } catch (errStatus) {
      console.log('[migration 0085] Erro ao testar /status:', errStatus)
    }

    // 2. Consulta real de fixture para validar retorno de dados (ex: fixture 1528891)
    try {
      const resFix = $http.send({
        url: 'https://v3.football.api-sports.io/fixtures?id=1528891',
        method: 'GET',
        headers: {
          'x-apisports-key': NOVA_CHAVE,
        },
        timeout: 12,
      })
      console.log(
        '[migration 0085] Teste de fixture 1528891 HTTP code:',
        resFix ? resFix.statusCode : 'null',
      )
      let jFix = null
      try {
        jFix =
          typeof resFix.json === 'object' && resFix.json !== null
            ? resFix.json
            : JSON.parse(resFix.raw)
      } catch (_) {}
      console.log(
        '[migration 0085] Fixture 1528891 results count:',
        jFix && typeof jFix.results === 'number' ? jFix.results : 0,
        'response count:',
        jFix && Array.isArray(jFix.response) ? jFix.response.length : 0,
      )
    } catch (errFix) {
      console.log('[migration 0085] Erro no teste de fixture:', errFix)
    }
  },
  (app) => {},
)
