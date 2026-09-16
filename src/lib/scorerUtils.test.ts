import { describe, it, expect } from 'vitest'
import {
  extractScorerNames,
  formatPalpiteMarcadoresSummary,
  getPalpiteMarcadoresPorTime,
  splitMatchScorersByTeam,
} from './scorerUtils'

describe('scorerUtils', () => {
  describe('extractScorerNames', () => {
    it('deve extrair nomes de array simples de strings', () => {
      expect(extractScorerNames(['Veiga', 'Flaco López'])).toEqual(['Veiga', 'Flaco López'])
    })

    it('deve extrair nomes de string separada por vírgula', () => {
      expect(extractScorerNames('Luis Segovia, Marlon Freitas')).toEqual([
        'Luis Segovia',
        'Marlon Freitas',
      ])
    })

    it('deve extrair nomes de JSON stringificado', () => {
      expect(extractScorerNames('["Pedro", "Arrascaeta"]')).toEqual(['Pedro', 'Arrascaeta'])
    })

    it('deve lidar com valores nulos, vazios ou indefinidos', () => {
      expect(extractScorerNames(null)).toEqual([])
      expect(extractScorerNames(undefined)).toEqual([])
      expect(extractScorerNames('')).toEqual([])
      expect(extractScorerNames([])).toEqual([])
    })
  })

  describe('formatPalpiteMarcadoresSummary (modo legado em linha única)', () => {
    it('deve exibir "Sem marcadores (0x0)" para 0 a 0', () => {
      expect(
        formatPalpiteMarcadoresSummary({
          placar_a: 0,
          placar_b: 0,
        }),
      ).toBe('Sem marcadores (0x0)')
    })

    it('deve exibir "0x0" quando solicitado na opção showZeroAs0x0', () => {
      expect(
        formatPalpiteMarcadoresSummary(
          {
            placar_a: 0,
            placar_b: 0,
          },
          { showZeroAs0x0: true },
        ),
      ).toBe('0x0')
    })

    it('deve juntar os marcadores de A e B', () => {
      expect(
        formatPalpiteMarcadoresSummary({
          placar_a: 1,
          placar_b: 1,
          goleadores_a: ['Ricardo Adé'],
          goleadores_b: ['Flaco López'],
        }),
      ).toBe('Gols: Ricardo Adé, Flaco López')
    })
  })

  describe('getPalpiteMarcadoresPorTime (separação por time nos palpites)', () => {
    it('cenário: gols dos dois lados (1 x 1)', () => {
      const res = getPalpiteMarcadoresPorTime({
        placar_a: 1,
        placar_b: 1,
        goleadores_a: ['Ricardo Adé'],
        goleadores_b: ['Flaco López'],
      })

      expect(res.placarA).toBe(1)
      expect(res.placarB).toBe(1)
      expect(res.timeA).toEqual(['Ricardo Adé'])
      expect(res.timeB).toEqual(['Flaco López'])
      expect(res.labelA).toBe('Ricardo Adé')
      expect(res.labelB).toBe('Flaco López')
      expect(res.isZeroA).toBe(false)
      expect(res.isZeroB).toBe(false)
    })

    it('cenário: gols só do mandante (2 x 0) -> visitante exibe "-"', () => {
      const res = getPalpiteMarcadoresPorTime({
        placar_a: 2,
        placar_b: 0,
        goleadores_a: ['Pedro', 'Arrascaeta'],
        goleadores_b: [],
      })

      expect(res.placarA).toBe(2)
      expect(res.placarB).toBe(0)
      expect(res.labelA).toBe('Pedro, Arrascaeta')
      expect(res.labelB).toBe('-')
      expect(res.isZeroA).toBe(false)
      expect(res.isZeroB).toBe(true)
    })

    it('cenário: gols só do visitante (0 x 1) -> mandante exibe "-"', () => {
      const res = getPalpiteMarcadoresPorTime({
        placar_a: 0,
        placar_b: 1,
        goleadores_a: [],
        goleadores_b: ['Hulk'],
      })

      expect(res.placarA).toBe(0)
      expect(res.placarB).toBe(1)
      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe('Hulk')
      expect(res.isZeroA).toBe(true)
      expect(res.isZeroB).toBe(false)
    })

    it('cenário: 0 x 0 -> ambos exibem "-"', () => {
      const res = getPalpiteMarcadoresPorTime({
        placar_a: 0,
        placar_b: 0,
      })

      expect(res.placarA).toBe(0)
      expect(res.placarB).toBe(0)
      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe('-')
      expect(res.isZeroA).toBe(true)
      expect(res.isZeroB).toBe(true)
    })

    it('cenário: time com palpite > 0 mas sem nenhum marcador informado -> renderiza "-"', () => {
      const res = getPalpiteMarcadoresPorTime({
        placar_a: 1,
        placar_b: 0,
        goleadores_a: [],
        goleadores_b: [],
      })

      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe('-')
    })
  })

  describe('splitMatchScorersByTeam (gols reais do confronto divididos por equipe)', () => {
    it('cenário API: gols dos dois lados com minuto', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 1,
        placarB: 1,
        liveScorers: [
          { name: 'Luis Segovia', minute: 30, teamSide: 'home' },
          { name: 'Marlon Freitas', minute: 55, teamSide: 'away' },
        ],
      })

      expect(res.scorersA).toEqual(["Luis Segovia 30'"])
      expect(res.scorersB).toEqual(["Marlon Freitas 55'"])
      expect(res.labelA).toBe("Luis Segovia 30'")
      expect(res.labelB).toBe("Marlon Freitas 55'")
      expect(res.hasAnyScorers).toBe(true)
    })

    it('cenário API: gols só do mandante (2 x 0) -> visitante com placar 0 renderiza "-"', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 2,
        placarB: 0,
        liveScorers: [
          { name: 'Luis Segovia', minute: 20, teamSide: 'home' },
          { name: 'Alex Arce', minute: 45, teamSide: 'home' },
        ],
      })

      expect(res.labelA).toBe("Luis Segovia 20', Alex Arce 45'")
      expect(res.labelB).toBe('-')
      expect(res.scorersB).toHaveLength(0)
    })

    it('cenário API: gols só do visitante (0 x 1) -> mandante com placar 0 renderiza "-"', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 0,
        placarB: 1,
        liveScorers: [{ name: 'Marlon Freitas', minute: 78, teamSide: 'away' }],
      })

      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe("Marlon Freitas 78'")
    })

    it('cenário: gol contra é preservado com "(contra)" e atribuído ao lado correto', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'Flamengo',
        teamBName: 'Palmeiras',
        placarA: 1,
        placarB: 0,
        liveScorers: [{ name: 'Gustavo Gómez (contra)', minute: 22, teamSide: 'home' }],
      })

      expect(res.labelA).toBe("Gustavo Gómez (contra) 22'")
      expect(res.labelB).toBe('-')
    })

    it('cenário Sobrescrita do Admin Douglas: divide marcadores na proporção do placar A x B', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 1,
        placarB: 1,
        sobrescritaMarcadores: ['Luis Segovia', 'Marlon Freitas'],
      })

      expect(res.labelA).toBe('Luis Segovia')
      expect(res.labelB).toBe('Marlon Freitas')
    })

    it('cenário Banco Manual: usa golsBancoA e golsBancoB estruturados', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 1,
        placarB: 2,
        golsBancoA: [{ nome: 'Luis Segovia', posicao: 'Zagueiro' }],
        golsBancoB: [
          { nome: 'Veiga', posicao: 'Atacante/Meia' },
          { nome: 'Flaco López', posicao: 'Atacante/Meia' },
        ],
      })

      expect(res.labelA).toBe('Luis Segovia (Zagueiro)')
      expect(res.labelB).toBe('Veiga (Atacante/Meia), Flaco López (Atacante/Meia)')
    })

    it('cenário 0 x 0 sem gols: ambos exibem "-" e hasAnyScorers é false', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'Flamengo',
        teamBName: 'Vasco',
        placarA: 0,
        placarB: 0,
      })

      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe('-')
      expect(res.hasAnyScorers).toBe(false)
    })
  })
})
