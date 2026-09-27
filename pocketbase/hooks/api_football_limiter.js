// pocketbase/hooks/api_football_limiter.js
// Centralizador único, limitador diário e gerenciador de fallback/rotação de chaves
// para a API-Football (v3.football.api-sports.io / RapidAPI)
//
// CARACTERÍSTICAS:
// - Suporte a Chave Principal e Chave Secundária de Backup (env: API_FOOTBALL_KEY_BACKUP / config: placar_ao_vivo_backup)
// - Detecção automática de cota esgotada (HTTP 429, 403 ou mensagens de quota/requests limit)
// - Fallback transparente e imediato para a chave secundária na mesma requisição
// - Persistência do estado da chave ativa (active_key: 'primary' | 'backup') em config_integracoes
// - Retorno automático para a chave principal em novo dia UTC (00:00 UTC = 21h Brasília)
// - Contador de uso diário independente por chave ou consolidado com teto de segurança
// - Função centralizadora enviarRequisicaoApiFootball compartilhada por todos os hooks

const DAILY_LIMIT = 80
const USAGE_RECORD_CHAVE = 'api_football_daily_usage'

function getTodayUtcString() {
  const d = new Date()
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Obtém as chaves configuradas (Principal e Backup)
 */
function obterChavesConfiguradas() {
  let primaryKey = ''
  let backupKey = ''

  // 1. Chave principal via config_integracoes (placar_ao_vivo)
  try {
    const recPlacar = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    if (recPlacar && recPlacar.getBool('ativo')) {
      primaryKey = (recPlacar.getString('api_key') || '').trim()
    }
  } catch (_) {}
  if (!primaryKey) {
    try {
      const recApiFoot = $app.findFirstRecordByData('config_integracoes', 'chave', 'api_football')
      if (recApiFoot && recApiFoot.getBool('ativo')) {
        primaryKey = (recApiFoot.getString('api_key') || '').trim()
      }
    } catch (_) {}
  }
  // 2. Fallbacks de ambiente para chave principal
  if (!primaryKey) {
    try {
      if (
        typeof $secrets !== 'undefined' &&
        $secrets &&
        $secrets.has &&
        $secrets.has('API_FOOTBALL_KEY')
      ) {
        primaryKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
      } else if (typeof $os !== 'undefined' && $os && $os.getenv) {
        primaryKey = ($os.getenv('API_FOOTBALL_KEY') || $os.getenv('RAPIDAPI_KEY') || '').trim()
      }
    } catch (_) {}
  }

  // 3. Chave secundária via config_integracoes (placar_ao_vivo_backup)
  try {
    const recBackup = $app.findFirstRecordByData(
      'config_integracoes',
      'chave',
      'placar_ao_vivo_backup',
    )
    if (recBackup && recBackup.getBool('ativo')) {
      backupKey = (recBackup.getString('api_key') || '').trim()
    }
  } catch (_) {}

  // 4. Chave secundária via segredo / env var (API_FOOTBALL_KEY_BACKUP)
  if (!backupKey) {
    try {
      if (
        typeof $secrets !== 'undefined' &&
        $secrets &&
        $secrets.has &&
        $secrets.has('API_FOOTBALL_KEY_BACKUP')
      ) {
        backupKey = ($secrets.get('API_FOOTBALL_KEY_BACKUP') || '').trim()
      } else if (typeof $os !== 'undefined' && $os && $os.getenv) {
        backupKey = ($os.getenv('API_FOOTBALL_KEY_BACKUP') || '').trim()
      }
    } catch (_) {}
  }

  return { primaryKey, backupKey }
}

/**
 * Lê ou cria o registro de rastreamento de uso e chave ativa
 */
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
    count_primary: 0,
    count_backup: 0,
    max_limit: DAILY_LIMIT,
    trava_desativada: true, // Permitir trabalho com chave secundária
    blocked: false,
    active_key: 'primary', // 'primary' | 'backup'
    fallback_active: false,
    primary_exhausted: false,
    backup_exhausted: false,
    last_fallback_at: null,
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

    // Reset diário às 00:00 UTC (21h Brasília) -> Volta para a chave principal automaticamente
    if (usageData.date_utc !== hojeUtc) {
      console.log(
        `[API-Football Limiter] Novo dia UTC detectado (${hojeUtc} vs ${usageData.date_utc}). Resetando contador e restaurando chave principal.`,
      )
      usageData.date_utc = hojeUtc
      usageData.count = 0
      usageData.count_primary = 0
      usageData.count_backup = 0
      usageData.blocked = false
      usageData.primary_exhausted = false
      usageData.backup_exhausted = false
      usageData.active_key = 'primary'
      usageData.fallback_active = false
      if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
        usageData.max_limit = DAILY_LIMIT
      }
      usageData.last_reset_utc = new Date().toISOString()

      rec.set('api_key', JSON.stringify(usageData))
      rec.set('ativo', true)
      rec.set('provedor', 'api_football')
      try {
        $app.save(rec)
      } catch (_) {}
    }

    return { rec, usageData }
  }

  // Criação inicial do registro se não existir
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
    console.error('[API-Football Limiter] Falha ao criar registro de uso diário:', err)
    return { rec: null, usageData }
  }
}

