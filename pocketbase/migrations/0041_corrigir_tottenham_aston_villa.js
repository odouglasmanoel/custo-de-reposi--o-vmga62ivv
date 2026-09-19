migrate(
  (app) => {
    try {
      const record = app.findRecordById('jogos', '4qd8dfnq2ybs93i')
      if (record) {
        record.set('resultado_finalizado', false)
        record.set('placar_a', 0)
        record.set('placar_b', 0)
        record.set('gols_time_a', [])
        record.set('gols_time_b', [])
        record.set('vencedor_penaltis', '')
        app.save(record)
      }
    } catch (err) {
      console.log('[0041_corrigir_tottenham_aston_villa] Record not found or error:', err)
    }
  },
  (app) => {},
)
