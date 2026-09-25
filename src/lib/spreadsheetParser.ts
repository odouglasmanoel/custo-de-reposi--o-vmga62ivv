import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'
import { BOLAO_MEMBERS } from '@/context/AuthContext'

export interface ParsedParticipantScore {
  nome: string
  pontuacao: number
}

export interface ParsedPrediction {
  participanteNome: string
  placar_a: number
  placar_b: number
  goleadores_a?: string[]
  goleadores_b?: string[]
  pontos?: number
  detalhamento?: string[]
}

export interface ParsedGame {
  time_a: string
  time_b: string
  competicao?: string
  placar_a?: number
  placar_b?: number
  data?: string
  hora?: string
  rodada?: string
  finalizado?: boolean
  gols_time_a?: Array<{ nome: string; posicao: string; quantidade: number }>
  gols_time_b?: Array<{ nome: string; posicao: string; quantidade: number }>
  palpites?: ParsedPrediction[]
}

export interface ImportResult {
  participantesAtualizados: number
  jogosProcessados: number
  palpitesProcessados: number
  participantesNomes: string[]
  avisos: string[]
}

/**
 * Normalizes text removing accents, punctuation and trimming.
 */
export function cleanKey(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Matches known participants (Douglas, Gabriel, Bruno, Davi) with tolerance
 */
export function matchParticipantName(rawName: string): string {
  const clean = cleanKey(rawName)
  if (clean.includes('brunox') || clean.includes('xavier')) {
    return 'Bruno Xavier'
  }
  if (clean.includes('brunol') || clean.includes('lopes')) {
    return 'Bruno Lopes'
  }
  if (clean === 'bruno') {
    return 'Bruno Lopes'
  }
  for (const known of BOLAO_MEMBERS) {
    const cleanKnown = cleanKey(known)
    if (cleanKnown === clean || clean.includes(cleanKnown) || cleanKnown.includes(clean)) {
      return known
    }
  }
  return rawName.trim()
}

/**
 * Extrai o placar puro cortando tudo a partir do primeiro "(", aplicando trim,
 * casando o padrão /^(\d+)\s*(?:x|[-:]|a)\s*(\d+)$/i e retornando { placarA, placarB } ou null.
 * Retorna null também para valores tipo "12/34" ou com datas.
 */
export function extractPureScoreString(val: any): { placarA: number; placarB: number } | null {
  if (val === null || val === undefined) return null
  let str = String(val).trim()
  if (!str) return null

  // Descarta datas como "01/11", "12/34", "01/11/2024"
  if (/\d{1,2}\/\d{1,2}/.test(str)) {
    return null
  }

  // Corta tudo a partir do primeiro "("
  const parenIdx = str.indexOf('(')
  if (parenIdx !== -1) {
    str = str.substring(0, parenIdx).trim()
  }

  const match = str.match(/^(\d+)\s*(?:x|[-:]|a)\s*(\d+)$/i)
  if (match) {
    return {
      placarA: parseInt(match[1], 10),
      placarB: parseInt(match[2], 10),
    }
  }

  return null
}

/**
 * Extrai o conteúdo do primeiro "(...)" e divide por vírgula, ponto-e-vírgula, quebra de linha
 * ou conectivo " e ", tratando multiplicadores como "Samuel Lino 2x" ou "2x Samuel Lino" -> ["Samuel Lino", "Samuel Lino"].
 * Retorna lista de autores limpa.
 */
export function extractScorersFromParentheses(val: any): string[] {
  if (val === null || val === undefined) return []
  const str = String(val).trim()
  if (!str) return []

  const openIdx = str.indexOf('(')
  const closeIdx = str.indexOf(')', openIdx)
  if (openIdx === -1) return []

  const inner =
    closeIdx !== -1
      ? str.substring(openIdx + 1, closeIdx).trim()
      : str.substring(openIdx + 1).trim()
  if (!inner) return []

  // Divide por vírgula, ponto-e-vírgula, quebra de linha ou " e " / " E "
  const tokens = inner
    .split(/[,;\n]+|\s+e\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)

  const result: string[] = []

  for (const token of tokens) {
    let raw = token.trim()
    if (!raw) continue

    // Verifica multiplicadores como "Samuel Lino 2x", "2x Samuel Lino", "Samuel Lino 2 gols"
    let multiplier = 1
    const multAfterMatch = raw.match(/^(.*?)(?:\s+(\d+)\s*[xX]|\s+(\d+)\s*gols?)$/i)
    const multBeforeMatch = raw.match(/^(?:(\d+)\s*[xX]|\s*(\d+)\s*gols?\s*d[oe]?)\s+(.*?)$/i)

    if (multAfterMatch) {
      raw = multAfterMatch[1].trim()
      multiplier = parseInt(multAfterMatch[2] || multAfterMatch[3], 10) || 1
    } else if (multBeforeMatch) {
      multiplier = parseInt(multBeforeMatch[1] || multBeforeMatch[2], 10) || 1
      raw = multBeforeMatch[3].trim()
    }

    // Limpa pontuações residuais
    raw = raw.replace(/^[-–—:]+|[-–—:]+$/g, '').trim()
    if (!raw) continue

    for (let k = 0; k < multiplier; k++) {
      result.push(raw)
    }
  }

  return result
}

/**
 * Parses score string like "2 x 1", "2x1", "2-1", "2 - 1", "2 a 1",
 * or with extra text like "1x2 (Carbonero...)"
 * Sempre descarta o trecho a partir de "(" antes de buscar o padrão NxN.
 */
export function parseScoreString(val: any): { placarA: number; placarB: number } | null {
  if (val === null || val === undefined) return null
  let str = String(val).trim()
  if (!str) return null

  // 0. Strings with dates like "01/11 -", "08/11 -", "01/11/2024", "12/34" are match dates, not scores
  if (/\d{1,2}\/\d{1,2}/.test(str)) {
    return null
  }

  // Corta tudo a partir do primeiro "(" antes de buscar o padrão NxN
  const parenIdx = str.indexOf('(')
  if (parenIdx !== -1) {
    str = str.substring(0, parenIdx).trim()
  }

  // 1. Check for NxN pattern anywhere at the beginning or as full/prefix score:
  // Accepts "0x0", "1x0", "3x1", "2 x 2", "1-2", "2:1", "2 a 1", "3x1 - final", etc.
  const match = str.match(/^(\d+)\s*(?:x|[-:]|a)\s*(\d+)(?:\s*.*)?$/i)
  if (match) {
    return {
      placarA: parseInt(match[1], 10),
      placarB: parseInt(match[2], 10),
    }
  }

  return null
}

/**
 * Parses date/time cells into { data, hora }
 */
function parseDateTimeCell(val: any): { data?: string; hora?: string } {
  if (!val) return {}
  if (typeof val === 'number') {
    // Excel serial date
    try {
      const parsedDate = XLSX.SSF.parse_date_code(val)
      if (parsedDate) {
        const y = parsedDate.y
        const m = String(parsedDate.m).padStart(2, '0')
        const d = String(parsedDate.d).padStart(2, '0')
        const data = `${y}-${m}-${d}T00:00:00.000Z`
        const hora = `${String(parsedDate.H || 16).padStart(2, '0')}:${String(parsedDate.M || 0).padStart(2, '0')}`
        return { data, hora }
      }
    } catch {
      /* ignore */
    }
  }

  const str = String(val).trim()
  // Pattern DD/MM/YYYY or DD/MM
  const dateMatch = str.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/)
  let data: string | undefined
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0')
    const month = dateMatch[2].padStart(2, '0')
    const year = dateMatch[3]
      ? dateMatch[3].length === 2
        ? `20${dateMatch[3]}`
        : dateMatch[3]
      : '2024'
    data = `${year}-${month}-${day}T12:00:00.000Z`
  }

  // Pattern HH:MM
  const timeMatch = str.match(/(\d{1,2}):(\d{2})/)
  let hora: string | undefined
  if (timeMatch) {
    hora = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
  }

  return { data, hora }
}

