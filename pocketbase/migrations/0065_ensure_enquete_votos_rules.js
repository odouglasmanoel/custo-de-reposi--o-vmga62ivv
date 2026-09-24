migrate(
  (app) => {
    // Garante que a coleção enquete_votos permita operações para usuários autenticados
    // e caso @request.auth.id não esteja vazio, permita create/update/delete/list/view
    try {
      const col = app.findCollectionByNameOrId('enquete_votos')
      col.listRule = "@request.auth.id != ''"
      col.viewRule = "@request.auth.id != ''"
      col.createRule = "@request.auth.id != ''"
      col.updateRule = "@request.auth.id != ''"
      col.deleteRule = "@request.auth.id != ''"
      app.save(col)
    } catch (e) {
      console.log('[Migration 0065] Erro ao atualizar regras de enquete_votos:', e)
    }
  },
  (app) => {
    // down migration
  },
)
