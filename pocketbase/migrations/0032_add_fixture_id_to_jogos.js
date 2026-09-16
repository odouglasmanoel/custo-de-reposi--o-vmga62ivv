migrate(
  (app) => {
    // Adicionar campo 'fixture_id' (texto, opcional) na collection 'jogos'
    // Permite vincular diretamente o ID da partida da API-Football (ex: 123456)
    const jogosCol = app.findCollectionByNameOrId('jogos')
    if (!jogosCol.fields.getByName('fixture_id')) {
      jogosCol.fields.add(
        new TextField({
          name: 'fixture_id',
          required: false,
        }),
      )
      app.save(jogosCol)
    }
  },
  (app) => {
    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      if (jogosCol.fields.getByName('fixture_id')) {
        jogosCol.fields.removeByName('fixture_id')
        app.save(jogosCol)
      }
    } catch (_) {}
  },
)
