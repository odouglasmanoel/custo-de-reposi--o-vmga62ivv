migrate(
  (app) => {
    // Set ativo = true for all registered boloes
    const boloes = app.findRecordsByFilter('boloes', '', '', 100, 0)
    for (const b of boloes) {
      b.set('ativo', true)
      app.save(b)
    }
  },
  (app) => {
    // Revert logic
  },
)