/**
 * Incrementa o uso diário para a chave especificada
 */
function incrementarUso(rec, usageData, keyType) {
  try {
    usageData.count = (Number(usageData.count) || 0) + 1
    if (keyType === 'backup') {
      usageData.count_backup = (Number(usageData.count_backup) || 0) + 1
    } else {
      usageData.count_primary = (Number(usageData.count_primary) || 0) + 1
    }
    usageData.last_request_utc = new Date().toISOString()
    if (rec) {
      rec.set('api_key', JSON.stringify(usageData))
      $app.save(rec)
    }
  } catch (err) {
    console.error('[API-Football Limiter] Erro ao incrementar uso no banco:', err)
  }
}

/**
 * Marca que uma chave específica atingiu o limite de cota
 */
function marcarChaveEsgotada(rec, usageData, keyType, reason) {
  try {
    if (keyType === 'primary') {
      usageData.primary_exhausted = true
      usageData.active_key = 'backup'
      usageData.fallback_active = true
      usageData.last_fallback_at = new Date().toISOString()
      console.warn(
        `[API-Football Fallback] CHAVE PRINCIPAL ESGOTADA (${reason}). Chaveando automaticamente para chave SECUNDÁRIA (backup).`,
      )
    } else if (keyType === 'backup') {
      usageData.backup_exhausted = true
      usageData.blocked = true
      console.error(
        `[API-Football Fallback] AMBAS AS CHAVES (Principal e Backup) esgotaram a cota diária (${reason}).`,
      )
    }
    if (rec) {
      rec.set('api_key', JSON.stringify(usageData))
      $app.save(rec)
    }
  } catch (err) {
    console.error('[API-Football Fallback] Erro ao salvar estado de fallback:', err)
  }
}

/**
 * Avalia se o status HTTP ou o corpo JSON indica cota excedida / rate-limit
 */
function isQuotaExceededError(statusCode, jsonBody, rawBody) {
  if (statusCode === 429) return true

  // Verificação nos erros estruturados retornados pela API-Sports
  const apiErrors = jsonBody && jsonBody.errors ? jsonBody.errors : null
  if (apiErrors) {
    if (apiErrors.rateLimit || apiErrors.requests) return true
    const errStr = JSON.stringify(apiErrors).toLowerCase()
    if (
      errStr.includes('requests limit reached') ||
      errStr.includes('request limit reached') ||
      errStr.includes('quota exceeded') ||
      errStr.includes('exceeded the maximum') ||
      errStr.includes('too many requests') ||
      errStr.includes('free-tier limit') ||
      errStr.includes('100%')
    ) {
      return true
    }
  }

  // Verificação no raw body
  if (rawBody && typeof rawBody === 'string') {
    const lower = rawBody.toLowerCase()
    if (
      lower.includes('requests limit reached') ||
      lower.includes('request limit reached') ||
      lower.includes('quota exceeded') ||
      lower.includes('exceeded the maximum') ||
      lower.includes('too many requests')
    ) {
      return true
    }
  }

  return false
}

/**
 * Avalia se o status HTTP ou o corpo JSON indica erro de autenticação (401/403, chave inválida ou suspensa)
 */
