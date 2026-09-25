import { BOLAO_MEMBERS } from '@/context/AuthContext'
import { extractPureScoreString, parseScoreString } from '@/lib/spreadsheetParser'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'

export interface ParticipantStats {
  nome: string
  totalPontos: number
  cravadasExatas: number
  resultadosAcertados: number
  golsAcertados: number
  marcadoresDefensores: number // Marcadores cuja posição é Zagueiro/Lateral/Defensor
  quaseCravadas: number // Erro da cravada exata por apenas 1 gol de diferença
  pontosGrandesJogos: number // Pontos obtidos exclusivamente em grandes jogos (mata-mata / finais / clássicos)
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
  // 4 novos troféus:
  paiDosDefensores: {
    participante: string
    valor: number // quantidade de marcadores defensores acertados
    empate?: string[]
    temDados: boolean
  }
  mestreDoQuase: {
    participante: string
    valor: number // quantidade de palpites a 1 gol do placar real
    empate?: string[]
    temDados: boolean
  }
  peFrioDaRodada: {
    participante: string
    aproveitamento: number // menor % de aproveitamento
    jogosPalpitados: number
    empate?: string[]
    temDados: boolean
  }
  mitoDosGrandesJogos: {
    participante: string
    pontos: number // pontos somados em grandes jogos
    jogosConsiderados: number
    empate?: string[]
    temDados: boolean
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
 * Normaliza nomes de participantes para os membros oficiais (Douglas, Gabriel, Bruno Lopes, Bruno Xavier, Davi)
 */
export function normalizeMemberName(name: string): string {
  const clean = (name || '').trim().toLowerCase()
  if (!clean) return ''
  if (clean.includes('douglas')) return 'Douglas'
  if (clean.includes('gabriel')) return 'Gabriel'
  if (clean.includes('brunox') || clean.includes('xavier')) return 'Bruno Xavier'
  if (clean.includes('brunol') || clean.includes('lopes')) return 'Bruno Lopes'
  if (clean === 'bruno') return 'Bruno Lopes'
  if (clean.includes('davi')) return 'Davi'
  if (clean.includes('willian')) return 'Willian'

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
 * Extrai placar numérico aceitando números, strings simples e strings históricas
 * com sufixo de marcadores entre parênteses (ex: "3x0 (Samuel Lino 2x e Carrascal)").
 */
function resolveScorePair(valA: any, valB: any): { a: number; b: number } | null {
  if (valA !== null && valA !== undefined && valB !== null && valB !== undefined) {
    const numA = Number(valA)
    const numB = Number(valB)
    if (!isNaN(numA) && !isNaN(numB)) {
      return { a: numA, b: numB }
    }
  }
  // Se valA contém string completa com placar
  if (typeof valA === 'string' && valA.trim()) {
    const parsed = extractPureScoreString(valA) || parseScoreString(valA)
    if (parsed) {
      return { a: parsed.placarA, b: parsed.placarB }
    }
  }
  if (typeof valB === 'string' && valB.trim()) {
    const parsed = extractPureScoreString(valB) || parseScoreString(valB)
    if (parsed) {
      return { a: parsed.placarA, b: parsed.placarB }
    }
  }
  return null
}

/**
 * Verifica se um palpite é uma cravada exata (placar exato)
 * Aceita placares históricos com sufixo de marcadores entre parênteses.
 */
export function isCravadaExata(palpite: Palpite, jogo: Jogo): boolean {
  // 1. Detalhamento gravado (funciona mesmo se placar do jogo não estiver preenchido ou for histórico)
  if (Array.isArray(palpite.detalhamento)) {
    const hasExactText = palpite.detalhamento.some(
      (d) => typeof d === 'string' && /placar\s*exato/i.test(d),
    )
    if (hasExactText) return true
  }

  const pScore = resolveScorePair(palpite.placar_a, palpite.placar_b)
  const jScore = resolveScorePair(jogo.placar_a, jogo.placar_b)

  // 2. Pontuação oficial indicativa de cravada caso não haja placar preenchido no jogo
  if (Number(palpite.pontuacao_jogo) >= 8) {
    if (pScore && jScore && pScore.a === jScore.a && pScore.b === jScore.b) {
      return true
    }
  }

  // 3. Comparação direta de placar (aceitando sufixos entre parênteses)
  if (pScore && jScore && pScore.a === jScore.a && pScore.b === jScore.b) {
    return true
  }

  return false
}

/**
 * Verifica se o palpite acertou o resultado final (vencedor do jogo ou empate - 3-way)
 * Aceita placares históricos com sufixo de marcadores entre parênteses.
 */
export function isResultadoAcertado(palpite: Palpite, jogo: Jogo): boolean {
  // 1. Detalhamento gravado (retroativo / histórico)
  if (Array.isArray(palpite.detalhamento)) {
    const hasResultText = palpite.detalhamento.some(
      (d) => typeof d === 'string' && (/(?:vencedor|empate)/i.test(d) || /placar\s*exato/i.test(d)),
    )
    if (hasResultText) return true
  }

  const pScore = resolveScorePair(palpite.placar_a, palpite.placar_b)
  const jScore = resolveScorePair(jogo.placar_a, jogo.placar_b)

  // 2. Pontuação oficial indicando acerto de resultado
  if (Number(palpite.pontuacao_jogo) >= 2) {
    if (!jScore) {
      return true
    }
  }

  // 3. Comparação direta do vencedor / empate
  if (pScore && jScore) {
    const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
    const realWinner = getWinner(jScore.a, jScore.b)
    const predWinner = getWinner(pScore.a, pScore.b)

    if (realWinner === predWinner) {
      return true
    }
  }

  return false
}

/**
 * Calcula pontos obtidos através do acerto de marcadores de gols
 */
/**
 * Normaliza strings para comparação flexível (remove acentos, espaços extras, minúsculas)
 */
function cleanScorerKey(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Verifica se um palpite é uma "quase cravada" (Mestre do Quase / O Injustiçado):
 * Errou a cravação exata do placar por exatamente 1 gol de diferença:
 * soma dos desvios absolutos |predA - realA| + |predB - realB| === 1.
 * Exemplo: chutou 2x1 e foi 2x2, ou 3x1 e foi 2x1, etc.
 */
export function isQuaseCravada(palpite: Palpite, jogo: Jogo): boolean {
  const pScore = resolveScorePair(palpite.placar_a, palpite.placar_b)
  const jScore = resolveScorePair(jogo.placar_a, jogo.placar_b)
  if (!pScore || !jScore) return false

  const diffA = Math.abs(pScore.a - jScore.a)
  const diffB = Math.abs(pScore.b - jScore.b)

  // Errou por exatamente 1 gol na soma das diferenças
  return diffA + diffB === 1
}

/**
 * Subtrai pontos de regras base (placar, vencedor, saldo, metade, pênaltis)
 * a partir de uma pontuação total e de uma lista de tokens ou strings de detalhamento.
 */
function extractScorerPointsFromScoreAndDetails(
  totalPts: number,
  detList: string[],
  palpite: Palpite,
  jogo: Jogo,
): number {
  if (totalPts <= 0) return 0

  let basePoints = 0
  const combinedText = detList.join(' | ').toLowerCase()

  const pScore = resolveScorePair(palpite.placar_a, palpite.placar_b)
  const jScore = resolveScorePair(jogo.placar_a, jogo.placar_b)

  // 1. Placar Exato: 8 pts
  if (
    combinedText.includes('placar exato') ||
    (pScore && jScore && pScore.a === jScore.a && pScore.b === jScore.b)
  ) {
    basePoints += 8
  } else {
    // 2. Vencedor ou Empate: 2 pts
    if (
      combinedText.includes('empate') ||
      combinedText.includes('vencedor') ||
      isResultadoAcertado(palpite, jogo)
    ) {
      basePoints += 2
    }

    // 3. Diferença de Gols / Saldo: 1 pt
    if (combinedText.includes('diferença de gols') || combinedText.includes('diferenca de gols')) {
      basePoints += 1
    } else if (pScore && jScore) {
      const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
      const realWinner = getWinner(jScore.a, jScore.b)
      const predWinner = getWinner(pScore.a, pScore.b)
      const realDiff = Math.abs(jScore.a - jScore.b)
      const predDiff = Math.abs(pScore.a - pScore.b)
      if (realWinner === predWinner && realDiff === predDiff) {
        basePoints += 1
      }
    }

    // 4. Metade do Placar: 1 pt
    if (combinedText.includes('metade do placar')) {
      basePoints += 1
    } else if (pScore && jScore) {
      if (pScore.a === jScore.a || pScore.b === jScore.b) {
        basePoints += 1
      }
    }
  }

  // 5. Pênaltis: 2 pts
  if (
    combinedText.includes('pênaltis') ||
    combinedText.includes('penaltis') ||
    (jogo.tem_penaltis &&
      jogo.vencedor_penaltis &&
      palpite.vencedor_penaltis &&
      String(jogo.vencedor_penaltis).toUpperCase().trim() ===
        String(palpite.vencedor_penaltis).toUpperCase().trim())
  ) {
    basePoints += 2
  }

  const remaining = totalPts - basePoints
  return remaining > 0 ? remaining : 0
}

/**
 * Conta quantos marcadores de gol cuja posição é Defensor (Zagueiro ou Lateral) foram acertados.
 * Analisa:
 * 1. Detalhamento gravado nos palpites (ex: "Gols acertados: Van Hecke (+3 pts - Zagueiro/Lateral)")
 * 2. Itens com +3 pts no detalhamento ("+3 pts", "+3 pt")
 * 3. Lista de gols_time_a/b do jogo contra os goleadores_a/b do palpite
 * 4. Inferência retroativa por pontuação diferenciada: nas planilhas importadas históricas onde a posição
 *    não foi explicitamente gravada, sempre que um palpite de marcador tiver concedido 3 pontos
 *    (em vez de 1 ponto concedido para atacantes/médios, contabilizando os +2 pontos bônus por ser defensor),
 *    identifica esse acerto como gol de defensor.
 */
export function countMarcadoresDefensoresAcertados(palpite: Palpite, jogo: Jogo): number {
  let count = 0

  const detList: string[] = []
  if (Array.isArray(palpite.detalhamento)) {
    for (const item of palpite.detalhamento) {
      if (typeof item === 'string' && item.trim()) {
        detList.push(item.trim())
      }
    }
  }

  // 1. Detalhamento gravado nos palpites
  if (detList.length > 0) {
    for (const item of detList) {
      if (/gol|marcador/i.test(item)) {
        // Caso 1a: Detalhamento explícito com cargo/posição (ex: "Van Hecke (+3 pts - Zagueiro/Lateral)")
        const defRegex =
          /([A-Za-zÀ-ÖØ-öø-ÿ\s'-]+)\s*\(\+\d+\s*pts?\s*-\s*[^)]*(?:zagueiro|lateral|defensor)[^)]*\)/gi
        let match: RegExpExecArray | null
        let found1a = 0
        while ((match = defRegex.exec(item)) !== null) {
          found1a++
        }
        if (found1a > 0) {
          count += found1a
          continue
        }

        // Caso 1b: Menção explícita a "+3 pts" ou "+3 pt" dentro de item de marcador/gol
        // (padrão oficial: acerto de defensor sempre rende 3 pontos)
        const pts3Regex = /\+3\s*pts?/gi
        let pts3Match: RegExpExecArray | null
        let pts3Count = 0
        while ((pts3Match = pts3Regex.exec(item)) !== null) {
          pts3Count++
        }
        if (pts3Count > 0) {
          count += pts3Count
          continue
        }

        // Caso 1c: Menção direta a zagueiro/lateral/defensor no item
        if (/(?:zagueiro|lateral|defensor)/i.test(item)) {
          const simpleDefMatch = item.match(/(?:zagueiro|lateral|defensor)/gi)
          if (simpleDefMatch) {
            count += simpleDefMatch.length
            continue
          }
        }
      }
    }
  }

  // 2. Se detalhamento não encontrou posições, cruzar os dados de gols do jogo com o palpite via min(N, M)
  if (count === 0) {
    const defenderGroups = new Map<string, { nome: string; countReal: number }>()
    const collectDefenders = (gols?: any[]) => {
      if (!Array.isArray(gols)) return
      for (const g of gols) {
        if (!g || !g.nome) continue
        const rawNome = String(g.nome).trim()
        const cleanNome = rawNome
          .replace(/\s*\d+\s*['’]/g, '')
          .replace(/\(gol contra\)|\(contra\)/gi, '')
          .trim()
        const pos = (g.posicao || '').toLowerCase()
        const isDefender =
          pos.includes('zagueiro') || pos.includes('lateral') || pos.includes('defensor')
        if (isDefender) {
          const norm = cleanScorerKey(cleanNome)
          if (!norm) continue
          const qty = parseInt(g.quantidade, 10) || 1
          const existing = defenderGroups.get(norm)
          if (existing) {
            existing.countReal += qty
          } else {
            defenderGroups.set(norm, { nome: cleanNome, countReal: qty })
          }
        }
      }
    }

    collectDefenders(jogo.gols_time_a)
    collectDefenders(jogo.gols_time_b)

    if (defenderGroups.size > 0) {
      const predCountMap = new Map<string, number>()
      const addPreds = (arr?: any[]) => {
        if (!Array.isArray(arr)) return
        for (const s of arr) {
          const sStr = typeof s === 'string' ? s : String((s as any)?.nome || '')
          const cleanP = sStr
            .replace(/\s*\d+\s*['’]/g, '')
            .replace(/\(gol contra\)|\(contra\)/gi, '')
            .trim()
          const normP = cleanScorerKey(cleanP)
          if (normP) {
            predCountMap.set(normP, (predCountMap.get(normP) || 0) + 1)
          }
        }
      }
      addPreds(palpite.goleadores_a)
      addPreds(palpite.goleadores_b)

      for (const [normPred, countPred] of predCountMap.entries()) {
        let matchedGroup = defenderGroups.get(normPred)
        if (!matchedGroup) {
          for (const [realNorm, group] of defenderGroups.entries()) {
            if (realNorm.includes(normPred) || normPred.includes(realNorm)) {
              matchedGroup = group
              break
            }
          }
        }
        if (matchedGroup && matchedGroup.countReal > 0) {
          count += Math.min(matchedGroup.countReal, countPred)
        }
      }
    }
  }

  // 3. Inferência Retroativa por Pontuação Diferenciada (Planilhas Importadas)
  // Nas planilhas importadas das 4 copas, os registros de palpites frequentemente têm apenas
  // strings como "Vencedor, Metade do Placar e gol do Gustavo Henrique" com pontuacao_jogo = 6
  // (2 de vencedor + 1 de metade = 3 de base => restam 3 pontos de gol).
  // Sempre que a pontuação total do palpite menos as regras de base revelar pontos de marcadores
  // em múltiplos de 3 (ou uma combinação onde 3 pontos foram atribuídos a um marcador),
  // contabilizamos como gol de defensor.
  if (count === 0 && Number(palpite.pontuacao_jogo) > 0) {
    // 3a. Verificar se há itens com "gol do X" ou "gols de X e Y" no detalhamento
    const scorerNamesFromDetails: string[] = []
    for (const item of detList) {
      if (/gols?\s+d[oe]\s+/i.test(item)) {
        const withoutBase = item
          .replace(/placar exato/gi, '')
          .replace(/vencedor nos p[eê]naltis/gi, '')
          .replace(/vencedor/gi, '')
          .replace(/empate/gi, '')
          .replace(/metade do placar/gi, '')
          .replace(/diferen[cç]a de gols/gi, '')
          .replace(/^[,\s–-]+|[,\s–-]+$/g, '')

        const scorerMatch = withoutBase.match(/gols?\s+d[oe]\s+(.+)/i)
        if (scorerMatch && scorerMatch[1]) {
          const names = scorerMatch[1]
            .split(/\s+e\s+|,/)
            .map((n) => n.trim().replace(/[.,;)]+$/, ''))
            .filter(Boolean)
          scorerNamesFromDetails.push(...names)
        }
      }
    }

    const totalPts = Number(palpite.pontuacao_jogo) || 0
    const scorerPts = extractScorerPointsFromScoreAndDetails(totalPts, detList, palpite, jogo)

    // Se temos pontos de marcadores identificados:
    // Exemplo clássico 1: 1 marcador citado e scorerPts === 3 -> exatamente 1 defensor (+3 pts)!
    // Exemplo clássico 2: 2 marcadores citados e scorerPts === 4 (3 do defensor + 1 do atacante) -> 1 defensor!
    // Exemplo clássico 3: 2 marcadores citados e scorerPts === 6 (3 + 3) -> 2 defensores!
    // Exemplo clássico 4: 1 marcador citado e scorerPts === 6 (defensor que fez 2 gols ou 2 acertos) -> 2 defensores!
    if (scorerPts >= 3) {
      const numScorersInText = Math.max(1, scorerNamesFromDetails.length)

      if (numScorersInText === 1) {
        // Ex: 1 jogador citado no detalhamento
        // Se rendeu 3 pontos -> 1 gol de defensor (+3 pts)
        // Se rendeu 6 pontos -> 2 gols de defensor (+6 pts)
        count = Math.floor(scorerPts / 3)
      } else if (numScorersInText === 2) {
        // Ex: 2 jogadores citados (ex: "Gustavo Henrique e Pedro Raul")
        // Se scorerPts === 4: 1 defensor (+3) e 1 atacante (+1) => 1 defensor
        // Se scorerPts === 6: 2 defensores (+3 + 3) => 2 defensores
        // Se scorerPts === 3: 1 defensor (+3) => 1 defensor
        if (scorerPts === 4) {
          count = 1
        } else if (scorerPts === 6) {
          count = 2
        } else if (scorerPts === 3) {
          count = 1
        } else {
          // Decomposição geral de soma: 3 * def + 1 * atc = scorerPts com (def + atc <= numScorersInText)
          for (let def = Math.min(numScorersInText, Math.floor(scorerPts / 3)); def >= 1; def--) {
            const rem = scorerPts - def * 3
            if (rem >= 0) {
              count = def
              break
            }
          }
        }
      } else {
        // Mais de 2 marcadores: decompor a soma maximizando ou ajustando defensores de 3 pts
        for (let def = Math.min(numScorersInText, Math.floor(scorerPts / 3)); def >= 1; def--) {
          const rem = scorerPts - def * 3
          if (rem >= 0) {
            count = def
            break
          }
        }
      }
    }
  }

  return count
}

/**
 * Identifica se uma partida é considerada um "Grande Jogo":
 * - Jogos de fases de mata-mata (oitavas, quartas, semifinal, final, playoff, volta, ida)
 * - Supercopas, Finais e Semifinais
 * - Jogos com disputa de pênaltis registrada
 * - Clássicos tradicionais e dérbis do futebol
 */
export interface IsGrandeJogoOptions {
  todosJogosDoBolao?: Jogo[]
}

/**
 * Normaliza strings para matching case/acentos
 */
function normalizeMatchText(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Lista de confrontos clássicos entre seleções mundiais de grande tradição
 */
const CLASSICOS_SELECOES: Array<[string, string]> = [
  ['brasil', 'argentina'],
  ['brasil', 'alemanha'],
  ['brasil', 'italia'],
  ['brasil', 'franca'],
  ['brasil', 'uruguai'],
  ['brasil', 'inglaterra'],
  ['brasil', 'espanha'],
  ['brasil', 'holanda'],
  ['brasil', 'portugal'],
  ['argentina', 'inglaterra'],
  ['argentina', 'alemanha'],
  ['argentina', 'uruguai'],
  ['argentina', 'holanda'],
  ['argentina', 'franca'],
  ['argentina', 'espanha'],
  ['argentina', 'italia'],
  ['franca', 'inglaterra'],
  ['franca', 'alemanha'],
  ['franca', 'italia'],
  ['franca', 'espanha'],
  ['alemanha', 'inglaterra'],
  ['alemanha', 'italia'],
  ['alemanha', 'holanda'],
  ['alemanha', 'espanha'],
  ['italia', 'espanha'],
  ['espanha', 'portugal'],
  ['holanda', 'espanha'],
  ['portugal', 'franca'],
  ['portugal', 'inglaterra'],
]

/**
 * Lista de clássicos tradicionais de clubes do futebol brasileiro e internacional
 */
const CLASSICOS_CLUBES: Array<[string, string]> = [
  // SP
  ['corinthians', 'palmeiras'],
  ['sao paulo', 'corinthians'],
  ['palmeiras', 'sao paulo'],
  ['santos', 'palmeiras'],
  ['santos', 'corinthians'],
  ['santos', 'sao paulo'],
  // RJ
  ['flamengo', 'fluminense'],
  ['flamengo', 'vasco'],
  ['flamengo', 'botafogo'],
  ['vasco', 'fluminense'],
  ['botafogo', 'fluminense'],
  ['vasco', 'botafogo'],
  // RS
  ['gremio', 'internacional'],
  // MG
  ['cruzeiro', 'atletico'],
  // BA
  ['bahia', 'vitoria'],
  // PR
  ['coritiba', 'athletico'],
  // Internacionais de Clubes
  ['real madrid', 'barcelona'],
  ['real madrid', 'atletico madrid'],
  ['inter', 'milan'],
  ['roma', 'lazio'],
  ['juventus', 'inter'],
  ['liverpool', 'manchester united'],
  ['liverpool', 'manchester city'],
  ['arsenal', 'tottenham'],
  ['chelsea', 'arsenal'],
  ['manchester united', 'manchester city'],
  ['marseille', 'paris saint-germain'],
  ['marseille', 'psg'],
  ['boca', 'river'],
]

/**
 * Verifica se uma string de texto descreve explicitamente uma fase eliminatória ou decisiva
 */
function hasEliminatoryKeywords(text: string): boolean {
  if (!text) return false
  const norm = normalizeMatchText(text)
  return (
    norm.includes('final') ||
    norm.includes('semi') ||
    norm.includes('quarta') ||
    norm.includes('oitava') ||
    norm.includes('3 lugar') ||
    norm.includes('3º lugar') ||
    norm.includes('terceiro') ||
    norm.includes('mata-mata') ||
    norm.includes('mata mata') ||
    norm.includes('playoff') ||
    norm.includes('supercopa') ||
    norm.includes('eliminat') ||
    norm.includes('penalti') ||
    norm.includes('classico') ||
    norm.includes('derbi') ||
    norm.includes('derby')
  )
}

/**
 * Identifica se uma partida é considerada um "Grande Jogo":
 * Heurísticas em ordem de prioridade:
 * 1. Tem disputa de pênaltis registrada (jogos eliminatórios)
 * 2. Fase explícita no registro (campo `competicao` com keywords decisivas: oitavas, quartas, semi, final, 3º lugar, supercopa, etc.)
 * 3. Indicação de jogos de ida/volta em torneios e copas
 * 4. Clássicos tradicionais e confrontos históricos entre grandes seleções / clubes
 * 5. Fallback por Torneio (Copa do Mundo / copas eliminatórias): quando nenhum jogo da competição
 *    tiver flag explícita de fase, as partidas das fases decisivas (últimos 16 jogos da planilha por ordem de inserção/data)
 *    são automaticamente qualificadas como Grandes Jogos (oitavas, quartas, semis, 3º lugar e final).
 */
export function isGrandeJogo(jogo: Jogo, bolao?: Bolao, options?: IsGrandeJogoOptions): boolean {
  // 1. Se tem disputa por pênaltis, é eliminatório / mata-mata decisivo
  if (jogo.tem_penaltis) return true

  // 2. Verificar string do campo competicao (fase explícita)
  const comp = jogo.competicao || ''
  if (hasEliminatoryKeywords(comp)) {
    return true
  }

  // 3. Foco ou Nome do Bolão contendo indicação de copas eliminatórias (ex: "Copa do Brasil", "Libertadores")
  const bFoco = normalizeMatchText(bolao?.foco || '')
  const bNome = normalizeMatchText(bolao?.nome || '')
  const compNorm = normalizeMatchText(comp)
  if (
    (bFoco.includes('copa') || bNome.includes('copa')) &&
    (compNorm.includes('volta') || compNorm.includes('ida'))
  ) {
    return true
  }

  // 4. Clássicos tradicionais e confrontos entre grandes equipes
  const timeA = normalizeMatchText(jogo.time_a || '')
  const timeB = normalizeMatchText(jogo.time_b || '')
  const matchPair = (t1: string, t2: string) =>
    (timeA.includes(t1) && timeB.includes(t2)) || (timeA.includes(t2) && timeB.includes(t1))

  // Clássicos de seleções
  for (const [t1, t2] of CLASSICOS_SELECOES) {
    if (matchPair(t1, t2)) return true
  }

  // Clássicos de clubes
  for (const [t1, t2] of CLASSICOS_CLUBES) {
    if (matchPair(t1, t2)) return true
  }

  // 5. Fallback por Torneio: Copas do Mundo / Torneios de Seleções / Copas onde nenhum jogo possui fase explicitada
  // Se o bolão for do tipo "Copa do Mundo" (ou foco indicar torneio eliminatório de seleções/copa)
  const isCopaDoMundo =
    bNome.includes('copa do mundo') ||
    bNome.includes('world cup') ||
    bFoco.includes('copa do mundo') ||
    bFoco.includes('world cup')

  if (isCopaDoMundo && options?.todosJogosDoBolao && options.todosJogosDoBolao.length > 0) {
    const jogosDoBolao = options.todosJogosDoBolao
    // Verificar se NENHUM jogo deste bolão tem indicação explícita de fase
    const temAlgumComFaseExplicita = jogosDoBolao.some((j) =>
      hasEliminatoryKeywords(j.competicao || ''),
    )

    if (!temAlgumComFaseExplicita) {
      // Ordenar os jogos pela ordem cronológica/inserção da planilha:
      // data, depois hora, depois id (ou created se disponível)
      const jogosOrdenados = [...jogosDoBolao].sort((a, b) => {
        const da = `${a.data || ''}T${a.hora || '00:00'}`
        const db = `${b.data || ''}T${b.hora || '00:00'}`
        if (da !== db) return da.localeCompare(db)
        const ca = a.created || ''
        const cb = b.created || ''
        if (ca && cb && ca !== cb) return ca.localeCompare(cb)
        return (a.id || '').localeCompare(b.id || '')
      })

      // Numa Copa do Mundo tradicional (formato clássico):
      // Fases eliminatórias = 8 oitavas + 4 quartas + 2 semis + 1 disputa 3º + 1 final = 16 partidas
      // Se a competição tiver menos de 16 jogos, pegamos as últimas partidas (ou metade final)
      const numFaseEliminatoria = Math.min(16, Math.max(1, Math.floor(jogosOrdenados.length / 2)))
      const ultimosJogosDecisivos = jogosOrdenados.slice(-numFaseEliminatoria)
      if (ultimosJogosDecisivos.some((uj) => uj.id === jogo.id)) {
        return true
      }
    }
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
          // Se é detalhamento de "Gols acertados: Jogador" ou "gol do X" / "gols de X e Y"
          // tentar extrair pela pontuação do jogo deduzindo a base
          const totalPts = Number(palpite.pontuacao_jogo) || 0
          const inferredGols = extractScorerPointsFromScoreAndDetails(
            totalPts,
            palpite.detalhamento,
            palpite,
            jogo,
          )
          if (inferredGols > 0) {
            pontosGols += inferredGols
          } else {
            const countCommas = (item.match(/,/g) || []).length + 1
            pontosGols += Math.max(1, countCommas)
          }
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
  filtroBolaoId?: string // 'todas' | 'geral' | bolao.id
}): StatsCalculationResult {
  const { boloes, participantes, jogos, palpites, filtroBolaoId } = params

  const isGeral =
    !filtroBolaoId || filtroBolaoId === 'todas' || filtroBolaoId === 'geral' || filtroBolaoId === ''

  // Mapear bolões válidos
  // Na visão Geral, se boloes estiver vazio por algum motivo, aceitamos os bolões presentes em jogos ou participantes
  const bolaoIdsValidos = new Set(
    isGeral
      ? boloes.length > 0
        ? boloes.map((b) => b.id)
        : Array.from(new Set([...jogos.map((j) => j.bolao), ...participantes.map((p) => p.bolao)]))
      : boloes.filter((b) => b.id === filtroBolaoId).map((b) => b.id),
  )

  // Mapa de bolões para verificação de status ativo/encerrado
  const bolaoMap = new Map<string, Bolao>()
  for (const b of boloes) {
    bolaoMap.set(b.id, b)
  }

  // Identificar palpites pontuados por jogo para inclusão retroativa
  const jogosComPalpitesPontuados = new Set<string>()
  for (const p of palpites) {
    const pts = Number(p.pontuacao_jogo) || 0
    const hasDetailPoints =
      Array.isArray(p.detalhamento) &&
      p.detalhamento.some(
        (d) =>
          typeof d === 'string' &&
          /(?:placar\s*exato|vencedor|empate|metade do placar|\+\d+\s*pts?)/i.test(d) &&
          !/aguardando|cancelado/i.test(d),
      )
    if (pts > 0 || hasDetailPoints) {
      jogosComPalpitesPontuados.add(p.jogo)
    }
  }

  // Filtrar jogos finalizados dos bolões selecionados:
  // Aceita jogo/palpite histórico como finalizado se:
  // - jogo.resultado_finalizado === true
  // - OU o jogo pertence a um bolão encerrado (bolao.ativo === false)
  // - OU o jogo já possui palpites com pontuação oficial concedida (pontuacao_jogo > 0 ou detalhamento)
  const jogosFinalizados = jogos.filter((j) => {
    if (!bolaoIdsValidos.has(j.bolao)) return false
    if (j.resultado_finalizado) return true
    const b = bolaoMap.get(j.bolao)
    if (b && b.ativo === false) return true
    if (jogosComPalpitesPontuados.has(j.id)) return true
    return false
  })
  const jogoIdsFinalizados = new Set(jogosFinalizados.map((j) => j.id))

  // Mapear participantes por id para resolução rápida
  const partMap = new Map<string, Participante>()
  for (const p of participantes) {
    partMap.set(p.id, p)
  }

  // Agrupar jogos finalizados por bolão para suporte a fallback ordenado por torneio
  const jogosPorBolaoMap = new Map<string, Jogo[]>()
  for (const j of jogosFinalizados) {
    const arr = jogosPorBolaoMap.get(j.bolao) || []
    arr.push(j)
    jogosPorBolaoMap.set(j.bolao, arr)
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
      marcadoresDefensores: number
      quaseCravadas: number
      pontosGrandesJogos: number
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
      marcadoresDefensores: 0,
      quaseCravadas: 0,
      pontosGrandesJogos: 0,
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
    // Aceita palpite se o jogo está em jogoIdsFinalizados OU se o próprio palpite
    // já possui pontuação oficial ou detalhamento indicativo de jogo encerrado
    const jogo = jogoMap.get(palpite.jogo)
    const palpiteTemPontos = Number(palpite.pontuacao_jogo) > 0
    const palpiteTemDetalhamento =
      Array.isArray(palpite.detalhamento) &&
      palpite.detalhamento.some(
        (d) =>
          typeof d === 'string' &&
          /(?:placar\s*exato|vencedor|empate|metade do placar|\+\d+\s*pts?)/i.test(d) &&
          !/aguardando|cancelado/i.test(d),
      )

    if (!jogoIdsFinalizados.has(palpite.jogo) && !palpiteTemPontos && !palpiteTemDetalhamento) {
      continue
    }
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

    // 1. Pai dos Defensores: contagem de marcadores defensores acertados
    const defCount = countMarcadoresDefensoresAcertados(palpite, jogo)
    stat.marcadoresDefensores += defCount

    // 2. Mestre do Quase: palpite a 1 gol do placar real
    const quase = isQuaseCravada(palpite, jogo)
    if (quase) {
      stat.quaseCravadas++
    }

    // 4. Mito dos Grandes Jogos: soma de pontos em partidas decisivas/clássicos
    const bolaoDoJogo = bolaoMap.get(jogo.bolao)
    const todosJogosDesteBolao = jogosPorBolaoMap.get(jogo.bolao)
    const grande = isGrandeJogo(jogo, bolaoDoJogo, {
      todosJogosDoBolao: todosJogosDesteBolao,
    })
    if (grande) {
      stat.pontosGrandesJogos += ptsJogo
    }

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
      marcadoresDefensores: s.marcadoresDefensores,
      quaseCravadas: s.quaseCravadas,
      pontosGrandesJogos: s.pontosGrandesJogos,
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
  const topCravadasList: string[] = []
  for (const t of tabela) {
    if (t.cravadasExatas > topCravadas) {
      topCravadas = t.cravadasExatas
      topCravadasList.length = 0
      if (topCravadas > 0) {
        topCravadasList.push(t.nome)
      }
    } else if (t.cravadasExatas === topCravadas && topCravadas > 0) {
      topCravadasList.push(t.nome)
    }
  }

  // Mestre do Resultado
  let topResultados = -1
  const topResultadosList: string[] = []
  for (const t of tabela) {
    if (t.resultadosAcertados > topResultados) {
      topResultados = t.resultadosAcertados
      topResultadosList.length = 0
      if (topResultados > 0) {
        topResultadosList.push(t.nome)
      }
    } else if (t.resultadosAcertados === topResultados && topResultados > 0) {
      topResultadosList.push(t.nome)
    }
  }

  // Matador de Aposta (Gols)
  let topGols = -1
  const topGolsList: string[] = []
  for (const t of tabela) {
    if (t.golsAcertados > topGols) {
      topGols = t.golsAcertados
      topGolsList.length = 0
      if (topGols > 0) {
        topGolsList.push(t.nome)
      }
    } else if (t.golsAcertados === topGols && topGols > 0) {
      topGolsList.push(t.nome)
    }
  }

  // 1. Pai dos Defensores (Mestre da Zaga)
  let topDefensores = -1
  const topDefensoresList: string[] = []
  for (const t of tabela) {
    if (t.marcadoresDefensores > topDefensores) {
      topDefensores = t.marcadoresDefensores
      topDefensoresList.length = 0
      if (topDefensores > 0) {
        topDefensoresList.push(t.nome)
      }
    } else if (t.marcadoresDefensores === topDefensores && topDefensores > 0) {
      topDefensoresList.push(t.nome)
    }
  }

  // 2. Mestre do Quase (O Injustiçado)
  let topQuases = -1
  const topQuasesList: string[] = []
  for (const t of tabela) {
    if (t.quaseCravadas > topQuases) {
      topQuases = t.quaseCravadas
      topQuasesList.length = 0
      if (topQuases > 0) {
        topQuasesList.push(t.nome)
      }
    } else if (t.quaseCravadas === topQuases && topQuases > 0) {
      topQuasesList.push(t.nome)
    }
  }

  // 3. Pé Frio da Rodada (menor aproveitamento entre quem já palpitou em jogos encerrados)
  // Consideramos apenas participantes que tenham palpitado em ao menos 1 jogo encerrado
  const participantesComJogos = tabela.filter((t) => t.jogosPalpitadosEncerrados > 0)
  let piorAproveitamento = 101
  const piorAproveitamentoList: ParticipantStats[] = []

  if (participantesComJogos.length > 0) {
    for (const t of participantesComJogos) {
      if (t.aproveitamento < piorAproveitamento) {
        piorAproveitamento = t.aproveitamento
        piorAproveitamentoList.length = 0
        piorAproveitamentoList.push(t)
      } else if (t.aproveitamento === piorAproveitamento) {
        piorAproveitamentoList.push(t)
      }
    }
  }

  // 4. Mito dos Grandes Jogos (maior pontuador exclusivamente em jogos eliminatórios/clássicos)
  // Contar quantos jogos do recorte foram considerados grandes jogos
  const countGrandesJogos = jogosFinalizados.filter((j) =>
    isGrandeJogo(j, bolaoMap.get(j.bolao), {
      todosJogosDoBolao: jogosPorBolaoMap.get(j.bolao),
    }),
  ).length
  let topGrandesJogos = -1
  const topGrandesJogosList: string[] = []
  for (const t of tabela) {
    if (t.pontosGrandesJogos > topGrandesJogos) {
      topGrandesJogos = t.pontosGrandesJogos
      topGrandesJogosList.length = 0
      if (topGrandesJogos > 0) {
        topGrandesJogosList.push(t.nome)
      }
    } else if (t.pontosGrandesJogos === topGrandesJogos && topGrandesJogos > 0) {
      topGrandesJogosList.push(t.nome)
    }
  }

  const recordes: RecordHolders = {
    reiDaCravada: {
      participante: topCravadasList.length > 0 ? topCravadasList[0] : '—',
      valor: Math.max(0, topCravadas),
      empate: topCravadasList.length > 1 ? topCravadasList : undefined,
    },
    mestreDoResultado: {
      participante: topResultadosList.length > 0 ? topResultadosList[0] : '—',
      valor: Math.max(0, topResultados),
      empate: topResultadosList.length > 1 ? topResultadosList : undefined,
    },
    matadorDeAposta: {
      participante: topGolsList.length > 0 ? topGolsList[0] : '—',
      valor: Math.max(0, topGols),
      empate: topGolsList.length > 1 ? topGolsList : undefined,
    },
    maiorPontuadorRodada: maxRodada,
    paiDosDefensores: {
      participante: topDefensoresList.length > 0 ? topDefensoresList[0] : '—',
      valor: Math.max(0, topDefensores),
      empate: topDefensoresList.length > 1 ? topDefensoresList : undefined,
      temDados: topDefensores > 0,
    },
    mestreDoQuase: {
      participante: topQuasesList.length > 0 ? topQuasesList[0] : '—',
      valor: Math.max(0, topQuases),
      empate: topQuasesList.length > 1 ? topQuasesList : undefined,
      temDados: topQuases > 0,
    },
    peFrioDaRodada: {
      participante: piorAproveitamentoList.length > 0 ? piorAproveitamentoList[0].nome : '—',
      aproveitamento:
        piorAproveitamentoList.length > 0 ? piorAproveitamentoList[0].aproveitamento : 0,
      jogosPalpitados:
        piorAproveitamentoList.length > 0 ? piorAproveitamentoList[0].jogosPalpitadosEncerrados : 0,
      empate:
        piorAproveitamentoList.length > 1 ? piorAproveitamentoList.map((p) => p.nome) : undefined,
      temDados: participantesComJogos.length > 0,
    },
    mitoDosGrandesJogos: {
      participante: topGrandesJogosList.length > 0 ? topGrandesJogosList[0] : '—',
      pontos: Math.max(0, topGrandesJogos),
      jogosConsiderados: countGrandesJogos,
      empate: topGrandesJogosList.length > 1 ? topGrandesJogosList : undefined,
      temDados: countGrandesJogos > 0 && topGrandesJogos > 0,
    },
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
