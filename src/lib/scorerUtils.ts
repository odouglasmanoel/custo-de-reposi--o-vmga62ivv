/**
 * Utilitários para formatação e exibição de marcadores de gols de palpites e partidas.
 */

export interface PalpiteLike {
  placar_a?: number | string | null
  placar_b?: number | string | null
  goleadores_a?: any
  goleadores_b?: any
}

export interface LiveScorerLike {
  name: string
  minute?: number | null
  teamId?: number | null
  teamName?: string | null
  teamSide?: 'home' | 'away' | null
}

export interface JogoGolsLike {
  nome: string
  posicao?: string
  quantidade?: number
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
 * Retorna o texto formatado dos marcadores de gols para exibição em linha única (fallback / legado):
 * Ex:
 * - Se placar 0 x 0: "0x0" ou "Sem marcadores (0x0)"
 * - Se time A ou B indicou goleadores: "Gols: Veiga, Flaco López"
 * - Se placar tem gols (> 0) mas nenhum marcador foi indicado: "Sem marcadores"
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
 * Retorna detalhamento separado por time para palpites dos participantes:
 * - placarA / placarB
 * - timeA (nomes de goleadores apostados no time A)
 * - timeB (nomes de goleadores apostados no time B)
 * - labelA: lista dos marcadores ou "-" quando o palpite for 0 ou sem marcadores
 * - labelB: lista dos marcadores ou "-" quando o palpite for 0 ou sem marcadores
 */
export function getPalpiteMarcadoresPorTime(palpite: PalpiteLike): {
  placarA: number
  placarB: number
  timeA: string[]
  timeB: string[]
  labelA: string
  labelB: string
  totalGols: number
  allScorers: string[]
  isZeroA: boolean
  isZeroB: boolean
} {
  const rawA =
    palpite.placar_a !== null && palpite.placar_a !== undefined ? Number(palpite.placar_a) : 0
  const rawB =
    palpite.placar_b !== null && palpite.placar_b !== undefined ? Number(palpite.placar_b) : 0
  const placarA = isNaN(rawA) ? 0 : Math.max(0, rawA)
  const placarB = isNaN(rawB) ? 0 : Math.max(0, rawB)
  const isZeroA = placarA === 0
  const isZeroB = placarB === 0

  const timeA = extractScorerNames(palpite.goleadores_a)
  const timeB = extractScorerNames(palpite.goleadores_b)

  // Se o palpite para um dos lados for 0, exibir como "-" ou não listar nomes para essa equipe.
  // Se houver gols apostados (>0) mas a lista estiver vazia, exibir "-" também.
  const labelA = isZeroA ? '-' : timeA.length > 0 ? timeA.join(', ') : '-'
  const labelB = isZeroB ? '-' : timeB.length > 0 ? timeB.join(', ') : '-'

  return {
    placarA,
    placarB,
    timeA,
    timeB,
    labelA,
    labelB,
    totalGols: placarA + placarB,
    allScorers: [...timeA, ...timeB],
    isZeroA,
    isZeroB,
  }
}

/**
 * Estrutura para retorno dos gols reais da partida divididos por equipe (mandante/visitante)
 */
export interface MatchScorersByTeam {
  teamAName: string
  teamBName: string
  placarA: number | null
  placarB: number | null
  hasGolsA: boolean
  hasGolsB: boolean
  scorersA: string[]
  scorersB: string[]
  labelA: string
  labelB: string
  hasAnyScorers: boolean
}

export interface SplitMatchScorersOptions {
  teamAName: string
  teamBName: string
  placarA?: number | string | null
  placarB?: number | string | null
  // Fonte 1: Sobrescrita manual do Admin (ex: ["Luis Segovia", "Marlon Freitas"] ou lista formatada)
  sobrescritaMarcadores?: string[] | null
  // Fonte 2: Marcadores ao vivo da API (LiveScorerItem[])
  liveScorers?: LiveScorerLike[] | null
  // Fonte 3: Marcadores do banco estruturados (gols_time_a / gols_time_b)
  golsBancoA?: JogoGolsLike[] | string[] | null
  golsBancoB?: JogoGolsLike[] | string[] | null
  // Fonte 4: Marcadores legado do banco (campo jogo.marcadores)
  marcadoresBancoLegado?: any[] | string | null
}

/**
 * Divide os gols reais da partida (cabeçalho geral) entre Time A (mandante) e Time B (visitante).
 * Preserva minuto e "(contra)" quando disponíveis.
 * Se o time tiver 0 gols ou nenhum marcador registrado: exibe "-".
 */
export function splitMatchScorersByTeam(options: SplitMatchScorersOptions): MatchScorersByTeam {
  const {
    teamAName,
    teamBName,
    placarA: rawPlacarA,
    placarB: rawPlacarB,
    sobrescritaMarcadores,
    liveScorers,
    golsBancoA,
    golsBancoB,
    marcadoresBancoLegado,
  } = options

  const parsedPlacarA =
    rawPlacarA !== undefined && rawPlacarA !== null && rawPlacarA !== '' ? Number(rawPlacarA) : null
  const parsedPlacarB =
    rawPlacarB !== undefined && rawPlacarB !== null && rawPlacarB !== '' ? Number(rawPlacarB) : null

  const scorersA: string[] = []
  const scorersB: string[] = []

  // Prioridade 1: Sobrescrita manual do Admin Douglas
  if (Array.isArray(sobrescritaMarcadores) && sobrescritaMarcadores.length > 0) {
    const pA = parsedPlacarA ?? 0
    const pB = parsedPlacarB ?? 0

    // Se temos placar definido (ex: 1 x 1) e itens na lista de sobrescrita,
    // os primeiros pA itens pertencem ao Time A e os seguintes pB pertencem ao Time B
    if (pA > 0 || pB > 0) {
      const cleanList = sobrescritaMarcadores.map((s) => String(s || '').trim()).filter(Boolean)
      const aItems = cleanList.slice(0, pA)
      const bItems = cleanList.slice(pA, pA + pB)

      scorersA.push(...aItems)
      scorersB.push(...bItems)

      // Se por algum motivo pA for 0 mas tiver itens sobrando para B, ou vice-versa:
      if (aItems.length === 0 && bItems.length === 0 && cleanList.length > 0) {
        if (pA > 0 && pB === 0) scorersA.push(...cleanList)
        else if (pB > 0 && pA === 0) scorersB.push(...cleanList)
        else scorersA.push(...cleanList)
      }
    } else {
      // Placar ainda não definido ou 0x0 mas informaram sobrescrita
      scorersA.push(...sobrescritaMarcadores.map((s) => String(s || '').trim()).filter(Boolean))
    }
  } else if (Array.isArray(liveScorers) && liveScorers.length > 0) {
    // Prioridade 2: Marcadores ao vivo retornados pela API (com teamSide: 'home' | 'away' ou teamName)
    for (const item of liveScorers) {
      if (!item || !item.name) continue
      const token = item.minute ? `${item.name.trim()} ${item.minute}'` : item.name.trim()

      if (item.teamSide === 'home') {
        scorersA.push(token)
      } else if (item.teamSide === 'away') {
        scorersB.push(token)
      } else if (item.teamName) {
        // Tenta inferir se bate mais com time A ou time B
        const nameClean = item.teamName.toLowerCase()
        const tAClean = teamAName.toLowerCase()
        const tBClean = teamBName.toLowerCase()

        if (nameClean.includes(tAClean) || tAClean.includes(nameClean)) {
          scorersA.push(token)
        } else if (nameClean.includes(tBClean) || tBClean.includes(nameClean)) {
          scorersB.push(token)
        } else {
          // Fallback de lado não identificado: atribui de acordo com contagem ou time A
          scorersA.push(token)
        }
      } else {
        // Se teamSide é null, distribui de acordo com o placar
        const pA = parsedPlacarA ?? 0
        if (scorersA.length < pA) {
          scorersA.push(token)
        } else {
          scorersB.push(token)
        }
      }
    }
  } else {
    // Prioridade 3: Marcadores do banco estruturados (gols_time_a / gols_time_b)
    if (Array.isArray(golsBancoA) && golsBancoA.length > 0) {
      for (const g of golsBancoA) {
        if (typeof g === 'string') {
          if (g.trim()) scorersA.push(g.trim())
        } else if (g && g.nome && g.nome.trim()) {
          const posStr = g.posicao ? ` (${g.posicao})` : ''
          scorersA.push(`${g.nome.trim()}${posStr}`)
        }
      }
    }

    if (Array.isArray(golsBancoB) && golsBancoB.length > 0) {
      for (const g of golsBancoB) {
        if (typeof g === 'string') {
          if (g.trim()) scorersB.push(g.trim())
        } else if (g && g.nome && g.nome.trim()) {
          const posStr = g.posicao ? ` (${g.posicao})` : ''
          scorersB.push(`${g.nome.trim()}${posStr}`)
        }
      }
    }

    // Prioridade 4: Marcadores legado salvos em string única no banco (jogo.marcadores)
    if (scorersA.length === 0 && scorersB.length === 0 && marcadoresBancoLegado) {
      const legNames = extractScorerNames(marcadoresBancoLegado)
      if (legNames.length > 0) {
        const pA = parsedPlacarA ?? 0
        const pB = parsedPlacarB ?? 0
        if (pA > 0 || pB > 0) {
          scorersA.push(...legNames.slice(0, pA))
          scorersB.push(...legNames.slice(pA, pA + pB))
        } else {
          scorersA.push(...legNames)
        }
      }
    }
  }

  const isZeroPlacarA = parsedPlacarA === 0
  const isZeroPlacarB = parsedPlacarB === 0

  const labelA = isZeroPlacarA ? '-' : scorersA.length > 0 ? scorersA.join(', ') : '-'
  const labelB = isZeroPlacarB ? '-' : scorersB.length > 0 ? scorersB.join(', ') : '-'

  const hasAnyScorers = scorersA.length > 0 || scorersB.length > 0

  return {
    teamAName,
    teamBName,
    placarA: parsedPlacarA,
    placarB: parsedPlacarB,
    hasGolsA: scorersA.length > 0,
    hasGolsB: scorersB.length > 0,
    scorersA,
    scorersB,
    labelA,
    labelB,
    hasAnyScorers,
  }
}
