/**
 * Helper para detecção e formatação de badges de regras de pontuação na visualização de palpites.
 * Mapeia as regras oficiais da engine Repress / Copa Coni:
 * - Placar Exato (+8 pts)
 * - Vencedor (+2 pts) / Vencedor + Gols / Empate (+2 pts)
 * - Metade do Placar (+1 pt)
 * - Diferença de Gols (+1 pt)
 * - Vencedor nos Pênaltis (+2 pts)
 * - Marcadores de Gol:
 *     - Atacante / Meia (+1 pt)
 *     - Lateral / Zagueiro (+3 pts)
 *     - Goleiro (+10 pts)
 *     - Gol Contra (+5 pts)
 */

export interface ScoreRuleBadge {
  id: string
  label: string
  pointsText?: string
  variant?: 'exact' | 'winner' | 'half' | 'scorer' | 'penalties' | 'default'
}

interface MatchLike {
  placar_a?: number | null
  placar_b?: number | null
  resultado_finalizado?: boolean
  tem_penaltis?: boolean
  vencedor_penaltis?: 'A' | 'B' | string | null
  gols_time_a?: Array<{ nome: string; posicao?: string; quantidade?: number }> | null
  gols_time_b?: Array<{ nome: string; posicao?: string; quantidade?: number }> | null
}

interface BetLike {
  placar_a: number
  placar_b: number
  pontuacao_jogo: number
  detalhamento?: string[] | string | null
  vencedor_penaltis?: 'A' | 'B' | 'N' | string | null
  goleadores_a?: string[] | null
  goleadores_b?: string[] | null
}

