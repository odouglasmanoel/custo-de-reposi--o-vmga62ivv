migrate(
  (app) => {
    const palpitesCol = app.findCollectionByNameOrId('palpites')

    // Permitir placar_a e placar_b serem 0 sem disparar 'Cannot be blank' na validação do PocketBase
    const fieldA = palpitesCol.fields.getByName('placar_a')
    if (fieldA) {
      fieldA.required = false
    }

    const fieldB = palpitesCol.fields.getByName('placar_b')
    if (fieldB) {
      fieldB.required = false
    }

    // Regras de acesso completas para usuários autenticados
    palpitesCol.listRule = "@request.auth.id != ''"
    palpitesCol.viewRule = "@request.auth.id != ''"
    palpitesCol.createRule = "@request.auth.id != ''"
    palpitesCol.updateRule = "@request.auth.id != ''"
    palpitesCol.deleteRule = "@request.auth.id != ''"

    app.save(palpitesCol)
  },
  (app) => {
    // rollback
    try {
      const palpitesCol = app.findCollectionByNameOrId('palpites')
      palpitesCol.deleteRule = null
      app.save(palpitesCol)
    } catch (_) {}
  },
)
