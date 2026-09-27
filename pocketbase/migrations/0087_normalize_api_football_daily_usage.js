/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0087] Normalizando api_football_daily_usage para active_key: primary...',
    )

    try {
      const col = app.findCollectionByNameOrId('config_integracoes')
      let usageRec = null
      try {
        usageRec = app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'api_football_daily_usage',
        )
      } catch (_) {
        usageRec = new Record(col)
        usageRec.set('chave', 'api_football_daily_usage')
        usageRec.set('provedor', 'api_football')
        usageRec.set('ativo', true)
      }

      const hojeUtc = new Date().toISOString().slice(0, 10)
      let usageData = {
        date_utc: hojeUtc,
        count: 0,
        count_primary: 0,
        count_backup: 0,
        max_limit: 80,
        trava_desativada: true,
        blocked: false,
        active_key: 'primary',
        fallback_active: false,
        primary_exhausted: false,
        backup_exhausted: false,
        last_reset_utc: new Date().toISOString(),
        last_request_utc: null,
      }

      if (usageRec) {
        try {
          const raw = usageRec.getString('api_key')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') {
              usageData = Object.assign(usageData, parsed)
            }
          }
        } catch (_) {}
      }

      // Normalização estrita: Chave primária SEMPRE ativa, sem exaustão e sem fallback legado
      usageData.active_key = 'primary'
      usageData.primary_exhausted = false
      usageData.fallback_active = false
      usageData.backup_exhausted = false
      usageData.blocked = false
      usageData.trava_desativada = true
      usageData.last_reset_utc = new Date().toISOString()

      usageRec.set('api_key', JSON.stringify(usageData))
      usageRec.set('provedor', 'api_football')
      usageRec.set('ativo', true)
      app.save(usageRec)

      console.log(
        '[migration 0087] Registro api_football_daily_usage normalizado com sucesso: active_key=primary, primary_exhausted=false, fallback_active=false.',
      )
    } catch (err) {
      console.error('[migration 0087] Erro ao normalizar api_football_daily_usage:', err)
      throw err
    }
  },
  (app) => {
    // Reverter operação não é necessário pois a normalização é idempotente e de recuperação
  },
)
