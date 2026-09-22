/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    // Permitir que o Admin Douglas liste, visualize e atualize usuários da collection users
    // Regra anterior do users era id = @request.auth.id
    // Nova regra: o próprio usuário (id = @request.auth.id) OU o admin (@request.auth.name = 'Douglas')
    users.listRule = "id = @request.auth.id || @request.auth.name = 'Douglas'"
    users.viewRule = "id = @request.auth.id || @request.auth.name = 'Douglas'"
    users.updateRule = "id = @request.auth.id || @request.auth.name = 'Douglas'"
    users.deleteRule = "@request.auth.name = 'Douglas'"

    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.updateRule = 'id = @request.auth.id'
    users.deleteRule = 'id = @request.auth.id'
    app.save(users)
  },
)
