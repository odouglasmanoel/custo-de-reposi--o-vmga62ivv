migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('enquete_jogos')
    if (!col.fields.getByName('origem')) {
      col.fields.add(
        new SelectField({
          name: 'origem',
          values: ['api', 'manual'],
          maxSelect: 1,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('enquete_jogos')
      const field = col.fields.getByName('origem')
      if (field) {
        col.fields.removeByName('origem')
        app.save(col)
      }
    } catch (_) {}
  },
)
