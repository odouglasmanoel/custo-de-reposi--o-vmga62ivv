migrate(
  (app) => {
    const palpitesCol = app.findCollectionByNameOrId('palpites')

    // Regras de acesso explícitas e permissivas para usuários autenticados
    // Permitir list, view, create e update para qualquer usuário autenticado (incluindo Douglas e participantes)
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
