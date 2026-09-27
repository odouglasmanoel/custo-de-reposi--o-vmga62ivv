import { describe, it, expect } from 'vitest'
import {
  extractScorerNames,
  formatScorersDisplayText,
  formatPalpiteMarcadoresSummary,
  formatScorersGroupedByPlayer,
  getPalpiteMarcadoresPorTime,
  splitMatchScorersByTeam,
} from './scorerUtils'
import { calculateLiveMatchScoreBreakdown } from './scoreBadgeUtils'

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

    it('cenário Sobrescrita com campos independentes: marcadores dos dois lados', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 1,
        placarB: 1,
        sobrescritaMarcadoresA: ["Luis Segovia 30'"],
        sobrescritaMarcadoresB: ["Marlon Freitas 55'"],
      })

      expect(res.labelA).toBe("Luis Segovia 30'")
      expect(res.labelB).toBe("Marlon Freitas 55'")
      expect(res.scorersA).toEqual(["Luis Segovia 30'"])
      expect(res.scorersB).toEqual(["Marlon Freitas 55'"])
      expect(res.hasGolsA).toBe(true)
      expect(res.hasGolsB).toBe(true)
    })

    it('cenário Sobrescrita com campos independentes: string com múltiplos autores separados por vírgula', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 2,
        placarB: 1,
        sobrescritaMarcadoresA: "Luis Segovia 15', Alex Arce 44'",
        sobrescritaMarcadoresB: "Flaco López 88'",
      })

      expect(res.labelA).toBe("Luis Segovia 15', Alex Arce 44'")
      expect(res.labelB).toBe("Flaco López 88'")
      expect(res.scorersA).toEqual(["Luis Segovia 15'", "Alex Arce 44'"])
      expect(res.scorersB).toEqual(["Flaco López 88'"])
    })

    it('cenário Sobrescrita com campos independentes: apenas mandante tem gols', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 2,
        placarB: 0,
        sobrescritaMarcadoresA: ["Luis Segovia 10'", "Alex Arce 35'"],
        sobrescritaMarcadoresB: [],
      })

      expect(res.labelA).toBe("Luis Segovia 10', Alex Arce 35'")
      expect(res.labelB).toBe('-')
      expect(res.scorersA).toHaveLength(2)
      expect(res.scorersB).toHaveLength(0)
    })

    it('cenário Sobrescrita com campos independentes: apenas visitante tem gols', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 0,
        placarB: 1,
        sobrescritaMarcadoresA: '',
        sobrescritaMarcadoresB: ["Marlon Freitas 75'"],
      })

      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe("Marlon Freitas 75'")
      expect(res.scorersA).toHaveLength(0)
      expect(res.scorersB).toEqual(["Marlon Freitas 75'"])
    })

    it('cenário Sobrescrita legada: divide marcadores na proporção do placar A x B', () => {
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

    it('cenário Sobrescrita legada: se placar for 2 x 0, atribui todos ao mandante', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 2,
        placarB: 0,
        sobrescritaMarcadores: ['Luis Segovia', 'Alex Arce'],
      })

      expect(res.labelA).toBe('Luis Segovia, Alex Arce')
      expect(res.labelB).toBe('-')
    })

    it('cenário Sobrescrita legada: se placar for 0 x 2, atribui todos ao visitante', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'LDU',
        teamBName: 'Palmeiras',
        placarA: 0,
        placarB: 2,
        sobrescritaMarcadores: ['Veiga', 'Flaco López'],
      })

      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe('Veiga, Flaco López')
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

    it('(a) marcador com team_id do Azerbaijão NUNCA entra na lista de gols da Lituânia mesmo com placar 1x1 e teamSide ausente', () => {
      // Caso real diagnosticado:
      // Confronto: Lituânia (Mandante, teamId 1098 ou via url) x Azerbaijão (Visitante, teamId 1097)
      // Placar 1x1: 1 gol para Lituânia (Armandas Kucys) e 1 gol para Azerbaijão (Mahir Emreli)
      // teamSide ausente (null) na API, mas com teamId nos marcadores
      const res = splitMatchScorersByTeam({
        teamAName: 'Lituânia',
        teamBName: 'Azerbaijão',
        teamAId: 1098,
        teamBId: 1097,
        urlEscudoA: 'https://media.api-sports.io/football/teams/1098.png',
        urlEscudoB: 'https://media.api-sports.io/football/teams/1097.png',
        placarA: 1,
        placarB: 1,
        liveScorers: [
          {
            name: 'Mahir Emreli',
            minute: 45,
            teamId: 1097, // Azerbaijão
            teamSide: null,
          },
          {
            name: 'Armandas Kucys',
            minute: 60,
            teamId: 1098, // Lituânia
            teamSide: null,
          },
        ],
      })

      // Mahir Emreli DEVE ir para o Azerbaijão (time B), NUNCA para a Lituânia (time A)
      expect(res.scorersA).toContain("Armandas Kucys 60'")
      expect(res.scorersA).not.toContain("Mahir Emreli 45'")
      expect(res.scorersB).toContain("Mahir Emreli 45'")
      expect(res.scorersB).not.toContain("Armandas Kucys 60'")

      expect(res.labelA).toBe("Armandas Kucys 60'")
      expect(res.labelB).toBe("Mahir Emreli 45'")
    })

    it('(a2) extrai teamId das URLs dos escudos se teamAId e teamBId não forem passados diretamente', () => {
      const res = splitMatchScorersByTeam({
        teamAName: 'Lituânia',
        teamBName: 'Azerbaijão',
        urlEscudoA: 'https://media.api-sports.io/football/teams/1098.png',
        urlEscudoB: 'https://media.api-sports.io/football/teams/1097.png',
        placarA: 1,
        placarB: 1,
        liveScorers: [
          {
            name: 'Mahir Emreli',
            minute: 45,
            teamId: '1097',
            teamSide: null,
          },
        ],
      })

      expect(res.scorersA).toHaveLength(0)
      expect(res.scorersB).toEqual(["Mahir Emreli 45'"])
      expect(res.labelA).toBe('-')
      expect(res.labelB).toBe("Mahir Emreli 45'")
    })
  })

  describe('formatScorersGroupedByPlayer', () => {
    it("agrupa múltiplos gols do mesmo jogador com minutos em lista concatenada (ex: Raphinha 22', 52', 69')", () => {
      const input = ["Raphinha 22'", "Raphinha 52'", "Raphinha 69'"]
      const result = formatScorersGroupedByPlayer(input)
      expect(result).toBe("Raphinha 22', 52', 69'")
    })

    it("formata um gol com minuto corretamente (ex: Youssouf Fofana 19')", () => {
      const input = ["Youssouf Fofana 19'"]
      const result = formatScorersGroupedByPlayer(input)
      expect(result).toBe("Youssouf Fofana 19'")
    })

    it('formata sem minuto único como apenas o Nome', () => {
      const input = ['Raphinha']
      const result = formatScorersGroupedByPlayer(input)
      expect(result).toBe('Raphinha')
    })

    it('formata sem minuto múltiplo com indicador de repetição Nome (2x)', () => {
      const input = ['Raphinha', 'Raphinha']
      const result = formatScorersGroupedByPlayer(input)
      expect(result).toBe('Raphinha (2x)')
    })

    it('mistura jogadores com e sem múltiplos gols mantendo a ordem de ocorrência', () => {
      const input = ["Youssouf Fofana 19'", "Raphinha 22'", "Raphinha 52'", "Raphinha 69'"]
      const result = formatScorersGroupedByPlayer(input)
      expect(result).toBe("Youssouf Fofana 19', Raphinha 22', 52', 69'")
    })

    it('retorna "-" para listas vazias ou nulas', () => {
      expect(formatScorersGroupedByPlayer([])).toBe('-')
      expect(formatScorersGroupedByPlayer(null as any)).toBe('-')
    })
  })

  describe('Pontuação parcial por quantidade de gols N=3 com min(N, M)', () => {
    it('garante que 3 entradas individuais alimentam liveScorers e quem palpitou 2x recebe min(3,2)=2 pts', () => {
      const liveScorers = [
        { nome: "Raphinha 22'", posicao: 'Atacante' },
        { nome: "Raphinha 52'", posicao: 'Atacante' },
        { nome: "Raphinha 69'", posicao: 'Atacante' },
      ]

      // Palpite com Raphinha 2 vezes (M=2), placar errou (0x2 vs 0x3)
      const bet2x: any = {
        id: 'bet1',
        placar_a: 0,
        placar_b: 2,
        goleadores_b: [
          { nome: 'Raphinha', posicao: 'Atacante' },
          { nome: 'Raphinha', posicao: 'Atacante' },
        ],
      }

      const breakdown2x = calculateLiveMatchScoreBreakdown(
        bet2x,
        0, // real placar A
        3, // real placar B
        liveScorers,
      )

      // Vencedor correto (2 pts) + Metade do placar Mandante 0=0 (1 pt) + 2 gols do Raphinha (+2 pts) = 5 pts
      // Badge específica do marcador: "Raphinha 22', 52' [Atacante] (+2 pts)"
      expect(breakdown2x.pontos).toBeGreaterThanOrEqual(2)
      expect(
        breakdown2x.resumoItens.some(
          (item) => item.includes("Raphinha 22', 52'") && item.includes('+2 pts'),
        ),
      ).toBe(true)
    })

    it('garante que quem palpitou 3x recebe min(3,3)=3 pts', () => {
      const liveScorers = [
        { nome: "Raphinha 22'", posicao: 'Atacante' },
        { nome: "Raphinha 52'", posicao: 'Atacante' },
        { nome: "Raphinha 69'", posicao: 'Atacante' },
      ]

      // Palpite com Raphinha 3 vezes (M=3) e placar exato 0x3
      const bet3x: any = {
        id: 'bet2',
        placar_a: 0,
        placar_b: 3,
        goleadores_b: [
          { nome: 'Raphinha', posicao: 'Atacante' },
          { nome: 'Raphinha', posicao: 'Atacante' },
          { nome: 'Raphinha', posicao: 'Atacante' },
        ],
      }

      const breakdown3x = calculateLiveMatchScoreBreakdown(
        bet3x,
        0, // real placar A
        3, // real placar B
        liveScorers,
      )

      // Placar exato (8 pts) + 3 gols Raphinha (3 pts) = 11 pts
      expect(breakdown3x.pontos).toBe(11)
      expect(
        breakdown3x.resumoItens.some(
          (item) => item.includes("Raphinha 22', 52', 69'") && item.includes('+3 pts'),
        ),
      ).toBe(true)
    })
  })

  describe('formatScorersDisplayText', () => {
    it('retorna "Nenhum" para nulo, indefinido, vazio ou array vazio', () => {
      expect(formatScorersDisplayText(null)).toBe('Nenhum')
      expect(formatScorersDisplayText(undefined)).toBe('Nenhum')
      expect(formatScorersDisplayText('')).toBe('Nenhum')
      expect(formatScorersDisplayText([])).toBe('Nenhum')
      expect(formatScorersDisplayText('   ')).toBe('Nenhum')
    })

    it('formata array de objetos contendo nome ou name', () => {
      const goleadores = [
        { nome: 'Yuri Alberto', posicao: 'Atacante' },
        { name: 'Romero', posicao: 'Atacante' },
      ]
      expect(formatScorersDisplayText(goleadores)).toBe('Yuri Alberto, Romero')
    })

    it('formata array de strings simples', () => {
      expect(formatScorersDisplayText(['Yuri Alberto', 'Romero'])).toBe('Yuri Alberto, Romero')
    })

    it('formata string JSON com array de objetos ou strings', () => {
      const jsonStr = JSON.stringify([{ nome: 'Veiga' }, { nome: 'Flaco López' }])
      expect(formatScorersDisplayText(jsonStr)).toBe('Veiga, Flaco López')

      const jsonStrStrings = JSON.stringify(['Veiga', 'Flaco López'])
      expect(formatScorersDisplayText(jsonStrStrings)).toBe('Veiga, Flaco López')
    })

    it('formata string CSV separada por vírgula', () => {
      expect(formatScorersDisplayText('Veiga, Flaco López')).toBe('Veiga, Flaco López')
    })

    it('descarta itens vazios e retorna "Nenhum" se todos forem vazios', () => {
      expect(formatScorersDisplayText([{ nome: '' }, { nome: '   ' }])).toBe('Nenhum')
      expect(formatScorersDisplayText(['', '   '])).toBe('Nenhum')
    })
  })

  describe('extractScorerNames com item.name', () => {
    it('aceita item.name além de item.nome para objetos', () => {
      const items = [
        { nome: 'Yuri Alberto' },
        { name: 'Garro' },
        { name: 'Hugo', gol_contra: true },
        { name: 'Félix Torres', posicao: 'Gol Contra' },
      ]
      expect(extractScorerNames(items)).toEqual([
        'Yuri Alberto',
        'Garro',
        'Hugo (gol contra)',
        'Félix Torres (gol contra)',
      ])
    })
  })
})
