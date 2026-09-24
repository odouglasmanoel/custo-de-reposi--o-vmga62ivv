migrate(
  (app) => {
    const jogosCol = app.findCollectionByNameOrId('jogos')
    if (!jogosCol.fields.getByName('status')) {
      jogosCol.fields.add(
        new TextField({
          name: 'status',
          required: false,
        }),
      )
      app.save(jogosCol)
    }
  },
  (app) => {
    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      const field = jogosCol.fields.getByName('status')
      if (field) {
        jogosCol.fields.removeByName('status')
        app.save(jogosCol)
      }
    } catch (_) {}
  },
)
