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

    // 1. Normalizar kickoff no fuso de Brasília (UTC-3)
    let kickoffMs = 0
    try {
      let dataStr = (jogo.getString('data') || '').trim()
      let horaStr = (jogo.getString('hora') || '').trim() || '16:00'

      // Trata data se vier DD/MM/YYYY
      const brMatch = dataStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (brMatch) {
        dataStr = brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
      } else if (dataStr.indexOf('T') !== -1) {
        dataStr = dataStr.split('T')[0]
      }

      // Garante formato HH:mm ou HH:mm:ss
      const horaParts = horaStr.split(':')
      const hh = (horaParts[0] || '16').padStart(2, '0')
      const mm = (horaParts[1] || '00').padStart(2, '0')
      const ss = (horaParts[2] || '00').padStart(2, '0')
      const isoStr = dataStr + 'T' + hh + ':' + mm + ':' + ss + '-03:00'
      const parsedKickoff = new Date(isoStr).getTime()
      if (!isNaN(parsedKickoff)) {
        kickoffMs = parsedKickoff
      }
    } catch (_) {}

    // 2. Checar status iniciado
    const statusAtual = (jogo.getString('status') || '').toLowerCase().trim()
    const STATUS_INICIADOS = [
      'em_andamento',
      'ao_vivo',
      '1h',
      '2h',
      'ht',
      'finalizado',
      'encerrado',
      'ft',
      'finished',
    ]
    const statusIniciado = STATUS_INICIADOS.indexOf(statusAtual) >= 0
    const jogoIniciou = (kickoffMs > 0 && Date.now() >= kickoffMs) || statusIniciado

    // 3. Se jogo não iniciou: zerar palpites com 'Aguardando início' e NUNCA finalizar o jogo
    if (!jogoIniciou) {
      const palpitesNaoIniciados = $app.findRecordsByFilter(
        'palpites',
        "jogo = '" + jogoId + "'",
        '',
        500,
        0,
      )
      for (let pi = 0; pi < palpitesNaoIniciados.length; pi++) {
        const pRec = palpitesNaoIniciados[pi]
        pRec.set('pontuacao_jogo', 0)
        pRec.set('detalhamento', ['Aguardando início'])
        $app.save(pRec)
      }

      return e.json(200, {
        success: true,
        message: 'Jogo futuro ou não iniciado. Pontuação mantida zerada (Aguardando início).',
        jogo_id: jogoId,
        jogo_iniciado: false,
        palpites_calculados: palpitesNaoIniciados.length,
      })
    }

    // Quando o jogo de fato já iniciou ou foi finalizado, marcar status='finalizado' e resultado_finalizado=true
    jogo.set('status', 'finalizado')
    jogo.set('resultado_finalizado', true)
    $app.save(jogo)

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

    // Agrupamento de gols reais por jogador
    // Estrutura do item de gol: { nome, posicao, quantidade }
    // Suporta nomes com minutos embutidos (ex: "Raphinha 22'", "Raphinha 22', 52'")
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
        (pts === 3 ? 'Defensor' : pts === 10 ? 'Goleiro' : pts === 5 ? 'Gol Contra' : 'Atacante')

      // Extrair minutos do nome se existirem
      const mins = []
      const minRegex = /(\d+)\s*['’]/g
      let mMatch
      while ((mMatch = minRegex.exec(rawNome)) !== null) {
        const num = parseInt(mMatch[1], 10)
        if (!isNaN(num)) mins.push(num)
      }

      if (realScorersMap[norm]) {
        realScorersMap[norm].countReal += count
        if (mins.length > 0) {
          realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
        }
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

      // Check predicted goal scorers - Agrupamento por frequência min(N, M) e priorização da posição definida
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
          /\(gol contra\)|\(contra\)/i.test(pStr) ||
          String(pPos || '')
            .toLowerCase()
            .indexOf('contra') >= 0

        if (predInfo[normP]) {
          predInfo[normP].count += 1
          if (!predInfo[normP].posicao && pPos) predInfo[normP].posicao = pPos
          if (pContra) predInfo[normP].golContra = true
        } else {
          predInfo[normP] = {
            count: 1,
            posicao: pPos,
            golContra: pContra,
          }
        }
      }

      for (const p of predScorersA) addPredScorer(p)
      for (const p of predScorersB) addPredScorer(p)

      const matchedScorers = []
      for (const normPred in predInfo) {
        const itemInfo = predInfo[normPred]
        const countPalpite = itemInfo.count
        // Busca jogador real por chave exata ou contenção flexível
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
            // Prioriza posição definida no palpite ou jogo sobre qualquer default
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
              targetPosStr.indexOf('lateral') >= 0 ||
              targetPosStr === 'd'
            ) {
              unitPoints = 3
              displayPos = 'Defensor'
            } else if (targetPosStr.indexOf('goleiro') >= 0 || targetPosStr === 'g') {
              unitPoints = 10
              displayPos = 'Goleiro'
            } else if (
              targetPosStr.indexOf('atacante') >= 0 ||
              targetPosStr.indexOf('meia') >= 0 ||
              targetPosStr.indexOf('meio') >= 0 ||
              targetPosStr === 'a'
            ) {
              unitPoints = 1
              displayPos = 'Atacante'
            }

            const ptsTotal = g * unitPoints
            pontos += ptsTotal

            // Formatação do detalhamento consolidado:
            // Com minutos: "Raphinha 22', 52' [Atacante] (+2 pts)"
            // Sem minutos (>1): "Raphinha ×2 [Atacante] (+2 pts)"
            // Único sem minutos: "Raphinha [Atacante] (+1 pt)"
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
