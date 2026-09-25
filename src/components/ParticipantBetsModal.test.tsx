import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ParticipantBetsModal } from './ParticipantBetsModal'
import pb from '@/lib/pocketbase/client'

// Mock do PocketBase
vi.mock('@/lib/pocketbase/client', () => ({
  default: {
    collection: vi.fn(),
  },
}))

// Mock do AuthContext
const mockAuth = {
  user: { id: 'user-1', name: 'Teste' } as any,
  token: 'mock-token',
  loading: false,
  isBolaoMember: true,
  isAdmin: false,
  participantName: 'Teste',
  logout: vi.fn(),
  refreshUser: vi.fn(),
}

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
  BOLAO_MEMBERS: ['Douglas', 'Gabriel', 'Bruno Lopes', 'Bruno Xavier', 'Davi', 'Willian'],
  ADMIN_MEMBER: 'Douglas',
}))

describe('ParticipantBetsModal - Privacidade de Palpites de Adversários', () => {
  const mockBoloes = [
    {
      id: 'bolao-copa',
      nome: 'Copa Coni',
      ativo: true,
      criador: 'user-admin',
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    },
  ]

  const mockParticipanteWillian = {
    id: 'part-willian',
    nome: 'Willian',
    pontuacao_total: 6,
  }

  // Jogos:
  // 1. Jogo Encerrado (passado)
  const jogoEncerrado = {
    id: 'jogo-encerrado-1',
    bolao: 'bolao-copa',
    time_a: 'Brasil',
    time_b: 'Argentina',
    data: '2026-06-10',
    hora: '16:00',
    status: 'finalizado',
    resultado_finalizado: true,
    placar_a: 2,
    placar_b: 1,
  }

  // 2. Jogo Ao Vivo (em andamento)
  const jogoAoVivo = {
    id: 'jogo-aovivo-2',
    bolao: 'bolao-copa',
    time_a: 'França',
    time_b: 'Alemanha',
    data: '2026-06-15',
    hora: '16:00',
    status: 'ao_vivo',
    resultado_finalizado: false,
    placar_a: 1,
    placar_b: 0,
  }

  // 3. Jogo Futuro / Pendente
  const jogoFuturo = {
    id: 'jogo-futuro-3',
    bolao: 'bolao-copa',
    time_a: 'Inglaterra',
    time_b: 'Espanha',
    data: '2026-09-26',
    hora: '15:45',
    status: 'pendente',
    resultado_finalizado: false,
    placar_a: 0,
    placar_b: 0,
  }

  const mockPalpites = [
    {
      id: 'palpite-1',
      bolao: 'bolao-copa',
      jogo: 'jogo-encerrado-1',
      participante: 'part-willian',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 8,
      goleadores_a: ['Vini Jr'],
      goleadores_b: ['Messi'],
    },
    {
      id: 'palpite-2',
      bolao: 'bolao-copa',
      jogo: 'jogo-aovivo-2',
      participante: 'part-willian',
      placar_a: 1,
      placar_b: 0,
      pontuacao_jogo: 0,
      goleadores_a: ['Mbappé'],
      goleadores_b: [],
    },
    {
      id: 'palpite-3',
      bolao: 'bolao-copa',
      jogo: 'jogo-futuro-3',
      participante: 'part-willian',
      placar_a: 2,
      placar_b: 2,
      pontuacao_jogo: 0,
      goleadores_a: ['Bellingham', 'Harry Kane'],
      goleadores_b: ['Dani Olmo', 'Yamal'],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Configuração padrão dos retornos de banco
    const mockCollection = vi.fn().mockImplementation((colName: string) => {
      if (colName === 'participantes') {
        return {
          getFullList: vi
            .fn()
            .mockResolvedValue([{ id: 'part-willian', nome: 'Willian', bolao: 'bolao-copa' }]),
        }
      }
      if (colName === 'palpites') {
        return {
          getFullList: vi.fn().mockResolvedValue(mockPalpites),
        }
      }
      if (colName === 'jogos') {
        return {
          getFullList: vi.fn().mockResolvedValue([jogoEncerrado, jogoAoVivo, jogoFuturo]),
        }
      }
      return {
        getFullList: vi.fn().mockResolvedValue([]),
      }
    })

    ;(pb.collection as any) = mockCollection
  })

  it('oculta palpites de jogos futuros quando o usuário logado for um adversário comum (não-admin)', async () => {
    mockAuth.isAdmin = false
    mockAuth.participantName = 'Teste'
    mockAuth.user = { id: 'user-teste', name: 'Teste' } as any

    render(
      <ParticipantBetsModal
        open={true}
        onOpenChange={vi.fn()}
        participante={mockParticipanteWillian}
        activeBolaoId="bolao-copa"
        boloes={mockBoloes as any}
      />,
    )

    // Aguarda carregar
    await waitFor(() => {
      // Jogo encerrado DEVE aparecer
      expect(screen.getByText('Brasil x Argentina')).toBeDefined()
      // Jogo ao vivo DEVE aparecer
      expect(screen.getByText('França x Alemanha')).toBeDefined()
    })

    // Jogo futuro (Inglaterra x Espanha) NÃO deve aparecer para o adversário
    expect(screen.queryByText('Inglaterra x Espanha')).toBeNull()
    // Marcadores do palpite futuro também não devem estar visíveis
    expect(screen.queryByText(/Bellingham/i)).toBeNull()
  })

  it('exibe todos os palpites (inclusive de jogos futuros) quando o usuário logado for Administrador', async () => {
    mockAuth.isAdmin = true
    mockAuth.participantName = 'Douglas'
    mockAuth.user = { id: 'user-admin', name: 'Douglas' } as any

    render(
      <ParticipantBetsModal
        open={true}
        onOpenChange={vi.fn()}
        participante={mockParticipanteWillian}
        activeBolaoId="bolao-copa"
        boloes={mockBoloes as any}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Brasil x Argentina')).toBeDefined()
      expect(screen.getByText('França x Alemanha')).toBeDefined()
      // Para admin, jogo futuro DEVE aparecer
      expect(screen.getByText('Inglaterra x Espanha')).toBeDefined()
    })
  })

  it('exibe todos os palpites quando o usuário logado for o próprio dono dos palpites (ex: Willian vendo Willian)', async () => {
    mockAuth.isAdmin = false
    mockAuth.participantName = 'Willian'
    mockAuth.user = { id: 'user-willian', name: 'Willian' } as any

    render(
      <ParticipantBetsModal
        open={true}
        onOpenChange={vi.fn()}
        participante={mockParticipanteWillian}
        activeBolaoId="bolao-copa"
        boloes={mockBoloes as any}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Brasil x Argentina')).toBeDefined()
      expect(screen.getByText('França x Alemanha')).toBeDefined()
      // O próprio dono vê seu jogo futuro
      expect(screen.getByText('Inglaterra x Espanha')).toBeDefined()
    })
  })

  it('exibe mensagem amigável quando todos os palpites do adversário forem de jogos futuros', async () => {
    mockAuth.isAdmin = false
    mockAuth.participantName = 'Teste'
    mockAuth.user = { id: 'user-teste', name: 'Teste' } as any

    // Mock apenas com o palpite futuro
    const mockCollectionOnlyFuture = vi.fn().mockImplementation((colName: string) => {
      if (colName === 'participantes') {
        return {
          getFullList: vi
            .fn()
            .mockResolvedValue([{ id: 'part-willian', nome: 'Willian', bolao: 'bolao-copa' }]),
        }
      }
      if (colName === 'palpites') {
        return {
          getFullList: vi.fn().mockResolvedValue([mockPalpites[2]]), // Apenas o futuro
        }
      }
      if (colName === 'jogos') {
        return {
          getFullList: vi.fn().mockResolvedValue([jogoFuturo]),
        }
      }
      return {
        getFullList: vi.fn().mockResolvedValue([]),
      }
    })

    ;(pb.collection as any) = mockCollectionOnlyFuture

    render(
      <ParticipantBetsModal
        open={true}
        onOpenChange={vi.fn()}
        participante={mockParticipanteWillian}
        activeBolaoId="bolao-copa"
        boloes={mockBoloes as any}
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          'Os palpites de Willian ficarão visíveis assim que as partidas iniciarem.',
        ),
      ).toBeDefined()
    })
  })
})
