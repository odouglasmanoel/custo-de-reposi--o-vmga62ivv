// pocketbase/hooks/escalacoes.js
// Hook dedicado para busca e consolidação de escalações da API-Football.
// REGRAS APROVADAS CONTRA ESTOURO DE COTA:
// - Roteado pelo limitador centralizador api_football_limiter (Prioridade 2).
// - No máximo 1 chamada consolidada por ciclo de sincronização (janela 30–20 min antes do kickoff).
// - APENAS jogos com escalacoes == null / pendente.
// - Se bloqueado pelo limiter ou cota esgotada: retorna HTTP 200 com { cached: true, rate_limited: true, waiting_reset: true, notice: "..." }, sem erro/crash.
// - Se fixture_id estiver vazio, tenta resolver via tabela jogos_do_dia ou por data na API-Football.
// - Se o jogo passou do kickoff recentemente (até 2h) e ainda não tem escalação, tenta 1 única vez pós-kickoff.
// - Todas as funções e variáveis utilizadas nos callbacks são declaradas INLINE para compatibilidade estrita com Goja/PocketBase VM.

const sinonimosConhecidosTimes = {
  'paris saint germain': 'paris saint germain',
  'paris saint-germain': 'paris saint germain',
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  'olympique de marseille': 'olympique marseille',
  'olympique marseille': 'olympique marseille',
  marseille: 'olympique marseille',
  'olimpia de marsella': 'olympique marseille',
  om: 'olympique marseille',
  'afc bournemouth': 'bournemouth',
  bournemouth: 'bournemouth',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'club atletico de madrid': 'atletico madrid',
  atleti: 'atletico madrid',
  'liverpool fc': 'liverpool',
  liverpool: 'liverpool',
  internazionale: 'inter milan',
  'inter milan': 'inter milan',
  'inter de milao': 'inter milan',
  fcRecord: 'inter milan',
  'sporting cp': 'sporting lisbon',
  'sporting lisbon': 'sporting lisbon',
  'athletic club': 'athletic bilbao',
  'athletic bilbao': 'athletic club',
  'real madrid': 'real madrid',
  'real madrid cf': 'real madrid',
  ldu: 'ldu quito',
  'liga de quito': 'ldu quito',
  japao: 'japan',
  japan: 'japan',
  uruguai: 'uruguay',
  uruguay: 'uruguay',
}

function normalizeStr(str) {
  if (!str) return ''
  const s = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
  const rawTokens = s.split(/\s+/).filter(Boolean)
  const rawClean = rawTokens.join(' ').trim()
  if (sinonimosConhecidosTimes[rawClean]) {
    return sinonimosConhecidosTimes[rawClean]
  }
  const noiseWords = [
    'afc',
    'fc',
    'sc',
    'ac',
    'cf',
    'cd',
    'sd',
    'clube',
    'club',
    'ec',
    'cr',
    'se',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'del',
    'futebol',
    'futbol',
    'sport',
    'association',
    'sociedade',
    'esportiva',
  ]
  const tokens = rawTokens.filter((t) => noiseWords.indexOf(t) === -1)
  if (tokens.length === 0) {
    return s.replace(/[^a-z0-9]/g, '').trim()
  }
  const clean = tokens.join(' ').trim()
  return sinonimosConhecidosTimes[clean] || clean
}

function calcularLevenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d = []
  for (let i = 0; i <= m; i++) d[i] = [i]
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i1 = 1; i1 <= m; i1++) {
    for (let j1 = 1; j1 <= n; j1++) {
      const cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
      d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
    }
  }
  return d[m][n]
}

function timesCoincidem(a, b) {
  const normA = normalizeStr(a)
  const normB = normalizeStr(b)
  if (!normA || !normB) return false
  if (normA === normB) return true
  if (normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) return true
  const tA = normA.split(/\s+/).filter((t) => t.length >= 3)
  const tB = normB.split(/\s+/).filter((t) => t.length >= 3)
  let common = false
  for (let ti = 0; ti < tA.length; ti++) {
    if (tB.indexOf(tA[ti]) !== -1) {
      common = true
      break
    }
  }
  if (common && (tA.length <= 2 || tB.length <= 2)) return true
  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return true
  const dist = calcularLevenshtein(normA, normB)
  return 1 - dist / maxLen >= 0.85
}