function isAuthInvalidError(statusCode, jsonBody, rawBody) {
  // 1. Status 401 sempre indica não autenticado
  if (statusCode === 401) return true

  // Verificação nos erros estruturados ou raw da API-Sports
  const apiErrors = jsonBody && jsonBody.errors ? jsonBody.errors : null
  const errStr = (
    apiErrors ? JSON.stringify(apiErrors) : rawBody && typeof rawBody === 'string' ? rawBody : ''
  ).toLowerCase()

  // EXCLUSÕES EXPLÍCITAS: erros de PARÂMETRO ou de PLANO/RECURSO (ex.: ?ids= restrito a planos pagos)
  // NUNCA devem ser tratados como erro de autenticação da chave!
  if (
    errStr.includes('ids parameter') ||
    errStr.includes('only available with paid') ||
    errStr.includes('paid plan') ||
    errStr.includes('free plans') ||
    errStr.includes('free plan') ||
    errStr.includes('parameter') ||
    errStr.includes('is not allowed') ||
    errStr.includes('cannot be used')
  ) {
    return false
  }

  // 2. Erros específicos de token / chave nos erros estruturados
  if (apiErrors) {
    if (apiErrors.token) {
      const tokenMsg = String(apiErrors.token).toLowerCase()
      // Se a mensagem for sobre parâmetro ou plano, não é auth invalid
      if (!tokenMsg.includes('parameter') && !tokenMsg.includes('plan')) {
        return true
      }
    }
    // NOTA: apiErrors.access frequentemente contém mensagens de plano como:
    // "You do not have access to this endpoint / plan" ou restrição de endpoint
    if (apiErrors.access) {
      const accessMsg = String(apiErrors.access).toLowerCase()
      if (
        accessMsg.includes('invalid key') ||
        accessMsg.includes('wrong key') ||
        accessMsg.includes('suspended') ||
        accessMsg.includes('unauthenticated')
      ) {
        return true
      }
      // Se for apenas acesso negado a um endpoint/recurso de plano pago, não é erro de credencial da chave
      if (
        accessMsg.includes('plan') ||
        accessMsg.includes('endpoint') ||
        accessMsg.includes('parameter')
      ) {
        return false
      }
    }
  }

  // 3. Status 403 só é erro de auth se não for restrição de plano/parâmetro
  if (statusCode === 403) {
    if (
      errStr.includes('invalid key') ||
      errStr.includes('wrong key') ||
      errStr.includes('suspended') ||
      errStr.includes('expired') ||
      errStr.includes('unauthenticated') ||
      errStr.includes('unauthorized')
    ) {
      return true
    }
    // Sem mensagem de chave inválida, 403 genérico após descartar parâmetros
    return !errStr.includes('plan') && !errStr.includes('parameter')
  }

  // 4. Frases estritas e inequívocas de chave inválida/suspensa/expirada
  if (
    errStr.includes('invalid api key') ||
    errStr.includes('invalid key') ||
    errStr.includes('wrong api key') ||
    errStr.includes('wrong key') ||
    errStr.includes('account suspended') ||
    errStr.includes('key suspended') ||
    errStr.includes('key has expired') ||
    errStr.includes('key expired') ||
    errStr.includes('unauthenticated')
  ) {
    return true
  }

  return false
}

/**
 * Prepara cabeçalhos HTTP adequados para a chave fornecida
 */
function buildHeadersForKey(apiKey, customHeaders) {
  const headers = Object.assign({}, customHeaders || {})
  delete headers['x-apisports-key']
  delete headers['x-rapidapi-key']
  delete headers['x-rapidapi-host']

  // Injetar estritamente apenas a chave ativa em x-apisports-key
  if (apiKey) {
    headers['x-apisports-key'] = apiKey
  }
  return headers
}

/**
 * Função centralizadora enviarRequisicaoApiFootball
 * Único ponto de saída de requisições HTTP para a API-Football com:
 * 1. Rotação e fallback transparente de chave (Primary -> Backup)
 * 2. Persistência de estado da chave ativa
 * 3. Detecção precisa de erros de cota (429, requests limit)
 * 4. Retorno ao status original sem falhas silenciosas
 *
 * @param {string} url - URL completa (ex: https://v3.football.api-sports.io/...)
 * @param {object} options - Opções para $http.send (method, headers, timeout, etc)
 * @param {number} prioridade - 1 (placar ao vivo), 2 (escalações/admin), 3 (jogos do dia)
 * @returns {object} { blocked: boolean, statusCode: number, rawResponse: object, json: any, usage: object, keyUsed: string }
 */
