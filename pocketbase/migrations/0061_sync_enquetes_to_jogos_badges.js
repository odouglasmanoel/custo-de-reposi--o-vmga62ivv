migrate(
  (app) => {
    // Sincroniza escudos de enquete_jogos para jogos onde os nomes dos times coincidem
    try {
      const enqJogos = app.findRecordsByFilter(
        'enquete_jogos',
        'cadastrado_bolao = true',
        '',
        200,
        0,
      )
      for (let i = 0; i < enqJogos.length; i++) {
        const ej = enqJogos[i]
        const tA = ej.getString('time_a') || ''
        const tB = ej.getString('time_b') || ''
        const logoA = ej.getString('logo_casa') || ''
        const logoB = ej.getString('logo_visitante') || ''

        if (tA && tB && (logoA || logoB)) {
          const matchingJogos = app.findRecordsByFilter(
            'jogos',
            `time_a = '${tA.replace(/'/g, "\\'")}' && time_b = '${tB.replace(/'/g, "\\'")}'`,
            '',
            10,
            0,
          )
          for (let j = 0; j < matchingJogos.length; j++) {
            const mj = matchingJogos[j]
            let mudou = false
            if (logoA && mj.getString('url_escudo_mandante') !== logoA) {
              mj.set('url_escudo_mandante', logoA)
              mudou = true
            }
            if (logoB && mj.getString('url_escudo_visitante') !== logoB) {
              mj.set('url_escudo_visitante', logoB)
              mudou = true
            }
            if (mudou) {
              app.save(mj)
            }
          }
        }
      }
    } catch (err) {
      console.log('[migration 0061] Aviso ao sincronizar escudos:', err)
    }
  },
  (app) => {},
)
