migrate(
  (app) => {
    // Índices de performance para a tabela 'jogos'
    // idx_jogos_status_data: otimiza consultas por status e ordenação/filtro de data
    const jogosCol = app.findCollectionByNameOrId('jogos')
    jogosCol.addIndex('idx_jogos_status_data', false, 'resultado_finalizado, data', '')
    app.save(jogosCol)

    // Índices de performance para a tabela 'palpites'
    // idx_palpites_user_partida: otimiza busca conjunta por participante e jogo
    // idx_palpites_bolao_jogo: otimiza busca consolidada de palpites por bolão e jogo
    const palpitesCol = app.findCollectionByNameOrId('palpites')
    palpitesCol.addIndex('idx_palpites_part_jogo', false, 'participante, jogo', '')
    palpitesCol.addIndex('idx_palpites_bolao_jogo', false, 'bolao, jogo', '')
    app.save(palpitesCol)
  },
  (app) => {
    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      jogosCol.removeIndex('idx_jogos_status_data')
      app.save(jogosCol)
    } catch (_) {}

    try {
      const palpitesCol = app.findCollectionByNameOrId('palpites')
      palpitesCol.removeIndex('idx_palpites_part_jogo')
      palpitesCol.removeIndex('idx_palpites_bolao_jogo')
      app.save(palpitesCol)
    } catch (_) {}
  },
)
