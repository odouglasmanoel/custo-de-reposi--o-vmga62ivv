migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    const passwordField = users.fields.getByName('password')
    if (passwordField) {
      passwordField.min = 4
    }
    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    const passwordField = users.fields.getByName('password')
    if (passwordField) {
      passwordField.min = 8
    }
    app.save(users)
  },
)
