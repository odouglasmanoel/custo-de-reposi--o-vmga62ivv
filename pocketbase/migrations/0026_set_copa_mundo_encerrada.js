migrate(
  (app) => {
    // Atualizar Copa do Mundo para ativo = false (Encerrado) de forma idempotente
    try {
      const records = app.findRecordsByFilter('boloes', "nome = 'Copa do Mundo'", '', 1, 0)
      if (records && records.length > 0) {
        const copa = records[0]
        copa.set('ativo', false)
        app.save(copa)
      }
    } catch (err) {
      console.log('Erro ao atualizar Copa do Mundo na migração 0026:', err)
    }
  },
  (app) => {
    try {
      const records = app.findRecordsByFilter('boloes', "nome = 'Copa do Mundo'", '', 1, 0)
      if (records && records.length > 0) {
        const copa = records[0]
        copa.set('ativo', true)
        app.save(copa)
      }
    } catch (_) {}
  },
)
