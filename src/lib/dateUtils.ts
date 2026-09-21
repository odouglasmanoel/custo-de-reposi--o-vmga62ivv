/**
 * Central date and time formatter in Brazilian standard.
 * - Dates: DD/MM/AAAA (ex: 16/09/2026)
 * - Times: 21h30 (or HHhMM)
 *
 * Removes ISO UTC strings like "2026-09-16 00:00:00.000Z".
 */

/**
 * Formats a date string (ISO UTC, date only, or timestamp) into DD/MM/AAAA.
 */
export function formatDataBR(value?: string | Date | null): string {
  if (!value) return '—'

  try {
    let dateObj: Date
    if (value instanceof Date) {
      dateObj = value
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return '—'

      // If already in DD/MM/YYYY format
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
        return trimmed
      }

      // If "YYYY-MM-DD" or starts with "YYYY-MM-DD"
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (match) {
        const [, year, month, day] = match
        return `${day}/${month}/${year}`
      }

      dateObj = new Date(trimmed)
    } else {
      return '—'
    }

    if (isNaN(dateObj.getTime())) return '—'

    // Format using UTC to prevent off-by-one day timezone shifts when date-only ISO is passed
    const day = String(dateObj.getUTCDate()).padStart(2, '0')
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0')
    const year = dateObj.getUTCFullYear()
    return `${day}/${month}/${year}`
  } catch {
    return '—'
  }
}

/**
 * Formats time string into Brazilian standard "21h30".
 * Accepts "21:30", "21h30", "21:30:00", etc.
 */
export function formatHoraBR(value?: string | null): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  // Already in "21h30" format
  if (/^\d{1,2}h\d{2}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  // Format "21:30" or "21:30:00"
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})/)
  if (colonMatch) {
    const [, hh, mm] = colonMatch
    return `${hh.padStart(2, '0')}h${mm}`
  }

  return trimmed
}

/**
 * Combined date and time format in Brazilian standard: "16/09/2026 às 21h30"
 */
export function formatDataHoraBR(
  dateValue?: string | Date | null,
  timeValue?: string | null,
): string {
  const data = formatDataBR(dateValue)
  const hora = formatHoraBR(timeValue)

  if (data === '—' && !hora) return '—'
  if (data !== '—' && hora) return `${data} às ${hora}`
  if (data !== '—') return data
  return hora
}

/**
 * Formats a full ISO timestamp (created, updated, ultima_atualizacao) into "DD/MM/AAAA às 21h30"
 */
