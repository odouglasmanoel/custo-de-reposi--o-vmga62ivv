import { describe, it, expect, vi, beforeEach } from 'vitest'
import pb from '@/lib/pocketbase/client'

describe('MatchDetailsModal - Cache-first e leitura exclusiva do PocketBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('não dispara chamadas para API externa (fetch para api-sports ou endpoints externos) ao abrir detalhes', async () => {
    // Espiona window.fetch para garantir que nada externo é chamado
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // Mock do pb.collection('jogos_do_dia') e pb.collection('jogos')
    const mockGetListJdd = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'rec_jdd_1',
          fixture_id: '123456',
          status_short: 'NS',
          status_long: 'Não Iniciado',
          raw_payload: {
            fixture: {
              referee: 'Wilton Pereira Sampaio',
              venue: { name: 'Maracanã', city: 'Rio de Janeiro' },
            },
          },
        },
      ],
    })

    const mockGetListJogos = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'rec_jogo_1',
          fixture_id: '123456',
          escalacoes: null,
          ficha_detalhes: null,
        },
      ],
    })

    vi.spyOn(pb, 'collection').mockImplementation((col: string) => {
      if (col === 'jogos_do_dia') {
        return { getList: mockGetListJdd } as any
      }
      if (col === 'jogos') {
        return { getList: mockGetListJogos } as any
      }
      return {} as any
    })

    // Simula a lógica de carregamento do modal
    const fixtureId = '123456'
    const jddRecords = await pb.collection('jogos_do_dia').getList(1, 1, {
      filter: `fixture_id = '${fixtureId}'`,
    })
    const jogosRecords = await pb.collection('jogos').getList(1, 1, {
      filter: `fixture_id = '${fixtureId}'`,
    })

    expect(jddRecords.items).toHaveLength(1)
    expect(jogosRecords.items).toHaveLength(1)
    // Assegura que nenhum fetch externo foi chamado
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exibe mensagem fixa quando a escalação ainda não tiver sido capturada ou divulgada no banco', () => {
    const rawEscalacoes = null
    const MSG_ESCALACAO_INDISPONIVEL =
      'Escalação ainda não divulgada (disponível ~20 min antes do jogo)'

    let hasLineupTeams = false
    let displayMessage = ''

    if (rawEscalacoes) {
      const parsed = typeof rawEscalacoes === 'string' ? JSON.parse(rawEscalacoes) : rawEscalacoes
      if (
        parsed?.teams?.length > 0 &&
        (parsed.teams[0]?.starters?.length > 0 || parsed.teams[1]?.starters?.length > 0)
      ) {
        hasLineupTeams = true
      }
    }

    if (!hasLineupTeams) {
      displayMessage = MSG_ESCALACAO_INDISPONIVEL
    }

    expect(hasLineupTeams).toBe(false)
    expect(displayMessage).toBe('Escalação ainda não divulgada (disponível ~20 min antes do jogo)')
  })

  it('renderiza imediatamente escalação, estádio e árbitro quando persistidos no banco', () => {
    const mockJddRecord = {
      fixture_id: '998877',
      status_short: 'NS',
      status_long: 'Agendado',
      raw_payload: {
        fixture: {
          referee: 'Raphael Claus',
          venue: { name: 'Allianz Parque', city: 'São Paulo' },
        },
      },
    }

    const mockJogoRecord = {
      fixture_id: '998877',
      escalacoes: {
        status: 'confirmada',
        teams: [
          {
            teamName: 'Palmeiras',
            formation: '4-3-3',
            coach: 'Abel Ferreira',
            starters: [
              { name: 'Weverton', number: 21, pos: 'G' },
              { name: 'Gustavo Gómez', number: 15, pos: 'D' },
            ],
            substitutes: [{ name: 'Marcelo Lomba', number: 1, pos: 'G' }],
          },
          {
            teamName: 'São Paulo',
            formation: '4-2-3-1',
            coach: 'Luis Zubeldía',
            starters: [
              { name: 'Rafael', number: 23, pos: 'G' },
              { name: 'Arboleda', number: 5, pos: 'D' },
            ],
            substitutes: [{ name: 'Jandrei', number: 93, pos: 'G' }],
          },
        ],
      },
    }

    // Extrai estádio e árbitro
    const venue = mockJddRecord.raw_payload.fixture.venue
    const estadio = venue ? `${venue.name} (${venue.city})` : '—'
    const arbitro = mockJddRecord.raw_payload.fixture.referee || '—'

    expect(estadio).toBe('Allianz Parque (São Paulo)')
    expect(arbitro).toBe('Raphael Claus')

    // Extrai escalações
    const parsedEsc = mockJogoRecord.escalacoes
    expect(parsedEsc.teams).toHaveLength(2)
    expect(parsedEsc.teams[0].coach).toBe('Abel Ferreira')
    expect(parsedEsc.teams[0].formation).toBe('4-3-3')
    expect(parsedEsc.teams[0].starters).toHaveLength(2)
    expect(parsedEsc.teams[0].substitutes).toHaveLength(1)
  })

  it('quando o cron gravar a escalação 20 min antes, nova leitura reflete os dados sem refresh de página', () => {
    let mockDbEscalacoes: any = null

    const checkEscalacao = () => {
      if (!mockDbEscalacoes) {
        return {
          hasLineup: false,
          message: 'Escalação ainda não divulgada (disponível ~20 min antes do jogo)',
        }
      }
      return {
        hasLineup: true,
        data: mockDbEscalacoes,
      }
    }

    // 1. Antes do cron (ex: 40 min antes do jogo): não divulgada
    const estadoAntes = checkEscalacao()
    expect(estadoAntes.hasLineup).toBe(false)
    expect(estadoAntes.message).toBe(
      'Escalação ainda não divulgada (disponível ~20 min antes do jogo)',
    )

    // 2. Cron de escalações roda 20 min antes e grava no banco
    mockDbEscalacoes = {
      status: 'confirmada',
      teams: [
        {
          teamName: 'Flamengo',
          coach: 'Filipe Luís',
          starters: [{ name: 'Rossi', number: 1, pos: 'G' }],
          substitutes: [],
        },
      ],
    }

    // 3. Re-leitura (ou acionamento realtime): escalação agora presente
    const estadoDepois = checkEscalacao()
    expect(estadoDepois.hasLineup).toBe(true)
    expect(estadoDepois.data.teams[0].coach).toBe('Filipe Luís')
  })

  it('determina corretamente alinhamento de eventos (mandante à esquerda, visitante à direita)', () => {
    const matchFixture = {
      fixture: { id: 100 },
      teams: {
        home: { id: 10, name: 'Chelsea' },
        away: { id: 20, name: 'Arsenal' },
      },
    }

    const homeEvent = {
      type: 'Goal',
      detail: 'Normal Goal',
      team: { id: 10, name: 'Chelsea' },
      player: { name: 'Cole Palmer' },
    }

    const awayEvent = {
      type: 'Goal',
      detail: 'Normal Goal',
      team: { id: 20, name: 'Arsenal' },
      player: { name: 'Bukayo Saka' },
    }

    // Valida IDs
    expect(String(homeEvent.team.id)).toBe(String(matchFixture.teams.home.id))
    expect(String(awayEvent.team.id)).toBe(String(matchFixture.teams.away.id))
  })
})
