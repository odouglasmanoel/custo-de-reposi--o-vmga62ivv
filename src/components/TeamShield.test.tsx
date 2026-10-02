import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TeamShield } from './TeamShield'
import * as flagsModule from '@/lib/flags'

describe('TeamShield unificado (src/components/TeamShield.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagsModule.fixtureLogosMemoryCache.clear()
  })

  it('Prioridade 1: resolve ficha_detalhes síncrono e renderiza imagem sem mostrar monograma', () => {
    const ficha = {
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
      <TeamShield teamName="Lituânia" fixtureId={1208456} fichaDetalhes={ficha} isSide="home" />,
    )

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toBe('https://media.api-sports.io/football/teams/1098.png')
    expect(screen.queryByText('LI')).toBeNull()
  })

  it('Prioridade 2: resolve tabela canônica oficial por nome de clube (ex: Botafogo id 120, Coritiba id 132)', () => {
    render(<TeamShield teamName="Botafogo" />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toContain('/teams/120.png')
    expect(screen.queryByText('BO')).toBeNull()
  })

  it('Prioridade 2: Coritiba nunca colide com Chapecoense (Coritiba=132, Chapecoense=147)', () => {
    const { unmount } = render(<TeamShield teamName="Coritiba" />)
    let img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toContain('/teams/132.png')
    expect(screen.queryByText('CR')).toBeNull()
    unmount()

    render(<TeamShield teamName="Chapecoense" />)
    img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toContain('/teams/147.png')
    expect(screen.queryByText('CH')).toBeNull()
  })

  it('Prioridade 2: Seleção Brasileira e outras seleções recebem FlagCDN oficial', () => {
    render(<TeamShield teamName="Brasil" />)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toContain('flagcdn.com')
    expect(screen.queryByText('BR')).toBeNull()
  })

  it('Cascata de onError: se a URL principal falhar, tenta o próximo fallback antes de exibir sigla', () => {
    // Escudo inválido cadastrado manualmente para o Botafogo
    render(
      <TeamShield teamName="Botafogo" escudo="https://site-inexistente.com/logo-quebrado.png" />,
    )

    const img = screen.getByRole('img') as HTMLImageElement
    // Dispara erro na primeira URL
    fireEvent.error(img)

    // O componente avança para a próxima URL da cascata (tabela canônica do Botafogo: 120)
    expect(img.src).toContain('/teams/120.png')
    expect(screen.queryByText('BO')).toBeNull()
  })

  it('Paridade mobile e desktop: preserva dimensões mínimas e não esconde no mobile', () => {
    const { container } = render(
      <TeamShield
        teamName="Palmeiras"
        sizeClass="h-7 w-7 sm:h-8 sm:w-8 min-w-[28px] min-h-[28px]"
      />,
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('shrink-0')
    expect(wrapper.className).toContain('min-w-[28px]')
    expect(wrapper.className).toContain('min-h-[28px]')
    expect(wrapper.className).not.toContain('hidden sm:block')
  })

  it('Exibe monograma APENAS quando não existir nenhuma URL candidata na cascata', () => {
    // Time inexistente e sem correspondência nem fixture
    render(<TeamShield teamName="Time Sem Escudo Nem Pais" />)
    expect(screen.getByText('TI')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('Resolve via fixtureLogosMemoryCache quando fixtureId é informado', () => {
    flagsModule.fixtureLogosMemoryCache.set('999000', {
      home: 'https://media.api-sports.io/football/teams/555.png',
      away: 'https://media.api-sports.io/football/teams/666.png',
    })

    render(<TeamShield teamName="Time Qualquer" fixtureId="999000" isSide="home" />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://media.api-sports.io/football/teams/555.png')
  })

  it('Busca assíncrona fetchAndCacheFixtureLogos quando fixtureId não está em cache', async () => {
    vi.spyOn(flagsModule, 'fetchAndCacheFixtureLogos').mockResolvedValueOnce({
      home: 'https://media.api-sports.io/football/teams/4321.png',
      away: 'https://media.api-sports.io/football/teams/8765.png',
    })

    render(<TeamShield teamName="Time Desconhecido" fixtureId="888999" isSide="away" />)

    await waitFor(() => {
      const img = screen.getByRole('img') as HTMLImageElement
      expect(img).toBeDefined()
      expect(img.src).toBe('https://media.api-sports.io/football/teams/8765.png')
    })
  })
})
