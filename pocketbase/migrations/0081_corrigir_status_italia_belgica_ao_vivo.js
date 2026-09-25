migrate(
  (app) => {
    // Correção do status do jogo Itália x Bélgica (id: unytycgvws1ggk6, 25/09/2026)
    // Regra: partidas em andamento só podem ir para "finalizado" quando status final ('FT', 'AET', 'PEN').
    // Caso contrário permanecem "ao_vivo" e resultado_finalizado = false.
    // Preserva placar (0x1) e marcador Mika Godts.
    try {
      const jogo = app.findFirstRecordByData('jogos', 'id', 'unytycgvws1ggk6')
      if (jogo) {
        jogo.set('status', 'ao_vivo')
        jogo.set('resultado_finalizado', false)
        app.save(jogo)
        console.log(
          '[migration 0081] Jogo Itália x Bélgica (unytycgvws1ggk6) atualizado para status="ao_vivo" e resultado_finalizado=false',
        )
      }
    } catch (err) {
      console.log('[migration 0081] Erro ao atualizar jogo unytycgvws1ggk6:', err)
    }
  },
  (app) => {
    try {
      const jogo = app.findFirstRecordByData('jogos', 'id', 'unytycgvws1ggk6')
      if (jogo) {
        jogo.set('status', 'finalizado')
        jogo.set('resultado_finalizado', true)
        app.save(jogo)
      }
    } catch (_) {}
  },
)
