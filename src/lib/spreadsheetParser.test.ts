import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseScoreString, calculateMatchScore, parseSpreadsheet } from './spreadsheetParser'

describe('parseScoreString', () => {
  it('handles standard score patterns "1x2", "1 x 2", "1-2", "0x0", "1x0", "3x1", "2 x 2"', () => {
    expect(parseScoreString('0x0')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString('1x0')).toEqual({ placarA: 1, placarB: 0 })
    expect(parseScoreString('3x1')).toEqual({ placarA: 3, placarB: 1 })
    expect(parseScoreString('2 x 2')).toEqual({ placarA: 2, placarB: 2 })
    expect(parseScoreString('1x2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1 x 2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1-2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0 x 0')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString('3:1')).toEqual({ placarA: 3, placarB: 1 })
    expect(parseScoreString('2 a 1')).toEqual({ placarA: 2, placarB: 1 })
  })

  it('handles score with additional text e.g. "1x2 (Carbonero...)" and "0x0 (pênaltis 4x2)"', () => {
    expect(parseScoreString('1x2 (Carbonero...)')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0x0 (pênaltis 4x2)')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString("2 x 1 (Gol aos 90')")).toEqual({ placarA: 2, placarB: 1 })
    expect(parseScoreString('3-0 - W.O.')).toEqual({ placarA: 3, placarB: 0 })
    expect(parseScoreString('1x0 (Pavón)')).toEqual({ placarA: 1, placarB: 0 })
    expect(parseScoreString('3x0 (Maurício, Jhon Arias e Flaco López)')).toEqual({
      placarA: 3,
      placarB: 0,
    })
  })

  it('returns null for empty or invalid values', () => {
    expect(parseScoreString('')).toBeNull()
    expect(parseScoreString(null)).toBeNull()
    expect(parseScoreString(undefined)).toBeNull()
    expect(parseScoreString('Pendente')).toBeNull()
    expect(parseScoreString('-')).toBeNull()
  })

  it('treats date indicators in Placar Final column like "01/11 -" and "08/11 -" as null score (Pendente com data)', () => {
    expect(parseScoreString('01/11 -')).toBeNull()
    expect(parseScoreString('08/11 -')).toBeNull()
    expect(parseScoreString('01/11/2024')).toBeNull()
    expect(parseScoreString('01/11')).toBeNull()
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

  it('validates exact 24 Encerrados + 4 Pendentes = 28 partidas across multiple participant sheets without duplication', async () => {
    // Replicating multiple tabs: Douglas, Gabriel, Bruno, Davi
    const confrontationRows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação', 'Detalhamento da Pontuação'],
      ['Vasco x Fluminense', '0x0', '1x1', '2', 'Empate'],
      ['Atlético-MG x Juventude', '0x0', '2x0', '0', '-'],
      ['Santos x Remo', '0x0', '3x1', '0', '-'],
      ['Palmeiras x Fortaleza', '3x0 (Maurício, Jhon Arias e Flaco López)', '2x0', '2', 'Vencedor'],
      ['Mirassol x Grêmio', '1x1 (Bruno Santos; Amuzu)', '1x1', '8', 'Placar Exato'],
      ['Chapecoense x Cruzeiro', '0x0', '0x0', '8', 'Placar Exato'],
      ['Internacional x Corinthians', '2x0 (Matheus Bahia e Alan Patrick)', '2x1', '2', 'Vencedor'],
      ['Athletico x Vitória', '2x0 (João Cruz e Dudu)', '1x0', '2', 'Vencedor'],
      ['Juventude x Atlético-MG', '0x1 (Alan Minda)', '0x2', '2', 'Vencedor'],
      ['Remo x Santos', '0x1 (Rony)', '1x2', '2', 'Vencedor'],
      ['Cruzeiro x Chapecoense', '2x0 (Matheus Henrique e Kaio Jorge)', '3x0', '2', 'Vencedor'],
      ['Grêmio x Mirassol', '1x0 (Pavón)', '2x0', '2', 'Vencedor'],
      ['Fluminense x Vasco', '1x3 (Martinelli; Brenner 2x e Puma Rodriguez)', '1x1', '0', '-'],
      [
        'Fortaleza x Palmeiras',
        '3x2 (Miritello, Rodriguinho e Lucas Emanoel; Flaco López e Murilo)',
        '1x2',
        '0',
        '-',
      ],
      ['Vitória x Athletico', '4x0 (Renê 2x, Erick e Marinho)', '0x2', '0', '-'],
      [
        'Corinthians x Internacional',
        '2x1 (Gustavo Henrique e Pedro Raul; Bernabei)',
        '1x0',
        '2',
        'Vencedor',
      ],
      [
        'Sorteio das Quartas de Final',
        'Grêmio x Internacional; Cruzeiro x Atlético-MG; Vasco x Vitória; Palmeiras x Santos',
        '-',
        '0',
        '-',
      ],
      ['Cruzeiro x Atlético-MG', '1x1 (Arroyo; Renan Lodi)', '2x2', '2', 'Empate'],
      ['Palmeiras x Santos', '3x0 (Flaco Lopez 2x e Andreas Pereira)', '2x0', '3', 'Vencedor'],
      ['Vasco x Vitória', '1x0 (Andrés Gómez)', '2x1', '2', 'Vencedor'],
      ['Internacional x Grêmio', '0x0', '1x1', '2', 'Empate'],
      ['Atlético-MG x Cruzeiro', '2x1 (Victor Hugo e Fred; Kaio Jorge)', '1x0', '2', 'Vencedor'],
      ['Santos x Palmeiras', '0x0', '0x0', '8', 'Placar Exato'],
      ['Vitória x Vasco', '0x2 (Andrés Gómez e Puma Rodriguez)', '1x2', '2', 'Vencedor'],
      [
        'Grêmio x Internacional',
        '3x1 (Carlos Vinicius 2x e Krovinović; Vitinho)',
        '2x0',
        '2',
        'Vencedor',
      ],
      ['Vasco x Palmeiras', '01/11 -', '-', '0', '-'],
      ['Grêmio x Atlético-MG', '01/11 -', '-', '0', '-'],
      ['Palmeiras x Vasco', '08/11 -', '-', '0', '-'],
      ['Atlético-MG x Grêmio', '08/11 -', '-', '0', '-'],
      ['Pontuação Total', '', '', '65', ''],
    ]

    const ranking = [
      ['Participante', 'Pontuação Total'],
      ['Davi', 81],
      ['Douglas', 65],
      ['Gabriel', 62],
      ['Bruno', 12],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ranking), 'Classificação')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(confrontationRows), 'Douglas')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(confrontationRows), 'Gabriel')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(confrontationRows), 'Bruno')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(confrontationRows), 'Davi')

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'Bolao_do_Grupo_Copa_Genilton.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)

    const finalizados = result.games.filter((g) => g.finalizado)
    const pendentes = result.games.filter((g) => !g.finalizado)

    expect(finalizados.length).toBe(24)
    expect(pendentes.length).toBe(4)
    expect(result.games.length).toBe(28)

    // Check specific dry score matches that were previously at risk of being lost
    const vascoFlu = result.games.find((g) => g.time_a === 'Vasco' && g.time_b === 'Fluminense')
    expect(vascoFlu?.finalizado).toBe(true)
    expect(vascoFlu?.placar_a).toBe(0)
    expect(vascoFlu?.placar_b).toBe(0)

    const atleticoJuv = result.games.find(
      (g) => g.time_a === 'Atlético-MG' && g.time_b === 'Juventude',
    )
    expect(atleticoJuv?.finalizado).toBe(true)
    expect(atleticoJuv?.placar_a).toBe(0)
    expect(atleticoJuv?.placar_b).toBe(0)

    const santosRemo = result.games.find((g) => g.time_a === 'Santos' && g.time_b === 'Remo')
    expect(santosRemo?.finalizado).toBe(true)
    expect(santosRemo?.placar_a).toBe(0)
    expect(santosRemo?.placar_b).toBe(0)

    const gremioMirassol = result.games.find(
      (g) => g.time_a === 'Grêmio' && g.time_b === 'Mirassol',
    )
    expect(gremioMirassol?.finalizado).toBe(true)
    expect(gremioMirassol?.placar_a).toBe(1)
    expect(gremioMirassol?.placar_b).toBe(0)

    // Sorteio must never be registered
    const sorteio = result.games.some(
      (g) =>
        g.time_a.toLowerCase().includes('sorteio') || g.time_b.toLowerCase().includes('sorteio'),
    )
    expect(sorteio).toBe(false)
  })

  it('correctly handles Atlético-MG in team names without splitting Atlético and MG into separate teams', async () => {
    const rows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação', 'Detalhamento da Pontuação'],
      ['Atlético-MG x Juventude', '0x0', '-', '0', '-'],
      ['Juventude x Atlético-MG', '0x1', '-', '0', '-'],
      ['Grêmio x Atlético-MG', '01/11 -', '-', '0', '-'],
      ['Atlético-MG x Grêmio', '08/11 -', '-', '0', '-'],
      ['Pontuação Total', '', '', '0', ''],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'TestSheet')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'test-atletico.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)
    expect(result.games.length).toBe(4)

    const game1 = result.games.find((g) => g.time_a === 'Atlético-MG' && g.time_b === 'Juventude')
    expect(game1).toBeDefined()
    expect(game1?.finalizado).toBe(true)
    expect(game1?.placar_a).toBe(0)
    expect(game1?.placar_b).toBe(0)

    const game2 = result.games.find((g) => g.time_a === 'Juventude' && g.time_b === 'Atlético-MG')
    expect(game2).toBeDefined()
    expect(game2?.finalizado).toBe(true)
    expect(game2?.placar_a).toBe(0)
    expect(game2?.placar_b).toBe(1)

    const game3 = result.games.find((g) => g.time_a === 'Grêmio' && g.time_b === 'Atlético-MG')
    expect(game3).toBeDefined()
    expect(game3?.finalizado).toBe(false)

    const game4 = result.games.find((g) => g.time_a === 'Atlético-MG' && g.time_b === 'Grêmio')
    expect(game4).toBeDefined()
    expect(game4?.finalizado).toBe(false)
  })

  it('extracts participant score from the "Pontuação Total" line in single-participant sheet when no ranking tab is present', async () => {
    const rows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação', 'Detalhamento da Pontuação'],
      ['Vasco x Fluminense', '0x0', '1x1', '2', 'Empate'],
      ['Pontuação Total', '', '', '2', ''],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Bruno')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'test-total-line.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)
    expect(result.scores.length).toBe(1)
    expect(result.scores[0].nome).toBe('Bruno')
    expect(result.scores[0].pontuacao).toBe(2)
  })
})
