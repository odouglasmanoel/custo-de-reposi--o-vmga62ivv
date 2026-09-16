migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    // Seed default operator and participant accounts
    const seedUsers = [
      { email: 'gil.araujo@repress.com.br', name: 'Gil Araujo' },
      { email: 'douglas@repress.com.br', name: 'Douglas' },
      { email: 'gabriel@repress.com.br', name: 'Gabriel' },
      { email: 'bruno@repress.com.br', name: 'Bruno' },
      { email: 'davi@repress.com.br', name: 'Davi' },
    ]

    for (const u of seedUsers) {
      try {
        app.findAuthRecordByEmail('_pb_users_auth_', u.email)
      } catch (_) {
        const rec = new Record(users)
        rec.setEmail(u.email)
        rec.setPassword('Skip@Pass')
        rec.setVerified(true)
        rec.set('name', u.name)
        app.save(rec)
      }
    }

    // Seed rules in regras
    try {
      app.findFirstRecordByData('regras', 'titulo', 'Regras Oficiais do Bolão')
    } catch (_) {
      const regrasCol = app.findCollectionByNameOrId('regras')
      const recRegras = new Record(regrasCol)
      recRegras.set('titulo', 'Regras Oficiais do Bolão')
      recRegras.set(
        'conteudo',
        [
          '# Regras Oficiais de Pontuação do Bolão',
          '',
          '## Pontuação de Placares:',
          '- Cravar o placar exato: 8 pontos.',
          '- Acertar o vencedor ou empate (mas não o placar exato): 2 pontos.',
          '- Acertar a diferença de gols do placar final: +1 ponto adicional.',
          '- Acertar a quantidade exata de gols de um dos times (metade do placar): +1 ponto adicional.',
          '',
          '## Pontuação Extra (Autores dos Gols e Eventos):',
          '- Gol de atacante ou meio-campista: +1 ponto por gol acertado.',
          '- Gol de zagueiro ou lateral: +3 pontos por gol acertado.',
          '- Gol de goleiro: +10 pontos por gol acertado.',
          '- Gol contra (acertando o jogador): +5 pontos por gol acertado.',
          '- Acertar o vencedor na disputa por pênaltis: +2 pontos.',
          '',
          '## Observações:',
          '- Mapeamento e normalização de nomes de jogadores podem ser realizados pelo administrador Douglas para padronização de grafias.',
          '- O cálculo de pontuação é disparado automaticamente ao salvar o resultado oficial de cada partida.',
        ].join('\n'),
      )
      app.save(recRegras)
    }

    // Seed 3 boloes (Copa Coni, Copa Genilton, Copa Sormani) and 4 participants per bolão with 0 points
    const boloesCol = app.findCollectionByNameOrId('boloes')
    const partCol = app.findCollectionByNameOrId('participantes')

    const boloesSeed = [
      { nome: 'Copa Coni', ativo: true },
      { nome: 'Copa Genilton', ativo: false },
      { nome: 'Copa Sormani', ativo: false },
    ]

    const nomesParticipantes = ['Douglas', 'Gabriel', 'Bruno', 'Davi']

    for (const b of boloesSeed) {
      let bolaoRec
      try {
        bolaoRec = app.findFirstRecordByData('boloes', 'nome', b.nome)
      } catch (_) {
        bolaoRec = new Record(boloesCol)
        bolaoRec.set('nome', b.nome)
        bolaoRec.set('ativo', b.ativo)
        app.save(bolaoRec)
      }

      // Seed participants for this pool if not present
      for (const nome of nomesParticipantes) {
        try {
          const existing = app.findRecordsByFilter(
            'participantes',
            `bolao = '${bolaoRec.id}' && nome = '${nome}'`,
            '',
            1,
            0,
          )
          if (existing.length === 0) {
            const part = new Record(partCol)
            part.set('bolao', bolaoRec.id)
            part.set('nome', nome)
            part.set('pontuacao_total', 0)
            app.save(part)
          }
        } catch (_) {
          const part = new Record(partCol)
          part.set('bolao', bolaoRec.id)
          part.set('nome', nome)
          part.set('pontuacao_total', 0)
          app.save(part)
        }
      }
    }
  },
  (app) => {
    // down migration
  },
)
