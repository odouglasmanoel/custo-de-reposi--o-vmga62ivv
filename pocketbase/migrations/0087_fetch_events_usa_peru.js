/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0087] Buscando eventos e marcadores para Estados Unidos x Peru (fixture 1628997)...',
    )

    // 1. Obter a chave ativa dinamicamente da tabela config_integracoes
    let chaveAtiva = ''
    try {
      const recPlacar = app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (recPlacar && recPlacar.getBool('ativo')) {
        chaveAtiva = (recPlacar.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!chaveAtiva) {
      try {
        const recFoot = app.findFirstRecordByData('config_integracoes', 'chave', 'api_football')
        if (recFoot && recFoot.getBool('ativo')) {
          chaveAtiva = (recFoot.getString('api_key') || '').trim()
        }
      } catch (_) {}
    }

    if (!chaveAtiva) {
      try {
        const recBackup = app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo_backup',
        )
        if (recBackup && recBackup.getBool('ativo')) {
          chaveAtiva = (recBackup.getString('api_key') || '').trim()
        }
      } catch (_) {}
    }

    console.log(
      '[migration 0087] Chave ativa do banco obtida:',
      chaveAtiva ? chaveAtiva.substring(0, 6) + '...' : 'NENHUMA',
    )

    const FIXTURE_ID = '1628997'
    const url = 'https://v3.football.api-sports.io/fixtures/events?fixture=' + FIXTURE_ID

    const headers = {
      'x-apisports-key': chaveAtiva,
    }

    console.log('[migration 0087] Efetuando GET em:', url)
    const sendRes = $http.send({
      url: url,
      method: 'GET',
      headers: headers,
      timeout: 15,
    })

    console.log('[migration 0087] Status HTTP retornado:', sendRes ? sendRes.statusCode : 'null')
    console.log('[migration 0087] Raw response:', sendRes ? sendRes.raw.substring(0, 300) : 'null')

    let resJson = null
    try {
      resJson =
        typeof sendRes.json === 'object' && sendRes.json !== null
          ? sendRes.json
          : JSON.parse(sendRes.raw)
    } catch (e) {
      console.log('[migration 0087] Falha no parse JSON:', e)
    }

    const rawEvents = resJson && Array.isArray(resJson.response) ? resJson.response : []
    console.log(
      '[migration 0087] Quantidade de eventos retornados da API-Sports:',
      rawEvents.length,
    )

    // Localizar o registro do jogo de Estados Unidos x Peru no banco
    let jogoRec = null
    try {
      jogoRec = app.findFirstRecordByData('jogos', 'fixture_id', FIXTURE_ID)
    } catch (_) {}

    if (!jogoRec) {
      try {
        jogoRec = app.findRecordById('jogos', 'dm1bl6ltf929ltv')
      } catch (_) {}
    }

    if (!jogoRec) {
      console.log('[migration 0087] Jogo de Estados Unidos x Peru não localizado!')
      return
    }

    console.log(
      '[migration 0087] Jogo localizado:',
      jogoRec.id,
      jogoRec.getString('time_a'),
      'x',
      jogoRec.getString('time_b'),
    )

    // Normalização dos eventos
    const normalizedEvents = rawEvents.map((ev) => {
      const typeStr = (ev.type || '').toString().toLowerCase()
      let category = 'other'
      if (typeStr === 'goal') category = 'goal'
      else if (typeStr === 'card') category = 'card'
      else if (typeStr.includes('subst')) category = 'subst'

      let elapsedInt = null
      if (ev.time && ev.time.elapsed != null) {
        const parsedM = parseInt(ev.time.elapsed, 10)
        if (!isNaN(parsedM)) elapsedInt = parsedM
      }

      let extraInt = null
      if (ev.time && ev.time.extra != null) {
        const parsedE = parseInt(ev.time.extra, 10)
        if (!isNaN(parsedE)) extraInt = parsedE
      }

      return {
        time: { elapsed: elapsedInt, extra: extraInt },
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

    const timeANome = (jogoRec.getString('time_a') || '').trim().toLowerCase()
    const timeBNome = (jogoRec.getString('time_b') || '').trim().toLowerCase()
    const timeANorm = stripAccents(timeANome)
    const timeBNorm = stripAccents(timeBNome)

    const golsA = []
    const golsB = []
    const marcadoresGerais = []

    for (let i = 0; i < rawEvents.length; i++) {
      const ev = rawEvents[i]
      const evType = (ev.type || '').toString().toLowerCase()
      if (evType === 'goal') {
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
        const teamName = (ev.team?.name || '').toString().trim()
        const teamNorm = stripAccents(teamName.toLowerCase())

        if (playerName) {
          let posicao = 'Atacante/Meia'
          if (isContra) {
            posicao = 'Gol Contra'
          }

          const item = {
            nome: playerName,
            posicao: posicao,
            quantidade: 1,
            minuto: minuteStr,
          }

          let isTimeA = false
          let isTimeB = false

          if (teamNorm) {
            if (timeANorm && (timeANorm.includes(teamNorm) || teamNorm.includes(timeANorm))) {
              isTimeA = true
            } else if (
              timeBNorm &&
              (timeBNorm.includes(teamNorm) || teamNorm.includes(timeBNorm))
            ) {
              isTimeB = true
            }
          }

          if (isTimeA) {
            golsA.push(item)
          } else if (isTimeB) {
            golsB.push(item)
          } else {
            golsA.push(item)
          }

          marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
        }
      }
    }

    console.log('[migration 0087] Gols Time A:', JSON.stringify(golsA))
    console.log('[migration 0087] Gols Time B:', JSON.stringify(golsB))
    console.log('[migration 0087] Marcadores Gerais:', JSON.stringify(marcadoresGerais))

    // Preservar escalações e mesclar ficha_detalhes
    const existingFichaRaw = jogoRec.get('ficha_detalhes')
    let existingFicha = {}
    if (typeof existingFichaRaw === 'string') {
      try {
        existingFicha = JSON.parse(existingFichaRaw)
      } catch (_) {}
    } else if (typeof existingFichaRaw === 'object' && existingFichaRaw !== null) {
      existingFicha = existingFichaRaw
    }

    const mergedLineups = existingFicha.lineups || jogoRec.get('escalacoes') || null

    const mergedFicha = Object.assign({}, existingFicha, {
      events: normalizedEvents,
      lineups: mergedLineups,
      updatedAt: new Date().toISOString(),
    })

    jogoRec.set('ficha_detalhes', mergedFicha)

    if (golsA.length > 0 || golsB.length > 0) {
      if (golsA.length > 0) jogoRec.set('gols_time_a', golsA)
      if (golsB.length > 0) jogoRec.set('gols_time_b', golsB)
      if (marcadoresGerais.length > 0) jogoRec.set('marcadores', marcadoresGerais)
    }

    app.save(jogoRec)
    console.log('[migration 0087] Jogo salvo com autores dos gols e minutos!')

    // Recalcular pontuações dos palpites deste jogo
    const bolaoId = jogoRec.getString('bolao')
    const placarRealA = jogoRec.getInt('placar_a')
    const placarRealB = jogoRec.getInt('placar_b')
    const temPenaltis = jogoRec.getBool('tem_penaltis')
    const vencedorPenaltisReal = (jogoRec.getString('vencedor_penaltis') || '').toUpperCase().trim()

    // Marco temporal de corte das planilhas:
    // Jogos até 16/09/2026 16:00 pertencem exclusivamente ao histórico das planilhas
    let jogoKickoffMs = 0
    try {
      let dataStr = (jogoRec.getString('data') || '').trim()
      let horaStr = (jogoRec.getString('hora') || '').trim() || '16:00'
      const brMatch = dataStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (brMatch) {
        dataStr = brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1]
      } else if (dataStr.indexOf('T') !== -1) {
        dataStr = dataStr.split('T')[0]
      }
      const horaParts = horaStr.split(':')
      const hh = (horaParts[0] || '16').padStart(2, '0')
      const mm = (horaParts[1] || '00').padStart(2, '0')
      const ss = (horaParts[2] || '00').padStart(2, '0')
      const isoStr = dataStr + 'T' + hh + ':' + mm + ':' + ss + '-03:00'
      const parsedKickoff = new Date(isoStr).getTime()
      if (!isNaN(parsedKickoff)) jogoKickoffMs = parsedKickoff
    } catch (_) {}

    // 16/09/2026 16:00 BRT = 16/09/2026 19:00:00 UTC
    const PLANILHAS_CUTOFF_END_MS = Date.UTC(2026, 8, 16, 19, 0, 0, 0)
    const isHistoricoPlanilhas = jogoKickoffMs > 0 && jogoKickoffMs <= PLANILHAS_CUTOFF_END_MS

    if (!isHistoricoPlanilhas && bolaoId) {
      console.log('[migration 0087] Recalculando palpites do jogo no bolão', bolaoId)
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

      const realWinner = getWinner(placarRealA, placarRealB)
      const realDiff = Math.abs(placarRealA - placarRealB)

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
          (pts === 3 ? 'Defensor' : pts === 10 ? 'Goleiro' : pts === 5 ? 'Gol Contra' : 'Atacante')

        const mins = []
        const minRegex = /(\d+)\s*['’]/g
        let mMatch
        while ((mMatch = minRegex.exec(rawNome)) !== null) {
          const num = parseInt(mMatch[1], 10)
          if (!isNaN(num)) mins.push(num)
        }

        if (realScorersMap[norm]) {
          realScorersMap[norm].countReal += count
          if (mins.length > 0) {
            realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
          }
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

      const currentGolsA = parseJsonField(jogoRec, 'gols_time_a')
      const currentGolsB = parseJsonField(jogoRec, 'gols_time_b')
      for (let a = 0; a < currentGolsA.length; a++) processScorer(currentGolsA[a])
      for (let b = 0; b < currentGolsB.length; b++) processScorer(currentGolsB[b])

      const palpitesDoJogo = app.findRecordsByFilter(
        'palpites',
        "jogo = '" + jogoRec.id + "'",
        '',
        100,
        0,
      )

      console.log('[migration 0087] Total de palpites a recalcular:', palpitesDoJogo.length)

      for (let pi = 0; pi < palpitesDoJogo.length; pi++) {
        const palpite = palpitesDoJogo[pi]
        let pontos = 0
        const detalhamento = []

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
          const predPenaltis = (palpite.getString('vencedor_penaltis') || '').toUpperCase().trim()
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

      // Reacumula pontuação total dos participantes do bolão
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

      console.log('[migration 0087] Pontuações e ranking recalculados com sucesso!')
    }
  },
  (app) => {},
)
