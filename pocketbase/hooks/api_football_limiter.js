// pocketbase/hooks/api_football_limiter.js
// Centralizador único e limitador diário estrito para a API-Football (v3.football.api-sports.io / RapidAPI)
// Cota gratuita: 100 req/dia. Trava dura do Bolão: max 15 requisições por dia UTC (reseta às 00:00 UTC = 21h Brasília).
// Prioridades:
//   1 = Placar ao vivo de jogos do bolão (máxima urgência)
//   2 = Escalações pré-jogo (janela 60 min, consolidada)
//   3 = Busca matinal Jogos do Dia (se count >= 10, suprime preventivamente)

const DAILY_LIMIT = 15
const P3_SUPPRESS_THRESHOLD = 10
const USAGE_RECORD_CHAVE = 'api_football_daily_usage'

function getTodayUtcString() {
  const d = new Date()
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function obterOuCriarRegistroUso() {
  const hojeUtc = getTodayUtcString()
  let rec = null

  try {
    rec = $app.findFirstRecordByFilter('config_integracoes', `chave = '${USAGE_RECORD_CHAVE}'`)
  } catch (e) {
    rec = null
  }

  let usageData = {
    date_utc: hojeUtc,
    count: 0,
    max_limit: DAILY_LIMIT,
    last_reset_utc: new Date().toISOString(),
    last_request_utc: null,
  }

  if (rec) {
    let parsed = null
    try {
      if (rec.get('api_key')) {
        parsed = JSON.parse(rec.get('api_key'))
      }
    } catch (e) {
      parsed = null
    }

    if (parsed && typeof parsed === 'object') {
      usageData = Object.assign(usageData, parsed)
    }

    // Reset diário às 00:00 UTC
    if (usageData.date_utc !== hojeUtc) {
      console.log(
        `[API-Football Rate Limit] Novo dia UTC detectado (${hojeUtc} vs ${usageData.date_utc}). Resetando contador diário.`,
      )
      usageData.date_utc = hojeUtc
      usageData.count = 0
      usageData.max_limit = DAILY_LIMIT
      usageData.last_reset_utc = new Date().toISOString()

      rec.set('api_key', JSON.stringify(usageData))
      rec.set('ativo', true)
      rec.set('provedor', 'api_football')
      $app.save(rec)
    }

    return { rec, usageData }
  }

  // Criação inicial do registro de uso
  try {
    const col = $app.findCollectionByNameOrId('config_integracoes')
    const newRec = new Record(col)
    newRec.set('chave', USAGE_RECORD_CHAVE)
    newRec.set('provedor', 'api_football')
    newRec.set('ativo', true)
    newRec.set('api_key', JSON.stringify(usageData))
    $app.save(newRec)
    return { rec: newRec, usageData }
  } catch (err) {
    console.error('[API-Football Rate Limit] Falha ao criar registro de uso diário:', err)
    return { rec: null, usageData }
  }
}

function incrementarUso(rec, usageData) {
  try {
    usageData.count = (Number(usageData.count) || 0) + 1
    usageData.last_request_utc = new Date().toISOString()
    if (rec) {
      rec.set('api_key', JSON.stringify(usageData))
      $app.save(rec)
    }
  } catch (err) {
    console.error('[API-Football Rate Limit] Erro ao incrementar uso no banco:', err)
  }
}

/**
 * Função centralizadora enviarRequisicaoApiFootball
 * Único ponto de saída de requisições HTTP para a API-Football.
 *
 * @param {string} url - URL completa (ex: https://v3.football.api-sports.io/...)
 * @param {object} options - Opções para $http.send (method, headers, timeout, etc)
 * @param {number} prioridade - 1 (placar ao vivo), 2 (escalações), 3 (jogos do dia / busca)
 * @returns {object} { blocked: boolean, reason?: string, status?: number, rawResponse?: object, json?: any, usage: object }
 */
function enviarRequisicaoApiFootball(url, options, prioridade) {
  const prio = Number(prioridade) || 1
  const isTestOrStatus =
    Boolean(options && options.isTest) || (url && url.indexOf('/status') !== -1)
  const { rec, usageData } = obterOuCriarRegistroUso()
  const hojeUtc = usageData.date_utc
  const currentCount = Number(usageData.count) || 0

  // Chamadas de teste /status não consomem a cota diária
  if (isTestOrStatus) {
    try {
      const sendOptions = Object.assign(
        {
          method: 'GET',
          timeout: 10,
        },
        options || {},
      )
      delete sendOptions.isTest

      console.log(`[API-Football Limiter] Teste de conexão isento de cota: ${url}`)
      const res = $http.send(Object.assign({ url }, sendOptions))
      let jsonBody = null
      try {
        jsonBody = res.json
      } catch (e) {
        jsonBody = null
      }

      return {
        blocked: false,
        statusCode: res.statusCode,
        rawResponse: res,
        json: jsonBody,
        usage: usageData,
      }
    } catch (err) {
      console.error(`[API-Football Limiter] Exceção no teste de conexão (${url}):`, err)
      return {
        blocked: true,
        error: String(err),
        statusCode: 500,
        usage: usageData,
      }
    }
  }

  // 1. TRAVA DURA: se count >= 15, bloqueia IMEDIATAMENTE antes do $http.send
  if (currentCount >= DAILY_LIMIT) {
    const logMsg = `[API-Football Rate Limit] Limite diário de ${DAILY_LIMIT} requisições atingido para a data UTC ${hojeUtc}. Requisição suprimida sem erro em tela.`
    console.log(logMsg)
    return {
      blocked: true,
      rate_limited: true,
      waiting_reset: true,
      notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
      reason: 'daily_limit_reached',
      statusCode: 429,
      usage: usageData,
    }
  }

  // 2. SUPRESSÃO PREVENTIVA P3 (Busca matinal / jogos do dia gerais)
  if (prio >= 3 && currentCount >= P3_SUPPRESS_THRESHOLD) {
    const logMsg = `[API-Football Rate Limit] Prioridade 3 suprimida preventivamente (uso atual: ${currentCount}/${DAILY_LIMIT}). Preservando cota para jogos ao vivo do Bolão.`
    console.log(logMsg)
    return {
      blocked: true,
      rate_limited: true,
      waiting_reset: true,
      notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
      reason: 'p3_suppressed_preventively',
      statusCode: 429,
      usage: usageData,
    }
  }

  // 3. EXECUÇÃO CONTROLADA DO $http.send
  try {
    const sendOptions = Object.assign(
      {
        method: 'GET',
        timeout: 15,
      },
      options || {},
    )

    console.log(
      `[API-Football Limiter] Enviando req (${currentCount + 1}/${DAILY_LIMIT}) [Prio ${prio}]: ${url}`,
    )
    const res = $http.send(Object.assign({ url }, sendOptions))

    // Incrementa contador persistido
    incrementarUso(rec, usageData)

    const statusCode = res.statusCode
    let jsonBody = null
    try {
      jsonBody = res.json
    } catch (e) {
      jsonBody = null
    }

    // Checagem de 429 retornado pela própria API externa ou erros de rate limit no body
    const apiErrors = jsonBody && jsonBody.errors ? jsonBody.errors : {}
    const hasRateLimitError =
      statusCode === 429 ||
      Boolean(apiErrors.rateLimit) ||
      Boolean(apiErrors.requests) ||
      Boolean(apiErrors.token)

    if (hasRateLimitError) {
      console.warn(
        `[API-Football Rate Limit] Provedor externo respondeu com bloqueio de cota (${statusCode}):`,
        JSON.stringify(apiErrors),
      )
      // Força o contador para o limite para evitar novos disparos no ciclo
      usageData.count = DAILY_LIMIT
      if (rec) {
        rec.set('api_key', JSON.stringify(usageData))
        $app.save(rec)
      }
      return {
        blocked: true,
        rate_limited: true,
        waiting_reset: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
        statusCode: 429,
        rawResponse: res,
        json: jsonBody,
        usage: usageData,
      }
    }

    return {
      blocked: false,
      statusCode: statusCode,
      rawResponse: res,
      json: jsonBody,
      usage: usageData,
    }
  } catch (err) {
    console.error(`[API-Football Limiter] Exceção na requisição HTTP (${url}):`, err)
    return {
      blocked: true,
      error: String(err),
      statusCode: 500,
      usage: usageData,
    }
  }
}

/**
 * Consulta utilitária do estado atual do limiter (sem disparar requisições)
 */
function obterStatusLimiter() {
  const { usageData } = obterOuCriarRegistroUso()
  const count = Number(usageData.count) || 0

  let apiValidada = null
  try {
    const valRec = $app.findFirstRecordByFilter('config_integracoes', "chave = 'api_validada'")
    if (valRec) {
      const raw = valRec.getString('api_key') || ''
      try {
        apiValidada = JSON.parse(raw)
      } catch (_) {
        apiValidada = { timestamp: raw }
      }
    }
  } catch (_) {
    apiValidada = null
  }

  return {
    date_utc: usageData.date_utc,
    count: count,
    max_limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - count),
    waiting_reset: count >= DAILY_LIMIT,
    blocked: count >= DAILY_LIMIT,
    last_reset_utc: usageData.last_reset_utc,
    last_request_utc: usageData.last_request_utc,
    api_validada: apiValidada,
  }
}

function checarApiValidadaECota() {
  const status = obterStatusLimiter()
  return {
    validada: Boolean(status.api_validada),
    api_validada: status.api_validada,
    cota_disponivel: !status.waiting_reset,
    count: status.count,
    max_limit: status.max_limit,
    remaining: status.remaining,
    waiting_reset: status.waiting_reset,
  }
}

module.exports = {
  enviarRequisicaoApiFootball,
  obterStatusLimiter,
  checarApiValidadaECota,
  DAILY_LIMIT,
}
