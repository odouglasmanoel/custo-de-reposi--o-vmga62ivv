// pocketbase/migrations/0070_purge_thesportsdb_badges.js
// Saneamento de escudos: limpa quaisquer URLs pertencentes ao domínio thesportsdb (r2.thesportsdb.com ou www.thesportsdb.com)
// das coleções enquete_jogos e jogos, conforme solicitação do Administrador Douglas.
// Zero chamadas externas à API-Football nesta migration (preservando 100% da cota).
// Os campos limpos permanecem vazios para que o auto-lookup e o vínculo de fixture preencham pelas fontes oficiais.

migrate(
  (app) => {
    // 1. Limpa escudos thesportsdb na coleção enquete_jogos
    app
      .db()
      .newQuery(`
      UPDATE enquete_jogos
      SET logo_casa = ''
      WHERE logo_casa LIKE '%thesportsdb%'
    `)
      .execute()

    app
      .db()
      .newQuery(`
      UPDATE enquete_jogos
      SET logo_visitante = ''
      WHERE logo_visitante LIKE '%thesportsdb%'
    `)
      .execute()

    // 2. Limpa escudos thesportsdb na coleção jogos
    app
      .db()
      .newQuery(`
      UPDATE jogos
      SET url_escudo_mandante = ''
      WHERE url_escudo_mandante LIKE '%thesportsdb%'
    `)
      .execute()

    app
      .db()
      .newQuery(`
      UPDATE jogos
      SET url_escudo_visitante = ''
      WHERE url_escudo_visitante LIKE '%thesportsdb%'
    `)
      .execute()

    // 3. Limpa também na coleção jogos_do_dia_manuais caso exista
    try {
      app
        .db()
        .newQuery(`
        UPDATE jogos_do_dia_manuais
        SET logo_casa = ''
        WHERE logo_casa LIKE '%thesportsdb%'
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE jogos_do_dia_manuais
        SET logo_visitante = ''
        WHERE logo_visitante LIKE '%thesportsdb%'
      `)
        .execute()
    } catch (_) {}

    // 4. Limpa em jogos_do_dia caso exista
    try {
      app
        .db()
        .newQuery(`
        UPDATE jogos_do_dia
        SET logo_casa = ''
        WHERE logo_casa LIKE '%thesportsdb%'
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE jogos_do_dia
        SET logo_visitante = ''
        WHERE logo_visitante LIKE '%thesportsdb%'
      `)
        .execute()
    } catch (_) {}
  },
  (app) => {
    // Reversão no-op: não é possível nem desejável restaurar URLs depreciadas de terceiros
  },
)
