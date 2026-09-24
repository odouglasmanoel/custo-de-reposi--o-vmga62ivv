// pocketbase/migrations/0067_reset_and_raise_api_limit.js
// Migração para resetar o contador diário da API-Football e elevar o limite interno de 15 para 80 req/dia.
migrate(
  (app) => {
    try {
      const rec = app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'api_football_daily_usage',
      )
      const hojeUtc = new Date().toISOString().slice(0, 10)
      const novoPayload = {
        date_utc: hojeUtc,
        count: 0,
        max_limit: 80,
        trava_desativada: false,
        blocked: false,
        last_reset_utc: new Date().toISOString(),
        last_request_utc: null,
      }
      rec.set('api_key', JSON.stringify(novoPayload))
      rec.set('ativo', true)
      rec.set('provedor', 'api_football')
      app.save(rec)
      console.log(
        '[Migration 0067] Contador diário da API resetado para 0 e limite atualizado para 80 com sucesso!',
      )
    } catch (e) {
      // Se ainda não existir, cria o registro
      try {
        const col = app.findCollectionByNameOrId('config_integracoes')
        const newRec = new Record(col)
        newRec.set('chave', 'api_football_daily_usage')
        newRec.set('provedor', 'api_football')
        newRec.set('ativo', true)
        const hojeUtc = new Date().toISOString().slice(0, 10)
        newRec.set(
          'api_key',
          JSON.stringify({
            date_utc: hojeUtc,
            count: 0,
            max_limit: 80,
            trava_desativada: false,
            blocked: false,
            last_reset_utc: new Date().toISOString(),
            last_request_utc: null,
          }),
        )
        app.save(newRec)
        console.log('[Migration 0067] Registro de uso criado com count=0 e max_limit=80.')
      } catch (errCreate) {
        console.log('[Migration 0067] Erro ao criar registro:', errCreate)
      }
    }
  },
  (app) => {
    // Reverter não é estritamente necessário para dados de contador
  },
)