/**
 * Extracts goal scorers list from string cell
 * e.g. "Pedro Raul, Gui Negão (gol contra)"
 */
function parseScorersString(
  val: any,
): Array<{ nome: string; posicao: string; quantidade: number }> {
  if (!val) return []
  const str = String(val).trim()
  if (!str) return []

  const parts = str
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const result: Array<{ nome: string; posicao: string; quantidade: number }> = []

  for (const part of parts) {
    const isGolContra = /contra/i.test(part)
    const isZagueiro = /zagueiro|lateral/i.test(part)
    const isGoleiro = /goleiro/i.test(part)

    let posicao = 'Atacante/Meia'
    if (isGolContra) posicao = 'Gol Contra'
    else if (isZagueiro) posicao = 'Zagueiro/Lateral'
    else if (isGoleiro) posicao = 'Goleiro'

    // Clean name by stripping parentheses like "(gol contra)"
    const cleanName = part.replace(/\([^)]*\)/g, '').trim()
    if (cleanName) {
      result.push({
        nome: cleanName,
        posicao,
        quantidade: 1,
      })
    }
  }

  return result
}

/**
 * Calculates score for a prediction against a real match result according to official rules
 */
export function calculateMatchScore(
  predA: number,
  predB: number,
  realA: number,
  realB: number,
  predScorersA: string[] = [],
  predScorersB: string[] = [],
  realScorersA: Array<{ nome: string; posicao: string; quantidade: number }> = [],
  realScorersB: Array<{ nome: string; posicao: string; quantidade: number }> = [],
  temPenaltis = false,
  vencedorPenaltisReal?: 'A' | 'B' | string,
  predVencedorPenaltis?: 'A' | 'B' | 'N' | string,
): { pontos: number; detalhamento: string[] } {
  let pontos = 0
  const detalhamento: string[] = []

  const getWinner = (a: number, b: number) => (a > b ? 1 : b > a ? -1 : 0)
  const realWinner = getWinner(realA, realB)
  const predWinner = getWinner(predA, predB)
  const realDiff = Math.abs(realA - realB)
  const predDiff = Math.abs(predA - predB)

  const isExact = predA === realA && predB === realB

  if (isExact) {
    pontos += 8
    detalhamento.push('Placar Exato (+8 pts)')
  } else {
    if (predWinner === realWinner) {
      if (realWinner === 0) {
        pontos += 2
        detalhamento.push('Empate (+2 pts)')
      } else {
        pontos += 2
        detalhamento.push('Vencedor (+2 pts)')
      }
    }

    if (predDiff === realDiff && predWinner === realWinner) {
      pontos += 1
      detalhamento.push('Diferença de Gols (+1 pt)')
    }

    if (predA === realA || predB === realB) {
      pontos += 1
      detalhamento.push('Metade do Placar (+1 pt)')
    }
  }

  // Penalties scoring: +2 bonus points when participant predicts the penalty shootout winner
  if (temPenaltis) {
    const realPen = (vencedorPenaltisReal || '').toUpperCase().trim()
    const predPen = (predVencedorPenaltis || '').toUpperCase().trim()
    if (realPen && predPen && realPen === predPen && (predPen === 'A' || predPen === 'B')) {
      pontos += 2
      detalhamento.push('Vencedor nos Pênaltis (+2 pts)')
    }
  }

  // Scorers scoring — agrupamento por frequência min(N, M)
  interface RealScorerGroup {
    nome: string
    norm: string
    posicao: string
    points: number
    countReal: number
    minutes: number[]
  }
  const realGroupMap = new Map<string, RealScorerGroup>()

  const addReal = (list: Array<{ nome: string; posicao: string; quantidade: number }>) => {
    for (const item of list) {
      if (!item || !item.nome) continue
      const rawNome = String(item.nome).trim()
      const cleanNome = rawNome
        .replace(/\s*\d+\s*['’]/g, '')
        .replace(/\(gol contra\)|\(contra\)/gi, '')
        .trim()
      const norm = cleanKey(cleanNome)
      if (!norm) continue

      const pos = (item.posicao || 'Atacante/Meia').toLowerCase()
      let pts = 1
      if (pos.includes('zagueiro') || pos.includes('lateral') || pos.includes('defensor')) pts = 3
      else if (pos.includes('goleiro')) pts = 10
      else if (pos.includes('contra')) pts = 5

      const posLabel =
        item.posicao ||
        (pts === 3 ? 'Defensor' : pts === 10 ? 'Goleiro' : pts === 5 ? 'Gol Contra' : 'Atacante')

      const mins: number[] = []
      const minMatches = rawNome.matchAll(/(\d+)\s*['’]/g)
      for (const mm of minMatches) {
        const mNum = parseInt(mm[1], 10)
        if (!isNaN(mNum)) mins.push(mNum)
      }

      const qtd = Number(item.quantidade) || 1
      const existing = realGroupMap.get(norm)
      if (existing) {
        existing.countReal += qtd
        if (mins.length > 0) existing.minutes.push(...mins)
      } else {
        realGroupMap.set(norm, {
          nome: cleanNome,
          norm,
          posicao: posLabel,
          points: pts,
          countReal: qtd,
          minutes: mins,
        })
      }
    }
  }

  addReal(realScorersA)
  addReal(realScorersB)

  // Agrupa palpites por frequência M
  const predCountMap = new Map<string, number>()
  const allPred = [...predScorersA, ...predScorersB]
  for (const p of allPred) {
    if (!p) continue
    const cleanP = String(p)
      .replace(/\s*\d+\s*['’]/g, '')
      .replace(/\(gol contra\)|\(contra\)/gi, '')
      .trim()
    const normP = cleanKey(cleanP)
    if (!normP) continue
    predCountMap.set(normP, (predCountMap.get(normP) || 0) + 1)
  }

  const matchedScorers: string[] = []
  for (const [normPred, countPred] of predCountMap.entries()) {
    let matchedReal: RealScorerGroup | undefined = realGroupMap.get(normPred)
    if (!matchedReal) {
      for (const [realNorm, group] of realGroupMap.entries()) {
        if (realNorm.includes(normPred) || normPred.includes(realNorm)) {
          matchedReal = group
          break
        }
      }
    }

    if (matchedReal && matchedReal.countReal > 0) {
      const g = Math.min(matchedReal.countReal, countPred)
      if (g > 0) {
        const ptsTotal = g * matchedReal.points
        pontos += ptsTotal

        const minsToUse = matchedReal.minutes.slice(0, g)
        let txt = ''
        if (minsToUse.length > 0) {
          const minsStr = minsToUse.map((m) => `${m}'`).join(', ')
          txt = `${matchedReal.nome} ${minsStr} [${matchedReal.posicao}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
        } else if (g > 1) {
          txt = `${matchedReal.nome} ×${g} [${matchedReal.posicao}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
        } else {
          txt = `${matchedReal.nome} [${matchedReal.posicao}] (+${ptsTotal} pt${ptsTotal > 1 ? 's' : ''})`
        }
        matchedScorers.push(txt)
      }
    }
  }

  if (matchedScorers.length > 0) {
    detalhamento.push(`Gols acertados: ${matchedScorers.join(', ')}`)
  }

  return { pontos, detalhamento }
}

/**
 * Robust Spreadsheet Parser: extracts participant totals, individual matches,
 * real final scores and per-participant predictions (Douglas, Gabriel, Bruno, Davi).
 */
export async function parseSpreadsheet(file: File): Promise<{
  scores: ParsedParticipantScore[]
  games: ParsedGame[]
  avisos: string[]
}> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const avisos: string[] = []

  const scoresMap = new Map<string, number>()
  // Key: confrontation identifier (e.g. cleanKey(timeA) + 'x' + cleanKey(timeB))
  const gamesByConfronto = new Map<string, ParsedGame>()

  // Iterate over all sheets in workbook
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: '' })
    if (!rows || rows.length === 0) continue

    // Check if sheet itself is named after one of the participants (Douglas, Gabriel, Bruno, Davi)
    const sheetMatchedMember = matchParticipantName(sheetName)
    const isParticipantSheet = BOLAO_MEMBERS.some(
      (m) => cleanKey(m) === cleanKey(sheetMatchedMember) || cleanKey(m) === cleanKey(sheetName),
    )
    const activeSheetParticipant = isParticipantSheet ? sheetMatchedMember : null

    // If this sheet represents a single participant tab (e.g. Bruno, Davi, Douglas, Gabriel),
    // check if it has a "Pontuação Total" row at the bottom (e.g. line 30 with 12, 81, 65, 62).
    // We record this participant's total in scoresMap if not already set by a master ranking tab.
    if (activeSheetParticipant && !scoresMap.has(activeSheetParticipant)) {
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] as any[]
        if (!Array.isArray(row) || row.length === 0) continue
        const cell0 = cleanKey(String(row[0] || ''))
        if (cell0 === 'pontuacaototal' || cell0.includes('pontuacaototal')) {
          for (let c = 1; c < row.length; c++) {
            const val = row[c]
            if (val !== '' && val !== null && val !== undefined) {
              const numVal = parseFloat(String(val).replace(',', '.'))
              if (!isNaN(numVal)) {
                scoresMap.set(activeSheetParticipant, numVal)
                break
              }
            }
          }
        }
      }
    }

    // 1. LOOK FOR PARTICIPANT TOTALS / RANKING TABLE
    // Columns: "Participante", "Nome", "Apostador" AND "Total", "Pontos", "Pontuação", "Pts"
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const row = rows[r] as any[]
      if (!Array.isArray(row)) continue

      let colNameIdx = -1
      let colScoreIdx = -1

      for (let c = 0; c < row.length; c++) {
        const cell = cleanKey(String(row[c] || ''))
        if (
          cell === 'participante' ||
          cell === 'participantes' ||
          cell === 'nome' ||
          cell === 'apostador' ||
          cell === 'jogador'
        ) {
          colNameIdx = c
        }
        if (
          cell === 'pontos' ||
          cell === 'pontuacao' ||
          cell === 'pontuacaototal' ||
          cell === 'total' ||
          cell === 'pts' ||
          cell === 'score'
        ) {
          colScoreIdx = c
        }
      }

      if (colNameIdx !== -1 && colScoreIdx !== -1) {
        for (let nextR = r + 1; nextR < rows.length; nextR++) {
          const rowData = rows[nextR] as any[]
          if (!rowData || rowData.length === 0) continue
          const rawName = String(rowData[colNameIdx] || '').trim()
          if (!rawName) continue

          const cleanN = cleanKey(rawName)
          if (
            cleanN === 'total' ||
            cleanN === 'media' ||
            cleanN === 'ranking' ||
            cleanN === 'subtotal'
          ) {
            continue
          }

          const matched = matchParticipantName(rawName)
          const rawScore = rowData[colScoreIdx]
          if (rawScore !== '' && rawScore !== null && rawScore !== undefined) {
            const scoreNum = parseFloat(String(rawScore).replace(',', '.'))
            if (!isNaN(scoreNum)) {
              scoresMap.set(matched, scoreNum)
            }
          }
        }
        break
      }
    }

    // Fallback totals search: Look for known member names directly adjacent to numbers
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] as any[]
      if (!row) continue

      // If the row is an event, total or match line, do not treat participant name here as a table ranking
      const firstCellClean = cleanKey(String(row[0] || ''))
      if (
        firstCellClean.includes('sorteio') ||
        firstCellClean.includes('pontuacaototal') ||
        firstCellClean.includes('x')
      ) {
        continue
      }

      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim()
        for (const member of BOLAO_MEMBERS) {
          if (cleanKey(val) === cleanKey(member)) {
            // Check next 1-4 columns for a numeric value
            for (let nc = c + 1; nc < Math.min(row.length, c + 5); nc++) {
              const cellVal = String(row[nc] || '').trim()
              if (cellVal !== '' && !isNaN(Number(cellVal.replace(',', '.')))) {
                const foundNum = parseFloat(cellVal.replace(',', '.'))
                if (!scoresMap.has(member)) {
                  scoresMap.set(member, foundNum)
                }
                break
              }
            }
          }
        }
      }
    }
    // 2. PARSE MATCHES / JOGOS AND PREDICTIONS
    // Can be a general matches sheet OR a participant sheet (e.g. Douglas, Gabriel, Bruno, Davi)
    // containing columns: Jogos / Confronto, Placar Final, Palpites, Pontuação, Detalhamento da Pontuação
    let gameHeaderRow = -1
    let colTimeA = -1
    let colTimeB = -1
    let colPlacarFinal = -1
    let colPlacarA = -1
    let colPlacarB = -1
    let colCompeticao = -1
    let colData = -1
    let colHora = -1
    let colRodada = -1
    let colGolsA = -1
    let colGolsB = -1

    // Single participant sheet columns:
    let colPalpite = -1
    let colPontuacao = -1
    let colDetalhamento = -1

    // Multi-participant columns (when a single sheet has Douglas, Gabriel, Bruno, Davi columns):
    const memberCols = new Map<
      string,
      { colPred: number; colPts?: number; colDetalhamento?: number; colScorers?: number }
    >()

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] as any[]
      if (!Array.isArray(row)) continue

      let tempColA = -1
      let tempColB = -1

      for (let c = 0; c < row.length; c++) {
        const cell = cleanKey(String(row[c] || ''))
        if (
          cell === 'mandante' ||
          cell === 'timea' ||
          cell === 'time1' ||
          cell === 'equipea' ||
          cell === 'selecaoa' ||
          cell === 'time'
        ) {
          tempColA = c
        }
        if (
          cell === 'visitante' ||
          cell === 'timeb' ||
          cell === 'time2' ||
          cell === 'equipeb' ||
          cell === 'selecaob'
        ) {
          tempColB = c
        }
        if (
          cell === 'confronto' ||
          cell === 'confrontos' ||
          cell === 'jogo' ||
          cell === 'jogos' ||
          cell === 'partida' ||
          cell === 'partidas'
        ) {
          // Single confrontation column like "Flamengo x Palmeiras"
          if (tempColA === -1) tempColA = c
        }
      }

      if (tempColA !== -1) {
        // Found header!
        gameHeaderRow = r
        colTimeA = tempColA
        colTimeB = tempColB

        // Scan row headers for data, hora, placar final, palpites, pontuacao, detalhamento
        for (let c = 0; c < row.length; c++) {
          const rawCell = String(row[c] || '').trim()
          const cell = cleanKey(rawCell)

          // Placar Final / Resultado tolerance
          if (
            cell === 'competicao' ||
            cell === 'competicoes' ||
            cell === 'torneio' ||
            cell === 'campeonato' ||
            cell.includes('competicao') ||
            cell.includes('torneio')
          ) {
            colCompeticao = c
          } else if (
            cell === 'placarfinal' ||
            cell === 'placar' ||
            cell === 'resultado' ||
            cell === 'resultadofinal' ||
            cell === 'placaroficial' ||
            cell.includes('placarfinal') ||
            cell.includes('resultadofinal')
          ) {
            colPlacarFinal = c
          } else if (cell === 'placara' || cell === 'golstimea' || cell === 'golsa') {
            colPlacarA = c
          } else if (cell === 'placarb' || cell === 'golstimeb' || cell === 'golsb') {
            colPlacarB = c
          } else if (cell === 'data' || cell === 'dia') {
            colData = c
          } else if (cell === 'hora' || cell === 'horario') {
            colHora = c
          } else if (cell === 'rodada' || cell === 'fase') {
            colRodada = c
          } else if (cell === 'autoresa' || cell === 'marcadorestimea' || cell === 'goleadoresa') {
            colGolsA = c
          } else if (cell === 'autoresb' || cell === 'marcadorestimeb' || cell === 'goleadoresb') {
            colGolsB = c
          } else if (
            cell === 'palpite' ||
            cell === 'palpites' ||
            cell === 'aposta' ||
            cell === 'apostas' ||
            cell.includes('palpite')
          ) {
            colPalpite = c
          } else if (
            cell === 'pontuacao' ||
            cell === 'pontos' ||
            cell === 'pts' ||
            cell === 'pontuacaodojogo'
          ) {
            colPontuacao = c
          } else if (
            cell === 'detalhamentodapontuacao' ||
            cell === 'detalhamento' ||
            cell === 'detalhe' ||
            cell === 'detalhes' ||
            cell.includes('detalhamento')
          ) {
            colDetalhamento = c
          }

          // Check if column matches known member (Douglas, Gabriel, Bruno, Davi)
          for (const member of BOLAO_MEMBERS) {
            if (cleanKey(member) === cell || cell.includes(cleanKey(member))) {
              memberCols.set(member, { colPred: c })
            }
          }
        }

        // Look at next row (r+1) in case subheaders exist like "Palpite" / "Pontos"
        if (r + 1 < rows.length) {
          const subRow = rows[r + 1] as any[]
          if (Array.isArray(subRow)) {
            for (const [member, info] of memberCols.entries()) {
              // Check adjacent columns for pts
              const nextC = info.colPred + 1
              if (nextC < subRow.length) {
                const subCell = cleanKey(String(subRow[nextC] || ''))
                if (subCell === 'pts' || subCell === 'pontos') {
                  info.colPts = nextC
                }
              }
            }
          }
        }
        break
      }
    }

    if (gameHeaderRow !== -1 && colTimeA !== -1) {
      // Process game rows
      const startRow = gameHeaderRow + 1
      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r] as any[]
        if (!row || row.length === 0) continue

        let rawA = String(row[colTimeA] || '').trim()
        let rawB = colTimeB !== -1 ? String(row[colTimeB] || '').trim() : ''

        if (!rawA) continue

        // Check if rawA contains "TimeA x TimeB"
        if (
          !rawB &&
          (/\s+[xX]\s+/.test(rawA) || /\s+vs\.?\s+/i.test(rawA) || /\s+-\s+/.test(rawA))
        ) {
          // Split ONLY when x/X/vs has whitespace around it or space-hyphen-space (" - "),
          // never inside words like "México", "Bélgica x México", or team names like "Atlético-MG"
          const parts = rawA.split(/\s+(?:[xX]|vs\.?|-)\s+/)
          if (parts.length >= 2) {
            rawA = parts[0].trim().replace(/\s+/g, ' ')
            rawB = parts.slice(1).join(' - ').trim().replace(/\s+/g, ' ')
          }
        } else {
          rawA = rawA.replace(/\s+/g, ' ')
          if (rawB) {
            rawB = rawB.replace(/\s+/g, ' ')
          }
        }

        // Skip administrative events, totals and non-matches (e.g. "Sorteio das Quartas de Final", "Pontuação Total")
        const lowerRaw = `${rawA} ${rawB}`.toLowerCase()
        if (
          lowerRaw.includes('sorteio') ||
          lowerRaw.includes('pontuacao total') ||
          lowerRaw.includes('pontuação total') ||
          lowerRaw.includes('pontuacaototal') ||
          lowerRaw.includes('abertura') ||
          lowerRaw.includes('encerramento') ||
          lowerRaw.includes('premiacao') ||
          lowerRaw.includes('premiacão') ||
          lowerRaw.includes('cerimonia') ||
          lowerRaw.includes('cerimônia')
        ) {
          continue
        }

        // Skip headers, totals or summary rows
        const cleanA = cleanKey(rawA)
        const cleanB = cleanKey(rawB)
        const headerKeywords = new Set([
          'total',
          'pontuacaototal',
          'mandante',
          'visitante',
          'time',
          'timea',
          'timeb',
          'time1',
          'time2',
          'equipe',
          'equipea',
          'equipeb',
          'selecao',
          'selecaoa',
          'selecaob',
          'confronto',
          'confrontos',
          'jogo',
          'jogos',
          'partida',
          'partidas',
        ])
        if (
          headerKeywords.has(cleanA) ||
          cleanA.includes('pontuacaototal') ||
          headerKeywords.has(cleanB) ||
          cleanB.includes('pontuacaototal')
        ) {
          continue
        }

        if (!rawA || !rawB) continue

        // Placar Final: Tolerant to "1x2 (Carbonero...)", "1x2", "1 x 2", "1-2"
        let placarA: number | undefined
        let placarB: number | undefined
        let finalizado = false
        let autoresDoJogoParenteses: string[] = []

        if (
          colPlacarFinal !== -1 &&
          row[colPlacarFinal] !== '' &&
          row[colPlacarFinal] !== null &&
          row[colPlacarFinal] !== undefined
        ) {
          const rawPF = row[colPlacarFinal]
          const parsed = extractPureScoreString(rawPF) || parseScoreString(rawPF)
          if (parsed) {
            placarA = parsed.placarA
            placarB = parsed.placarB
            finalizado = true
          }
          autoresDoJogoParenteses = extractScorersFromParentheses(rawPF)
        } else if (colPlacarA !== -1 && colPlacarB !== -1) {
          const valA = row[colPlacarA]
          const valB = row[colPlacarB]
          if (valA !== '' && valB !== '' && !isNaN(Number(valA)) && !isNaN(Number(valB))) {
            placarA = parseInt(String(valA), 10)
            placarB = parseInt(String(valB), 10)
            finalizado = true
          }
        }

        // Data / Hora
        let dataStr: string | undefined
        let horaStr: string | undefined
        if (colData !== -1 && row[colData]) {
          const dt = parseDateTimeCell(row[colData])
          dataStr = dt.data
          if (dt.hora) horaStr = dt.hora
        }
        if (colHora !== -1 && row[colHora]) {
          const ht = parseDateTimeCell(row[colHora])
          if (ht.hora) horaStr = ht.hora
          else {
            const hStr = String(row[colHora]).trim()
            if (hStr) horaStr = hStr
          }
        }

        // Check if Placar Final column contains date info for pending games (e.g. "01/11 -", "08/11 -")
        if (!dataStr && colPlacarFinal !== -1 && row[colPlacarFinal]) {
          const rawPF = String(row[colPlacarFinal]).trim()
          if (/\d{1,2}\/\d{1,2}/.test(rawPF)) {
            const dtFromPF = parseDateTimeCell(rawPF)
            if (dtFromPF.data) dataStr = dtFromPF.data
            if (dtFromPF.hora) horaStr = dtFromPF.hora
          }
        }

        const competicao =
          colCompeticao !== -1 && row[colCompeticao] ? String(row[colCompeticao]).trim() : undefined

        const rodada =
          colRodada !== -1 && row[colRodada] ? String(row[colRodada]).trim() : undefined

        // Real scorers
        let golsTimeA = colGolsA !== -1 ? parseScorersString(row[colGolsA]) : []
        let golsTimeB = colGolsB !== -1 ? parseScorersString(row[colGolsB]) : []
        if (
          golsTimeA.length === 0 &&
          golsTimeB.length === 0 &&
          autoresDoJogoParenteses.length > 0
        ) {
          // Se não há colunas separadas de gols, adiciona autores extraídos dos parênteses do placar
          golsTimeA = autoresDoJogoParenteses.map((nome) => ({
            nome,
            posicao: 'Atacante/Meia',
            quantidade: 1,
          }))
        }

        // Predictions for this row
        const palpites: ParsedPrediction[] = []

        // Case A: The sheet is a participant sheet (activeSheetParticipant is set)
        if (activeSheetParticipant && colPalpite !== -1) {
          const predCell = row[colPalpite]
          if (predCell !== '' && predCell !== null && predCell !== undefined) {
            const parsedPred = extractPureScoreString(predCell) || parseScoreString(predCell)
            if (parsedPred) {
              const predScorers = extractScorersFromParentheses(predCell)
              let pts: number | undefined
              if (
                colPontuacao !== -1 &&
                row[colPontuacao] !== '' &&
                row[colPontuacao] !== null &&
                row[colPontuacao] !== undefined
              ) {
                const numPts = parseFloat(String(row[colPontuacao]).replace(',', '.'))
                if (!isNaN(numPts)) pts = numPts
              }

              let detList: string[] | undefined
              if (
                colDetalhamento !== -1 &&
                row[colDetalhamento] !== '' &&
                row[colDetalhamento] !== null &&
                row[colDetalhamento] !== undefined
              ) {
                const detStr = String(row[colDetalhamento]).trim()
                if (detStr) {
                  detList = detStr
                    .split(/[\n;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                }
              }

              // Se placar palpitado == placar final, garantir 'Placar Exato (+8 pts)' no detalhamento
              const isExactScore =
                placarA !== undefined &&
                placarB !== undefined &&
                parsedPred.placarA === placarA &&
                parsedPred.placarB === placarB

              if (isExactScore) {
                if (!detList) detList = []
                const hasExact = detList.some((d) => /placar\s*exato/i.test(d))
                if (!hasExact) {
                  detList.unshift('Placar Exato (+8 pts)')
                }
              }

              palpites.push({
                participanteNome: activeSheetParticipant,
                placar_a: parsedPred.placarA,
                placar_b: parsedPred.placarB,
                goleadores_a: predScorers,
                pontos: pts,
                detalhamento: detList,
              })
            }
          }
        }

        // Case B: Sheet has member columns (Douglas, Gabriel, Bruno, Davi)
        for (const [member, info] of memberCols.entries()) {
          const predCell = row[info.colPred]
          if (predCell === '' || predCell === null || predCell === undefined) continue

          const parsedPred = extractPureScoreString(predCell) || parseScoreString(predCell)
          if (parsedPred) {
            const predScorers = extractScorersFromParentheses(predCell)
            let pts: number | undefined
            if (info.colPts !== undefined && row[info.colPts] !== '' && row[info.colPts] !== null) {
              const numPts = parseFloat(String(row[info.colPts]).replace(',', '.'))
              if (!isNaN(numPts)) pts = numPts
            }

            let detList: string[] | undefined
            const isExactScore =
              placarA !== undefined &&
              placarB !== undefined &&
              parsedPred.placarA === placarA &&
              parsedPred.placarB === placarB

            if (isExactScore) {
              detList = ['Placar Exato (+8 pts)']
            }

            palpites.push({
              participanteNome: member,
              placar_a: parsedPred.placarA,
              placar_b: parsedPred.placarB,
              goleadores_a: predScorers,
              pontos: pts,
              detalhamento: detList,
            })
          }
        }

        // Match unification across participant tabs
        const matchKey = `${cleanKey(rawA)}_x_${cleanKey(rawB)}`
        const existingGame = gamesByConfronto.get(matchKey)

        if (existingGame) {
          // Update real score if not present
          if (!existingGame.finalizado && finalizado) {
            existingGame.placar_a = placarA
            existingGame.placar_b = placarB
            existingGame.finalizado = true
          }
          if (
            golsTimeA.length > 0 &&
            (!existingGame.gols_time_a || existingGame.gols_time_a.length === 0)
          ) {
            existingGame.gols_time_a = golsTimeA
          }
          if (
            golsTimeB.length > 0 &&
            (!existingGame.gols_time_b || existingGame.gols_time_b.length === 0)
          ) {
            existingGame.gols_time_b = golsTimeB
          }
          if (competicao && !existingGame.competicao) existingGame.competicao = competicao
          if (dataStr && !existingGame.data) existingGame.data = dataStr
          if (horaStr && !existingGame.hora) existingGame.hora = horaStr
          if (rodada && !existingGame.rodada) existingGame.rodada = rodada

          // Merge predictions
          for (const p of palpites) {
            const pIdx = existingGame.palpites?.findIndex(
              (ep) => cleanKey(ep.participanteNome) === cleanKey(p.participanteNome),
            )
            if (pIdx !== undefined && pIdx >= 0) {
              // Update existing prediction with more detailed data
              existingGame.palpites![pIdx] = {
                ...existingGame.palpites![pIdx],
                ...p,
              }
            } else {
              existingGame.palpites = existingGame.palpites || []
              existingGame.palpites.push(p)
            }
          }
        } else {
          gamesByConfronto.set(matchKey, {
            time_a: rawA,
            time_b: rawB,
            competicao: competicao || '',
            placar_a: placarA,
            placar_b: placarB,
            data: dataStr || new Date().toISOString(),
            hora: horaStr || '16:00',
            rodada,
            finalizado,
            gols_time_a: golsTimeA,
            gols_time_b: golsTimeB,
            palpites,
          })
        }
      }
    }
  }

  const gamesList: ParsedGame[] = Array.from(gamesByConfronto.values())
  // 3. Fallback game search if gamesList is empty: search line-by-line for confrontation pattern
  if (gamesList.length === 0) {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: '' })
      if (!rows) continue

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] as any[]
        if (!row || row.length === 0) continue

        for (let c = 0; c < row.length; c++) {
          const cellStr = String(row[c] || '').trim()
          // Check for "Flamengo x Palmeiras" pattern
          const matchX = cellStr.match(
            /^([A-Za-zÀ-ÿ0-9\s.'-]+?)\s+(?:[xX]|vs\.?|-)\s+([A-Za-zÀ-ÿ0-9\s.'-]+)$/,
          )
          if (matchX && matchX[1].trim() && matchX[2].trim()) {
            const timeA = matchX[1].trim().replace(/\s+/g, ' ')
            const timeB = matchX[2].trim().replace(/\s+/g, ' ')

            const lowerFallback = `${timeA} ${timeB}`.toLowerCase()
            if (
              lowerFallback.includes('sorteio') ||
              lowerFallback.includes('pontuacao total') ||
              lowerFallback.includes('pontuação total') ||
              lowerFallback.includes('pontuacaototal') ||
              lowerFallback.includes('abertura') ||
              lowerFallback.includes('encerramento') ||
              lowerFallback.includes('premiacao') ||
              lowerFallback.includes('premiacão') ||
              lowerFallback.includes('cerimonia') ||
              lowerFallback.includes('cerimônia')
            ) {
              continue
            }

            // Skip if this is a subheader or total
            const cleanFA = cleanKey(timeA)
            const cleanFB = cleanKey(timeB)
            const fallbackHeaders = new Set([
              'total',
              'pontuacaototal',
              'mandante',
              'visitante',
              'time',
              'timea',
              'timeb',
              'time1',
              'time2',
              'equipe',
              'equipea',
              'equipeb',
              'selecao',
              'selecaoa',
              'selecaob',
              'confronto',
              'confrontos',
              'jogo',
              'jogos',
              'partida',
              'partidas',
            ])
            if (
              fallbackHeaders.has(cleanFA) ||
              cleanFA.includes('pontuacaototal') ||
              fallbackHeaders.has(cleanFB) ||
              cleanFB.includes('pontuacaototal')
            ) {
              continue
            }
            // Look for score in adjacent cells
            let placarA: number | undefined
            let placarB: number | undefined
            let finalizado = false

            for (let nc = c + 1; nc < Math.min(row.length, c + 4); nc++) {
              const parsed = parseScoreString(row[nc])
              if (parsed) {
                placarA = parsed.placarA
                placarB = parsed.placarB
                finalizado = true
                break
              }
            }

            gamesList.push({
              time_a: timeA,
              time_b: timeB,
              competicao: '',
              placar_a: placarA,
              placar_b: placarB,
              data: new Date().toISOString(),
              hora: '16:00',
              finalizado,
              palpites: [],
            })
            break
          }
        }
      }
    }
  }

  // Convert scoresMap to list
  const scores: ParsedParticipantScore[] = []
  for (const [nome, pontuacao] of scoresMap.entries()) {
    scores.push({ nome, pontuacao })
  }

  if (scores.length === 0) {
    avisos.push(
      'Nenhuma pontuação acumulada de participante pôde ser identificada na aba de ranking. Verifique os cabeçalhos ou dados do arquivo.',
    )
  }

  return { scores, games: gamesList, avisos }
}

