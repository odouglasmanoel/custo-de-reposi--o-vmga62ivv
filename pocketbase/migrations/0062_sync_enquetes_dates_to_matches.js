migrate(
  (app) => {
    // Alinha os campos data_inicio e data_fim das enquetes
    // para bater com as datas reais calculadas ou com o título
    try {
      const enq = app.findRecordById('enquetes', 'uj08y650k4tt5yu')
      if (enq) {
        enq.set('data_inicio', '2026-09-23')
        enq.set('data_fim', '2026-09-26')
        enq.set('titulo', 'Enquete Copa Coni — 23/09/2026 a 26/09/2026')
        app.save(enq)
      }
    } catch (e) {
      console.log('[migration 0062] Erro ao sincronizar enquete:', e)
    }

    // Varre todas as enquetes e sincroniza data_inicio e data_fim com os jogos reais se houver jogos
    try {
      const enquetes = app.findRecordsByFilter('enquetes', '', 'created', 100, 0)
      for (const enq of enquetes) {
        const jogos = app.findRecordsByFilter(
          'enquete_jogos',
          "enquete = '" + enq.id + "'",
          'data,horario',
          500,
          0,
        )
        if (jogos.length > 0) {
          const dMin = jogos[0].getString('data')
          const dMax = jogos[jogos.length - 1].getString('data')
          if (dMin && dMax) {
            enq.set('data_inicio', dMin)
            enq.set('data_fim', dMax)
            const formatBR = (iso) => {
              if (!iso) return ''
              const parts = iso.split('-')
              if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0]
              return iso
            }
            enq.set('titulo', 'Enquete Copa Coni — ' + formatBR(dMin) + ' a ' + formatBR(dMax))
            app.save(enq)
          }
        }
      }
    } catch (eAll) {
      console.log('[migration 0062] Erro ao atualizar enquetes gerais:', eAll)
    }
  },
  (app) => {},
)
