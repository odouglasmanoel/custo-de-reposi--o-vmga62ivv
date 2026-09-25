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
    expect(normalizeMemberName('bruno')).toBe('Bruno Lopes')
    expect(normalizeMemberName('brunol')).toBe('Bruno Lopes')
    expect(normalizeMemberName('brunox')).toBe('Bruno Xavier')
    expect(normalizeMemberName('Bruno Xavier')).toBe('Bruno Xavier')
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

  it('isCravadaExata aceita placares históricos com sufixo de marcadores entre parênteses', () => {
    const jogoComSufixo: Jogo = {
      id: 'j_hist',
      bolao: 'b_hist',
      time_a: 'Atlético de Madrid',
      time_b: 'Sevilla',
      data: '2026-06-01',
      hora: '16:00',
      placar_a: '3x0 (Samuel Lino 2x e Carrascal)' as any,
      placar_b: 0 as any,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const palpiteComSufixo: Palpite = {
      id: 'p_hist',
      bolao: 'b_hist',
      jogo: 'j_hist',
      participante: 'p_douglas',
      placar_a: '3x0 (Pedro, Samuel Lino e Léo Pereira)' as any,
      placar_b: 0 as any,
      pontuacao_jogo: 9,
      detalhamento: ['gol do Samuel Lino'],
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    expect(isCravadaExata(palpiteComSufixo, jogoComSufixo)).toBe(true)
    expect(isResultadoAcertado(palpiteComSufixo, jogoComSufixo)).toBe(true)

    // Casos 1x1 e 2x1 normais e com sufixos
    const jogo1x1: Jogo = {
      ...jogoComSufixo,
      placar_a: 1,
      placar_b: 1,
    }
    const palpite1x1: Palpite = {
      ...palpiteComSufixo,
      placar_a: 1,
      placar_b: 1,
      detalhamento: [],
    }
    expect(isCravadaExata(palpite1x1, jogo1x1)).toBe(true)

    const jogo2x1: Jogo = {
      ...jogoComSufixo,
      placar_a: 2,
      placar_b: 1,
    }
    const palpite2x1: Palpite = {
      ...palpiteComSufixo,
      placar_a: 2,
      placar_b: 1,
      detalhamento: [],
    }
    expect(isCravadaExata(palpite2x1, jogo2x1)).toBe(true)
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

    // Bruno (Bruno Lopes) deve ter 0 pontos em Grandes Jogos (jogo 1 é da fase de grupos e não é clássico)
    const brunoStats = stats.tabela.find((t) => t.nome === 'Bruno Lopes')
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

  it('aplica cravadas_fixas oficiais por copa para Douglas (6 Coni, 8 Copa do Mundo, 2 Sormani, 3 Genilton = 19 no Geral)', () => {
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
        id: 'copa_mundo',
        nome: 'Copa do Mundo',
        ativo: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'copa_sormani',
        nome: 'Copa Sormani',
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
      {
        id: 'p_doug_coni',
        bolao: 'copa_coni',
        nome: 'Douglas',
        pontos_importados: 61,
        cravadas_fixas: 6,
        pontuacao_total: 190,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_doug_copa',
        bolao: 'copa_mundo',
        nome: 'Douglas',
        pontos_importados: 150,
        cravadas_fixas: 8,
        pontuacao_total: 230,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_doug_sormani',
        bolao: 'copa_sormani',
        nome: 'Douglas',
        pontos_importados: 6,
        cravadas_fixas: 2,
        pontuacao_total: 107,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_doug_genilton',
        bolao: 'copa_genilton',
        nome: 'Douglas',
        pontos_importados: 4,
        cravadas_fixas: 3,
        pontuacao_total: 89,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // 1. Visão Geral (Todas as Copas) -> Douglas soma exatamente 6 + 8 + 2 + 3 = 19 cravadas oficiais
    const statsGeral = calculateStatistics({
      boloes,
      participantes,
      jogos: [],
      palpites: [],
      filtroBolaoId: 'geral',
    })
    const douglasGeral = statsGeral.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasGeral).toBeDefined()
    expect(douglasGeral?.cravadasExatas).toBe(19)
    // Pontos permanecem absolutamente congelados e isolados
    expect(douglasGeral?.pontosImportados).toBe(61 + 150 + 6 + 4) // 221
    expect(douglasGeral?.totalPontos).toBe(221)

    // 2. Visão Copa Coni: exatamente 6 cravadas oficiais
    const statsConi = calculateStatistics({
      boloes,
      participantes,
      jogos: [],
      palpites: [],
      filtroBolaoId: 'copa_coni',
    })
    const douglasConi = statsConi.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasConi?.cravadasExatas).toBe(6)

    // 3. Visão Copa do Mundo isolada: exatamente 8 cravadas oficiais
    const statsCopa = calculateStatistics({
      boloes,
      participantes,
      jogos: [],
      palpites: [],
      filtroBolaoId: 'copa_mundo',
    })
    const douglasCopa = statsCopa.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasCopa?.cravadasExatas).toBe(8)

    // 4. Visão Copa Sormani: exatamente 2 cravadas oficiais
    const statsSormani = calculateStatistics({
      boloes,
      participantes,
      jogos: [],
      palpites: [],
      filtroBolaoId: 'copa_sormani',
    })
    const douglasSormani = statsSormani.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasSormani?.cravadasExatas).toBe(2)

    // 5. Visão Copa Genilton: exatamente 3 cravadas oficiais
    const statsGenilton = calculateStatistics({
      boloes,
      participantes,
      jogos: [],
      palpites: [],
      filtroBolaoId: 'copa_genilton',
    })
    const douglasGenilton = statsGenilton.tabela.find((t) => t.nome === 'Douglas')
    expect(douglasGenilton?.cravadasExatas).toBe(3)
  })

  it('TOTAL DE PONTOS é estritamente [Pontos Fixos Importados] + [Pontos Palpites do App] e nunca é alterado pelo parsing de cravadas', () => {
    const boloes: Bolao[] = [
      {
        id: 'copa_teste',
        nome: 'Copa Coni',
        ativo: true,
        foco: 'Jogos',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const participantes: Participante[] = [
      {
        id: 'p_davi',
        bolao: 'copa_teste',
        nome: 'Davi',
        pontos_importados: 209, // Valor oficial importado
        pontuacao_total: 749,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p_douglas',
        bolao: 'copa_teste',
        nome: 'Douglas',
        pontos_importados: 221, // Valor oficial importado
        pontuacao_total: 616,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // Jogo onde o palpite contém texto com parênteses ("3x0 (Samuel Lino 2x e Carrascal)")
    // Esse formato gera validação de cravada (contador = 1), mas os pontos do palpite são 5 (não 8)
    const jogos: Jogo[] = [
      {
        id: 'j_1',
        bolao: 'copa_teste',
        time_a: 'Atlético',
        time_b: 'Rival',
        data: '2026-09-01',
        hora: '20:00',
        placar_a: 3,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const palpites: Palpite[] = [
      {
        id: 'bet_davi',
        bolao: 'copa_teste',
        jogo: 'j_1',
        participante: 'p_davi',
        placar_a: '3x0 (Samuel Lino 2x e Carrascal)' as unknown as number,
        placar_b: null as unknown as number,
        pontuacao_jogo: 5, // Pontuação oficial histórica gravada
        detalhamento: ['Vencedor e Metade do Placar'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'bet_douglas',
        bolao: 'copa_teste',
        jogo: 'j_1',
        participante: 'p_douglas',
        placar_a: 3,
        placar_b: 0,
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const res = calculateStatistics({
      boloes,
      participantes,
      jogos,
      palpites,
      filtroBolaoId: 'geral',
    })

    const daviRow = res.tabela.find((t) => t.nome === 'Davi')
    const douglasRow = res.tabela.find((t) => t.nome === 'Douglas')

    // 1. Contador de cravadas reconheceu a cravada pelo parsing do '(' para Davi e Douglas
    expect(daviRow?.cravadasExatas).toBe(1)
    expect(douglasRow?.cravadasExatas).toBe(1)

    // 2. TOTAL DE PONTOS: estritamente [pontos_importados] + [pontuacao_jogo dos palpites]
    // NUNCA recalculou para 8 os pontos do palpite do Davi!
    expect(daviRow?.pontosImportados).toBe(209)
    expect(daviRow?.pontosPalpites).toBe(5)
    expect(daviRow?.totalPontos).toBe(209 + 5) // 214, não 209 + 8

    expect(douglasRow?.pontosImportados).toBe(221)
    expect(douglasRow?.pontosPalpites).toBe(8)
    expect(douglasRow?.totalPontos).toBe(221 + 8) // 229
  })

  it('aplica cravadas_fixas oficiais auditadas para todos os participantes (Davi 25, Gabriel 21, Douglas 19, Bruno Xavier 8)', () => {
    const boloes: Bolao[] = [
      {
        id: 'hy6ade9obylh404',
        nome: 'Copa do Mundo',
        ativo: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'kr20rfjisajd6ro',
        nome: 'Copa Coni',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'xdtvijyapxuw99y',
        nome: 'Copa Sormani',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'qdpy2honwivb5zw',
        nome: 'Copa Genilton',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // Todos os participantes cadastrados com as pontuações e cravadas oficiais apuradas na auditoria:
    // - Bruno Lopes: Copa do Mundo: 6 | Copa Genilton: 0 | Copa Sormani: 1 | Copa Coni: 1 (Total = 8)
    // - Bruno Xavier: zera a base de planilhas (Total = 0)
    // - Davi: Copa do Mundo: 10 | Copa Genilton: 6 | Copa Sormani: 3 | Copa Coni: 6 (Total = 25)
    // - Douglas: Copa do Mundo: 8 | Copa Genilton: 3 | Copa Sormani: 2 | Copa Coni: 6 (Total = 19)
    // - Gabriel: Copa do Mundo: 7 | Copa Genilton: 5 | Copa Sormani: 5 | Copa Coni: 4 (Total = 21)
    const participantes: Participante[] = [
      // Douglas: 221 importados, 616 totais
      {
        id: 'i6kaaw12v3l9adh',
        nome: 'Douglas',
        bolao: 'hy6ade9obylh404',
        pontos_importados: 150,
        cravadas_fixas: 8,
        pontuacao_total: 230,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'ab3sjd3vctc8l0n',
        nome: 'Douglas',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 61,
        cravadas_fixas: 6,
        pontuacao_total: 190,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '4vfl6xcy0jj51d4',
        nome: 'Douglas',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 6,
        cravadas_fixas: 2,
        pontuacao_total: 107,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'v7idfj7z96dle4k',
        nome: 'Douglas',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 4,
        cravadas_fixas: 3,
        pontuacao_total: 89,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },

      // Davi: 209 importados, 749 totais
      {
        id: 'kvgc6c0fwhl0l9p',
        nome: 'Davi',
        bolao: 'hy6ade9obylh404',
        pontos_importados: 142,
        cravadas_fixas: 10,
        pontuacao_total: 281,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'umcv669v5mdfe0r',
        nome: 'Davi',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 56,
        cravadas_fixas: 6,
        pontuacao_total: 215,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '4b44sdmnk0b8mdn',
        nome: 'Davi',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 11,
        cravadas_fixas: 3,
        pontuacao_total: 124,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '0izs3aqh2jsc9hl',
        nome: 'Davi',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 0,
        cravadas_fixas: 6,
        pontuacao_total: 129,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },

      // Gabriel: 179 importados, 639 totais
      {
        id: 'trome8p25i4b75p',
        nome: 'Gabriel',
        bolao: 'hy6ade9obylh404',
        pontos_importados: 118,
        cravadas_fixas: 7,
        pontuacao_total: 236,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '09yarueqvzdkca0',
        nome: 'Gabriel',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 43,
        cravadas_fixas: 4,
        pontuacao_total: 170,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '9wnn50qbtu0zd0g',
        nome: 'Gabriel',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 18,
        cravadas_fixas: 5,
        pontuacao_total: 131,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'gkecxx8je2gf0d5',
        nome: 'Gabriel',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 0,
        cravadas_fixas: 5,
        pontuacao_total: 102,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },

      // Bruno Lopes: 136 importados, 321 totais - Base histórica de cravadas: 8 (6/0/1/1)
      {
        id: 'dqqt8gucvr0jwgg',
        nome: 'Bruno Lopes',
        bolao: 'hy6ade9obylh404',
        pontos_importados: 134,
        cravadas_fixas: 6,
        pontuacao_total: 213,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'k2km4ejz4rfz992',
        nome: 'Bruno Lopes',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 0,
        cravadas_fixas: 1,
        pontuacao_total: 63,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'c1a3v87mi2v8iiy',
        nome: 'Bruno Lopes',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 2,
        cravadas_fixas: 1,
        pontuacao_total: 33,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'z06yes6lfpqajwp',
        nome: 'Bruno Lopes',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 12,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },

      // Bruno Xavier: 0 importados, 18 totais - Base histórica zerada (entrou direto no App)
      {
        id: 'hkamtknd5weqrm7',
        nome: 'Bruno Xavier',
        bolao: 'hy6ade9obylh404',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '6uaqe0k861lckyl',
        nome: 'Bruno Xavier',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 18,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '2tt4qyld3zvxutb',
        nome: 'Bruno Xavier',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: '5mec2j8sq1fneky',
        nome: 'Bruno Xavier',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },

      // Willian: 0 importados, 6 totais
      {
        id: '9fdrx5dij8dfobg',
        nome: 'Willian',
        bolao: 'kr20rfjisajd6ro',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 6,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'jj9o0g39qhf285f',
        nome: 'Willian',
        bolao: 'xdtvijyapxuw99y',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'qohuqdm775wzvoj',
        nome: 'Willian',
        bolao: 'qdpy2honwivb5zw',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // Palpites do app para simular a pontuação restante que totaliza exatamente:
    // Douglas: 616 (221 imp + 395 palpites)
    // Davi: 749 (209 imp + 540 palpites)
    // Gabriel: 639 (179 imp + 460 palpites)
    // Bruno Lopes: 321 (136 imp + 185 palpites)
    // Bruno Xavier: 18 (0 imp + 18 palpites)
    // Willian: 6 (0 imp + 6 palpites)
    const mockJogo: Jogo = {
      id: 'j_mock',
      bolao: 'kr20rfjisajd6ro',
      time_a: 'Time A',
      time_b: 'Time B',
      data: '2026-09-01',
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

    const mockPalpites: Palpite[] = [
      {
        id: 'p1',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: 'ab3sjd3vctc8l0n',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 395,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p2',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: 'umcv669v5mdfe0r',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 540,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p3',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: '09yarueqvzdkca0',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 460,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p4',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: 'c1a3v87mi2v8iiy',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 185,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p5',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: '6uaqe0k861lckyl',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 18,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'p6',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'j_mock',
        participante: '9fdrx5dij8dfobg',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 6,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // 1. Visão Geral (Todas as Copas)
    const statsGeral = calculateStatistics({
      boloes,
      participantes,
      jogos: [mockJogo],
      palpites: mockPalpites,
      filtroBolaoId: 'geral',
    })

    const getScore = (name: string) => statsGeral.tabela.find((t) => t.nome === name)?.totalPontos
    const getCravadas = (name: string) =>
      statsGeral.tabela.find((t) => t.nome === name)?.cravadasExatas

    // Pontuações totais estritamente congeladas
    expect(getScore('Davi')).toBe(749)
    expect(getScore('Gabriel')).toBe(639)
    expect(getScore('Douglas')).toBe(616)
    expect(getScore('Bruno Lopes')).toBe(321)
    expect(getScore('Bruno Xavier')).toBe(18)
    expect(getScore('Willian')).toBe(6)

    // Cravadas auditadas no Geral:
    // Davi: 10 + 6 + 3 + 6 = 25
    // Gabriel: 7 + 5 + 5 + 4 = 21
    // Douglas: 8 + 3 + 2 + 6 = 19
    // Bruno Lopes: 6 + 0 + 1 + 1 = 8
    // Bruno Xavier: 0 (entrou direto no app)
    // Willian: 0 (entrou direto no app)
    expect(getCravadas('Davi')).toBe(25)
    expect(getCravadas('Gabriel')).toBe(21)
    expect(getCravadas('Douglas')).toBe(19)
    expect(getCravadas('Bruno Lopes')).toBe(8)
    expect(getCravadas('Bruno Xavier')).toBe(0)
    expect(getCravadas('Willian')).toBe(0)

    // 2. Visão Copa do Mundo isolada:
    // Davi: 10, Douglas: 8, Gabriel: 7, Bruno Lopes: 6, Bruno Xavier: 0
    const statsMundo = calculateStatistics({
      boloes,
      participantes,
      jogos: [mockJogo],
      palpites: mockPalpites,
      filtroBolaoId: 'hy6ade9obylh404',
    })
    expect(statsMundo.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(10)
    expect(statsMundo.tabela.find((t) => t.nome === 'Douglas')?.cravadasExatas).toBe(8)
    expect(statsMundo.tabela.find((t) => t.nome === 'Gabriel')?.cravadasExatas).toBe(7)
    expect(statsMundo.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(6)
    expect(statsMundo.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)

    // 3. Visão Copa Coni isolada:
    // Davi: 6, Douglas: 6, Gabriel: 4, Bruno Lopes: 1, Bruno Xavier: 0
    const statsConi = calculateStatistics({
      boloes,
      participantes,
      jogos: [mockJogo],
      palpites: mockPalpites,
      filtroBolaoId: 'kr20rfjisajd6ro',
    })
    expect(statsConi.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(6)
    expect(statsConi.tabela.find((t) => t.nome === 'Douglas')?.cravadasExatas).toBe(6)
    expect(statsConi.tabela.find((t) => t.nome === 'Gabriel')?.cravadasExatas).toBe(4)
    expect(statsConi.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(1)
    expect(statsConi.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)

    // 4. Visão Copa Sormani isolada:
    // Davi: 3, Douglas: 2, Gabriel: 5, Bruno Lopes: 1, Bruno Xavier: 0
    const statsSormani = calculateStatistics({
      boloes,
      participantes,
      jogos: [mockJogo],
      palpites: mockPalpites,
      filtroBolaoId: 'xdtvijyapxuw99y',
    })
    expect(statsSormani.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(3)
    expect(statsSormani.tabela.find((t) => t.nome === 'Douglas')?.cravadasExatas).toBe(2)
    expect(statsSormani.tabela.find((t) => t.nome === 'Gabriel')?.cravadasExatas).toBe(5)
    expect(statsSormani.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(1)
    expect(statsSormani.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)

    // 5. Visão Copa Genilton isolada:
    // Davi: 6, Douglas: 3, Gabriel: 5, Bruno Lopes: 0, Bruno Xavier: 0
    const statsGenilton = calculateStatistics({
      boloes,
      participantes,
      jogos: [mockJogo],
      palpites: mockPalpites,
      filtroBolaoId: 'qdpy2honwivb5zw',
    })
    expect(statsGenilton.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(6)
    expect(statsGenilton.tabela.find((t) => t.nome === 'Douglas')?.cravadasExatas).toBe(3)
    expect(statsGenilton.tabela.find((t) => t.nome === 'Gabriel')?.cravadasExatas).toBe(5)
    expect(statsGenilton.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(0)
    expect(statsGenilton.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)
  })

  it('valida a fórmula oficial de cravadas: [Cravadas Históricas Importadas] + [Cravadas do App] por copa e no geral', () => {
    const boloes: Bolao[] = [
      {
        id: 'hy6ade9obylh404',
        nome: 'Copa do Mundo',
        ativo: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'kr20rfjisajd6ro',
        nome: 'Copa Coni',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const participantes: Participante[] = [
      {
        id: 'part_doug_copa',
        bolao: 'hy6ade9obylh404',
        nome: 'Douglas',
        pontos_importados: 150,
        cravadas_fixas: 8,
        pontuacao_total: 230,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'part_doug_coni',
        bolao: 'kr20rfjisajd6ro',
        nome: 'Douglas',
        pontos_importados: 61,
        cravadas_fixas: 6,
        pontuacao_total: 190,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'part_davi_coni',
        bolao: 'kr20rfjisajd6ro',
        nome: 'Davi',
        pontos_importados: 56,
        cravadas_fixas: 6,
        pontuacao_total: 215,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'part_davi_copa',
        bolao: 'hy6ade9obylh404',
        nome: 'Davi',
        pontos_importados: 142,
        cravadas_fixas: 10,
        pontuacao_total: 281,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // Jogo encerrado via App na Copa Coni com placar 2x1
    const appGame: Jogo = {
      id: 'jogo_app_1',
      bolao: 'kr20rfjisajd6ro',
      time_a: 'Corinthians',
      time_b: 'Palmeiras',
      data: '2026-09-24',
      hora: '20:00',
      placar_a: 2,
      placar_b: 1,
      resultado_finalizado: true,
      tem_penaltis: false,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // Douglas cravou 2x1 no jogo do App (+1 cravada via App)
    // Davi cravou 2x1 no jogo do App (+2 cravadas via App caso 2 jogos)
    const palpites: Palpite[] = [
      {
        id: 'bet_doug_app',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'jogo_app_1',
        participante: 'part_doug_coni',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'bet_davi_app',
        bolao: 'kr20rfjisajd6ro',
        jogo: 'jogo_app_1',
        participante: 'part_davi_coni',
        placar_a: 2,
        placar_b: 1,
        pontuacao_jogo: 8,
        detalhamento: ['Placar Exato (+8 pts)'],
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    // 1. Filtro Copa Coni:
    // Douglas = 6 fixas importadas + 1 cravada app = 7
    // Davi = 6 fixas importadas + 1 cravada app = 7
    const statsConi = calculateStatistics({
      boloes,
      participantes,
      jogos: [appGame],
      palpites,
      filtroBolaoId: 'kr20rfjisajd6ro',
    })
    const dougConiRow = statsConi.tabela.find((t) => t.nome === 'Douglas')
    const daviConiRow = statsConi.tabela.find((t) => t.nome === 'Davi')
    expect(dougConiRow?.cravadasExatas).toBe(6 + 1)
    expect(daviConiRow?.cravadasExatas).toBe(6 + 1)

    // 2. Filtro Geral:
    // Douglas = (8 + 6) fixas + 1 app = 15 cravadas
    // Davi = (10 + 6) fixas + 1 app = 17 cravadas (ou se Davi tiver 25 na planilha inteira e cravou 2 no app -> 27)
    const statsGeral = calculateStatistics({
      boloes,
      participantes,
      jogos: [appGame],
      palpites,
      filtroBolaoId: 'geral',
    })
    const dougGeralRow = statsGeral.tabela.find((t) => t.nome === 'Douglas')
    const daviGeralRow = statsGeral.tabela.find((t) => t.nome === 'Davi')
    expect(dougGeralRow?.cravadasExatas).toBe(14 + 1)
    expect(daviGeralRow?.cravadasExatas).toBe(16 + 1)

    // Isolamento: total de pontos do Douglas = 150 + 61 + 8 = 219
    expect(dougGeralRow?.totalPontos).toBe(150 + 61 + 8)
  })

  describe('Marcador Temporal de Transição de Cravadas (Histórico vs App)', () => {
    const boloes: Bolao[] = [
      {
        id: 'bolao_teste',
        nome: 'Copa Coni',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    const participantes: Participante[] = [
      {
        id: 'part_blopes',
        nome: 'Bruno Lopes',
        bolao: 'bolao_teste',
        pontos_importados: 136,
        cravadas_fixas: 8,
        pontuacao_total: 136,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'part_bxavier',
        nome: 'Bruno Xavier',
        bolao: 'bolao_teste',
        pontos_importados: 0,
        cravadas_fixas: 0,
        pontuacao_total: 0,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
      {
        id: 'part_davi',
        nome: 'Davi',
        bolao: 'bolao_teste',
        pontos_importados: 209,
        cravadas_fixas: 25,
        pontuacao_total: 209,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    it('jogo com kickoff anterior ou igual a 16/09/2026 16:00 (histórico importado) NÃO soma na parcela app', () => {
      // Jogo no dia 16/09/2026 às 15:30 (ou antes das 16:00)
      const jogoHistorico: Jogo = {
        id: 'jogo_hist_1',
        bolao: 'bolao_teste',
        time_a: 'Real Madrid',
        time_b: 'Barcelona',
        data: '2026-09-16',
        hora: '15:00',
        placar_a: 2,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      }

      // Todos acertaram em cheio o placar 2x0 no jogo histórico
      const palpitesHistoricos: Palpite[] = [
        {
          id: 'p_blopes_hist',
          bolao: 'bolao_teste',
          jogo: 'jogo_hist_1',
          participante: 'part_blopes',
          placar_a: 2,
          placar_b: 0,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
        {
          id: 'p_bxavier_hist',
          bolao: 'bolao_teste',
          jogo: 'jogo_hist_1',
          participante: 'part_bxavier',
          placar_a: 2,
          placar_b: 0,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
        {
          id: 'p_davi_hist',
          bolao: 'bolao_teste',
          jogo: 'jogo_hist_1',
          participante: 'part_davi',
          placar_a: 2,
          placar_b: 0,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
      ]

      const stats = calculateStatistics({
        boloes,
        participantes,
        jogos: [jogoHistorico],
        palpites: palpitesHistoricos,
        filtroBolaoId: 'geral',
      })

      // Como o jogo é do histórico (<= 16/09 16:00), cravadas do app = 0
      // Cravadas totais exibem exclusivamente a base fixa:
      // Bruno Lopes: 8 + 0 = 8
      // Bruno Xavier: 0 + 0 = 0
      // Davi: 25 + 0 = 25
      expect(stats.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(8)
      expect(stats.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)
      expect(stats.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(25)
    })

    it('jogo com kickoff entre 16:00 e 19:00 em 16/09/2026 NÃO soma na parcela app nem na base histórica', () => {
      const jogoJanela: Jogo = {
        id: 'jogo_janela',
        bolao: 'bolao_teste',
        time_a: 'Chelsea',
        time_b: 'Arsenal',
        data: '2026-09-16',
        hora: '17:00',
        placar_a: 1,
        placar_b: 1,
        resultado_finalizado: true,
        tem_penaltis: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      }

      const palpites: Palpite[] = [
        {
          id: 'p_bxavier_janela',
          bolao: 'bolao_teste',
          jogo: 'jogo_janela',
          participante: 'part_bxavier',
          placar_a: 1,
          placar_b: 1,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
      ]

      const stats = calculateStatistics({
        boloes,
        participantes,
        jogos: [jogoJanela],
        palpites,
        filtroBolaoId: 'geral',
      })

      // Não entra na parcela do app (kickoff < 19:00)
      expect(stats.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0)
    })

    it('jogo com kickoff a partir de 16/09/2026 19:00 soma perfeitamente na parcela app', () => {
      // Primeiro jogo do app: 16/09/2026 às 19:00
      const jogoApp19h: Jogo = {
        id: 'jogo_app_19h',
        bolao: 'bolao_teste',
        time_a: 'Liverpool',
        time_b: 'Milan',
        data: '2026-09-16',
        hora: '19:00',
        placar_a: 3,
        placar_b: 1,
        resultado_finalizado: true,
        tem_penaltis: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      }

      // Jogo futuro do app: 20/09/2026 às 21:00
      const jogoAppPosterior: Jogo = {
        id: 'jogo_app_post',
        bolao: 'bolao_teste',
        time_a: 'Juventus',
        time_b: 'Inter',
        data: '2026-09-20',
        hora: '21:00',
        placar_a: 0,
        placar_b: 0,
        resultado_finalizado: true,
        tem_penaltis: false,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      }

      const palpitesApp: Palpite[] = [
        // Bruno Xavier crava ambos os jogos do App (+2 cravadas reais no app)
        {
          id: 'p_bx_1',
          bolao: 'bolao_teste',
          jogo: 'jogo_app_19h',
          participante: 'part_bxavier',
          placar_a: 3,
          placar_b: 1,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
        {
          id: 'p_bx_2',
          bolao: 'bolao_teste',
          jogo: 'jogo_app_post',
          participante: 'part_bxavier',
          placar_a: 0,
          placar_b: 0,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
        // Bruno Lopes crava o jogo de 19:00 (+1 cravada no app)
        {
          id: 'p_bl_1',
          bolao: 'bolao_teste',
          jogo: 'jogo_app_19h',
          participante: 'part_blopes',
          placar_a: 3,
          placar_b: 1,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
        // Davi crava o jogo posterior (+1 cravada no app)
        {
          id: 'p_dv_2',
          bolao: 'bolao_teste',
          jogo: 'jogo_app_post',
          participante: 'part_davi',
          placar_a: 0,
          placar_b: 0,
          pontuacao_jogo: 8,
          created: '',
          updated: '',
          collectionId: '',
          collectionName: '',
        },
      ]

      const stats = calculateStatistics({
        boloes,
        participantes,
        jogos: [jogoApp19h, jogoAppPosterior],
        palpites: palpitesApp,
        filtroBolaoId: 'geral',
      })

      // Bruno Lopes: base fixa (8) + app (1) = 9
      expect(stats.tabela.find((t) => t.nome === 'Bruno Lopes')?.cravadasExatas).toBe(8 + 1)
      // Bruno Xavier: base fixa (0) + app (2) = 2
      expect(stats.tabela.find((t) => t.nome === 'Bruno Xavier')?.cravadasExatas).toBe(0 + 2)
      // Davi: base fixa (25) + app (1) = 26
      expect(stats.tabela.find((t) => t.nome === 'Davi')?.cravadasExatas).toBe(25 + 1)
    })
  })
})