/**
 * Executes a clean Reset/Clear of previous data for this specific bolão:
 * 1. Deletes all previous palpites of this bolão.
 * 2. Deletes all previous games of this bolão.
 * 3. Resets pontos_importados and pontuacao_total to 0 for all participants of this bolão.
 */
export async function resetBolaoData(bolaoId: string): Promise<{
  palpitesDeletados: number
  jogosDeletados: number
}> {
  // 1. Delete all palpites belonging to this bolão
  const palpites = await pb.collection('palpites').getFullList({
    filter: `bolao = '${bolaoId}'`,
  })
  let palpitesDeletados = 0
  for (const p of palpites) {
    try {
      await pb.collection('palpites').delete(p.id)
      palpitesDeletados++
    } catch {
      /* ignore deletion errors */
    }
  }

  // 2. Delete all jogos belonging to this bolão
  const jogos = await pb.collection('jogos').getFullList({
    filter: `bolao = '${bolaoId}'`,
  })
  let jogosDeletados = 0
  for (const j of jogos) {
    try {
      await pb.collection('jogos').delete(j.id)
      jogosDeletados++
    } catch {
      /* ignore deletion errors */
    }
  }

  // 3. Reset participants' imported and total points to 0
  const participantes = await pb.collection('participantes').getFullList({
    filter: `bolao = '${bolaoId}'`,
  })
  for (const part of participantes) {
    try {
      await pb.collection('participantes').update(part.id, {
        pontos_importados: 0,
        pontuacao_total: 0,
      })
    } catch {
      /* ignore update errors */
    }
  }

  return { palpitesDeletados, jogosDeletados }
}

