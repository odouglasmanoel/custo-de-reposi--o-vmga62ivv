import { getJogoKickoffTimestamp } from './dateUtils'

export interface JogoPontuaInput {
  data?: string | Date | null
  hora?: string | null
  status?: string | null
  resultado_finalizado?: boolean | null
}

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
