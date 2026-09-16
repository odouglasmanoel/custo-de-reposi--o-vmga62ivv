import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'
import { BOLAO_MEMBERS } from '@/context/AuthContext'

export interface ParsedParticipantScore {
  nome: string
  pontuacao: number
}

export interface ParsedGame {
  time_a: string
  time_b: string
  placar_a?: number
  placar_b?: number
  data?: string
  hora?: string
}

export interface ImportResult {
  participantesAtualizados: number
  jogosProcessados: number
  participantesNomes: string[]
  avisos: string[]
}

/**
 * Normalizes text removing accents, punctuation and trimming.
 */
function cleanKey(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Matches known participants (Douglas, Gabriel, Bruno, Davi) tolerance
 */
export function matchParticipantName(rawName: string): string {
  const clean = cleanKey(rawName)
  for (const known of BOLAO_MEMBERS) {
    if (
      cleanKey(known) === clean ||
      clean.includes(cleanKey(known)) ||
      cleanKey(known).includes(clean)
    ) {
      return known
    }
  }
  return rawName.trim()
}

/**
 * Parses an Excel or CSV file buffer and extracts participant cumulative scores and games if present.
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
  const gamesList: ParsedGame[] = []

  // Iterate over sheets
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: '' })
    if (!rows || rows.length === 0) continue

    // Scan rows to find participant ranking/scoring tables
    // Common column names: "Participante", "Nome", "Apostador", "Pontos", "Pontuação", "Total", "Pts", "Score"
    let headerRowIdx = -1
    let colNameIdx = -1
    let colScoreIdx = -1

    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const row = rows[r] as any[]
      if (!Array.isArray(row)) continue

      for (let c = 0; c < row.length; c++) {
        const cell = cleanKey(String(row[c] || ''))
        if (
          cell === 'participante' ||
          cell === 'participantes' ||
          cell === 'nome' ||
          cell === 'apostador'
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
        headerRowIdx = r
        break
      }
    }

    if (headerRowIdx !== -1 && colNameIdx !== -1 && colScoreIdx !== -1) {
      // We found a structured ranking table!
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[]
        if (!row || row.length === 0) continue
        const rawName = String(row[colNameIdx] || '').trim()
        if (!rawName) continue

        // Check if name is not a subheader
        const cleanN = cleanKey(rawName)
        if (cleanN === 'total' || cleanN === 'media' || cleanN === 'ranking') continue

        const matched = matchParticipantName(rawName)
        const rawScore = row[colScoreIdx]
        const scoreNum = parseFloat(String(rawScore).replace(',', '.')) || 0

        scoresMap.set(matched, scoreNum)
      }
    } else {
      // Fallback inspection: search for any cell matching our 4 known participants
      // e.g. Row where column A is "Gabriel" and column B or C has a number
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] as any[]
        if (!row) continue

        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim()
          for (const member of BOLAO_MEMBERS) {
            if (cleanKey(val) === cleanKey(member)) {
              // Find the next numeric cell in this row or row below
              let foundScore: number | null = null
              for (let nc = c + 1; nc < Math.min(row.length, c + 5); nc++) {
                const cellVal = String(row[nc] || '').trim()
                if (cellVal !== '' && !isNaN(Number(cellVal.replace(',', '.')))) {
                  foundScore = parseFloat(cellVal.replace(',', '.'))
                  break
                }
              }
              if (foundScore !== null && !scoresMap.has(member)) {
                scoresMap.set(member, foundScore)
              }
            }
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
      'Nenhuma pontuação de participante pôde ser identificada automaticamente no formato padrão. Verifique se o arquivo possui as colunas "Participante" e "Pontos/Total".',
    )
  }

  return { scores, games: gamesList, avisos }
}

/**
 * Imports parsed spreadsheet data directly into PocketBase for a specific bolão.
 * Preserves cumulative scores without position-based recalculation.
 * Idempotent: updates existing participants and pool timestamp.
 */
export async function importBolaoSpreadsheet(
  bolaoId: string,
  scores: ParsedParticipantScore[],
): Promise<ImportResult> {
  const avisos: string[] = []
  let participantesAtualizados = 0
  const participantesNomes: string[] = []

  // 1. Fetch current participants of this bolão
  const existingParts = await pb.collection('participantes').getFullList({
    filter: `bolao = '${bolaoId}'`,
  })

  // Ensure default 4 members exist if not present
  for (const member of BOLAO_MEMBERS) {
    const found = existingParts.find((p) => cleanKey(p.nome) === cleanKey(member))
    if (!found) {
      try {
        const created = await pb.collection('participantes').create({
          bolao: bolaoId,
          nome: member,
          pontuacao_total: 0,
        })
        existingParts.push(created as any)
      } catch {
        /* intentionally ignored */
      }
    }
  }

  // 2. Update each participant score according to the spreadsheet
  for (const item of scores) {
    const matched = existingParts.find((p) => cleanKey(p.nome) === cleanKey(item.nome))
    if (matched) {
      await pb.collection('participantes').update(matched.id, {
        pontuacao_total: item.pontuacao,
      })
      participantesAtualizados++
      participantesNomes.push(`${matched.nome}: ${item.pontuacao} pts`)
    } else {
      // Create new participant for this bolao
      try {
        await pb.collection('participantes').create({
          bolao: bolaoId,
          nome: item.nome,
          pontuacao_total: item.pontuacao,
        })
        participantesAtualizados++
        participantesNomes.push(`${item.nome} (Novo): ${item.pontuacao} pts`)
      } catch (err: any) {
        avisos.push(`Não foi possível cadastrar ${item.nome}: ${err.message}`)
      }
    }
  }

  // 3. Update bolão's ultima_atualizacao
  try {
    await pb.collection('boloes').update(bolaoId, {
      ultima_atualizacao: new Date().toISOString(),
    })
  } catch {
    /* intentionally ignored */
  }

  return {
    participantesAtualizados,
    jogosProcessados: 0,
    participantesNomes,
    avisos,
  }
}
