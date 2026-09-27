import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { TeamShield } from './BolaoDashboard'
import * as flagsModule from '@/lib/flags'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAdmin: false,
    user: { id: 'user-1', name: 'Teste' },
    participantName: 'Teste',
  }),
}))

vi.mock('@/context/ActivePoolContext', () => ({
  useActivePool: () => ({
    boloes: [],
    activeBolao: null,
    activeBolaoId: null,
    setActiveBolaoId: vi.fn(),
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

describe('TeamShield (BolaoDashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagsModule.fixtureLogosMemoryCache.clear()
  })

  it('(c) resolve nível 1 (fichaDetalhes) já no primeiro render quando escudo inicial é vazio', () => {
    const fichaDetalhes = {
      teams: {
        home: {
          id: 1098,
          name: 'Lithuania',
          logo: 'https://media.api-sports.io/football/teams/1098.png',
        },
        away: {
          id: 1097,
          name: 'Azerbaijan',
          logo: 'https://media.api-sports.io/football/teams/1097.png',
        },
      },
    }

    render(
      <TeamShield
        escudo=""
        nomeTime="Lituânia"
        sigla="LI"
        fichaDetalhes={fichaDetalhes}
        isSide="home"
      />,
    )

    // Não deve ficar preso na sigla "LI", deve renderizar a imagem com o logo de 1098
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toBe('https://media.api-sports.io/football/teams/1098.png')
    expect(screen.queryByText('LI')).toBeNull()
  })

  it('(c2) resolve nível 1 quando fichaDetalhes for string JSON não parseada', () => {
    const fichaJsonStr = JSON.stringify({
      teams: {
        home: {
          id: 1098,
          name: 'Lithuania',
          logo: 'https://media.api-sports.io/football/teams/1098.png',
        },
        away: {
          id: 1097,
          name: 'Azerbaijan',
          logo: 'https://media.api-sports.io/football/teams/1097.png',
        },
      },
    })

    render(
      <TeamShield
        escudo=""
        nomeTime="Azerbaijão"
        sigla="AZ"
        fichaDetalhes={fichaJsonStr}
        isSide="away"
      />,
    )

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toBe('https://media.api-sports.io/football/teams/1097.png')
    expect(screen.queryByText('AZ')).toBeNull()
  })

  it('(c3) resolve nível 2 síncrono via fixtureLogosMemoryCache quando escudo inicial é vazio', () => {
    flagsModule.fixtureLogosMemoryCache.set('777888', {
      home: 'https://media.api-sports.io/football/teams/777.png',
      away: 'https://media.api-sports.io/football/teams/888.png',
    })

    render(<TeamShield escudo="" nomeTime="Time A" sigla="TA" fixtureId="777888" isSide="home" />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toBe('https://media.api-sports.io/football/teams/777.png')
    expect(screen.queryByText('TA')).toBeNull()
  })

  it('(c4) dispara nível 2 assíncrono (fetchAndCacheFixtureLogos) quando escudo inicial é vazio e cache em memória não tem o logo', async () => {
    const spyFetch = vi.spyOn(flagsModule, 'fetchAndCacheFixtureLogos').mockResolvedValueOnce({
      home: 'https://media.api-sports.io/football/teams/9991.png',
      away: 'https://media.api-sports.io/football/teams/9992.png',
    })

    render(<TeamShield escudo="" nomeTime="Time C" sigla="TC" fixtureId="12345" isSide="away" />)

    expect(spyFetch).toHaveBeenCalledWith('12345')

    await waitFor(() => {
      const img = screen.getByRole('img') as HTMLImageElement
      expect(img).toBeDefined()
      expect(img.src).toBe('https://media.api-sports.io/football/teams/9992.png')
    })
  })
})
