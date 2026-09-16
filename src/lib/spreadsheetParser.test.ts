import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseScoreString, calculateMatchScore, parseSpreadsheet } from './spreadsheetParser'

describe('parseScoreString', () => {
  it('handles standard score patterns "1x2", "1 x 2", "1-2"', () => {
    expect(parseScoreString('1x2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1 x 2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1-2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0 x 0')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString('3:1')).toEqual({ placarA: 3, placarB: 1 })
  })

  it('handles score with additional text e.g. "1x2 (Carbonero...)"', () => {
    expect(parseScoreString('1x2 (Carbonero...)')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0x0 (pênaltis 4x2)')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString("2 x 1 (Gol aos 90')")).toEqual({ placarA: 2, placarB: 1 })
    expect(parseScoreString('3-0 - W.O.')).toEqual({ placarA: 3, placarB: 0 })
  })

  it('returns null for empty or invalid values', () => {
    expect(parseScoreString('')).toBeNull()
    expect(parseScoreString(null)).toBeNull()
    expect(parseScoreString(undefined)).toBeNull()
    expect(parseScoreString('Pendente')).toBeNull()
    expect(parseScoreString('-')).toBeNull()
  })

  it('treats date indicators in Placar Final column like "01/11 -" and "08/11 -" as null score', () => {
    expect(parseScoreString('01/11 -')).toBeNull()
    expect(parseScoreString('08/11 -')).toBeNull()
    expect(parseScoreString('01/11/2024')).toBeNull()
  })
})

describe('calculateMatchScore', () => {
  it('scores exact match (+8 pts)', () => {
    const res = calculateMatchScore(2, 1, 2, 1)
    expect(res.pontos).toBe(8)
    expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
  })

  it('scores winner (+2 pts) and goal difference (+1 pt)', () => {
    const res = calculateMatchScore(3, 1, 2, 0)
    expect(res.pontos).toBe(3) // 2 (vencedor) + 1 (diferença)
  })

  it('scores draw (+2 pts) and goal difference (+1 pt)', () => {
    const res = calculateMatchScore(1, 1, 2, 2)
    expect(res.pontos).toBe(3) // 2 (empate) + 1 (diferença)
  })

  it('scores half score (+1 pt)', () => {
    const res = calculateMatchScore(1, 0, 1, 2)
    expect(res.pontos).toBe(1) // metade do placar
  })
})

