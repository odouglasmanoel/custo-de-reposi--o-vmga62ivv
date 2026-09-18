migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('enquetes')
    if (!col.fields.getByName('data_limite_votacao')) {
      col.fields.add(
        new TextField({
          name: 'data_limite_votacao',
          required: false,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('enquetes')
      const field = col.fields.getByName('data_limite_votacao')
      if (field) {
        col.fields.removeByName('data_limite_votacao')
        app.save(col)
      }
    } catch (_) {}
  },
)
