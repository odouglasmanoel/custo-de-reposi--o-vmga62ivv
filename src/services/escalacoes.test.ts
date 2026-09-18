import { describe, it, expect } from 'vitest'
import { normalizePlayerName, checkPlayerInLineup, LineupTeam } from './escalacoes'

describe('escalacoes service', () => {
  it('normaliza nomes de jogadores corretamente', () => {
    expect(normalizePlayerName('Raphael Veiga')).toBe('raphael veiga')
    expect(normalizePlayerName('Éverton Ribeiro')).toBe('everton ribeiro')
    expect(normalizePlayerName('  Pedro   Raul  ')).toBe('pedro raul')
  })

  it('identifica jogador titular com correspondência exata ou parcial', () => {
    const mockTeam: LineupTeam = {
      teamName: 'Palmeiras',
      starters: [
        { name: 'Raphael Veiga', number: 23, pos: 'M' },
        { name: 'Flaco López', number: 42, pos: 'F' },
        { name: 'Gustavo Gómez', number: 15, pos: 'D' },
      ],
      substitutes: [
        { name: 'Rony', number: 10, pos: 'F' },
        { name: 'Gabriel Menino', number: 25, pos: 'M' },
      ],
    }

    // Titular exato
    const resExact = checkPlayerInLineup('Raphael Veiga', mockTeam)
    expect(resExact.role).toBe('titular')
    expect(resExact.matchedPlayer?.number).toBe(23)

    // Titular por sobrenome / nome curto
    const resVeiga = checkPlayerInLineup('Veiga', mockTeam)
    expect(resVeiga.role).toBe('titular')

    // Reserva
    const resRony = checkPlayerInLineup('Rony', mockTeam)
    expect(resRony.role).toBe('reserva')
    expect(resRony.matchedPlayer?.number).toBe(10)

    // Não escalado
    const resOut = checkPlayerInLineup('Neymar Jr', mockTeam)
    expect(resOut.role).toBeNull()
  })
})
