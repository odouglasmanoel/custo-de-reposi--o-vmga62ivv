migrate(
  (app) => {
    // 1. Correção do jogo Geórgia x Irlanda do Norte (id: josylz3ibhdcxw3)
    // Remove Khvicha Kvaratskhelia que perdeu pênalti aos 65' e não marcou gol
    try {
      const jogo = app.findFirstRecordByData('jogos', 'id', 'josylz3ibhdcxw3')
      if (jogo) {
        jogo.set('gols_time_a', [])
        app.save(jogo)
      }
    } catch (err) {
      console.log('[0078] Erro ao atualizar jogo josylz3ibhdcxw3:', err)
    }

    // 2. Limpeza defensiva de outros jogos que possam conter Missed Penalty em gols_time_a ou gols_time_b
    try {
      const allJogos = app.findRecordsByFilter('jogos', 'id != ""', '', 500, 0)
      for (let j = 0; j < allJogos.length; j++) {
        const jRec = allJogos[j]
        let mudou = false

        const filterScorers = (gols) => {
          if (!Array.isArray(gols)) return gols
          const cleaned = []
          for (let k = 0; k < gols.length; k++) {
            const item = gols[k]
            const nome = (item?.nome || '').toString().toLowerCase()
            const pos = (item?.posicao || '').toString().toLowerCase()
            const detail = (item?.detail || '').toString().toLowerCase()
            if (
              detail.includes('missed') ||
              detail.includes('perdido') ||
              nome.includes('missed') ||
              nome.includes('perdido') ||
              pos.includes('missed') ||
              pos.includes('perdido')
            ) {
              mudou = true
              continue
            }
            cleaned.push(item)
          }
          return cleaned
        }

        const rawA = jRec.get('gols_time_a')
        if (Array.isArray(rawA) && rawA.length > 0) {
          const cleanA = filterScorers(rawA)
          if (cleanA.length !== rawA.length) {
            jRec.set('gols_time_a', cleanA)
            mudou = true
          }
        }

        const rawB = jRec.get('gols_time_b')
        if (Array.isArray(rawB) && rawB.length > 0) {
          const cleanB = filterScorers(rawB)
          if (cleanB.length !== rawB.length) {
            jRec.set('gols_time_b', cleanB)
            mudou = true
          }
        }

        if (mudou) {
          app.save(jRec)
        }
      }
    } catch (errClean) {
      console.log('[0078] Erro ao limpar scorers de jogos:', errClean)
    }

    // 3. Atualização dos palpites afetados pelo jogo josylz3ibhdcxw3
    // Willian (id: e7tn55io4fyi6o7): pontuacao_jogo 1 -> 0, detalhamento []
    try {
      const palpiteWillian = app.findFirstRecordByData('palpites', 'id', 'e7tn55io4fyi6o7')
      if (palpiteWillian) {
        palpiteWillian.set('pontuacao_jogo', 0)
        palpiteWillian.set('detalhamento', [])
        app.save(palpiteWillian)
      }
    } catch (errW) {
      console.log('[0078] Erro ao atualizar palpite Willian:', errW)
    }

    // Douglas (id: hc59nkzs1pnsimr): pontuacao_jogo 2 -> 1, detalhamento ["Metade do Placar (+1 pt)"]
    try {
      const palpiteDouglas = app.findFirstRecordByData('palpites', 'id', 'hc59nkzs1pnsimr')
      if (palpiteDouglas) {
        palpiteDouglas.set('pontuacao_jogo', 1)
        palpiteDouglas.set('detalhamento', ['Metade do Placar (+1 pt)'])
        app.save(palpiteDouglas)
      }
    } catch (errD) {
      console.log('[0078] Erro ao atualizar palpite Douglas:', errD)
    }

    // Gabriel (id: r204fzfeu761ok8): pontuacao_jogo 2 -> 1, detalhamento ["Metade do Placar (+1 pt)"]
    try {
      const palpiteGabriel = app.findFirstRecordByData('palpites', 'id', 'r204fzfeu761ok8')
      if (palpiteGabriel) {
        palpiteGabriel.set('pontuacao_jogo', 1)
        palpiteGabriel.set('detalhamento', ['Metade do Placar (+1 pt)'])
        app.save(palpiteGabriel)
      }
    } catch (errG) {
      console.log('[0078] Erro ao atualizar palpite Gabriel:', errG)
    }

    // 4. Recalcular pontuacao_total dos participantes do bolão (kr20rfjisajd6ro) mantendo pontos_importados intocáveis
    try {
      const bolaoId = 'kr20rfjisajd6ro'
      const participantes = app.findRecordsByFilter(
        'participantes',
        "bolao = '" + bolaoId + "'",
        '',
        100,
        0,
      )

      for (let i = 0; i < participantes.length; i++) {
        const part = participantes[i]
        const partPalpites = app.findRecordsByFilter(
          'palpites',
          "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
          '',
          500,
          0,
        )

        let totalAppPoints = 0
        for (let pIdx = 0; pIdx < partPalpites.length; pIdx++) {
          const p = partPalpites[pIdx]
          try {
            const g = app.findFirstRecordByData('jogos', 'id', p.getString('jogo'))
            if (g && g.getBool('resultado_finalizado')) {
              totalAppPoints += p.getInt('pontuacao_jogo')
            }
          } catch (_) {}
        }

        const pontosImportados = part.getInt('pontos_importados') || 0
        part.set('pontuacao_total', pontosImportados + totalAppPoints)
        app.save(part)
      }
    } catch (errPart) {
      console.log('[0078] Erro ao recalcular participantes:', errPart)
    }
  },
  (app) => {
    // Reverter jogo josylz3ibhdcxw3
    try {
      const jogo = app.findFirstRecordByData('jogos', 'id', 'josylz3ibhdcxw3')
      if (jogo) {
        jogo.set('gols_time_a', [
          {
            minuto: "65'",
            nome: 'Khvicha Kvaratskhelia',
            posicao: 'Atacante/Meia',
            quantidade: 1,
          },
        ])
        app.save(jogo)
      }
    } catch (_) {}

    // Reverter palpites
    try {
      const pW = app.findFirstRecordByData('palpites', 'id', 'e7tn55io4fyi6o7')
      if (pW) {
        pW.set('pontuacao_jogo', 1)
        pW.set('detalhamento', ['Gols acertados: Khvicha Kvaratskhelia [Atacante] (+1 pts)'])
        app.save(pW)
      }
    } catch (_) {}

    try {
      const pD = app.findFirstRecordByData('palpites', 'id', 'hc59nkzs1pnsimr')
      if (pD) {
        pD.set('pontuacao_jogo', 2)
        pD.set('detalhamento', [
          'Metade do Placar (+1 pt)',
          'Gols acertados: Khvicha Kvaratskhelia [Atacante] (+1 pts)',
        ])
        app.save(pD)
      }
    } catch (_) {}

    try {
      const pG = app.findFirstRecordByData('palpites', 'id', 'r204fzfeu761ok8')
      if (pG) {
        pG.set('pontuacao_jogo', 2)
        pG.set('detalhamento', [
          'Metade do Placar (+1 pt)',
          'Gols acertados: Khvicha Kvaratskhelia [Atacante] (+1 pts)',
        ])
        app.save(pG)
      }
    } catch (_) {}
  },
)