function cleanPlayerName(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Extrai badges a partir das strings existentes no campo `detalhamento` do palpite
 * (oriundas de importação de planilha ou cálculo prévio no backend).
 */
export function parseDetalhamentoStrings(detList: string[]): ScoreRuleBadge[] {
  const badges: ScoreRuleBadge[] = []
  const seenIds = new Set<string>()

  const addBadge = (badge: ScoreRuleBadge) => {
    if (!seenIds.has(badge.id)) {
      seenIds.add(badge.id)
      badges.push(badge)
    }
  }

  for (const rawItem of detList) {
    if (!rawItem || typeof rawItem !== 'string') continue
    const item = rawItem.trim()
    if (!item || item === '-') continue

    const lower = item.toLowerCase()

    // 1. Placar Exato
    if (lower.includes('placar exato')) {
      addBadge({
        id: 'placar_exato',
        label: 'Placar Exato',
        pointsText: '+8',
        variant: 'exact',
      })
    }

    // 2. Vencedor nos Pênaltis
    if (
      lower.includes('vencedor nos penaltis') ||
      lower.includes('vencedor nos pênaltis') ||
      lower.includes('penaltis (+2') ||
      lower.includes('pênaltis (+2')
    ) {
      addBadge({
        id: 'penaltis',
        label: 'Vencedor nos Pênaltis',
        pointsText: '+2',
        variant: 'penalties',
      })
    }

    // 3. Vencedor / Empate
    if (lower.includes('empate (+2') || lower.startsWith('empate') || lower.includes('empate,')) {
      addBadge({
        id: 'vencedor_empate',
        label: 'Empate',
        pointsText: '+2',
        variant: 'winner',
      })
    } else if (
      (lower.includes('vencedor (+2') ||
        lower.startsWith('vencedor') ||
        lower.includes('apenas vencedor') ||
        lower.includes('vencedor,')) &&
      !lower.includes('vencedor nos p')
    ) {
      addBadge({
        id: 'vencedor',
        label: 'Vencedor',
        pointsText: '+2',
        variant: 'winner',
      })
    }

    // 4. Diferença de Gols / Saldo
    if (lower.includes('diferença de gols') || lower.includes('diferenca de gols')) {
      addBadge({
        id: 'diferenca_gols',
        label: 'Saldo de Gols',
        pointsText: '+1',
        variant: 'default',
      })
    }

    // 5. Metade do Placar
    if (lower.includes('metade do placar')) {
      addBadge({
        id: 'metade_placar',
        label: 'Metade do Placar',
        pointsText: '+1',
        variant: 'half',
      })
    }

    // 6. Gols acertados / Marcadores detalhados
    // Ex: "Gols acertados: Bernard (+1 pt - Atacante/Meia), Kaio Jorge (+1 pt - Atacante/Meia)"
    // Ex: "gol do Kaio Jorge", "gols de Maurício e Jhon Arias", "gol do Alex Telles"
    if (lower.includes('gols acertados:')) {
      const parts = item.substring(item.indexOf(':') + 1).split(',')
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim()
        if (!p) continue
        // Formato típico: "Nome (+1 pt - Atacante/Meia)"
        const nameMatch = p.match(/^([^(]+)/)
        const ptsMatch = p.match(/\+(\d+)\s*pt/)
        const posMatch = p.match(/-\s*([^)]+)\)/)

        const playerName = nameMatch ? nameMatch[1].trim() : p
        const pts = ptsMatch ? ptsMatch[1] : ''
        const pos = posMatch ? posMatch[1].trim() : ''

        addBadge({
          id: `marcador_${cleanPlayerName(playerName)}_${i}`,
          label: `Marcador: ${playerName}${pos ? ` (${pos})` : ''}`,
          pointsText: pts ? `+${pts}` : undefined,
          variant: 'scorer',
        })
      }
    } else if (
      lower.includes('gol do ') ||
      lower.includes('gol de ') ||
      lower.includes('gols de ')
    ) {
      // Frase no estilo da planilha histórica ("gol do Kaio Jorge", "gols de Maurício e Jhon Arias")
      // Remove partes de placar exato / metade / vencedor para isolar os nomes
      const withoutBase = item
        .replace(/placar exato/gi, '')
        .replace(/vencedor nos p[eê]naltis/gi, '')
        .replace(/vencedor/gi, '')
        .replace(/empate/gi, '')
        .replace(/metade do placar/gi, '')
        .replace(/diferen[cç]a de gols/gi, '')
        .replace(/^[,\s–-]+|[,\s–-]+$/g, '')

      // Procura nomes após "gol do", "gol de", "gols de"
      const scorerMatch = withoutBase.match(/gols?\s+d[oe]\s+(.+)/i)
      if (scorerMatch && scorerMatch[1]) {
        const rawNames = scorerMatch[1]
          .split(/\s+e\s+|,/)
          .map((n) => n.trim())
          .filter(Boolean)

        for (let i = 0; i < rawNames.length; i++) {
          const nm = rawNames[i].replace(/[.,;)]+$/, '').trim()
          if (!nm) continue
          addBadge({
            id: `marcador_txt_${cleanPlayerName(nm)}_${i}`,
            label: `Marcador: ${nm}`,
            variant: 'scorer',
          })
        }
      } else {
        addBadge({
          id: `marcador_generic_${badges.length}`,
          label: 'Marcador do Gol',
          variant: 'scorer',
        })
      }
    }
  }

  return badges
}

/**
 * Deriva as badges matematicamente a partir dos placares reais e palpites
 * (caso `detalhamento` esteja vazio ou desatualizado).
 */
