migrate(
  (app) => {
    // Migration 0073: Reprocessar cravadas exatas em palpites de bolões importados/históricos.
    // Percorre os palpites históricos/importados, compara o placar do palpite com o placar do jogo
    // e, quando iguais, grava 'Placar Exato' no campo detalhamento e garante a pontuação de cravada
    // (8 pontos) somada à pontuação do jogo, sem perder outros acertos (como marcadores ou pênaltis).
    try {
      function extractScore(val) {
        if (val === null || val === undefined) return null
        let str = String(val).trim()
        if (!str) return null
        if (/\d{1,2}\/\d{1,2}/.test(str)) return null
        const pIdx = str.indexOf('(')
        if (pIdx !== -1) {
          str = str.substring(0, pIdx).trim()
        }
        const m = str.match(/^(\d+)\s*(?:x|[-:]|a)\s*(\d+)$/i)
        if (m) {
          return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) }
        }
        return null
      }

      function resolveScore(valA, valB) {
        if (valA !== null && valA !== undefined && valB !== null && valB !== undefined) {
          const numA = Number(valA)
          const numB = Number(valB)
          if (!isNaN(numA) && !isNaN(numB)) {
            return { a: numA, b: numB }
          }
        }
        if (typeof valA === 'string') {
          const p = extractScore(valA)
          if (p) return p
        }
        if (typeof valB === 'string') {
          const p = extractScore(valB)
          if (p) return p
        }
        return null
      }

      // 1. Carregar todos os jogos com placar preenchido em lotes
      const jogosMap = {}
      const jogosList = app.findRecordsByFilter(
        'jogos',
        'placar_a != null && placar_b != null',
        '',
        1500,
        0,
      )
      for (let j = 0; j < jogosList.length; j++) {
        const jRec = jogosList[j]
        const sc = resolveScore(jRec.get('placar_a'), jRec.get('placar_b'))
        if (sc) {
          jogosMap[jRec.id] = sc
        }
      }

      // 2. Carregar todos os palpites existentes
      const palpitesList = app.findRecordsByFilter('palpites', '', '', 3000, 0)
      let cravadasCorrigidas = 0

      for (let i = 0; i < palpitesList.length; i++) {
        const palpite = palpitesList[i]
        const jId = palpite.getString('jogo')
        if (!jId || !jogosMap[jId]) continue

        const jogoScore = jogosMap[jId]
        const palpiteScore = resolveScore(palpite.get('placar_a'), palpite.get('placar_b'))
        if (!palpiteScore) continue

        // Se o placar do palpite é exatamente igual ao do jogo
        if (palpiteScore.a === jogoScore.a && palpiteScore.b === jogoScore.b) {
          let detalhamento = []
          try {
            const rawDet = palpite.get('detalhamento')
            if (Array.isArray(rawDet)) {
              detalhamento = rawDet.slice()
            } else if (typeof rawDet === 'string' && rawDet.trim()) {
              detalhamento = JSON.parse(rawDet)
            }
          } catch (_) {
            detalhamento = []
          }

          const hasExact = detalhamento.some(
            (d) => typeof d === 'string' && /placar\s*exato/i.test(d),
          )

          let mudou = false
          let currentPontos = Number(palpite.get('pontuacao_jogo')) || 0

          if (!hasExact) {
            // Remove menções de pontuação base menor incompatível (Vencedor, Metade, Diferença) se presentes
            // mantendo os marcadores de gols e pênaltis intactos
            const filteredDet = []
            let baseDeduction = 0

            for (let d = 0; d < detalhamento.length; d++) {
              const item = String(detalhamento[d] || '').trim()
              if (!item || item === '-') continue

              // Se o item for puramente descritivo como "Vencedor e Metade do Placar" ou similar
              const isOnlyBase =
                /^(?:vencedor|empate|metade do placar|diferen[cç]a de gols|\s|,|e|-)+$/i.test(item)

              if (isOnlyBase) {
                // Descobre quanto de pontos base menor continha para substituir por 8 da cravada
                if (/vencedor|empate/i.test(item)) baseDeduction += 2
                if (/metade/i.test(item)) baseDeduction += 1
                if (/diferen[cç]a/i.test(item)) baseDeduction += 1
                mudou = true
                continue
              }

              // Se o item contém marcadores junto, ex: "Vencedor, Metade do Placar e gol do Kaio Jorge"
              if (/gol|marcador/i.test(item)) {
                // Limpa os prefixos de vencedor/metade/diferença do texto
                const cleanedScorerText = item
                  .replace(/vencedor nos p[eê]naltis/gi, '__PENALTIS__')
                  .replace(/vencedor/gi, '')
                  .replace(/empate/gi, '')
                  .replace(/metade do placar/gi, '')
                  .replace(/diferen[cç]a de gols/gi, '')
                  .replace(/__PENALTIS__/g, 'Vencedor nos pênaltis')
                  .replace(/^[,\s–-]+|[,\s–-]+$/g, '')
                  .replace(/^\s*e\s+/i, '')
                  .trim()

                if (/vencedor|empate/i.test(item)) baseDeduction += 2
                if (/metade/i.test(item)) baseDeduction += 1
                if (/diferen[cç]a/i.test(item)) baseDeduction += 1

                if (cleanedScorerText) {
                  filteredDet.push(cleanedScorerText)
                }
                mudou = true
                continue
              }

              filteredDet.push(item)
            }

            // Adiciona 'Placar Exato' ao início do detalhamento
            filteredDet.unshift('Placar Exato')
            detalhamento = filteredDet
            mudou = true

            // Garantir que a pontuação total do palpite tenha os 8 pontos de cravada
            const remainingPoints = Math.max(0, currentPontos - baseDeduction)
            const newPontos = 8 + remainingPoints
            if (newPontos !== currentPontos) {
              palpite.set('pontuacao_jogo', newPontos)
              mudou = true
            }
          } else {
            // Já tem Placar Exato no detalhamento: garantir pelo menos 8 pontos
            if (currentPontos < 8) {
              palpite.set('pontuacao_jogo', 8)
              mudou = true
            }
          }

          if (mudou) {
            palpite.set('detalhamento', detalhamento)
            app.save(palpite)
            cravadasCorrigidas++
          }
        }
      }

      console.log(
        '[migration 0073] Reprocessamento concluído com sucesso. Cravadas corrigidas: ' +
          cravadasCorrigidas,
      )
    } catch (err) {
      console.log('[migration 0073] Erro no reprocessamento de cravadas:', err)
    }
  },
  (app) => {
    // Reversão não necessária para reprocessamento de pontuação retroativa
  },
)