/**
 * Imports parsed spreadsheet data with complete Reset/Clear:
 * - Resets old palpites and games for this pool
 * - Inserts all historical games with their real scores and goals
 * - Inserts individual predictions for each participant (Douglas, Gabriel, Bruno, Davi)
 * - Updates participants with the cumulative points from the file (pontos_importados)
 */
export async function importBolaoSpreadsheet(
  bolaoId: string,
  scores: ParsedParticipantScore[],
  games: ParsedGame[] = [],
): Promise<ImportResult> {
  const avisos: string[] = []
  let participantesAtualizados = 0
  let jogosProcessados = 0
  let palpitesProcessados = 0
  const participantesNomes: string[] = []

  // 1. Mandatory RESET/CLEAR of previous data for this specific pool
  await resetBolaoData(bolaoId)

  // 2. Fetch or create participants for this pool (ensure Douglas, Gabriel, Bruno, Davi exist)
  let existingParts = await pb.collection('participantes').getFullList<any>({
    filter: `bolao = '${bolaoId}'`,
  })

  for (const member of BOLAO_MEMBERS) {
    const found = existingParts.find((p) => cleanKey(p.nome) === cleanKey(member))
    if (!found) {
      try {
        const created = await pb.collection('participantes').create({
          bolao: bolaoId,
          nome: member,
          pontos_importados: 0,
          pontuacao_total: 0,
        })
        existingParts.push(created as any)
      } catch {
        /* ignore */
      }
    }
  }

  // Also create any additional participant mentioned in scores
  for (const sc of scores) {
    const matched = existingParts.find((p) => cleanKey(p.nome) === cleanKey(sc.nome))
    if (!matched) {
      try {
        const created = await pb.collection('participantes').create({
          bolao: bolaoId,
          nome: sc.nome,
          pontos_importados: 0,
          pontuacao_total: 0,
        })
        existingParts.push(created as any)
      } catch {
        /* ignore */
      }
    }
  }

  // Reload participants to have accurate IDs
  existingParts = await pb.collection('participantes').getFullList<any>({
    filter: `bolao = '${bolaoId}'`,
  })

  // 3. Create all games and their individual participant predictions
  for (const gameData of games) {
    try {
      const isFinalizado =
        gameData.finalizado ||
        (gameData.placar_a !== undefined &&
          gameData.placar_a !== null &&
          gameData.placar_b !== undefined &&
          gameData.placar_b !== null)

      const placarA =
        isFinalizado && gameData.placar_a !== undefined ? Number(gameData.placar_a) : null
      const placarB =
        isFinalizado && gameData.placar_b !== undefined ? Number(gameData.placar_b) : null

      const createdGame = await pb.collection('jogos').create({
        bolao: bolaoId,
        time_a: gameData.time_a,
        time_b: gameData.time_b,
        competicao: gameData.competicao || '',
        data: gameData.data || new Date().toISOString(),
        hora: gameData.hora || '16:00',
        placar_a: placarA,
        placar_b: placarB,
        resultado_finalizado: isFinalizado,
        tem_penaltis: false,
        vencedor_penaltis: '',
        gols_time_a: gameData.gols_time_a || [],
        gols_time_b: gameData.gols_time_b || [],
      })
      jogosProcessados++

      // Create individual participant predictions if present
      if (Array.isArray(gameData.palpites) && gameData.palpites.length > 0) {
        for (const pred of gameData.palpites) {
          const matchedPart = existingParts.find(
            (p) => cleanKey(p.nome) === cleanKey(pred.participanteNome),
          )
          if (!matchedPart) continue

          let pontuacaoJogo = pred.pontos !== undefined ? pred.pontos : 0
          let detalhamento: string[] = []

          if (Array.isArray(pred.detalhamento) && pred.detalhamento.length > 0) {
            detalhamento = pred.detalhamento
          } else if (
            isFinalizado &&
            placarA !== null &&
            placarB !== null &&
            pred.pontos === undefined
          ) {
            // If final match score exists and points not explicitly provided in sheet, calculate score
            const calc = calculateMatchScore(
              pred.placar_a,
              pred.placar_b,
              placarA,
              placarB,
              pred.goleadores_a || [],
              pred.goleadores_b || [],
              gameData.gols_time_a || [],
              gameData.gols_time_b || [],
            )
            pontuacaoJogo = calc.pontos
            detalhamento = calc.detalhamento
          } else if (pred.pontos !== undefined) {
            detalhamento = [`Pontos do arquivo: ${pred.pontos} pts`]
          }

          try {
            await pb.collection('palpites').create({
              bolao: bolaoId,
              jogo: createdGame.id,
              participante: matchedPart.id,
              placar_a: pred.placar_a,
              placar_b: pred.placar_b,
              goleadores_a: pred.goleadores_a || [],
              goleadores_b: pred.goleadores_b || [],
              vencedor_penaltis: 'N',
              pontuacao_jogo: pontuacaoJogo,
              detalhamento,
            })
            palpitesProcessados++
          } catch (palpiteErr: any) {
            console.error('Erro ao gravar palpite individual:', palpiteErr)
          }
        }
      }
    } catch (gameErr: any) {
      avisos.push(`Erro ao criar jogo ${gameData.time_a} x ${gameData.time_b}: ${gameErr.message}`)
    }
  }

  // 4. Update participants' pontos_importados from the spreadsheet totals
  // Fetch freshly created palpites of this bolao to compute dynamic live points
  const currentPalpites = await pb.collection('palpites').getFullList<any>({
    filter: `bolao = '${bolaoId}'`,
  })

  // If the spreadsheet had cumulative ranking totals, store them in pontos_importados.
  // If no scores tab was found but matches had points, derive or set accordingly.
  for (const part of existingParts) {
    const scoreItem = scores.find((s) => cleanKey(s.nome) === cleanKey(part.nome))
    let importedPts = 0

    if (scoreItem) {
      importedPts = Number(scoreItem.pontuacao) || 0
    } else if (scores.length === 0) {
      // If file only had match results with predictions and no totals tab,
      // sum up predictions points as the base
      const sumBets = currentPalpites
        .filter((p) => p.participante === part.id)
        .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)
      importedPts = sumBets
    }

    // Dynamic sum: if importedPts comes from the total ranking tab, set pontos_importados = importedPts.
    // If games were also created, avoid double counting:
    // If the file explicitly gave a total ranking, pontos_importados takes that total.
    // To ensure the leaderboard reflects the exact total from the file:
    const betsTotal = currentPalpites
      .filter((p) => p.participante === part.id)
      .reduce((acc, p) => acc + (Number(p.pontuacao_jogo) || 0), 0)

    // Prevent double counting of participant points:
    // The dashboard and ranking display calculates: pontuacao_total = pontos_importados + sum(palpites de jogos finalizados).
    // If betsTotal is present (e.g. 62 for Gabriel), and importedPts is also 62 (from the "Pontuação Total" line or Tabela tab),
    // setting pontos_importados to 62 would make 62 + 62 = 124 (double counting).
    // We must guarantee that:
    // 1. If betsTotal > 0, the sum of bets already covers the match points. Any excess (e.g. bonuses outside the match list) goes into pontos_importados = max(0, importedPts - betsTotal).
    // 2. If importedPts is exactly equal to betsTotal, pontos_importados becomes 0, so pontuacao_total = betsTotal (e.g. 62).
    // 3. In all cases, pontuacao_total stored is exactly importedPts (if importedPts was specified) OR betsTotal (if no total was given).
    const finalTotalTarget = importedPts > 0 ? importedPts : betsTotal
    const adjustedImportedPts = Math.max(0, finalTotalTarget - betsTotal)

    try {
      await pb.collection('participantes').update(part.id, {
        pontos_importados: adjustedImportedPts,
        pontuacao_total: finalTotalTarget,
      })
      participantesAtualizados++
      participantesNomes.push(`${part.nome}: ${finalTotalTarget} pts`)
    } catch (partErr: any) {
      avisos.push(`Erro ao atualizar participante ${part.nome}: ${partErr.message}`)
    }
  }

  // 5. Update bolão's ultima_atualizacao
  try {
    await pb.collection('boloes').update(bolaoId, {
      ultima_atualizacao: new Date().toISOString(),
    })
  } catch {
    /* ignore */
  }

  return {
    participantesAtualizados,
    jogosProcessados,
    palpitesProcessados,
    participantesNomes,
    avisos,
  }
}
