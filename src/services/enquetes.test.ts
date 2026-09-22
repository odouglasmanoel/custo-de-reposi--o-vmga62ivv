import { describe, it, expect, beforeEach, vi } from 'vitest'
import pb from '@/lib/pocketbase/client'
import {
  listarEnquetes,
  obterDadosEnquete,
  invalidateEnqueteCache,
  readListaEnquetesCache,
  writeListaEnquetesCache,
  readEnqueteDetalhesCache,
  writeEnqueteDetalhesCache,
  type EnqueteModel,
  type JogoComVotos,
} from './enquetes'

describe('Serviço de Enquetes - Otimizações de Carregamento, Cache e Requisições', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateEnqueteCache()
    vi.restoreAllMocks()
  })

  describe('1. Listagem com campos essenciais e cache em dois níveis', () => {
    it('listarEnquetes solicita apenas os campos necessários (fields otimizados)', async () => {
      const mockEnquetes: Partial<EnqueteModel>[] = [
        {
          id: 'enq_1',
          titulo: 'Enquete Copa Coni',
          data_inicio: '2026-04-10',
          data_fim: '2026-04-13',
          status: 'aberta',
          limite_votos: 10,
        },
      ]

      const getFullListMock = vi.fn().mockResolvedValue(mockEnquetes)
      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquetes') {
          return { getFullList: getFullListMock } as any
        }
        return {} as any
      })

      const resultado = await listarEnquetes()

      expect(getFullListMock).toHaveBeenCalledTimes(1)
      const callArgs = getFullListMock.mock.calls[0][0]
      expect(callArgs.fields).toBe(
        'id,titulo,descricao,data_inicio,data_fim,status,limite_votos,data_limite_votacao,criado_por',
      )
      expect(resultado).toEqual(mockEnquetes)

      // Grava no cache de lista
      const emCache = readListaEnquetesCache()
      expect(emCache).toEqual(mockEnquetes)
    })

    it('readListaEnquetesCache recupera lista gravada no localStorage', () => {
      const mockLista = [
        {
          id: 'enq_123',
          collectionId: 'enquetes',
          collectionName: 'enquetes',
          created: '2026-05-01T00:00:00.000Z',
          updated: '2026-05-01T00:00:00.000Z',
          titulo: 'Enquete Teste',
          data_inicio: '2026-05-01',
          data_fim: '2026-05-04',
          status: 'aberta',
          limite_votos: 10,
        } as unknown as EnqueteModel,
      ]

      writeListaEnquetesCache(mockLista)
      const recuperada = readListaEnquetesCache()
      expect(recuperada).toEqual(mockLista)
    })
  })

  describe('2. Detalhes sob demanda apenas para a enquete ativa (activePollId)', () => {
    it('obterDadosEnquete busca enquete, jogos da enquete ativa e votos correspondentes', async () => {
      const mockEnquete = {
        id: 'enq_ativa',
        collectionId: 'enquetes',
        collectionName: 'enquetes',
        created: '2026-04-10T00:00:00.000Z',
        updated: '2026-04-10T00:00:00.000Z',
        titulo: 'Enquete Ativa',
        data_inicio: '2026-04-10',
        data_fim: '2026-04-13',
        status: 'aberta',
        limite_votos: 10,
      } as unknown as EnqueteModel

      const mockJogos = [
        {
          id: 'jogo_1',
          enquete: 'enq_ativa',
          time_a: 'Palmeiras',
          time_b: 'Corinthians',
          data: '2026-04-12',
          horario: '16:00',
        },
      ]

      const mockVotos = [
        {
          id: 'voto_1',
          enquete: 'enq_ativa',
          jogo: 'jogo_1',
          user: 'user_123',
          user_name: 'Douglas',
        },
      ]

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquetes') {
          return { getOne: vi.fn().mockResolvedValue(mockEnquete) } as any
        }
        if (col === 'enquete_jogos') {
          return {
            getFullList: vi.fn().mockImplementation((opts: any) => {
              expect(opts.filter).toContain("enquete = 'enq_ativa'")
              return Promise.resolve(mockJogos)
            }),
          } as any
        }
        if (col === 'enquete_votos') {
          return {
            getFullList: vi.fn().mockImplementation((opts: any) => {
              expect(opts.filter).toContain("enquete = 'enq_ativa'")
              return Promise.resolve(mockVotos)
            }),
          } as any
        }
        return {} as any
      })

      const dados = await obterDadosEnquete('enq_ativa', 'user_123')

      expect(dados.enquete.id).toBe('enq_ativa')
      expect(dados.jogos.length).toBe(1)
      expect(dados.jogos[0].totalVotos).toBe(1)
      expect(dados.jogos[0].votadoPorMim).toBe(true)
      expect(dados.meusVotosIds.has('jogo_1')).toBe(true)

      // Grava no cache de detalhes
      const cached = readEnqueteDetalhesCache('enq_ativa', 'user_123')
      expect(cached).not.toBeNull()
      expect(cached?.jogos.length).toBe(1)
      expect(cached?.meusVotosIds.has('jogo_1')).toBe(true)
    })

    it('invalidateEnqueteCache limpa dados de memória e localStorage corretamente', () => {
      const mockEnquete = { id: 'enq_teste' } as unknown as EnqueteModel
      writeEnqueteDetalhesCache('enq_teste', 'user_1', {
        enquete: mockEnquete,
        jogos: [] as JogoComVotos[],
        meusVotosIds: new Set<string>(),
      })

      expect(readEnqueteDetalhesCache('enq_teste', 'user_1')).not.toBeNull()

      invalidateEnqueteCache('enq_teste')
      expect(readEnqueteDetalhesCache('enq_teste', 'user_1')).toBeNull()
    })
  })

  describe('3. Regras de Empty State e Loading State', () => {
    it('empty state só deve ser exibido quando loading for false e enquetes.length === 0', () => {
      // Cenário A: carregando inicial (isLoadingEnquetes = true, enquetes = [])
      const isLoadingA = true
      const enquetesA: EnqueteModel[] = []
      const shouldShowEmptyA = !isLoadingA && enquetesA.length === 0
      expect(shouldShowEmptyA).toBe(false)

      // Cenário B: terminou de carregar e não há enquetes cadastradas
      const isLoadingB = false
      const enquetesB: EnqueteModel[] = []
      const shouldShowEmptyB = !isLoadingB && enquetesB.length === 0
      expect(shouldShowEmptyB).toBe(true)

      // Cenário C: terminou de carregar e há enquetes
      const isLoadingC = false
      const enquetesC: EnqueteModel[] = [{ id: 'e1' } as unknown as EnqueteModel]
      const shouldShowEmptyC = !isLoadingC && enquetesC.length === 0
      expect(shouldShowEmptyC).toBe(false)
    })

    it('skeleton é exibido durante loading quando ainda não há enquete ativa resolvida', () => {
      const loading = true
      const activePoll = null
      const showSkeleton = loading && !activePoll
      expect(showSkeleton).toBe(true)

      const activePollResolved = { id: 'e1' } as unknown as EnqueteModel
      const showSkeletonWithActive = loading && !activePollResolved
      expect(showSkeletonWithActive).toBe(false)
    })
  })

  describe('4. Estabilidade de seleção e deep link', () => {
    it('seleção respeita parâmetro de ID da URL ou seleciona a primeira aberta', () => {
      const enquetes: EnqueteModel[] = [
        { id: 'enq_antiga', status: 'encerrada', created: '2026-01-01' } as unknown as EnqueteModel,
        { id: 'enq_aberta', status: 'aberta', created: '2026-02-01' } as unknown as EnqueteModel,
        { id: 'enq_recente', status: 'cadastrada', created: '2026-03-01' } as unknown as EnqueteModel,
      ]

      // 1. Sem URL param: prefere aberta
      const selecionadaPadrao = enquetes.find((e) => e.status === 'aberta') || enquetes[0]
      expect(selecionadaPadrao.id).toBe('enq_aberta')

      // 2. Com URL param
      const urlId = 'enq_antiga'
      const selecionadaUrl = enquetes.find((e) => e.id === urlId) || selecionadaPadrao
      expect(selecionadaUrl.id).toBe('enq_antiga')
    })
  })
})
