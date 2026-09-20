migrate(
  (app) => {
    // 1. Remover registros de contingência/fallback da config_integracoes (football_data e thesportsdb)
    try {
      const fbRec = app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fbRec) {
        app.delete(fbRec)
        console.log('[migration 0050] Registro football_data_fallback removido.')
      }
    } catch (_) {}

    try {
      const tsdbRec = app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'thesportsdb_fallback',
      )
      if (tsdbRec) {
        app.delete(tsdbRec)
        console.log('[migration 0050] Registro thesportsdb_fallback removido.')
      }
    } catch (_) {}

    // 2. Garantir que o registro placar_ao_vivo utilize estritamente api_football
    try {
      const mainRec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (mainRec) {
        mainRec.set('provedor', 'api_football')
        mainRec.set('ativo', true)
        app.save(mainRec)
        console.log('[migration 0050] placar_ao_vivo configurado para api_football.')
      }
    } catch (errMain) {
      console.log('[migration 0050] Aviso ao atualizar placar_ao_vivo:', errMain)
    }

    // 3. Atualizar a collection config_integracoes para restringir provedor para apenas ['api_football']
    try {
      const col = app.findCollectionByNameOrId('config_integracoes')
      if (col) {
        const provedorField = col.fields.getByName('provedor')
        if (provedorField) {
          provedorField.values = ['api_football']
        }
        app.save(col)
        console.log('[migration 0050] Campo provedor restrito para api_football.')
      }
    } catch (errCol) {
      console.log('[migration 0050] Aviso ao atualizar schema de config_integracoes:', errCol)
    }
  },
  (app) => {
    // Reversão
    try {
      const col = app.findCollectionByNameOrId('config_integracoes')
      if (col) {
        const provedorField = col.fields.getByName('provedor')
        if (provedorField) {
          provedorField.values = ['football_data', 'thesportsdb', 'api_football']
        }
        app.save(col)
      }
    } catch (_) {}
  },
)
