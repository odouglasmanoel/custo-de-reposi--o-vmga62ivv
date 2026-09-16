import { BOLAO_MEMBERS } from '@/context/AuthContext'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'

export interface ParticipantStats {
  nome: string
  totalPontos: number
  cravadasExatas: number
  resultadosAcertados: number
  golsAcertados: number
  jogosPalpitadosEncerrados: number
  pontosPalpites: number
  pontosImportados: number
  aproveitamento: number // 0 a 100 (%)
  posicao?: number
}

export interface RecordHolders {
  reiDaCravada: {
    participante: string
    valor: number
    empate?: string[]
  }
  mestreDoResultado: {
    participante: string
    valor: number
    empate?: string[]
  }
  matadorDeAposta: {
    participante: string
    valor: number
    empate?: string[]
  }
  maiorPontuadorRodada: {
    participante: string
    pontos: number
    rodadaLabel: string
    jogoLabel?: string
    competicao?: string
  }
}

export interface EvolutionPoint {
  rodadaIndex: number
  rodadaLabel: string
  jogoLabel: string
  competicao: string
  dataHora: string
  [participantName: string]: string | number
}

export interface StatsCalculationResult {
  tabela: ParticipantStats[]
  recordes: RecordHolders
  evolucao: EvolutionPoint[]
  totalJogosEncerrados: number
  totalPalpitesValidos: number
}

/**
 * Normaliza nomes de participantes para um dos 4 participantes oficiais (Douglas, Gabriel, Bruno, Davi)
 */
export function normalizeMemberName(name: string): string {
  const clean = (name || '').trim().toLowerCase()
  for (const m of BOLAO_MEMBERS) {
    if (
      m.toLowerCase() === clean ||
      clean.includes(m.toLowerCase()) ||
      m.toLowerCase().includes(clean)
    ) {
      return m
    }
  }
  return name.trim()
}

/**
 * Verifica se um palpite é uma cravada exata (placar exato)
 */
export function isCravadaExata(palpite: Palpite, jogo: Jogo): boolean {
  if (jogo.placar_a === null || jogo.placar_a === undefined) return false
  if (jogo.placar_b === null || jogo.placar_b === undefined) return false

  // 1. Comparação direta de placar
  if (
    Number(palpite.placar_a) === Number(jogo.placar_a) &&
    Number(palpite.placar_b) === Number(jogo.placar_b)
  ) {
    return true
  }

  // 2. Detalhamento gravado
  if (Array.isArray(palpite.detalhamento)) {
    const hasExactText = palpite.detalhamento.some(
      (d) => typeof d === 'string' && /placar\s*exato/i.test(d),
    )
    if (hasExactText) return true
  }

  return false
}

/**
 * Verifica se o palpite acertou o resultado final (vencedor do jogo ou empate - 3-way)
 */
export function isResultadoAcertado(palpite: Palpite, jogo: Jogo): boolean {
  if (jogo.placar_a === null || jogo.placar_a === undefined) return false
  if (jogo.placar_b === null || jogo.placar_b === undefined) return false

  const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
  const realWinner = getWinner(Number(jogo.placar_a), Number(jogo.placar_b))
  const predWinner = getWinner(Number(palpite.placar_a), Number(palpite.placar_b))

  if (realWinner === predWinner) {
    return true
  }

  if (Array.isArray(palpite.detalhamento)) {
    const hasResultText = palpite.detalhamento.some(
      (d) => typeof d === 'string' && (/(?:vencedor|empate)/i.test(d) || /placar\s*exato/i.test(d)),
    )
    if (hasResultText) return true
  }

  return false
}

/**
 * Calcula pontos obtidos através do acerto de marcadores de gols
 */
