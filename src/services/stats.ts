import pb from '@/lib/pocketbase/client'
import type { Bolao, Jogo, Palpite, Participante } from '@/types/bolao'
import { GERAL_BOLAO_ID } from '@/types/bolao'
import { calculateStatistics, type StatsCalculationResult } from '@/lib/statsCalculator'
import { setWithBoundedCapacity } from '@/lib/cacheManager'

export interface StatsCachePayload {
  boloes: Bolao[]
  stats: StatsCalculationResult
  timestamp: number
}

const CACHE_STATS_PREFIX = 'cr_estatisticas_cache_v2'
const statsMemoryCache = new Map<string, StatsCachePayload>()

/**
 * Lê estatísticas calculadas do cache de 2 níveis (memória primeiro, depois localStorage)
 */
export function readStatsCache(competitionId: string): StatsCachePayload | null {
  const normKey = normalizeCompKey(competitionId)
  const fromMem = statsMemoryCache.get(normKey)
  if (fromMem && fromMem.stats && Array.isArray(fromMem.stats.tabela)) {
    return fromMem
  }

  try {
    const raw = localStorage.getItem(`${CACHE_STATS_PREFIX}_${normKey}`)
    if (raw) {
      const parsed = JSON.parse(raw) as StatsCachePayload
      if (parsed && parsed.stats && Array.isArray(parsed.stats.tabela)) {
        setWithBoundedCapacity(statsMemoryCache, normKey, parsed, 50)
        return parsed
      }
    }
  } catch {
    // localStorage indisponível ou corrompido
  }

  return null
}

/**
 * Grava estatísticas calculadas nos 2 níveis de cache (memória + localStorage)
 */
export function writeStatsCache(
  competitionId: string,
  boloes: Bolao[],
  stats: StatsCalculationResult,
): void {
  const normKey = normalizeCompKey(competitionId)
  const payload: StatsCachePayload = {
    boloes,
    stats,
    timestamp: Date.now(),
  }

  setWithBoundedCapacity(statsMemoryCache, normKey, payload, 50)
  try {
    localStorage.setItem(`${CACHE_STATS_PREFIX}_${normKey}`, JSON.stringify(payload))
  } catch {
    // LocalStorage indisponível ou quota excedida
  }
}

/**
 * Invalida o cache de estatísticas (específico ou total)
 */
export function invalidateStatsCache(competitionId?: string): void {
  if (competitionId) {
    const normKey = normalizeCompKey(competitionId)
    statsMemoryCache.delete(normKey)
    try {
      localStorage.removeItem(`${CACHE_STATS_PREFIX}_${normKey}`)
    } catch {
      /* ignore */
    }
  } else {
    statsMemoryCache.clear()
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CACHE_STATS_PREFIX)) {
          localStorage.removeItem(key)
        }
      }
    } catch {
      /* ignore */
    }
  }
}

function normalizeCompKey(comp: string): string {
  if (!comp || comp === GERAL_BOLAO_ID || comp === 'todas') {
    return GERAL_BOLAO_ID
  }
  return comp
}

export interface FetchStatsOptions {
  boloesList?: Bolao[]
}

/**
 * Busca dados no PocketBase com projeção de campos mínimos e em lote paralelo,
 * agregando tudo em memória sem N+1.
 */
export async function fetchStatisticsData(
  competitionId: string,
  options?: FetchStatsOptions,
): Promise<{
  boloes: Bolao[]
  participantes: Participante[]
  jogos: Jogo[]
  palpites: Palpite[]
  stats: StatsCalculationResult
}> {
  const isGeralSelection =
    !competitionId || competitionId === GERAL_BOLAO_ID || competitionId === 'todas'

  // Projeção dos campos mínimos estritamente necessários para o cálculo:
  const bolaoFields = 'id,nome,ativo,ultima_atualizacao,foco'
  const partFields = 'id,bolao,nome,pontuacao_total,pontos_importados'
  const jogoFields =
    'id,bolao,time_a,time_b,data,hora,placar_a,placar_b,resultado_finalizado,gols_time_a,gols_time_b,tem_penaltis,vencedor_penaltis,competicao'
  const palpiteFields =
    'id,bolao,jogo,participante,placar_a,placar_b,goleadores_a,goleadores_b,vencedor_penaltis,pontuacao_jogo,detalhamento'

  // Reutiliza boloesList se fornecido para evitar uma requisição desnecessária
  const boloesPromise =
    options?.boloesList && options.boloesList.length > 0
      ? Promise.resolve(options.boloesList)
      : pb.collection('boloes').getFullList<Bolao>({
          sort: '-ativo,nome',
          fields: bolaoFields,
        })

  if (isGeralSelection) {
    // 3 chamadas em lote paralelo com projeção de campos mínimos
    const [boloesList, partList, jogosList, palpitesList] = await Promise.all([
      boloesPromise,
      pb.collection('participantes').getFullList<Participante>({
        sort: 'nome',
        fields: partFields,
      }),
      pb.collection('jogos').getFullList<Jogo>({
        sort: 'data,hora',
        fields: jogoFields,
      }),
      pb.collection('palpites').getFullList<Palpite>({
        fields: palpiteFields,
      }),
    ])

    const stats = calculateStatistics({
      boloes: boloesList,
      participantes: partList,
      jogos: jogosList,
      palpites: palpitesList,
      filtroBolaoId: GERAL_BOLAO_ID,
    })

    writeStatsCache(GERAL_BOLAO_ID, boloesList, stats)

    return {
      boloes: boloesList,
      participantes: partList,
      jogos: jogosList,
      palpites: palpitesList,
      stats,
    }
  } else {
    // Copa específica: 3 chamadas filtradas pelo id do bolão com campos mínimos
    const [boloesList, partList, jogosList, palpitesList] = await Promise.all([
      boloesPromise,
      pb.collection('participantes').getFullList<Participante>({
        filter: `bolao = '${competitionId}'`,
        sort: 'nome',
        fields: partFields,
      }),
      pb.collection('jogos').getFullList<Jogo>({
        filter: `bolao = '${competitionId}'`,
        sort: 'data,hora',
        fields: jogoFields,
      }),
      pb.collection('palpites').getFullList<Palpite>({
        filter: `bolao = '${competitionId}'`,
        fields: palpiteFields,
      }),
    ])

    const stats = calculateStatistics({
      boloes: boloesList,
      participantes: partList,
      jogos: jogosList,
      palpites: palpitesList,
      filtroBolaoId: competitionId,
    })

    writeStatsCache(competitionId, boloesList, stats)

    return {
      boloes: boloesList,
      participantes: partList,
      jogos: jogosList,
      palpites: palpitesList,
      stats,
    }
  }
}
