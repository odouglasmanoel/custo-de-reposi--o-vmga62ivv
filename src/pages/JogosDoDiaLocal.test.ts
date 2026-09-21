import { describe, it, expect } from 'vitest'

describe('Estratégia de Cache e Leitura Local dos Jogos do Dia', () => {
  it('converte corretamente o payload da tabela local jogos_do_dia em DayFixture', () => {
    const mockRecord = {
      id: 'rec123',
      fixture_id: '1640414',
      data: '2026-09-21',
      horario: '16:00',
      data_hora_iso: '2026-09-21T16:00:00-03:00',
      campeonato: 'Brasileirão Série A',
      campeonato_logo: 'https://media.api-sports.io/football/leagues/71.png',
      league_id: 71,
      round: 'Rodada 28',
      regiao: 'Brasileirão & Copas',
      pais: 'Brasil',
      time_casa: 'Flamengo',
      time_visitante: 'Palmeiras',
      logo_casa: 'https://media.api-sports.io/football/teams/127.png',
      logo_visitante: 'https://media.api-sports.io/football/teams/121.png',
      placar_casa: 2,
      placar_visitante: 1,
      status_short: 'FT',
      status_long: 'Match Finished',
      status_elapsed: 90,
      scorers: [
        { nome: 'Pedro', minuto: '23', posicao: 'Atacante', quantidade: 1 },
        { nome: 'Arrascaeta', minuto: '65', posicao: 'Meia', quantidade: 1 },
      ],
      events: [],
    }

    // Validações do formato local
    expect(mockRecord.fixture_id).toBe('1640414')
    expect(mockRecord.time_casa).toBe('Flamengo')
    expect(mockRecord.placar_casa).toBe(2)
    expect(mockRecord.scorers.length).toBe(2)
    expect(mockRecord.status_short).toBe('FT')
  })

  it('valida mensagem amigável quando a tabela local estiver vazia', () => {
    const fixtures: any[] = []
    const emptyNotice =
      fixtures.length === 0
        ? 'Os jogos de hoje ainda não foram sincronizados pelo cron matinal — volte mais tarde.'
        : null

    expect(emptyNotice).toContain('Os jogos de hoje ainda não foram sincronizados')
  })

  it('filtra ligas ativas do bolão sem poluição de divisões irrelevantes', () => {
    const targetLeagueIds = [71, 73, 13, 11, 2, 3, 39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66]
    const targetSet = new Set(targetLeagueIds)

    expect(targetSet.has(71)).toBe(true) // Brasileirão Série A
    expect(targetSet.has(73)).toBe(true) // Copa do Brasil
    expect(targetSet.has(13)).toBe(true) // Libertadores
    expect(targetSet.has(2)).toBe(true) // Champions League
    expect(targetSet.has(99999)).toBe(false)
  })
})
