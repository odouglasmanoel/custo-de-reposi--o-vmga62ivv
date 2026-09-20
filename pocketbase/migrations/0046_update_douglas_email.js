/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Atualizar email de douglas.manoel@repress.com.br para douglas@repress.com.br
    // mantendo tokenKey, passwordHash e emailVisibility intactos via UPDATE direto na tabela users.
    // Suporta busca por id p5y05q6j4z187e1, qdsqscm89c8sw71 ou email atual douglas.manoel@repress.com.br
    app
      .db()
      .newQuery(`
    UPDATE users
    SET email = 'douglas@repress.com.br'
    WHERE id = 'p5y05q6j4z187e1'
       OR id = 'qdsqscm89c8sw71'
       OR email = 'douglas.manoel@repress.com.br'
  `)
      .execute()
  },
  (app) => {
    app
      .db()
      .newQuery(`
    UPDATE users
    SET email = 'douglas.manoel@repress.com.br'
    WHERE id = 'p5y05q6j4z187e1'
       OR id = 'qdsqscm89c8sw71'
       OR email = 'douglas@repress.com.br'
  `)
      .execute()
  },
)
