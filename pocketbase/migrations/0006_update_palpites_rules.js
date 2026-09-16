migrate(
  (app) => {
    const palpitesCol = app.findCollectionByNameOrId('palpites')

    // Regras de acesso explícitas e permissivas para usuários autenticados
    // Regras de acesso para usuários autenticados (participantes e administradores)
    palpitesCol.listRule = "@request.auth.id != ''"
    palpitesCol.viewRule = "@request.auth.id != ''"
    palpitesCol.createRule = "@request.auth.id != ''"
    palpitesCol.updateRule = "@request.auth.id != ''"

    app.save(palpitesCol)
  },
  (app) => {
    // rollback
  },
)
