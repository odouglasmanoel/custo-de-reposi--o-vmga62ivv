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
