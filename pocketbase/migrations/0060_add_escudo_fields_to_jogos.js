migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('jogos')

    if (!col.fields.getByName('url_escudo_mandante')) {
      col.fields.add(
        new TextField({
          name: 'url_escudo_mandante',
          required: false,
        }),
      )
    }

    if (!col.fields.getByName('url_escudo_visitante')) {
      col.fields.add(
        new TextField({
          name: 'url_escudo_visitante',
          required: false,
        }),
      )
    }

    app.save(col)

    // Backfill inicial para jogos já cadastrados a partir dos confrontos de enquetes ou jogos do dia
    try {
      const todosJogos = app.findRecordsByFilter('jogos', '1=1', '', 500, 0)
      for (let i = 0; i < todosJogos.length; i++) {
        const j = todosJogos[i]
        let escudoMandante = j.getString('url_escudo_mandante') || ''
        let escudoVisitante = j.getString('url_escudo_visitante') || ''

        if (!escudoMandante || !escudoVisitante) {
          const timeA = j.getString('time_a') || ''
          const timeB = j.getString('time_b') || ''

          // Tenta achar em enquete_jogos
          try {
            const enqMatches = app.findRecordsByFilter(
              'enquete_jogos',
              `time_a = '${timeA.replace(/'/g, "\\'")}' && time_b = '${timeB.replace(/'/g, "\\'")}'`,
              '-created',
              1,
              0,
            )
            if (enqMatches.length > 0) {
              const enq = enqMatches[0]
              if (!escudoMandante) escudoMandante = enq.getString('logo_casa') || ''
              if (!escudoVisitante) escudoVisitante = enq.getString('logo_visitante') || ''
            }
          } catch (_) {}

          // Tenta achar em jogos_do_dia
          if (!escudoMandante || !escudoVisitante) {
            try {
              const jdMatches = app.findRecordsByFilter(
                'jogos_do_dia',
                `time_casa = '${timeA.replace(/'/g, "\\'")}' && time_visitante = '${timeB.replace(/'/g, "\\'")}'`,
                '-created',
                1,
                0,
              )
              if (jdMatches.length > 0) {
                const jd = jdMatches[0]
                if (!escudoMandante) escudoMandante = jd.getString('logo_casa') || ''
                if (!escudoVisitante) escudoVisitante = jd.getString('logo_visitante') || ''
              }
            } catch (_) {}
          }

          let updated = false
          if (escudoMandante && !j.getString('url_escudo_mandante')) {
            j.set('url_escudo_mandante', escudoMandante)
            updated = true
          }
          if (escudoVisitante && !j.getString('url_escudo_visitante')) {
            j.set('url_escudo_visitante', escudoVisitante)
            updated = true
          }
          if (updated) {
            app.save(j)
          }
        }
      }
    } catch (err) {
      console.log('[migration 0060] Aviso ao preencher escudos existentes em jogos:', err)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('jogos')
    if (col.fields.getByName('url_escudo_mandante')) {
      col.fields.removeByName('url_escudo_mandante')
    }
    if (col.fields.getByName('url_escudo_visitante')) {
      col.fields.removeByName('url_escudo_visitante')
    }
    app.save(col)
  },
)
