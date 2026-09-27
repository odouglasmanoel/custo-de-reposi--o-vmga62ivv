import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FichaJogo } from './FichaJogo'
import * as eventosService from '@/services/eventosJogo'

const mockAuth = {
  isAdmin: false,
  user: { id: 'user-1', name: 'Teste' },
  participantName: 'Teste',
}

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}))

vi.mock('@/services/eventosJogo', () => ({
  fetchEventosJogo: vi.fn(),
}))

describe('Componente FichaJogo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.isAdmin = false
    mockAuth.participantName = 'Teste'
  })
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
      // Richarlison entrou (⬆ verde), Endrick saiu (⬇ vermelho)
      expect(screen.getByText(/⬆ Richarlison/)).toBeDefined()
      expect(screen.getByText(/⬇ Endrick/)).toBeDefined()
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

  it('mostra mensagem amigável caso ocorra erro ou limite de cota sem quebrar em jogo sem dados locais', async () => {
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

  it('NÃO exibe faixa amarela de erro de API externa quando jogo possui placar ou marcadores locais', async () => {
    vi.mocked(eventosService.fetchEventosJogo).mockResolvedValueOnce({
      success: false,
      error: 'API externa retornou status 403',
      events: [],
    })

    render(
      <FichaJogo
        fixtureId="1628997"
        timeA="Estados Unidos"
        timeB="Peru"
        placarA={4}
        placarB={1}
        golsTimeA={[{ nome: 'Balogun', minuto: "15'" }]}
        golsTimeB={[]}
        defaultOpen={true}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Balogun')).toBeDefined()
    })
    expect(screen.queryByText(/API externa retornou status 403/i)).toBeNull()
  })

  describe('Regras de Exibição e Trava do Botão Atualizar Eventos', () => {
    it('NÃO exibe o botão Atualizar Eventos para participante comum (não-admin) com ficha aberta', () => {
      mockAuth.isAdmin = false

      render(
        <FichaJogo fixtureId="1004" timeA="Portugal" timeB="País de Gales" defaultOpen={true} />,
      )

      expect(screen.queryByTitle('Atualizar eventos')).toBeNull()
      expect(screen.queryByLabelText('Atualizar eventos')).toBeNull()
    })

    it('EXIBE o botão Atualizar Eventos habilitado para Administrador em jogo aberto / em andamento', async () => {
      mockAuth.isAdmin = true

      vi.mocked(eventosService.fetchEventosJogo).mockResolvedValueOnce({
        success: true,
        events: [],
      })

      render(
        <FichaJogo
          fixtureId="1005"
          timeA="Portugal"
          timeB="País de Gales"
          isConcluido={false}
          defaultOpen={true}
        />,
      )

      const refreshBtn = screen.getByTitle('Atualizar eventos')
      expect(refreshBtn).toBeDefined()
      expect((refreshBtn as HTMLButtonElement).disabled).toBe(false)

      fireEvent.click(refreshBtn)

      expect(eventosService.fetchEventosJogo).toHaveBeenCalledWith({
        fixtureId: '1005',
        jogoId: undefined,
        forceRefresh: true,
      })
    })

    it('DESABILITA o botão Atualizar Eventos para Administrador quando a partida estiver encerrada (isConcluido=true)', () => {
      mockAuth.isAdmin = true

      render(
        <FichaJogo
          fixtureId="1006"
          timeA="Portugal"
          timeB="País de Gales"
          isConcluido={true}
          defaultOpen={true}
        />,
      )

      const refreshBtn = screen.getByRole('button', {
        name: /Partida encerrada: dados consolidados no banco de dados/i,
      })
      expect(refreshBtn).toBeDefined()
      expect((refreshBtn as HTMLButtonElement).disabled).toBe(true)

      // Clicar no botão desabilitado não dispara nova requisição
      fireEvent.click(refreshBtn)
      expect(eventosService.fetchEventosJogo).not.toHaveBeenCalledWith(
        expect.objectContaining({ forceRefresh: true }),
      )
    })

    it('DESABILITA o botão para Administrador quando resultado_finalizado=true ou status="finalizado"', () => {
      mockAuth.isAdmin = true

      render(
        <FichaJogo
          fixtureId="1007"
          timeA="Brasil"
          timeB="Argentina"
          resultado_finalizado={true}
          defaultOpen={true}
        />,
      )

      const refreshBtn = screen.getByRole('button', {
        name: /Partida encerrada: dados consolidados no banco de dados/i,
      })
      expect(refreshBtn).toBeDefined()
      expect((refreshBtn as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
