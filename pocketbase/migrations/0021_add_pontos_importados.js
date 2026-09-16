migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('participantes')
    if (!col.fields.getByName('pontos_importados')) {
      col.fields.add(
        new NumberField({
          name: 'pontos_importados',
          required: false,
        }),
      )
      app.save(col)
    }

    // Inicializar pontos_importados e recalcular pontuacao_total baseado nos jogos existentes e finalizados
    const allParticipants = app.findRecordsByFilter('participantes', '', '', 500, 0)
    for (const part of allParticipants) {
      const bolaoId = part.getString('bolao')
      const partId = part.id

      // Palpites do participante para jogos existentes desse bolão
      const partPalpites = app.findRecordsByFilter(
        'palpites',
        "bolao = '" + bolaoId + "' && participante = '" + partId + "'",
        '',
        500,
        0,
      )

      let totalJogos = 0
      for (const p of partPalpites) {
        const jId = p.getString('jogo')
        try {
          const gameRec = app.findRecordById('jogos', jId)
          if (gameRec && gameRec.getBool('resultado_finalizado')) {
            totalJogos += p.getInt('pontuacao_jogo')
          }
        } catch (_) {}
      }

      // Se não há jogos nesse bolão e for Douglas na Copa Coni (que estava com 10 pts pelo jogo excluído):
      // totalJogos será 0 e pontos_importados será 0.
      const importedPts = part.getInt('pontos_importados') || 0
      part.set('pontos_importados', importedPts)
      part.set('pontuacao_total', importedPts + totalJogos)
      app.save(part)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('participantes')
      const f = col.fields.getByName('pontos_importados')
      if (f) {
        col.fields.removeByName('pontos_importados')
        app.save(col)
      }
    } catch (_) {}
  },
)
