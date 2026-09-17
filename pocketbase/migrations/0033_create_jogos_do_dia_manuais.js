migrate(
  (app) => {
    // Nova coleção exclusiva para jogos do dia inseridos/editados manualmente pelo Admin
    // NÃO altera nenhuma coleção ou estrutura existente do banco ou bolão.
    const collection = new Collection({
      name: 'jogos_do_dia_manuais',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'time_casa',
          type: 'text',
          required: true,
        },
        {
          name: 'time_visitante',
          type: 'text',
          required: true,
        },
        {
          name: 'data',
          type: 'text', // YYYY-MM-DD
          required: true,
        },
        {
          name: 'horario',
          type: 'text', // HH:mm
          required: true,
        },
        {
          name: 'campeonato',
          type: 'text',
          required: true,
        },
        {
          name: 'regiao',
          type: 'select',
          required: false,
          values: ['Brasileirão & Copas', 'Sul-Americana', 'Futebol Europeu', 'Outros'],
          maxSelect: 1,
        },
        {
          name: 'placar_casa',
          type: 'number',
          required: false,
        },
        {
          name: 'placar_visitante',
          type: 'number',
          required: false,
        },
        {
          name: 'status',
          type: 'text', // NS, 1H, HT, 2H, FT, PST, CANC
          required: false,
        },
        {
          name: 'logo_casa',
          type: 'text',
          required: false,
        },
        {
          name: 'logo_visitante',
          type: 'text',
          required: false,
        },
        {
          name: 'observacao',
          type: 'text',
          required: false,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        'CREATE INDEX idx_jogos_manuais_data ON jogos_do_dia_manuais (data)',
        'CREATE INDEX idx_jogos_manuais_campeonato ON jogos_do_dia_manuais (campeonato)',
      ],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('jogos_do_dia_manuais')
      app.delete(collection)
    } catch (_) {}
  },
)
