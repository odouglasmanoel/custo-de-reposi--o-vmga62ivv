migrate(
  (app) => {
    try {
      const record = app.findFirstRecordByData('palpites', 'id', 'tx82pp3f7f7wb57')
      const currentA = record.get('goleadores_a')
      // Atualiza para o formato estruturado que o modal do Admin salva
      record.set('goleadores_a', [
        {
          nome: 'Cristian Romero',
          quantidade: 1,
          posicao: 'Defensor',
          gol_contra: false,
        },
      ])
      app.save(record)
    } catch (err) {
      console.log('0043_standardize_romero_scorer error:', err)
    }
  },
  (app) => {
    try {
      const record = app.findFirstRecordByData('palpites', 'id', 'tx82pp3f7f7wb57')
      record.set('goleadores_a', ['Cristian Romero'])
      app.save(record)
    } catch (_) {}
  },
)
