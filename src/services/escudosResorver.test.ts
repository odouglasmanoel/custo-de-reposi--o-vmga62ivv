import { describe, it, expect, beforeEach } from 'vitest'
import { readEscudoCache, writeEscudoCache } from '@/services/enquetes'

describe('Resolução de Escudos e Purga de Contaminação Dinamarca / B.S.C.', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('ordem de resolução: cache oficial de Dinamarca retorna SEMPRE teams/21.png', () => {
    const escudoDinamarca = readEscudoCache('Dinamarca')
    expect(escudoDinamarca).toBe('https://media.api-sports.io/football/teams/21.png')
  })

  it('purga ativa: se localStorage ou memória tiver escudo do B.S.C. (z3v04x) para Dinamarca, expurga e retorna o oficial', () => {
    // Simula contaminação residual antiga no localStorage
    localStorage.setItem(
      '__escudo_cache__dinamarca',
      'https://www.thesportsdb.com/images/media/team/badge/z3v04x1700688329.png',
    )

    const escudo = readEscudoCache('Dinamarca')
    expect(escudo).toBe('https://media.api-sports.io/football/teams/21.png')
    expect(escudo).not.toContain('z3v04x')
    expect(escudo).not.toContain('bsc')
  })

  it('padronização da ordem de resolução: url_escudo_mandante do jogo prevalece sobre escudosMap e fallbacks', () => {
    // Simulação da lógica padronizada implementada em BolaoDashboard:
    // 1. jogo.url_escudo_mandante / jogo.url_escudo_visitante
    // 2. matchedLive?.homeTeamLogo / matchedLive?.awayTeamLogo
    // 3. readEscudoCache(time)
    // 4. escudosMap[time] (com purga)
    const resolverEscudo = (
      time: string,
      jogoUrl: string | undefined,
      matchedLiveLogo: string | undefined,
      escudoMapVal: string | undefined,
    ) => {
      const isCorrompido = (t: string, url?: string | null) => {
        if (!url) return true
        const n = t
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
        if (n.includes('dinamarca') || n.includes('denmark')) {
          if (url.includes('z3v04x') || url.includes('bsc') || url.includes('b.s.c')) {
            return true
          }
        }
        return false
      }

      const escudoMapValido = !isCorrompido(time, escudoMapVal) ? escudoMapVal : ''

      return (
        (!isCorrompido(time, jogoUrl) ? jogoUrl : '') ||
        matchedLiveLogo ||
        readEscudoCache(time) ||
        escudoMapValido ||
        ''
      )
    }

    // Caso 1: Jogo tem url_escudo_mandante oficial da API-Sports
    const res1 = resolverEscudo(
      'Dinamarca',
      'https://media.api-sports.io/football/teams/21.png',
      undefined,
      'https://www.thesportsdb.com/images/media/team/badge/z3v04x1700688329.png',
    )
    expect(res1).toBe('https://media.api-sports.io/football/teams/21.png')

    // Caso 2: Jogo não tem url_escudo_mandante, escudosMap tem lixo de B.S.C. -> cai no readEscudoCache oficial
    const res2 = resolverEscudo(
      'Dinamarca',
      '',
      undefined,
      'https://www.thesportsdb.com/images/media/team/badge/z3v04x1700688329.png',
    )
    expect(res2).toBe('https://media.api-sports.io/football/teams/21.png')

    // Caso 3: Time comum com escudosMap válido
    writeEscudoCache('Noruega', 'https://media.api-sports.io/football/teams/1090.png')
    const res3 = resolverEscudo(
      'Noruega',
      'https://media.api-sports.io/football/teams/1090.png',
      undefined,
      '',
    )
    expect(res3).toBe('https://media.api-sports.io/football/teams/1090.png')
  })

  it('Vitória nunca resolve para 140 (Criciúma) e sim 136; Criciúma resolve para 140', () => {
    expect(readEscudoCache('Vitória')).toBe('https://media.api-sports.io/football/teams/136.png')
    expect(readEscudoCache('EC Vitória')).toBe('https://media.api-sports.io/football/teams/136.png')
    expect(readEscudoCache('Criciúma')).toBe('https://media.api-sports.io/football/teams/140.png')
  })

  it('Coritiba e Chapecoense: sem colisão, descarta caches invertidos', () => {
    // Se localStorage tiver 147 para Coritiba, readEscudoCache descarta e força 132
    localStorage.setItem(
      '__escudo_cache__coritiba',
      'https://media.api-sports.io/football/teams/147.png',
    )
    expect(readEscudoCache('Coritiba')).toBe('https://media.api-sports.io/football/teams/132.png')

    // Se localStorage tiver 132 para Chapecoense, readEscudoCache descarta e força 147
    localStorage.setItem(
      '__escudo_cache__chapecoense',
      'https://media.api-sports.io/football/teams/132.png',
    )
    expect(readEscudoCache('Chapecoense')).toBe(
      'https://media.api-sports.io/football/teams/147.png',
    )
  })

  it('São Paulo e Santos resolvem para 126 e 128 tanto com acento quanto sem acento ou sigla SPFC/santosfc', () => {
    expect(readEscudoCache('São Paulo')).toBe('https://media.api-sports.io/football/teams/126.png')
    expect(readEscudoCache('sao paulo')).toBe('https://media.api-sports.io/football/teams/126.png')
    expect(readEscudoCache('spfc')).toBe('https://media.api-sports.io/football/teams/126.png')
    expect(readEscudoCache('SPFC')).toBe('https://media.api-sports.io/football/teams/126.png')

    expect(readEscudoCache('Santos')).toBe('https://media.api-sports.io/football/teams/128.png')
    expect(readEscudoCache('santos')).toBe('https://media.api-sports.io/football/teams/128.png')
    expect(readEscudoCache('santosfc')).toBe('https://media.api-sports.io/football/teams/128.png')
    expect(readEscudoCache('Santos FC')).toBe('https://media.api-sports.io/football/teams/128.png')
  })
})
