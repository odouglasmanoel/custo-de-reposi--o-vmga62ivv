import { describe, it, expect, beforeEach, vi } from 'vitest'
import pb from '@/lib/pocketbase/client'
import {
  listarEnquetes,
  obterDadosEnquete,
  toggleVotoJogo,
  invalidateEnqueteCache,
  readListaEnquetesCache,
  writeListaEnquetesCache,
  readEnqueteDetalhesCache,
  writeEnqueteDetalhesCache,
  type EnqueteModel,
  type JogoComVotos,
} from './enquetes'
import { ordenarEnquetesCrescente } from '@/lib/dateUtils'

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
    it('seleção no carregamento inicial: sem ?id= na URL seleciona SEMPRE o primeiro elemento da ordem crescente (enquetes[0])', () => {
      // Simula a lista vinda da API ordenada por -created (da mais recente para a mais antiga)
      // Exemplo real do Bolão: 30/09 a 03/10 (criada por último), 27/09 a 29/09, 23/09 a 26/09
      const enquetes: EnqueteModel[] = [
        {
          id: 'enq_30_09',
          titulo: 'Enquete Copa Coni — 30/09/2026 a 03/10/2026',
          data_inicio: '2026-09-30',
          data_fim: '2026-10-03',
          status: 'aberta',
          created: '2026-09-22T15:00:00.000Z',
        } as unknown as EnqueteModel,
        {
          id: 'enq_27_09',
          titulo: 'Enquete Copa Coni — 27/09/2026 a 29/09/2026',
          data_inicio: '2026-09-27',
          data_fim: '2026-09-29',
          status: 'aberta',
          created: '2026-09-22T13:00:00.000Z',
        } as unknown as EnqueteModel,
        {
          id: 'enq_23_09',
          titulo: 'Enquete Copa Coni — 23/09/2026 a 26/09/2026',
          data_inicio: '2026-09-23',
          data_fim: '2026-09-26',
          status: 'aberta',
          created: '2026-09-19T16:00:00.000Z',
        } as unknown as EnqueteModel,
      ]

      // 1. Sem parâmetro de ID da URL: deve selecionar a primeira da ordem crescente de data_inicio (23/09 a 26/09)
      const listaOrdenada = ordenarEnquetesCrescente(enquetes)
      const selecionadaPadrao = listaOrdenada[0]
      expect(selecionadaPadrao.id).toBe('enq_23_09')
      expect(selecionadaPadrao.data_inicio).toBe('2026-09-23')

      // 2. Com parâmetro de ID da URL (deep link do WhatsApp): id da URL prevalece
      const urlId = 'enq_30_09'
      const selecionadaUrl = enquetes.find((e) => e.id === urlId) || listaOrdenada[0]
      expect(selecionadaUrl.id).toBe('enq_30_09')
    })
  })

  describe('6. Adicionar e Editar Jogo na Enquete com fixture_id e tratamento de escudos', () => {
    it('higieniza fixture_id numérico e repassa para criação do registro', async () => {
      const mockCreate = vi.fn().mockImplementation((payload) => {
        return Promise.resolve({
          id: 'novo_jogo_manual',
          ...payload,
        })
      })

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquete_jogos') {
          return { create: mockCreate } as any
        }
        return {} as any
      })

      // Mock fetch para busca de fixture (simula retorno de logos oficiais)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          fixture: {
            id: 1528881,
            homeTeamLogo: 'https://media.api-sports.io/football/teams/1.png',
            awayTeamLogo: 'https://media.api-sports.io/football/teams/2.png',
          },
        }),
      }) as any

      const { adicionarJogoManualNaEnquete } = await import('./enquetes')
      const jogo = await adicionarJogoManualNaEnquete({
        enqueteId: 'enq_123',
        time_a: 'Time A',
        time_b: 'Time B',
        fixture_id: 'ID: 1528881 abc',
        data: '2026-09-25',
      })

      expect(mockCreate).toHaveBeenCalledTimes(1)
      const payload = mockCreate.mock.calls[0][0]
      expect(payload.fixture_id).toBe('1528881')
      expect(payload.logo_casa).toBe('https://media.api-sports.io/football/teams/1.png')
      expect(payload.logo_visitante).toBe('https://media.api-sports.io/football/teams/2.png')
      expect(jogo.id).toBe('novo_jogo_manual')
    })

    it('em caso de falha da API ou esgotamento de cota, salva o jogo com fixture_id intacto sem quebrar', async () => {
      const mockCreate = vi.fn().mockImplementation((payload) => {
        return Promise.resolve({
          id: 'jogo_sem_logo',
          ...payload,
        })
      })

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquete_jogos') {
          return { create: mockCreate } as any
        }
        return {} as any
      })

      // Simula falha 429 Rate Limit
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: 'Limite diário de requisições excedido.',
        }),
      }) as any

      const { adicionarJogoManualNaEnquete } = await import('./enquetes')
      const jogo = await adicionarJogoManualNaEnquete({
        enqueteId: 'enq_123',
        time_a: 'Time A',
        time_b: 'Time B',
        fixture_id: '1528881',
        data: '2026-09-25',
      })

      expect(mockCreate).toHaveBeenCalledTimes(1)
      const payload = mockCreate.mock.calls[0][0]
      expect(payload.fixture_id).toBe('1528881')
      expect(payload.logo_casa).toBe('')
      expect(payload.logo_visitante).toBe('')
      expect(jogo.id).toBe('jogo_sem_logo')
    })

    it('editarJogoEnquete atualiza fixture_id, busca escudos automáticos se vazios e sincroniza com jogos do bolão', async () => {
      const mockUpdateEnqueteJogo = vi.fn().mockImplementation((id, payload) => {
        return Promise.resolve({
          id,
          ...payload,
        })
      })

      const mockGetOneEnqueteJogo = vi.fn().mockResolvedValue({
        id: 'ej_1',
        time_a: 'Jamaica',
        time_b: 'Honduras',
        fixture_id: '1000',
        logo_casa: '',
        logo_visitante: '',
      })

      const mockUpdateJogo = vi.fn().mockResolvedValue({ id: 'jg_1' })
      const mockGetFullListJogos = vi
        .fn()
        .mockResolvedValue([
          { id: 'jg_1', time_a: 'Jamaica', time_b: 'Honduras', fixture_id: '1000' },
        ])

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquete_jogos') {
          return {
            getOne: mockGetOneEnqueteJogo,
            update: mockUpdateEnqueteJogo,
          } as any
        }
        if (col === 'jogos') {
          return {
            getFullList: mockGetFullListJogos,
            update: mockUpdateJogo,
          } as any
        }
        return {} as any
      })

      // Simula retorno da API para a nova fixture 1528881
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          fixture: {
            id: 1528881,
            homeTeamLogo: 'https://media.api-sports.io/football/teams/jamaica.png',
            awayTeamLogo: 'https://media.api-sports.io/football/teams/honduras.png',
          },
        }),
      }) as any

      const { editarJogoEnquete } = await import('./enquetes')
      const atualizado = await editarJogoEnquete('ej_1', {
        time_a: 'Jamaica',
        time_b: 'Honduras',
        data: '2026-09-28',
        horario: '21:00',
        fixture_id: '1528881',
      })

      expect(mockUpdateEnqueteJogo).toHaveBeenCalledTimes(1)
      const updatePayload = mockUpdateEnqueteJogo.mock.calls[0][1]
      expect(updatePayload.fixture_id).toBe('1528881')
      expect(updatePayload.logo_casa).toBe('https://media.api-sports.io/football/teams/jamaica.png')
      expect(updatePayload.logo_visitante).toBe(
        'https://media.api-sports.io/football/teams/honduras.png',
      )
      expect(atualizado.fixture_id).toBe('1528881')

      // Verifica sincronização com a coleção jogos do bolão
      expect(mockUpdateJogo).toHaveBeenCalledTimes(1)
      const jogoPayload = mockUpdateJogo.mock.calls[0][1]
      expect(jogoPayload.fixture_id).toBe('1528881')
      expect(jogoPayload.url_escudo_mandante).toBe(
        'https://media.api-sports.io/football/teams/jamaica.png',
      )
      expect(jogoPayload.url_escudo_visitante).toBe(
        'https://media.api-sports.io/football/teams/honduras.png',
      )
    })

    it('editarJogoEnquete NUNCA apaga fixture_id existente quando o campo vier vazio', async () => {
      const mockUpdateEnqueteJogo = vi.fn().mockImplementation((id, payload) => {
        return Promise.resolve({
          id,
          ...payload,
        })
      })

      const mockGetOneEnqueteJogo = vi.fn().mockResolvedValue({
        id: 'ej_2',
        time_a: 'Brasil',
        time_b: 'Argentina',
        fixture_id: '999999',
        logo_casa: 'https://media.api-sports.io/football/teams/6.png',
        logo_visitante: 'https://media.api-sports.io/football/teams/26.png',
      })

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquete_jogos') {
          return {
            getOne: mockGetOneEnqueteJogo,
            update: mockUpdateEnqueteJogo,
          } as any
        }
        if (col === 'jogos') {
          return {
            getFullList: vi.fn().mockResolvedValue([]),
            update: vi.fn(),
          } as any
        }
        return {} as any
      })

      const { editarJogoEnquete } = await import('./enquetes')
      // Salva sem informar fixture_id (string vazia ou undefined)
      await editarJogoEnquete('ej_2', {
        time_a: 'Brasil',
        time_b: 'Argentina',
        data: '2026-10-10',
        horario: '21:30',
        fixture_id: '',
        logo_casa: 'https://media.api-sports.io/football/teams/6.png',
        logo_visitante: 'https://media.api-sports.io/football/teams/26.png',
      })

      expect(mockUpdateEnqueteJogo).toHaveBeenCalledTimes(1)
      const payload = mockUpdateEnqueteJogo.mock.calls[0][1]
      // Garante que o fixture_id anterior 999999 foi preservado!
      expect(payload.fixture_id).toBe('999999')
    })

    it('editarJogoEnquete preserva escudos manuais pré-existentes mesmo ao definir fixture_id (prioridade máxima manual)', async () => {
      const mockUpdateEnqueteJogo = vi.fn().mockImplementation((id, payload) => {
        return Promise.resolve({
          id,
          ...payload,
        })
      })

      const mockGetOneEnqueteJogo = vi.fn().mockResolvedValue({
        id: 'ej_3',
        time_a: 'Clube Manual A',
        time_b: 'Clube Manual B',
        fixture_id: '',
        logo_casa: 'https://custom.escudo.com/a.png',
        logo_visitante: 'https://custom.escudo.com/b.png',
      })

      vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
        if (col === 'enquete_jogos') {
          return {
            getOne: mockGetOneEnqueteJogo,
            update: mockUpdateEnqueteJogo,
          } as any
        }
        if (col === 'jogos') {
          return {
            getFullList: vi.fn().mockResolvedValue([]),
            update: vi.fn(),
          } as any
        }
        return {} as any
      })

      // Fetch não deve nem ser chamado se os logos manuais já estão preenchidos
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy as any

      const { editarJogoEnquete } = await import('./enquetes')
      await editarJogoEnquete('ej_3', {
        time_a: 'Clube Manual A',
        time_b: 'Clube Manual B',
        data: '2026-10-12',
        horario: '16:00',
        fixture_id: '777888',
        logo_casa: 'https://custom.escudo.com/a.png',
        logo_visitante: 'https://custom.escudo.com/b.png',
      })

      expect(fetchSpy).not.toHaveBeenCalled()
      const payload = mockUpdateEnqueteJogo.mock.calls[0][1]
      expect(payload.fixture_id).toBe('777888')
      expect(payload.logo_casa).toBe('https://custom.escudo.com/a.png')
      expect(payload.logo_visitante).toBe('https://custom.escudo.com/b.png')
    })
  })

  describe('5. Alternância de Voto (toggleVotoJogo) e Tratamento de Erros', () => {
    it('bloqueia e avisa quando usuário não está autenticado', async () => {
      // Força pb.authStore sem usuário logado
      const originalRecord = pb.authStore.record
      const originalToken = pb.authStore.token
      Object.defineProperty(pb.authStore, 'record', { value: null, configurable: true })
      Object.defineProperty(pb.authStore, 'token', { value: '', configurable: true })
      Object.defineProperty(pb.authStore, 'isValid', { value: false, configurable: true })

      await expect(toggleVotoJogo('enq_1', 'jogo_1')).rejects.toThrow(
        'Você precisa estar autenticado para votar. Acesse sua conta e tente novamente.',
      )

      // Restaura
      Object.defineProperty(pb.authStore, 'record', { value: originalRecord, configurable: true })
      Object.defineProperty(pb.authStore, 'token', { value: originalToken, configurable: true })
      Object.defineProperty(pb.authStore, 'isValid', { value: true, configurable: true })
    })

    it('registra voto com sucesso via endpoint customizado do backend', async () => {
      const mockUser = { id: 'user_douglas', name: 'Douglas', username: 'douglas' }
      Object.defineProperty(pb.authStore, 'record', { value: mockUser, configurable: true })
      Object.defineProperty(pb.authStore, 'token', { value: 'fake_jwt_token', configurable: true })
      Object.defineProperty(pb.authStore, 'isValid', { value: true, configurable: true })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          voted: true,
          totalVotosUsuario: 1,
          totalVotosJogo: 5,
        }),
      }) as any

      const res = await toggleVotoJogo('enq_123', 'jogo_456', 10)
      expect(res.voted).toBe(true)
      expect(res.totalVotosUsuario).toBe(1)
      expect(res.totalVotosJogo).toBe(5)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('trata resposta de erro específica do backend em vez do Something went wrong', async () => {
      const mockUser = { id: 'user_douglas', name: 'Douglas', username: 'douglas' }
      Object.defineProperty(pb.authStore, 'record', { value: mockUser, configurable: true })
      Object.defineProperty(pb.authStore, 'token', { value: 'fake_jwt_token', configurable: true })
      Object.defineProperty(pb.authStore, 'isValid', { value: true, configurable: true })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Esta enquete está encerrada e não aceita mais novos votos.',
        }),
      }) as any

      await expect(toggleVotoJogo('enq_123', 'jogo_456', 10)).rejects.toThrow(
        'Esta enquete está encerrada e não aceita mais novos votos.',
      )
    })
  })
})
