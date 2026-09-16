migrate(
  (app) => {
    // Cria a collection config_integracoes para armazenar parâmetros e chaves de APIs externas (ex: Placar Ao Vivo)
    // Acesso: somente Admin autenticado pode gerenciar. Chave crua não é exposta a usuários não-autorizados.
    const collection = new Collection({
      name: 'config_integracoes',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'chave',
          type: 'text',
          required: true,
        },
        {
          name: 'provedor',
          type: 'select',
          required: true,
          values: ['football_data', 'thesportsdb', 'api_football'],
          maxSelect: 1,
        },
        {
          name: 'api_key',
          type: 'text',
          required: false,
        },
        {
          name: 'ativo',
          type: 'bool',
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
      indexes: ['CREATE UNIQUE INDEX idx_config_integracoes_chave ON config_integracoes (chave)'],
    })

    app.save(collection)

    // Semente inicial: registro para placar_ao_vivo com provedor football_data (sem chave configurada ainda)
    try {
      const record = new Record(collection)
      record.set('chave', 'placar_ao_vivo')
      record.set('provedor', 'football_data')
      record.set('api_key', '')
      record.set('ativo', true)
      app.save(record)
    } catch (err) {
      console.log('Aviso ao semear config_integracoes:', err)
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('config_integracoes')
      app.delete(collection)
    } catch (_) {}
  },
)