describe('parseSpreadsheet with Copa Genilton structure', () => {
  it('correctly filters out Sorteio line and parses pending matches with dates', async () => {
    const rows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação', 'Detalhamento da Pontuação'],
      ['Vasco x Fluminense', '0x0', '-', '0', '-'],
      ['Atlético-MG x Juventude', '0x0', '-', '0', '-'],
      ['Santos x Remo', '0x0', '-', '0', '-'],
      ['Palmeiras x Fortaleza', '3x0 (Maurício, Jhon Arias e Flaco López)', '-', '0', '-'],
      ['Mirassol x Grêmio', '1x1 (Bruno Santos; Amuzu)', '-', '0', '-'],
      ['Chapecoense x Cruzeiro', '0x0', '-', '0', '-'],
      ['Internacional x Corinthians', '2x0 (Matheus Bahia e Alan Patrick)', '-', '0', '-'],
      ['Athletico x Vitória', '2x0 (João Cruz e Dudu)', '-', '0', '-'],
      ['Juventude x Atlético-MG', '0x1 (Alan Minda)', '-', '0', '-'],
      ['Remo x Santos', '0x1 (Rony)', '-', '0', '-'],
      ['Cruzeiro x Chapecoense', '2x0 (Matheus Henrique e Kaio Jorge)', '-', '0', '-'],
      ['Grêmio x Mirassol', '1x0 (Pavón)', '-', '0', '-'],
      [
        'Fluminense x Vasco',
        '1x3 (Martinelli; Brenner 2x e Puma Rodriguez)',
        '1x0 (John Kennedy)',
        '1',
        'Metade do Placar',
      ],
      [
        'Fortaleza x Palmeiras',
        '3x2 (Miritello, Rodriguinho e Lucas Emanoel; Flaco López e Murilo)',
        '1x2 (Miritello; Flaco López e Vitor Roque)',
        '2',
        'Metade do Placar e gol do Flaco López',
      ],
      ['Vitória x Athletico', '4x0 (Renê 2x, Erick e Marinho)', '0x2 (Viveros 2x)', '0', '-'],
      [
        'Corinthians x Internacional',
        '2x1 (Gustavo Henrique e Pedro Raul; Bernabei)',
        '1x1 (Pedro Raul; Alan Patrick)',
        '2',
        'Metade do Placar e gol do Pedro Raul',
      ],
      [
        'Sorteio das Quartas de Final',
        'Grêmio x Internacional; Cruzeiro x Atlético-MG; Vasco x Vitória; Palmeiras x Santos',
        '-',
        '0',
        '-',
      ],
      ['Cruzeiro x Atlético-MG', '1x1 (Arroyo; Renan Lodi)', '-', '0', '-'],
      [
        'Palmeiras x Santos',
        '3x0 (Flaco Lopez 2x e Andreas Pereira)',
        '2x0 (Vitor Roque e Flaco Lopez)',
        '4',
        'Vencedor, Metade do Placar e gol do Flaco Lopez',
      ],
      [
        'Vasco x Vitória',
        '1x0 (Andrés Gómez)',
        '2x1 (Spinelli e Colidio; Renato Kayzer)',
        '3',
        'Vencedor e Diferença de Gols',
      ],
      ['Internacional x Grêmio', '0x0', '-', '0', '-'],
      ['Atlético-MG x Cruzeiro', '2x1 (Victor Hugo e Fred; Kaio Jorge)', '-', '0', '-'],
      ['Santos x Palmeiras', '0x0', '-', '0', '-'],
      ['Vitória x Vasco', '0x2 (Andrés Gómez e Puma Rodriguez)', '-', '0', '-'],
      ['Grêmio x Internacional', '3x1 (Carlos Vinicius 2x e Krovinović; Vitinho)', '-', '0', '-'],
      ['Vasco x Palmeiras', '01/11 -', '-', '0', '-'],
      ['Grêmio x Atlético-MG', '01/11 -', '-', '0', '-'],
      ['Palmeiras x Vasco', '08/11 -', '-', '0', '-'],
      ['Atlético-MG x Grêmio', '08/11 -', '-', '0', '-'],
      ['Pontuação Total', '', '', '12', ''],
    ]

    const rankingRows = [
      ['Posição', 'Participante', 'Pontuação Total'],
      ['1º', 'Davi', 81],
      ['2º', 'Douglas', 65],
      ['3º', 'Gabriel', 62],
      ['4º', 'Bruno', 12],
    ]

    const wb = XLSX.utils.book_new()
    const wsTabela = XLSX.utils.aoa_to_sheet(rankingRows)
    XLSX.utils.book_append_sheet(wb, wsTabela, 'Tabela')

    const wsBruno = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, wsBruno, 'Bruno')

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'copa-genilton.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const parsed = await parseSpreadsheet(file)

    // Acceptance criteria from user:
    // 24 Jogos Encerrados (com placar real).
    // 4 Jogos Pendentes (para palpites futuros).
    // Total exato de 28 partidas cadastradas no bolão.
    expect(parsed.games.length).toBe(28)

    const finished = parsed.games.filter((g) => g.finalizado)
    const pending = parsed.games.filter((g) => !g.finalizado)

    expect(finished.length).toBe(24)
    expect(pending.length).toBe(4)

    // Verify Sorteio is NOT present
    const sorteioGame = parsed.games.find(
      (g) =>
        g.time_a.toLowerCase().includes('sorteio') || g.time_b.toLowerCase().includes('sorteio'),
    )
    expect(sorteioGame).toBeUndefined()

    // Verify pending games details
    const pendingConfrontos = pending.map((g) => `${g.time_a} x ${g.time_b}`)
    expect(pendingConfrontos).toEqual([
      'Vasco x Palmeiras',
      'Grêmio x Atlético-MG',
      'Palmeiras x Vasco',
      'Atlético-MG x Grêmio',
    ])

    for (const pg of pending) {
      expect(pg.finalizado).toBe(false)
      expect(pg.placar_a).toBeUndefined()
      expect(pg.placar_b).toBeUndefined()
      expect(pg.data).toBeDefined()
      // Date should have month 11 (November)
      expect(pg.data).toMatch(/2024-11-(?:01|08)/)
    }

    // Verify participant ranking was parsed
    expect(parsed.scores.length).toBe(4)
    expect(parsed.scores.find((s) => s.nome === 'Bruno')?.pontuacao).toBe(12)
    expect(parsed.scores.find((s) => s.nome === 'Davi')?.pontuacao).toBe(81)
  })
})