function enviarRequisicaoApiFootball(url, options, prioridade) {
  const prio = Number(prioridade) || 1
  const isTestOrStatus =
    Boolean(options && options.isTest) || (url && url.indexOf('/status') !== -1)
  const isManualAdmin = Boolean(options && options.isAdminManual)

  const { rec, usageData } = obterOuCriarRegistroUso()
  const { primaryKey, backupKey } = obterChavesConfiguradas()

  // REGRA INVIOLÁVEL: A Chave Primária ativa do banco/configuração DEVE SER SEMPRE
  // a primeira tentativa em TODAS as requisições (/fixtures, /fixtures/events, /fixtures/lineups, /status).
  // NUNCA iniciar em 'backup' por estado legado quando a primária está configurada e ativa.
  // Somente inicia em 'backup' se a primária NÃO existir no banco/env e houver backup configurado.
  let initialKeyType = 'primary'
  if (!primaryKey && backupKey) {
    initialKeyType = 'backup'
  }

  // Se ambas as chaves já foram esgotadas hoje e não é admin manual nem teste/status
  if (
    primaryKey &&
    backupKey &&
    usageData.primary_exhausted &&
    usageData.backup_exhausted &&
    !isManualAdmin &&
    !isTestOrStatus
  ) {
    console.log('[API-Football Limiter] Todas as chaves da API-Football estão esgotadas para hoje.')
    return {
      blocked: true,
      rate_limited: true,
      waiting_reset: true,
      notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
      reason: 'all_keys_exhausted',
      statusCode: 429,
      usage: usageData,
    }
  }

  const primaryOrBackupKey = initialKeyType === 'backup' ? backupKey : primaryKey || backupKey
  let activeKey = primaryOrBackupKey
  let currentKeyType = initialKeyType

  // Execução do $http.send com tratamento de fallback
  const sendHttp = (targetKey, keyTypeLabel) => {
    const sendHeaders = buildHeadersForKey(targetKey, (options && options.headers) || {})
    const sendOptions = Object.assign(
      {
        method: 'GET',
        timeout: 15,
      },
      options || {},
      { headers: sendHeaders },
    )
    delete sendOptions.isAdminManual
    delete sendOptions.isTest

    console.log(
      `[API-Football Limiter] Enviando req [Chave: ${keyTypeLabel}] [Prio ${prio}]: ${url}`,
    )

    const res = $http.send(Object.assign({ url }, sendOptions))
    let jsonBody = null
    try {
      jsonBody = typeof res.json === 'object' && res.json !== null ? res.json : JSON.parse(res.raw)
    } catch (_) {
      jsonBody = null
    }

    return { res, jsonBody }
  }

  try {
    let { res, jsonBody } = sendHttp(activeKey, currentKeyType)
    let quotaExceeded = isQuotaExceededError(
      res ? res.statusCode : 500,
      jsonBody,
      res ? res.raw : '',
    )
    let authError = isAuthInvalidError(res ? res.statusCode : 500, jsonBody, res ? res.raw : '')

    // Se a primeira chave tentada foi a PRINCIPAL e deu cota excedida (429) OU erro REAL de autenticação (401/403 de chave inválida), tenta FALLBACK para a SECUNDÁRIA!
    if (
      (quotaExceeded || authError) &&
      currentKeyType === 'primary' &&
      backupKey &&
      backupKey !== primaryKey
    ) {
      console.warn(
        `[API-Football Limiter] Falha na chave PRINCIPAL (${authError ? 'Erro de autenticação/chave' : 'Cota excedida'}). Tentando chave SECUNDÁRIA de backup: ${url}`,
      )

      if (quotaExceeded) {
        marcarChaveEsgotada(rec, usageData, 'primary', `HTTP ${res ? res.statusCode : '429'}`)
      }

      currentKeyType = 'backup'
      activeKey = backupKey

      // Retry imediato com chave secundária
      const retryResult = sendHttp(activeKey, currentKeyType)
      res = retryResult.res
      jsonBody = retryResult.jsonBody
      quotaExceeded = isQuotaExceededError(res ? res.statusCode : 500, jsonBody, res ? res.raw : '')
      authError = isAuthInvalidError(res ? res.statusCode : 500, jsonBody, res ? res.raw : '')
    }

    // Se a chave secundária (ou ambas) também esgotou cota:
    if (quotaExceeded) {
      marcarChaveEsgotada(rec, usageData, currentKeyType, `HTTP ${res ? res.statusCode : 429}`)
      return {
        blocked: true,
        rate_limited: true,
        auth_error: false,
        waiting_reset: true,
        notice: 'Exibindo dados armazenados localmente (Aguardando reset da API às 21h)',
        statusCode: 429,
        rawResponse: res,
        json: jsonBody,
        usage: usageData,
        keyUsed: currentKeyType,
      }
    }

    // Se retornou 401/403 ou chave inválida/suspensa mesmo após fallback (ou em ambas):
    if (authError) {
      console.error(
        `[API-Football Limiter] Erro de autenticação 401/403 ou chave inválida/suspensa na chave ${currentKeyType}.`,
      )
      return {
        blocked: true,
        auth_error: true,
        rate_limited: false,
        waiting_reset: false,
        statusCode:
          res && (res.statusCode === 401 || res.statusCode === 403) ? res.statusCode : 401,
        notice: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
        rawResponse: res,
        json: jsonBody,
        usage: usageData,
        keyUsed: currentKeyType,
      }
    }

    // Requisição bem-sucedida (não deu erro de rate-limit nem auth)
    if (!isTestOrStatus) {
      incrementarUso(rec, usageData, currentKeyType)
    }

    // Se teve sucesso com a primária, garante que o estado ativo persista como 'primary'
    if (currentKeyType === 'primary' && usageData.active_key !== 'primary') {
      try {
        usageData.active_key = 'primary'
        usageData.fallback_active = false
        usageData.primary_exhausted = false
        if (rec) {
          rec.set('api_key', JSON.stringify(usageData))
          $app.save(rec)
        }
      } catch (_) {}
    }

    return {
      blocked: false,
      auth_error: false,
      statusCode: res ? res.statusCode : 200,
      rawResponse: res,
      json: jsonBody,
      usage: usageData,
      keyUsed: currentKeyType,
    }
  } catch (err) {
    console.error(`[API-Football Limiter] Exceção na requisição HTTP (${url}):`, err)

    // Se houve erro de rede na principal e temos backup, tenta backup
    if (currentKeyType === 'primary' && backupKey && backupKey !== primaryKey) {
      try {
        console.warn(
          `[API-Football Limiter] Tentando backup após exceção na principal: ${err.message || String(err)}`,
        )
        currentKeyType = 'backup'
        activeKey = backupKey
        const { res: resB, jsonBody: jsonB } = sendHttp(activeKey, currentKeyType)
        if (!isTestOrStatus) {
          incrementarUso(rec, usageData, currentKeyType)
        }
        return {
          blocked: false,
          statusCode: resB ? resB.statusCode : 200,
          rawResponse: resB,
          json: jsonB,
          usage: usageData,
          keyUsed: currentKeyType,
        }
      } catch (errBackup) {
        console.error('[API-Football Limiter] Exceção também na chave backup:', errBackup)
      }
    }

    return {
      blocked: true,
      error: String(err),
      statusCode: 500,
      usage: usageData,
      keyUsed: currentKeyType,
    }
  }
}

