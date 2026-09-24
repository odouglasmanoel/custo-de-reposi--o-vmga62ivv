import { describe, it, expect, vi } from 'vitest'
import {
  parseRawScorerList,
  inferPosicaoFromNameOrItem,
  formatScorerListPayload,
  type ScorerInputState,
} from './AdminEditMarcadoresModal'
import type { Palpite } from '@/types/bolao'

describe('AdminEditMarcadoresModal - Persistência de Posição', () => {
  it('salvar Romero com posicao Defensor produz payload estruturado com { nome, posicao, quantidade, gol_contra }', () => {
    const inputState = [
      { nome: 'Cristian Romero', posicao: 'Defensor' as const, gol_contra: false },
    ]

    const payload = formatScorerListPayload(inputState)

    expect(payload).toEqual([
      {
        nome: 'Cristian Romero',
        quantidade: 1,
        posicao: 'Defensor',
        gol_contra: false,
      },
    ])
  })

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

  it('releitura do objeto estruturado abre diretamente na posição salva (Romero com posicao Defensor abre Defensor)', () => {
    const savedRomero = [
      {
        nome: 'Cristian Romero',
        posicao: 'Defensor',
        quantidade: 1,
        gol_contra: false,
      },
    ]

    const parsed = parseRawScorerList(savedRomero, 1)

    expect(parsed[0]).toEqual({
      nome: 'Cristian Romero',
      posicao: 'Defensor',
      gol_contra: false,
    })
  })

  it('parseRawScorerList faz releitura devolvendo a posição salva (ex: D e G persistem)', () => {
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
    const legadosStrings = ['Gómez (Zagueiro)', 'Cássio (Goleiro)', 'Pedro', 'Cristian Romero']
    const parsed = parseRawScorerList(legadosStrings, 4)

    expect(parsed[0].posicao).toBe('Defensor')
    expect(parsed[1].posicao).toBe('Goleiro')
    expect(parsed[2].posicao).toBe('Atacante')
    expect(parsed[3].posicao).toBe('Atacante') // Romero sem anotação em string legada cai no fallback Atacante
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

  it('simulação do estado pai: callback onSuccess com updatedRecord substitui palpite em cache/estado stale', () => {
    const staleBet: Palpite = {
      id: 'tx82pp3f7f7wb57',
      bolao: 'kr20rfjisajd6ro',
      jogo: 'pl5z08b8tupuewg',
      participante: '09yarueqvzdkca0',
      placar_a: 1,
      placar_b: 2,
      goleadores_a: ['Cristian Romero'],
      goleadores_b: ['Mbappé', 'Vini Jr.'],
      pontuacao_jogo: 0,
      vencedor_penaltis: 'N',
      collectionId: 'pbc_3863591230',
      collectionName: 'palpites',
      created: '2026-09-19',
      updated: '2026-09-20',
    }

    const updatedBet: Palpite = {
      ...staleBet,
      goleadores_a: [
        {
          nome: 'Cristian Romero',
          quantidade: 1,
          posicao: 'Defensor',
          gol_contra: false,
        },
      ] as any,
    }

    let parentAdminEditingState: {
      palpite: Palpite
      participanteNome: string
      timeA: string
      timeB: string
    } | null = {
      palpite: staleBet,
      participanteNome: 'Douglas',
      timeA: 'Tottenham',
      timeB: 'Real Madrid',
    }

    let parentPalpitesList: Palpite[] = [staleBet]

    const onSuccessSpy = vi.fn((record: Palpite) => {
      parentAdminEditingState = parentAdminEditingState
        ? { ...parentAdminEditingState, palpite: record }
        : null
      parentPalpitesList = parentPalpitesList.map((p) => (p.id === record.id ? record : p))
    })

    // Aciona onSuccess com updatedBet retornado pelo PocketBase
    onSuccessSpy(updatedBet)

    expect(onSuccessSpy).toHaveBeenCalledWith(updatedBet)
    expect(parentAdminEditingState?.palpite.goleadores_a).toEqual([
      {
        nome: 'Cristian Romero',
        quantidade: 1,
        posicao: 'Defensor',
        gol_contra: false,
      },
    ])
    expect(parentPalpitesList[0].goleadores_a).toEqual([
      {
        nome: 'Cristian Romero',
        quantidade: 1,
        posicao: 'Defensor',
        gol_contra: false,
      },
    ])

    // Ao reabrir o modal com o palpite atualizado do estado do pai, parseRawScorerList lê a nova posição
    const parsedUponReopen = parseRawScorerList(parentAdminEditingState?.palpite.goleadores_a, 1)
    expect(parsedUponReopen[0].posicao).toBe('Defensor')
    expect(parsedUponReopen[0].nome).toBe('Cristian Romero')
  })

  it('sanitiza e normaliza payload enviado ao endpoint /backend/v1/admin/salvar-marcadores', () => {
    const rawInputList: ScorerInputState[] = [
      {
        nome: '  Cristian Romero  ',
        posicao: 'Defensor',
        gol_contra: false,
      },
      {
        nome: 'Alisson Becker (gol contra)',
        posicao: 'Goleiro',
        gol_contra: true,
      },
    ]

    const payload = formatScorerListPayload(rawInputList)
    expect(payload).toHaveLength(2)
    expect(payload[0]).toEqual({
      nome: 'Cristian Romero',
      posicao: 'Defensor',
      quantidade: 1,
      gol_contra: false,
    })
    expect(payload[1]).toEqual({
      nome: 'Alisson Becker (gol contra)',
      posicao: 'Gol Contra',
      quantidade: 1,
      gol_contra: true,
    })
  })

  it('cenário: palpite com Romero (Defensor) e Richarlison (Atacante) - alterar Richarlison para Son preserva Romero como Defensor', () => {
    // 1. Palpite inicial vindo do banco
    const initialScorers = [
      { nome: 'Cristian Romero', posicao: 'Defensor', quantidade: 1, gol_contra: false },
      { nome: 'Richarlison', posicao: 'Atacante', quantidade: 1, gol_contra: false },
    ]

    // 2. parseRawScorerList deve inicializar Romero como 'Defensor' e Richarlison como 'Atacante'
    const parsed = parseRawScorerList(initialScorers, 2)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      nome: 'Cristian Romero',
      posicao: 'Defensor',
      gol_contra: false,
    })
    expect(parsed[1]).toEqual({
      nome: 'Richarlison',
      posicao: 'Atacante',
      gol_contra: false,
    })

    // 3. Usuário edita apenas Richarlison -> 'Son Heung-min' (sem mexer em Romero)
    const updatedState = [parsed[0], { ...parsed[1], nome: 'Son Heung-min' }]

    // 4. formatScorerListPayload deve gerar Romero com posicao 'Defensor' preservada
    const payload = formatScorerListPayload(updatedState)
    expect(payload).toEqual([
      {
        nome: 'Cristian Romero',
        posicao: 'Defensor',
        quantidade: 1,
        gol_contra: false,
      },
      {
        nome: 'Son Heung-min',
        posicao: 'Atacante',
        quantidade: 1,
        gol_contra: false,
      },
    ])
  })
})
