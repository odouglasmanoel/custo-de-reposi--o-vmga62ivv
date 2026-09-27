migrate(
  (app) => {
    try {
      const jogo = app.findFirstRecordByData('jogos', 'id', '7jw0qhdmlvt0ghp')
      if (jogo) {
        // Lituânia: A. Kučys (9' Penalty)
        const golsA = [
          {
            nome: 'A. Kučys',
            posicao: 'Atacante/Meia',
            quantidade: 1,
            minuto: 9,
          },
        ]

        // Azerbaijão: Mahir Emreli (14' Normal Goal)
        const golsB = [
          {
            nome: 'Mahir Emreli',
            posicao: 'Atacante/Meia',
            quantidade: 1,
            minuto: 14,
          },
        ]

        jogo.set('gols_time_a', golsA)
        jogo.set('gols_time_b', golsB)
        jogo.set('placar_a', 1)
        jogo.set('placar_b', 1)
        jogo.set('marcadores', ["A. Kučys 9'", "Mahir Emreli 14'"])
        jogo.set('url_escudo_mandante', 'https://media.api-sports.io/football/teams/1097.png')
        jogo.set('url_escudo_visitante', 'https://media.api-sports.io/football/teams/1096.png')

        app.save(jogo)
      }
    } catch (_) {}
  },
  (app) => {
    // no-op revert
  },
)
