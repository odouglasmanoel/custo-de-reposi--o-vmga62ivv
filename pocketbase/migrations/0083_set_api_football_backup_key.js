/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0083] Configurando chave secundária de backup da API-Football no registro placar_ao_vivo_backup...',
    )

    const BACKUP_API_KEY = '8664f83267c4de6554592d63de4120ab'

    try {
      const colConfig = app.findCollectionByNameOrId('config_integracoes')
      let rec = null
      try {
        rec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo_backup')
      } catch (_) {
        rec = null
      }

      if (!rec) {
        rec = new Record(colConfig)
        rec.set('chave', 'placar_ao_vivo_backup')
        rec.set('provedor', 'api_football')
      }

      rec.set('provedor', 'api_football')
      rec.set('api_key', BACKUP_API_KEY)
      rec.set('ativo', true)
      app.save(rec)

      console.log(
        '[migration 0083] Chave secundária da API-Football salva com sucesso em config_integracoes (placar_ao_vivo_backup): 8664...0ab',
      )
    } catch (err) {
      console.log('[migration 0083] Erro ao cadastrar chave secundária da API-Football:', err)
      throw err
    }
  },
  (app) => {
    try {
      const rec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo_backup')
      if (rec) {
        app.delete(rec)
      }
    } catch (_) {}
  },
)
