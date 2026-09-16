import { describe, it, expect } from 'vitest'
import {
  calculateStatistics,
  isCravadaExata,
  isResultadoAcertado,
  getPontosGols,
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
  })
})
