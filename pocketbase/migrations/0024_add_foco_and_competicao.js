migrate(
  (app) => {
    // 1. Adicionar campo 'foco' (texto, opcional) na collection 'boloes'
    const boloesCol = app.findCollectionByNameOrId('boloes')
    if (!boloesCol.fields.getByName('foco')) {
      boloesCol.fields.add(
        new TextField({
          name: 'foco',
          required: false,
        }),
      )
      app.save(boloesCol)
    }

    // 2. Adicionar campo 'competicao' (texto, opcional) na collection 'jogos'
    const jogosCol = app.findCollectionByNameOrId('jogos')
    if (!jogosCol.fields.getByName('competicao')) {
      jogosCol.fields.add(
        new TextField({
          name: 'competicao',
          required: false,
        }),
      )
      app.save(jogosCol)
    }

    // 3. Popular focos dos três bolões existentes com os valores exatos:
    // Copa Coni: "Jogos Aleatórios"
    // Copa Genilton: "Copa do Brasil"
    // Copa Sormani: "Libertadores e Sulamericana"
    const boloes = app.findRecordsByFilter('boloes', '', '', 50, 0)
    for (const b of boloes) {
      const nome = b.getString('nome').trim()
      let updated = false

      if (nome === 'Copa Coni') {
        b.set('foco', 'Jogos Aleatórios')
        updated = true
      } else if (nome === 'Copa Genilton') {
        b.set('foco', 'Copa do Brasil')
        updated = true
      } else if (nome === 'Copa Sormani') {
        b.set('foco', 'Libertadores e Sulamericana')
        updated = true
      }

      if (updated) {
        app.save(b)
      }
    }
  },
  (app) => {
    try {
      const boloesCol = app.findCollectionByNameOrId('boloes')
      if (boloesCol.fields.getByName('foco')) {
        boloesCol.fields.removeByName('foco')
        app.save(boloesCol)
      }
    } catch (_) {}

    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      if (jogosCol.fields.getByName('competicao')) {
        jogosCol.fields.removeByName('competicao')
        app.save(jogosCol)
      }
    } catch (_) {}
  },
)
