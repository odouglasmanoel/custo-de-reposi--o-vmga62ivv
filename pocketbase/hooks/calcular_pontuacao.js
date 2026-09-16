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

    // Parse real scorers for Team A and Team B
    let golsTimeA = []
    try {
      const rawA = jogo.get('gols_time_a')
      if (Array.isArray(rawA)) {
        golsTimeA = rawA
      } else if (typeof rawA === 'string' && rawA.trim()) {
        golsTimeA = JSON.parse(rawA)
      }
    } catch (_) {
      golsTimeA = []
    }

    let golsTimeB = []
    try {
      const rawB = jogo.get('gols_time_b')
      if (Array.isArray(rawB)) {
        golsTimeB = rawB
      } else if (typeof rawB === 'string' && rawB.trim()) {
        golsTimeB = JSON.parse(rawB)
      }
    } catch (_) {
      golsTimeB = []
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
      const orig = (n.getString('nome_original') || '').toLowerCase().trim()
      const corr = (n.getString('nome_correto') || '').toLowerCase().trim()
      if (orig && corr) {
        normMap[orig] = corr
      }
    }

    const normalizePlayerName = (name) => {
      if (!name) return ''
      let clean = String(name).toLowerCase().trim()
      // Replace accents
      clean = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (normMap[clean]) {
        clean = normMap[clean].normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
      let predScorersA = []
      let predScorersB = []
      try {
        const rawPredA = palpite.get('goleadores_a')
        if (Array.isArray(rawPredA)) predScorersA = rawPredA
        else if (typeof rawPredA === 'string' && rawPredA.trim())
          predScorersA = JSON.parse(rawPredA)
      } catch (_) {}

      try {
        const rawPredB = palpite.get('goleadores_b')
        if (Array.isArray(rawPredB)) predScorersB = rawPredB
        else if (typeof rawPredB === 'string' && rawPredB.trim())
          predScorersB = JSON.parse(rawPredB)
      } catch (_) {}

      const allPredNames = []
      for (const p of predScorersA) {
        if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())
      }
      for (const p of predScorersB) {
        if (typeof p === 'string' && p.trim()) allPredNames.push(p.trim())
      }

      // Match predicted names against real scorers pool
      // A participant can get points for each goal scored by a player they predicted
      // (e.g. if real scorer scored 2 goals and participant named that player)
      // To match fairly, copy real scorers and match
      const matchedScorers = []
      for (const predName of allPredNames) {
        const normPred = normalizePlayerName(predName)
        if (!normPred) continue

        // Find matches in real scorers that haven't been credited for this specific predicted item
        for (const realScorer of allRealScorers) {
          if (realScorer.normalizedName === normPred) {
            pontos += realScorer.points
            matchedScorers.push(
              `${realScorer.displayName} (+${realScorer.points} pts - ${realScorer.position})`,
            )
          }
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
    // 100% IDEMPOTENT: sum all pontuacao_jogo of all finished games for each participant
    const participantes = $app.findRecordsByFilter(
      'participantes',
      `bolao = '${bolaoId}'`,
      '',
      100,
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
        // verify if the game of this palpite is finalizado
        const pJogoId = p.getString('jogo')
        try {
          const gameRec = $app.findRecordById('jogos', pJogoId)
          if (gameRec && gameRec.getBool('resultado_finalizado')) {
            totalPoints += p.getInt('pontuacao_jogo')
          }
        } catch (_) {}
      }

      part.set('pontuacao_total', totalPoints)
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