export function getPontosGols(palpite: Palpite, jogo: Jogo): number {
  let pontosGols = 0

  // 1. Verificar detalhamento com texto "Gols acertados: ..." ou "+X pt(s)"
  if (Array.isArray(palpite.detalhamento)) {
    for (const item of palpite.detalhamento) {
      if (typeof item !== 'string') continue
      // Match padrão "+X pts" ou "+X pt" associado a gols ou marcadores
      const isGolItem = /gol|marcador|gols acertados/i.test(item)
      if (isGolItem) {
        // Encontra todas as ocorrências de +(\d+)\s*pt
        const matches = item.matchAll(/\+(\d+)\s*pts?/gi)
        let foundInMatches = false
        for (const m of matches) {
          pontosGols += parseInt(m[1], 10) || 0
          foundInMatches = true
        }
        if (!foundInMatches) {
          // Se é detalhamento de "Gols acertados: Jogador" sem o "+X pt", podemos tentar calcular
          // ou contar ao menos 1 ponto por gol identificado
          const countCommas = (item.match(/,/g) || []).length + 1
          pontosGols += Math.max(1, countCommas)
        }
      }
    }
  }

  // 2. Se detalhamento não tinha pontos explícitos de gols, calcular a partir de goleadores previstos vs reais
  if (pontosGols === 0) {
    const realScorers: Array<{ nome: string; pts: number; used: boolean }> = []
    const addScorers = (gols?: any[]) => {
      if (!Array.isArray(gols)) return
      for (const g of gols) {
        if (!g || !g.nome) continue
        const pos = (g.posicao || '').toLowerCase()
        let pts = 1
        if (pos.includes('zagueiro') || pos.includes('lateral')) pts = 3
        else if (pos.includes('goleiro')) pts = 10
        else if (pos.includes('contra')) pts = 5
        const qty = parseInt(g.quantidade, 10) || 1
        for (let i = 0; i < qty; i++) {
          realScorers.push({
            nome: String(g.nome).trim().toLowerCase(),
            pts,
            used: false,
          })
        }
      }
    }
    addScorers(jogo.gols_time_a)
    addScorers(jogo.gols_time_b)

    if (realScorers.length > 0) {
      const predScorers: string[] = []
      if (Array.isArray(palpite.goleadores_a)) {
        for (const s of palpite.goleadores_a)
          if (typeof s === 'string' && s.trim()) predScorers.push(s.trim().toLowerCase())
      }
      if (Array.isArray(palpite.goleadores_b)) {
        for (const s of palpite.goleadores_b)
          if (typeof s === 'string' && s.trim()) predScorers.push(s.trim().toLowerCase())
      }

      for (const pred of predScorers) {
        const found = realScorers.find(
          (rs) =>
            !rs.used && (rs.nome === pred || rs.nome.includes(pred) || pred.includes(rs.nome)),
        )
        if (found) {
          found.used = true
          pontosGols += found.pts
        }
      }
    }
  }

  return pontosGols
}

/**
 * Função principal para calcular estatísticas consolidadas
 */
