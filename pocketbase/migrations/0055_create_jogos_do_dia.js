/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Criar collection jogos_do_dia para cache diário matinal dos jogos das ligas ativas
    const collection = new Collection({
      name: 'jogos_do_dia',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'fixture_id', type: 'text', required: true },
        { name: 'data', type: 'text', required: true }, // YYYY-MM-DD
        { name: 'horario', type: 'text' }, // HH:mm
        { name: 'data_hora_iso', type: 'text' }, // ISO string UTC
        { name: 'campeonato', type: 'text', required: true },
        { name: 'campeonato_logo', type: 'text' },
        { name: 'league_id', type: 'number' },
        { name: 'round', type: 'text' },
        { name: 'regiao', type: 'text' }, // Brasileirão & Copas | Sul-Americana | Futebol Europeu | Outros
        { name: 'pais', type: 'text' },
        { name: 'time_casa', type: 'text', required: true },
        { name: 'time_visitante', type: 'text', required: true },
        { name: 'logo_casa', type: 'text' },
        { name: 'logo_visitante', type: 'text' },
        { name: 'placar_casa', type: 'number' },
        { name: 'placar_visitante', type: 'number' },
        { name: 'status_short', type: 'text' }, // NS, 1H, HT, 2H, FT, PST, CANC...
        { name: 'status_long', type: 'text' },
        { name: 'status_elapsed', type: 'number' },
        { name: 'gols_casa', type: 'json' },
        { name: 'gols_visitante', type: 'json' },
        { name: 'scorers', type: 'json' },
        { name: 'events', type: 'json' },
        { name: 'raw_payload', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_jogos_do_dia_data_fixture ON jogos_do_dia (data, fixture_id)',
        'CREATE INDEX idx_jogos_do_dia_data ON jogos_do_dia (data)',
        'CREATE INDEX idx_jogos_do_dia_campeonato ON jogos_do_dia (campeonato)',
        'CREATE INDEX idx_jogos_do_dia_status ON jogos_do_dia (status_short)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('jogos_do_dia')
      app.delete(collection)
    } catch (_) {}
  },
)
