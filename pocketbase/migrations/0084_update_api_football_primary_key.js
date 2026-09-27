/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0084] Atualizando chave principal oficial da API-Football no registro placar_ao_vivo...',
    )

    // Chave principal oficial fornecida pelo usuário
    const NOVA_CHAVE_PRINCIPAL = 'c751e27823d47d81ff5e52f658755c58'

    try {
      const colConfig = app.findCollectionByNameOrId('config_integracoes')
      let rec = null
      try {
        rec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      } catch (_) {
        rec = null
      }

      if (!rec) {
        rec = new Record(colConfig)
        rec.set('chave', 'placar_ao_vivo')
      }

      rec.set('provedor', 'api_football')
      rec.set('api_key', NOVA_CHAVE_PRINCIPAL)
      rec.set('ativo', true)
      app.save(rec)

      console.log(
        '[migration 0084] Chave principal atualizada com sucesso em config_integracoes (placar_ao_vivo): c751...5c58',
      )

      // Resetar o estado do uso diário para que a chave principal volte a ser a chave ativa imediatamente
      try {
        let usageRec = null
        try {
          usageRec = app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'api_football_daily_usage',
          )
        } catch (_) {
          usageRec = null
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

          usageData.active_key = 'primary'
          usageData.fallback_active = false
          usageData.primary_exhausted = false
          usageData.blocked = false
          usageData.last_reset_utc = new Date().toISOString()

          usageRec.set('api_key', JSON.stringify(usageData))
          app.save(usageRec)
          console.log(
            '[migration 0084] Registro api_football_daily_usage redefinido para chave principal ativa.',
          )
        }
      } catch (errUsage) {
        console.log('[migration 0084] Aviso ao atualizar registro de uso diário:', errUsage)
      }
    } catch (err) {
      console.log('[migration 0084] Erro ao cadastrar nova chave principal da API-Football:', err)
      throw err
    }
  },
  (app) => {
    // Reverter não apaga para evitar deixar o sistema sem chave
    try {
      const rec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (rec) {
        rec.set('api_key', '4ee552e2949d61e70bf1dba7ac616bff')
        app.save(rec)
      }
    } catch (_) {}
  },
)
