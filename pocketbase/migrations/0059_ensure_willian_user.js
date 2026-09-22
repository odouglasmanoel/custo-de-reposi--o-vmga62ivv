migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    try {
      const existing = app.findAuthRecordByEmail('_pb_users_auth_', 'willian@repress.com.br')
      // Usuário já existe, garantir nome Willian
      if (!existing.get('name') || existing.get('name') !== 'Willian') {
        existing.set('name', 'Willian')
        app.save(existing)
      }
    } catch (_) {
      // Cria se não existir
      const record = new Record(users)
      record.setEmail('willian@repress.com.br')
      record.setPassword('Skip@Pass')
      record.setVerified(true)
      record.set('name', 'Willian')
      app.save(record)
    }
  },
  (app) => {
    try {
      const record = app.findAuthRecordByEmail('_pb_users_auth_', 'willian@repress.com.br')
      app.delete(record)
    } catch (_) {}
  },
)
