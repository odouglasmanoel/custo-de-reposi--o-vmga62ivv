migrate(
  (app) => {
    // 0082_restaurar_jogos_indevidamente_ao_vivo.js
    // Restauração de jogos do bolão marcados indevidamente como 'ao_vivo' com placar falso 0x0
    // cujo status real retornado pela API-Sports na ficha técnica é 'NS' (Not Started) ou 'TBD'.
    //
    // Regras estritas:
    // 1. Só limpa placar 0x0 de jogos cujo status real seja NS/TBD. Jogos em andamento real (1H, HT, 2H, etc.)
    //    ou jogos já encerrados (resultado_finalizado = true) DEVEM manter seus placares.
    // 2. Restaura o status para 'pendente' e resultado_finalizado = false.
    // 3. Atualiza os palpites dos jogos que estavam pontuando indevidamente em cima do placar falso 0x0
    //    para pontuacao_jogo = 0 e detalhamento = ['Aguardando início'].
    // 4. Reacumula pontuacao_total dos participantes do bolão apenas com jogos com resultado_finalizado = true,
    //    mantendo os pontos_importados intactos.
    console.log(
      '[migration 0082] Iniciando restauração de jogos marcados indevidamente como Ao Vivo...',
    )

    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')
      if (!jogosCol) return

      // Buscar todos os jogos marcados como 'ao_vivo' e que NÃO estão finalizados
      const jogosAoVivo = app.findRecordsByFilter(
        'jogos',
        "status = 'ao_vivo' && resultado_finalizado = false",
        '-created',
        100,
        0,
      )

      console.log(
        '[migration 0082] Encontrados ' + jogosAoVivo.length + ' jogos com status="ao_vivo"',
      )

      const boloesAfetados = {}

      for (let i = 0; i < jogosAoVivo.length; i++) {
        const jRec = jogosAoVivo[i]
        const pA = jRec.getInt('placar_a')
        const pB = jRec.getInt('placar_b')
        const fid = (jRec.getString('fixture_id') || '').trim()

        let isRealmenteNS = false

        // 1. Verificar ficha_detalhes salva no jogo
        const rawFicha = jRec.get('ficha_detalhes')
        if (rawFicha) {
          try {
            let fichaObj = typeof rawFicha === 'string' ? JSON.parse(rawFicha) : rawFicha
            const stShort = (
              (fichaObj.fixture_status && fichaObj.fixture_status.short) ||
              (fichaObj.fixture && fichaObj.fixture.status && fichaObj.fixture.status.short) ||
              ''
            )
              .toString()
              .toUpperCase()
              .trim()

            if (['NS', 'TBD', ''].indexOf(stShort) !== -1) {
              isRealmenteNS = true
            }
          } catch (_) {}
        }

        // Se o placar for 0x0 e ficha indicar NS/TBD, ou se não há eventos e placar é 0x0
        if (isRealmenteNS && pA === 0 && pB === 0) {
          console.log(
            '[migration 0082] Restaurando jogo indevido: ' +
              jRec.id +
              ' (' +
              jRec.getString('time_a') +
              ' x ' +
              jRec.getString('time_b') +
              ', fixture: ' +
              fid +
              ')',
          )

          jRec.set('status', 'pendente')
          jRec.set('resultado_finalizado', false)
          // Limpa placar falso 0x0
          jRec.set('placar_a', null)
          jRec.set('placar_b', null)
          jRec.set('gols_time_a', [])
          jRec.set('gols_time_b', [])
          jRec.set('marcadores', [])
          app.save(jRec)

          const bId = jRec.getString('bolao')
          if (bId) boloesAfetados[bId] = true

          // Atualiza palpites vinculados para não pontuar antes do início real
          try {
            const palpitesJogo = app.findRecordsByFilter(
              'palpites',
              "jogo = '" + jRec.id + "'",
              '',
              100,
              0,
            )
            for (let pi = 0; pi < palpitesJogo.length; pi++) {
              const palpite = palpitesJogo[pi]
              palpite.set('pontuacao_jogo', 0)
              palpite.set('detalhamento', ['Aguardando início'])
              app.save(palpite)
            }
          } catch (errPalpites) {
            console.log(
              '[migration 0082] Erro ao zerar palpites do jogo ' + jRec.id + ':',
              errPalpites,
            )
          }
        } else {
          console.log(
            '[migration 0082] Mantendo jogo ' +
              jRec.id +
              ' (' +
              jRec.getString('time_a') +
              ' x ' +
              jRec.getString('time_b') +
              ') - Placar: ' +
              pA +
              'x' +
              pB +
              ' (isRealmenteNS=' +
              isRealmenteNS +
              ')',
          )
        }
      }

      // Reacumular pontuação total dos participantes nos bolões afetados
      const bolaoIds = Object.keys(boloesAfetados)
      for (let bi = 0; bi < bolaoIds.length; bi++) {
        const bolaoId = bolaoIds[bi]
        console.log('[migration 0082] Reacumulando pontuação do bolão ' + bolaoId + '...')
        try {
          const participantes = app.findRecordsByFilter(
            'participantes',
            "bolao = '" + bolaoId + "'",
            '',
            100,
            0,
          )
          for (let pi = 0; pi < participantes.length; pi++) {
            const part = participantes[pi]
            const partPalpites = app.findRecordsByFilter(
              'palpites',
              "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
              '',
              500,
              0,
            )
            let totalPoints = 0
            for (let ppi = 0; ppi < partPalpites.length; ppi++) {
              const p = partPalpites[ppi]
              try {
                const gameRec = app.findRecordById('jogos', p.getString('jogo'))
                if (gameRec && gameRec.getBool('resultado_finalizado')) {
                  totalPoints += p.getInt('pontuacao_jogo')
                }
              } catch (_) {}
            }
            const importedPts = part.getInt('pontos_importados') || 0
            part.set('pontuacao_total', importedPts + totalPoints)
            app.save(part)
          }
        } catch (errPart) {
          console.log(
            '[migration 0082] Erro ao recalcular participantes do bolão ' + bolaoId + ':',
            errPart,
          )
        }
      }

      console.log('[migration 0082] Restauração concluída com sucesso.')
    } catch (err) {
      console.log('[migration 0082] Erro na migração de restauração:', err)
    }
  },
  (app) => {
    // Rollback não aplicável
  },
)
