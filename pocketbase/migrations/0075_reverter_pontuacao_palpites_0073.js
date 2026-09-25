migrate(
  (app) => {
    // Migration 0075: Reverter pontuações indevidamente infladas nos palpites pela 0073,
    // limpar o resíduo de códigos ASCII no detalhamento preservando os contadores de "Placar Exato"
    // e restaurar/garantir os totais oficiais dos participantes no banco de dados.
    try {
      // 1. Reverter palpites inflados pela migração 0073 e limpar resíduos de códigos ASCII no detalhamento
      const allPalpites = app.findRecordsByFilter('palpites', '', '', 5000, 0)
      let palpitesRevertidos = 0
      let detalhamentosLimpos = 0

      for (let i = 0; i < allPalpites.length; i++) {
        const palpite = allPalpites[i]
        let mudou = false

        // Obter detalhamento com tratamento robusto para JSON, array ou bytes
        let rawDet = palpite.get('detalhamento')
        let detalhamento = []

        if (Array.isArray(rawDet)) {
          if (rawDet.length > 0 && typeof rawDet[0] === 'number') {
            try {
              const str = String.fromCharCode.apply(null, rawDet)
              const parsed = JSON.parse(str)
              if (Array.isArray(parsed)) {
                detalhamento = parsed
              }
            } catch (_) {}
          } else {
            detalhamento = rawDet.slice()
          }
        } else {
          const strVal = palpite.getString('detalhamento')
          if (strVal && strVal.trim()) {
            try {
              const parsed = JSON.parse(strVal)
              if (Array.isArray(parsed)) {
                detalhamento = parsed
              }
            } catch (_) {}
          }
        }

        // Detectar se há itens numéricos soltos (resíduo ASCII ex: "91", "34", "80")
        const hasAsciiNoise = detalhamento.some(
          (d) => typeof d === 'number' || (typeof d === 'string' && /^\d{1,3}$/.test(d)),
        )

        if (hasAsciiNoise) {
          const asciiCodes = []
          const cleanItems = []

          for (let k = 0; k < detalhamento.length; k++) {
            const item = detalhamento[k]
            if (typeof item === 'number' || (typeof item === 'string' && /^\d{1,3}$/.test(item))) {
              asciiCodes.push(parseInt(item, 10))
            } else if (typeof item === 'string' && item.trim()) {
              cleanItems.push(item.trim())
            }
          }

          if (asciiCodes.length > 0) {
            try {
              const reconStr = String.fromCharCode.apply(null, asciiCodes)
              const parsed = JSON.parse(reconStr)
              if (Array.isArray(parsed)) {
                for (let m = 0; m < parsed.length; m++) {
                  const pItem = String(parsed[m] || '').trim()
                  if (pItem && !cleanItems.includes(pItem)) {
                    cleanItems.push(pItem)
                  }
                }
              } else if (typeof parsed === 'string' && parsed.trim()) {
                if (!cleanItems.includes(parsed.trim())) {
                  cleanItems.push(parsed.trim())
                }
              }
            } catch (_) {
              const plainStr = String.fromCharCode.apply(null, asciiCodes).trim()
              if (plainStr && !cleanItems.includes(plainStr)) {
                cleanItems.push(plainStr)
              }
            }
          }

          // Garantir que se havia "Placar Exato", ele esteja presente
          const hadExact =
            detalhamento.some((d) => typeof d === 'string' && /placar\s*exato/i.test(d)) ||
            cleanItems.some((d) => /placar\s*exato/i.test(d))

          if (hadExact && !cleanItems.some((d) => /^placar\s*exato$/i.test(d))) {
            cleanItems.unshift('Placar Exato')
          }

          palpite.set('detalhamento', cleanItems)
          mudou = true
          detalhamentosLimpos++
        }

        // Reverter pontuação inflada nos palpites históricos que ganharam +8 indevidamente
        // Exemplos: 16 (8+8) volta para 8; 17 (9+8) volta para 9; 20 (12+8) volta para 12; 15 (7+8) volta para 7
        const currentPts = Number(palpite.get('pontuacao_jogo')) || 0
        if (currentPts >= 15) {
          palpite.set('pontuacao_jogo', currentPts - 8)
          mudou = true
          palpitesRevertidos++
        }

        if (mudou) {
          app.save(palpite)
        }
      }

      console.log(
        '[migration 0075] Palpites ajustados: ' +
          palpitesRevertidos +
          ', detalhamentos limpos: ' +
          detalhamentosLimpos,
      )

      // 2. Garantir e restaurar pontuação oficial de cada participante vinda das planilhas importadas + app
      const participantesConfig = [
        // Douglas: 221 importados, 616 totais
        {
          id: 'i6kaaw12v3l9adh',
          nome: 'Douglas',
          bolao: 'hy6ade9obylh404',
          pontos_importados: 150,
          pontuacao_total: 230,
        },
        {
          id: 'ab3sjd3vctc8l0n',
          nome: 'Douglas',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 61,
          pontuacao_total: 190,
        },
        {
          id: '4vfl6xcy0jj51d4',
          nome: 'Douglas',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 6,
          pontuacao_total: 107,
        },
        {
          id: 'v7idfj7z96dle4k',
          nome: 'Douglas',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 4,
          pontuacao_total: 89,
        },

        // Davi: 209 importados, 749 totais
        {
          id: 'kvgc6c0fwhl0l9p',
          nome: 'Davi',
          bolao: 'hy6ade9obylh404',
          pontos_importados: 142,
          pontuacao_total: 281,
        },
        {
          id: 'umcv669v5mdfe0r',
          nome: 'Davi',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 56,
          pontuacao_total: 215,
        },
        {
          id: '4b44sdmnk0b8mdn',
          nome: 'Davi',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 11,
          pontuacao_total: 124,
        },
        {
          id: '0izs3aqh2jsc9hl',
          nome: 'Davi',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 0,
          pontuacao_total: 129,
        },

        // Gabriel: 179 importados, 639 totais
        {
          id: 'trome8p25i4b75p',
          nome: 'Gabriel',
          bolao: 'hy6ade9obylh404',
          pontos_importados: 118,
          pontuacao_total: 236,
        },
        {
          id: '09yarueqvzdkca0',
          nome: 'Gabriel',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 43,
          pontuacao_total: 170,
        },
        {
          id: '9wnn50qbtu0zd0g',
          nome: 'Gabriel',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 18,
          pontuacao_total: 131,
        },
        {
          id: 'gkecxx8je2gf0d5',
          nome: 'Gabriel',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 0,
          pontuacao_total: 102,
        },

        // Bruno Lopes: 136 importados, 321 totais
        {
          id: 'dqqt8gucvr0jwgg',
          nome: 'Bruno Lopes',
          bolao: 'hy6ade9obylh404',
          pontos_importados: 134,
          pontuacao_total: 213,
        },
        {
          id: 'k2km4ejz4rfz992',
          nome: 'Bruno Lopes',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 0,
          pontuacao_total: 63,
        },
        {
          id: 'c1a3v87mi2v8iiy',
          nome: 'Bruno Lopes',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 2,
          pontuacao_total: 33,
        },
        {
          id: 'z06yes6lfpqajwp',
          nome: 'Bruno Lopes',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 0,
          pontuacao_total: 12,
        },

        // Bruno Xavier: 0 importados, 18 totais
        {
          id: '6uaqe0k861lckyl',
          nome: 'Bruno Xavier',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 0,
          pontuacao_total: 18,
        },
        {
          id: '2tt4qyld3zvxutb',
          nome: 'Bruno Xavier',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 0,
          pontuacao_total: 0,
        },
        {
          id: '5mec2j8sq1fneky',
          nome: 'Bruno Xavier',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 0,
          pontuacao_total: 0,
        },

        // Willian: 0 importados, 6 totais
        {
          id: '9fdrx5dij8dfobg',
          nome: 'Willian',
          bolao: 'kr20rfjisajd6ro',
          pontos_importados: 0,
          pontuacao_total: 6,
        },
        {
          id: 'jj9o0g39qhf285f',
          nome: 'Willian',
          bolao: 'xdtvijyapxuw99y',
          pontos_importados: 0,
          pontuacao_total: 0,
        },
        {
          id: 'qohuqdm775wzvoj',
          nome: 'Willian',
          bolao: 'qdpy2honwivb5zw',
          pontos_importados: 0,
          pontuacao_total: 0,
        },
      ]

      for (let p = 0; p < participantesConfig.length; p++) {
        const conf = participantesConfig[p]
        let rec = null
        try {
          rec = app.findRecordById('participantes', conf.id)
        } catch (_) {
          try {
            const matches = app.findRecordsByFilter(
              'participantes',
              "bolao = '" + conf.bolao + "' && nome = '" + conf.nome + "'",
              '',
              1,
              0,
            )
            if (matches.length > 0) rec = matches[0]
          } catch (_) {}
        }

        if (rec) {
          rec.set('pontos_importados', conf.pontos_importados)
          rec.set('pontuacao_total', conf.pontuacao_total)
          app.save(rec)
        }
      }

      console.log('[migration 0075] Participantes atualizados com pontuação oficial com sucesso.')
    } catch (err) {
      console.log('[migration 0075] Erro ao aplicar migração:', err)
    }
  },
  (app) => {},
)
