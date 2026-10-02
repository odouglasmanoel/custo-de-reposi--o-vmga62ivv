import { describe, it, expect } from 'vitest'
import { getRegionAndCountryByTournament, normalizeLeagueName } from './tournamentRegionMatcher'

describe('tournamentRegionMatcher', () => {
  it('normaliza e deduplica Brazilian Serie A -> Brasileirão Série A no cliente', () => {
    expect(normalizeLeagueName('Brazilian Serie A')).toBe('Brasileirão Série A')
    expect(normalizeLeagueName('brazilian serie a')).toBe('Brasileirão Série A')
    expect(normalizeLeagueName('Serie A Brazil')).toBe('Brasileirão Série A')
    expect(normalizeLeagueName('brasileirao')).toBe('Brasileirão Série A')
    expect(normalizeLeagueName('Brasileirão')).toBe('Brasileirão Série A')
    expect(normalizeLeagueName('Brazilian Serie B')).toBe('Brasileirão Série B')
    expect(normalizeLeagueName('Premier League')).toBe('Premier League')
    expect(normalizeLeagueName('UEFA Champions League')).toBe('Champions League')
  })
  it('mapeia competições europeias corretamente para Futebol Europeu (evitando América do Sul)', () => {
    const res1 = getRegionAndCountryByTournament('Europa League')
    expect(res1.region).toBe('Futebol Europeu')
    expect(res1.country).toBe('Europa')

    const res2 = getRegionAndCountryByTournament('UEFA Europa League', 3)
    expect(res2.region).toBe('Futebol Europeu')
    expect(res2.country).toBe('Europa')

    const res3 = getRegionAndCountryByTournament('UEFA Conference League', 848)
    expect(res3.region).toBe('Futebol Europeu')

    const res4 = getRegionAndCountryByTournament('Champions League', 2)
    expect(res4.region).toBe('Futebol Europeu')

    const res5 = getRegionAndCountryByTournament('Premier League', 39)
    expect(res5.region).toBe('Futebol Europeu')
    expect(res5.country).toBe('Inglaterra')

    const res6 = getRegionAndCountryByTournament('La Liga', 140)
    expect(res6.region).toBe('Futebol Europeu')
    expect(res6.country).toBe('Espanha')

    const res7 = getRegionAndCountryByTournament('Bundesliga', 78)
    expect(res7.region).toBe('Futebol Europeu')
    expect(res7.country).toBe('Alemanha')

    const res8 = getRegionAndCountryByTournament('Serie A TIM', 135)
    expect(res8.region).toBe('Futebol Europeu')
    expect(res8.country).toBe('Itália')

    const res9 = getRegionAndCountryByTournament('Ligue 1', 61)
    expect(res9.region).toBe('Futebol Europeu')
    expect(res9.country).toBe('França')
  })

  it('mapeia competições brasileiras corretamente para Brasileirão & Copas', () => {
    const r1 = getRegionAndCountryByTournament('Brasileirão Série A', 71)
    expect(r1.region).toBe('Brasileirão & Copas')
    expect(r1.country).toBe('Brasil')

    const r2 = getRegionAndCountryByTournament('Copa do Brasil')
    expect(r2.region).toBe('Brasileirão & Copas')
    expect(r2.country).toBe('Brasil')

    const r3 = getRegionAndCountryByTournament('Brasileirão Série B', 72)
    expect(r3.region).toBe('Brasileirão & Copas')
  })

  it('mapeia competições continentais da CONMEBOL para Sul-Americana', () => {
    const r1 = getRegionAndCountryByTournament('Copa Libertadores', 13)
    expect(r1.region).toBe('Sul-Americana')
    expect(r1.country).toBe('América do Sul')

    const r2 = getRegionAndCountryByTournament('Copa Sul-Americana', 11)
    expect(r2.region).toBe('Sul-Americana')
    expect(r2.country).toBe('América do Sul')
  })

  it('mapeia Liga Argentina (TheSportsDB id 4406 e API-Football 128) para Sul-Americana', () => {
    // ID TheSportsDB 4406
    const r1 = getRegionAndCountryByTournament('Argentinian Primera Division', 4406)
    expect(r1.region).toBe('Sul-Americana')
    expect(r1.country).toBe('Argentina')

    // ID API-Football 128
    const r2 = getRegionAndCountryByTournament('Liga Profesional Argentina', 128)
    expect(r2.region).toBe('Sul-Americana')
    expect(r2.country).toBe('Argentina')

    // Por nome de liga com variação
    const r3 = getRegionAndCountryByTournament('Campeonato Argentino')
    expect(r3.region).toBe('Sul-Americana')
    expect(r3.country).toBe('Argentina')

    const r4 = getRegionAndCountryByTournament('Primera Division Argentina')
    expect(r4.region).toBe('Sul-Americana')
    expect(r4.country).toBe('Argentina')
  })

  it('não fixa América do Sul em competições desconhecidas / fallback neutro', () => {
    const r = getRegionAndCountryByTournament('Torneio Amistoso do Japão')
    expect(r.region).toBe('Outros')
    expect(r.country).not.toBe('América do Sul')
  })

  it('mapeia Championship inglesa para Futebol Europeu / Inglaterra sem confundir com Champions League', () => {
    const r = getRegionAndCountryByTournament('Championship')
    expect(r.region).toBe('Futebol Europeu')
    expect(r.country).toBe('Inglaterra')
  })

  it('mapeia Serie A da Itália para Futebol Europeu / Itália sem confundir com Brasileirão', () => {
    const r = getRegionAndCountryByTournament('Serie A', 135)
    expect(r.region).toBe('Futebol Europeu')
    expect(r.country).toBe('Itália')
  })
})
