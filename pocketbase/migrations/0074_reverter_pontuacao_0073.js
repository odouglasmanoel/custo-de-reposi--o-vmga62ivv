migrate(
  (app) => {
    // Migration 0074: Reverter pontuações alteradas indevidamente pela migração 0073
    // e restaurar os detalhamentos originais das planilhas importadas,
    // preservando a pontuação oficial das planilhas intocável.
    try {
      const recordsToFix = app.findRecordsByFilter(
        'palpites',
        "detalhamento ~ '91' || detalhamento ~ 'Placar Exato'",
        '',
        3000,
        0,
      )

      let revertidos = 0
      for (let i = 0; i < recordsToFix.length; i++) {
        const palpite = recordsToFix[i]
        const rawDet = palpite.get('detalhamento')
        let detalhamento = []
        try {
          if (Array.isArray(rawDet)) {
            detalhamento = rawDet.slice()
          } else if (typeof rawDet === 'string' && rawDet.trim()) {
            detalhamento = JSON.parse(rawDet)
          }
        } catch (_) {
          detalhamento = []
        }

        // Verifica se há resíduo numérico de split de string como "91", "34", "80", etc.
        const hasAsciiNoise = detalhamento.some((d) => typeof d === 'string' && /^\d{1,3}$/.test(d))

        if (hasAsciiNoise) {
          // Reconstruir o texto original a partir dos códigos ASCII ou limpar
          let reconstructed = ''
          try {
            const numbers = detalhamento
              .filter((d) => typeof d === 'string' && /^\d{1,3}$/.test(d))
              .map((n) => parseInt(n, 10))
            if (numbers.length > 0) {
              const rawStr = String.fromCharCode.apply(null, numbers)
              // rawStr é um JSON stringify de array, ex: '["Placar Exato e vencedor"]'
              try {
                const parsed = JSON.parse(rawStr)
                if (Array.isArray(parsed) && parsed.length > 0) {
                  reconstructed = parsed
                }
              } catch (_) {
                if (rawStr.startsWith('[') && rawStr.endsWith(']')) {
                  reconstructed = [rawStr.slice(1, -1).replace(/^"|"$/g, '')]
                } else {
                  reconstructed = [rawStr]
                }
              }
            }
          } catch (_) {}

          let finalDet = []
          if (Array.isArray(reconstructed) && reconstructed.length > 0) {
            finalDet = reconstructed
          } else {
            // Remove os itens puramente numéricos
            finalDet = detalhamento.filter((d) => typeof d === 'string' && !/^\d{1,3}$/.test(d))
          }

          palpite.set('detalhamento', finalDet)

          // Subtrai os 8 pontos extras se a pontuação estava inflada em +8 ou recalculada
          // Mas mais confiavelmente: reverter os 8 pontos adicionados pela 0073
          const currentPts = Number(palpite.get('pontuacao_jogo')) || 0
          if (currentPts >= 8) {
            // Se foi adicionado 8 pontos de cravada em cima de pontuação existente (ex: 8 + 8 = 16)
            // Se currentPts === 16 (8 de cravada + 8 da base), volta para 8
            // Se currentPts === 17 (8 + 9), volta para 9
            // Se currentPts === 18 (8 + 10), volta para 10
            // Se currentPts === 19 (8 + 11), volta para 11
            // Se currentPts === 20 (8 + 12), volta para 12
            // Se currentPts === 15 (8 + 7), volta para 7
            if (currentPts >= 15) {
              palpite.set('pontuacao_jogo', currentPts - 8)
            }
          }

          app.save(palpite)
          revertidos++
        }
      }

      console.log(
        '[migration 0074] Reversão de palpites concluída com sucesso. Palpites corrigidos: ' +
          revertidos,
      )

      // Recalcular pontuacao_total dos participantes baseado nos palpites ajustados + pontos_importados
      const participantes = app.findRecordsByFilter('participantes', '', '', 500, 0)
      for (let p = 0; p < participantes.length; p++) {
        const part = participantes[p]
        const bolaoId = part.getString('bolao')
        const partPalpites = app.findRecordsByFilter(
          'palpites',
          "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
          '',
          1000,
          0,
        )

        let sumPalpites = 0
        for (let k = 0; k < partPalpites.length; k++) {
          const pal = partPalpites[k]
          const jId = pal.getString('jogo')
          try {
            const jRec = app.findRecordById('jogos', jId)
            if (jRec && jRec.getBool('resultado_finalizado')) {
              sumPalpites += Number(pal.get('pontuacao_jogo')) || 0
            }
          } catch (_) {}
        }

        const imp = Number(part.get('pontos_importados')) || 0
        part.set('pontuacao_total', imp + sumPalpites)
        app.save(part)
      }

      console.log('[migration 0074] pontuacao_total dos participantes atualizada.')
    } catch (err) {
      console.log('[migration 0074] Erro na reversão:', err)
    }
  },
  (app) => {},
)
