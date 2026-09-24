import type { RecordModel } from 'pocketbase'

export interface Bolao extends RecordModel {
  nome: string
  ativo: boolean
  foco?: string
  ultima_atualizacao?: string
}

export const GERAL_BOLAO_ID = 'geral'

export function formatBolaoLabel(bolao: { nome: string; foco?: string; ativo?: boolean }): string {
  let label = bolao.nome
  if (bolao.foco && bolao.foco.trim()) {
    label += ` (${bolao.foco.trim()})`
  }
  if (bolao.ativo === false) {
    label += ' (Encerrado)'
  }
  return label
}

export interface ScorerItem {
  nome: string
  posicao?:
    | 'Atacante'
    | 'Meio-campista'
    | 'Defensor'
    | 'Goleiro'
    | 'Gol Contra'
    | 'Atacante/Meia'
    | 'Zagueiro/Lateral'
    | string
  quantidade?: number
  gol_contra?: boolean
}

export interface Jogo extends RecordModel {
  bolao: string
  time_a: string
  time_b: string
  competicao?: string
  fixture_id?: string
  data: string
  hora: string
  placar_a?: number | null
  placar_b?: number | null
  resultado_finalizado: boolean
  status?: string
  gols_time_a?: ScorerItem[]
  gols_time_b?: ScorerItem[]
  tem_penaltis: boolean
  vencedor_penaltis?: 'A' | 'B' | string
  escalacoes?: unknown
  ficha_detalhes?: unknown
  url_escudo_mandante?: string
  url_escudo_visitante?: string
}

export interface Participante extends RecordModel {
  bolao: string
  nome: string
  pontos_importados?: number
  pontuacao_total: number
}

export interface Palpite extends RecordModel {
  bolao: string
  jogo: string
  participante: string
  placar_a: number
  placar_b: number
  goleadores_a?: Array<string | ScorerItem>
  goleadores_b?: Array<string | ScorerItem>
  vencedor_penaltis?: 'A' | 'B' | 'N' | string
  pontuacao_jogo: number
  detalhamento?: string[]
}

export interface Normalizacao extends RecordModel {
  bolao: string
  nome_original: string
  nome_correto: string
}

export interface Regras extends RecordModel {
  titulo: string
  conteudo: string
}
