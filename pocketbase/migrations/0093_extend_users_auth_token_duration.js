/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    // Estende a validade do authToken emitido para 30 dias (2.592.000 segundos)
    // Evita expiração precoce da sessão no mobile ou fechamento do navegador
    try {
      if (users.authToken) {
        users.authToken.duration = 30 * 24 * 60 * 60
      } else if (users.options && users.options.authToken) {
        users.options.authToken.duration = 30 * 24 * 60 * 60
      }
      app.save(users)
    } catch (err) {
      console.log('[Migration 0093] Aviso ao ajustar duração do token:', err)
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    try {
      if (users.authToken) {
        users.authToken.duration = 14 * 24 * 60 * 60
      }
      app.save(users)
    } catch (_) {}
  },
)