export function formatDateTimeBR(isoString?: string | Date | null): string {
  if (!isoString) return '—'
  try {
    const d = isoString instanceof Date ? isoString : new Date(isoString)
    if (isNaN(d.getTime())) return '—'
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} às ${hours}h${minutes}`
  } catch {
    return '—'
  }
}

/**
 * Parses hora string (e.g. "16:08", "16h08", "16:08:00") into { hours, minutes }
 */
export function parseHoraJogo(hora?: string | null): { hours: number; minutes: number } {
  if (!hora) return { hours: 0, minutes: 0 }
  const trimmed = hora.trim()
  const match = trimmed.match(/^(\d{1,2})[:hH](\d{2})/)
  if (match) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
    }
  }
  const justHour = trimmed.match(/^(\d{1,2})/)
  if (justHour) {
    return {
      hours: parseInt(justHour[1], 10),
      minutes: 0,
    }
  }
  return { hours: 0, minutes: 0 }
}

/**
 * Returns the exact UTC timestamp (in milliseconds) representing the match kickoff time
 * in America/Sao_Paulo (UTC-3).
 *
 * Handles both "YYYY-MM-DD" and ISO "YYYY-MM-DDTHH:mm:ss.sssZ" date representations.
 * The calendar date (year, month, day) combined with the match time (e.g. "16h08")
 * is treated as an America/Sao_Paulo local time, converted to absolute UTC timestamp.
 * In Brasilia standard time (UTC-3), local 16:08 is equivalent to 19:08 UTC.
 */
export function getJogoKickoffTimestamp(
  dataValue?: string | Date | null,
  horaValue?: string | null,
): number | null {
  if (!dataValue) return null

  let year: number
  let month: number
  let day: number

  if (dataValue instanceof Date) {
    if (isNaN(dataValue.getTime())) return null
    year = dataValue.getUTCFullYear()
    month = dataValue.getUTCMonth() + 1
    day = dataValue.getUTCDate()
  } else if (typeof dataValue === 'string') {
    const trimmed = dataValue.trim()
    if (!trimmed) return null

    // Check DD/MM/YYYY
    const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (brMatch) {
      day = parseInt(brMatch[1], 10)
      month = parseInt(brMatch[2], 10)
      year = parseInt(brMatch[3], 10)
    } else {
      // Check YYYY-MM-DD
      const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (isoMatch) {
        year = parseInt(isoMatch[1], 10)
        month = parseInt(isoMatch[2], 10)
        day = parseInt(isoMatch[3], 10)
      } else {
        const d = new Date(trimmed)
        if (isNaN(d.getTime())) return null
        year = d.getUTCFullYear()
        month = d.getUTCMonth() + 1
        day = d.getUTCDate()
      }
    }
  } else {
    return null
  }

  const { hours, minutes } = parseHoraJogo(horaValue)

  // Brasilia (America/Sao_Paulo) is standard UTC-3 (offset -03:00).
  // Date.UTC creates the UTC timestamp for those exact numbers:
  // (local hours + 3) in UTC
  const utcHours = hours + 3
  return Date.UTC(year, month - 1, day, utcHours, minutes, 0, 0)
}

/**
 * Retorna o timestamp UTC exato combinado no fuso de Brasília (UTC = hora + 3)
 * para fins de ordenação cronológica precisa entre datas e horários distintos.
 */
export function getJogoSortTimestamp(
  dataValue?: string | Date | null,
  horaValue?: string | null,
): number {
  const ts = getJogoKickoffTimestamp(dataValue, horaValue)
  if (ts !== null && !isNaN(ts)) {
    return ts
  }
  // Fallback seguro caso a data não seja válida
  return 0
}

/**
 * Checks if a game's prediction deadline has passed.
 * The deadline expires the moment the game starts (dataHoraAtual >= dataHoraJogo)
 * in America/Sao_Paulo (UTC-3).
 */
export function isPalpiteEncerrado(
  dataValue?: string | Date | null,
  horaValue?: string | null,
  nowMs: number = Date.now(),
): boolean {
  const kickoffMs = getJogoKickoffTimestamp(dataValue, horaValue)
  if (!kickoffMs) return false
  return nowMs >= kickoffMs
}

/**
 * Formats match cutoff time in standard format "HH:mm" (e.g. "16:08").
 */
export function formatHoraEncerramento(horaValue?: string | null): string {
  const { hours, minutes } = parseHoraJogo(horaValue)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * Returns today's date formatted as "YYYY-MM-DD" in America/Sao_Paulo timezone.
 */
export function getHojeDataSaoPaulo(nowMs: number = Date.now()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date(nowMs))
}

/**
 * Normalizes a game date (DD/MM/YYYY, YYYY-MM-DD, or ISO) to "YYYY-MM-DD" string.
 */
export function normalizeDataISO(dataValue?: string | Date | null): string | null {
  if (!dataValue) return null
  if (dataValue instanceof Date) {
    if (isNaN(dataValue.getTime())) return null
    const y = dataValue.getUTCFullYear()
    const m = String(dataValue.getUTCMonth() + 1).padStart(2, '0')
    const d = String(dataValue.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const trimmed = dataValue.trim()
  if (!trimmed) return null

  // DD/MM/YYYY
  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
  }

  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const d = new Date(trimmed)
  if (isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Alias helper for today's date string in America/Sao_Paulo (e.g. "YYYY-MM-DD")
 */
export function getTodayDateString(nowMs: number = Date.now()): string {
  return getHojeDataSaoPaulo(nowMs)
}

/**
 * Checks if a game date is today in the America/Sao_Paulo timezone.
 */
export function isJogoHoje(dataValue?: string | Date | null, nowMs: number = Date.now()): boolean {
  const normalizedGameDate = normalizeDataISO(dataValue)
  if (!normalizedGameDate) return false
  const hojeSaoPaulo = getHojeDataSaoPaulo(nowMs)
  return normalizedGameDate === hojeSaoPaulo
}

/**
 * Checks if a game is scheduled for today AND has not started yet
 * (dataHoraJogo > dataHoraAtual in America/Sao_Paulo).
 */
export function isJogoHojeNaoIniciado(
  dataValue?: string | Date | null,
  horaValue?: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!isJogoHoje(dataValue, nowMs)) return false
  const kickoffMs = getJogoKickoffTimestamp(dataValue, horaValue)
  if (!kickoffMs) return false
  return kickoffMs > nowMs
}

/**
 * Converte data e hora de qualquer formato (ISO UTC, Date, ou local SP)
 * para a representação canônica em America/Sao_Paulo (UTC-3).
 * Retorna { data: "YYYY-MM-DD", horario: "HH:mm" }
 */
export function formatDataHoraSaoPaulo(
  dataInput?: string | Date | null,
  horaInput?: string | null,
): { data: string; horario: string } {
  if (!dataInput) {
    return { data: '', horario: horaInput ? formatHoraEncerramento(horaInput) : '16:00' }
  }

  // Se já for uma ISO com 'T' ou Date ou timestamp UTC completo
  if (
    dataInput instanceof Date ||
    (typeof dataInput === 'string' && (dataInput.includes('T') || dataInput.endsWith('Z')))
  ) {
    try {
      const d = dataInput instanceof Date ? dataInput : new Date(dataInput)
      if (!isNaN(d.getTime())) {
        const dateFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
        const dataSP = dateFormatter.format(d)
        const horarioSP = timeFormatter.format(d).replace(':', ':')
        return { data: dataSP, horario: horarioSP }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // Se já for string "YYYY-MM-DD" simples ou "DD/MM/YYYY"
  const normalizedData = normalizeDataISO(dataInput) || ''
  const parsedHora = parseHoraJogo(horaInput)
  const horarioStr = `${String(parsedHora.hours).padStart(2, '0')}:${String(parsedHora.minutes).padStart(2, '0')}`

  return { data: normalizedData, horario: horarioStr }
}

/**
 * Regra de Filtro de Margem Mínima de Tempo (+3 Horas) para Enquetes:
 * "Ao buscar os jogos no período selecionado, ignore qualquer partida
 * que comece em menos de 3 horas a partir do exato momento em que a busca/enquete é criada."
 *
 * Retorna true se a partida começar com pelo menos 3 horas de antecedência
 * a partir de nowMs (padrão Date.now()).
 * Retorna false se a partida já tiver começado ou se faltar menos de 3 horas para o kickoff.
 */
export function satisfiesEnqueteMinTimeMargin(
  dataValue?: string | Date | null,
  horaValue?: string | null,
  nowMs: number = Date.now(),
  minHoursMargin = 3,
): boolean {
  const kickoffMs = getJogoKickoffTimestamp(dataValue, horaValue)
  if (!kickoffMs) return false
  const minAllowedKickoff = nowMs + minHoursMargin * 3600 * 1000
  return kickoffMs >= minAllowedKickoff
}

/**
 * Interface mínima para itens que podem ser ordenados pela regra oficial de "Jogos Cadastrados":
 * 1. Status/Pendência: jogos pendentes (não finalizados / sem resultado registrado) primeiro, no topo.
 * 2. Data: datas em ordem decrescente (datas mais recentes/futuras primeiro).
 * 3. Horário: para jogos na mesma data, horário em ordem crescente (mais cedo primeiro — ex.: 16:00 antes de 21:30).
 */
export interface JogoSortable {
  resultado_finalizado?: boolean | null
  data: string | Date
  hora?: string | null
  placar_a?: number | null
  placar_b?: number | null
}

/**
 * Função comparadora para ordenação da Lista de Jogos Cadastrados.
 * Critérios em ordem estrita de prioridade:
 * 1. Pendente primeiro (resultado_finalizado === false ou sem resultado registrado antes de encerrado).
 * 2. Data decrescente (mais recente/futura antes).
 * 3. Horário crescente na mesma data (mais cedo antes: 16:00 antes de 21:30).
 */
export function compareJogosCadastrados<T extends JogoSortable>(a: T, b: T): number {
  const finalizadoA = Boolean(a.resultado_finalizado)
  const finalizadoB = Boolean(b.resultado_finalizado)

  // 1. Status/Pendência: pendentes (false) primeiro, encerrados (true) depois
  if (finalizadoA !== finalizadoB) {
    return finalizadoA ? 1 : -1
  }

  // 2. Data: ordem decrescente (mais recente/futura primeiro)
  const isoA = normalizeDataISO(a.data) || ''
  const isoB = normalizeDataISO(b.data) || ''
  if (isoA !== isoB) {
    return isoB.localeCompare(isoA)
  }

  // 3. Horário: na mesma data, ordem crescente (mais cedo primeiro: ex 16:00 antes de 21:30)
  const timeA = parseHoraJogo(a.hora)
  const timeB = parseHoraJogo(b.hora)
  const minutesA = timeA.hours * 60 + timeA.minutes
  const minutesB = timeB.hours * 60 + timeB.minutes

  return minutesA - minutesB
}

/**
 * Helper que retorna uma nova cópia do array ordenada pela regra oficial.
 */
export function sortJogosCadastrados<T extends JogoSortable>(jogos: T[]): T[] {
  return [...jogos].sort(compareJogosCadastrados)
}

/**
 * Função comparadora para ordenação da aba Meus Palpites em Ordem Crescente:
 * 1. Status/Pendência: jogos pendentes primeiro (no topo), finalizados depois.
 * 2. Data crescente: datas mais próximas/anteriores primeiro (ex: 12/06 antes de 15/06).
 * 3. Horário crescente na mesma data: mais cedo primeiro (ex: 16:00 antes de 20:00).
 */
export function compareJogosCrescente<T extends JogoSortable>(a: T, b: T): number {
  // Timestamp UTC combinado no fuso de Brasília: ordem crescente unificada (mais cedo / mais próximo primeiro)
  const tsA = getJogoSortTimestamp(a.data, a.hora)
  const tsB = getJogoSortTimestamp(b.data, b.hora)
  if (tsA !== tsB) {
    return tsA - tsB
  }

  return 0
}

/**
 * Helper que retorna uma cópia de jogos ordenada em ordem crescente por data e horário
 * (jogos pendentes primeiro, e com os jogos mais próximos de acontecer no topo).
 */
export function sortJogosCrescente<T extends JogoSortable>(jogos: T[]): T[] {
  return [...jogos].sort(compareJogosCrescente)
}

/**
 * Função comparadora para ordenação da aba Meus Palpites em Ordem Decrescente:
 * 1. Status/Pendência: jogos pendentes primeiro (no topo), finalizados depois.
 * 2. Data decrescente: datas mais recentes/distantes no topo.
 * 3. Horário decrescente na mesma data: jogos mais tarde primeiro.
 */
export function compareJogosDecrescente<T extends JogoSortable>(a: T, b: T): number {
  // Timestamp UTC combinado no fuso de Brasília: ordem decrescente unificada (mais futuro/recente primeiro)
  const tsA = getJogoSortTimestamp(a.data, a.hora)
  const tsB = getJogoSortTimestamp(b.data, b.hora)
  if (tsA !== tsB) {
    return tsB - tsA
  }

  return 0
}

/**
 * Helper que retorna uma cópia de jogos ordenada em ordem decrescente por data e horário.
 */
export function sortJogosDecrescente<T extends JogoSortable>(jogos: T[]): T[] {
  return [...jogos].sort(compareJogosDecrescente)
}

/**
 * Converte data_limite_votacao (que pode ser ISO "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm", ou data simples "YYYY-MM-DD")
 * para timestamp UTC em milissegundos, considerando o fuso de Brasília (UTC-3).
 *
 * Se apenas a data "YYYY-MM-DD" for fornecida (sem horário explícito), considera o final do dia (23:59:59 em Brasília).
 */
export function getEnqueteDeadlineTimestamp(
  limiteStr?: string | null,
  fallbackDataFim?: string | null,
): number | null {
  const target = (limiteStr || '').trim() || (fallbackDataFim || '').trim()
  if (!target) return null

  // Trata formato datetime com data e hora: "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss"
  const dtMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (dtMatch) {
    const year = parseInt(dtMatch[1], 10)
    const month = parseInt(dtMatch[2], 10)
    const day = parseInt(dtMatch[3], 10)
    const hours = parseInt(dtMatch[4], 10)
    const minutes = parseInt(dtMatch[5], 10)
    const seconds = dtMatch[6] ? parseInt(dtMatch[6], 10) : 0
    // Horário local de Brasília (UTC-3) convertido para UTC (horas + 3)
    return Date.UTC(year, month - 1, day, hours + 3, minutes, seconds, 0)
  }

  // Trata formato DD/MM/YYYY HH:mm
  const brDtMatch = target.match(/^(\d{2})\/(\d{2})\/(\d{4})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (brDtMatch) {
    const day = parseInt(brDtMatch[1], 10)
    const month = parseInt(brDtMatch[2], 10)
    const year = parseInt(brDtMatch[3], 10)
    const hours = parseInt(brDtMatch[4], 10)
    const minutes = parseInt(brDtMatch[5], 10)
    const seconds = brDtMatch[6] ? parseInt(brDtMatch[6], 10) : 0
    return Date.UTC(year, month - 1, day, hours + 3, minutes, seconds, 0)
  }

  // Se for apenas data YYYY-MM-DD (ex: enquetes antigas usando data_fim), encerra às 23:59:59 de Brasília
  const dateOnlyMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const year = parseInt(dateOnlyMatch[1], 10)
    const month = parseInt(dateOnlyMatch[2], 10)
    const day = parseInt(dateOnlyMatch[3], 10)
    return Date.UTC(year, month - 1, day, 23 + 3, 59, 59, 999)
  }

  // Se for apenas data DD/MM/YYYY
  const brDateMatch = target.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brDateMatch) {
    const day = parseInt(brDateMatch[1], 10)
    const month = parseInt(brDateMatch[2], 10)
    const year = parseInt(brDateMatch[3], 10)
    return Date.UTC(year, month - 1, day, 23 + 3, 59, 59, 999)
  }

  // Fallback via Date parsing
  try {
    const parsed = new Date(target)
    if (!isNaN(parsed.getTime())) {
      return parsed.getTime()
    }
  } catch {
    /* ignore */
  }

  return null
}

/**
 * Verifica se a enquete ultrapassou o prazo limite de votação configurado.
 */
export function isEnqueteExpirada(
  limiteStr?: string | null,
  fallbackDataFim?: string | null,
  nowMs: number = Date.now(),
): boolean {
  const deadlineMs = getEnqueteDeadlineTimestamp(limiteStr, fallbackDataFim)
  if (!deadlineMs) return false
  return nowMs >= deadlineMs
}

/**
 * Formata o prazo limite da enquete para exibição amigável em português:
 * Exemplo: "20/09/2026 às 12:00"
 */
export function formatEnquetePrazoLimiteBR(
  limiteStr?: string | null,
  fallbackDataFim?: string | null,
): string {
  const target = (limiteStr || '').trim() || (fallbackDataFim || '').trim()
  if (!target) return '—'

  // Match YYYY-MM-DDTHH:mm
  const dtMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/)
  if (dtMatch) {
    const day = dtMatch[3].padStart(2, '0')
    const month = dtMatch[2].padStart(2, '0')
    const year = dtMatch[1]
    const hours = dtMatch[4].padStart(2, '0')
    const minutes = dtMatch[5].padStart(2, '0')
    return `${day}/${month}/${year} às ${hours}:${minutes}`
  }

  // Match DD/MM/YYYY HH:mm
  const brDtMatch = target.match(/^(\d{2})\/(\d{2})\/(\d{4})[T ](\d{1,2}):(\d{2})/)
  if (brDtMatch) {
    const day = brDtMatch[1].padStart(2, '0')
    const month = brDtMatch[2].padStart(2, '0')
    const year = brDtMatch[3]
    const hours = brDtMatch[4].padStart(2, '0')
    const minutes = brDtMatch[5].padStart(2, '0')
    return `${day}/${month}/${year} às ${hours}:${minutes}`
  }

  // Match apenas data YYYY-MM-DD -> exibe 23:59 ou apenas data
  const dateOnlyMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const day = dateOnlyMatch[3].padStart(2, '0')
    const month = dateOnlyMatch[2].padStart(2, '0')
    const year = dateOnlyMatch[1]
    return `${day}/${month}/${year} às 23:59`
  }

  return formatDataBR(target)
}

/**
 * Interface mínima de um confronto da enquete para cálculo do título dinâmico.
 */
export interface EnqueteJogoItemLike {
  data?: string | Date | null
  horario?: string | null
  hora?: string | null
}

/**
 * Interface mínima de uma enquete para cálculo do título dinâmico.
 */
export interface EnqueteTituloOptions {
  titulo?: string | null
  data_inicio?: string | Date | null
  data_fim?: string | Date | null
  status?: string | null
  jogos?: EnqueteJogoItemLike[] | null
  incluirStatus?: boolean
}

/**
 * Normaliza e formata o status da enquete para o sufixo:
 * "Aberta" | "Encerrada" | "Cadastrada"
 */
export function formatEnqueteStatusLabel(status?: string | null): string {
  const s = (status || '').trim().toLowerCase()
  if (s === 'cadastrada') return 'Cadastrada'
  if (s === 'encerrada') return 'Encerrada'
  return 'Aberta'
}

/**
 * Extrai o nome da competição/copa a partir do título existente ou padrão.
 * Padrão: "Copa Coni"
 */
export function extrairNomeCopaEnquete(titulo?: string | null, fallback = 'Copa Coni'): string {
  if (!titulo) return fallback
  const trimmed = titulo.trim()
  if (!trimmed) return fallback

  // Ex.: "Enquete Copa Coni — 23/09/2026 a 26/09/2026 (Aberta)"
  // ou "Copa Coni - 23/09/2026 a 26/09/2026"
  const matchPrefixo = trimmed.match(/^(?:Enquete\s+)?([^\-—–]+)/i)
  if (matchPrefixo && matchPrefixo[1].trim()) {
    const parsed = matchPrefixo[1].trim()
    if (!/\d/.test(parsed)) {
      const semEnquete = parsed.replace(/^Enquete\s+/i, '').trim()
      if (semEnquete) return semEnquete
    }
  }

  return fallback
}

/**
 * Monta dinamicamente o título de uma enquete a partir dos jogos cadastrados:
 * - Menor data/hora e maior data/hora dos jogos no fuso America/Sao_Paulo (UTC-3).
 * - Formato: "Enquete [Nome da Copa] — DD/MM/AAAA a DD/MM/AAAA" (ou " - " / " — ")
 * - Se incluirStatus = true: adiciona " (Status)" no final: "Enquete [Nome] — DD/MM/AAAA a DD/MM/AAAA (Aberta)"
 * - Fallback: Se não houver jogos cadastrados, usa o intervalo fixo predefinido (data_inicio a data_fim).
 */
export function formatEnqueteTituloDinamico(options: EnqueteTituloOptions): string {
  const nomeCopa = extrairNomeCopaEnquete(options.titulo, 'Copa Coni')
  const statusLabel = formatEnqueteStatusLabel(options.status)
  const incluirStatus = Boolean(options.incluirStatus)

  const jogosValidos: Array<{ timestamp: number; dataSP: string }> = []
  if (Array.isArray(options.jogos) && options.jogos.length > 0) {
    for (const j of options.jogos) {
      if (!j) continue
      const rawData = j.data
      const rawHora = j.horario || j.hora || '16:00'
      if (!rawData) continue

      const sp = formatDataHoraSaoPaulo(rawData, rawHora)
      const dataSP = sp.data || normalizeDataISO(rawData)
      if (!dataSP) continue

      const ts = getJogoSortTimestamp(dataSP, sp.horario || rawHora)
      jogosValidos.push({ timestamp: ts, dataSP })
    }
  }

  let dMinBR = ''
  let dMaxBR = ''

  if (jogosValidos.length > 0) {
    jogosValidos.sort((a, b) => a.timestamp - b.timestamp)
    const menor = jogosValidos[0]
    const maior = jogosValidos[jogosValidos.length - 1]
    dMinBR = formatDataBR(menor.dataSP)
    dMaxBR = formatDataBR(maior.dataSP)
  } else {
    // Fallback: intervalo fixo pré-definido da enquete (data_inicio e data_fim)
    const spInicio = options.data_inicio
      ? formatDataHoraSaoPaulo(options.data_inicio).data || options.data_inicio
      : ''
    const spFim = options.data_fim
      ? formatDataHoraSaoPaulo(options.data_fim).data || options.data_fim
      : ''
    dMinBR = formatDataBR(spInicio)
    dMaxBR = formatDataBR(spFim)
  }

  let intervaloTexto = ''
  if (dMinBR && dMinBR !== '—' && dMaxBR && dMaxBR !== '—') {
    intervaloTexto = `${dMinBR} a ${dMaxBR}`
  } else if (dMinBR && dMinBR !== '—') {
    intervaloTexto = dMinBR
  } else if (dMaxBR && dMaxBR !== '—') {
    intervaloTexto = dMaxBR
  }

  let baseTitulo = ''
  if (intervaloTexto) {
    baseTitulo = `Enquete ${nomeCopa} — ${intervaloTexto}`
  } else {
    baseTitulo = `Enquete ${nomeCopa}`
  }

  if (incluirStatus) {
    return `${baseTitulo} (${statusLabel})`
  }

  return baseTitulo
}
