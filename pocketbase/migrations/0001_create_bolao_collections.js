migrate(
  (app) => {
    // 1. boloes
    const boloes = new Collection({
      name: 'boloes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.name = 'Douglas'",
      updateRule: "@request.auth.name = 'Douglas'",
      deleteRule: "@request.auth.name = 'Douglas'",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'ativo', type: 'bool' },
        { name: 'ultima_atualizacao', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_boloes_nome ON boloes (nome)',
        'CREATE INDEX idx_boloes_ativo ON boloes (ativo)',
      ],
    })
    app.save(boloes)

    // 2. regras
    const regras = new Collection({
      name: 'regras',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'titulo', type: 'text', required: true },
        { name: 'conteudo', type: 'text', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(regras)

    const boloesId = app.findCollectionByNameOrId('boloes').id

    // 3. participantes
    const participantes = new Collection({
      name: 'participantes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.name = 'Douglas'",
      updateRule: "@request.auth.name = 'Douglas'",
      deleteRule: "@request.auth.name = 'Douglas'",
      fields: [
        {
          name: 'bolao',
          type: 'relation',
          required: true,
          collectionId: boloesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'nome', type: 'text', required: true },
        { name: 'pontuacao_total', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_participantes_bolao_nome ON participantes (bolao, nome)',
        'CREATE INDEX idx_participantes_bolao ON participantes (bolao)',
        'CREATE INDEX idx_participantes_pontuacao ON participantes (pontuacao_total)',
      ],
    })
    app.save(participantes)

    // 4. jogos
    const jogos = new Collection({
      name: 'jogos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.name = 'Douglas'",
      updateRule: "@request.auth.name = 'Douglas'",
      deleteRule: "@request.auth.name = 'Douglas'",
      fields: [
        {
          name: 'bolao',
          type: 'relation',
          required: true,
          collectionId: boloesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'time_a', type: 'text', required: true },
        { name: 'time_b', type: 'text', required: true },
        { name: 'data', type: 'date', required: true },
        { name: 'hora', type: 'text', required: true },
        { name: 'placar_a', type: 'number' },
        { name: 'placar_b', type: 'number' },
        { name: 'resultado_finalizado', type: 'bool' },
        { name: 'gols_time_a', type: 'json' },
        { name: 'gols_time_b', type: 'json' },
        { name: 'tem_penaltis', type: 'bool' },
        { name: 'vencedor_penaltis', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_jogos_bolao ON jogos (bolao)',
        'CREATE INDEX idx_jogos_data ON jogos (data)',
        'CREATE INDEX idx_jogos_resultado ON jogos (resultado_finalizado)',
      ],
    })
    app.save(jogos)

    const jogosId = app.findCollectionByNameOrId('jogos').id
    const participantesId = app.findCollectionByNameOrId('participantes').id

    // 5. palpites
    const palpites = new Collection({
      name: 'palpites',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: null,
      fields: [
        {
          name: 'bolao',
          type: 'relation',
          required: true,
          collectionId: boloesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'jogo',
          type: 'relation',
          required: true,
          collectionId: jogosId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'participante',
          type: 'relation',
          required: true,
          collectionId: participantesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'placar_a', type: 'number', required: true },
        { name: 'placar_b', type: 'number', required: true },
        { name: 'goleadores_a', type: 'json' },
        { name: 'goleadores_b', type: 'json' },
        { name: 'vencedor_penaltis', type: 'text' },
        { name: 'pontuacao_jogo', type: 'number' },
        { name: 'detalhamento', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_palpites_jogo_participante ON palpites (jogo, participante)',
        'CREATE INDEX idx_palpites_bolao ON palpites (bolao)',
        'CREATE INDEX idx_palpites_jogo ON palpites (jogo)',
        'CREATE INDEX idx_palpites_participante ON palpites (participante)',
      ],
    })
    app.save(palpites)

    // 6. normalizacoes
    const normalizacoes = new Collection({
      name: 'normalizacoes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.name = 'Douglas'",
      updateRule: "@request.auth.name = 'Douglas'",
      deleteRule: "@request.auth.name = 'Douglas'",
      fields: [
        {
          name: 'bolao',
          type: 'relation',
          required: true,
          collectionId: boloesId,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'nome_original', type: 'text', required: true },
        { name: 'nome_correto', type: 'text', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_norm_bolao_orig ON normalizacoes (bolao, nome_original)'],
    })
    app.save(normalizacoes)
  },
  (app) => {
    const toDelete = ['normalizacoes', 'palpites', 'jogos', 'participantes', 'regras', 'boloes']
    for (const name of toDelete) {
      try {
        const col = app.findCollectionByNameOrId(name)
        app.delete(col)
      } catch (_) {}
    }
  },
)
