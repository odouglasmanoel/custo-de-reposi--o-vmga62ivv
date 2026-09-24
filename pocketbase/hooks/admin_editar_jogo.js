// pocketbase/hooks/admin_editar_jogo.js
// Endpoint administrativo seguro para edição cadastral de partida e vinculação automática de fixture/escudos.
// Protegido por checagem de Admin (Douglas).
//
// REGRAS GOJA / POCKETBASE:
// - Variáveis e helpers inline dentro do callback
// - NENHUM spread ({ ...obj }) nem funções transpiladas globais
// - Atribuição direta de propriedades

routerAdd('POST', '/backend/v1/admin/editar-jogo', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Acesso não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Apenas o Administrador pode editar jogos.')
    }

    const body = e.requestInfo().body || {}
    const jogoId = (body.jogo_id || '').trim()
    const timeA = (body.time_a || '').trim()
    const timeB = (body.time_b || '').trim()
    const dataVal = (body.data || '').trim()
    const horaVal = (body.hora || '').trim()
    const competicaoVal = (body.competicao || '').trim()

    if (!jogoId) {
      return e.badRequestError('ID do jogo é obrigatório (jogo_id).')
    }
    if (!timeA || !timeB) {
      return e.badRequestError('Nomes dos times mandante e visitante são obrigatórios.')
    }

    let jogoRec = null
    try {
      jogoRec = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.notFoundError('Jogo não encontrado.')
    }

    // Salva os dados cadastrais no registro da coleção jogos
    jogoRec.set('time_a', timeA)
    jogoRec.set('time_b', timeB)
    if (dataVal) {
      jogoRec.set('data', dataVal)
    }
    if (horaVal) {
      jogoRec.set('hora', horaVal)
    }
    if (body.competicao !== undefined) {
      jogoRec.set('competicao', competicaoVal)
    }
    $app.save(jogoRec)

    // Variáveis de controle de retorno
    let fixtureVinculado = false
    let escudosAtualizados = false
    let aviso = ''

    // Helper inline de normalização e similaridade para cascata de escudos
    const normalizarNome = (str) => {
      if (!str) return ''
      let s = String(str).toLowerCase()
      if (typeof s.normalize === 'function') {
        try {
          s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}
      }
      return s
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const calcularSimilaridade = (a, b) => {
      const s1 = normalizarNome(a)
      const s2 = normalizarNome(b)
      if (!s1 || !s2) return 0
      if (s1 === s2) return 1
      if (s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1) return 0.9

      const m = s1.length
      const n = s2.length
      const d = []
      for (let i = 0; i <= m; i++) d[i] = [i]
      for (let j = 0; j <= n; j++) d[0][j] = j
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
        }
      }
      return 1 - d[m][n] / Math.max(m, n)
    }

    // 1. Busca de fixture_id reusando fixtures_matcher com trava de 1 tentativa/jogo/dia no store $app
    const hojeStr = new Date().toISOString().slice(0, 10)
    const storeKey = `fixture_scan_${jogoId}_${hojeStr}`
    const jaTentouHoje = $app.store().get(storeKey) === '1'

    const curDataRaw = dataVal || jogoRec.getString('data') || ''
    let fixtureResultado = null

    if (!jaTentouHoje) {
      try {
        const { obterStatusLimiter } = require(`${__hooks}/api_football_limiter.js`)
        const statusLimiter = obterStatusLimiter()
        if (statusLimiter.consumidasHoje >= statusLimiter.limiteDiario) {
          aviso = 'Cota diária da API-Football esgotada. Dados salvos, busca de fixture adiada.'
        } else {
          // Marca tentativa diária
          $app.store().set(storeKey, '1')

          const { buscarFixtureDetalhadaNaApi } = require(`${__hooks}/fixtures_matcher.js`)
          fixtureResultado = buscarFixtureDetalhadaNaApi(timeA, timeB, curDataRaw)

          if (fixtureResultado && fixtureResultado.fixture_id) {
            jogoRec.set('fixture_id', fixtureResultado.fixture_id)
            fixtureVinculado = true
            console.log(
              `[admin_editar_jogo] Fixture ${fixtureResultado.fixture_id} vinculada ao jogo ${jogoId}`,
            )

            if (fixtureResultado.logo_mandante) {
              jogoRec.set('url_escudo_mandante', fixtureResultado.logo_mandante)
              escudosAtualizados = true
            }
            if (fixtureResultado.logo_visitante) {
              jogoRec.set('url_escudo_visitante', fixtureResultado.logo_visitante)
              escudosAtualizados = true
            }
            $app.save(jogoRec)
          } else {
            aviso = 'Nenhuma fixture correspondente encontrada na API para estes nomes/data.'
          }
        }
      } catch (errFixture) {
        console.log('[admin_editar_jogo] Aviso na consulta de fixture:', errFixture)
        aviso = 'Aviso ao consultar fixture: ' + (errFixture ? errFixture.message : 'indisponível')
      }
    } else {
      aviso = 'Tentativa de busca de fixture já realizada hoje para este jogo.'
    }

    // (2) Se escudos não foram obtidos pela fixture, busca pela cascata existente:
    // cache em memória -> TheSportsDB (strTeamBadge) -> Football-Data.org (crest) -> jogos_do_dia / enquete_jogos
    let curLogoCasa = (jogoRec.getString('url_escudo_mandante') || '').trim()
    let curLogoVis = (jogoRec.getString('url_escudo_visitante') || '').trim()

    if (!curLogoCasa || !curLogoVis) {
      const buscarEscudoCascata = (teamName) => {
        if (!teamName) return ''
        const cleanKey = normalizarNome(teamName)

        // 0) PSG especial
        if (cleanKey === 'paris saint germain' || cleanKey === 'psg') {
          return 'https://media.api-sports.io/football/teams/85.png'
        }

        // 1) Cache em memória global
        if (typeof globalThis !== 'undefined' && !globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache = {}
        }
        if (
          typeof globalThis !== 'undefined' &&
          globalThis.__tsdbBadgeCache &&
          globalThis.__tsdbBadgeCache[cleanKey]
        ) {
          return globalThis.__tsdbBadgeCache[cleanKey]
        }

        let badge = ''

        // 2) TheSportsDB (strTeamBadge)
        let tsdbKey = ''
        try {
          const tsdbRec = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'thesportsdb_fallback',
          )
          if (tsdbRec) tsdbKey = (tsdbRec.getString('api_key') || '').trim()
        } catch (_) {}
        if (!tsdbKey) {
          try {
            if ($secrets && $secrets.has && $secrets.has('THESPORTSDB_KEY')) {
              tsdbKey = ($secrets.get('THESPORTSDB_KEY') || '').trim()
            } else if ($os && $os.getenv) {
              tsdbKey = ($os.getenv('THESPORTSDB_KEY') || '').trim()
            }
          } catch (_) {}
        }
        if (!tsdbKey) tsdbKey = '3'

        try {
          const resTsdb = $http.send({
            url:
              'https://www.thesportsdb.com/api/v1/json/' +
              encodeURIComponent(tsdbKey) +
              '/searchteams.php?t=' +
              encodeURIComponent(teamName),
            method: 'GET',
            timeout: 4,
          })
          if (
            resTsdb.statusCode === 200 &&
            resTsdb.json &&
            Array.isArray(resTsdb.json.teams) &&
            resTsdb.json.teams.length > 0
          ) {
            for (let i = 0; i < resTsdb.json.teams.length; i++) {
              const cand = resTsdb.json.teams[i]
              const candName = cand.strTeam || ''
              if (calcularSimilaridade(teamName, candName) >= 0.75) {
                badge = (cand.strTeamBadge || cand.strBadge || cand.strLogo || '').trim()
                if (badge) break
              }
            }
          }
        } catch (errTsdb) {
          console.log('[admin_editar_jogo] Erro TheSportsDB para ' + teamName + ':', errTsdb)
        }

        // 3) Football-Data.org (crest)
        if (!badge) {
          let fdKey = ''
          try {
            const fdRec = $app.findFirstRecordByData(
              'config_integracoes',
              'chave',
              'football_data_fallback',
            )
            if (fdRec) fdKey = (fdRec.getString('api_key') || '').trim()
          } catch (_) {}
          if (!fdKey) {
            try {
              if ($secrets && $secrets.has && $secrets.has('FOOTBALL_DATA_KEY')) {
                fdKey = ($secrets.get('FOOTBALL_DATA_KEY') || '').trim()
              } else if ($os && $os.getenv) {
                fdKey = ($os.getenv('FOOTBALL_DATA_KEY') || '').trim()
              }
            } catch (_) {}
          }
          if (fdKey) {
            try {
              const resFD = $http.send({
                url: 'https://api.football-data.org/v4/teams?name=' + encodeURIComponent(teamName),
                method: 'GET',
                headers: { 'X-Auth-Token': fdKey },
                timeout: 4,
              })
              if (
                resFD.statusCode === 200 &&
                resFD.json &&
                Array.isArray(resFD.json.teams) &&
                resFD.json.teams.length > 0
              ) {
                for (let j = 0; j < resFD.json.teams.length; j++) {
                  const fdTeam = resFD.json.teams[j]
                  const fdName = (fdTeam && (fdTeam.name || fdTeam.shortName)) || ''
                  if (calcularSimilaridade(teamName, fdName) >= 0.75 && fdTeam.crest) {
                    badge = String(fdTeam.crest).trim()
                    if (badge) break
                  }
                }
              }
            } catch (errFD) {
              console.log('[admin_editar_jogo] Erro Football-Data para ' + teamName + ':', errFD)
            }
          }
        }

        // 4) Tabela jogos_do_dia ou enquete_jogos
        if (!badge) {
          try {
            const jdds = $app.findRecordsByFilter('jogos_do_dia', '', '-created', 100, 0)
            for (let k = 0; k < jdds.length; k++) {
              const tc = jdds[k].getString('time_casa') || ''
              const tv = jdds[k].getString('time_visitante') || ''
              if (calcularSimilaridade(teamName, tc) >= 0.8) {
                badge = (jdds[k].getString('logo_casa') || '').trim()
                if (badge) break
              }
              if (calcularSimilaridade(teamName, tv) >= 0.8) {
                badge = (jdds[k].getString('logo_visitante') || '').trim()
                if (badge) break
              }
            }
          } catch (_) {}
        }

        if (!badge) {
          try {
            const enqs = $app.findRecordsByFilter('enquete_jogos', '', '-created', 100, 0)
            for (let m = 0; m < enqs.length; m++) {
              const tA = enqs[m].getString('time_a') || ''
              const tB = enqs[m].getString('time_b') || ''
              if (calcularSimilaridade(teamName, tA) >= 0.8) {
                badge = (enqs[m].getString('logo_casa') || '').trim()
                if (badge) break
              }
              if (calcularSimilaridade(teamName, tB) >= 0.8) {
                badge = (enqs[m].getString('logo_visitante') || '').trim()
                if (badge) break
              }
            }
          } catch (_) {}
        }

        if (badge && typeof globalThis !== 'undefined' && globalThis.__tsdbBadgeCache) {
          globalThis.__tsdbBadgeCache[cleanKey] = badge
        }

        return badge
      }

      let alterouEscudo = false
      if (!curLogoCasa) {
        const foundA = buscarEscudoCascata(timeA)
        if (foundA) {
          jogoRec.set('url_escudo_mandante', foundA)
          alterouEscudo = true
          escudosAtualizados = true
        }
      }

      if (!curLogoVis) {
        const foundB = buscarEscudoCascata(timeB)
        if (foundB) {
          jogoRec.set('url_escudo_visitante', foundB)
          alterouEscudo = true
          escudosAtualizados = true
        }
      }

      if (alterouEscudo) {
        $app.save(jogoRec)
      }
    }

    return e.json(200, {
      success: true,
      jogo: {
        id: jogoRec.id,
        bolao: jogoRec.getString('bolao'),
        time_a: jogoRec.getString('time_a'),
        time_b: jogoRec.getString('time_b'),
        data: jogoRec.getString('data'),
        hora: jogoRec.getString('hora'),
        competicao: jogoRec.getString('competicao'),
        fixture_id: jogoRec.getString('fixture_id'),
        url_escudo_mandante: jogoRec.getString('url_escudo_mandante'),
        url_escudo_visitante: jogoRec.getString('url_escudo_visitante'),
        placar_a: jogoRec.getInt('placar_a'),
        placar_b: jogoRec.getInt('placar_b'),
        resultado_finalizado: jogoRec.getBool('resultado_finalizado'),
        updated: jogoRec.getString('updated'),
      },
      fixture_vinculado: fixtureVinculado,
      escudos_atualizados: escudosAtualizados,
      aviso: aviso || null,
    })
  } catch (err) {
    console.log('[admin_editar_jogo] Erro fatal:', err)
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao editar jogo.',
    })
  }
})