/**
 * Consulta utilitária do estado atual do limiter
 */
function obterStatusLimiter() {
  const { usageData } = obterOuCriarRegistroUso()
  const { primaryKey, backupKey } = obterChavesConfiguradas()
  const count = Number(usageData.count) || 0
  const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
  const travaDesativada = Boolean(usageData.trava_desativada)
  // O sistema só deve bloquear totalmente se AMBAS as chaves estiverem esgotadas,
  // ou se trava estiver ativa E não houver chave backup disponível
  const bothExhausted = Boolean(usageData.primary_exhausted && usageData.backup_exhausted)
  const isBlocked =
    Boolean(usageData.blocked) ||
    bothExhausted ||
    (!travaDesativada && !backupKey && count >= maxLimit)

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
    count_primary: usageData.count_primary || 0,
    count_backup: usageData.count_backup || 0,
    max_limit: maxLimit,
    trava_desativada: travaDesativada,
    remaining: Math.max(0, maxLimit - count),
    waiting_reset: isBlocked,
    blocked: isBlocked,
    active_key: usageData.active_key || 'primary',
    fallback_active: Boolean(usageData.fallback_active),
    primary_exhausted: Boolean(usageData.primary_exhausted),
    backup_exhausted: Boolean(usageData.backup_exhausted),
    has_backup_key: Boolean(backupKey),
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
    trava_desativada: status.trava_desativada,
    remaining: status.remaining,
    waiting_reset: status.waiting_reset,
    active_key: status.active_key,
    fallback_active: status.fallback_active,
  }
}

module.exports = {
  enviarRequisicaoApiFootball,
  isQuotaExceededError,
  isAuthInvalidError,
  obterStatusLimiter,
  checarApiValidadaECota,
  obterOuCriarRegistroUso,
  obterChavesConfiguradas,
  DAILY_LIMIT,
}