export function deriveBadgesFromMatch(bet: BetLike, match: MatchLike): ScoreRuleBadge[] {
  const badges: ScoreRuleBadge[] = []
  const seenIds = new Set<string>()

  const addBadge = (badge: ScoreRuleBadge) => {
    if (!seenIds.has(badge.id)) {
      seenIds.add(badge.id)
      badges.push(badge)
    }
  }

  const realA = match.placar_a
  const realB = match.placar_b
  if (realA === null || realA === undefined || realB === null || realB === undefined) {
    return badges
  }

  const predA = bet.placar_a
  const predB = bet.placar_b

  const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
  const realWinner = getWinner(realA, realB)
  const predWinner = getWinner(predA, predB)
  const realDiff = Math.abs(realA - realB)
  const predDiff = Math.abs(predA - predB)

  const isExact = predA === realA && predB === realB

  if (isExact) {
    addBadge({
      id: 'placar_exato',
      label: 'Placar Exato',
      pointsText: '+8',
      variant: 'exact',
    })
  } else {
    if (predWinner === realWinner) {
      if (realWinner === 0) {
        addBadge({
          id: 'vencedor_empate',
          label: 'Empate',
          pointsText: '+2',
          variant: 'winner',
        })
      } else {
        addBadge({
          id: 'vencedor',
          label: 'Vencedor',
          pointsText: '+2',
          variant: 'winner',
        })
      }
    }

    if (predDiff === realDiff && predWinner === realWinner) {
      addBadge({
        id: 'diferenca_gols',
        label: 'Saldo de Gols',
        pointsText: '+1',
        variant: 'default',
      })
    }

    if (predA === realA || predB === realB) {
      addBadge({
        id: 'metade_placar',
        label: 'Metade do Placar',
        pointsText: '+1',
        variant: 'half',
      })
    }
  }

  // Pênaltis
  if (match.tem_penaltis) {
    const realPen = (match.vencedor_penaltis || '').toUpperCase().trim()
    const predPen = (bet.vencedor_penaltis || '').toUpperCase().trim()
    if (realPen && predPen && realPen === predPen && (predPen === 'A' || predPen === 'B')) {
      addBadge({
        id: 'penaltis',
        label: 'Vencedor nos Pênaltis',
        pointsText: '+2',
        variant: 'penalties',
      })
    }
  }

  // Marcadores de gol reais
  const realScorers: Array<{
    nome: string
    norm: string
    posicao: string
    points: number
    used: boolean
  }> = []

  const addReal = (
    list?: Array<{ nome: string; posicao?: string; quantidade?: number }> | null,
  ) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || !item.nome) continue
      const pos = (item.posicao || 'Atacante/Meia').toLowerCase()
      let pts = 1
      if (pos.includes('zagueiro') || pos.includes('lateral')) pts = 3
      else if (pos.includes('goleiro')) pts = 10
      else if (pos.includes('contra')) pts = 5

      const qtd = Number(item.quantidade) || 1
      for (let i = 0; i < qtd; i++) {
        realScorers.push({
          nome: item.nome,
          norm: cleanPlayerName(item.nome),
          posicao: item.posicao || 'Atacante/Meia',
          points: pts,
          used: false,
        })
      }
    }
  }

  addReal(match.gols_time_a)
  addReal(match.gols_time_b)

  const predList = [...(bet.goleadores_a || []), ...(bet.goleadores_b || [])]
  let matchIndex = 0

  for (const p of predList) {
    if (!p) continue
    // Se o marcador no palpite indicar "(gol contra)" ou similar, limpa para bater com o nome
    const pStr = typeof p === 'string' ? p : String((p as any)?.nome || '')
    const isGolContraBet =
      (typeof p === 'object' && p !== null && (p as any).gol_contra === true) ||
      /\(gol contra\)|\(contra\)/i.test(pStr)
    const cleanP = pStr.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
    const normP = cleanPlayerName(cleanP)
    if (!normP) continue

    const found = realScorers.find((rs) => {
      if (rs.used) return false
      if (rs.norm !== normP) return false
      if (isGolContraBet) {
        // Se apostou especificamente gol contra, prioriza gol contra do atleta
        return rs.posicao.toLowerCase().includes('contra') || true
      }
      return true
    })

    if (found) {
      found.used = true
      addBadge({
        id: `marcador_${found.norm}_${matchIndex++}`,
        label: `Marcador: ${found.nome} (${found.posicao})`,
        pointsText: `+${found.points}`,
        variant: 'scorer',
      })
    }
  }

  return badges
}

export interface LiveMatchScoreBreakdown {
  pontos: number
  badges: ScoreRuleBadge[]
  resumoItens: string[]
  resumoTexto: string
}

/**
 * Calcula a pontuação e os badges parciais de um palpite para uma partida em andamento (ao vivo),
 * ou até mesmo após término caso se queira a decomposição direta sem depender de `resultado_finalizado`.
 * Se currentScoreA / currentScoreB forem null ou undefined, retorna 0 pontos e lista vazia.
 */
