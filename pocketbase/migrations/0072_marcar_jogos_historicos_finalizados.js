migrate(
  (app) => {
    // Marcar resultado_finalizado: true em jogos históricos ou encerrados
    // que possuem placar preenchido ou palpites já pontuados.
    try {
      // 1. Jogos de bolões encerrados (ativo = false), como a Copa do Mundo
      const boloesEncerrados = app.findRecordsByFilter('boloes', 'ativo = false', '', 50, 0)
      for (let b = 0; b < boloesEncerrados.length; b++) {
        const bolao = boloesEncerrados[b]
        const jogosDoBolao = app.findRecordsByFilter(
          'jogos',
          "bolao = '" + bolao.id + "'",
          '',
          500,
          0,
        )
        for (let j = 0; j < jogosDoBolao.length; j++) {
          const jogo = jogosDoBolao[j]
          if (!jogo.getBool('resultado_finalizado')) {
            jogo.set('resultado_finalizado', true)
            app.save(jogo)
          }
        }
      }

      // 2. Jogos que já possuem placar preenchido (placar_a != null e placar_b != null)
      // e que possuem palpites com pontuação atribuída (pontuacao_jogo > 0)
      const palpitesPontuados = app.findRecordsByFilter(
        'palpites',
        'pontuacao_jogo > 0',
        '',
        1000,
        0,
      )
      const jogoIdsFinalizar = {}
      for (let p = 0; p < palpitesPontuados.length; p++) {
        const palpite = palpitesPontuados[p]
        const jId = palpite.getString('jogo')
        if (jId) {
          jogoIdsFinalizar[jId] = true
        }
      }

      const ids = Object.keys(jogoIdsFinalizar)
      for (let k = 0; k < ids.length; k++) {
        try {
          const jRec = app.findRecordById('jogos', ids[k])
          if (jRec && !jRec.getBool('resultado_finalizado')) {
            // Verifica se o jogo tem placar definido
            const pA = jRec.get('placar_a')
            const pB = jRec.get('placar_b')
            if (pA !== null && pA !== undefined && pB !== null && pB !== undefined) {
              jRec.set('resultado_finalizado', true)
              app.save(jRec)
            }
          }
        } catch (_) {}
      }

      console.log(
        '[migration 0072] Jogos históricos marcados com resultado_finalizado: true com sucesso.',
      )
    } catch (err) {
      console.log('[migration 0072] Aviso ao atualizar jogos históricos:', err)
    }
  },
  (app) => {
    // Reversão não necessária para limpeza corretiva de flags de jogos finalizados
  },
)
