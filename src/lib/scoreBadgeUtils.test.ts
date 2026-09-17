import { describe, it, expect } from 'vitest'
import {
  parseDetalhamentoStrings,
  deriveBadgesFromMatch,
  getScoreBreakdownBadges,
} from './scoreBadgeUtils'

describe('scoreBadgeUtils', () => {
  describe('parseDetalhamentoStrings', () => {
    it('deve extrair Placar Exato corretamente', () => {
      const badges = parseDetalhamentoStrings(['Placar Exato (+8 pts)'])
      expect(badges).toHaveLength(1)
      expect(badges[0].id).toBe('placar_exato')
      expect(badges[0].label).toBe('Placar Exato')
      expect(badges[0].pointsText).toBe('+8')
    })

    it('deve extrair Vencedor e Diferença de Gols', () => {
      const badges = parseDetalhamentoStrings(['Vencedor (+2 pts)', 'Diferença de Gols (+1 pt)'])
      expect(badges).toHaveLength(2)
      expect(badges.map((b) => b.id)).toEqual(['vencedor', 'diferenca_gols'])
      expect(badges[0].label).toBe('Vencedor')
      expect(badges[1].label).toBe('Saldo de Gols')
    })

    it('deve extrair Empate', () => {
      const badges = parseDetalhamentoStrings(['Empate (+2 pts)'])
      expect(badges).toHaveLength(1)
      expect(badges[0].id).toBe('vencedor_empate')
      expect(badges[0].label).toBe('Empate')
    })

    it('deve extrair Vencedor nos Pênaltis', () => {
      const badges = parseDetalhamentoStrings(['Vencedor nos Pênaltis (+2 pts)'])
      expect(badges).toHaveLength(1)
      expect(badges[0].id).toBe('penaltis')
      expect(badges[0].label).toBe('Vencedor nos Pênaltis')
    })

    it('deve extrair Gols acertados com posições e pontos', () => {
      const badges = parseDetalhamentoStrings([
        'Vencedor (+2 pts)',
        'Gols acertados: Bernard (+1 pt - Atacante/Meia), Lyanco (+5 pts - Gol Contra)',
      ])
      expect(badges).toHaveLength(3)
      expect(badges[0].id).toBe('vencedor')
      expect(badges[1].label).toContain('Bernard')
      expect(badges[1].pointsText).toBe('+1')
      expect(badges[2].label).toContain('Lyanco')
      expect(badges[2].pointsText).toBe('+5')
    })

    it('deve tratar strings no formato da Copa Coni ("Placar Exato e gols de Kaio Jorge e Matheus Pereira")', () => {
      const badges = parseDetalhamentoStrings([
        'Placar Exato e gols de Kaio Jorge e Matheus Pereira',
      ])
      expect(badges.length).toBeGreaterThanOrEqual(2)
      expect(badges.some((b) => b.id === 'placar_exato')).toBe(true)
      expect(badges.some((b) => b.label.includes('Kaio Jorge'))).toBe(true)
    })
  })

  describe('deriveBadgesFromMatch', () => {
    it('deve derivar Placar Exato (+8)', () => {
      const badges = deriveBadgesFromMatch(
        { placar_a: 2, placar_b: 1, pontuacao_jogo: 8 },
        { placar_a: 2, placar_b: 1, resultado_finalizado: true },
      )
      expect(badges).toHaveLength(1)
      expect(badges[0].id).toBe('placar_exato')
    })

    it('deve derivar Vencedor, Saldo e Metade do Placar', () => {
      // Real: 2x0. Palpite: 3x1 -> mesmo vencedor, mesma diferença (+2), nenhum placar parcial igual
      const b1 = deriveBadgesFromMatch(
        { placar_a: 3, placar_b: 1, pontuacao_jogo: 3 },
        { placar_a: 2, placar_b: 0, resultado_finalizado: true },
      )
      expect(b1.map((b) => b.id)).toEqual(['vencedor', 'diferenca_gols'])

      // Real: 2x1. Palpite: 2x0 -> mesmo vencedor, metade do placar (mandante = 2)
      const b2 = deriveBadgesFromMatch(
        { placar_a: 2, placar_b: 0, pontuacao_jogo: 3 },
        { placar_a: 2, placar_b: 1, resultado_finalizado: true },
      )
      expect(b2.map((b) => b.id)).toEqual(['vencedor', 'metade_placar'])
    })

    it('deve derivar Vencedor nos Pênaltis', () => {
      const badges = deriveBadgesFromMatch(
        {
          placar_a: 1,
          placar_b: 1,
          vencedor_penaltis: 'A',
          pontuacao_jogo: 4,
        },
        {
          placar_a: 1,
          placar_b: 1,
          tem_penaltis: true,
          vencedor_penaltis: 'A',
          resultado_finalizado: true,
        },
      )
      expect(badges.some((b) => b.id === 'placar_exato')).toBe(true)
      expect(badges.some((b) => b.id === 'penaltis')).toBe(true)
    })

    it('deve derivar Marcador de Gol com posição', () => {
      const badges = deriveBadgesFromMatch(
        {
          placar_a: 1,
          placar_b: 0,
          goleadores_a: ['Gómez'],
          pontuacao_jogo: 4,
        },
        {
          placar_a: 1,
          placar_b: 0,
          gols_time_a: [{ nome: 'Gómez', posicao: 'Zagueiro/Lateral', quantidade: 1 }],
          resultado_finalizado: true,
        },
      )
      expect(badges.some((b) => b.id === 'placar_exato')).toBe(true)
      const scorerBadge = badges.find((b) => b.variant === 'scorer')
      expect(scorerBadge).toBeDefined()
      expect(scorerBadge?.label).toContain('Gómez')
      expect(scorerBadge?.pointsText).toBe('+3')
    })
  })

  describe('getScoreBreakdownBadges', () => {
    it('não deve retornar badges para palpites com pontuação 0', () => {
      const badges = getScoreBreakdownBadges(
        { placar_a: 0, placar_b: 1, pontuacao_jogo: 0 },
        { placar_a: 2, placar_b: 1, resultado_finalizado: true },
      )
      expect(badges).toHaveLength(0)
    })

    it('não deve retornar badges se resultado não estiver finalizado', () => {
      const badges = getScoreBreakdownBadges(
        { placar_a: 2, placar_b: 1, pontuacao_jogo: 8 },
        { placar_a: 2, placar_b: 1, resultado_finalizado: false },
      )
      expect(badges).toHaveLength(0)
    })

    it('deve mesclar detalhamento da Copa Coni com badges limpas', () => {
      const badges = getScoreBreakdownBadges(
        {
          placar_a: 1,
          placar_b: 2,
          detalhamento: ['Placar Exato e gols de Kaio Jorge e Matheus Pereira'],
          pontuacao_jogo: 10,
        },
        {
          placar_a: 1,
          placar_b: 2,
          resultado_finalizado: true,
        },
      )
      expect(badges.length).toBeGreaterThanOrEqual(1)
      expect(badges[0].id).toBe('placar_exato')
    })
  })
})
