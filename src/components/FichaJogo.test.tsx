import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FichaJogo } from './FichaJogo'
import * as eventosService from '@/services/eventosJogo'

vi.mock('@/services/eventosJogo', () => ({
  fetchEventosJogo: vi.fn(),
}))

describe('Componente FichaJogo', () => {
  it('renderiza o botão colapsado por padrão', () => {
    render(<FichaJogo fixtureId="1001" timeA="Brasil" timeB="Argentina" />)
    expect(screen.getByText('Ver Ficha do Jogo')).toBeDefined()
    expect(screen.queryByText('Carregando timeline de eventos...')).toBeNull()
  })

  it('faz requisição apenas ao expandir (lazy load) e exibe os eventos', async () => {
    const mockEvents: eventosService.MatchEvent[] = [
      {
        time: { elapsed: 23 },
        team: { name: 'Brasil', side: 'home' },
        player: { name: 'Neymar Jr' },
        type: 'Goal',
        detail: 'Normal Goal',
        category: 'goal',
      },
      {
        time: { elapsed: 35 },
        team: { name: 'Argentina', side: 'away' },
        player: { name: 'De Paul' },
        type: 'Card',
        detail: 'Yellow Card',
        category: 'card',
      },
      {
        time: { elapsed: 70 },
        team: { name: 'Brasil', side: 'home' },
        player: { name: 'Endrick' },
        assist: { name: 'Richarlison' },
        type: 'subst',
        detail: 'Substitution',
        category: 'subst',
      },
    ]

    vi.mocked(eventosService.fetchEventosJogo).mockResolvedValueOnce({
      success: true,
      events: mockEvents,
    })

    render(<FichaJogo fixtureId="1001" timeA="Brasil" timeB="Argentina" placarA={1} placarB={0} />)

    const btn = screen.getByText('Ver Ficha do Jogo')
    fireEvent.click(btn)

    // O botão muda de texto
    expect(screen.getByText('Ocultar Ficha do Jogo')).toBeDefined()

    // O serviço deve ter sido chamado com a fixture correta
    expect(eventosService.fetchEventosJogo).toHaveBeenCalledWith({
      fixtureId: '1001',
      jogoId: undefined,
      forceRefresh: false,
    })

    // Aguarda carregar e exibe os jogadores na timeline
    await waitFor(() => {
      expect(screen.getByText('Neymar Jr')).toBeDefined()
      expect(screen.getByText("23'")).toBeDefined()
      expect(screen.getByText('De Paul')).toBeDefined()
      expect(screen.getByText("35'")).toBeDefined()
    })
  })

  it('exibe marcadores locais caso a API não tenha eventos registrados', async () => {
    vi.mocked(eventosService.fetchEventosJogo).mockResolvedValueOnce({
      success: true,
      events: [],
    })

    render(
      <FichaJogo
        fixtureId="1002"
        timeA="Palmeiras"
        timeB="Santos"
        golsTimeA={[{ nome: "Veiga 32'", minuto: "32'" }]}
        golsTimeB={[]}
        defaultOpen={true}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Veiga')).toBeDefined()
      expect(screen.getByText("32'")).toBeDefined()
    })
  })

  it('mostra mensagem amigável caso ocorra erro ou limite de cota sem quebrar', async () => {
    vi.mocked(eventosService.fetchEventosJogo).mockResolvedValueOnce({
      success: true,
      rate_limited: true,
      notice:
        'Cota diária da API-Sports atingida (80 req/dia). Reset às 21h (horário de Brasília). Exibindo dados locais.',
      events: [],
    })

    render(<FichaJogo fixtureId="1003" timeA="Flamengo" timeB="Vasco" defaultOpen={true} />)

    await waitFor(() => {
      expect(screen.getByText(/Cota diária da API-Sports atingida/i)).toBeDefined()
    })
  })
})
