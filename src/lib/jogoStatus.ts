import { getJogoKickoffTimestamp } from './dateUtils'

export interface JogoPontuaInput {
  data?: string | Date | null
  hora?: string | null
  status?: string | null
  resultado_finalizado?: boolean | null
}

export const STATUS_CONCLUIDOS = new Set([
  'finalizado',
  'encerrado',
  'ft',
  'finished',
  'aet',
  'pen',
  'match finished',
])

const STATUS_NAO_INICIADOS = new Set([
  'pendente',
  'agendado',
  'ns',
  'not_started',
  'aguardando',
  'postponed',
  'pst',
  'canc',
  'cancelled',
])

const STATUS_INICIADOS_OU_FINAIS = new Set([
  'em_andamento',
  'ao_vivo',
  'live',
  '1h',
  '2h',
  'ht',
  'et',
  'bt',
  'p',
  'finalizado',
  'encerrado',
  'ft',
  'finished',
  'aet',
  'pen',
  'match finished',
])

/**
 * Função única centralizada para verificar se um jogo pontua:
 * - Retorna false se agoraMs < kickoffMs do jogo (data/hora futura no fuso America/Sao_Paulo)
 * - Retorna false se status for "pendente", "agendado", "ns" ou equivalentes
 * - Retorna true somente se kickoff já passou E status for em_andamento/ao_vivo/finalizado/encerrado
 *   ou resultado_finalizado=true COM kickoff <= agoraMs
 */
/**
 * Verifica se uma partida já foi iniciada (ao vivo ou encerrada/finalizada).
 * Uma partida é considerada iniciada se:
 * 1. resultado_finalizado for true; OU
 * 2. status for ao_vivo / finalizado / encerrado / ft / etc.; OU
 * 3. horário de kickoff já tiver sido atingido no fuso de Brasília (agoraMs >= kickoffMs),
 *    exceto se o status explicitamente indicar não iniciado (ex: adiado/cancelado).
 */
/**
 * Verifica se um jogo está encerrado/finalizado:
 * - resultado_finalizado === true
 * - ou status for finalizado, encerrado, ft, finished, aet, pen, match finished
 */
export function isJogoConcluido(
  jogo: { status?: string | null; resultado_finalizado?: boolean | null } | null | undefined,
): boolean {
  if (!jogo) return false
  if (jogo.resultado_finalizado) return true
  const rawStatus = (jogo.status || '').toLowerCase().trim()
  return Boolean(rawStatus && STATUS_CONCLUIDOS.has(rawStatus))
}

export function isJogoIniciado(
  jogo: JogoPontuaInput | null | undefined,
  agoraMs: number = Date.now(),
): boolean {
  if (!jogo) return false

  if (jogo.resultado_finalizado) return true

  const rawStatus = (jogo.status || '').toLowerCase().trim()
  if (rawStatus && STATUS_INICIADOS_OU_FINAIS.has(rawStatus)) {
    return true
  }

  if (rawStatus && STATUS_NAO_INICIADOS.has(rawStatus)) {
    // Se o status for explicitamente cancelado ou adiado, não iniciou mesmo se a hora original passou
    if (['postponed', 'pst', 'canc', 'cancelled'].includes(rawStatus)) {
      return false
    }
    // Para 'pendente', 'agendado', 'ns', 'not_started', 'aguardando':
    // Se o horário de kickoff no fuso de Brasília já passou, a partida já iniciou
    const kickoffMs = getJogoKickoffTimestamp(jogo.data, jogo.hora)
    return kickoffMs !== null && agoraMs >= kickoffMs
  }

  const kickoffMs = getJogoKickoffTimestamp(jogo.data, jogo.hora)
  if (kickoffMs !== null) {
    return agoraMs >= kickoffMs
  }

  return false
}

export function jogoPontua(
  jogo: JogoPontuaInput | null | undefined,
  agoraMs: number = Date.now(),
): boolean {
  if (!jogo) return false

  const kickoffMs = getJogoKickoffTimestamp(jogo.data, jogo.hora)
  // Se tem kickoff válido e o momento atual ainda não atingiu o início do jogo: NUNCA PONTUA
  if (kickoffMs !== null && agoraMs < kickoffMs) {
    return false
  }

  const rawStatus = (jogo.status || '').toLowerCase().trim()
  if (rawStatus && STATUS_NAO_INICIADOS.has(rawStatus)) {
    return false
  }

  const isFinalizado = Boolean(jogo.resultado_finalizado)
  const isStatusIniciadoOuFinal = Boolean(rawStatus && STATUS_INICIADOS_OU_FINAIS.has(rawStatus))

  // Se resultado_finalizado for true, valida se o kickoff já passou (ou caso kickoff seja indefinido)
  if (isFinalizado) {
    if (kickoffMs !== null) {
      return agoraMs >= kickoffMs
    }
    return true
  }

  // Se não tem resultado_finalizado mas status indica em andamento ou finalizado
  if (isStatusIniciadoOuFinal) {
    if (kickoffMs !== null) {
      return agoraMs >= kickoffMs
    }
    return true
  }

  return false
}
