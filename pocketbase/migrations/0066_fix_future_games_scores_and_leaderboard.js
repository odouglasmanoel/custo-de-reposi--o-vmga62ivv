migrate(
  (app) => {
    // 1. Encontrar todos os jogos
    const todosJogos = app.findRecordsByFilter('jogos', '', '', 500, 0)
    const agora = Date.now()

    const parseKickoff = (rec) => {
      try {
        const dtVal = rec.getString('data') || ''
        const hrVal = rec.getString('hora') || ''
        if (!dtVal) return null

        let y = 0,
          m = 0,
          d = 0
        const dtStr = String(dtVal).trim()
        const brM = dtStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (brM) {
          d = parseInt(brM[1], 10)
          m = parseInt(brM[2], 10)
          y = parseInt(brM[3], 10)
        } else {
          const isoM = dtStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
          if (isoM) {
            y = parseInt(isoM[1], 10)
            m = parseInt(isoM[2], 10)
            d = parseInt(isoM[3], 10)
          }
        }

        let hrs = 16,
          mins = 0
        if (hrVal) {
          const hrM = String(hrVal).match(/^(\d{1,2}):(\d{2})/)
          if (hrM) {
            hrs = parseInt(hrM[1], 10)
            mins = parseInt(hrM[2], 10)
          }
        }

        if (y && m && d) {
          return Date.UTC(y, m - 1, d, hrs + 3, mins, 0, 0)
        }
      } catch (_) {}
      return null
    }

    let jogosFuturosAfetados = 0
    let palpitesAfetados = 0

    // a) Identificar jogos futuros e reverter para pendente / resultado_finalizado=false
    for (let i = 0; i < todosJogos.length; i++) {
      const jogoRec = todosJogos[i]
      const kickoff = parseKickoff(jogoRec)

      // Se kickoff é estritamente futuro (kickoff > agora)
      if (kickoff !== null && kickoff > agora) {
        let mudou = false
        const st = (jogoRec.getString('status') || '').toLowerCase().trim()
        const resFin = jogoRec.getBool('resultado_finalizado')

        if (resFin || st === 'finalizado' || st === 'encerrado' || st === 'ft') {
          jogoRec.set('resultado_finalizado', false)
          jogoRec.set('status', 'pendente')
          app.save(jogoRec)
          mudou = true
          jogosFuturosAfetados++
        }

        // b) zera pontuacao_jogo=0 e detalhamento="Aguardando início" nos palpites desses jogos
        const palpitesJogo = app.findRecordsByFilter(
          'palpites',
          "jogo = '" + jogoRec.id + "'",
          '',
          500,
          0,
        )
        for (let pIdx = 0; pIdx < palpitesJogo.length; pIdx++) {
          const pRec = palpitesJogo[pIdx]
          pRec.set('pontuacao_jogo', 0)
          pRec.set('detalhamento', ['Aguardando início'])
          app.save(pRec)
          palpitesAfetados++
        }
      }
    }

    console.log(
      '[migration 0066] Jogos futuros corrigidos: ' +
        jogosFuturosAfetados +
        ', palpites resetados: ' +
        palpitesAfetados,
    )

    // c) recomputa pontuacao_total de cada participante somando apenas palpites de jogos válidos (kickoff passado e resultado_finalizado=true)
    const participantes = app.findRecordsByFilter('participantes', '', '', 500, 0)

    for (let partIdx = 0; partIdx < participantes.length; partIdx++) {
      const part = participantes[partIdx]
      const partPalpites = app.findRecordsByFilter(
        'palpites',
        "participante = '" + part.id + "'",
        '',
        1000,
        0,
      )

      let totalPontosValidos = 0
      for (let pI = 0; pI < partPalpites.length; pI++) {
        const palpite = partPalpites[pI]
        const jId = palpite.getString('jogo')
        try {
          const jRec = app.findRecordById('jogos', jId)
          const kMs = parseKickoff(jRec)
          const jJaIniciou = kMs !== null ? agora >= kMs : true
          const jFinalizado = jRec.getBool('resultado_finalizado')

          if (jFinalizado && jJaIniciou) {
            totalPontosValidos += palpite.getInt('pontuacao_jogo')
          }
        } catch (_) {}
      }

      const pontosImportados = part.getInt('pontos_importados') || 0
      part.set('pontuacao_total', pontosImportados + totalPontosValidos)
      app.save(part)
    }

    console.log('[migration 0066] Pontuações de todos os participantes recomputadas com sucesso.')
  },
  (app) => {
    // Reversão não é necessária para operação corretiva de dados (one-time data cleanup)
  },
)
