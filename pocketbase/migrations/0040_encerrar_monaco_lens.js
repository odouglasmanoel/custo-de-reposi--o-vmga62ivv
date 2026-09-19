migrate(
  (app) => {
    // PATCH 5: migration idempotente para marcar resultado_finalizado = true
    // nos registros da collection 'jogos' com (time_a ~ 'Monaco' && time_b ~ 'Lens') || (time_a ~ 'Lens' && time_b ~ 'Monaco')
    try {
      const records = app.findRecordsByFilter(
        'jogos',
        "((time_a ~ 'Monaco' && time_b ~ 'Lens') || (time_a ~ 'Lens' && time_b ~ 'Monaco')) && resultado_finalizado = false",
        '',
        100,
        0,
      )

      if (records && records.length > 0) {
        for (const record of records) {
          if (!record.getBool('resultado_finalizado')) {
            record.set('resultado_finalizado', true)
            app.save(record)
          }
        }
      }
    } catch (err) {
      console.log('Erro na migração 0040_encerrar_monaco_lens:', err)
    }
  },
  (app) => {
    // Revert migration (opcional/no-op seguro)
    try {
      const records = app.findRecordsByFilter(
        'jogos',
        "(time_a ~ 'Monaco' && time_b ~ 'Lens') || (time_a ~ 'Lens' && time_b ~ 'Monaco')",
        '',
        100,
        0,
      )
      if (records && records.length > 0) {
        for (const record of records) {
          record.set('resultado_finalizado', false)
          app.save(record)
        }
      }
    } catch (_) {}
  },
)
