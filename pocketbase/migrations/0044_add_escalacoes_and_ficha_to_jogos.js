migrate(
  (app) => {
    // Adicionar campos 'escalacoes' (json) e 'ficha_detalhes' (json) na collection 'jogos'
    // Permite persistir diretamente escalações confirmadas e detalhes de ficha técnica no banco de dados.
    const jogosCol = app.findCollectionByNameOrId('jogos')

    if (!jogosCol.fields.getByName('escalacoes')) {
      jogosCol.fields.add(
        new JSONField({
          name: 'escalacoes',
          required: false,
        }),
      )
    }

    if (!jogosCol.fields.getByName('ficha_detalhes')) {
      jogosCol.fields.add(
        new JSONField({
          name: 'ficha_detalhes',
          required: false,
        }),
      )
    }

    app.save(jogosCol)
  },
  (app) => {
    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      let changed = false
      if (jogosCol.fields.getByName('escalacoes')) {
        jogosCol.fields.removeByName('escalacoes')
        changed = true
      }
      if (jogosCol.fields.getByName('ficha_detalhes')) {
        jogosCol.fields.removeByName('ficha_detalhes')
        changed = true
      }
      if (changed) {
        app.save(jogosCol)
      }
    } catch (_) {}
  },
)
