// Exclusão de jogo:
// 1. Excluir explicitamente todos os palpites vinculados a esse jogo (evitando resíduos ou conflitos)
// 2. Recalcular a pontuação total de cada participante do bolão somando pontos_importados + SUM(palpites de jogos existentes e finalizados)
// 3. Atualizar ultima_atualizacao do bolao
//
// REGRAS GOJA / POCKETBASE:
// - Variáveis e helpers inline dentro de cada callback
// - NENHUM spread ({ ...obj }) nem funções transpiladas globais
// - Atribuição direta de propriedades

onRecordDelete((e) => {
  const jogo = e.record
  const jogoId = jogo.id
  const bolaoId = jogo.getString('bolao')

  // 1. Remover todos os palpites associados a este jogo
  try {
    const palpitesJogo = $app.findRecordsByFilter('palpites', "jogo = '" + jogoId + "'", '', 500, 0)
    for (const p of palpitesJogo) {
      try {
        $app.delete(p)
      } catch (_) {}
    }
  } catch (_) {}

  e.next()

  // 2. Após deletar o jogo com sucesso, recalcular o ranking de todos os participantes do bolão
  try {
    const participantes = $app.findRecordsByFilter(
      'participantes',
      "bolao = '" + bolaoId + "'",
      '',
      200,
      0,
    )

    for (const part of participantes) {
      const partId = part.id
      const partPalpites = $app.findRecordsByFilter(
        'palpites',
        "bolao = '" + bolaoId + "' && participante = '" + partId + "'",
        '',
        500,
        0,
      )

      let totalJogos = 0
      for (const p of partPalpites) {
        const pJogoId = p.getString('jogo')
        if (pJogoId === jogoId) {
          continue // jogo deletado
        }
        try {
          const gameRec = $app.findRecordById('jogos', pJogoId)
          if (gameRec && gameRec.getBool('resultado_finalizado')) {
            totalJogos += p.getInt('pontuacao_jogo')
          }
        } catch (_) {}
      }

      const importedPts = part.getInt('pontos_importados') || 0
      const novoTotal = importedPts + totalJogos
      part.set('pontuacao_total', novoTotal)
      $app.save(part)
    }

    // 3. Atualizar timestamp do bolão
    try {
      const bolao = $app.findRecordById('boloes', bolaoId)
      bolao.set('ultima_atualizacao', new Date().toISOString())
      $app.save(bolao)
    } catch (_) {}
  } catch (_) {}
}, 'jogos')
