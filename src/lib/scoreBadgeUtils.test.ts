import { describe, it, expect } from 'vitest'
import {
  parseDetalhamentoStrings,
  deriveBadgesFromMatch,
  getScoreBreakdownBadges,
  calculateLiveMatchScoreBreakdown,
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
    it('não deve retornar badges para jogos futuros mesmo se tiver pontuacao_jogo', () => {
      const badges = getScoreBreakdownBadges(
        { placar_a: 2, placar_b: 2, pontuacao_jogo: 3, detalhamento: ['Empate (+2 pts)'] },
        {
          data: '2026-09-26',
          hora: '15:45',
          placar_a: 0,
          placar_b: 0,
          status: 'finalizado',
          resultado_finalizado: true,
        },
        new Date('2026-09-24T12:00:00-03:00').getTime(),
      )
      expect(badges).toHaveLength(0)
    })

    it('não deve retornar badges para palpites com pontuação 0', () => {
      const badges = getScoreBreakdownBadges(
        { placar_a: 0, placar_b: 1, pontuacao_jogo: 0 },
        {
          data: '2026-09-20',
          hora: '16:00',
          placar_a: 2,
          placar_b: 1,
          resultado_finalizado: true,
        },
      )
      expect(badges).toHaveLength(0)
    })

    it('não deve retornar badges se resultado não estiver finalizado', () => {
      const badges = getScoreBreakdownBadges(
        { placar_a: 2, placar_b: 1, pontuacao_jogo: 8 },
        {
          data: '2026-09-20',
          hora: '16:00',
          placar_a: 2,
          placar_b: 1,
          resultado_finalizado: false,
        },
      )
      expect(badges).toHaveLength(0)
    })

    it('deve mesclar detalhamento da Copa Coni com badges limpas para jogo passado válido', () => {
      const badges = getScoreBreakdownBadges(
        {
          placar_a: 1,
          placar_b: 2,
          detalhamento: ['Placar Exato e gols de Kaio Jorge e Matheus Pereira'],
          pontuacao_jogo: 10,
        },
        {
          data: '2026-09-20',
          hora: '16:00',
          placar_a: 1,
          placar_b: 2,
          resultado_finalizado: true,
        },
      )
      expect(badges.length).toBeGreaterThanOrEqual(1)
      expect(badges[0].id).toBe('placar_exato')
    })
  })

  describe('calculateLiveMatchScoreBreakdown', () => {
    it('retorna 0 pontos e vazio se placar não iniciado (null)', () => {
      const res = calculateLiveMatchScoreBreakdown(
        { placar_a: 2, placar_b: 1, pontuacao_jogo: 0 },
        null,
        null,
      )
      expect(res.pontos).toBe(0)
      expect(res.badges).toHaveLength(0)
      expect(res.resumoTexto).toBe('')
    })

    it('calcula pontos ao vivo com placar parcial e marcadores com pesos de posições', () => {
      // Palpite: 2x1 (goleador Raphinha)
      // Placar parcial: 2x0 (Raphinha marcou 1)
      // Pontos esperados: Vencedor (+2) + Metade (+1) + Raphinha (+1 atacante) = +4 parciais
      const res = calculateLiveMatchScoreBreakdown(
        {
          placar_a: 2,
          placar_b: 1,
          pontuacao_jogo: 0,
          goleadores_a: ['Raphinha'],
        },
        2,
        0,
        [{ nome: 'Raphinha', posicao: 'Atacante', quantidade: 1 }],
      )
      expect(res.pontos).toBe(4)
      expect(res.badges.some((b) => b.id === 'vencedor')).toBe(true)
      expect(res.badges.some((b) => b.id === 'metade_placar')).toBe(true)
      expect(res.resumoTexto).toContain('Vencedor (+2 pts)')
      expect(res.resumoTexto).toContain('Metade do Placar (+1 pt)')
      expect(res.resumoTexto).toContain('Raphinha [Atacante] (+1 pt)')
    })

    it('aplica pontuações de zagueiro (+3), goleiro (+10) e gol contra (+5)', () => {
      const res = calculateLiveMatchScoreBreakdown(
        {
          placar_a: 3,
          placar_b: 0,
          pontuacao_jogo: 0,
          goleadores_a: ['Gómez', 'Cássio', 'Lyanco (gol contra)'],
        },
        3,
        0,
        [
          { nome: 'Gómez', posicao: 'Defensor', quantidade: 1 },
          { nome: 'Cássio', posicao: 'Goleiro', quantidade: 1 },
          { nome: 'Lyanco', posicao: 'Gol Contra', quantidade: 1 },
        ],
      )
      // Placar exato: +8
      // Gómez: +3
      // Cássio: +10
      // Lyanco (gol contra): +5
      // Total: 8 + 3 + 10 + 5 = 26
      expect(res.pontos).toBe(26)
      expect(res.badges.some((b) => b.id === 'placar_exato')).toBe(true)
      expect(res.resumoTexto).toContain('Gómez [Defensor] (+3 pts)')
      expect(res.resumoTexto).toContain('Cássio [Goleiro] (+10 pts)')
      expect(res.resumoTexto).toContain('Lyanco [Gol Contra] (+5 pts)')
    })

    it('prioriza a posição definida pelo admin no palpite sobre a posição da API ao vivo (caso Davi / Marquinhos Defensor)', () => {
      // Palpite do Davi: 0x3, Marquinhos salvo como Defensor no palpite
      // API ao vivo veio com Marquinhos como Atacante (ou fallback 1 pt)
      const res = calculateLiveMatchScoreBreakdown(
        {
          placar_a: 0,
          placar_b: 3,
          pontuacao_jogo: 0,
          goleadores_b: [
            { nome: 'Marquinhos', posicao: 'Defensor', quantidade: 1, gol_contra: false },
          ],
        },
        0,
        5, // Marseille 0 x 5 PSG
        [{ nome: "Marquinhos 74'", posicao: 'Atacante', quantidade: 1, points: 1 }],
      )

      // Marseille 0 x 5 PSG vs palpite 0 x 3:
      // Vencedor (+2 pts)
      // Metade do Placar (+1 pt, acertou 0 do Marseille)
      // Marquinhos 74' [Defensor] (+3 pts)
      // Total: 2 + 1 + 3 = 6 pts parciais
      expect(res.pontos).toBe(6)
      expect(res.badges.some((b) => b.id === 'vencedor')).toBe(true)
      expect(res.badges.some((b) => b.id === 'metade_placar')).toBe(true)
      expect(res.resumoTexto).toContain("Marquinhos 74' [Defensor] (+3 pts)")
    })

    describe('cálculo por frequência min(N, M)', () => {
      it('N=2, M=2 com minutos -> +2 pts (Atacante) e texto consolidado com minutos', () => {
        const res = calculateLiveMatchScoreBreakdown(
          {
            placar_a: 2,
            placar_b: 0,
            pontuacao_jogo: 0,
            goleadores_a: ['Raphinha', 'Raphinha'],
          },
          2,
          0,
          [
            { nome: "Raphinha 22'", posicao: 'Atacante', quantidade: 1 },
            { nome: "Raphinha 52'", posicao: 'Atacante', quantidade: 1 },
          ],
        )
        // Placar exato (+8) + Raphinha (+2: 2 acertos de atacante) = 10 pts
        expect(res.pontos).toBe(10)
        expect(res.resumoTexto).toContain("Raphinha 22', 52' [Atacante] (+2 pts)")
      })

      it('N=2, M=1 -> +1 pt (Atacante)', () => {
        const res = calculateLiveMatchScoreBreakdown(
          {
            placar_a: 2,
            placar_b: 0,
            pontuacao_jogo: 0,
            goleadores_a: ['Raphinha'],
          },
          2,
          0,
          [
            { nome: "Raphinha 22'", posicao: 'Atacante', quantidade: 1 },
            { nome: "Raphinha 52'", posicao: 'Atacante', quantidade: 1 },
          ],
        )
        expect(res.pontos).toBe(9) // 8 exato + 1 gol
        expect(res.resumoTexto).toContain("Raphinha 22' [Atacante] (+1 pt)")
      })

      it('N=1, M=2 -> +1 pt (Atacante)', () => {
        const res = calculateLiveMatchScoreBreakdown(
          {
            placar_a: 2,
            placar_b: 0,
            pontuacao_jogo: 0,
            goleadores_a: ['Raphinha', 'Raphinha'],
          },
          2,
          0,
          [{ nome: "Raphinha 22'", posicao: 'Atacante', quantidade: 1 }],
        )
        expect(res.pontos).toBe(9) // 8 exato + 1 gol
        expect(res.resumoTexto).toContain("Raphinha 22' [Atacante] (+1 pt)")
      })

      it('Defensor N=2, M=2 -> +6 pts', () => {
        const res = calculateLiveMatchScoreBreakdown(
          {
            placar_a: 2,
            placar_b: 0,
            pontuacao_jogo: 0,
            goleadores_a: ['Gabriel Magalhães', 'Gabriel Magalhães'],
          },
          2,
          0,
          [{ nome: 'Gabriel Magalhães', posicao: 'Defensor', quantidade: 2 }],
        )
        // 8 exato + min(2,2)*3 = 8 + 6 = 14 pts
        expect(res.pontos).toBe(14)
        expect(res.resumoTexto).toContain('Gabriel Magalhães ×2 [Defensor] (+6 pts)')
      })

      it('Fallback sem minutos: Raphinha ×2 [Atacante] (+2 pts)', () => {
        const res = calculateLiveMatchScoreBreakdown(
          {
            placar_a: 2,
            placar_b: 0,
            pontuacao_jogo: 0,
            goleadores_a: ['Raphinha', 'Raphinha'],
          },
          2,
          0,
          [{ nome: 'Raphinha', posicao: 'Atacante', quantidade: 2 }],
        )
        expect(res.pontos).toBe(10)
        expect(res.resumoTexto).toContain('Raphinha ×2 [Atacante] (+2 pts)')
      })
    })
  })
})
