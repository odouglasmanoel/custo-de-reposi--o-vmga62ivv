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
    // Se a partida estiver finalizada/encerrada, NUNCA gasta cota externa mesmo se forceRefresh vier true.
    const isMatchingJogoFinalizado =
      matchingJogo &&
      (matchingJogo.getBool('resultado_finalizado') ||
        ['finalizado', 'encerrado', 'ft', 'finished', 'aet', 'pen', 'match finished'].includes(
          (matchingJogo.getString('status') || '').toLowerCase().trim(),
        ))

    // Se o jogo já possui ficha_detalhes salva no banco com eventos (ou se está finalizado)
    if (matchingJogo && (!forceRefresh || isMatchingJogoFinalizado)) {
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

    // Se não temos fixture_id numérico válido para a API externa:
    if (!isNumericFixtureId) {
      // Tenta sintetizar eventos com base nos gols já salvos em gols_time_a e gols_time_b
      const fallbackEvents = []
      if (matchingJogo) {
        const parseScorers = (fieldName, teamName, teamSide) => {
          try {
            const raw = matchingJogo.get(fieldName)
            let list = []
            if (Array.isArray(raw)) list = raw
            else if (typeof raw === 'string') list = JSON.parse(raw)
            if (Array.isArray(list)) {
              for (let i = 0; i < list.length; i++) {
                const it = list[i]
                if (it && it.nome) {
                  const minMatch = String(it.minuto || it.nome).match(/(\d+)/)
                  const min = minMatch ? parseInt(minMatch[1], 10) : null
                  const cleanName = String(it.nome)
                    .replace(/\s*\d+\s*['’]/g, '')
                    .trim()
                  fallbackEvents.push({
                    time: { elapsed: min, extra: null },
                    team: { name: teamName, side: teamSide },
                    player: { name: cleanName },
                    assist: { name: null },
                    type: 'Goal',
                    detail: it.posicao === 'Gol Contra' ? 'Own Goal' : 'Normal Goal',
                    comments: null,
                  })
                }
              }
            }
          } catch (_) {}
        }
        parseScorers('gols_time_a', matchingJogo.getString('time_a'), 'home')
        parseScorers('gols_time_b', matchingJogo.getString('time_b'), 'away')
      }

      return e.json(200, {
        success: true,
        cached: true,
        source: 'local_synthesized',
        fixture_id: fixtureIdParam,
        events: fallbackEvents,
        notice:
          'Partida sem fixture_id numérico oficial da API-Sports. Exibindo marcadores registrados localmente.',
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

    // 4. Chamada externa à API-Sports com limiter e fallback centralizado (api_football_limiter.js)
    const limiterMod = (function () {
      try {
        return require('./api_football_limiter.js')
      } catch (_) {
        return null
      }
    })()

    const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureIdParam)}`
    let respCall = null
    if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
      respCall = limiterMod.enviarRequisicaoApiFootball(url, { timeout: 12 }, 2)
    } else {
      const sendRes = $http.send({ url, method: 'GET', timeout: 12 })
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

    if (!resHttp || respCall.statusCode !== 200) {
      return e.json(200, {
        success: false,
        cached: true,
        statusCode: respCall.statusCode || 500,
        error: 'API externa retornou status ' + (respCall.statusCode || 'erro'),
        events: [],
      })
    }

    if (!resJson || !Array.isArray(resJson.response) || resJson.response.length === 0) {
      return e.json(200, {
        success: true,
        cached: true,
        events: [],
        notice: 'Nenhum evento registrado ainda para esta partida.',
      })
    }

    const fixData = resJson.response[0]
    const rawEvents = Array.isArray(fixData.events) ? fixData.events : []

    // Normalização amigável dos eventos: Gols, Cartões, Substituições
    const normalizedEvents = rawEvents.map((ev) => {
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
        category,
      }
    })

    const payload = {
      success: true,
      cached: false,
      source: 'api_football',
      fixture_id: fixtureIdParam,
      teams: fixData.teams || {},
      goals: fixData.goals || {},
      fixture_status: fixData.fixture?.status || {},
      events: normalizedEvents,
      updated_at: new Date().toISOString(),
    }

    // Persiste no cache do servidor PB
    try {
      $app.store().set(cacheKey, JSON.stringify(payload))
    } catch (_) {}

    // Se houver jogo vinculado no banco, atualiza ficha_detalhes para consultas futuras
    if (matchingJogo) {
      try {
        const isFinalizado =
          fixData.fixture?.status?.short === 'FT' || matchingJogo.getBool('resultado_finalizado')
        const existingFichaRaw = matchingJogo.get('ficha_detalhes')
        let existingFicha = {}
        if (typeof existingFichaRaw === 'string') {
          try {
            existingFicha = JSON.parse(existingFichaRaw)
          } catch (_) {}
        } else if (typeof existingFichaRaw === 'object' && existingFichaRaw !== null) {
          existingFicha = existingFichaRaw
        }

        const mergedFicha = Object.assign({}, existingFicha, {
          events: normalizedEvents,
          teams: fixData.teams || existingFicha.teams,
          goals: fixData.goals || existingFicha.goals,
          fixture: fixData.fixture || existingFicha.fixture,
          updatedAt: new Date().toISOString(),
        })

        matchingJogo.set('ficha_detalhes', mergedFicha)
        if (isFinalizado) {
          matchingJogo.set('resultado_finalizado', true)
        }
        $app.save(matchingJogo)
      } catch (errSaveJogo) {
        console.log('[EventosJogo] Erro ao salvar ficha_detalhes no jogo:', errSaveJogo)
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
