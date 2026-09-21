/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log('[migration 0053] Atualizando chave da API-Football no registro placar_ao_vivo...')

    const NEW_API_KEY = '4ee552e2949d61e70bf1dba7ac616bff'

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
        rec.set('provedor', 'api_football')
      }

      rec.set('provedor', 'api_football')
      rec.set('api_key', NEW_API_KEY)
      rec.set('ativo', true)
      app.save(rec)

      console.log(
        '[migration 0053] Chave da API-Football atualizada com sucesso no banco: 4ee5...6bff',
      )
    } catch (err) {
      console.log('[migration 0053] Erro ao atualizar chave da API-Football:', err)
      throw err
    }

    // Reset de stores e circuit breakers em memória para permitir chamadas imediatas com a nova chave
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__placarAoVivoCacheStore = {}
        globalThis.__jogosDoDiaStore = {}
        globalThis.__apiFootballCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
        globalThis.__apiFootballLineupsCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
        globalThis.__apiFootballDetailsCircuitBreaker = {
          isBlocked: false,
          blockedUntil: 0,
          probing: false,
          reason: '',
        }
        globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 60 * 1000 }
      }
    } catch (_) {}
  },
  (app) => {
    try {
      const rec = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (rec) {
        // Reverter para chave anterior se necessário
        rec.set('api_key', 'ee8eaa8e621d0826842fef79b88fd1f7')
        app.save(rec)
      }
    } catch (_) {}
  },
)
