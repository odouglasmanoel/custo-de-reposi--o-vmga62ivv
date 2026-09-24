// pocketbase/hooks/admin_salvar_marcadores.js
// Endpoint administrativo centralizado para salvar marcadores e posições de um palpite.
// Permite que o Administrador (Douglas) atualize marcadores, posições no jogo e acione o recálculo
// com privilégios de superuser/backend ($app), contornando restrições de RLS client-side.
//
// REGRAS GOJA / POCKETBASE:
// - Variáveis e helpers inline dentro do callback
// - NENHUM spread ({ ...obj }) nem funções transpiladas globais
// - Atribuição direta de propriedades

routerAdd('POST', '/backend/v1/admin/salvar-marcadores', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Acesso não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Apenas o Administrador pode alterar marcadores de palpites.')
    }

    const body = e.requestInfo().body || {}
    const palpiteId = (body.palpite_id || '').trim()
    const jogoIdParam = (body.jogo_id || '').trim()

    if (!palpiteId) {
      return e.badRequestError('ID do palpite é obrigatório (palpite_id).')
    }

    let palpiteRec = null
    try {
      palpiteRec = $app.findRecordById('palpites', palpiteId)
    } catch (_) {
      return e.notFoundError('Palpite não encontrado.')
    }

    const jogoId = jogoIdParam || palpiteRec.getString('jogo')
    if (!jogoId) {
      return e.badRequestError('Jogo vinculado não encontrado.')
    }

    let jogoRec = null
    try {
      jogoRec = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.notFoundError('Jogo não encontrado.')
    }

    // Helper inline de normalização e sanitização de goleadores
    const sanitizarMarcadores = (rawList) => {
      if (!Array.isArray(rawList)) return []
      const sanitized = []
      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i]
        if (!item) continue

        let nome = ''
        let posicao = 'Atacante'
        let quantidade = 1
        let golContra = false

        if (typeof item === 'string') {
          nome = item.trim()
        } else if (typeof item === 'object') {
          nome = String(item.nome || '').trim()
          if (item.posicao) {
            const p = String(item.posicao).trim().toLowerCase()
            if (p === 'defensor' || p === 'zagueiro' || p === 'lateral' || p === 'd') {
              posicao = 'Defensor'
            } else if (p === 'goleiro' || p === 'g') {
              posicao = 'Goleiro'
            } else if (p.indexOf('contra') !== -1) {
              posicao = 'Gol Contra'
              golContra = true
            } else {
              posicao = 'Atacante'
            }
          }
          if (item.quantidade !== undefined && item.quantidade !== null) {
            const parsedQ = parseInt(item.quantidade, 10)
            if (!isNaN(parsedQ) && parsedQ > 0) {
              quantidade = parsedQ
            }
          }
          if (item.gol_contra === true || item.golContra === true) {
            golContra = true
            posicao = 'Gol Contra'
          }
        }

        // Checar se o nome possui menção a gol contra
        if (/\(gol contra\)|\(contra\)/i.test(nome)) {
          golContra = true
          posicao = 'Gol Contra'
        }

        // Limpeza básica do nome
        const cleanNome = nome.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
        if (!cleanNome) continue

        const finalNome = golContra ? cleanNome + ' (gol contra)' : cleanNome
        sanitized.push({
          nome: finalNome,
          posicao: posicao,
          quantidade: quantidade,
          gol_contra: golContra,
        })
      }
      return sanitized
    }

    const goleadoresA = sanitizarMarcadores(body.goleadores_a)
    const goleadoresB = sanitizarMarcadores(body.goleadores_b)

    // Atualiza o palpite com os goleadores estruturados
    palpiteRec.set('goleadores_a', goleadoresA)
    palpiteRec.set('goleadores_b', goleadoresB)
    $app.save(palpiteRec)

    // Se a partida estiver sendo finalizada (placar final presente), setar status='finalizado' e resultado_finalizado=true
    try {
      const pRealA = jogoRec.get('placar_a')
      const pRealB = jogoRec.get('placar_b')
      const hasPlacar =
        pRealA !== null &&
        pRealA !== undefined &&
        pRealA !== '' &&
        pRealB !== null &&
        pRealB !== undefined &&
        pRealB !== ''

      if (hasPlacar) {
        jogoRec.set('status', 'finalizado')
        jogoRec.set('resultado_finalizado', true)
        $app.save(jogoRec)
      }
    } catch (errStatusJogo) {
      console.log('[salvar-marcadores] Aviso ao atualizar status do jogo:', errStatusJogo)
    }

    // Sincroniza posições no cadastro de gols do jogo se existirem em gols_time_a / gols_time_b
    try {
      const normalizarParaMatch = (str) => {
        if (!str) return ''
        let s = String(str).toLowerCase()
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        return s
          .replace(/\s*\d+\s*['’]/g, '')
          .replace(/\(gol contra\)|\(contra\)/gi, '')
          .replace(/[^a-z0-9]/g, '')
          .trim()
      }

      const extrairGolsDoJogo = (rec, fieldName) => {
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
        return []
      }

      const existingGolsA = extrairGolsDoJogo(jogoRec, 'gols_time_a')
      const existingGolsB = extrairGolsDoJogo(jogoRec, 'gols_time_b')

      let mudouJogo = false

      const novosGolsA = []
      for (let i = 0; i < existingGolsA.length; i++) {
        const g = existingGolsA[i]
        const normG = normalizarParaMatch(g.nome || '')
        let matchedScorer = null
        for (let j = 0; j < goleadoresA.length; j++) {
          const normA = normalizarParaMatch(goleadoresA[j].nome || '')
          if (
            normA &&
            (normA === normG || normG.indexOf(normA) !== -1 || normA.indexOf(normG) !== -1)
          ) {
            matchedScorer = goleadoresA[j]
            break
          }
        }

        if (matchedScorer) {
          mudouJogo = true
          novosGolsA.push({
            nome: g.nome,
            posicao: matchedScorer.gol_contra
              ? 'Gol Contra'
              : matchedScorer.posicao || g.posicao || 'Atacante',
            quantidade: g.quantidade || 1,
            gol_contra: matchedScorer.gol_contra === true,
          })
        } else {
          novosGolsA.push(g)
        }
      }

      const novosGolsB = []
      for (let i = 0; i < existingGolsB.length; i++) {
        const g = existingGolsB[i]
        const normG = normalizarParaMatch(g.nome || '')
        let matchedScorer = null
        for (let j = 0; j < goleadoresB.length; j++) {
          const normB = normalizarParaMatch(goleadoresB[j].nome || '')
          if (
            normB &&
            (normB === normG || normG.indexOf(normB) !== -1 || normB.indexOf(normG) !== -1)
          ) {
            matchedScorer = goleadoresB[j]
            break
          }
        }

        if (matchedScorer) {
          mudouJogo = true
          novosGolsB.push({
            nome: g.nome,
            posicao: matchedScorer.gol_contra
              ? 'Gol Contra'
              : matchedScorer.posicao || g.posicao || 'Atacante',
            quantidade: g.quantidade || 1,
            gol_contra: matchedScorer.gol_contra === true,
          })
        } else {
          novosGolsB.push(g)
        }
      }

      if (mudouJogo) {
        jogoRec.set('gols_time_a', novosGolsA)
        jogoRec.set('gols_time_b', novosGolsB)
        $app.save(jogoRec)
      }
    } catch (errJogoSync) {
      console.log('[salvar-marcadores] Aviso ao sincronizar posições no jogo:', errJogoSync)
    }

    // Recálculo direto de pontuação para manter cards e rankings atualizados
    let recalculou = false
    try {
      const placarRealA = jogoRec.getInt('placar_a')
      const placarRealB = jogoRec.getInt('placar_b')
      const bolaoId = jogoRec.getString('bolao')
      const temPenaltis = jogoRec.getBool('tem_penaltis')
      const vencedorPenaltisReal = (jogoRec.getString('vencedor_penaltis') || '')
        .toUpperCase()
        .trim()

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

      const golsTimeA = parseJsonField(jogoRec, 'gols_time_a')
      const golsTimeB = parseJsonField(jogoRec, 'gols_time_b')

      const normalizacoes = $app.findRecordsByFilter(
        'normalizacoes',
        "bolao = '" + bolaoId + "'",
        '',
        500,
        0,
      )
      const normMap = {}
      for (let ni = 0; ni < normalizacoes.length; ni++) {
        const n = normalizacoes[ni]
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

      const getWinner = (a, b) => {
        if (a > b) return 1
        if (b > a) return -1
        return 0
      }

      const realWinner = getWinner(placarRealA, placarRealB)
      const realDiff = Math.abs(placarRealA - placarRealB)

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

      for (let gi = 0; gi < golsTimeA.length; gi++) processScorer(golsTimeA[gi])
      for (let gi = 0; gi < golsTimeB.length; gi++) processScorer(golsTimeB[gi])

      // Recalcula todos os palpites do jogo
      const palpitesDoJogo = $app.findRecordsByFilter(
        'palpites',
        "jogo = '" + jogoId + "'",
        '',
        100,
        0,
      )
      for (let pi = 0; pi < palpitesDoJogo.length; pi++) {
        const palpite = palpitesDoJogo[pi]
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

        for (let sa = 0; sa < predScorersA.length; sa++) addPredScorer(predScorersA[sa])
        for (let sb = 0; sb < predScorersB.length; sb++) addPredScorer(predScorersB[sb])

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

              const minsToUse = (matchedReal.minutes || []).slice(0, g)
              let txt = ''
              if (minsToUse.length > 0) {
                const minsStr = minsToUse.map((m) => m + "'").join(', ')
                txt =
                  matchedReal.displayName +
                  ' ' +
                  minsStr +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else if (g > 1) {
                txt =
                  matchedReal.displayName +
                  ' ×' +
                  g +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else {
                txt =
                  matchedReal.displayName +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              }
              matchedScorers.push(txt)
            }
          }
        }

        if (matchedScorers.length > 0) {
          detalhamento.push('Gols acertados: ' + matchedScorers.join(', '))
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
        $app.save(palpite)
      }

      // Reacumula pontuação total dos participantes
      const participantes = $app.findRecordsByFilter(
        'participantes',
        "bolao = '" + bolaoId + "'",
        '',
        200,
        0,
      )
      for (let pi = 0; pi < participantes.length; pi++) {
        const part = participantes[pi]
        const partPalpites = $app.findRecordsByFilter(
          'palpites',
          "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
          '',
          500,
          0,
        )

        let totalPoints = 0
        for (let ppi = 0; ppi < partPalpites.length; ppi++) {
          const p = partPalpites[ppi]
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

      try {
        const bolao = $app.findRecordById('boloes', bolaoId)
        bolao.set('ultima_atualizacao', new Date().toISOString())
        $app.save(bolao)
      } catch (_) {}

      recalculou = true
    } catch (errRecalc) {
      console.log('[salvar-marcadores] Erro ao recalcular pontuação:', errRecalc)
    }

    // Retorna o palpite atualizado serializado
    return e.json(200, {
      success: true,
      message: 'Marcadores e posições salvos com sucesso!',
      palpite: {
        id: palpiteRec.id,
        bolao: palpiteRec.getString('bolao'),
        jogo: palpiteRec.getString('jogo'),
        participante: palpiteRec.getString('participante'),
        placar_a: palpiteRec.getInt('placar_a'),
        placar_b: palpiteRec.getInt('placar_b'),
        goleadores_a: palpiteRec.get('goleadores_a'),
        goleadores_b: palpiteRec.get('goleadores_b'),
        vencedor_penaltis: palpiteRec.getString('vencedor_penaltis'),
        pontuacao_jogo: palpiteRec.getInt('pontuacao_jogo'),
        detalhamento: palpiteRec.get('detalhamento'),
        updated: palpiteRec.getString('updated'),
      },
      recalculou: recalculou,
    })
  } catch (err) {
    console.log('[salvar-marcadores] Erro fatal:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao salvar marcadores.',
    })
  }
})
