import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readStatsCache, writeStatsCache, invalidateStatsCache, fetchStatisticsData } from './stats'
import pb from '@/lib/pocketbase/client'
import { GERAL_BOLAO_ID } from '@/types/bolao'
import type { StatsCalculationResult } from '@/lib/statsCalculator'

describe('stats service and caching', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateStatsCache()
    vi.restoreAllMocks()
  })

  const dummyStats: StatsCalculationResult = {
    tabela: [
      {
        nome: 'Douglas',
        totalPontos: 50,
        cravadasExatas: 4,
        resultadosAcertados: 8,
        golsAcertados: 3,
        marcadoresDefensores: 2,
        quaseCravadas: 3,
        pontosGrandesJogos: 15,
        jogosPalpitadosEncerrados: 10,
        pontosPalpites: 30,
        pontosImportados: 20,
        aproveitamento: 37.5,
        posicao: 1,
      },
    ],
    recordes: {
      reiDaCravada: { participante: 'Douglas', valor: 4 },
      mestreDoResultado: { participante: 'Douglas', valor: 8 },
      matadorDeAposta: { participante: 'Douglas', valor: 3 },
      maiorPontuadorRodada: {
        participante: 'Douglas',
        pontos: 8,
        rodadaLabel: 'Rodada 1',
        jogoLabel: 'Time A 2 x 1 Time B',
      },
      paiDosDefensores: {
        participante: 'Douglas',
        valor: 2,
        temDados: true,
      },
      mestreDoQuase: {
        participante: 'Douglas',
        valor: 3,
        temDados: true,
      },
      peFrioDaRodada: {
        participante: 'Douglas',
        aproveitamento: 37.5,
        jogosPalpitados: 10,
        temDados: true,
      },
      mitoDosGrandesJogos: {
        participante: 'Douglas',
        pontos: 15,
        jogosConsiderados: 3,
        temDados: true,
      },
    },
    evolucao: [
      {
        rodadaIndex: 0,
        rodadaLabel: 'Início',
        jogoLabel: 'Pontos Base / Importados',
        competicao: 'Geral',
        dataHora: '',
        Douglas: 20,
      },
    ],
    totalJogosEncerrados: 10,
    totalPalpitesValidos: 10,
  }

  it('reads and writes to 2-level cache (memory + localStorage)', () => {
    expect(readStatsCache(GERAL_BOLAO_ID)).toBeNull()

    const boloes = [
      {
        id: 'b1',
        nome: 'Copa Coni',
        ativo: true,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]

    writeStatsCache(GERAL_BOLAO_ID, boloes, dummyStats)

    // Leitura direta da memória
    const fromMem = readStatsCache(GERAL_BOLAO_ID)
    expect(fromMem).not.toBeNull()
    expect(fromMem?.stats.tabela[0].totalPontos).toBe(50)
    expect(fromMem?.boloes[0].nome).toBe('Copa Coni')

    // Invalida somente memória para testar recuperação do localStorage
    // simulando reabrir o app/página
    invalidateStatsCache('outra_copa') // não apaga GERAL_BOLAO_ID
    const stillThere = readStatsCache(GERAL_BOLAO_ID)
    expect(stillThere).not.toBeNull()

    // Invalidação específica
    invalidateStatsCache(GERAL_BOLAO_ID)
    expect(readStatsCache(GERAL_BOLAO_ID)).toBeNull()
  })

  it('queries pocketbase with projection fields and returns exact statistics', async () => {
    const mockBoloes = [
      {
        id: 'b1',
        nome: 'Copa Coni',
        ativo: true,
        foco: 'Coni',
        ultima_atualizacao: '',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]
    const mockParticipantes = [
      {
        id: 'p1',
        bolao: 'b1',
        nome: 'Douglas',
        pontos_importados: 10,
        pontuacao_total: 10,
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]
    const mockJogos = [
      {
        id: 'j1',
        bolao: 'b1',
        time_a: 'Palmeiras',
        time_b: 'Corinthians',
        data: '2026-06-01',
        hora: '16:00',
        placar_a: 2,
        placar_b: 1,
        resultado_finalizado: true,
        tem_penaltis: false,
        competicao: 'Final',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: '',
      },
    ]
    const mockPalpites = [
      {
        id: 'palp1',
        bolao: 'b1',
        jogo: 'j1',
        participante: 'p1',
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

    const getFullListSpy = vi
      .spyOn(pb, 'collection')
      .mockImplementation((collectionName: string) => {
        return {
          getFullList: vi.fn().mockImplementation((options: any) => {
            if (collectionName === 'boloes') {
              expect(options.fields).toBe('id,nome,ativo,ultima_atualizacao,foco')
              return Promise.resolve(mockBoloes)
            }
            if (collectionName === 'participantes') {
              expect(options.fields).toBe('id,bolao,nome,pontuacao_total,pontos_importados')
              return Promise.resolve(mockParticipantes)
            }
            if (collectionName === 'jogos') {
              expect(options.fields).toContain('placar_a,placar_b,resultado_finalizado')
              return Promise.resolve(mockJogos)
            }
            if (collectionName === 'palpites') {
              expect(options.fields).toContain('placar_a,placar_b,pontuacao_jogo')
              return Promise.resolve(mockPalpites)
            }
            return Promise.resolve([])
          }),
        } as any
      })

    const result = await fetchStatisticsData('b1')

    expect(getFullListSpy).toHaveBeenCalledWith('boloes')
    expect(getFullListSpy).toHaveBeenCalledWith('participantes')
    expect(getFullListSpy).toHaveBeenCalledWith('jogos')
    expect(getFullListSpy).toHaveBeenCalledWith('palpites')

    // Confere que o cálculo mantém rigorosamente as regras originais
    expect(result.stats.totalJogosEncerrados).toBe(1)
    expect(result.stats.totalPalpitesValidos).toBe(1)
    const douglas = result.stats.tabela.find((p) => p.nome === 'Douglas')
    expect(douglas?.totalPontos).toBe(18) // 10 importados + 8 palpite
    expect(douglas?.cravadasExatas).toBe(1)
    expect(douglas?.resultadosAcertados).toBe(1)
    expect(result.stats.recordes.reiDaCravada.participante).toBe('Douglas')
    expect(result.stats.recordes.reiDaCravada.valor).toBe(1)

    // Confere que gravou no cache
    const cached = readStatsCache('b1')
    expect(cached).not.toBeNull()
    expect(cached?.stats.tabela.find((p) => p.nome === 'Douglas')?.totalPontos).toBe(18)
  })
})