export function calculateLiveMatchScoreBreakdown(
  bet: BetLike | null | undefined,
  currentScoreA: number | null | undefined,
  currentScoreB: number | null | undefined,
  liveScorers?: Array<{
    nome: string
    posicao?: string
    quantidade?: number
    points?: number
    isOwnGoal?: boolean
  }> | null,
  temPenaltis?: boolean,
  vencedorPenaltis?: 'A' | 'B' | string | null,
): LiveMatchScoreBreakdown {
  if (
    !bet ||
    currentScoreA === null ||
    currentScoreA === undefined ||
    currentScoreB === null ||
    currentScoreB === undefined
  ) {
    return {
      pontos: 0,
      badges: [],
      resumoItens: [],
      resumoTexto: '',
    }
  }

  const realA = Number(currentScoreA)
  const realB = Number(currentScoreB)
  const predA = Number(bet.placar_a) || 0
  const predB = Number(bet.placar_b) || 0

  const badges: ScoreRuleBadge[] = []
  const seenIds = new Set<string>()

  const addBadge = (badge: ScoreRuleBadge) => {
    if (!seenIds.has(badge.id)) {
      seenIds.add(badge.id)
      badges.push(badge)
    }
  }

  let totalPontos = 0

  const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
  const realWinner = getWinner(realA, realB)
  const predWinner = getWinner(predA, predB)
  const realDiff = Math.abs(realA - realB)
  const predDiff = Math.abs(predA - predB)

  const isExact = predA === realA && predB === realB

  if (isExact) {
    totalPontos += 8
    addBadge({
      id: 'placar_exato',
      label: 'Placar Exato',
      pointsText: '+8',
      variant: 'exact',
    })
  } else {
    if (predWinner === realWinner) {
      if (realWinner === 0) {
        totalPontos += 2
        addBadge({
          id: 'vencedor_empate',
          label: 'Empate',
          pointsText: '+2',
          variant: 'winner',
        })
      } else {
        totalPontos += 2
        addBadge({
          id: 'vencedor',
          label: 'Vencedor',
          pointsText: '+2',
          variant: 'winner',
        })
      }
    }

    if (predDiff === realDiff && predWinner === realWinner) {
      totalPontos += 1
      addBadge({
        id: 'diferenca_gols',
        label: 'Saldo de Gols',
        pointsText: '+1',
        variant: 'default',
      })
    }

    if (predA === realA || predB === realB) {
      totalPontos += 1
      addBadge({
        id: 'metade_placar',
        label: 'Metade do Placar',
        pointsText: '+1',
        variant: 'half',
      })
    }
  }

  // Pênaltis
  if (temPenaltis) {
    const realPen = (vencedorPenaltis || '').toUpperCase().trim()
    const predPen = (bet.vencedor_penaltis || '').toUpperCase().trim()
    if (realPen && predPen && realPen === predPen && (predPen === 'A' || predPen === 'B')) {
      totalPontos += 2
      addBadge({
        id: 'penaltis',
        label: 'Vencedor nos Pênaltis',
        pointsText: '+2',
        variant: 'penalties',
      })
    }
  }

  // Marcadores
  const realScorers: Array<{
    nome: string
    norm: string
    posicao: string
    points: number
    used: boolean
  }> = []

  if (Array.isArray(liveScorers)) {
    for (const item of liveScorers) {
      if (!item || !item.nome) continue
      const pos = (item.posicao || 'Atacante/Meia').toLowerCase()
      let pts = item.points ?? 1
      if (item.points === undefined) {
        if (pos.includes('zagueiro') || pos.includes('lateral') || pos.includes('defensor')) pts = 3
        else if (pos.includes('goleiro')) pts = 10
        else if (pos.includes('contra') || item.isOwnGoal) pts = 5
      }

      const qtd = Number(item.quantidade) || 1
      for (let i = 0; i < qtd; i++) {
        realScorers.push({
          nome: item.nome,
          norm: cleanPlayerName(item.nome),
          posicao:
            item.posicao ||
            (pts === 3
              ? 'Defensor'
              : pts === 10
                ? 'Goleiro'
                : pts === 5
                  ? 'Gol Contra'
                  : 'Atacante/Meia'),
          points: pts,
          used: false,
        })
      }
    }
  }

  const predList = [...(bet.goleadores_a || []), ...(bet.goleadores_b || [])]
  let matchIndex = 0

  for (const p of predList) {
    if (!p) continue
    const pStr = typeof p === 'string' ? p : String((p as any)?.nome || '')
    const cleanP = pStr.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
    const normP = cleanPlayerName(cleanP)
    if (!normP) continue

    const found = realScorers.find(
      (rs) => !rs.used && (rs.norm === normP || rs.norm.includes(normP) || normP.includes(rs.norm)),
    )
    if (found) {
      found.used = true
      totalPontos += found.points
      addBadge({
        id: `marcador_${found.norm}_${matchIndex++}`,
        label: `${found.nome} (${found.posicao})`,
        pointsText: `+${found.points}`,
        variant: 'scorer',
      })
    }
  }

  const resumoItens: string[] = badges.map((b) => {
    const pt = b.pointsText ? ` (${b.pointsText} pt${b.pointsText === '+1' ? '' : 's'})` : ''
    return `${b.label}${pt}`
  })

  return {
    pontos: totalPontos,
    badges,
    resumoItens,
    resumoTexto: resumoItens.join(', '),
  }
}