// -------------------------------------------------------------
// Endpoint GET /backend/v1/escalacoes
// -------------------------------------------------------------
routerAdd(
  'GET',
  '/backend/v1/escalacoes',
  (e) => {
    try {
      const authRecord = e.auth
      if (!authRecord) {
        return e.json(401, { error: 'Usuário não autenticado' })
      }

      let fixtureIdParam = (e.request.url.query().get('fixture_id') || '').trim()
      const timeA = (e.request.url.query().get('time_a') || '').trim()
      const timeB = (e.request.url.query().get('time_b') || '').trim()
      const dataParam = (e.request.url.query().get('data') || '').trim()
      const forceRefresh = e.request.url.query().get('refresh') === '1'

      if (!fixtureIdParam && (!timeA || !timeB)) {
        return e.json(400, {
          error: 'Informe fixture_id ou time_a e time_b',
        })
      }

      const inlineNormStr = (str) => {
        if (!str) return ''
        let s = String(str).toLowerCase()
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        s = s.replace(/[^a-z0-9\s]/g, ' ')
        const rawTokens = s.split(/\s+/).filter(Boolean)
        const cleanTokens = rawTokens.filter(
          (t) => ['afc', 'fc', 'sc', 'cf', 'clube', 'club'].indexOf(t) === -1,
        )
        return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
      }

      const inlineTimesCoincidem = (a, b) => {
        const na = inlineNormStr(a)
        const nb = inlineNormStr(b)
        if (!na || !nb) return false
        if (na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true
        return false
      }

      let matchingJogoRecord = null

      if (fixtureIdParam) {
        try {
          matchingJogoRecord = $app.findFirstRecordByData('jogos', 'fixture_id', fixtureIdParam)
        } catch (_) {}
      }

      if (!matchingJogoRecord && timeA && timeB) {
        try {
          const candRecords = $app.findRecordsByFilter(
            'jogos',
            "time_a ~ '" +
              timeA.replace(/'/g, "\\'") +
              "' || time_b ~ '" +
              timeB.replace(/'/g, "\\'") +
              "'",
            '-data',
            10,
            0,
          )
          if (Array.isArray(candRecords)) {
            for (let cri = 0; cri < candRecords.length; cri++) {
              const cr = candRecords[cri]
              const crA = cr.getString('time_a') || ''
              const crB = cr.getString('time_b') || ''
              const matchDireto =
                inlineTimesCoincidem(timeA, crA) && inlineTimesCoincidem(timeB, crB)
              const matchInvertido =
                inlineTimesCoincidem(timeA, crB) && inlineTimesCoincidem(timeB, crA)
              if (matchDireto || matchInvertido) {
                matchingJogoRecord = cr
                break
              }
            }
          }
        } catch (_) {}
      }

      // 1. PRIORIDADE TOTAL AO BANCO LOCAL (REGRA DE PROTEÇÃO CONTRA ESTOURO)
      if (matchingJogoRecord) {
        try {
          const savedEscalacoesRaw = matchingJogoRecord.get('escalacoes')
          if (savedEscalacoesRaw) {
            let savedEscalacoesObj = null
            if (typeof savedEscalacoesRaw === 'string') {
              try {
                savedEscalacoesObj = JSON.parse(savedEscalacoesRaw)
              } catch (_) {}
            } else if (typeof savedEscalacoesRaw === 'object') {
              savedEscalacoesObj = savedEscalacoesRaw
            }

            if (
              savedEscalacoesObj &&
              savedEscalacoesObj.teams &&
              savedEscalacoesObj.teams.length > 0 &&
              (savedEscalacoesObj.teams[0].starters?.length > 0 || !forceRefresh)
            ) {
              return e.json(200, Object.assign({ cached: true }, savedEscalacoesObj))
            }
          }
        } catch (errReadSaved) {
          console.log('[Escalacoes] Erro ao ler escalações locais:', errReadSaved)
        }
      }

      // 2. Cache em memória PB
      const cacheKey = 'lineup_' + (fixtureIdParam || timeA + '_' + timeB + '_' + dataParam)
      if (!forceRefresh) {
        const cached = $app.store().get(cacheKey)
        if (cached && typeof cached === 'string') {
          try {
            const parsed = JSON.parse(cached)
            if (parsed && parsed.status && Array.isArray(parsed.teams)) {
              return e.json(200, parsed)
            }
          } catch (_) {}
        }
      }

      // 3. Chave da API
      let apiKey = ''
      try {
        const configRec = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
        if (configRec) {
          apiKey = (configRec.getString('api_key') || '').trim()
        }
      } catch (_) {}

      if (!apiKey) {
        try {
          if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
            apiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
          } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
            apiKey = ($secrets.get('RAPIDAPI_KEY') || '').trim()
          } else if ($os && $os.getenv) {
            apiKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
          }
        } catch (_) {}
      }

      // Se fixtureIdParam está vazio mas temos matchingJogoRecord, tenta resolver
      if (!fixtureIdParam && matchingJogoRecord) {
        const fRecVal = (matchingJogoRecord.getString('fixture_id') || '').trim()
        if (fRecVal && /^\d+$/.test(fRecVal)) {
          fixtureIdParam = fRecVal
        } else {
          // Tenta jogos_do_dia
          try {
            const jA = matchingJogoRecord.getString('time_a') || ''
            const jB = matchingJogoRecord.getString('time_b') || ''
            const jdds = $app.findRecordsByFilter('jogos_do_dia', '', '-created', 100, 0)
            for (let i = 0; i < jdds.length; i++) {
              const tc = jdds[i].getString('time_casa') || ''
              const tv = jdds[i].getString('time_visitante') || ''
              if (inlineTimesCoincidem(jA, tc) && inlineTimesCoincidem(jB, tv)) {
                const fid = (jdds[i].getString('fixture_id') || '').trim()
                if (fid && /^\d+$/.test(fid)) {
                  fixtureIdParam = fid
                  matchingJogoRecord.set('fixture_id', fid)
                  $app.save(matchingJogoRecord)
                  break
                }
              }
            }
          } catch (_) {}
        }
      }

      const isDirectNumeric = /^\d+$/.test(fixtureIdParam)

      // Se não temos apiKey ou fixture_id numérico, retorna local/indisponível sem crash
      if (!apiKey || !isDirectNumeric) {
        const fallback = {
          status: 'indisponivel',
          provider: 'local',
          fixtureId: fixtureIdParam,
          cached: true,
          teams: [
            { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
            { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
          ],
          notice: 'Escalação indisponível no momento.',
          updatedAt: new Date().toISOString(),
        }
        return e.json(200, fallback)
      }

      // 4. Executa chamada externa ÚNICA via limitador centralizador com PRIORIDADE 2
      const { enviarRequisicaoApiFootball } = require(`${__hooks}/api_football_limiter.js`)
      const isRapid = apiKey.length > 40
      const url = isRapid
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/lineups?fixture=' +
          encodeURIComponent(fixtureIdParam)
        : 'https://v3.football.api-sports.io/fixtures/lineups?fixture=' +
          encodeURIComponent(fixtureIdParam)
      const headers = isRapid
        ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
        : { 'x-apisports-key': apiKey }

      const limiterRes = enviarRequisicaoApiFootball(url, { headers }, 2)

      if (limiterRes.blocked) {
        console.log('[Escalacoes] Requisição bloqueada pelo limiter:', limiterRes.reason)
        const fallbackRateLimited = {
          status: 'indisponivel',
          provider: 'api_football',
          fixtureId: fixtureIdParam,
          cached: true,
          rate_limited: true,
          waiting_reset: true,
          notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
          teams: [
            { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
            { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
          ],
          updatedAt: new Date().toISOString(),
        }
        return e.json(200, fallbackRateLimited)
      }

      let result = null
      const resJson = limiterRes.json
      if (resJson && Array.isArray(resJson.response) && resJson.response.length > 0) {
        const rawLineups = resJson.response
        const teamsData = []
        for (let i = 0; i < rawLineups.length; i++) {
          const teamBlock = rawLineups[i]
          const teamInfo = teamBlock.team || {}
          const starters = []
          if (Array.isArray(teamBlock.startXI)) {
            for (let s = 0; s < teamBlock.startXI.length; s++) {
              const p = teamBlock.startXI[s].player || {}
              starters.push({
                id: p.id ? String(p.id) : '',
                name: p.name || '',
                number: p.number || null,
                pos: p.pos || '',
                grid: p.grid || null,
              })
            }
          }
          const bench = []
          if (Array.isArray(teamBlock.substitutes)) {
            for (let b = 0; b < teamBlock.substitutes.length; b++) {
              const bp = teamBlock.substitutes[b].player || {}
              bench.push({
                id: bp.id ? String(bp.id) : '',
                name: bp.name || '',
                number: bp.number || null,
                pos: bp.pos || '',
              })
            }
          }

          let tLogo = teamInfo.logo || ''
          const tName = teamInfo.name || ''
          if (tName.toLowerCase().indexOf('paris') !== -1 || tName.toLowerCase() === 'psg') {
            tLogo = 'https://media.api-sports.io/football/teams/85.png'
          }

          teamsData.push({
            teamId: teamInfo.id ? String(teamInfo.id) : '',
            teamName: tName,
            teamLogo: tLogo,
            formation: teamBlock.formation || '',
            coach: teamBlock.coach ? teamBlock.coach.name : '',
            starters: starters,
            substitutes: bench,
          })
        }

        if (teamsData.length > 0) {
          result = {
            status: 'confirmada',
            provider: 'api_football',
            fixtureId: fixtureIdParam,
            teams: teamsData,
            updatedAt: new Date().toISOString(),
          }
          if (matchingJogoRecord) {
            try {
              matchingJogoRecord.set('escalacoes', result)
              $app.save(matchingJogoRecord)
              console.log(
                '[Escalacoes] Escalação salva com sucesso no registro da partida ' +
                  matchingJogoRecord.id,
              )
            } catch (errSave) {
              console.log('[Escalacoes] Aviso ao persistir escalação:', errSave)
            }
          }
        }
      }

      if (!result) {
        result = {
          status: 'indisponivel',
          provider: 'api_football',
          fixtureId: fixtureIdParam,
          teams: [
            { teamName: timeA || 'Mandante', starters: [], substitutes: [] },
            { teamName: timeB || 'Visitante', starters: [], substitutes: [] },
          ],
          updatedAt: new Date().toISOString(),
        }
      }

      try {
        $app.store().set(cacheKey, JSON.stringify(result))
      } catch (_) {}

      return e.json(200, result)
    } catch (generalErr) {
      console.log('[Escalacoes] Erro geral capturado:', generalErr)
      return e.json(200, {
        status: 'indisponivel',
        cached: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
        teams: [],
      })
    }
  },
  $apis.requireAuth(),
)

// =============================================================
// CRON DE ESCALAÇÕES PRÉ-JOGO A CADA 5 MINUTOS (*/5 * * * *)
// Regras:
// - Intervalo: */5 * * * *
// - Janela de kickoff: 30–20 min à frente (agora >= kickoff - 30m e agora <= kickoff - 20m)
// - Se jogo não tem escalação e já passou do kickoff há pouco tempo (até 2 horas),
//   permite UMA ÚNICA tentativa pós-kickoff (marcada em store interna para não repetir).
// - Pula silenciosamente se cota esgotada (limiter blocked)
// =============================================================
cronAdd('cron_escalacoes_pre_jogo_5m', '*/5 * * * *', () => {
  try {
    const agora = Date.now()
    let apiKey = ''
    try {
      const cfgRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (cfgRec) apiKey = (cfgRec.getString('api_key') || '').trim()
    } catch (_) {}

    if (!apiKey) {
      if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
        apiKey = $secrets.get('API_FOOTBALL_KEY')
      } else if ($secrets && $secrets.has && $secrets.has('RAPIDAPI_KEY')) {
        apiKey = $secrets.get('RAPIDAPI_KEY')
      } else if ($os && $os.getenv) {
        apiKey = $os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || ''
      }
    }
    if (!apiKey) return

    const { enviarRequisicaoApiFootball } = require(`${__hooks}/api_football_limiter.js`)
    const isRapid = apiKey.length > 40
    const headers = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    const jogosPendentes = $app.findRecordsByFilter(
      'jogos',
      'resultado_finalizado = false',
      'data,hora',
      50,
      0,
    )
    if (!Array.isArray(jogosPendentes) || jogosPendentes.length === 0) return

    let jogoAlvo = null

    const inlineNormCron = (str) => {
      if (!str) return ''
      let s = String(str).toLowerCase()
      if (typeof s.normalize === 'function') {
        try {
          s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        } catch (_) {}
      }
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      const rawTokens = s.split(/\s+/).filter(Boolean)
      const cleanTokens = rawTokens.filter(
        (t) => ['afc', 'fc', 'sc', 'cf', 'clube', 'club'].indexOf(t) === -1,
      )
      return cleanTokens.join(' ').trim() || s.replace(/[^a-z0-9]/g, '').trim()
    }

    const inlineTimesCoincidemCron = (a, b) => {
      const na = inlineNormCron(a)
      const nb = inlineNormCron(b)
      if (!na || !nb) return false
      if (na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true
      return false
    }

    for (let ji = 0; ji < jogosPendentes.length; ji++) {
      const jRec = jogosPendentes[ji]
      const dtVal = (jRec.getString('data') || '').trim()
      const hrVal = (jRec.getString('hora') || '').trim()
      let fixtureId = (jRec.getString('fixture_id') || '').trim()

      // Já possui escalação confirmada completa? Se sim, pula
      const escAtual = jRec.get('escalacoes')
      if (escAtual) {
        let objEsc = null
        try {
          objEsc = typeof escAtual === 'string' ? JSON.parse(escAtual) : escAtual
        } catch (_) {}
        if (
          objEsc &&
          objEsc.status === 'confirmada' &&
          Array.isArray(objEsc.teams) &&
          objEsc.teams.length > 0 &&
          objEsc.teams[0].starters &&
          objEsc.teams[0].starters.length > 0
        ) {
          continue
        }
      }

      // Calcula kickoff exato em UTC
      let kickoffMs = null
      let isoDateStr = ''
      if (dtVal) {
        let y = 0,
          m = 0,
          d = 0
        const brM = dtVal.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (brM) {
          d = parseInt(brM[1], 10)
          m = parseInt(brM[2], 10)
          y = parseInt(brM[3], 10)
          isoDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        } else {
          const isoM = dtVal.match(/^(\d{4})-(\d{2})-(\d{2})/)
          if (isoM) {
            y = parseInt(isoM[1], 10)
            m = parseInt(isoM[2], 10)
            d = parseInt(isoM[3], 10)
            isoDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          }
        }
        let hrs = 16,
          mins = 0
        if (hrVal) {
          const hrM = hrVal.match(/^(\d{1,2}):(\d{2})/)
          if (hrM) {
            hrs = parseInt(hrM[1], 10)
            mins = parseInt(hrM[2], 10)
          }
        }
        if (y && m && d) {
          kickoffMs = Date.UTC(y, m - 1, d, hrs + 3, mins, 0, 0)
        }
      }

      if (!kickoffMs) continue

      // Janela de kickoff 30–20 minutos à frente
      const janelaInicio = kickoffMs - 30 * 60 * 1000
      const janelaFim = kickoffMs - 20 * 60 * 1000

      const naJanela = agora >= janelaInicio && agora <= janelaFim
      const duasHorasMs = 2 * 60 * 60 * 1000
      const posKickoffRecente = agora > kickoffMs && agora <= kickoffMs + duasHorasMs
      const jaTentouPos = $app.store().get('tentou_pos_kickoff_' + jRec.id) === '1'

      if (naJanela || (posKickoffRecente && !jaTentouPos)) {
        // Se não tem fixture_id, tenta resolver
        if (!fixtureId || !/^\d+$/.test(fixtureId)) {
          const tA = (jRec.getString('time_a') || '').trim()
          const tB = (jRec.getString('time_b') || '').trim()
          try {
            let filt = ''
            if (isoDateStr) filt = `data = '${isoDateStr}'`
            const jdds = $app.findRecordsByFilter('jogos_do_dia', filt, '-created', 100, 0)
            for (let xi = 0; xi < jdds.length; xi++) {
              const tc = jdds[xi].getString('time_casa') || ''
              const tv = jdds[xi].getString('time_visitante') || ''
              if (inlineTimesCoincidemCron(tA, tc) && inlineTimesCoincidemCron(tB, tv)) {
                const candFid = (jdds[xi].getString('fixture_id') || '').trim()
                if (candFid && /^\d+$/.test(candFid)) {
                  fixtureId = candFid
                  jRec.set('fixture_id', fixtureId)
                  $app.save(jRec)
                  break
                }
              }
            }
          } catch (_) {}

          // Se ainda sem fixture_id e na janela, busca por data
          if ((!fixtureId || !/^\d+$/.test(fixtureId)) && isoDateStr) {
            try {
              const urlD = isRapid
                ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${encodeURIComponent(isoDateStr)}&timezone=America%2FSao_Paulo`
                : `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(isoDateStr)}&timezone=America%2FSao_Paulo`
              const resD = enviarRequisicaoApiFootball(urlD, { headers, timeout: 10 }, 2)
              if (!resD.blocked && resD.json && Array.isArray(resD.json.response)) {
                for (let k = 0; k < resD.json.response.length; k++) {
                  const fi = resD.json.response[k]
                  const fh = (fi.teams && fi.teams.home && fi.teams.home.name) || ''
                  const fa = (fi.teams && fi.teams.away && fi.teams.away.name) || ''
                  if (inlineTimesCoincidemCron(tA, fh) && inlineTimesCoincidemCron(tB, fa)) {
                    const cid = fi.fixture && fi.fixture.id ? String(fi.fixture.id) : ''
                    if (cid && /^\d+$/.test(cid)) {
                      fixtureId = cid
                      jRec.set('fixture_id', fixtureId)
                      $app.save(jRec)
                      break
                    }
                  }
                }
              }
            } catch (_) {}
          }
        }

        if (fixtureId && /^\d+$/.test(fixtureId)) {
          jogoAlvo = jRec
          if (posKickoffRecente) {
            $app.store().set('tentou_pos_kickoff_' + jRec.id, '1')
          }
          break
        }
      }
    }

    if (!jogoAlvo) return

    const fixtureId = jogoAlvo.getString('fixture_id').trim()
    const urlLineups = isRapid
      ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures/lineups?fixture=' +
        encodeURIComponent(fixtureId)
      : 'https://v3.football.api-sports.io/fixtures/lineups?fixture=' +
        encodeURIComponent(fixtureId)

    console.log(
      `[Cron Escalações 5m] Buscando escalação na janela 30-20m / pós-kickoff para fixture ${fixtureId} (${jogoAlvo.id})...`,
    )
    const limiterRes = enviarRequisicaoApiFootball(urlLineups, { headers }, 2)

    if (limiterRes.blocked) {
      console.log(
        '[Cron Escalações 5m] Cota esgotada ou suprimida pelo limiter. Pulando silenciosamente.',
      )
      return
    }

    const resJson = limiterRes.json
    if (resJson && Array.isArray(resJson.response) && resJson.response.length > 0) {
      const rawLineups = resJson.response
      const teamsData = []
      for (let rli = 0; rli < rawLineups.length; rli++) {
        const teamBlock = rawLineups[rli]
        const teamInfo = teamBlock.team || {}
        const formation = teamBlock.formation || ''
        const coach = teamBlock.coach ? teamBlock.coach.name : ''
        const starters = []
        if (Array.isArray(teamBlock.startXI)) {
          for (let s = 0; s < teamBlock.startXI.length; s++) {
            const p = teamBlock.startXI[s].player || {}
            starters.push({
              id: p.id ? String(p.id) : '',
              name: p.name || '',
              number: p.number || null,
              pos: p.pos || '',
              grid: p.grid || null,
            })
          }
        }
        const bench = []
        if (Array.isArray(teamBlock.substitutes)) {
          for (let b = 0; b < teamBlock.substitutes.length; b++) {
            const bp = teamBlock.substitutes[b].player || {}
            bench.push({
              id: bp.id ? String(bp.id) : '',
              name: bp.name || '',
              number: bp.number || null,
              pos: bp.pos || '',
            })
          }
        }

        const tNameStr = teamInfo.name || ''
        let tLogoStr = teamInfo.logo || ''
        if (tNameStr.toLowerCase().indexOf('paris') !== -1 || tNameStr.toLowerCase() === 'psg') {
          tLogoStr = 'https://media.api-sports.io/football/teams/85.png'
        }

        teamsData.push({
          teamId: teamInfo.id ? String(teamInfo.id) : '',
          teamName: tNameStr,
          teamLogo: tLogoStr,
          formation: formation,
          coach: coach,
          starters: starters,
          substitutes: bench,
        })
      }

      if (teamsData.length > 0) {
        const payload = {
          status: 'confirmada',
          provider: 'api_football',
          fixtureId: fixtureId,
          teams: teamsData,
          updatedAt: new Date().toISOString(),
        }
        jogoAlvo.set('escalacoes', payload)
        $app.save(jogoAlvo)
        console.log(
          `[Cron Escalações 5m] Escalação pré-jogo gravada com sucesso no campo escalacoes do jogo ${jogoAlvo.id}`,
        )
      }
    }
  } catch (errSync) {
    console.log('[Cron Escalações 5m] Erro no ciclo de 5min:', errSync)
  }
})

module.exports = {
  timesCoincidem,
  normalizeStr,
}
