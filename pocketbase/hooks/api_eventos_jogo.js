// pocketbase/hooks/api_eventos_jogo.js
// Endpoint: GET /backend/v1/eventos-jogo
// Busca a timeline de eventos da partida (Gols, Cartões, Substituições) via API-Football (/fixtures?id={fixture_id}&events ou /fixtures/events)
// Respeita rigorosamente a cota diária de 80 requisições/dia (registro api_football_daily_usage em config_integracoes)
// Suporta token de autenticação no header Authorization e validação de sessão.
// Se a partida estiver finalizada ou se os eventos já estiverem persistidos no registro de jogo ou jogos_do_dia, serve do banco local.

routerAdd('GET', '/backend/v1/eventos-jogo', (e) => {
  try {
    const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
    if (!authRecord) {
      return e.json(401, { error: 'Sua sessão expirou. Faça login novamente.' })
    }

    const query = e.request ? e.request.url.query() : null
    let fixtureIdParam = (query ? query.get('fixture_id') || query.get('id') || '' : '').trim()
    let jogoIdParam = (query ? query.get('jogo_id') || query.get('jogoId') || '' : '').trim()
    const forceRefresh = query ? query.get('refresh') === '1' : false

    if (!fixtureIdParam && !jogoIdParam) {
      return e.json(400, { error: 'Informe fixture_id ou jogo_id.' })
    }

    let matchingJogo = null
    if (jogoIdParam) {
      try {
        matchingJogo = $app.findRecordById('jogos', jogoIdParam)
      } catch (_) {}
    }

    if (!matchingJogo && fixtureIdParam) {
      try {
        matchingJogo = $app.findFirstRecordByData('jogos', 'fixture_id', fixtureIdParam)
      } catch (_) {}
    }

    if (!fixtureIdParam && matchingJogo) {
      fixtureIdParam = (matchingJogo.getString('fixture_id') || '').trim()
    }

    const isNumericFixtureId = /^\d+$/.test(fixtureIdParam)

    // 1. CHECAGEM EM BANCO DE DADOS LOCAL (Custo Zero de Cota)
    // Se forceRefresh for solicitado OU ficha_detalhes.events estiver vazio, NÃO força retorno local
    const isMatchingJogoFinalizado =
      matchingJogo &&
      (matchingJogo.getBool('resultado_finalizado') ||
        ['finalizado', 'encerrado', 'ft', 'finished', 'aet', 'pen', 'match finished'].includes(
          (matchingJogo.getString('status') || '').toLowerCase().trim(),
        ))

    // Se o jogo já possui ficha_detalhes salva no banco com eventos e forceRefresh NÃO foi solicitado
    if (matchingJogo && !forceRefresh) {
      try {
        const fichaRaw = matchingJogo.get('ficha_detalhes')
        if (fichaRaw) {
          let parsedFicha = null
          if (typeof fichaRaw === 'string') {
            try {
              parsedFicha = JSON.parse(fichaRaw)
            } catch (_) {}
          } else if (typeof fichaRaw === 'object') {
            parsedFicha = fichaRaw
          }

          if (parsedFicha && Array.isArray(parsedFicha.events) && parsedFicha.events.length > 0) {
            const isFinalizado = Boolean(isMatchingJogoFinalizado)
            return e.json(200, {
              success: true,
              cached: true,
              source: 'database_jogo',
              is_finalizado: isFinalizado,
              fixture_id: fixtureIdParam,
              events: parsedFicha.events,
              teams: parsedFicha.teams || {
                home: { name: matchingJogo.getString('time_a') },
                away: { name: matchingJogo.getString('time_b') },
              },
              goals: parsedFicha.goals || {
                home: matchingJogo.getInt('placar_a'),
                away: matchingJogo.getInt('placar_b'),
              },
            })
          }
        }
      } catch (_) {}
    }

    // Checa jogos_do_dia por eventos locais já sincronizados
    if (fixtureIdParam && !forceRefresh) {
      try {
        const jdd = $app.findFirstRecordByData('jogos_do_dia', 'fixture_id', fixtureIdParam)
        if (jdd) {
          const rawEvents = jdd.get('events')
          let parsedJddEvents = null
          if (typeof rawEvents === 'string') {
            try {
              parsedJddEvents = JSON.parse(rawEvents)
            } catch (_) {}
          } else if (Array.isArray(rawEvents)) {
            parsedJddEvents = rawEvents
          }

          if (Array.isArray(parsedJddEvents) && parsedJddEvents.length > 0) {
            return e.json(200, {
              success: true,
              cached: true,
              source: 'database_jogos_do_dia',
              fixture_id: fixtureIdParam,
              events: parsedJddEvents,
              teams: {
                home: { name: jdd.getString('time_casa'), logo: jdd.getString('logo_casa') },
                away: {
                  name: jdd.getString('time_visitante'),
                  logo: jdd.getString('logo_visitante'),
                },
              },
              goals: {
                home: jdd.getInt('placar_casa'),
                away: jdd.getInt('placar_visitante'),
              },
            })
          }
        }
      } catch (_) {}
    }

    // 2. Cache em memória do servidor PB ($app.store())
    const cacheKey = 'events_fixture_' + fixtureIdParam
    if (!forceRefresh) {
      try {
        const cachedStr = $app.store().get(cacheKey)
        if (cachedStr && typeof cachedStr === 'string') {
          const cachedObj = JSON.parse(cachedStr)
          if (cachedObj && Array.isArray(cachedObj.events)) {
            return e.json(200, Object.assign({ cached: true, source: 'server_cache' }, cachedObj))
          }
        }
      } catch (_) {}
    }

    // Helper para sintetizar eventos de gol a partir dos dados locais do jogo
    const sintetizarEventosLocais = (jogoRec) => {
      const fallbackEvents = []
      if (!jogoRec) return fallbackEvents

      const parseScorers = (fieldName, teamName, teamSide) => {
        try {
          const raw = jogoRec.get(fieldName)
          let list = []
          if (Array.isArray(raw)) list = raw
          else if (typeof raw === 'string') list = JSON.parse(raw)
          if (Array.isArray(list)) {
            for (let i = 0; i < list.length; i++) {
              const it = list[i]
              if (!it) continue
              const nomeStr = typeof it === 'string' ? it : it.nome || ''
              const detailLower = String(it.posicao || it.detail || '').toLowerCase()

              // Preservação: pênalti perdido nunca vira evento de gol
              if (detailLower.includes('missed') || detailLower.includes('perdido')) {
                continue
              }

              if (nomeStr) {
                const minMatch = String(it.minuto || nomeStr).match(/(\d+)/)
                const min = minMatch ? parseInt(minMatch[1], 10) : null
                const cleanName = String(nomeStr)
                  .replace(/\s*\d+\s*['’]/g, '')
                  .trim()

                const isContra =
                  it.posicao === 'Gol Contra' ||
                  detailLower.includes('own') ||
                  detailLower.includes('contra')
                const isPenalty = detailLower.includes('penalty') || detailLower.includes('pênalti')

                fallbackEvents.push({
                  time: { elapsed: min !== null && !isNaN(min) ? min : null, extra: null },
                  team: { name: teamName, side: teamSide },
                  player: { name: cleanName },
                  assist: { name: null },
                  type: 'Goal',
                  detail: isContra ? 'Own Goal' : isPenalty ? 'Penalty' : 'Normal Goal',
                  category: 'goal',
                  comments: null,
                })
              }
            }
          }
        } catch (_) {}
      }

      parseScorers('gols_time_a', jogoRec.getString('time_a'), 'home')
      parseScorers('gols_time_b', jogoRec.getString('time_b'), 'away')

      return fallbackEvents
    }

    // Se não temos fixture_id numérico válido para a API externa:
    if (!isNumericFixtureId) {
      const fallbackEvents = sintetizarEventosLocais(matchingJogo)

      return e.json(200, {
        success: true,
        cached: true,
        source: 'local_database',
        fixture_id: fixtureIdParam,
        events: fallbackEvents,
        teams: matchingJogo
          ? {
              home: { name: matchingJogo.getString('time_a') },
              away: { name: matchingJogo.getString('time_b') },
            }
          : {},
        goals: matchingJogo
          ? {
              home: matchingJogo.getInt('placar_a'),
              away: matchingJogo.getInt('placar_b'),
            }
          : {},
      })
    }

    // 3. Controle e checagem de cota diária API-Football
    const DAILY_LIMIT = 80
    const USAGE_RECORD_CHAVE = 'api_football_daily_usage'
    const hojeUtc = new Date().toISOString().slice(0, 10)

    let recUsage = null
    let usageData = {
      date_utc: hojeUtc,
      count: 0,
      max_limit: DAILY_LIMIT,
      trava_desativada: false,
      blocked: false,
      last_reset_utc: new Date().toISOString(),
      last_request_utc: null,
    }

    try {
      recUsage = $app.findFirstRecordByFilter(
        'config_integracoes',
        `chave = '${USAGE_RECORD_CHAVE}'`,
      )
      if (recUsage && recUsage.get('api_key')) {
        const parsed = JSON.parse(recUsage.get('api_key'))
        if (parsed && typeof parsed === 'object') {
          usageData = Object.assign(usageData, parsed)
        }
      }
    } catch (_) {
      recUsage = null
    }

    if (usageData.date_utc !== hojeUtc) {
      usageData.date_utc = hojeUtc
      usageData.count = 0
      usageData.blocked = false
      if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
        usageData.max_limit = DAILY_LIMIT
      }
      usageData.last_reset_utc = new Date().toISOString()
      if (recUsage) {
        recUsage.set('api_key', JSON.stringify(usageData))
        $app.save(recUsage)
      }
    }

    const currentCount = Number(usageData.count) || 0
    const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
    const travaDesativada = Boolean(usageData.trava_desativada)

    if (!travaDesativada && (usageData.blocked || currentCount >= maxLimit)) {
      return e.json(200, {
        success: true,
        cached: true,
        rate_limited: true,
        waiting_reset: true,
        notice:
          'Cota diária da API-Sports atingida (80 req/dia). Reset às 21h (horário de Brasília). Exibindo dados locais.',
        fixture_id: fixtureIdParam,
        events: [],
      })
    }

    // 4. Obtenção dinâmica da chave ativa diretamente do banco de dados (config_integracoes)
    // NUNCA de variáveis de ambiente estáticas (.env). Leitura dinâmica antes de cada chamada.
    let chaveAtivaDoBanco = ''
    try {
      const recPlacar = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (recPlacar && recPlacar.getBool('ativo')) {
        chaveAtivaDoBanco = (recPlacar.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!chaveAtivaDoBanco) {
      try {
        const recApiFoot = $app.findFirstRecordByData('config_integracoes', 'chave', 'api_football')
        if (recApiFoot && recApiFoot.getBool('ativo')) {
          chaveAtivaDoBanco = (recApiFoot.getString('api_key') || '').trim()
        }
      } catch (_) {}
    }

    // Se a chave principal do banco não estiver preenchida, verifica chave backup do banco
    if (!chaveAtivaDoBanco) {
      try {
        const recBackup = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo_backup',
        )
        if (recBackup && recBackup.getBool('ativo')) {
          chaveAtivaDoBanco = (recBackup.getString('api_key') || '').trim()
        }
      } catch (_) {}
    }

    // Monta o cabeçalho estrito com x-apisports-key contendo a chave ativa lida do banco
    const headersRequisicao = {
      'x-apisports-key': chaveAtivaDoBanco,
    }

    // Chamada externa à API-Sports com limiter centralizado (api_football_limiter.js)
    const limiterMod = (function () {
      try {
        if (typeof __hooks !== 'undefined') {
          return require(__hooks + '/api_football_limiter.js')
        }
      } catch (_) {}
      try {
        return require('./api_football_limiter.js')
      } catch (_) {
        return null
      }
    })()

    // Endpoint dedicado para eventos de partidas
    const url = `https://v3.football.api-sports.io/fixtures/events?fixture=${encodeURIComponent(fixtureIdParam)}`
    let respCall = null
    if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
      respCall = limiterMod.enviarRequisicaoApiFootball(
        url,
        {
          headers: headersRequisicao,
          timeout: 15,
        },
        2,
      )
    } else {
      const sendRes = $http.send({
        url,
        method: 'GET',
        headers: headersRequisicao,
        timeout: 15,
      })
      let j = null
      try {
        j =
          typeof sendRes.json === 'object' && sendRes.json !== null
            ? sendRes.json
            : JSON.parse(sendRes.raw)
      } catch (_) {}
      respCall = {
        blocked: false,
        statusCode: sendRes ? sendRes.statusCode : 500,
        rawResponse: sendRes,
        json: j,
      }
    }

    if (respCall.blocked && respCall.rate_limited) {
      return e.json(200, {
        success: true,
        cached: true,
        rate_limited: true,
        waiting_reset: true,
        notice:
          'Cota diária da API-Sports atingida nas chaves configuradas. Reset às 21h (horário de Brasília). Exibindo dados locais.',
        fixture_id: fixtureIdParam,
        events: [],
      })
    }

    const resHttp = respCall.rawResponse
    const resJson = respCall.json

    // Fallback silencioso para dados locais APENAS quando a chamada real falhar (ex.: 403, 429, 500)
    // NUNCA antes de tentar a chamada real
    if (!resHttp || respCall.statusCode !== 200) {
      if (matchingJogo) {
        const localEvents = sintetizarEventosLocais(matchingJogo)
        const isFinalizado = Boolean(isMatchingJogoFinalizado)
        return e.json(200, {
          success: true,
          cached: true,
          source: 'local_database',
          is_finalizado: isFinalizado,
          fixture_id: fixtureIdParam,
          events: localEvents,
          teams: {
            home: { name: matchingJogo.getString('time_a') },
            away: { name: matchingJogo.getString('time_b') },
          },
          goals: {
            home: matchingJogo.getInt('placar_a'),
            away: matchingJogo.getInt('placar_b'),
          },
        })
      }

      return e.json(200, {
        success: false,
        cached: true,
        statusCode: respCall.statusCode || 500,
        error: 'Partida não localizada no banco de dados local.',
        events: [],
      })
    }

    // A resposta HTTP foi 200 confirmada da API-Sports
    const rawEvents = resJson && Array.isArray(resJson.response) ? resJson.response : []

    // Processar a resposta:
    // Normalização amigável dos eventos: Gols, Cartões, Substituições
    const normalizedEvents = rawEvents.map((ev) => {
      const typeStr = (ev.type || '').toString().toLowerCase()
      const detailStr = (ev.detail || '').toString().toLowerCase()

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
        time: {
          elapsed: elapsedInt,
          extra: extraInt,
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
        category,
      }
    })

    // Processar marcadores de gols válidos:
    // Filtrar apenas: Normal Goal, Penalty convertido, Own Goal
    // Pênalti perdido / missed NUNCA é marcador
    // Minuto como inteiro limpo (time.elapsed), player.name e team.name
    const golsA = []
    const golsB = []
    const marcadoresGerais = []

    const timeANome = matchingJogo
      ? (matchingJogo.getString('time_a') || '').trim().toLowerCase()
      : ''
    const timeBNome = matchingJogo
      ? (matchingJogo.getString('time_b') || '').trim().toLowerCase()
      : ''

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

    const timeANorm = stripAccents(timeANome)
    const timeBNorm = stripAccents(timeBNome)

    for (let i = 0; i < rawEvents.length; i++) {
      const ev = rawEvents[i]
      const evType = (ev.type || '').toString().toLowerCase()
      if (evType === 'goal') {
        const detail = (ev.detail || '').toString().toLowerCase().trim()
        // Pênalti perdido/missed NUNCA é marcador
        if (
          detail.includes('missed') ||
          detail.includes('perdido') ||
          detail.includes('missed penalty') ||
          detail.includes('penalty missed')
        ) {
          continue
        }

        // Minuto como inteiro limpo (time.elapsed)
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

          // Identificar se é time A ou time B
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
            // Se não bater por nome, adiciona ao time A se golsA estiver menor ou padrão
            golsA.push(item)
          }

          marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
        }
      }
    }

    const payload = {
      success: true,
      cached: false,
      source: 'api_football',
      fixture_id: fixtureIdParam,
      events: normalizedEvents,
      teams: matchingJogo
        ? {
            home: { name: matchingJogo.getString('time_a') },
            away: { name: matchingJogo.getString('time_b') },
          }
        : {},
      goals: matchingJogo
        ? {
            home: matchingJogo.getInt('placar_a'),
            away: matchingJogo.getInt('placar_b'),
          }
        : {},
      updated_at: new Date().toISOString(),
    }

    if (normalizedEvents.length === 0) {
      payload.notice = 'Nenhum evento registrado ainda para esta partida.'
    }

    // Persiste no cache do servidor PB
    try {
      $app.store().set(cacheKey, JSON.stringify(payload))
    } catch (_) {}

    // Gravar gols_time_a, gols_time_b, marcadores e atualizar ficha_detalhes (preservando escalações existentes)
    if (matchingJogo) {
      try {
        const existingFichaRaw = matchingJogo.get('ficha_detalhes')
        let existingFicha = {}
        if (typeof existingFichaRaw === 'string') {
          try {
            existingFicha = JSON.parse(existingFichaRaw)
          } catch (_) {}
        } else if (typeof existingFichaRaw === 'object' && existingFichaRaw !== null) {
          existingFicha = existingFichaRaw
        }

        // Preservação de escalações existentes contra sobrescrita com listas em branco
        const mergedLineups = existingFicha.lineups || matchingJogo.get('escalacoes') || null

        const mergedFicha = Object.assign({}, existingFicha, {
          events: normalizedEvents,
          lineups: mergedLineups,
          updatedAt: new Date().toISOString(),
        })

        matchingJogo.set('ficha_detalhes', mergedFicha)

        // Gravar gols e marcadores no jogo se houver gols retornados
        if (golsA.length > 0 || golsB.length > 0) {
          if (golsA.length > 0) {
            matchingJogo.set('gols_time_a', golsA)
          }
          if (golsB.length > 0) {
            matchingJogo.set('gols_time_b', golsB)
          }
          if (marcadoresGerais.length > 0) {
            matchingJogo.set('marcadores', marcadoresGerais)
          }
        }

        $app.save(matchingJogo)

        // Executar recálculo inline de pontuação dos palpites após salvar:
        // Cravada 8, vencedor 2, diferença +1, metade +1, marcadores por posição:
        // ataque/meia +1, defensor/lateral +3, goleiro +10, gol contra +5.
        // Preservando intocáveis os pontos fixos importados das planilhas e o marco temporal
        // (jogos até 16/09/2026 16h00 = planilhas; app a partir de 16/09/2026 19h00).
        try {
          const bolaoId = matchingJogo.getString('bolao')
          const placarRealA = matchingJogo.getInt('placar_a')
          const placarRealB = matchingJogo.getInt('placar_b')
          const temPenaltis = matchingJogo.getBool('tem_penaltis')
          const vencedorPenaltisReal = (matchingJogo.getString('vencedor_penaltis') || '')
            .toUpperCase()
            .trim()

          // Marco temporal de corte das planilhas:
          // Jogos até 16/09/2026 16:00 pertencem exclusivamente ao histórico das planilhas
          let jogoKickoffMs = 0
          try {
            let dataStr = (matchingJogo.getString('data') || '').trim()
            let horaStr = (matchingJogo.getString('hora') || '').trim() || '16:00'
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

          // Se for jogo do período histórico das planilhas, NÃO altera pontuação dos palpites
          if (!isHistoricoPlanilhas && bolaoId) {
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
              const normalizacoes = $app.findRecordsByFilter(
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

            const currentGolsA = parseJsonField(matchingJogo, 'gols_time_a')
            const currentGolsB = parseJsonField(matchingJogo, 'gols_time_b')
            for (let a = 0; a < currentGolsA.length; a++) processScorer(currentGolsA[a])
            for (let b = 0; b < currentGolsB.length; b++) processScorer(currentGolsB[b])

            const palpitesDoJogo = $app.findRecordsByFilter(
              'palpites',
              "jogo = '" + matchingJogo.id + "'",
              '',
              100,
              0,
            )

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
              $app.save(palpite)
            }

            // Reacumula pontuação total dos participantes do bolão preservando pontos_importados
            const participantes = $app.findRecordsByFilter(
              'participantes',
              "bolao = '" + bolaoId + "'",
              '',
              200,
              0,
            )
            for (let pi = 0; pi < participantes.length; pi++) {
              const part = participantes[pi]
              const partPalpites = $app.findRecordsByFilter(
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
                  const gameRec = $app.findRecordById('jogos', p.getString('jogo'))
                  if (gameRec && gameRec.getBool('resultado_finalizado')) {
                    totalPoints += p.getInt('pontuacao_jogo')
                  }
                } catch (_) {}
              }
              const importedPts = part.getInt('pontos_importados') || 0
              part.set('pontuacao_total', importedPts + totalPoints)
              $app.save(part)
            }

            try {
              const bolao = $app.findRecordById('boloes', bolaoId)
              bolao.set('ultima_atualizacao', new Date().toISOString())
              $app.save(bolao)
            } catch (_) {}
          }
        } catch (errRecalc) {
          console.log('[EventosJogo] Erro no recálculo inline:', errRecalc)
        }
      } catch (errSaveJogo) {
        console.log('[EventosJogo] Erro ao salvar dados no jogo:', errSaveJogo)
      }
    }

    return e.json(200, payload)
  } catch (errGlobal) {
    console.log('[EventosJogo] Erro não tratado:', errGlobal)
    return e.json(500, {
      error:
        'Erro interno ao processar eventos da partida: ' + (errGlobal.message || String(errGlobal)),
    })
  }
})