/**
 * Retorna a lista final de badges a serem exibidas para o palpite.
 * Prioriza detalhamento cadastrado quando existente e detalhado;
 * caso contrário deriva via lógica de regras oficial.
 */
export function getScoreBreakdownBadges(bet: BetLike, match: MatchLike): ScoreRuleBadge[] {
  // Se pontuação do jogo for zero ou o resultado ainda não foi finalizado, não há badges de pontuação
  if (!match.resultado_finalizado || Number(bet.pontuacao_jogo) <= 0) {
    return []
  }

  // 1. Tentar ler do campo detalhamento cadastrado
  const rawDet = bet.detalhamento
  let detList: string[] = []
  if (Array.isArray(rawDet)) {
    detList = rawDet.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  } else if (typeof rawDet === 'string' && rawDet.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawDet)
      if (Array.isArray(parsed)) {
        detList = parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      } else {
        detList = [rawDet]
      }
    } catch {
      detList = [rawDet]
    }
  }

  const parsedFromDet = parseDetalhamentoStrings(detList)
  const derivedFromCalc = deriveBadgesFromMatch(bet, match)

  // Se ambas as fontes produziram dados, unifica sem duplicar IDs de regras
  const combinedMap = new Map<string, ScoreRuleBadge>()

  // Inserir primeiro do detalhamento gravado
  for (const b of parsedFromDet) {
    combinedMap.set(b.id, b)
  }

  // Preencher/completar a partir do cálculo derivado
  for (const b of derivedFromCalc) {
    if (!combinedMap.has(b.id)) {
      // Se não tem regra exata equivalente gravada
      if (b.id === 'placar_exato' && !combinedMap.has('placar_exato')) {
        combinedMap.set(b.id, b)
      } else if (
        (b.id === 'vencedor' || b.id === 'vencedor_empate') &&
        !combinedMap.has('vencedor') &&
        !combinedMap.has('vencedor_empate')
      ) {
        combinedMap.set(b.id, b)
      } else if (b.id === 'metade_placar' && !combinedMap.has('metade_placar')) {
        combinedMap.set(b.id, b)
      } else if (b.id === 'diferenca_gols' && !combinedMap.has('diferenca_gols')) {
        combinedMap.set(b.id, b)
      } else if (b.id === 'penaltis' && !combinedMap.has('penaltis')) {
        combinedMap.set(b.id, b)
      } else if (b.id.startsWith('marcador_')) {
        // Marcador só adiciona se ainda não temos marcador com o mesmo nome
        const hasScorer = Array.from(combinedMap.values()).some(
          (m) => m.variant === 'scorer' && m.id === b.id,
        )
        if (!hasScorer) {
          combinedMap.set(b.id, b)
        }
      }
    }
  }

  const result = Array.from(combinedMap.values())

  // Se mesmo assim não obteve nenhuma badge mas pontuação > 0, gera badge genérica de pontos
  if (result.length === 0 && Number(bet.pontuacao_jogo) > 0) {
    result.push({
      id: 'pontos_obtidos',
      label: `Pontuação Obtida`,
      pointsText: `+${bet.pontuacao_jogo}`,
      variant: 'default',
    })
  }

  return result
}
