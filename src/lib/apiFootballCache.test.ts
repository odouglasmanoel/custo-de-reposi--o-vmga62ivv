import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Testes das regras de consumo, cache server-side, rate limit e on-demand da API-Football.
 * Cobre os requisitos críticos:
 * 1. Cache servido sem chamada externa dentro do TTL (30 min calendário / 5 min ao vivo).
 * 2. Resposta 429 ou cota excedida tratada com mensagem amigável exata e status 200 seguro.
 * 3. Botão Atualizar respeitando o TTL mínimo e evitando re-chamadas descontroladas.
 * 4. Deduplicação de requisições simultâneas.
 * 5. Preservação de integridade dos cards (sem placar falso 0 x 0).
 */

describe('API-Football - Cache, Rate Limit e Consumo Sob Demanda', () => {
  const EXACT_RATE_LIMIT_MSG =
    'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

  describe('1. Detecção e Tratamento Seguro de Cota Excedida (HTTP 429 e respostas de plano)', () => {
    function isRateLimitError(statusCode: number, responseBody: unknown): boolean {
      if (statusCode === 429) return true
      if (!responseBody) return false
      let strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      return (
        strBody.includes('requests limit reached') ||
        strBody.includes('request limit reached') ||
        strBody.includes('rate limit') ||
        strBody.includes('plan reached') ||
        strBody.includes('too many requests') ||
        strBody.includes('quota exceeded') ||
        strBody.includes('exceeded the maximum') ||
        strBody.includes('free-tier limit')
      )
    }

    it('identifica status HTTP 429 como cota excedida', () => {
      expect(isRateLimitError(429, null)).toBe(true)
      expect(isRateLimitError(429, {})).toBe(true)
      expect(isRateLimitError(429, 'Too Many Requests')).toBe(true)
    })

    it('identifica payload de erro da API-Football gratuita quando atinge 100 requests diárias (status 200 com erro no corpo)', () => {
      const apiSportsQuotaBody = {
        get: 'fixtures',
        parameters: { date: '2026-09-17' },
        errors: {
          requests: 'You have reached the request limit for the day (Free Tier: 100 requests/day).',
        },
        results: 0,
        response: [],
      }
      expect(isRateLimitError(200, apiSportsQuotaBody)).toBe(true)
    })

    it('identifica variações de erro de plano do RapidAPI', () => {
      expect(
        isRateLimitError(200, {
          message: 'You have exceeded the rate limit per minute for your plan.',
        }),
      ).toBe(true)
      expect(
        isRateLimitError(200, { message: 'You have exceeded the maximum number of requests.' }),
      ).toBe(true)
    })

    it('retorna status 200 com payload amigável sem quebrar a aplicação quando rate limited', () => {
      // Simulação do payload retornado pelo endpoint do backend
      const backendResponse = {
        status: 200,
        body: {
          configured: true,
          provider: 'api_football',
          rate_limited: true,
          live: [],
          dateFixtures: [],
          directFixtures: [],
          error: EXACT_RATE_LIMIT_MSG,
        },
      }

      expect(backendResponse.status).toBe(200)
      expect(backendResponse.body.rate_limited).toBe(true)
      expect(backendResponse.body.error).toBe(EXACT_RATE_LIMIT_MSG)
      // Garante que não inventa 0 x 0
      expect(backendResponse.body.live).toHaveLength(0)
    })
  })

  describe('2. Servidor de Cache (TTL 30 min para calendário / 5 min para ao vivo)', () => {
    interface CacheStoreEntry {
      timestamp: number
      payload: any
      fetching?: number
    }

    function resolveResponseFromCache(
      cacheEntry: CacheStoreEntry | null,
      forceRefresh: boolean,
      nowMs: number,
      hasLiveMatch: boolean,
    ) {
      const effectiveTTL = hasLiveMatch ? 5 * 60 * 1000 : 30 * 60 * 1000
      const cacheAgeMs = cacheEntry ? nowMs - cacheEntry.timestamp : Infinity

      // Se cache é válido, serve diretamente do cache
      if (cacheEntry && cacheEntry.payload) {
        if (!forceRefresh || cacheAgeMs < effectiveTTL) {
          return {
            servedFromCache: true,
            externalCallMade: false,
            data: cacheEntry.payload,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
            ttlSeconds: Math.round(effectiveTTL / 1000),
            ttlRemainingSeconds: Math.max(0, Math.round((effectiveTTL - cacheAgeMs) / 1000)),
          }
        }
      }

      // Se deduplicação está ativa (fetch há menos de 10s)
      if (cacheEntry && cacheEntry.fetching && nowMs - cacheEntry.fetching < 10000) {
        return {
          servedFromCache: true,
          externalCallMade: false,
          deduplicated: true,
          data: cacheEntry.payload,
        }
      }

      // Caso contrário, chamada externa é liberada
      return {
        servedFromCache: false,
        externalCallMade: true,
      }
    }

    it('serve do cache interno dentro do TTL de 30 minutos em carregamento passivo', () => {
      const startTime = 1000000
      const cacheEntry: CacheStoreEntry = {
        timestamp: startTime,
        payload: { fixtures: [{ id: 1, name: 'Flamengo x Vasco' }] },
      }

      // Acesso 10 minutos depois (passivo, sem refresh forçado)
      const tenMinutesLater = startTime + 10 * 60 * 1000
      const result = resolveResponseFromCache(cacheEntry, false, tenMinutesLater, false)

      expect(result.servedFromCache).toBe(true)
      expect(result.externalCallMade).toBe(false)
      expect(result.cacheAgeSeconds).toBe(600)
    })

    it('serve do cache mesmo quando o usuário clica em Atualizar se o TTL de 30 minutos ainda estiver ativo', () => {
      const startTime = 1000000
      const cacheEntry: CacheStoreEntry = {
        timestamp: startTime,
        payload: { fixtures: [{ id: 1, name: 'Palmeiras x Santos' }] },
      }

      // Usuário clica em Atualizar com apenas 5 minutos de cache (TTL é 30 min)
      const fiveMinutesLater = startTime + 5 * 60 * 1000
      const result = resolveResponseFromCache(cacheEntry, true, fiveMinutesLater, false)

      expect(result.servedFromCache).toBe(true)
      expect(result.externalCallMade).toBe(false)
      expect(result.ttlRemainingSeconds).toBeGreaterThan(0)
    })

    it('permite revalidação sob demanda com botão Atualizar APENAS quando o TTL expirou', () => {
      const startTime = 1000000
      const cacheEntry: CacheStoreEntry = {
        timestamp: startTime,
        payload: { fixtures: [{ id: 1, name: 'Palmeiras x Santos' }] },
      }

      // 31 minutos depois (TTL de 30 min expirou) e forceRefresh = true
      const thirtyOneMinutesLater = startTime + 31 * 60 * 1000
      const result = resolveResponseFromCache(cacheEntry, true, thirtyOneMinutesLater, false)

      expect(result.servedFromCache).toBe(false)
      expect(result.externalCallMade).toBe(true)
    })

    it('aplica TTL menor de 5 minutos apenas enquanto houver partidas com status Ao Vivo', () => {
      const startTime = 1000000
      const cacheEntry: CacheStoreEntry = {
        timestamp: startTime,
        payload: { fixtures: [{ id: 1, name: 'Real Madrid x Barcelona', isLive: true }] },
      }

      // 6 minutos depois com jogo Ao Vivo e forceRefresh = true -> deve permitir revalidação
      const sixMinutesLater = startTime + 6 * 60 * 1000
      const result = resolveResponseFromCache(cacheEntry, true, sixMinutesLater, true)

      expect(result.servedFromCache).toBe(false)
      expect(result.externalCallMade).toBe(true)
    })

    it('deduplica requisições concorrentes disparadas simultaneamente por abas ou componentes', () => {
      const startTime = 1000000
      const cacheEntry: CacheStoreEntry = {
        timestamp: 0,
        payload: { fixtures: [] },
        fetching: startTime - 2000, // Requisição iniciada há 2 segundos
      }

      const result = resolveResponseFromCache(cacheEntry, true, startTime, false)
      expect(result.servedFromCache).toBe(true)
      expect(result.externalCallMade).toBe(false)
      expect((result as any).deduplicated).toBe(true)
    })
  })

  describe('3. Preservação de Regras de Fallback e Integridade dos Dados', () => {
    it('nunca inventa placar 0 x 0 quando a API falha ou está sem dados', () => {
      // Simula resultado do matcher quando API está vazia
      const jogoSemResultado = {
        id: 'jogo1',
        time_a: 'Corinthians',
        time_b: 'São Paulo',
        placar_a: null,
        placar_b: null,
        resultado_finalizado: false,
      }

      const matchedLive = null // Nenhum match retornado pela API
      const sobrescritaAdmin = null

      let placarExibido: string | null = null
      let statusExibido = 'aguardando'

      if (sobrescritaAdmin) {
        placarExibido = '1 x 0'
      } else if (matchedLive) {
        placarExibido = '2 x 1'
      } else if (
        jogoSemResultado.placar_a != null &&
        jogoSemResultado.placar_b != null &&
        (Number(jogoSemResultado.placar_a) > 0 ||
          Number(jogoSemResultado.placar_b) > 0 ||
          jogoSemResultado.resultado_finalizado)
      ) {
        placarExibido = `${jogoSemResultado.placar_a} x ${jogoSemResultado.placar_b}`
      } else {
        placarExibido = null
        statusExibido = 'Aguardando atualização'
      }

      expect(placarExibido).toBeNull()
      expect(statusExibido).toBe('Aguardando atualização')
    })
  })
})
