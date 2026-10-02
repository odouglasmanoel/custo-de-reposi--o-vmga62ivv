import { describe, it, expect } from 'vitest'
import {
  normalizeCountryName,
  getCountryIsoCode,
  getFlagCdnUrl,
  isNationalTeam,
  resolveTeamBadgeUrl,
  fixtureLogosMemoryCache,
  extractLogosFromFichaDetalhes,
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

    // Clube brasileiro sem imagem salva no banco agora resolve pelo dicionário estático (Corinthians -> 131, Botafogo -> 120, Vasco -> 133)
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Corinthians',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBe('https://media.api-sports.io/football/teams/131.png')

    expect(
      resolveTeamBadgeUrl({
        teamName: 'Botafogo',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBe('https://media.api-sports.io/football/teams/120.png')

    expect(
      resolveTeamBadgeUrl({
        teamName: 'Vasco da Gama',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBe('https://media.api-sports.io/football/teams/133.png')

    // Clube sem nenhum registro ou mapeamento retorna null (para monograma)
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Clube Totalmente Desconhecido XYZ 123',
        savedBadge: '',
        liveOrCacheBadge: '',
      }),
    ).toBeNull()
  })

  it('mapeia as novas seleções solicitadas (Letônia, Chipre, Armênia, Montenegro, Irlanda, Zimbábue, RD Congo, Guiné Equatorial, Serra Leoa, República Centro-Africana, Burkina Faso)', () => {
    // Letônia -> lv
    expect(getCountryIsoCode('Letônia')).toBe('lv')
    expect(getCountryIsoCode('letonia')).toBe('lv')
    expect(getCountryIsoCode('Latvia')).toBe('lv')
    expect(getFlagCdnUrl('Letônia')).toBe('https://flagcdn.com/w80/lv.png')
    expect(isNationalTeam('Letônia')).toBe(true)

    // Chipre -> cy
    expect(getCountryIsoCode('Chipre')).toBe('cy')
    expect(getCountryIsoCode('chipre')).toBe('cy')
    expect(getCountryIsoCode('Cyprus')).toBe('cy')
    expect(getFlagCdnUrl('Chipre')).toBe('https://flagcdn.com/w80/cy.png')
    expect(isNationalTeam('Chipre')).toBe(true)

    // Armênia -> am
    expect(getCountryIsoCode('Armênia')).toBe('am')
    expect(getCountryIsoCode('armenia')).toBe('am')
    expect(getCountryIsoCode('Armenia')).toBe('am')
    expect(getFlagCdnUrl('Armênia')).toBe('https://flagcdn.com/w80/am.png')
    expect(isNationalTeam('Armênia')).toBe(true)

    // Montenegro -> me
    expect(getCountryIsoCode('Montenegro')).toBe('me')
    expect(getCountryIsoCode('montenegro')).toBe('me')
    expect(getFlagCdnUrl('Montenegro')).toBe('https://flagcdn.com/w80/me.png')
    expect(isNationalTeam('Montenegro')).toBe(true)

    // Irlanda -> ie (sem colidir com Irlanda do Norte -> gb-nir)
    expect(getCountryIsoCode('Irlanda')).toBe('ie')
    expect(getCountryIsoCode('irlanda')).toBe('ie')
    expect(getCountryIsoCode('Ireland')).toBe('ie')
    expect(getCountryIsoCode('Republic of Ireland')).toBe('ie')
    expect(getFlagCdnUrl('Irlanda')).toBe('https://flagcdn.com/w80/ie.png')
    expect(isNationalTeam('Irlanda')).toBe(true)
    // Garantir que Irlanda do Norte NÃO retorna ie:
    expect(getCountryIsoCode('Irlanda do Norte')).toBe('gb-nir')
    expect(getCountryIsoCode('Irlanda do Norte')).not.toBe('ie')
    expect(getCountryIsoCode('Northern Ireland')).toBe('gb-nir')
    expect(getCountryIsoCode('Northern Ireland')).not.toBe('ie')
    expect(getFlagCdnUrl('Irlanda do Norte')).toBe('https://flagcdn.com/w80/gb-nir.png')
  })

  it('trata explicitamente as 4 nações do Reino Unido (País de Gales, Irlanda do Norte, Escócia, Inglaterra)', () => {
    // País de Gales / Gales -> gb-wls
    expect(getCountryIsoCode('País de Gales')).toBe('gb-wls')
    expect(getCountryIsoCode('Gales')).toBe('gb-wls')
    expect(getCountryIsoCode('Wales')).toBe('gb-wls')
    expect(getCountryIsoCode('Cymru')).toBe('gb-wls')
    expect(getFlagCdnUrl('País de Gales')).toBe('https://flagcdn.com/w80/gb-wls.png')
    expect(getFlagCdnUrl('Gales')).toBe('https://flagcdn.com/w80/gb-wls.png')
    expect(isNationalTeam('País de Gales')).toBe(true)
    expect(isNationalTeam('Gales')).toBe(true)

    // Irlanda do Norte -> gb-nir (e nunca ie)
    expect(getCountryIsoCode('Irlanda do Norte')).toBe('gb-nir')
    expect(getCountryIsoCode('Northern Ireland')).toBe('gb-nir')
    expect(getCountryIsoCode('Irlanda do Norte')).not.toBe('ie')
    expect(getFlagCdnUrl('Irlanda do Norte')).toBe('https://flagcdn.com/w80/gb-nir.png')
    expect(getCountryIsoCode('Irlanda')).toBe('ie')
    expect(getFlagCdnUrl('Irlanda')).toBe('https://flagcdn.com/w80/ie.png')
    expect(isNationalTeam('Irlanda do Norte')).toBe(true)

    // Escócia -> gb-sct
    expect(getCountryIsoCode('Escócia')).toBe('gb-sct')
    expect(getCountryIsoCode('escocia')).toBe('gb-sct')
    expect(getCountryIsoCode('Scotland')).toBe('gb-sct')
    expect(getFlagCdnUrl('Escócia')).toBe('https://flagcdn.com/w80/gb-sct.png')
    expect(getFlagCdnUrl('Scotland')).toBe('https://flagcdn.com/w80/gb-sct.png')
    expect(isNationalTeam('Escócia')).toBe(true)

    // Inglaterra -> gb-eng
    expect(getCountryIsoCode('Inglaterra')).toBe('gb-eng')
    expect(getCountryIsoCode('inglaterra')).toBe('gb-eng')
    expect(getCountryIsoCode('England')).toBe('gb-eng')
    expect(getFlagCdnUrl('Inglaterra')).toBe('https://flagcdn.com/w80/gb-eng.png')
    expect(getFlagCdnUrl('England')).toBe('https://flagcdn.com/w80/gb-eng.png')
    expect(isNationalTeam('Inglaterra')).toBe(true)

    // Suporte a subcódigo direto
    expect(getCountryIsoCode('gb-wls')).toBe('gb-wls')
    expect(getCountryIsoCode('gb-nir')).toBe('gb-nir')
    expect(getCountryIsoCode('gb-sct')).toBe('gb-sct')
    expect(getCountryIsoCode('gb-eng')).toBe('gb-eng')

    // Zimbábue -> zw
    expect(getCountryIsoCode('Zimbábue')).toBe('zw')
    expect(getCountryIsoCode('zimbabue')).toBe('zw')
    expect(getCountryIsoCode('Zimbabwe')).toBe('zw')
    expect(getFlagCdnUrl('Zimbábue')).toBe('https://flagcdn.com/w80/zw.png')
    expect(isNationalTeam('Zimbábue')).toBe(true)

    // República Democrática do Congo -> cd (e variações)
    expect(getCountryIsoCode('República Democrática do Congo')).toBe('cd')
    expect(getCountryIsoCode('republica democratica do congo')).toBe('cd')
    expect(getCountryIsoCode('DR Congo')).toBe('cd')
    expect(getCountryIsoCode('dr congo')).toBe('cd')
    expect(getCountryIsoCode('Democratic Republic of the Congo')).toBe('cd')
    expect(getCountryIsoCode('RD Congo')).toBe('cd')
    expect(getCountryIsoCode('rd congo')).toBe('cd')
    expect(getCountryIsoCode('Congo Democrático')).toBe('cd')
    expect(getFlagCdnUrl('República Democrática do Congo')).toBe('https://flagcdn.com/w80/cd.png')
    expect(isNationalTeam('RD Congo')).toBe(true)

    // Guiné Equatorial -> gq
    expect(getCountryIsoCode('Guiné Equatorial')).toBe('gq')
    expect(getCountryIsoCode('guine equatorial')).toBe('gq')
    expect(getCountryIsoCode('Equatorial Guinea')).toBe('gq')
    expect(getFlagCdnUrl('Guiné Equatorial')).toBe('https://flagcdn.com/w80/gq.png')
    expect(isNationalTeam('Guiné Equatorial')).toBe(true)

    // Serra Leoa -> sl
    expect(getCountryIsoCode('Serra Leoa')).toBe('sl')
    expect(getCountryIsoCode('serra leoa')).toBe('sl')
    expect(getCountryIsoCode('Sierra Leone')).toBe('sl')
    expect(getFlagCdnUrl('Serra Leoa')).toBe('https://flagcdn.com/w80/sl.png')
    expect(isNationalTeam('Serra Leoa')).toBe(true)

    // República Centro-Africana -> cf
    expect(getCountryIsoCode('República Centro-Africana')).toBe('cf')
    expect(getCountryIsoCode('republica centro africana')).toBe('cf')
    expect(getCountryIsoCode('Centro-Africana')).toBe('cf')
    expect(getCountryIsoCode('Central African Republic')).toBe('cf')
    expect(getFlagCdnUrl('República Centro-Africana')).toBe('https://flagcdn.com/w80/cf.png')
    expect(isNationalTeam('República Centro-Africana')).toBe(true)

    // Burkina Faso -> bf
    expect(getCountryIsoCode('Burkina Faso')).toBe('bf')
    expect(getCountryIsoCode('burkina faso')).toBe('bf')
    expect(getFlagCdnUrl('Burkina Faso')).toBe('https://flagcdn.com/w80/bf.png')
    expect(isNationalTeam('Burkina Faso')).toBe(true)
  })

  it('suporta conversão direta por código ISO alpha-2 válido e fallback em resolveTeamBadgeUrl para as novas seleções', () => {
    // Código direto
    expect(getCountryIsoCode('lv')).toBe('lv')
    expect(getCountryIsoCode('cy')).toBe('cy')
    expect(getCountryIsoCode('am')).toBe('am')
    expect(getCountryIsoCode('ie')).toBe('ie')
    expect(getCountryIsoCode('zw')).toBe('zw')
    expect(getCountryIsoCode('cd')).toBe('cd')
    expect(getCountryIsoCode('gq')).toBe('gq')
    expect(getCountryIsoCode('sl')).toBe('sl')
    expect(getCountryIsoCode('cf')).toBe('cf')
    expect(getCountryIsoCode('bf')).toBe('bf')

    // Cache busting e crossOrigin support
    expect(getFlagCdnUrl('País de Gales', { cacheBust: true })).toContain('gb-wls.png?v=')
    expect(getFlagCdnUrl('Irlanda do Norte', { cacheBust: 'v123' })).toBe(
      'https://flagcdn.com/w80/gb-nir.png?v=v123',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'Escócia', cacheBust: true })).toContain('gb-sct.png?v=')

    // resolveTeamBadgeUrl gera FlagCDN para as novas seleções quando não há badge certificado
    expect(
      resolveTeamBadgeUrl({
        teamName: 'Letônia',
        savedBadge: '',
      }),
    ).toBe('https://flagcdn.com/w80/lv.png')

    expect(
      resolveTeamBadgeUrl({
        teamName: 'Chipre',
        savedBadge: 'https://media.api-sports.io/football/teams/192.png', // logo contaminado
      }),
    ).toBe('https://flagcdn.com/w80/cy.png')

    expect(
      resolveTeamBadgeUrl({
        teamName: 'RD Congo',
        savedBadge: '',
      }),
    ).toBe('https://flagcdn.com/w80/cd.png')

    expect(
      resolveTeamBadgeUrl({
        teamName: 'Burkina Faso',
        savedBadge: '',
      }),
    ).toBe('https://flagcdn.com/w80/bf.png')
  })

  it('suporta plano de fallback de escudos em 4 níveis (ficha_detalhes -> fixture_id -> cache -> bandeira/sigla)', () => {
    // 1. Extração de ficha_detalhes (Nível 1)
    const fichaDetalhes = {
      teams: {
        home: {
          id: 50,
          name: 'Manchester City',
          logo: 'https://media.api-sports.io/football/teams/50.png',
        },
        away: {
          id: 40,
          name: 'Liverpool',
          logo: 'https://media.api-sports.io/football/teams/40.png',
        },
      },
    }

    const badgeCity = resolveTeamBadgeUrl({
      teamName: 'Manchester City',
      fichaDetalhes,
      isSide: 'home',
    })
    expect(badgeCity).toBe('https://media.api-sports.io/football/teams/50.png')

    const badgeLiv = resolveTeamBadgeUrl({
      teamName: 'Liverpool',
      fichaDetalhes,
      isSide: 'away',
    })
    expect(badgeLiv).toBe('https://media.api-sports.io/football/teams/40.png')

    // 2. Extração via fixtureLogosMemoryCache (Nível 2)
    fixtureLogosMemoryCache.set('99999', {
      home: 'https://media.api-sports.io/football/teams/123.png',
      away: 'https://media.api-sports.io/football/teams/456.png',
    })

    const badgeFixtureHome = resolveTeamBadgeUrl({
      teamName: 'Time Teste A',
      fixtureId: '99999',
      isSide: 'home',
    })
    expect(badgeFixtureHome).toBe('https://media.api-sports.io/football/teams/123.png')

    // 3. Cache local (Nível 3)
    const badgeCache = resolveTeamBadgeUrl({
      teamName: 'Time Teste B',
      liveOrCacheBadge: 'https://media.api-sports.io/football/teams/789.png',
    })
    expect(badgeCache).toBe('https://media.api-sports.io/football/teams/789.png')

    // 4. Último recurso (Nível 4): Bandeira para seleção ou null (monograma) para clube
    const badgeSelecao = resolveTeamBadgeUrl({
      teamName: 'Brasil',
    })
    expect(badgeSelecao).toBe('https://flagcdn.com/w80/br.png')

    const badgeClubeDesconhecido = resolveTeamBadgeUrl({
      teamName: 'Clube Sem Escudo FC',
    })
    expect(badgeClubeDesconhecido).toBeNull()
  })

  it('(b) extractLogosFromFichaDetalhes resolve logo de string JSON parseada', () => {
    // String JSON vinda do PocketBase
    const jsonString = JSON.stringify({
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

    const logos = extractLogosFromFichaDetalhes(jsonString)
    expect(logos).not.toBeNull()
    expect(logos?.home).toBe('https://media.api-sports.io/football/teams/1098.png')
    expect(logos?.away).toBe('https://media.api-sports.io/football/teams/1097.png')

    // Suporta também string duplamente serializada
    const doubleEncoded = JSON.stringify(jsonString)
    const logosDouble = extractLogosFromFichaDetalhes(doubleEncoded)
    expect(logosDouble).not.toBeNull()
    expect(logosDouble?.home).toBe('https://media.api-sports.io/football/teams/1098.png')

    // String inválida retorna null sem lançar erro
    expect(extractLogosFromFichaDetalhes('{ invalid json')).toBeNull()
    expect(extractLogosFromFichaDetalhes('')).toBeNull()
    expect(extractLogosFromFichaDetalhes(null)).toBeNull()
  })

  it('(c) resolveTeamBadgeUrl("Coritiba") retorna a URL com team_id 132 e NUNCA 147; "Chapecoense" retorna 147 e NUNCA 132', () => {
    const coritibaBadge = resolveTeamBadgeUrl({ teamName: 'Coritiba' })
    expect(coritibaBadge).toBe('https://media.api-sports.io/football/teams/132.png')
    expect(coritibaBadge).not.toContain('147')

    const coritibaFbcBadge = resolveTeamBadgeUrl({ teamName: 'Coritiba FBC' })
    expect(coritibaFbcBadge).toBe('https://media.api-sports.io/football/teams/132.png')

    const cfcBadge = resolveTeamBadgeUrl({ teamName: 'CFC' })
    expect(cfcBadge).toBe('https://media.api-sports.io/football/teams/132.png')

    const coxaBadge = resolveTeamBadgeUrl({ teamName: 'Coxa' })
    expect(coxaBadge).toBe('https://media.api-sports.io/football/teams/132.png')

    const chapecoenseBadge = resolveTeamBadgeUrl({ teamName: 'Chapecoense' })
    expect(chapecoenseBadge).toBe('https://media.api-sports.io/football/teams/147.png')
    expect(chapecoenseBadge).not.toContain('132')

    const chapeBadge = resolveTeamBadgeUrl({ teamName: 'Chape' })
    expect(chapeBadge).toBe('https://media.api-sports.io/football/teams/147.png')

    const acfBadge = resolveTeamBadgeUrl({ teamName: 'ACF' })
    expect(acfBadge).toBe('https://media.api-sports.io/football/teams/147.png')

    // Casos específicos solicitados:
    // "EC Vitória x Chapecoense" (visitante = ACF / Chapecoense -> 147)
    const visitanteChape = resolveTeamBadgeUrl({ teamName: 'Chapecoense' })
    expect(visitanteChape).toBe('https://media.api-sports.io/football/teams/147.png')
    const visitanteAcf = resolveTeamBadgeUrl({ teamName: 'ACF' })
    expect(visitanteAcf).toBe('https://media.api-sports.io/football/teams/147.png')

    // "Fluminense x Coritiba" (visitante = CFC / Coritiba -> 132)
    const visitanteCoritiba = resolveTeamBadgeUrl({ teamName: 'Coritiba' })
    expect(visitanteCoritiba).toBe('https://media.api-sports.io/football/teams/132.png')
    const visitanteCfc = resolveTeamBadgeUrl({ teamName: 'CFC' })
    expect(visitanteCfc).toBe('https://media.api-sports.io/football/teams/132.png')

    // Testar que descarta URLs invertidas salvas no banco
    const coritibaComLixo = resolveTeamBadgeUrl({
      teamName: 'Coritiba',
      savedBadge: 'https://media.api-sports.io/football/teams/147.png',
    })
    expect(coritibaComLixo).toBe('https://media.api-sports.io/football/teams/132.png')

    const chapeComLixo = resolveTeamBadgeUrl({
      teamName: 'Chapecoense',
      savedBadge: 'https://media.api-sports.io/football/teams/132.png',
    })
    expect(chapeComLixo).toBe('https://media.api-sports.io/football/teams/147.png')
  })

  it('(d) Vitória resolve para 136 e NUNCA 140 (Criciúma); Criciúma resolve para 140', () => {
    const vitoriaBadge = resolveTeamBadgeUrl({ teamName: 'Vitória' })
    expect(vitoriaBadge).toBe('https://media.api-sports.io/football/teams/136.png')
    expect(vitoriaBadge).not.toContain('140')

    const ecVitoriaBadge = resolveTeamBadgeUrl({ teamName: 'EC Vitória' })
    expect(ecVitoriaBadge).toBe('https://media.api-sports.io/football/teams/136.png')

    const criciumaBadge = resolveTeamBadgeUrl({ teamName: 'Criciúma' })
    expect(criciumaBadge).toBe('https://media.api-sports.io/football/teams/140.png')
  })

  it('(e) Cruzeiro resolve para 135 e NUNCA 132 (Coritiba)', () => {
    const cruzeiroBadge = resolveTeamBadgeUrl({ teamName: 'Cruzeiro' })
    expect(cruzeiroBadge).toBe('https://media.api-sports.io/football/teams/135.png')
    expect(cruzeiroBadge).not.toContain('132')
  })

  it('(f) São Paulo e Santos resolvem para 126 e 128 com paridade em variações de nome', () => {
    // São Paulo
    expect(resolveTeamBadgeUrl({ teamName: 'São Paulo' })).toBe(
      'https://media.api-sports.io/football/teams/126.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'sao paulo' })).toBe(
      'https://media.api-sports.io/football/teams/126.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'SPFC' })).toBe(
      'https://media.api-sports.io/football/teams/126.png',
    )

    // Santos
    expect(resolveTeamBadgeUrl({ teamName: 'Santos' })).toBe(
      'https://media.api-sports.io/football/teams/128.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'santos' })).toBe(
      'https://media.api-sports.io/football/teams/128.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'Santos FC' })).toBe(
      'https://media.api-sports.io/football/teams/128.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'santosfc' })).toBe(
      'https://media.api-sports.io/football/teams/128.png',
    )
  })

  it('(g) Todos os clubes da Série A mapeados com seus respectivos IDs oficiais', () => {
    const serieAMap: Record<string, string> = {
      'São Paulo': '126',
      Santos: '128',
      Flamengo: '127',
      Corinthians: '131',
      Palmeiras: '121',
      Fluminense: '124',
      Botafogo: '120',
      Vasco: '133',
      Coritiba: '132',
      Chapecoense: '147',
      Grêmio: '130',
      Internacional: '119',
      'Atlético Mineiro': '1062',
      Bahia: '118',
      Fortaleza: '154',
      'Athletico Paranaense': '134',
      Juventude: '152',
      'Red Bull Bragantino': '1199',
      Cuiabá: '1200',
      Mirassol: '10214',
      Remo: '10213',
    }

    for (const [teamName, expectedId] of Object.entries(serieAMap)) {
      const badge = resolveTeamBadgeUrl({ teamName })
      expect(badge).toBe(`https://media.api-sports.io/football/teams/${expectedId}.png`)
    }
  })

  it('(h) Boca Juniors (451), Estudiantes (435) e River Plate (450) mapeados exatamente', () => {
    expect(resolveTeamBadgeUrl({ teamName: 'Boca Juniors' })).toBe(
      'https://media.api-sports.io/football/teams/451.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'Estudiantes' })).toBe(
      'https://media.api-sports.io/football/teams/435.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'Estudiantes de La Plata' })).toBe(
      'https://media.api-sports.io/football/teams/435.png',
    )
    expect(resolveTeamBadgeUrl({ teamName: 'River Plate' })).toBe(
      'https://media.api-sports.io/football/teams/450.png',
    )
  })
})
