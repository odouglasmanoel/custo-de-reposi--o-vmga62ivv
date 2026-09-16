migrate(
  (app) => {
    // Recálculo idempotente da pontuação dos jogos finalizados com o algoritmo corrigido de goleadores.
    try {
      const parseJsonField = (rec, fieldName) => {
        try {
          const raw = rec.get(fieldName)
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
            const str = String.fromCharCode.apply(null, raw)
            const parsed = JSON.parse(str)
            if (Array.isArray(parsed)) return parsed
          }
          if (Array.isArray(raw)) return raw
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            const parsed = JSON.parse(strVal)
            if (Array.isArray(parsed)) return parsed
          }
        } catch (_) {}
        try {
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            return strVal
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          }
        } catch (_) {}
        return []
      }

      const stripAccents = (str) => {
        if (!str) return ''
        let s = String(str)
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        return s
          .replace(/[áàâãä]/gi, 'a')
          .replace(/[éèêë]/gi, 'e')
          .replace(/[íìîï]/gi, 'i')
          .replace(/[óòôõö]/gi, 'o')
          .replace(/[úùûü]/gi, 'u')
          .replace(/[ç]/gi, 'c')
          .replace(/[ñ]/gi, 'n')
      }

      const finishedGames = app.findRecordsByFilter(
        'jogos',
        'resultado_finalizado = true',
        '',
        100,
        0,
      )

      for (const jogo of finishedGames) {
        const jogoId = jogo.id
        const bolaoId = jogo.getString('bolao')
        const placarRealA = jogo.getInt('placar_a')
        const placarRealB = jogo.getInt('placar_b')
        const temPenaltis = jogo.getBool('tem_penaltis')
        const vencedorPenaltisReal = (jogo.getString('vencedor_penaltis') || '')
          .toUpperCase()
          .trim()

        const normalizacoes = app.findRecordsByFilter(
          'normalizacoes',
          `bolao = '${bolaoId}'`,
          '',
          500,
          0,
        )
        const normMap = {}
        for (const n of normalizacoes) {
          const orig = stripAccents(n.getString('nome_original') || '')
            .toLowerCase()
            .trim()
          const corr = stripAccents(n.getString('nome_correto') || '')
            .toLowerCase()
            .trim()
          if (orig && corr) normMap[orig] = corr
        }

        const normalizePlayerName = (name) => {
          if (!name) return ''
          let clean = stripAccents(String(name).toLowerCase().trim())
          if (normMap[clean]) clean = stripAccents(normMap[clean])
          return clean
        }

        const getWinner = (a, b) => {
          if (a > b) return 1
          if (b > a) return -1
          return 0
        }

        const realWinner = getWinner(placarRealA, placarRealB)
        const realDiff = Math.abs(placarRealA - placarRealB)

        const golsTimeA = parseJsonField(jogo, 'gols_time_a')
        const golsTimeB = parseJsonField(jogo, 'gols_time_b')

        const allRealScorers = []
        const processScorer = (item) => {
          if (!item || !item.nome) return
          const count = parseInt(item.quantidade, 10) || 1
          const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
          let pts = 1
          if (pos.indexOf('zagueiro') >= 0 || pos.indexOf('lateral') >= 0) pts = 3
          else if (pos.indexOf('goleiro') >= 0) pts = 10
          else if (pos.indexOf('contra') >= 0) pts = 5

          for (let i = 0; i < count; i++) {
            allRealScorers.push({
              displayName: item.nome,
              normalizedName: normalizePlayerName(item.nome),
              points: pts,
              position: item.posicao || 'Atacante/Meia',
            })
          }
        }

        for (const g of golsTimeA) processScorer(g)
        for (const g of golsTimeB) processScorer(g)

        const palpites = app.findRecordsByFilter('palpites', `jogo = '${jogoId}'`, '', 100, 0)
        for (const palpite of palpites) {
          let pontos = 0
          const detalhamento = []
          const palpiteA = palpite.getInt('placar_a')
          const palpiteB = palpite.getInt('placar_b')
          const predWinner = getWinner(palpiteA, palpiteB)
          const predDiff = Math.abs(palpiteA - palpiteB)
          const isExact = palpiteA === placarRealA && palpiteB === placarRealB

          if (isExact) {
            pontos += 8
            detalhamento.push('Placar Exato (+8 pts)')
          } else {
            if (predWinner === realWinner) {
              pontos += 2
              detalhamento.push(realWinner === 0 ? 'Empate (+2 pts)' : 'Vencedor (+2 pts)')
            }
            if (predDiff === realDiff && predWinner === realWinner) {
              pontos += 1
              detalhamento.push('Diferença de Gols (+1 pt)')
            }
            if (palpiteA === placarRealA || palpiteB === placarRealB) {
              pontos += 1
              detalhamento.push('Metade do Placar (+1 pt)')
            }
          }

          const predScorersA = parseJsonField(palpite, 'goleadores_a')
          const predScorersB = parseJsonField(palpite, 'goleadores_b')

          const allPredNames = []
          for (const p of predScorersA)
            if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())
          for (const p of predScorersB)
            if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())

          const availableRealScorers = allRealScorers.map((rs) => ({ ...rs, used: false }))
          const matchedScorers = []

          for (const predName of allPredNames) {
            const normPred = normalizePlayerName(predName)
            if (!normPred) continue

            const matchIndex = availableRealScorers.findIndex(
              (rs) => !rs.used && rs.normalizedName === normPred,
            )

            if (matchIndex >= 0) {
              const matchedRealScorer = availableRealScorers[matchIndex]
              matchedRealScorer.used = true
              pontos += matchedRealScorer.points
              matchedScorers.push(
                `${matchedRealScorer.displayName} (+${matchedRealScorer.points} pt${matchedRealScorer.points > 1 ? 's' : ''} - ${matchedRealScorer.position})`,
              )
            }
          }

          if (matchedScorers.length > 0) {
            detalhamento.push(`Gols acertados: ${matchedScorers.join(', ')}`)
          }

          if (temPenaltis) {
            const predPenaltis = (palpite.getString('vencedor_penaltis') || '').toUpperCase().trim()
            if (
              predPenaltis &&
              predPenaltis === vencedorPenaltisReal &&
              (predPenaltis === 'A' || predPenaltis === 'B')
            ) {
              pontos += 2
              detalhamento.push('Vencedor nos Pênaltis (+2 pts)')
            }
          }

          palpite.set('pontuacao_jogo', pontos)
          palpite.set('detalhamento', detalhamento)
          app.save(palpite)
        }

        // Update participant totals
        const participantes = app.findRecordsByFilter(
          'participantes',
          `bolao = '${bolaoId}'`,
          '',
          100,
          0,
        )
        for (const part of participantes) {
          const partPalpites = app.findRecordsByFilter(
            'palpites',
            `bolao = '${bolaoId}' && participante = '${part.id}'`,
            '',
            500,
            0,
          )
          let total = 0
          for (const p of partPalpites) {
            try {
              const g = app.findRecordById('jogos', p.getString('jogo'))
              if (g && g.getBool('resultado_finalizado')) {
                total += p.getInt('pontuacao_jogo')
              }
            } catch (_) {}
          }
          part.set('pontuacao_total', total)
          app.save(part)
        }
      }
    } catch (e) {
      console.log('Error in 0014: ' + e)
    }
  },
  (app) => {},
)
