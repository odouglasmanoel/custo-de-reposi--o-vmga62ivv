import { describe, it, expect } from 'vitest'
import {
  calculateStatistics,
  isCravadaExata,
  isResultadoAcertado,
  getPontosGols,
  isQuaseCravada,
  countMarcadoresDefensoresAcertados,
  isGrandeJogo,
  normalizeMemberName,
} from './statsCalculator'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'

describe('statsCalculator', () => {
  it('normalizes member names correctly', () => {
    expect(normalizeMemberName('douglas')).toBe('Douglas')
    expect(normalizeMemberName('gabriel')).toBe('Gabriel')
    expect(normalizeMemberName('bruno')).toBe('Bruno')
    expect(normalizeMemberName('davi')).toBe('Davi')
  })

  it('detects exact match correctly (cravada)', () => {
    const jogo: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Brasil',
      time_b: 'Argentina',
      data: '2026-06-01',
      hora: '16:00',
      placar_a: 2,
      placar_b: 1,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteExato: Palpite = {
      id: 'p1',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'part1',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 8,
      detalhamento: ['Placar Exato (+8 pts)'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteDiferente: Palpite = {
      id: 'p2',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'part2',
      placar_a: 2,
      placar_b: 0,
      pontuacao_jogo: 2,
      detalhamento: ['Vencedor (+2 pts)'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    expect(isCravadaExata(palpiteExato, jogo)).toBe(true)
    expect(isCravadaExata(palpiteDiferente, jogo)).toBe(false)
  })

  it('detects outcome result (winner/draw) correctly', () => {
    const jogo: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Palmeiras',
      time_b: 'Corinthians',
      data: '2026-06-01',
      hora: '16:00',
      placar_a: 1,
      placar_b: 1,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteEmpate: Palpite = {
      id: 'p1',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'part1',
      placar_a: 0,
      placar_b: 0,
      pontuacao_jogo: 2,
      detalhamento: ['Empate (+2 pts)'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteVitoriaA: Palpite = {
      id: 'p2',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'part2',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 0,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    expect(isResultadoAcertado(palpiteEmpate, jogo)).toBe(true)
    expect(isResultadoAcertado(palpiteVitoriaA, jogo)).toBe(false)
  })

  it('extracts goal scorers points from detail list or scorers', () => {
    const jogo: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Santos',
      time_b: 'Remo',
      data: '2026-06-01',
      hora: '16:00',
      placar_a: 1,
      placar_b: 0,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteComGol: Palpite = {
      id: 'p1',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'part1',
      placar_a: 1,
      placar_b: 0,
      pontuacao_jogo: 9,
      detalhamento: ['Placar Exato (+8 pts)', 'Gols acertados: Kaio Jorge (+1 pt - Atacante/Meia)'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    expect(getPontosGols(palpiteComGol, jogo)).toBe(1)
  })

  it('calculates consolidated leaderboard and record holders correctly', () => {
    const boloes: Bolao[] = [
      {
        id: 'b1',
        nome: 'Copa Genilton',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const participantes: Participante[] = [
      {
        id: 'p_douglas',
        bolao: 'b1',
        nome: 'Douglas',
        pontos_importados: 10,
        pontuacao_total: 10,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_gabriel',
        bolao: 'b1',
        nome: 'Gabriel',
        pontos_importados: 5,
        pontuacao_total: 5,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_bruno',
        bolao: 'b1',
        nome: 'Bruno',
        pontos_importados: 2,
        pontuacao_total: 2,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_davi',
        bolao: 'b1',
        nome: 'Davi',
        pontos_importados: 8,
        pontuacao_total: 8,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const jogos: Jogo[] = [
      {
        id: 'j1',
        bolao: 'b1',
        time_a: 'Cruzeiro',
        time_b: 'Botafogo',
        data: '2026-06-01',
        hora: '16:00',
        placar_a: 1,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        competicao: 'Rodada 1',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const palpites: Palpite[] = [
      {
        id: 'palp_douglas',
        bolao: 'b1',
        jogo: 'j1',
        participante: 'p_douglas',
        placar_a: 1,
        placar_b: 0, // Cravada exata
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'palp_gabriel',
        bolao: 'b1',
        jogo: 'j1',
        participante: 'p_gabriel',
        placar_a: 2,
        placar_b: 0, // Vencedor
        pontuacao_jogo: 4,
        detalhamento: ['Vencedor (+2 pts)', 'Gols acertados: Atacante (+1 pt)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const stats = calculateStatistics({
      boloes,
      participantes,
      jogos,
      palpites,
      filtroBolaoId: 'todas',
    })

    expect(stats.tabela.length).toBe(4)

    // Douglas: 10 importados + 8 palpite = 18 pts, 1 cravada exata
    const douglas = stats.tabela.find((t) => t.nome === 'Douglas')
    expect(douglas?.totalPontos).toBe(18)
    expect(douglas?.cravadasExatas).toBe(1)
    expect(douglas?.resultadosAcertados).toBe(1)

    // Gabriel: 5 importados + 4 palpite = 9 pts, 1 resultado, 1 gol acertado
    const gabriel = stats.tabela.find((t) => t.nome === 'Gabriel')
    expect(gabriel?.totalPontos).toBe(9)
    expect(gabriel?.cravadasExatas).toBe(0)
    expect(gabriel?.resultadosAcertados).toBe(1)
    expect(gabriel?.golsAcertados).toBe(1)

    // Recordes
    expect(stats.recordes.reiDaCravada.participante).toBe('Douglas')
    expect(stats.recordes.reiDaCravada.valor).toBe(1)
    expect(stats.recordes.maiorPontuadorRodada.participante).toBe('Douglas')
    expect(stats.recordes.maiorPontuadorRodada.pontos).toBe(8)

    // Gabriel chutou 2x0 quando o jogo foi 1x0 -> errou a cravada por exatamente 1 gol (|2-1| + |0-0| = 1)
    expect(gabriel?.quaseCravadas).toBe(1)
    expect(stats.recordes.mestreDoQuase.participante).toBe('Gabriel')
    expect(stats.recordes.mestreDoQuase.valor).toBe(1)
  })

  it('evaluates isQuaseCravada correctly', () => {
    const jogo: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Corinthians',
      time_b: 'Palmeiras',
      data: '2026-06-01',
      hora: '16:00',
      placar_a: 2,
      placar_b: 1,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // 2x1 -> 2x2: diff = 0 + 1 = 1 (QUASE)
    const p1 = { placar_a: 2, placar_b: 2 } as Palpite
    expect(isQuaseCravada(p1, jogo)).toBe(true)

    // 2x1 -> 3x1: diff = 1 + 0 = 1 (QUASE)
    const p2 = { placar_a: 3, placar_b: 1 } as Palpite
    expect(isQuaseCravada(p2, jogo)).toBe(true)

    // 2x1 -> 2x1: diff = 0 + 0 = 0 (É CRAVADA EXATA, não quase)
    const pExato = { placar_a: 2, placar_b: 1 } as Palpite
    expect(isQuaseCravada(pExato, jogo)).toBe(false)

    // 2x1 -> 0x0: diff = 2 + 1 = 3 (NÃO É QUASE)
    const pLonge = { placar_a: 0, placar_b: 0 } as Palpite
    expect(isQuaseCravada(pLonge, jogo)).toBe(false)
  })

  it('evaluates countMarcadoresDefensoresAcertados correctly', () => {
    const jogo: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Tottenham',
      time_b: 'Aston Villa',
      data: '2026-09-19',
      hora: '08:30',
      placar_a: 2,
      placar_b: 3,
      resultado_finalizado: true,
      tem_penaltis: false,
      gols_time_a: [
        { nome: 'Gallagher', posicao: 'Atacante/Meia', quantidade: 1 },
        { nome: 'Van Hecke', posicao: 'Zagueiro/Lateral', quantidade: 1 },
      ],
      gols_time_b: [{ nome: 'Nicolas Jackson', posicao: 'Atacante/Meia', quantidade: 1 }],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // Palpite com Van Hecke no detalhamento
    const pComDefensor: Palpite = {
      id: 'p1',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'p1',
      placar_a: 2,
      placar_b: 3,
      pontuacao_jogo: 11,
      detalhamento: [
        'Placar Exato (+8 pts)',
        'Gols acertados: Van Hecke (+3 pts - Zagueiro/Lateral)',
      ],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(pComDefensor, jogo)).toBe(1)

    // Palpite sem detalhamento pré-formatado, mas com arrays goleadores_a/b
    const pSemDetalhamento: Palpite = {
      id: 'p2',
      bolao: 'b1',
      jogo: 'j1',
      participante: 'p2',
      placar_a: 1,
      placar_b: 2,
      goleadores_a: ['Van Hecke'],
      goleadores_b: ['Nicolas Jackson'],
      pontuacao_jogo: 4,
      detalhamento: [],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(pSemDetalhamento, jogo)).toBe(1)

    // Caso retroativo de planilha importada:
    // Placar real: 2x1 (Corinthians x Internacional).
    // Palpite 1: chutou 2x0, pontuação 6 (2 de vencedor + 1 de metade = 3 de base, sobram 3 pts de marcador)
    // Detalhamento: ["Vencedor, Metade do Placar e gol do Gustavo Henrique"]
    const jogoCorinthians: Jogo = {
      id: 'j_cor',
      bolao: 'b1',
      time_a: 'Corinthians',
      time_b: 'Internacional',
      data: '2026-09-16',
      hora: '16:00',
      placar_a: 2,
      placar_b: 1,
      resultado_finalizado: true,
      tem_penaltis: false,
      gols_time_a: [],
      gols_time_b: [],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    const palpiteGustavoHenrique: Palpite = {
      id: 'p_gh',
      bolao: 'b1',
      jogo: 'j_cor',
      participante: 'p_davi',
      placar_a: 2,
      placar_b: 0,
      pontuacao_jogo: 6,
      detalhamento: ['Vencedor, Metade do Placar e gol do Gustavo Henrique'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(palpiteGustavoHenrique, jogoCorinthians)).toBe(1)

    // Palpite 2: chutou 2x1 (placar exato = 8 pts) + gols de Gustavo Henrique e Pedro Raul (total 12 pts)
    // 12 - 8 (placar exato) = 4 pts de marcador (3 de defensor + 1 de atacante) => 1 defensor!
    const palpiteExatoComDoisGols: Palpite = {
      id: 'p_gh_pr',
      bolao: 'b1',
      jogo: 'j_cor',
      participante: 'p_gabriel',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 12,
      detalhamento: ['Placar Exato e gols de Gustavo Henrique e Pedro Raul'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(palpiteExatoComDoisGols, jogoCorinthians)).toBe(1)

    // Palpite 3: atacante apenas (ex: Kaio Jorge +1 pt, placar exato 8 pts => total 9 pts)
    // 9 - 8 = 1 pt de marcador => 0 defensores
    const palpiteAtacante: Palpite = {
      id: 'p_atacante',
      bolao: 'b1',
      jogo: 'j_cor',
      participante: 'p_bruno',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 9,
      detalhamento: ['Placar Exato e gol do Kaio Jorge'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(palpiteAtacante, jogoCorinthians)).toBe(0)

    // Palpite 4: Defensor N=2, M=2 cruzando gols_time_a com goleadores_a sem detalhamento prévio
    const jogoDoisGolsDefensor: Jogo = {
      id: 'j_def2',
      bolao: 'b1',
      time_a: 'Arsenal',
      time_b: 'Chelsea',
      data: '2026-09-16',
      hora: '16:00',
      placar_a: 2,
      placar_b: 0,
      resultado_finalizado: true,
      tem_penaltis: false,
      gols_time_a: [{ nome: 'Gabriel Magalhães', posicao: 'Defensor', quantidade: 2 }],
      gols_time_b: [],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    const palpiteDefensorDuplo: Palpite = {
      id: 'p_def2',
      bolao: 'b1',
      jogo: 'j_def2',
      participante: 'p_davi',
      placar_a: 2,
      placar_b: 0,
      goleadores_a: ['Gabriel Magalhães', 'Gabriel Magalhães'],
      pontuacao_jogo: 14,
      detalhamento: [],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(palpiteDefensorDuplo, jogoDoisGolsDefensor)).toBe(2)

    // N=2, M=1 -> 1 defensor
    const palpiteDefensorSimples: Palpite = {
      id: 'p_def1',
      bolao: 'b1',
      jogo: 'j_def2',
      participante: 'p_davi',
      placar_a: 2,
      placar_b: 0,
      goleadores_a: ['Gabriel Magalhães'],
      pontuacao_jogo: 11,
      detalhamento: [],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(countMarcadoresDefensoresAcertados(palpiteDefensorSimples, jogoDoisGolsDefensor)).toBe(1)
  })

  it('identifies big matches (isGrandeJogo) for playoffs, finals and derbies', () => {
    const jogoFinal: Jogo = {
      id: 'j1',
      bolao: 'b1',
      time_a: 'Uberlândia',
      time_b: 'ASA',
      data: '2026-09-16',
      hora: '16:00',
      competicao: 'Brasileirão D (Final)',
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(isGrandeJogo(jogoFinal)).toBe(true)

    const jogoClassico: Jogo = {
      id: 'j2',
      bolao: 'b1',
      time_a: 'Corinthians',
      time_b: 'Palmeiras',
      data: '2026-09-16',
      hora: '16:00',
      competicao: 'Brasileirão',
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(isGrandeJogo(jogoClassico)).toBe(true)

    const jogoComum: Jogo = {
      id: 'j3',
      bolao: 'b1',
      time_a: 'Mirassol',
      time_b: 'Remo',
      data: '2026-09-16',
      hora: '16:00',
      competicao: 'Brasileirão (21ª rodada)',
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(isGrandeJogo(jogoComum)).toBe(false)
  })

  it('identifies big matches in World Cup via international derbies and tournament fallback', () => {
    const bolaoCopa: Bolao = {
      id: 'b_copa',
      nome: 'Copa do Mundo',
      ativo: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // Caso 1: Clássico de seleções sem flag de competicao
    const jogoSelecoes: Jogo = {
      id: 'j_bra_arg',
      bolao: 'b_copa',
      time_a: 'Brasil',
      time_b: 'Argentina',
      data: '2026-06-25',
      hora: '16:00',
      competicao: '',
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '2026-06-25 16:00:00',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(isGrandeJogo(jogoSelecoes, bolaoCopa)).toBe(true)

    // Caso 2: Fase explícita nas oitavas/quartas/semi/3º lugar/final
    const jogoOitavas: Jogo = {
      id: 'j_oitavas',
      bolao: 'b_copa',
      time_a: 'Turquia',
      time_b: 'Paraguai',
      data: '2026-06-28',
      hora: '16:00',
      competicao: 'Oitavas de Final',
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }
    expect(isGrandeJogo(jogoOitavas, bolaoCopa)).toBe(true)

    // Caso 3: Fallback de torneio quando NENHUM jogo da Copa do Mundo tem flag de fase
    // Montamos uma lista de 20 jogos da Copa do Mundo sem campo competicao
    const jogosCopaSemFase: Jogo[] = []
    for (let i = 1; i <= 20; i++) {
      jogosCopaSemFase.push({
        id: `j_wc_${i}`,
        bolao: 'b_copa',
        time_a: `Selecao A${i}`,
        time_b: `Selecao B${i}`,
        data: `2026-06-${String(i).padStart(2, '0')}`,
        hora: '16:00',
        competicao: '',
        resultado_finalizado: true,
        tem_penaltis: false,
        created: `2026-06-${String(i).padStart(2, '0')} 16:00:00`,
        updated: '',
        collectionId: '',
        collectionName: '',
      })
    }

    // Jogos da fase inicial (ex: jogo 1) não devem ser grandes jogos se não são clássicos
    expect(
      isGrandeJogo(jogosCopaSemFase[0], bolaoCopa, {
        todosJogosDoBolao: jogosCopaSemFase,
      }),
    ).toBe(false)

    // Os últimos jogos (fases decisivas: oitavas, quartas, semi, final = últimos 16) devem ser grandes jogos
    const jogoFinalCopa = jogosCopaSemFase[19]
    expect(
      isGrandeJogo(jogoFinalCopa, bolaoCopa, {
        todosJogosDoBolao: jogosCopaSemFase,
      }),
    ).toBe(true)

    const jogoSemiCopa = jogosCopaSemFase[17]
    expect(
      isGrandeJogo(jogoSemiCopa, bolaoCopa, {
        todosJogosDoBolao: jogosCopaSemFase,
      }),
    ).toBe(true)
  })

  it('calculates Mito dos Grandes Jogos correctly in World Cup pool', () => {
    const bolaoCopa: Bolao = {
      id: 'copa_mundo',
      nome: 'Copa do Mundo',
      ativo: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const participantes: Participante[] = [
      {
        id: 'p_douglas',
        bolao: 'copa_mundo',
        nome: 'Douglas',
        pontuacao_total: 10,
        pontos_importados: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_bruno',
        bolao: 'copa_mundo',
        nome: 'Bruno',
        pontuacao_total: 2,
        pontos_importados: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // 20 jogos importados da planilha sem competicao preenchida
    const jogos: Jogo[] = []
    for (let i = 1; i <= 20; i++) {
      jogos.push({
        id: `j_wc_${i}`,
        bolao: 'copa_mundo',
        time_a: i === 1 ? 'Haiti' : i === 20 ? 'Espanha' : `Pais ${i}`,
        time_b: i === 1 ? 'Curaçao' : i === 20 ? 'Argentina' : `Pais ${i + 100}`,
        data: `2026-06-${String(i).padStart(2, '0')}`,
        hora: '16:00',
        placar_a: 1,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        competicao: '', // Importado sem flag de fase
        created: `2026-06-${String(i).padStart(2, '0')} 16:00:00`,
        updated: '',
        collectionId: '',
        collectionName: '',
      })
    }

    // Douglas pontua no jogo final (jogo 20: Espanha x Argentina) -> 8 pontos (cravada)
    // Bruno pontua no jogo inicial (jogo 1: Haiti x Curaçao) -> 2 pontos (vencedor)
    const palpites: Palpite[] = [
      {
        id: 'palp_doug_final',
        bolao: 'copa_mundo',
        jogo: 'j_wc_20',
        participante: 'p_douglas',
        placar_a: 1,
        placar_b: 0,
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'palp_bruno_grupos',
        bolao: 'copa_mundo',
        jogo: 'j_wc_1',
        participante: 'p_bruno',
        placar_a: 1,
        placar_b: 0,
        pontuacao_jogo: 2,
        detalhamento: ['Vencedor (+2 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const stats = calculateStatistics({
      boloes: [bolaoCopa],
      participantes,
      jogos,
      palpites,
      filtroBolaoId: 'copa_mundo',
    })

    // Douglas deve ter 8 pontos em Grandes Jogos
    const douglasStats = stats.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasStats?.pontosGrandesJogos).toBe(8)

    // Bruno deve ter 0 pontos em Grandes Jogos (jogo 1 é da fase de grupos e não é clássico)
    const brunoStats = stats.tabela.find((t) => t.nome === 'Bruno')
    expect(brunoStats?.pontosGrandesJogos).toBe(0)

    // O troféu Mito dos Grandes Jogos deve ter Douglas como vencedor com 8 pontos
    expect(stats.recordes.mitoDosGrandesJogos.temDados).toBe(true)
    expect(stats.recordes.mitoDosGrandesJogos.participante).toBe('Douglas')
    expect(stats.recordes.mitoDosGrandesJogos.pontos).toBe(8)
    expect(stats.recordes.mitoDosGrandesJogos.jogosConsiderados).toBeGreaterThan(0)
  })

  it('aggregates multiple competitions properly when filtroBolaoId is "geral"', () => {
    const boloes: Bolao[] = [
      {
        id: 'copa_coni',
        nome: 'Copa Coni',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'copa_genilton',
        nome: 'Copa Genilton',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const participantes: Participante[] = [
      // Douglas em duas copas
      {
        id: 'p_doug_coni',
        bolao: 'copa_coni',
        nome: 'Douglas',
        pontos_importados: 20,
        pontuacao_total: 20,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_doug_gen',
        bolao: 'copa_genilton',
        nome: 'Douglas',
        pontos_importados: 15,
        pontuacao_total: 15,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      // Gabriel em duas copas
      {
        id: 'p_gab_coni',
        bolao: 'copa_coni',
        nome: 'Gabriel',
        pontos_importados: 10,
        pontuacao_total: 10,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_gab_gen',
        bolao: 'copa_genilton',
        nome: 'Gabriel',
        pontos_importados: 5,
        pontuacao_total: 5,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const jogos: Jogo[] = [
      {
        id: 'j_coni_1',
        bolao: 'copa_coni',
        time_a: 'Time A1',
        time_b: 'Time B1',
        data: '2026-06-01',
        hora: '16:00',
        placar_a: 2,
        placar_b: 1,
        resultado_finalizado: true,
        tem_penaltis: false,
        competicao: 'Copa Coni Rodada 1',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'j_gen_1',
        bolao: 'copa_genilton',
        time_a: 'Time C1',
        time_b: 'Time D1',
        data: '2026-06-02',
        hora: '18:00',
        placar_a: 0,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        competicao: 'Copa Genilton Rodada 1',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const palpites: Palpite[] = [
      {
        id: 'palp_1',
        bolao: 'copa_coni',
        jogo: 'j_coni_1',
        participante: 'p_doug_coni',
        placar_a: 2,
        placar_b: 1, // Cravada exata no jogo da Coni
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'palp_2',
        bolao: 'copa_genilton',
        jogo: 'j_gen_1',
        participante: 'p_doug_gen',
        placar_a: 0,
        placar_b: 0, // Cravada exata no jogo da Genilton
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'palp_3',
        bolao: 'copa_coni',
        jogo: 'j_coni_1',
        participante: 'p_gab_coni',
        placar_a: 1,
        placar_b: 0, // Vencedor
        pontuacao_jogo: 2,
        detalhamento: ['Vencedor (+2 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // Chamando com filtro 'geral'
    const statsGeral = calculateStatistics({
      boloes,
      participantes,
      jogos,
      palpites,
      filtroBolaoId: 'geral',
    })

    // Confere contadores de topo
    expect(statsGeral.totalJogosEncerrados).toBe(2)
    expect(statsGeral.totalPalpitesValidos).toBe(3)

    // Douglas na Geral:
    // Importados: 20 (Coni) + 15 (Genilton) = 35
    // Palpites: 8 (Coni) + 8 (Genilton) = 16
    // Total de pontos: 35 + 16 = 51 pts
    // Cravadas: 2
    const douglasGeral = statsGeral.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasGeral?.totalPontos).toBe(51)
    expect(douglasGeral?.cravadasExatas).toBe(2)
    expect(douglasGeral?.resultadosAcertados).toBe(2)
    expect(douglasGeral?.pontosImportados).toBe(35)
    expect(douglasGeral?.pontosPalpites).toBe(16)

    // Gabriel na Geral:
    // Importados: 10 + 5 = 15
    // Palpites: 2
    // Total: 17
    const gabrielGeral = statsGeral.tabela.find((t) => t.nome === 'Gabriel')
    expect(gabrielGeral?.totalPontos).toBe(17)
    expect(gabrielGeral?.cravadasExatas).toBe(0)
    expect(gabrielGeral?.resultadosAcertados).toBe(1)

    // Destaques e recordes
    expect(statsGeral.recordes.reiDaCravada.participante).toBe('Douglas')
    expect(statsGeral.recordes.reiDaCravada.valor).toBe(2)
    expect(statsGeral.recordes.mestreDoResultado.participante).toBe('Douglas')
    expect(statsGeral.recordes.mestreDoResultado.valor).toBe(2)
    expect(statsGeral.recordes.maiorPontuadorRodada.pontos).toBe(8)

    // Evolução: ponto inicial + 2 jogos = 3 pontos
    expect(statsGeral.evolucao.length).toBe(3)
    // No ponto inicial, Douglas começa com 35 (importados das 2 copas)
    expect(statsGeral.evolucao[0].Douglas).toBe(35)
    // No último ponto, Douglas termina com 51
    expect(statsGeral.evolucao[2].Douglas).toBe(51)

    // Testar filtro em copa específica (ex: copa_coni)
    const statsConi = calculateStatistics({
      boloes,
      participantes,
      jogos,
      palpites,
      filtroBolaoId: 'copa_coni',
    })

    expect(statsConi.totalJogosEncerrados).toBe(1)
    expect(statsConi.totalPalpitesValidos).toBe(2)
    const douglasConi = statsConi.tabela.find((t) => t.nome === 'Douglas')
    // Na Coni: 20 importados + 8 = 28 pts, 1 cravada
    expect(douglasConi?.totalPontos).toBe(28)
    expect(douglasConi?.cravadasExatas).toBe(1)
  })
})
