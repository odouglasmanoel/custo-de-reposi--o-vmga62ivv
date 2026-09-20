import { describe, it, expect } from 'vitest'
import {
  parseRawScorerList,
  inferPosicaoFromNameOrItem,
  formatScorerListPayload,
} from './AdminEditMarcadoresModal'

describe('AdminEditMarcadoresModal - Persistência de Posição', () => {
  it('payload de salvamento inclui posicao, quantidade e preserva goleador com posição D e G', () => {
    const inputState = [
      { nome: 'Hakimi', posicao: 'Defensor' as const, gol_contra: false },
      { nome: 'Courtois', posicao: 'Goleiro' as const, gol_contra: false },
      { nome: 'Mbappé', posicao: 'Atacante' as const, gol_contra: false },
    ]

    const payload = formatScorerListPayload(inputState)

    expect(payload).toEqual([
      {
        nome: 'Hakimi',
        quantidade: 1,
        posicao: 'Defensor',
        gol_contra: false,
      },
      {
        nome: 'Courtois',
        quantidade: 1,
        posicao: 'Goleiro',
        gol_contra: false,
      },
      {
        nome: 'Mbappé',
        quantidade: 1,
        posicao: 'Atacante',
        gol_contra: false,
      },
    ])
  })

  it('parseRawScorerList faz releitura devolvendo a posição salva (ex: D e G persistem)', () => {
    // 1. Array de objetos salvos com posicao explícita ('Defensor', 'Goleiro', etc.)
    const savedObjects = [
      { nome: 'Hakimi', posicao: 'Defensor', quantidade: 1 },
      { nome: 'Courtois', posicao: 'Goleiro', quantidade: 1 },
      { nome: 'Marquinhos', posicao: 'D', quantidade: 1 },
      { nome: 'Alisson', posicao: 'G', quantidade: 1 },
    ]

    const parsed = parseRawScorerList(savedObjects, 4)

    expect(parsed[0]).toEqual({
      nome: 'Hakimi',
      posicao: 'Defensor',
      gol_contra: false,
    })
    expect(parsed[1]).toEqual({
      nome: 'Courtois',
      posicao: 'Goleiro',
      gol_contra: false,
    })
    expect(parsed[2]).toEqual({
      nome: 'Marquinhos',
      posicao: 'Defensor',
      gol_contra: false,
    })
    expect(parsed[3]).toEqual({
      nome: 'Alisson',
      posicao: 'Goleiro',
      gol_contra: false,
    })
  })

  it('parseRawScorerList lê legados (strings simples ou JSON string de strings) e infere posição por nome ou fallback Atacante', () => {
    const legadosStrings = ['Gómez (Zagueiro)', 'Cássio (Goleiro)', 'Pedro']
    const parsed = parseRawScorerList(legadosStrings, 3)

    expect(parsed[0].posicao).toBe('Defensor')
    expect(parsed[1].posicao).toBe('Goleiro')
    expect(parsed[2].posicao).toBe('Atacante')
  })

  it('inferPosicaoFromNameOrItem reconhece D, G, A e strings textuais', () => {
    expect(inferPosicaoFromNameOrItem({ posicao: 'D' })).toBe('Defensor')
    expect(inferPosicaoFromNameOrItem({ posicao: 'G' })).toBe('Goleiro')
    expect(inferPosicaoFromNameOrItem({ posicao: 'A' })).toBe('Atacante')
    expect(inferPosicaoFromNameOrItem({ posicao: 'Defensor' })).toBe('Defensor')
    expect(inferPosicaoFromNameOrItem({ posicao: 'Goleiro' })).toBe('Goleiro')
    expect(inferPosicaoFromNameOrItem({ posicao: 'Atacante' })).toBe('Atacante')
    expect(inferPosicaoFromNameOrItem('Zagueiro')).toBe('Defensor')
    expect(inferPosicaoFromNameOrItem('Goleiro')).toBe('Goleiro')
    expect(inferPosicaoFromNameOrItem('Atacante')).toBe('Atacante')
  })

  it('formatação e leitura de gol contra preserva flag gol_contra', () => {
    const inputWithContra = [{ nome: 'Lyanco', posicao: 'Defensor' as const, gol_contra: true }]
    const payload = formatScorerListPayload(inputWithContra)
    expect(payload[0].nome).toBe('Lyanco (gol contra)')
    expect(payload[0].posicao).toBe('Gol Contra')
    expect(payload[0].gol_contra).toBe(true)

    const parsed = parseRawScorerList(payload, 1)
    expect(parsed[0].nome).toBe('Lyanco')
    expect(parsed[0].gol_contra).toBe(true)
  })
})
