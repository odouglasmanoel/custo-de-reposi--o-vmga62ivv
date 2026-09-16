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