export function calculateStatistics(params: {
  boloes: Bolao[]
  participantes: Participante[]
  jogos: Jogo[]
  palpites: Palpite[]
  filtroBolaoId?: string // 'todas' | bolao.id
}): StatsCalculationResult {
  const { boloes, participantes, jogos, palpites, filtroBolaoId } = params

  const isGeral = !filtroBolaoId || filtroBolaoId === 'todas'

  // Mapear bolões válidos
  const bolaoIdsValidos = new Set(
    isGeral
      ? boloes.map((b) => b.id)
      : boloes.filter((b) => b.id === filtroBolaoId).map((b) => b.id),
  )

  // Filtrar jogos finalizados dos bolões selecionados
  const jogosFinalizados = jogos.filter(
    (j) => bolaoIdsValidos.has(j.bolao) && j.resultado_finalizado,
  )
  const jogoIdsFinalizados = new Set(jogosFinalizados.map((j) => j.id))

  // Mapear participantes por id para resolução rápida
  const partMap = new Map<string, Participante>()
  for (const p of participantes) {
    partMap.set(p.id, p)
  }

  // Filtrar bolão por id para identificação de nome de competição
  const bolaoMap = new Map<string, Bolao>()
  for (const b of boloes) {
    bolaoMap.set(b.id, b)
  }

  // Inicializar acumuladores por membro oficial
  const statsMap = new Map<
    string,
    {
      nome: string
      totalPontos: number
      cravadasExatas: number
      resultadosAcertados: number
      golsAcertados: number
      jogosPalpitadosEncerrados: number
      pontosPalpites: number
      pontosImportados: number
    }
  >()

  for (const member of BOLAO_MEMBERS) {
    statsMap.set(member, {
      nome: member,
      totalPontos: 0,
      cravadasExatas: 0,
      resultadosAcertados: 0,
      golsAcertados: 0,
      jogosPalpitadosEncerrados: 0,
      pontosPalpites: 0,
      pontosImportados: 0,
    })
  }

  // Somar pontos importados dos participantes correspondentes aos bolões selecionados
  for (const part of participantes) {
    if (!bolaoIdsValidos.has(part.bolao)) continue
    const normName = normalizeMemberName(part.nome)
    const existing = statsMap.get(normName)
    if (existing) {
      const imp = Number(part.pontos_importados) || 0
      existing.pontosImportados += imp
    }
  }

  // Criar mapa de jogoId -> Jogo para consulta rápida
  const jogoMap = new Map<string, Jogo>()
  for (const j of jogosFinalizados) {
    jogoMap.set(j.id, j)
  }

  // Rastrear palpites válidos de jogos finalizados
  let totalPalpitesValidos = 0

  // Variável para rastrear maior pontuador de uma rodada/confronto
  let maxRodada = {
    participante: '—',
    pontos: 0,
    rodadaLabel: '—',
    jogoLabel: '—',
    competicao: '—',
  }

  // Iterar palpites de jogos finalizados
  for (const palpite of palpites) {
    if (!jogoIdsFinalizados.has(palpite.jogo)) continue
    const jogo = jogoMap.get(palpite.jogo)
    if (!jogo) continue

    const part = partMap.get(palpite.participante)
    const memberName = part ? normalizeMemberName(part.nome) : null
    if (!memberName || !statsMap.has(memberName)) continue

    totalPalpitesValidos++
    const stat = statsMap.get(memberName)!
    stat.jogosPalpitadosEncerrados++

    const ptsJogo = Number(palpite.pontuacao_jogo) || 0
    stat.pontosPalpites += ptsJogo

    // Verificar cravada exata
    const cravou = isCravadaExata(palpite, jogo)
    if (cravou) {
      stat.cravadasExatas++
    }

    // Verificar vencedor/empate acertado
    const acertouRes = isResultadoAcertado(palpite, jogo)
    if (acertouRes) {
      stat.resultadosAcertados++
    }

    // Gols acertados
    const ptsGols = getPontosGols(palpite, jogo)
    stat.golsAcertados += ptsGols

    // Rastrear maior pontuação em um único jogo/confronto
    if (ptsJogo > maxRodada.pontos) {
      const bObj = bolaoMap.get(jogo.bolao)
      maxRodada = {
        participante: memberName,
        pontos: ptsJogo,
        rodadaLabel: jogo.competicao ? jogo.competicao : `${jogo.time_a} x ${jogo.time_b}`,
        jogoLabel: `${jogo.time_a} ${jogo.placar_a ?? 0} x ${jogo.placar_b ?? 0} ${jogo.time_b}`,
        competicao: bObj ? bObj.nome : '',
      }
    }
  }

  // Montar lista de tabela detalhada e calcular aproveitamento (%)
  const tabela: ParticipantStats[] = BOLAO_MEMBERS.map((nome) => {
    const s = statsMap.get(nome)!
    const totalPontos = s.pontosImportados + s.pontosPalpites

    // Aproveitamento:
    // Total de pontos sobre pontos máximos possíveis dos jogos em que deu palpite (8 pontos por jogo como teto de referência)
    // Se o participante não tiver palpites em jogos finalizados, aproveitamento é 0
    // Limitado matematicamente a uma exibição percentual realista
    const tetoMaximo = Math.max(1, s.jogosPalpitadosEncerrados * 8)
    const rawAproveitamento =
      s.jogosPalpitadosEncerrados > 0 ? (s.pontosPalpites / tetoMaximo) * 100 : 0
    const aproveitamento = Math.min(100, Math.round(rawAproveitamento * 10) / 10)

    return {
      nome,
      totalPontos,
      cravadasExatas: s.cravadasExatas,
      resultadosAcertados: s.resultadosAcertados,
      golsAcertados: s.golsAcertados,
      jogosPalpitadosEncerrados: s.jogosPalpitadosEncerrados,
      pontosPalpites: s.pontosPalpites,
      pontosImportados: s.pontosImportados,
      aproveitamento,
    }
  })

  // Ordenar tabela por Total de Pontos decrescente, depois por Cravadas Exatas, depois por Resultados
  tabela.sort((a, b) => {
    if (b.totalPontos !== a.totalPontos) return b.totalPontos - a.totalPontos
    if (b.cravadasExatas !== a.cravadasExatas) return b.cravadasExatas - a.cravadasExatas
    if (b.resultadosAcertados !== a.resultadosAcertados)
      return b.resultadosAcertados - a.resultadosAcertados
    return a.nome.localeCompare(b.nome)
  })

  // Atribuir posição
  tabela.forEach((item, idx) => {
    item.posicao = idx + 1
  })

  // 1. Cards Principais de Recordes (Destaques)
  // Rei da Cravada
  let topCravadas = -1
  let reiNome = '—'
  const empateCravadas: string[] = []
  for (const t of tabela) {
    if (t.cravadasExatas > topCravadas) {
      topCravadas = t.cravadasExatas
      reiNome = t.nome
      empateCravadas.length = 0
      empateCravadas.push(t.nome)
    } else if (t.cravadasExatas === topCravadas && topCravadas > 0) {
      empateCravadas.push(t.nome)
    }
  }

  // Mestre do Resultado
  let topResultados = -1
  let mestreNome = '—'
  const empateResultados: string[] = []
  for (const t of tabela) {
    if (t.resultadosAcertados > topResultados) {
      topResultados = t.resultadosAcertados
      mestreNome = t.nome
      empateResultados.length = 0
      empateResultados.push(t.nome)
    } else if (t.resultadosAcertados === topResultados && topResultados > 0) {
      empateResultados.push(t.nome)
    }
  }

  // Matador de Aposta (Gols)
  let topGols = -1
  let matadorNome = '—'
  const empateGols: string[] = []
  for (const t of tabela) {
    if (t.golsAcertados > topGols) {
      topGols = t.golsAcertados
      matadorNome = t.nome
      empateGols.length = 0
      empateGols.push(t.nome)
    } else if (t.golsAcertados === topGols && topGols > 0) {
      empateGols.push(t.nome)
    }
  }

  const recordes: RecordHolders = {
    reiDaCravada: {
      participante: reiNome,
      valor: Math.max(0, topCravadas),
      empate: empateCravadas.length > 1 ? empateCravadas : undefined,
    },
    mestreDoResultado: {
      participante: mestreNome,
      valor: Math.max(0, topResultados),
      empate: empateResultados.length > 1 ? empateResultados : undefined,
    },
    matadorDeAposta: {
      participante: matadorNome,
      valor: Math.max(0, topGols),
      empate: empateGols.length > 1 ? empateGols : undefined,
    },
    maiorPontuadorRodada: maxRodada,
  }

  // Gráfico de Evolução ao longo dos jogos / rodadas cronológicas
  // Ordenar jogos por data e hora cronológica
  const jogosCronologicos = [...jogosFinalizados].sort((a, b) => {
    const da = `${a.data || ''}T${a.hora || '00:00'}`
    const db = `${b.data || ''}T${b.hora || '00:00'}`
    return da.localeCompare(db)
  })

  // Agrupamento por jogo individual cronológico, acumulando pontos de cada participante
  const acumuladoMembros: Record<string, number> = {}
  for (const m of BOLAO_MEMBERS) {
    // Começa com os pontos importados para o gráfico refletir a pontuação acumulada real
    acumuladoMembros[m] = statsMap.get(m)?.pontosImportados || 0
  }

  const evolucao: EvolutionPoint[] = []

  // Ponto inicial 0 (base importada)
  evolucao.push({
    rodadaIndex: 0,
    rodadaLabel: 'Início',
    jogoLabel: 'Pontos Base / Importados',
    competicao: isGeral ? 'Geral' : boloes.find((b) => b.id === filtroBolaoId)?.nome || 'Início',
    dataHora: '',
    ...acumuladoMembros,
  })

  jogosCronologicos.forEach((jogo, index) => {
    const jogoBets = palpites.filter((p) => p.jogo === jogo.id)
    const bObj = bolaoMap.get(jogo.bolao)

    // Atualiza acumulado de cada participante com o palpite deste jogo
    for (const bet of jogoBets) {
      const part = partMap.get(bet.participante)
      const memberName = part ? normalizeMemberName(part.nome) : null
      if (memberName && acumuladoMembros[memberName] !== undefined) {
        acumuladoMembros[memberName] += Number(bet.pontuacao_jogo) || 0
      }
    }

    const shortGame = `${jogo.time_a} x ${jogo.time_b}`
    const rodadaDesc = jogo.competicao ? jogo.competicao : `Jogo ${index + 1}`

    evolucao.push({
      rodadaIndex: index + 1,
      rodadaLabel: rodadaDesc.length > 20 ? `${rodadaDesc.substring(0, 18)}...` : rodadaDesc,
      jogoLabel: shortGame,
      competicao: bObj ? bObj.nome : '',
      dataHora: `${jogo.data || ''} ${jogo.hora || ''}`,
      ...acumuladoMembros,
    })
  })

  return {
    tabela,
    recordes,
    evolucao,
    totalJogosEncerrados: jogosFinalizados.length,
    totalPalpitesValidos,
  }
}
