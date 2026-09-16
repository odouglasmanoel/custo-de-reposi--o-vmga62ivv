/**
 * Utilitários para formatação e exibição de marcadores de gols de palpites.
 */

interface PalpiteLike {
  placar_a?: number | null
  placar_b?: number | null
  goleadores_a?: any
  goleadores_b?: any
}

/**
 * Normaliza qualquer formato salvo (array de strings, string JSON, string separada por vírgula)
 * em uma lista limpa de nomes de marcadores de gols.
 */
export function extractScorerNames(raw: any): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : String(item?.nome || '').trim()))
      .filter((s) => s.length > 0)
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return extractScorerNames(parsed)
      }
    } catch {
      // String simples separada por vírgula
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    }
  }
  return []
}

/**
 * Retorna o texto formatado dos marcadores de gols para exibição no card de palpite:
 * Ex:
 * - Se placar 0 x 0: "0x0" ou "Sem marcadores"
 * - Se time A ou B indicou goleadores: "Gols: Veiga, Flaco López"
 * - Se placar tem gols (> 0) mas nenhum marcador foi indicado: "Sem marcadores informados"
 */
export function formatPalpiteMarcadoresSummary(
  palpite: PalpiteLike,
  options?: { showZeroAs0x0?: boolean },
): string {
  const placarA = Number(palpite.placar_a) || 0
  const placarB = Number(palpite.placar_b) || 0
  const totalGols = placarA + placarB

  if (totalGols === 0) {
    return options?.showZeroAs0x0 ? '0x0' : 'Sem marcadores (0x0)'
  }

  const scorersA = extractScorerNames(palpite.goleadores_a)
  const scorersB = extractScorerNames(palpite.goleadores_b)
  const todosScorers = [...scorersA, ...scorersB]

  if (todosScorers.length === 0) {
    return 'Sem marcadores'
  }

  return `Gols: ${todosScorers.join(', ')}`
}

/**
 * Retorna detalhamento separado por time caso o layout prefira mostrar por time
 */
export function getPalpiteMarcadoresPorTime(palpite: PalpiteLike): {
  timeA: string[]
  timeB: string[]
  totalGols: number
  allScorers: string[]
} {
  const placarA = Number(palpite.placar_a) || 0
  const placarB = Number(palpite.placar_b) || 0
  const timeA = extractScorerNames(palpite.goleadores_a)
  const timeB = extractScorerNames(palpite.goleadores_b)

  return {
    timeA,
    timeB,
    totalGols: placarA + placarB,
    allScorers: [...timeA, ...timeB],
  }
}
