routerAdd('POST', '/backend/v1/salvar-palpite', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const body = e.requestInfo().body || {}
    const jogoId = body.jogo_id || body.jogo
    const userEmail = body.usuario_email || authRecord.email
    const userId = body.usuario_id || authRecord.id
    const userName = authRecord.getString('name') || ''

    if (!jogoId) {
      return e.badRequestError('jogo_id é obrigatório')
    }

    const jogo = $app.findRecordById('jogos', jogoId)
    if (!jogo) {
      return e.notFoundError('Jogo não encontrado')
    }

    const bolaoId = body.bolao_id || body.bolao || jogo.getString('bolao')

    // Placar
    const placarA = parseInt(body.gols_time_a !== undefined ? body.gols_time_a : body.placar_a, 10)
    const placarB = parseInt(body.gols_time_b !== undefined ? body.gols_time_b : body.placar_b, 10)

    if (isNaN(placarA) || isNaN(placarB) || placarA < 0 || placarB < 0) {
      return e.badRequestError('gols_time_a e gols_time_b devem ser inteiros não-negativos')
    }

    // Resolving participante
    let participanteId = body.participante_id || body.participante || ''

    if (!participanteId) {
      // Find participante by user name or email prefix in this bolao
      const searchTerms = [userName, userEmail ? userEmail.split('@')[0] : ''].filter(Boolean)

      const bolaoParts = $app.findRecordsByFilter(
        'participantes',
        `bolao = '${bolaoId}'`,
        '',
        100,
        0,
      )

      for (const term of searchTerms) {
        const found = bolaoParts.find((p) => {
          const pNome = (p.getString('nome') || '').toLowerCase().trim()
          return pNome === term.toLowerCase().trim()
        })
        if (found) {
          participanteId = found.id
          break
        }
      }

      // If not exact match, try contains match
      if (!participanteId) {
        for (const term of searchTerms) {
          const found = bolaoParts.find((p) => {
            const pNome = (p.getString('nome') || '').toLowerCase().trim()
            return (
              pNome.includes(term.toLowerCase().trim()) || term.toLowerCase().trim().includes(pNome)
            )
          })
          if (found) {
            participanteId = found.id
            break
          }
        }
      }
    }

    if (!participanteId) {
      return e.badRequestError('Participante não identificado para este bolão')
    }

    // Parse marcadores_time_a
    // If placarA === 0, must be [] or null, empty string ""
    let marcadoresA = []
    if (placarA > 0) {
      const rawA = body.marcadores_time_a !== undefined ? body.marcadores_time_a : body.goleadores_a
      if (Array.isArray(rawA)) {
        marcadoresA = rawA.map((s) => String(s || '').trim()).filter(Boolean)
      } else if (typeof rawA === 'string' && rawA.trim()) {
        marcadoresA = rawA
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    // Parse marcadores_time_b
    // If placarB === 0, must be [] or null, empty string ""
    let marcadoresB = []
    if (placarB > 0) {
      const rawB = body.marcadores_time_b !== undefined ? body.marcadores_time_b : body.goleadores_b
      if (Array.isArray(rawB)) {
        marcadoresB = rawB.map((s) => String(s || '').trim()).filter(Boolean)
      } else if (typeof rawB === 'string' && rawB.trim()) {
        marcadoresB = rawB
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    const vencedorPenaltis =
      body.vencedor_penaltis !== undefined ? String(body.vencedor_penaltis) : 'N'

    // Lógica de gravação: DELETE prévio de palpites anteriores do participante para este jogo + INSERT
    // Isso garante idempotência e remove qualquer risco de conflito de chave única ou erro de update
    const existingPalpites = $app.findRecordsByFilter(
      'palpites',
      `jogo = '${jogoId}' && participante = '${participanteId}'`,
      '',
      50,
      0,
    )

    for (const oldRec of existingPalpites) {
      $app.delete(oldRec)
    }

    // Criar novo registro de palpite
    const palpitesCol = $app.findCollectionByNameOrId('palpites')
    const newRecord = new Record(palpitesCol)
    newRecord.set('bolao', bolaoId)
    newRecord.set('jogo', jogoId)
    newRecord.set('participante', participanteId)
    newRecord.set('placar_a', placarA)
    newRecord.set('placar_b', placarB)
    newRecord.set('goleadores_a', marcadoresA)
    newRecord.set('goleadores_b', marcadoresB)
    newRecord.set('vencedor_penaltis', vencedorPenaltis)
    newRecord.set('pontuacao_jogo', 0)
    newRecord.set('detalhamento', [])

    $app.save(newRecord)

    return e.json(200, {
      success: true,
      message: 'Palpite registrado com sucesso',
      palpite: {
        id: newRecord.id,
        bolao: bolaoId,
        jogo: jogoId,
        participante: participanteId,
        placar_a: placarA,
        placar_b: placarB,
        goleadores_a: marcadoresA,
        goleadores_b: marcadoresB,
        marcadores_time_a: marcadoresA.join(', '),
        marcadores_time_b: marcadoresB.join(', '),
        vencedor_penaltis: vencedorPenaltis,
      },
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao salvar palpite',
    })
  }
})
