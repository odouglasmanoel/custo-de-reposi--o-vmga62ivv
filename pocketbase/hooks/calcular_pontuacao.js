routerAdd('POST', '/backend/v1/calcular-pontuacao', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const jogoId = body.jogo_id

    if (!jogoId) {
      return e.badRequestError('jogo_id é obrigatório')
    }

    const jogo = $app.findRecordById('jogos', jogoId)
    if (!jogo) {
      return e.notFoundError('Jogo não encontrado')
    }

    const bolaoId = jogo.getString('bolao')
    const placarRealA = jogo.getInt('placar_a')
    const placarRealB = jogo.getInt('placar_b')
    const temPenaltis = jogo.getBool('tem_penaltis')
    const vencedorPenaltisReal = (jogo.getString('vencedor_penaltis') || '').toUpperCase().trim()

    // Robust parser for JSON / text / byte fields in Goja / PocketBase
    const parseJsonField = (rec, fieldName) => {
      try {
        const raw = rec.get(fieldName)
        // If PocketBase returns Go byte slice [91, 123, ...]
        if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
          const str = String.fromCharCode.apply(null, raw)
          const parsed = JSON.parse(str)
          if (Array.isArray(parsed)) return parsed
        }
        // If it's already an array of objects/strings
        if (Array.isArray(raw)) {
          return raw
        }
        // If string representation exists
        const strVal = rec.getString(fieldName)
        if (strVal && strVal.trim()) {
          const parsed = JSON.parse(strVal)
          if (Array.isArray(parsed)) return parsed
        }
      } catch (_) {}

      // Fallback: check raw string
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

    const golsTimeA = parseJsonField(jogo, 'gols_time_a')
    const golsTimeB = parseJsonField(jogo, 'gols_time_b')

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

    // Load normalizations for this bolão
    const normalizacoes = $app.findRecordsByFilter(
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
      if (orig && corr) {
        normMap[orig] = corr
      }
    }

    const normalizePlayerName = (name) => {
      if (!name) return ''
      let clean = stripAccents(String(name).toLowerCase().trim())
      if (normMap[clean]) {
        clean = stripAccents(normMap[clean])
      }
      return clean
    }

    // Helper to determine winner: 1 (A), -1 (B), 0 (draw)
    const getWinner = (a, b) => {
      if (a > b) return 1
      if (b > a) return -1
      return 0
    }

    const realWinner = getWinner(placarRealA, placarRealB)
    const realDiff = Math.abs(placarRealA - placarRealB)

    // Build real scorers flat pool with their points weight
    // Position options: "Atacante/Meia" (+1), "Zagueiro/Lateral" (+3), "Goleiro" (+10), "Gol Contra" (+5)
    // Structure of goal item: { nome, posicao, quantidade }
    const allRealScorers = []
    const processScorer = (item) => {
      if (!item || !item.nome) return
      const count = parseInt(item.quantidade, 10) || 1
      const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
      let pts = 1
      if (pos.indexOf('zagueiro') >= 0 || pos.indexOf('lateral') >= 0) {
        pts = 3
      } else if (pos.indexOf('goleiro') >= 0) {
        pts = 10
      } else if (pos.indexOf('contra') >= 0) {
        pts = 5
      }

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

    // Load all palpites for this game
    const palpites = $app.findRecordsByFilter('palpites', `jogo = '${jogoId}'`, '', 100, 0)

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
        // Vencedor ou empate correto
        if (predWinner === realWinner) {
          if (realWinner === 0) {
            pontos += 2
            detalhamento.push('Empate (+2 pts)')
          } else {
            pontos += 2
            detalhamento.push('Vencedor (+2 pts)')
          }
        }

        // Diferenca de gols correta
        if (predDiff === realDiff && predWinner === realWinner) {
          pontos += 1
          detalhamento.push('Diferença de Gols (+1 pt)')
        } else if (
          predDiff === realDiff &&
          predWinner !== realWinner &&
          realDiff === 0 &&
          predWinner === 0
        ) {
          // covered above under empate
        }

        // Metade do placar (acertar quantidade de gols de um dos times)
        if (palpiteA === placarRealA || palpiteB === placarRealB) {
          pontos += 1
          detalhamento.push('Metade do Placar (+1 pt)')
        }
      }

      // Check predicted goal scorers
      const predScorersA = parseJsonField(palpite, 'goleadores_a')
      const predScorersB = parseJsonField(palpite, 'goleadores_b')

      const allPredNames = []
      for (const p of predScorersA) {
        if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())
      }
      for (const p of predScorersB) {
        if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())
      }

      // Multiset (1-to-1) matching between predicted names and real scorer goals:
      // Each predicted goal can match at most one available real goal by that player.
      const availableRealScorers = allRealScorers.map((rs) => {
        return {
          displayName: rs.displayName,
          normalizedName: rs.normalizedName,
          points: rs.points,
          position: rs.position,
          used: false,
        }
      })
      const matchedScorers = []

      for (const predName of allPredNames) {
        const normPred = normalizePlayerName(predName)
        if (!normPred) continue

        // Find first unused real scorer matching this predicted player
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

      // Penalties prediction
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

      // Update palpite record
      palpite.set('pontuacao_jogo', pontos)
      palpite.set('detalhamento', detalhamento)
      $app.save(palpite)
    }

    // Now re-calculate cumulative total for all participants of this bolao
    // 100% IDEMPOTENT: sum pontos_importados + all pontuacao_jogo of all existing finished games for each participant
    const participantes = $app.findRecordsByFilter(
      'participantes',
      `bolao = '${bolaoId}'`,
      '',
      200,
      0,
    )

    for (const part of participantes) {
      const partId = part.id
      // Find all palpites for this participant in this bolao
      const partPalpites = $app.findRecordsByFilter(
        'palpites',
        `bolao = '${bolaoId}' && participante = '${partId}'`,
        '',
        500,
        0,
      )

      let totalPoints = 0
      for (const p of partPalpites) {
        const pJogoId = p.getString('jogo')
        try {
          const gameRec = $app.findRecordById('jogos', pJogoId)
          if (gameRec && gameRec.getBool('resultado_finalizado')) {
            totalPoints += p.getInt('pontuacao_jogo')
          }
        } catch (_) {}
      }

      const importedPts = part.getInt('pontos_importados') || 0
      part.set('pontuacao_total', importedPts + totalPoints)
      $app.save(part)
    }

    // Update pool's ultima_atualizacao
    try {
      const bolao = $app.findRecordById('boloes', bolaoId)
      bolao.set('ultima_atualizacao', new Date().toISOString())
      $app.save(bolao)
    } catch (_) {}

    return e.json(200, {
      success: true,
      message: 'Pontuações calculadas e atualizadas com sucesso',
      jogo_id: jogoId,
      palpites_calculados: palpites.length,
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao calcular pontuação',
    })
  }
})
