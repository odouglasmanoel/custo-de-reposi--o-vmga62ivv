import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseScoreString,
  extractPureScoreString,
  extractScorersFromParentheses,
  calculateMatchScore,
  parseSpreadsheet,
} from './spreadsheetParser'

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

describe('extractPureScoreString e extractScorersFromParentheses', () => {
  it('extractPureScoreString corta tudo a partir do "(" e retorna o placar puro', () => {
    expect(extractPureScoreString('3x0 (Samuel Lino 2x e Carrascal)')).toEqual({
      placarA: 3,
      placarB: 0,
    })
    expect(extractPureScoreString('3x0 (Pedro, Samuel Lino e Léo Pereira)')).toEqual({
      placarA: 3,
      placarB: 0,
    })
    expect(extractPureScoreString('1x1')).toEqual({ placarA: 1, placarB: 1 })
    expect(extractPureScoreString('2x1')).toEqual({ placarA: 2, placarB: 1 })
    expect(extractPureScoreString('2 - 1')).toEqual({ placarA: 2, placarB: 1 })
    expect(extractPureScoreString('2:1')).toEqual({ placarA: 2, placarB: 1 })
    expect(extractPureScoreString('2 a 1')).toEqual({ placarA: 2, placarB: 1 })
    expect(extractPureScoreString('12/34')).toBeNull()
    expect(extractPureScoreString('01/11 -')).toBeNull()
    expect(extractPureScoreString('')).toBeNull()
    expect(extractPureScoreString(null)).toBeNull()
  })

  it('extractScorersFromParentheses extrai autores tratando multiplicadores', () => {
    expect(extractScorersFromParentheses('3x0 (Samuel Lino 2x e Carrascal)')).toEqual([
      'Samuel Lino',
      'Samuel Lino',
      'Carrascal',
    ])
    expect(extractScorersFromParentheses('3x0 (Pedro, Samuel Lino e Léo Pereira)')).toEqual([
      'Pedro',
      'Samuel Lino',
      'Léo Pereira',
    ])
    expect(extractScorersFromParentheses('1x1')).toEqual([])
    expect(extractScorersFromParentheses('2x1')).toEqual([])
    expect(extractScorersFromParentheses('3x1 (2x Haaland e De Bruyne)')).toEqual([
      'Haaland',
      'Haaland',
      'De Bruyne',
    ])
  })

  it('"3x0 (Samuel Lino 2x e Carrascal)" vs "3x0 (Pedro, Samuel Lino e Léo Pereira)" = cravada + marcadores corretos', () => {
    const rawPlacarReal = '3x0 (Samuel Lino 2x e Carrascal)'
    const rawPalpite = '3x0 (Pedro, Samuel Lino e Léo Pereira)'

    const realScore = extractPureScoreString(rawPlacarReal)!
    const predScore = extractPureScoreString(rawPalpite)!
    expect(realScore).toEqual({ placarA: 3, placarB: 0 })
    expect(predScore).toEqual({ placarA: 3, placarB: 0 })

    const realScorers = extractScorersFromParentheses(rawPlacarReal)
    const predScorers = extractScorersFromParentheses(rawPalpite)

    expect(realScorers).toEqual(['Samuel Lino', 'Samuel Lino', 'Carrascal'])
    expect(predScorers).toEqual(['Pedro', 'Samuel Lino', 'Léo Pereira'])

    const calc = calculateMatchScore(
      predScore.placarA,
      predScore.placarB,
      realScore.placarA,
      realScore.placarB,
      predScorers,
      [],
      realScorers.map((nome) => ({ nome, posicao: 'Atacante/Meia', quantidade: 1 })),
      [],
    )

    // Cravada exata (+8 pts) + 1 acerto de Samuel Lino (+1 pt) = 9 pts
    expect(calc.pontos).toBe(9)
    expect(calc.detalhamento).toContain('Placar Exato (+8 pts)')
    expect(calc.detalhamento.some((d) => d.includes('Samuel Lino'))).toBe(true)
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

  it('adds +2 bonus points when participant correctly predicts penalty shootout winner (5x4)', () => {
    // Game ended 1x1 in regular time, went to penalties: Team A won (5x4)
    // Participant predicted 1x1, with Team A passing on penalties ('A')
    const res = calculateMatchScore(
      1,
      1, // pred placar
      1,
      1, // real placar
      [],
      [], // pred scorers
      [],
      [], // real scorers
      true, // temPenaltis
      'A', // vencedorPenaltisReal (e.g. 5 x 4)
      'A', // predVencedorPenaltis
    )
    // 8 (placar exato) + 2 (bônus vencedor pênaltis) = 10 pts
    expect(res.pontos).toBe(10)
    expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
    expect(res.detalhamento).toContain('Vencedor nos Pênaltis (+2 pts)')
  })

  it('does NOT add +2 bonus points when participant misses penalty shootout winner', () => {
    // Game ended 1x1, penalties won by Team A ('A')
    // Participant predicted 1x1, but chose Team B on penalties ('B')
    const res = calculateMatchScore(1, 1, 1, 1, [], [], [], [], true, 'A', 'B')
    // 8 (placar exato), sem bônus de pênaltis
    expect(res.pontos).toBe(8)
    expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
    expect(res.detalhamento).not.toContain('Vencedor nos Pênaltis (+2 pts)')
  })

  it('keeps score unchanged when match does not have penalties (temPenaltis = false)', () => {
    // Normal game 2x1, no penalties
    const res = calculateMatchScore(2, 1, 2, 1, [], [], [], [], false, '', 'N')
    expect(res.pontos).toBe(8)
    expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
    expect(res.detalhamento).not.toContain('Vencedor nos Pênaltis (+2 pts)')
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

  it('correctly extracts "Competição" column into parsed games and tolerates missing column', async () => {
    // Sheet with Competição column (e.g. Copa Coni spreadsheet)
    const rowsWithCompeticao = [
      ['Jogos', 'Competição', 'Placar Final', 'Palpites', 'Pontuação'],
      ['Real Madrid x Barcelona', 'La Liga - 11ª rodada', '0x4', '1x2', '2'],
      ['Liverpool x Manchester City', 'Premier League', '2x0', '2x1', '2'],
      ['Bayern x Dortmund', 'Bundesliga - Clássico', '1x1', '0x0', '2'],
    ]

    const wb1 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb1, XLSX.utils.aoa_to_sheet(rowsWithCompeticao), 'Douglas')
    const buf1 = XLSX.write(wb1, { type: 'array', bookType: 'xlsx' })
    const file1 = new File([buf1], 'copa-coni.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result1 = await parseSpreadsheet(file1)
    expect(result1.games.length).toBe(3)

    const game1 = result1.games.find((g) => g.time_a === 'Real Madrid' && g.time_b === 'Barcelona')
    expect(game1).toBeDefined()
    expect(game1?.competicao).toBe('La Liga - 11ª rodada')
    expect(game1?.finalizado).toBe(true)
    expect(game1?.placar_a).toBe(0)
    expect(game1?.placar_b).toBe(4)

    const game2 = result1.games.find(
      (g) => g.time_a === 'Liverpool' && g.time_b === 'Manchester City',
    )
    expect(game2?.competicao).toBe('Premier League')

    // Also test header variation "Torneio"
    const rowsWithTorneio = [
      ['Confronto', 'Torneio', 'Placar Final'],
      ['PSG x Chelsea', 'Champions League', '1x1'],
    ]
    const wb2 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(rowsWithTorneio), 'Jogos')
    const buf2 = XLSX.write(wb2, { type: 'array', bookType: 'xlsx' })
    const file2 = new File([buf2], 'copa-torneio.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result2 = await parseSpreadsheet(file2)
    expect(result2.games.length).toBe(1)
    expect(result2.games[0].competicao).toBe('Champions League')

    // Sheet WITHOUT Competição column (e.g. Copa Genilton) - should remain empty/undefined without breaking
    const rowsWithoutCompeticao = [
      ['Jogos', 'Placar Final', 'Palpites'],
      ['Flamengo x Palmeiras', '1x1', '0x0'],
    ]
    const wb3 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet(rowsWithoutCompeticao), 'Sheet1')
    const buf3 = XLSX.write(wb3, { type: 'array', bookType: 'xlsx' })
    const file3 = new File([buf3], 'sem-competicao.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result3 = await parseSpreadsheet(file3)
    expect(result3.games.length).toBe(1)
    expect(result3.games[0].competicao || '').toBe('')
  })

  it('correctly handles teams with letter x inside their name, such as México, without breaking the match split', async () => {
    const rows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação'],
      ['Tchéquia x México', '0x3', '1x2', '3'],
      ['México x África do Sul', '2x0', '2x0', '8'],
      ['Bélgica x México', '1x1', '0x0', '2'],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Douglas')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'copa-mundo-mexico.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)
    expect(result.games.length).toBe(3)

    const game1 = result.games.find((g) => g.time_a === 'Tchéquia' && g.time_b === 'México')
    expect(game1).toBeDefined()
    expect(game1?.placar_a).toBe(0)
    expect(game1?.placar_b).toBe(3)
    expect(game1?.finalizado).toBe(true)

    const game2 = result.games.find((g) => g.time_a === 'México' && g.time_b === 'África do Sul')
    expect(game2).toBeDefined()
    expect(game2?.placar_a).toBe(2)
    expect(game2?.placar_b).toBe(0)
    expect(game2?.finalizado).toBe(true)

    const game3 = result.games.find((g) => g.time_a === 'Bélgica' && g.time_b === 'México')
    expect(game3).toBeDefined()
    expect(game3?.placar_a).toBe(1)
    expect(game3?.placar_b).toBe(1)
    expect(game3?.finalizado).toBe(true)
  })

  it('preserves matches with extra spaces, special characters, and matches without goal scorers', async () => {
    const rows = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação'],
      ['  Brasil   x   Haiti  ', '3x0', '2x0', '3'],
      ['Turquia x Paraguai', '0x1', '1x1', '0'],
      ['Estados Unidos vs Jordânia', '2x0', '1x0', '2'],
      ['Costa do Marfim - Noruega', '1x2', '0x1', '2'],
      ['Curaçao x Alemanha', '0x0', '0x0', '8'],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Gabriel')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'copa-spaces.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)
    expect(result.games.length).toBe(5)

    const brasilHaiti = result.games.find((g) => g.time_a === 'Brasil' && g.time_b === 'Haiti')
    expect(brasilHaiti).toBeDefined()
    expect(brasilHaiti?.placar_a).toBe(3)
    expect(brasilHaiti?.placar_b).toBe(0)

    const euaJordania = result.games.find(
      (g) => g.time_a === 'Estados Unidos' && g.time_b === 'Jordânia',
    )
    expect(euaJordania).toBeDefined()
    expect(euaJordania?.placar_a).toBe(2)
    expect(euaJordania?.placar_b).toBe(0)

    const curacaoAlemanha = result.games.find(
      (g) => g.time_a === 'Curaçao' && g.time_b === 'Alemanha',
    )
    expect(curacaoAlemanha).toBeDefined()
    expect(curacaoAlemanha?.finalizado).toBe(true)
    expect(curacaoAlemanha?.placar_a).toBe(0)
    expect(curacaoAlemanha?.placar_b).toBe(0)
  })

  it('simulates 74 World Cup matches import and guarantees all 74 are detected without losing México matches', async () => {
    // Generate 74 matches like the World Cup pool
    const confrontationRows: any[][] = [
      ['Jogos', 'Placar Final', 'Palpites', 'Pontuação', 'Detalhamento da Pontuação'],
    ]

    for (let i = 1; i <= 70; i++) {
      confrontationRows.push([
        `Seleção ${i} x Seleção ${i + 1}`,
        `${i % 4}x${(i + 1) % 3}`,
        '-',
        '0',
        '-',
      ])
    }
    // Add specific matches with México, extra spaces, special chars, etc.
    confrontationRows.push([
      'Tchéquia x México',
      '0x3 (Quiñones 2x e Giménez)',
      '1x2',
      '3',
      'Vencedor',
    ])
    confrontationRows.push(['  México   x   África do Sul  ', '2x0', '2x0', '8', 'Placar Exato'])
    confrontationRows.push(['Bélgica x México', '1x1', '0x0', '2', 'Empate'])
    confrontationRows.push(['França x Inglaterra', '4x6', '2x0', '1', 'Gol do Mbappé'])
    // Administrative event line that should be ignored
    confrontationRows.push(['Pontuação Total', '', '', '14', ''])

    expect(confrontationRows.length).toBe(1 + 74 + 1) // header + 74 games + 1 total

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(confrontationRows), 'Davi')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'copa-do-mundo-74.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await parseSpreadsheet(file)
    expect(result.games.length).toBe(74)

    const tchequiaMexico = result.games.find(
      (g) => g.time_a === 'Tchéquia' && g.time_b === 'México',
    )
    expect(tchequiaMexico).toBeDefined()
    expect(tchequiaMexico?.placar_a).toBe(0)
    expect(tchequiaMexico?.placar_b).toBe(3)

    const mexicoAfrica = result.games.find(
      (g) => g.time_a === 'México' && g.time_b === 'África do Sul',
    )
    expect(mexicoAfrica).toBeDefined()
    expect(mexicoAfrica?.placar_a).toBe(2)
    expect(mexicoAfrica?.placar_b).toBe(0)
  })

  describe('calculateMatchScore com cálculo por frequência min(N, M)', () => {
    it('N=2, M=2 -> +2 pts (Atacante)', () => {
      const res = calculateMatchScore(
        2,
        0,
        2,
        0,
        ['Raphinha', 'Raphinha'],
        [],
        [{ nome: 'Raphinha', posicao: 'Atacante', quantidade: 2 }],
        [],
      )
      // Placar exato (8) + 2 marcadores (2) = 10 pts
      expect(res.pontos).toBe(10)
      expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
      expect(res.detalhamento.some((d) => d.includes('Raphinha ×2 [Atacante] (+2 pts)'))).toBe(true)
    })

    it('N=2, M=1 -> +1 pt (Atacante)', () => {
      const res = calculateMatchScore(
        2,
        0,
        2,
        0,
        ['Raphinha'],
        [],
        [{ nome: 'Raphinha', posicao: 'Atacante', quantidade: 2 }],
        [],
      )
      // Placar exato (8) + 1 marcador (1) = 9 pts
      expect(res.pontos).toBe(9)
      expect(res.detalhamento.some((d) => d.includes('Raphinha [Atacante] (+1 pt)'))).toBe(true)
    })

    it('N=1, M=2 -> +1 pt (Atacante)', () => {
      const res = calculateMatchScore(
        2,
        0,
        2,
        0,
        ['Raphinha', 'Raphinha'],
        [],
        [{ nome: 'Raphinha', posicao: 'Atacante', quantidade: 1 }],
        [],
      )
      expect(res.pontos).toBe(9)
      expect(res.detalhamento.some((d) => d.includes('Raphinha [Atacante] (+1 pt)'))).toBe(true)
    })

    it('Defensor N=2, M=2 -> +6 pts', () => {
      const res = calculateMatchScore(
        2,
        0,
        2,
        0,
        ['Gabriel Magalhães', 'Gabriel Magalhães'],
        [],
        [{ nome: 'Gabriel Magalhães', posicao: 'Defensor', quantidade: 2 }],
        [],
      )
      // 8 + min(2,2)*3 = 14
      expect(res.pontos).toBe(14)
      expect(
        res.detalhamento.some((d) => d.includes('Gabriel Magalhães ×2 [Defensor] (+6 pts)')),
      ).toBe(true)
    })
  })
})
