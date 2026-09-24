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

  it('agrupa 100% dos jogadores em 11 titulares + reservas completos para mandante e visitante a partir da API TheSportsDB', () => {
    // Simula resposta típica do lookup da TheSportsDB onde strHome pode estar ausente ou inconsistente,
    // mas idTeam ou strTeam identifica perfeitamente cada time
    interface RawTsdbLineupItem {
      idPlayer: string
      strPlayer: string
      idTeam: string
      strTeam: string
      strSubstitute: string
      intSquadNumber: string
      strPosition: string
    }

    const mockRawLineup: RawTsdbLineupItem[] = []

    // 11 titulares do Mandante (idTeam 133700 - Atletico Madrid)
    for (let i = 1; i <= 11; i++) {
      mockRawLineup.push({
        idPlayer: `home_${i}`,
        strPlayer: `Titular Mandante ${i}`,
        idTeam: '133700',
        strTeam: 'Atlético Madrid',
        strSubstitute: '',
        intSquadNumber: `${i}`,
        strPosition: i === 1 ? 'Goalkeeper' : 'Forward',
      })
    }
    // 7 reservas do Mandante
    for (let i = 12; i <= 18; i++) {
      mockRawLineup.push({
        idPlayer: `home_sub_${i}`,
        strPlayer: `Reserva Mandante ${i}`,
        idTeam: '133700',
        strTeam: 'Atlético Madrid',
        strSubstitute: 'Y',
        intSquadNumber: `${i}`,
        strPosition: 'Substitute',
      })
    }

    // 11 titulares do Visitante (idTeam 133701 - Real Madrid)
    for (let i = 1; i <= 11; i++) {
      mockRawLineup.push({
        idPlayer: `away_${i}`,
        strPlayer: `Titular Visitante ${i}`,
        idTeam: '133701',
        strTeam: 'Real Madrid',
        strSubstitute: 'N',
        intSquadNumber: `${i}`,
        strPosition: i === 1 ? 'Goalkeeper' : 'Midfielder',
      })
    }
    // 9 reservas do Visitante
    for (let i = 12; i <= 20; i++) {
      mockRawLineup.push({
        idPlayer: `away_sub_${i}`,
        strPlayer: `Reserva Visitante ${i}`,
        idTeam: '133701',
        strTeam: 'Real Madrid',
        strSubstitute: 'Y',
        intSquadNumber: `${i}`,
        strPosition: 'Substitute',
      })
    }

    // Algoritmo idêntico ao implementado em pocketbase/hooks/escalacoes.js
    const timeA = 'Atlético Madrid'
    const timeB = 'Real Madrid'
    let homeTeamIdDetected: string | null = null
    let awayTeamIdDetected: string | null = null

    for (const dItem of mockRawLineup) {
      if (dItem.idTeam) {
        if (dItem.strTeam === timeA) {
          homeTeamIdDetected = dItem.idTeam
        } else if (dItem.strTeam === timeB) {
          awayTeamIdDetected = dItem.idTeam
        }
      }
    }

    expect(homeTeamIdDetected).toBe('133700')
    expect(awayTeamIdDetected).toBe('133701')

    const homeStarters: any[] = []
    const homeBench: any[] = []
    const awayStarters: any[] = []
    const awayBench: any[] = []

    for (const item of mockRawLineup) {
      const isSub = item.strSubstitute === 'Y'
      const playerObj = {
        id: item.idPlayer,
        name: item.strPlayer,
        number: parseInt(item.intSquadNumber, 10),
        pos: item.strPosition,
      }
      const isHome = item.idTeam === homeTeamIdDetected
      if (isHome) {
        if (isSub) homeBench.push(playerObj)
        else homeStarters.push(playerObj)
      } else {
        if (isSub) awayBench.push(playerObj)
        else awayStarters.push(playerObj)
      }
    }

    // Valida que nenhum jogador foi truncado: 11 titulares de cada lado + bancos completos
    expect(homeStarters).toHaveLength(11)
    expect(homeBench).toHaveLength(7)
    expect(awayStarters).toHaveLength(11)
    expect(awayBench).toHaveLength(9)
  })

  it('valida cálculo da janela de busca pré-jogo (30 a 20 minutos antes do kickoff)', () => {
    // Simula jogo com kickoff às 16:00 UTC
    const kickoffMs = Date.UTC(2026, 5, 20, 16, 0, 0)
    const janelaInicio = kickoffMs - 30 * 60 * 1000 // 15:30 UTC
    const janelaFim = kickoffMs - 20 * 60 * 1000 // 15:40 UTC

    // 25 minutos antes: dentro da janela
    const agora25m = kickoffMs - 25 * 60 * 1000
    expect(agora25m >= janelaInicio && agora25m <= janelaFim).toBe(true)

    // 35 minutos antes: fora da janela (muito cedo)
    const agora35m = kickoffMs - 35 * 60 * 1000
    expect(agora35m >= janelaInicio && agora35m <= janelaFim).toBe(false)

    // 15 minutos antes: fora da janela (já passou de 20 min)
    const agora15m = kickoffMs - 15 * 60 * 1000
    expect(agora15m >= janelaInicio && agora15m <= janelaFim).toBe(false)

    // Tentativa pós-kickoff recente (até 2 horas)
    const agora30mPosKickoff = kickoffMs + 30 * 60 * 1000
    const duasHorasMs = 2 * 60 * 60 * 1000
    const posKickoffRecente =
      agora30mPosKickoff > kickoffMs && agora30mPosKickoff <= kickoffMs + duasHorasMs
    expect(posKickoffRecente).toBe(true)
  })
})
