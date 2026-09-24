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

  it('resolveTeamBadgeUrl prioriza 1º api-sports, 2º live/cache, 3º flagcdn, 4º null', () => {
    // 1º oficial salvo
    const oficial = 'https://media.api-sports.io/football/teams/767.png'
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Jamaica',
        savedBadge: oficial,
        liveOrCacheBadge: 'https://media.api-sports.io/other.png',
      }),
    ).toBe(oficial)

    // 2º se não tem salvo oficial, mas tem live/cache válido
    const live = 'https://media.api-sports.io/football/teams/999.png'
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Jamaica',
        savedBadge: '',
        liveOrCacheBadge: live,
      }),
    ).toBe(live)

    // 3º se não tem salvo nem live, usa FlagCDN para seleção
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Jamaica',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBe('https://flagcdn.com/w80/jm.png')

    // 3º TheSportsDB é ignorado e cai em FlagCDN
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Honduras',
        savedBadge: 'https://www.thesportsdb.com/images/media/team/badge/honduras.png',
        liveOrCacheBadge: 'https://www.thesportsdb.com/bad.png',
      }),
    ).toBe('https://flagcdn.com/w80/hn.png')

    // 4º Para clube sem imagem, retorna null (cai em monograma)
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Corinthians',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBeNull()
  })
})
