/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log('[migration 0089] Executando busca de eventos e marcadores para fixtures do dia...')

    // Chave ativa configurada
    let apiKey = 'c751e27823d47d81ff5e52f658755c58'
    try {
      const cfg = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (cfg && cfg.getBool('ativo') && cfg.getString('api_key')) {
        apiKey = cfg.getString('api_key').trim()
      }
    } catch (_) {}

    // Fixtures do dia incluindo Tchéquia x Croácia (1528892) e outros jogos de hoje
    const targetFixtures = ['1528892', '1628997', '1528891', '1528895']
    const boloesAfetados = {}

    for (let f = 0; f < targetFixtures.length; f++) {
      const fid = targetFixtures[f]
      try {
        const urlEvents = 'https://v3.football.api-sports.io/fixtures/events?fixture=' + fid
        console.log('[migration 0089] Buscando eventos para fixture ' + fid + '...')

        const res = $http.send({
          url: urlEvents,
          method: 'GET',
          headers: {
            'x-apisports-key': apiKey,
          },
          timeout: 15,
        })

        if (!res || res.statusCode !== 200) {
          console.log(
            '[migration 0089] Fixture ' + fid + ' status HTTP: ' + (res ? res.statusCode : 'null'),
          )
          continue
        }

        let json = null
        try {
          json = typeof res.json === 'object' && res.json !== null ? res.json : JSON.parse(res.raw)
        } catch (_) {}

        if (!json || !Array.isArray(json.response)) {
          console.log('[migration 0089] Fixture ' + fid + ' sem response válida no JSON.')
          continue
        }

        const events = json.response
        console.log('[migration 0089] Fixture ' + fid + ' retornou ' + events.length + ' eventos.')

        const matchingJogos = app.findRecordsByFilter(
          'jogos',
          "fixture_id = '" + fid + "'",
          '',
          10,
          0,
        )

        if (matchingJogos.length === 0) {
          console.log('[migration 0089] Nenhum jogo encontrado com fixture_id ' + fid)
          continue
        }

        for (let j = 0; j < matchingJogos.length; j++) {
          const jRec = matchingJogos[j]
          const homeTeamName = (jRec.getString('time_a') || '').toLowerCase().trim()
          const awayTeamName = (jRec.getString('time_b') || '').toLowerCase().trim()

          const golsA = []
          const golsB = []
          const marcadoresGerais = []

          const normalizedEvents = events.map((ev) => {
            const typeStr = (ev.type || '').toString().toLowerCase()
            const detailStr = (ev.detail || '').toString().toLowerCase()
            let category = 'other'
            if (typeStr === 'goal') category = 'goal'
            else if (typeStr === 'card') category = 'card'
            else if (typeStr.includes('subst')) category = 'subst'

            return {
              time: {
                elapsed: ev.time?.elapsed ?? null,
                extra: ev.time?.extra ?? null,
              },
              team: {
                id: ev.team?.id ?? null,
                name: ev.team?.name ?? '',
                logo: ev.team?.logo ?? '',
              },
              player: {
                id: ev.player?.id ?? null,
                name: ev.player?.name ?? '',
              },
              assist: {
                id: ev.assist?.id ?? null,
                name: ev.assist?.name ?? null,
              },
              type: ev.type || '',
              detail: ev.detail || '',
              comments: ev.comments || null,
              category: category,
            }
          })

          for (let i = 0; i < events.length; i++) {
            const ev = events[i]
            if ((ev.type || '').toString().toLowerCase() === 'goal') {
              const detail = (ev.detail || '').toString().toLowerCase().trim()
              if (
                detail.includes('missed') ||
                detail.includes('perdido') ||
                detail.includes('missed penalty') ||
                detail.includes('penalty missed')
              ) {
                continue
              }

              let minuteInt = null
              if (ev.time && ev.time.elapsed != null) {
                const parsedM = parseInt(ev.time.elapsed, 10)
                if (!isNaN(parsedM)) minuteInt = parsedM
              }
              const minuteStr = minuteInt !== null ? `${minuteInt}'` : ''
              const isContra = detail.includes('own') || detail.includes('contra')
              const playerName = (ev.player?.name || '').toString().trim()
              const evTeamName = (ev.team?.name || '').toString().toLowerCase().trim()

              if (playerName) {
                let posicao = 'Atacante/Meia'
                if (isContra) posicao = 'Gol Contra'

                const item = {
                  nome: playerName,
                  posicao: posicao,
                  quantidade: 1,
                  minuto: minuteStr,
                }

                let pertenceA = false
                let pertenceB = false
                if (evTeamName) {
                  if (
                    homeTeamName &&
                    (homeTeamName.includes(evTeamName) || evTeamName.includes(homeTeamName))
                  ) {
                    pertenceA = true
                  } else if (
                    awayTeamName &&
                    (awayTeamName.includes(evTeamName) || evTeamName.includes(awayTeamName))
                  ) {
                    pertenceB = true
                  }
                }

                if (pertenceA) {
                  golsA.push(item)
                } else if (pertenceB) {
                  golsB.push(item)
                } else {
                  // Fallback se evTeamName não bateu exato
                  if (golsA.length === 0) golsA.push(item)
                  else golsB.push(item)
                }

                marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
              }
            }
          }

          if (golsA.length > 0) jRec.set('gols_time_a', golsA)
          if (golsB.length > 0) jRec.set('gols_time_b', golsB)
          if (marcadoresGerais.length > 0) jRec.set('marcadores', marcadoresGerais)

          const fichaPayload = {
            success: true,
            cached: false,
            source: 'api_football_migration_0089',
            fixture_id: fid,
            teams: {
              home: { name: jRec.getString('time_a') },
              away: { name: jRec.getString('time_b') },
            },
            goals: { home: jRec.getInt('placar_a'), away: jRec.getInt('placar_b') },
            events: normalizedEvents,
            updatedAt: new Date().toISOString(),
          }
          jRec.set('ficha_detalhes', fichaPayload)

          app.save(jRec)
          console.log(
            '[migration 0089] Jogo ' +
              jRec.getString('time_a') +
              ' x ' +
              jRec.getString('time_b') +
              ' atualizado com ' +
              marcadoresGerais.length +
              ' marcadores.',
          )

          const bId = jRec.getString('bolao')
          if (bId) boloesAfetados[bId] = true
        }
      } catch (errLoop) {
        console.log('[migration 0089] Erro na fixture ' + fid + ':', errLoop)
      }
    }

    // Recálculo de pontuações dos palpites e totais dos participantes
    try {
      const stripAccents = (str) => {
        if (!str) return ''
        let s = String(str)
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        return s
          .replace(/[áàâãä]/gi, 'a')
          .replace(/[éèêë]/gi, 'e')
          .replace(/[íìîï]/gi, 'i')
          .replace(/[óòôõö]/gi, 'o')
          .replace(/[úùûü]/gi, 'u')
          .replace(/[ç]/gi, 'c')
          .replace(/[ñ]/gi, 'n')
      }

      const parseJsonField = (rec, fieldName) => {
        try {
          const raw = rec.get(fieldName)
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
            const str = String.fromCharCode.apply(null, raw)
            const parsed = JSON.parse(str)
            if (Array.isArray(parsed)) return parsed
          }
          if (Array.isArray(raw)) return raw
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            const parsed = JSON.parse(strVal)
            if (Array.isArray(parsed)) return parsed
          }
        } catch (_) {}
        try {
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            return strVal
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          }
        } catch (_) {}
        return []
      }

      const getWinner = (a, b) => {
        if (a > b) return 1
        if (b > a) return -1
        return 0
      }

      const boloesIds = Object.keys(boloesAfetados)
      for (let bi = 0; bi < boloesIds.length; bi++) {
        const bolaoId = boloesIds[bi]

        let normMap = {}
        try {
          const normalizacoes = app.findRecordsByFilter(
            'normalizacoes',
            "bolao = '" + bolaoId + "'",
            '',
            500,
            0,
          )
          for (let ni = 0; ni < normalizacoes.length; ni++) {
            const n = normalizacoes[ni]
            const orig = stripAccents(n.getString('nome_original') || '')
              .toLowerCase()
              .trim()
            const corr = stripAccents(n.getString('nome_correto') || '')
              .toLowerCase()
              .trim()
            if (orig && corr) normMap[orig] = corr
          }
        } catch (_) {}

        const normalizePlayerName = (name) => {
          if (!name) return ''
          let clean = stripAccents(String(name).toLowerCase().trim())
          if (normMap[clean]) clean = stripAccents(normMap[clean])
          return clean
        }

        const jogosDoBolao = app.findRecordsByFilter(
          'jogos',
          "bolao = '" + bolaoId + "'",
          '',
          200,
          0,
        )

        for (let gi = 0; gi < jogosDoBolao.length; gi++) {
          const jRec = jogosDoBolao[gi]
          const statusAtualJogo = (jRec.getString('status') || '').toLowerCase().trim()
          const STATUS_INICIADOS = [
            'em_andamento',
            'ao_vivo',
            '1h',
            '2h',
            'ht',
            'finalizado',
            'encerrado',
            'ft',
            'finished',
          ]
          const statusIniciado = STATUS_INICIADOS.indexOf(statusAtualJogo) >= 0
          const jogoIniciou = statusIniciado || jRec.getBool('resultado_finalizado')

          const placarRealA = jRec.getInt('placar_a')
          const placarRealB = jRec.getInt('placar_b')
          const temPenaltis = jRec.getBool('tem_penaltis')
          const vencedorPenaltisReal = (jRec.getString('vencedor_penaltis') || '')
            .toUpperCase()
            .trim()

          const golsTimeA = parseJsonField(jRec, 'gols_time_a')
          const golsTimeB = parseJsonField(jRec, 'gols_time_b')

          const realWinner = getWinner(placarRealA, placarRealB)
          const realDiff = Math.abs(placarRealA - placarRealB)

          const realScorersMap = {}
          const processScorer = (item) => {
            if (!item || !item.nome) return
            const rawNome = String(item.nome).trim()
            const cleanNome = rawNome
              .replace(/\s*\d+\s*['’]/g, '')
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
            const norm = normalizePlayerName(cleanNome)
            if (!norm) return

            const count = parseInt(item.quantidade, 10) || 1
            const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
            let pts = 1
            if (
              pos.indexOf('zagueiro') >= 0 ||
              pos.indexOf('lateral') >= 0 ||
              pos.indexOf('defensor') >= 0
            ) {
              pts = 3
            } else if (pos.indexOf('goleiro') >= 0) {
              pts = 10
            } else if (pos.indexOf('contra') >= 0) {
              pts = 5
            }

            const posLabel =
              item.posicao ||
              (pts === 3
                ? 'Defensor'
                : pts === 10
                  ? 'Goleiro'
                  : pts === 5
                    ? 'Gol Contra'
                    : 'Atacante')
            const mins = []
            const minRegex = /(\d+)\s*['’]/g
            let mMatch
            while ((mMatch = minRegex.exec(rawNome)) !== null) {
              const num = parseInt(mMatch[1], 10)
              if (!isNaN(num)) mins.push(num)
            }

            if (realScorersMap[norm]) {
              realScorersMap[norm].countReal += count
              if (mins.length > 0)
                realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
            } else {
              realScorersMap[norm] = {
                displayName: cleanNome,
                norm: norm,
                points: pts,
                position: posLabel,
                countReal: count,
                minutes: mins,
              }
            }
          }

          for (let a = 0; a < golsTimeA.length; a++) processScorer(golsTimeA[a])
          for (let b = 0; b < golsTimeB.length; b++) processScorer(golsTimeB[b])

          const palpitesDoJogo = app.findRecordsByFilter(
            'palpites',
            "jogo = '" + jRec.id + "'",
            '',
            100,
            0,
          )

          for (let pi = 0; pi < palpitesDoJogo.length; pi++) {
            const palpite = palpitesDoJogo[pi]
            let pontos = 0
            const detalhamento = []

            if (!jogoIniciou) {
              palpite.set('pontuacao_jogo', 0)
              palpite.set('detalhamento', ['Aguardando início'])
              app.save(palpite)
              continue
            }

            const palpiteA = palpite.getInt('placar_a')
            const palpiteB = palpite.getInt('placar_b')
            const predWinner = getWinner(palpiteA, palpiteB)
            const predDiff = Math.abs(palpiteA - palpiteB)
            const isExact = palpiteA === placarRealA && palpiteB === placarRealB

            if (isExact) {
              pontos += 8
              detalhamento.push('Placar Exato (+8 pts)')
            } else {
              if (predWinner === realWinner) {
                if (realWinner === 0) {
                  pontos += 2
                  detalhamento.push('Empate (+2 pts)')
                } else {
                  pontos += 2
                  detalhamento.push('Vencedor (+2 pts)')
                }
              }

              if (predDiff === realDiff && predWinner === realWinner) {
                pontos += 1
                detalhamento.push('Diferença de Gols (+1 pt)')
              }

              if (palpiteA === placarRealA || palpiteB === placarRealB) {
                pontos += 1
                detalhamento.push('Metade do Placar (+1 pt)')
              }
            }

            const predScorersA = parseJsonField(palpite, 'goleadores_a')
            const predScorersB = parseJsonField(palpite, 'goleadores_b')

            const predInfo = {}
            const addPredScorer = (p) => {
              if (!p) return
              const pStr = typeof p === 'string' ? p : String(p.nome || '')
              const cleanP = pStr
                .replace(/\s*\d+\s*['’]/g, '')
                .replace(/\(gol contra\)|\(contra\)/gi, '')
                .trim()
              const normP = normalizePlayerName(cleanP)
              if (!normP) return

              const pPos = typeof p === 'object' && p !== null ? p.posicao : undefined
              const pContra =
                (typeof p === 'object' && p !== null && p.gol_contra === true) ||
                /\(gol contra\)|\(contra\)/i.test(pStr) ||
                String(pPos || '')
                  .toLowerCase()
                  .indexOf('contra') >= 0

              if (predInfo[normP]) {
                predInfo[normP].count += 1
                if (!predInfo[normP].posicao && pPos) predInfo[normP].posicao = pPos
                if (pContra) predInfo[normP].golContra = true
              } else {
                predInfo[normP] = { count: 1, posicao: pPos, golContra: pContra }
              }
            }

            for (let sa = 0; sa < predScorersA.length; sa++) addPredScorer(predScorersA[sa])
            for (let sb = 0; sb < predScorersB.length; sb++) addPredScorer(predScorersB[sb])

            const matchedScorers = []
            for (const normPred in predInfo) {
              const itemInfo = predInfo[normPred]
              const countPalpite = itemInfo.count
              let matchedReal = realScorersMap[normPred]
              if (!matchedReal) {
                for (const rNorm in realScorersMap) {
                  if (rNorm.indexOf(normPred) >= 0 || normPred.indexOf(rNorm) >= 0) {
                    matchedReal = realScorersMap[rNorm]
                    break
                  }
                }
              }

              if (matchedReal && matchedReal.countReal > 0) {
                const g = Math.min(matchedReal.countReal, countPalpite)
                if (g > 0) {
                  const targetPosStr = String(itemInfo.posicao || matchedReal.position || '')
                    .toLowerCase()
                    .trim()
                  let unitPoints = matchedReal.points
                  let displayPos = matchedReal.position

                  if (itemInfo.golContra || targetPosStr.indexOf('contra') >= 0) {
                    unitPoints = 5
                    displayPos = 'Gol Contra'
                  } else if (
                    targetPosStr.indexOf('defensor') >= 0 ||
                    targetPosStr.indexOf('zagueiro') >= 0 ||
                    targetPosStr.indexOf('lateral') >= 0 ||
                    targetPosStr === 'd'
                  ) {
                    unitPoints = 3
                    displayPos = 'Defensor'
                  } else if (targetPosStr.indexOf('goleiro') >= 0 || targetPosStr === 'g') {
                    unitPoints = 10
                    displayPos = 'Goleiro'
                  } else if (
                    targetPosStr.indexOf('atacante') >= 0 ||
                    targetPosStr.indexOf('meia') >= 0 ||
                    targetPosStr.indexOf('meio') >= 0 ||
                    targetPosStr === 'a'
                  ) {
                    unitPoints = 1
                    displayPos = 'Atacante'
                  }

                  const ptsTotal = g * unitPoints
                  pontos += ptsTotal
                  matchedScorers.push(
                    matchedReal.displayName + ' [' + displayPos + '] (+' + ptsTotal + ' pts)',
                  )
                }
              }
            }

            if (matchedScorers.length > 0) {
              detalhamento.push('Gols acertados: ' + matchedScorers.join(', '))
            }

            if (temPenaltis) {
              const predPenaltis = (palpite.getString('vencedor_penaltis') || '')
                .toUpperCase()
                .trim()
              if (
                predPenaltis &&
                predPenaltis === vencedorPenaltisReal &&
                (predPenaltis === 'A' || predPenaltis === 'B')
              ) {
                pontos += 2
                detalhamento.push('Vencedor nos Pênaltis (+2 pts)')
              }
            }

            palpite.set('pontuacao_jogo', pontos)
            palpite.set('detalhamento', detalhamento)
            app.save(palpite)
          }
        }

        // Reacumula pontuação dos participantes do bolão
        const participantes = app.findRecordsByFilter(
          'participantes',
          "bolao = '" + bolaoId + "'",
          '',
          200,
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

        try {
          const bolao = app.findRecordById('boloes', bolaoId)
          bolao.set('ultima_atualizacao', new Date().toISOString())
          app.save(bolao)
        } catch (_) {}
      }
      console.log('[migration 0089] Recálculo concluído com sucesso.')
    } catch (errRecalc) {
      console.log('[migration 0089] Erro no recálculo:', errRecalc)
    }
  },
  (app) => {},
)
