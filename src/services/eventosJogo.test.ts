import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchEventosJogo, clearFichaJogoCache } from './eventosJogo'
import pb from '@/lib/pocketbase/client'

vi.mock('@/lib/pocketbase/client', () => ({
  default: {
    send: vi.fn(),
  },
}))

describe('serviço fetchEventosJogo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearFichaJogoCache()
  })

  it('retorna erro se fixtureId e jogoId estiverem vazios', async () => {
    const res = await fetchEventosJogo({ fixtureId: '', jogoId: '' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('ID da partida não informado')
    expect(pb.send).not.toHaveBeenCalled()
  })

  it('faz requisição ao backend e armazena em cache', async () => {
    const mockEvents = [
      {
        time: { elapsed: 15 },
        team: { name: 'Brasil', side: 'away' as const },
        player: { name: 'Vini Jr' },
        type: 'Goal',
        detail: 'Normal Goal',
      },
      {
        time: { elapsed: 42 },
        team: { name: 'Austrália', side: 'home' as const },
        player: { name: 'Irvine' },
        type: 'Card',
        detail: 'Yellow Card',
      },
      {
        time: { elapsed: 60 },
        team: { name: 'Brasil', side: 'away' as const },
        player: { name: 'Endrick' },
        assist: { name: 'Rodrygo' },
        type: 'subst',
        detail: 'Substitution',
      },
    ]

    vi.mocked(pb.send).mockResolvedValueOnce({
      success: true,
      fixture_id: '12345',
      events: mockEvents,
    })

    // Primeira chamada: consulta backend
    const res1 = await fetchEventosJogo({ fixtureId: '12345' })
    expect(res1.success).toBe(true)
    expect(res1.events.length).toBe(3)
    expect(res1.events[0].category).toBe('goal')
    expect(res1.events[1].category).toBe('card')
    expect(res1.events[2].category).toBe('subst')
    expect(pb.send).toHaveBeenCalledTimes(1)

    // Segunda chamada (sem forceRefresh): deve retornar do cache sem chamar pb.send novamente
    const res2 = await fetchEventosJogo({ fixtureId: '12345' })
    expect(res2.success).toBe(true)
    expect(res2.events.length).toBe(3)
    expect(pb.send).toHaveBeenCalledTimes(1) // Continua 1 -> cache funcionou!
  })

  it('trata falha do backend amigavelmente sem estourar exceção', async () => {
    vi.mocked(pb.send).mockRejectedValueOnce(new Error('Falha de rede'))

    const res = await fetchEventosJogo({ fixtureId: '99999' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Falha de rede')
    expect(res.events).toEqual([])
  })
})
