migrate(
  (app) => {
    // Migration 0096: Correção de placar e marcadores dos jogos de hoje (2026-10-01)
    // 1. Dinamarca x Portugal (drgc57pmtfn7tg0, fixture 1528919):
    //    Mandante: Dinamarca (team 21) -> Mikkel Damsgaard 23' (1 gol)
    //    Visitante: Portugal (team 27) -> João Cancelo 13', Gonçalo Ramos 25' (2 gols)
    //    Placar: 1 x 2
    // 2. Grécia x Países Baixos (p8xn0np1d6j4vhp, fixture 1528918):
    //    Mandante: Grécia (team 1117) -> Fotis Ioannidis 23', Georgios Masouras 45' (2 gols)
    //    Visitante: Países Baixos (team 1118) -> 0 gols
    //    Placar: 2 x 0
    //
    // Recalcula pontuação oficial dos palpites e ranking preservando a base fixa histórica das planilhas.

    try {
      // 1. Dinamarca x Portugal
      try {
        const jDinPor = app.findRecordById('jogos', 'drgc57pmtfn7tg0')
        if (jDinPor) {
          const golsA = [
            {
              nome: 'Mikkel Damsgaard',
              posicao: 'Atacante/Meia',
              quantidade: 1,
              minuto: 23,
            },
          ]
          const golsB = [
            {
              nome: 'João Cancelo',
              posicao: 'Atacante/Meia',
              quantidade: 1,
              minuto: 13,
            },
            {
              nome: 'Gonçalo Ramos',
              posicao: 'Atacante/Meia',
              quantidade: 1,
              minuto: 25,
            },
          ]
          const marcadores = ["Mikkel Damsgaard 23'", "João Cancelo 13'", "Gonçalo Ramos 25'"]

          jDinPor.set('placar_a', 1)
          jDinPor.set('placar_b', 2)
          jDinPor.set('gols_time_a', golsA)
          jDinPor.set('gols_time_b', golsB)
          jDinPor.set('marcadores', marcadores)
          jDinPor.set('status', 'finalizado')
          jDinPor.set('resultado_finalizado', true)
          app.save(jDinPor)
          console.log('[migration 0096] Dinamarca x Portugal atualizado com sucesso (1x2).')
        }
      } catch (errDin) {
        console.log('[migration 0096] Erro ao atualizar Dinamarca x Portugal:', errDin)
      }

      // 2. Grécia x Países Baixos
      try {
        const jGreHol = app.findRecordById('jogos', 'p8xn0np1d6j4vhp')
        if (jGreHol) {
          const golsA = [
            {
              nome: 'Fotis Ioannidis',
              posicao: 'Atacante/Meia',
              quantidade: 1,
              minuto: 23,
            },
            {
              nome: 'Georgios Masouras',
              posicao: 'Atacante/Meia',
              quantidade: 1,
              minuto: 45,
            },
          ]
          const golsB = []
          const marcadores = ["Fotis Ioannidis 23'", "Georgios Masouras 45'"]

          jGreHol.set('placar_a', 2)
          jGreHol.set('placar_b', 0)
          jGreHol.set('gols_time_a', golsA)
          jGreHol.set('gols_time_b', golsB)
          jGreHol.set('marcadores', marcadores)
          jGreHol.set('status', 'finalizado')
          jGreHol.set('resultado_finalizado', true)
          app.save(jGreHol)
          console.log('[migration 0096] Grécia x Países Baixos atualizado com sucesso (2x0).')
        }
      } catch (errGre) {
        console.log('[migration 0096] Erro ao atualizar Grécia x Países Baixos:', errGre)
      }

      // 3. Recálculo oficial de pontuação dos dois jogos e ranking dos participantes do bolão
      const bolaoId = 'kr20rfjisajd6ro' // Copa Coni

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

      // Normalizações do bolão
      const normMap = {}
      try {
        const normalizacoes = app.findRecordsByFilter(
          'normalizacoes',
          `bolao = '${bolaoId}'`,
          '',
          500,
          0,
        )
        for (let ni = 0; ni < normalizacoes.length; ni++) {
          const n = normalizacoes[ni]
          const orig = stripAccents(n.getString('nome_original') || '')
            .toLowerCase()
            .trim()
          const corr = stripAccents(n.getString('nome_correto') || '')
            .toLowerCase()
            .trim()
          if (orig && corr) normMap[orig] = corr
        }
      } catch (_) {}

      const normalizePlayerName = (name) => {
        if (!name) return ''
        let clean = stripAccents(String(name).toLowerCase().trim())
        if (normMap[clean]) clean = stripAccents(normMap[clean])
        return clean
      }

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

      const jogosParaRecalculo = ['drgc57pmtfn7tg0', 'p8xn0np1d6j4vhp']
      for (let ji = 0; ji < jogosParaRecalculo.length; ji++) {
        const jId = jogosParaRecalculo[ji]
        let jogoRec = null
        try {
          jogoRec = app.findRecordById('jogos', jId)
        } catch (_) {}
        if (!jogoRec) continue

        const placarRealA = jogoRec.getInt('placar_a')
        const placarRealB = jogoRec.getInt('placar_b')
        const temPenaltis = jogoRec.getBool('tem_penaltis')
        const vencedorPenaltisReal = (jogoRec.getString('vencedor_penaltis') || '')
          .toUpperCase()
          .trim()

        const realScorersMap = {}
        const processScorer = (item) => {
          if (!item || !item.nome) return
          const rawNome = String(item.nome).trim()
          const cleanNome = rawNome
            .replace(/\s*\d+\s*['’]/g, '')
            .replace(/\(gol contra\)|\(contra\)/gi, '')
            .trim()
          const norm = normalizePlayerName(cleanNome)
          if (!norm) return

          const count = parseInt(item.quantidade, 10) || 1
          const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
          let pts = 1
          if (
            pos.indexOf('zagueiro') >= 0 ||
            pos.indexOf('lateral') >= 0 ||
            pos.indexOf('defensor') >= 0
          ) {
            pts = 3
          } else if (pos.indexOf('goleiro') >= 0) {
            pts = 10
          } else if (pos.indexOf('contra') >= 0) {
            pts = 5
          }

          const posLabel =
            item.posicao ||
            (pts === 3
              ? 'Defensor'
              : pts === 10
                ? 'Goleiro'
                : pts === 5
                  ? 'Gol Contra'
                  : 'Atacante')

          const mins = []
          if (item.minuto) {
            const m = parseInt(item.minuto, 10)
            if (!isNaN(m)) mins.push(m)
          }

          if (realScorersMap[norm]) {
            realScorersMap[norm].countReal += count
            if (mins.length > 0)
              realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
          } else {
            realScorersMap[norm] = {
              displayName: cleanNome,
              norm: norm,
              points: pts,
              position: posLabel,
              countReal: count,
              minutes: mins,
            }
          }
        }

        const gA = parseJsonField(jogoRec, 'gols_time_a')
        const gB = parseJsonField(jogoRec, 'gols_time_b')
        for (let i = 0; i < gA.length; i++) processScorer(gA[i])
        for (let i = 0; i < gB.length; i++) processScorer(gB[i])

        const getWinner = (a, b) => (a > b ? 1 : b > a ? -1 : 0)
        const realWinner = getWinner(placarRealA, placarRealB)
        const realDiff = Math.abs(placarRealA - placarRealB)

        const palpites = app.findRecordsByFilter('palpites', `jogo = '${jId}'`, '', 100, 0)
        for (let pi = 0; pi < palpites.length; pi++) {
          const palpite = palpites[pi]
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
              if (realWinner === 0) {
                pontos += 2
                detalhamento.push('Empate (+2 pts)')
              } else {
                pontos += 2
                detalhamento.push('Vencedor (+2 pts)')
              }
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

          // Goleadores
          const predScorersA = parseJsonField(palpite, 'goleadores_a')
          const predScorersB = parseJsonField(palpite, 'goleadores_b')
          const predInfo = {}

          const addPredScorer = (p) => {
            if (!p) return
            const pStr = typeof p === 'string' ? p : String(p.nome || '')
            const cleanP = pStr
              .replace(/\s*\d+\s*['’]/g, '')
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
            const normP = normalizePlayerName(cleanP)
            if (!normP) return

            const pPos = typeof p === 'object' && p !== null ? p.posicao : undefined
            const pContra =
              (typeof p === 'object' && p !== null && p.gol_contra === true) ||
              /\(gol contra\)|\(contra\)/i.test(pStr)

            if (predInfo[normP]) {
              predInfo[normP].count += 1
              if (!predInfo[normP].posicao && pPos) predInfo[normP].posicao = pPos
              if (pContra) predInfo[normP].golContra = true
            } else {
              predInfo[normP] = { count: 1, posicao: pPos, golContra: pContra }
            }
          }

          for (let pa = 0; pa < predScorersA.length; pa++) addPredScorer(predScorersA[pa])
          for (let pb = 0; pb < predScorersB.length; pb++) addPredScorer(predScorersB[pb])

          const matchedScorers = []
          for (const normPred in predInfo) {
            const itemInfo = predInfo[normPred]
            const countPalpite = itemInfo.count
            let matchedReal = realScorersMap[normPred]
            if (!matchedReal) {
              for (const rNorm in realScorersMap) {
                if (rNorm.indexOf(normPred) >= 0 || normPred.indexOf(rNorm) >= 0) {
                  matchedReal = realScorersMap[rNorm]
                  break
                }
              }
            }

            if (matchedReal && matchedReal.countReal > 0) {
              const g = Math.min(matchedReal.countReal, countPalpite)
              if (g > 0) {
                const targetPosStr = String(itemInfo.posicao || matchedReal.position || '')
                  .toLowerCase()
                  .trim()
                let unitPoints = matchedReal.points
                let displayPos = matchedReal.position

                if (itemInfo.golContra || targetPosStr.indexOf('contra') >= 0) {
                  unitPoints = 5
                  displayPos = 'Gol Contra'
                } else if (
                  targetPosStr.indexOf('defensor') >= 0 ||
                  targetPosStr.indexOf('zagueiro') >= 0 ||
                  targetPosStr.indexOf('lateral') >= 0
                ) {
                  unitPoints = 3
                  displayPos = 'Defensor'
                } else if (targetPosStr.indexOf('goleiro') >= 0) {
                  unitPoints = 10
                  displayPos = 'Goleiro'
                } else {
                  unitPoints = 1
                  displayPos = 'Atacante'
                }

                const ptsTotal = g * unitPoints
                pontos += ptsTotal

                const minsToUse = (matchedReal.minutes || []).slice(0, g)
                let txt = ''
                if (minsToUse.length > 0) {
                  const minsStr = minsToUse.map((m) => m + "'").join(', ')
                  txt = `${matchedReal.displayName} ${minsStr} [${displayPos}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
                } else if (g > 1) {
                  txt = `${matchedReal.displayName} ×${g} [${displayPos}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
                } else {
                  txt = `${matchedReal.displayName} [${displayPos}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
                }
                matchedScorers.push(txt)
              }
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
      }

      // Recalcular pontuacao_total dos participantes do bolão kr20rfjisajd6ro
      const participantes = app.findRecordsByFilter(
        'participantes',
        `bolao = '${bolaoId}'`,
        '',
        200,
        0,
      )
      for (let pi = 0; pi < participantes.length; pi++) {
        const part = participantes[pi]
        const partPalpites = app.findRecordsByFilter(
          'palpites',
          `bolao = '${bolaoId}' && participante = '${part.id}'`,
          '',
          500,
          0,
        )

        let totalPoints = 0
        for (let ppi = 0; ppi < partPalpites.length; ppi++) {
          const p = partPalpites[ppi]
          const pJogoId = p.getString('jogo')
          try {
            const gameRec = app.findRecordById('jogos', pJogoId)
            if (gameRec && gameRec.getBool('resultado_finalizado')) {
              totalPoints += p.getInt('pontuacao_jogo')
            }
          } catch (_) {}
        }

        const importedPts = part.getInt('pontos_importados') || 0
        part.set('pontuacao_total', importedPts + totalPoints)
        app.save(part)
        console.log(
          `[migration 0096] Participante ${part.getString('nome')}: importados=${importedPts}, palpites=${totalPoints}, total=${importedPts + totalPoints}`,
        )
      }

      console.log('[migration 0096] Concluída com sucesso.')
    } catch (err) {
      console.log('[migration 0096] Erro fatal:', err)
      throw err
    }
  },
  (app) => {
    // down migration
  },
)
