migrate(
  (app) => {
    // 1. Coleção: enquetes
    const enquetesCol = new Collection({
      name: 'enquetes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'titulo', type: 'text', required: true },
        { name: 'descricao', type: 'text' },
        { name: 'data_inicio', type: 'text', required: true },
        { name: 'data_fim', type: 'text', required: true },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['aberta', 'encerrada', 'cadastrada'],
          maxSelect: 1,
        },
        { name: 'criado_por', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1 },
        { name: 'limite_votos', type: 'number', min: 1, max: 20 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_enquetes_status ON enquetes (status)',
        'CREATE INDEX idx_enquetes_created ON enquetes (created DESC)',
      ],
    })
    app.save(enquetesCol)

    const enquetesId = app.findCollectionByNameOrId('enquetes').id

    // 2. Coleção: enquete_jogos (confrontos disponíveis na enquete)
    const enqueteJogosCol = new Collection({
      name: 'enquete_jogos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'enquete',
          type: 'relation',
          required: true,
          collectionId: enquetesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'time_a', type: 'text', required: true },
        { name: 'time_b', type: 'text', required: true },
        { name: 'campeonato', type: 'text' },
        { name: 'regiao', type: 'text' },
        { name: 'data', type: 'text', required: true },
        { name: 'horario', type: 'text' },
        { name: 'fixture_id', type: 'text' },
        { name: 'logo_casa', type: 'text' },
        { name: 'logo_visitante', type: 'text' },
        { name: 'campeonato_logo', type: 'text' },
        { name: 'selecionado_admin', type: 'bool' },
        { name: 'cadastrado_bolao', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_enquete_jogos_enquete ON enquete_jogos (enquete)',
        'CREATE INDEX idx_enquete_jogos_data ON enquete_jogos (data)',
      ],
    })
    app.save(enqueteJogosCol)

    const enqueteJogosId = app.findCollectionByNameOrId('enquete_jogos').id

    // 3. Coleção: enquete_votos (votos dos participantes nos jogos da enquete)
    const enqueteVotosCol = new Collection({
      name: 'enquete_votos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'enquete',
          type: 'relation',
          required: true,
          collectionId: enquetesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'jogo',
          type: 'relation',
          required: true,
          collectionId: enqueteJogosId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'user_name', type: 'text', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_enquete_votos_user_jogo ON enquete_votos (enquete, jogo, user)',
        'CREATE INDEX idx_enquete_votos_enquete ON enquete_votos (enquete)',
        'CREATE INDEX idx_enquete_votos_jogo ON enquete_votos (jogo)',
        'CREATE INDEX idx_enquete_votos_user ON enquete_votos (user)',
      ],
    })
    app.save(enqueteVotosCol)
  },
  (app) => {
    try {
      const col3 = app.findCollectionByNameOrId('enquete_votos')
      app.delete(col3)
    } catch (_) {}
    try {
      const col2 = app.findCollectionByNameOrId('enquete_jogos')
      app.delete(col2)
    } catch (_) {}
    try {
      const col1 = app.findCollectionByNameOrId('enquetes')
      app.delete(col1)
    } catch (_) {}
  },
)
