/**
 * Utilitário determinístico para resolução de Região / Categoria e País
 * a partir do nome e/ou ID do campeonato / torneio.
 *
 * Garante consistência entre jogos automáticos (APIs) e jogos manuais,
 * impedindo que competições europeias (ex.: Europa League) ou outras
 * fiquem presas em "América do Sul".
 */

export type RegionCategory = 'Brasileirão & Copas' | 'Sul-Americana' | 'Futebol Europeu' | 'Outros'

export interface TournamentMetadata {
  region: RegionCategory
  country: string
  canonicalName?: string
}

/**
 * Normaliza string removendo acentos e pontuações para comparação robusta.
 */
function normalizeTournamentName(name: string): string {
  if (!name) return ''
  try {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  } catch {
    return String(name).toLowerCase().trim()
  }
}

/**
 * Mapeamento determinístico de torneios / competições para região e país/continente.
 * Usado tanto na renderização de cards quanto no backend.
 */
export function getRegionAndCountryByTournament(
  campeonato?: string | null,
  leagueId?: number | string | null,
  existingCountry?: string | null,
): TournamentMetadata {
  const norm = normalizeTournamentName(campeonato || '')
  const id = leagueId != null ? Number(leagueId) : null

  // 1. Verificação por ID de Liga oficial conhecido (API-Football / Football-Data / TheSportsDB)
  if (id !== null && !isNaN(id)) {
    // Brasileirão e Copas Nacionais do Brasil
    if (
      id === 71 || // Brasileirão Série A
      id === 72 || // Série B
      id === 73 || // Copa do Brasil / Série C
      id === 74 || // Copa do Brasil / Série D
      id === 75 || // Série C
      id === 76 || // Série D
      id === 2013 // Football-Data Série A
    ) {
      return { region: 'Brasileirão & Copas', country: 'Brasil' }
    }

    // CONMEBOL / Sul-Americana / Libertadores
    if (
      id === 13 || // Copa Libertadores
      id === 11 || // Copa Sudamericana
      id === 450 || // Copa Sudamericana alternativa
      id === 4501 || // TheSportsDB Libertadores
      id === 4724 // TheSportsDB Sudamericana
    ) {
      return { region: 'Sul-Americana', country: 'América do Sul' }
    }

    // Futebol Europeu (Grandes ligas e UEFA)
    if (
      id === 2 || // UEFA Champions League
      id === 3 || // UEFA Europa League
      id === 848 || // UEFA Europa Conference League
      id === 39 || // Premier League
      id === 140 || // La Liga
      id === 135 || // Serie A (Itália)
      id === 78 || // Bundesliga
      id === 61 || // Ligue 1
      id === 45 || // FA Cup
      id === 48 || // EFL Carabao Cup
      id === 143 || // Copa del Rey
      id === 137 || // Coppa Italia
      id === 81 || // DFB-Pokal
      id === 66 || // Coupe de France
      id === 4481 || // TheSportsDB Europa League
      id === 5071 || // TheSportsDB Conference League
      id === 2001 || // Football-Data Champions League
      id === 2021 || // Football-Data Premier League
      id === 2014 || // Football-Data La Liga
      id === 2019 || // Football-Data Serie A
      id === 2002 || // Football-Data Bundesliga
      id === 2015 // Football-Data Ligue 1
    ) {
      return {
        region: 'Futebol Europeu',
        country:
          id === 39 || id === 45 || id === 48 || id === 2021
            ? 'Inglaterra'
            : id === 140 || id === 143 || id === 2014
              ? 'Espanha'
              : id === 135 || id === 137 || id === 2019
                ? 'Itália'
                : id === 78 || id === 81 || id === 2002
                  ? 'Alemanha'
                  : id === 61 || id === 66 || id === 2015
                    ? 'França'
                    : 'Europa',
      }
    }
  }

  // 2. Mapeamento determinístico por Nome da Competição / Torneio
  // Futebol Europeu (Prioridade 1 para evitar que "Europa League" vire América do Sul)
  if (
    norm.includes('europa league') ||
    norm.includes('conference league') ||
    norm.includes('champions league') ||
    norm.includes('uefa') ||
    norm.includes('premier league') ||
    norm.includes('la liga') ||
    norm.includes('serie a tim') ||
    norm.includes('bundesliga') ||
    norm.includes('ligue 1') ||
    norm.includes('ligue 2') ||
    norm.includes('fa cup') ||
    norm.includes('copa del rey') ||
    norm.includes('coppa italia') ||
    norm.includes('dfb-pokal') ||
    norm.includes('dfb pokal') ||
    norm.includes('carabao') ||
    norm.includes('coupe de france') ||
    norm.includes('eredivisie') ||
    norm.includes('primeira liga') ||
    norm.includes('futebol europeu') ||
    norm.includes('europa')
  ) {
    let country = 'Europa'
    if (norm.includes('premier league') || norm.includes('fa cup') || norm.includes('carabao')) {
      country = 'Inglaterra'
    } else if (norm.includes('la liga') || norm.includes('copa del rey')) {
      country = 'Espanha'
    } else if (norm.includes('serie a') || norm.includes('coppa italia')) {
      country = 'Itália'
    } else if (norm.includes('bundesliga') || norm.includes('dfb')) {
      country = 'Alemanha'
    } else if (norm.includes('ligue 1') || norm.includes('coupe de france')) {
      country = 'França'
    } else if (norm.includes('eredivisie')) {
      country = 'Holanda'
    } else if (norm.includes('primeira liga')) {
      country = 'Portugal'
    }
    return { region: 'Futebol Europeu', country }
  }

  // English Championship / EFL Championship
  if (norm.includes('championship')) {
    return { region: 'Futebol Europeu', country: 'Inglaterra' }
  }

  // Brasileirão e Copas Nacionais (Apenas com indicador EXPLÍCITO do Brasil para não capturar Serie A italiana)
  if (
    norm.includes('brasileirao') ||
    norm.includes('brasileiro') ||
    norm.includes('copa do brasil') ||
    (norm.includes('serie a') &&
      (norm.includes('brasil') || norm.includes('brazil') || norm.includes('brasileir'))) ||
    norm.includes('serie b') ||
    norm.includes('serie c') ||
    norm.includes('serie d') ||
    norm.includes('paulist') ||
    norm.includes('carioca') ||
    norm.includes('mineiro') ||
    norm.includes('gaucho') ||
    norm.includes('paranaense') ||
    norm.includes('catarinense') ||
    norm.includes('copa do nordeste') ||
    norm.includes('copa verde') ||
    norm.includes('supercopa do brasil') ||
    norm.includes('supercopa rei')
  ) {
    return { region: 'Brasileirão & Copas', country: 'Brasil' }
  }

  // América do Sul / CONMEBOL (Libertadores, Sul-Americana, etc.)
  if (
    norm.includes('libertadores') ||
    norm.includes('sul-americana') ||
    norm.includes('sudamericana') ||
    norm.includes('sul americana') ||
    norm.includes('conmebol') ||
    norm.includes('recopa') ||
    norm.includes('copa america')
  ) {
    return { region: 'Sul-Americana', country: 'América do Sul' }
  }

  // 3. Heurística baseada no país já fornecido pela API
  if (existingCountry) {
    const normCountry = normalizeTournamentName(existingCountry)
    if (normCountry === 'brazil' || normCountry === 'brasil' || normCountry === 'bra') {
      return { region: 'Brasileirão & Copas', country: 'Brasil' }
    }
    if (
      normCountry === 'england' ||
      normCountry === 'inglaterra' ||
      normCountry === 'spain' ||
      normCountry === 'espanha' ||
      normCountry === 'italy' ||
      normCountry === 'italia' ||
      normCountry === 'germany' ||
      normCountry === 'alemanha' ||
      normCountry === 'france' ||
      normCountry === 'franca' ||
      normCountry === 'portugal' ||
      normCountry === 'netherlands' ||
      normCountry === 'holanda' ||
      normCountry === 'europe' ||
      normCountry === 'europa'
    ) {
      return { region: 'Futebol Europeu', country: existingCountry }
    }
    if (
      normCountry === 'south america' ||
      normCountry === 'america do sul' ||
      normCountry === 'argentina' ||
      normCountry === 'uruguay' ||
      normCountry === 'chile' ||
      normCountry === 'colombia' ||
      normCountry === 'paraguay' ||
      normCountry === 'ecuador' ||
      normCountry === 'peru' ||
      normCountry === 'bolivia' ||
      normCountry === 'venezuela'
    ) {
      return { region: 'Sul-Americana', country: existingCountry }
    }
  }

  // 4. Fallback neutro — NUNCA fixar "América do Sul"
  return {
    region: 'Outros',
    country:
      existingCountry && existingCountry !== 'América do Sul' ? existingCountry : 'Internacional',
  }
}
