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
    const userName = (authRecord.getString('name') || '').trim()

    if (!jogoId) {
      return e.badRequestError('jogo_id é obrigatório')
    }

    let jogo = null
    try {
      jogo = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.notFoundError('Jogo não encontrado')
    }

    const bolaoId = body.bolao_id || body.bolao || jogo.getString('bolao')

    // Parse gols
    const rawGolsA = body.gols_time_a !== undefined ? body.gols_time_a : body.placar_a
    const rawGolsB = body.gols_time_b !== undefined ? body.gols_time_b : body.placar_b

    const golsA = parseInt(rawGolsA, 10)
    const golsB = parseInt(rawGolsB, 10)

    if (isNaN(golsA) || isNaN(golsB) || golsA < 0 || golsB < 0) {
      return e.badRequestError('gols_time_a e gols_time_b devem ser inteiros não-negativos')
    }

    // Resolvendo participante correspondente
    let participanteId = body.participante_id || body.participante || ''

    if (!participanteId) {
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

    // Tratamento dos marcadores:
    // Se o time fez 0 gols -> marcadores_time_a = "" ou null (no banco salva array vazio [] ou null)
    // Se fez > 0 gols -> string de nomes separados por vírgula ("Pedro Raul, Gui Negão") ou array
    let marcadoresArrA = []
    let marcadoresStrA = ''
    if (golsA > 0) {
      const rawA = body.marcadores_time_a !== undefined ? body.marcadores_time_a : body.goleadores_a
      if (Array.isArray(rawA)) {
        marcadoresArrA = rawA.map((s) => String(s || '').trim()).filter(Boolean)
      } else if (typeof rawA === 'string' && rawA.trim()) {
        marcadoresArrA = rawA
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      marcadoresStrA = marcadoresArrA.join(', ')
    }

    let marcadoresArrB = []
    let marcadoresStrB = ''
    if (golsB > 0) {
      const rawB = body.marcadores_time_b !== undefined ? body.marcadores_time_b : body.goleadores_b
      if (Array.isArray(rawB)) {
        marcadoresArrB = rawB.map((s) => String(s || '').trim()).filter(Boolean)
      } else if (typeof rawB === 'string' && rawB.trim()) {
        marcadoresArrB = rawB
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      marcadoresStrB = marcadoresArrB.join(', ')
    }

    const vencedorPenaltis =
      body.vencedor_penaltis !== undefined && body.vencedor_penaltis !== null
        ? String(body.vencedor_penaltis).trim()
        : 'N'

    // Lógica de gravação robusta e simplificada:
    // DELETE prévio do palpite anterior do usuário para este jogo antes de inserir o novo
    // (DELETE WHERE jogo = ? AND participante = ? -> INSERT)
    // Isso evita qualquer falha de índice único ou problema de lock/patch
    const existing = $app.findRecordsByFilter(
      'palpites',
      `jogo = '${jogoId}' && participante = '${participanteId}'`,
      '',
      20,
      0,
    )

    let existingPontuacao = 0
    let existingDetalhamento = []
    if (existing.length > 0) {
      existingPontuacao = existing[0].getInt('pontuacao_jogo') || 0
      try {
        const rawDet = existing[0].get('detalhamento')
        if (Array.isArray(rawDet)) {
          existingDetalhamento = rawDet
        }
      } catch (_) {}
    }

    for (const oldRec of existing) {
      try {
        $app.delete(oldRec)
      } catch (_) {}
    }

    // Criação do novo registro
    const palpitesCol = $app.findCollectionByNameOrId('palpites')
    const record = new Record(palpitesCol)
    record.set('bolao', bolaoId)
    record.set('jogo', jogoId)
    record.set('participante', participanteId)
    record.set('placar_a', golsA)
    record.set('placar_b', golsB)
    record.set('goleadores_a', marcadoresArrA)
    record.set('goleadores_b', marcadoresArrB)
    record.set('vencedor_penaltis', vencedorPenaltis || 'N')
    record.set('pontuacao_jogo', existingPontuacao)
    record.set('detalhamento', existingDetalhamento)

    $app.save(record)

    return e.json(200, {
      success: true,
      message: 'Palpite salvo com sucesso!',
      palpite: {
        id: record.id,
        bolao: bolaoId,
        jogo: jogoId,
        participante: participanteId,
        usuario_email: userEmail,
        usuario_id: userId,
        gols_time_a: golsA,
        gols_time_b: golsB,
        placar_a: golsA,
        placar_b: golsB,
        marcadores_time_a: marcadoresStrA,
        marcadores_time_b: marcadoresStrB,
        goleadores_a: marcadoresArrA,
        goleadores_b: marcadoresArrB,
        vencedor_penaltis: vencedorPenaltis,
      },
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Falha ao processar salvamento do palpite',
    })
  }
})
