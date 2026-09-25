import { describe, it, expect } from 'vitest'
import {
  normalizeCountryName,
  getCountryIsoCode,
  getFlagCdnUrl,
  isNationalTeam,
  resolveTeamBadgeUrl,
  SELECAO_FLAG_MAP,
} from './flags'

describe('flags.ts - FlagCDN Helper e Seleções Nacionais', () => {
  it('normaliza nomes sem acentos e sem case', () => {
    expect(normalizeCountryName('Tchéquia')).toBe('tchequia')
    expect(normalizeCountryName('Ilhas Virgens Britânicas')).toBe('ilhasvirgensbritanicas')
    expect(normalizeCountryName('São Martinho')).toBe('saomartinho')
    expect(normalizeCountryName('São Vicente e Granadinas')).toBe('saovicenteegranadinas')
    expect(normalizeCountryName('Guiana Francesa')).toBe('guianafrancesa')
    expect(normalizeCountryName('País de Gales')).toBe('paisdegales')
    expect(normalizeCountryName('Irlanda do Norte')).toBe('irlandadonorte')
  })

  it('mapeia todas as seleções mínimas exigidas pelo usuário', () => {
    const requiredMap: Record<string, string> = {
      Jamaica: 'jm',
      Honduras: 'hn',
      'El Salvador': 'sv',
      Martinica: 'mq',
      Montserrat: 'ms',
      'Ilhas Virgens Britânicas': 'vg',
      'São Martinho': 'sx',
      'Ilhas Virgens Americanas': 'vi',
      'São Vicente e Granadinas': 'vc',
      'Guiana Francesa': 'gf',
      Tchéquia: 'cz',
      Croácia: 'hr',
      Geórgia: 'ge',
      'Irlanda do Norte': 'gb-nir',
      Itália: 'it',
      Bélgica: 'be',
      Turquia: 'tr',
      França: 'fr',
      Portugal: 'pt',
      Dinamarca: 'dk',
      Noruega: 'no',
      Inglaterra: 'gb-eng',
      Espanha: 'es',
      Escócia: 'gb-sct',
      'País de Gales': 'gb-wls',
      Japão: 'jp',
      Uruguai: 'uy',
    }

    for (const [teamName, iso] of Object.entries(requiredMap)) {
      expect(getCountryIsoCode(teamName)).toBe(iso)
      expect(getFlagCdnUrl(teamName)).toBe(`https://flagcdn.com/w80/${iso}.png`)
      expect(isNationalTeam(teamName)).toBe(true)
    }
  })

  it('retorna null para clubes ou nomes não conhecidos', () => {
    expect(getCountryIsoCode('Corinthians')).toBeNull()
    expect(getCountryIsoCode('Flamengo')).toBeNull()
    expect(getCountryIsoCode('Real Madrid')).toBeNull()
    expect(getFlagCdnUrl('Palmeiras')).toBeNull()
    expect(isNationalTeam('Chelsea')).toBe(false)
  })

  it('resolveTeamBadgeUrl prioriza 1º api-sports oficial, 2º flagcdn para seleções, e rejeita escudos de clubes', () => {
    // Para seleção nacional com ID oficial reconhecido
    const oficialGales = 'https://media.api-sports.io/football/teams/767.png'
    expect(
      resolveTeamBadgeUrl({
        teamName: 'País de Gales',
        savedBadge: oficialGales,
      }),
    ).toBe(oficialGales)

    // Turquia: se vier com logo do Köln (192.png) salvo no banco, descarta e retorna FlagCDN tr
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Turquia',
        savedBadge: 'https://media.api-sports.io/football/teams/192.png',
      }),
    ).toBe('https://flagcdn.com/w80/tr.png')

    // Bélgica: se vier com logo do Köln (192.png) ou desconhecido, descarta e retorna FlagCDN be
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Bélgica',
        savedBadge: 'https://media.api-sports.io/football/teams/192.png',
      }),
    ).toBe('https://flagcdn.com/w80/be.png')

    // França: se vier com escudo de clube verde aleatório ou URL não oficial da França (ex: 50.png), descarta e retorna fr
    expect(
      resolveTeamBadgeUrl({
        teamName: 'França',
        savedBadge: 'https://media.api-sports.io/football/teams/50.png',
      }),
    ).toBe('https://flagcdn.com/w80/fr.png')

    // Geórgia: sem logo oficial salvo ou com TheSportsDB, retorna FlagCDN ge (evita monograma "G")
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Geórgia',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBe('https://flagcdn.com/w80/ge.png')

    // Geórgia com ID oficial 1104
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Geórgia',
        savedBadge: 'https://media.api-sports.io/football/teams/1104.png',
      }),
    ).toBe('https://media.api-sports.io/football/teams/1104.png')

    // TheSportsDB é ignorado e cai em FlagCDN
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Honduras',
        savedBadge: 'https://www.thesportsdb.com/images/media/team/badge/honduras.png',
        liveOrCacheBadge: 'https://www.thesportsdb.com/bad.png',
      }),
    ).toBe('https://flagcdn.com/w80/hn.png')

    // Clubes reais: mantém escudos oficiais de clube
    const realMadrid = 'https://media.api-sports.io/football/teams/541.png'
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Real Madrid',
        savedBadge: realMadrid,
      }),
    ).toBe(realMadrid)

    // Clube sem imagem retorna null (para monograma)
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Corinthians',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBeNull()
  })
})
