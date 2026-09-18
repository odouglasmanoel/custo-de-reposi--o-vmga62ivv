import { describe, it, expect, beforeEach } from 'vitest'
import { CURRENT_CACHE_PREFIXES, purgeObsoleteCaches, setWithBoundedCapacity } from './cacheManager'

describe('cacheManager - Limpeza de Caches e Evicção de Memória', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('preserva chaves de autenticação do PocketBase e preferências de usuário', () => {
    localStorage.setItem('pocketbase_auth', '{"token":"xyz"}')
    localStorage.setItem('pb_auth_custom', 'data')
    localStorage.setItem('bolao_sidebar_collapsed', 'true')
    localStorage.setItem('user_pref_theme', 'dark')

    purgeObsoleteCaches()

    expect(localStorage.getItem('pocketbase_auth')).toBe('{"token":"xyz"}')
    expect(localStorage.getItem('pb_auth_custom')).toBe('data')
    expect(localStorage.getItem('bolao_sidebar_collapsed')).toBe('true')
    expect(localStorage.getItem('user_pref_theme')).toBe('dark')
  })

  it('preserva os prefixos de cache atuais e remove versões legadas/antigas', () => {
    // Chaves atuais válidas
    localStorage.setItem(`${CURRENT_CACHE_PREFIXES.dashboard}_geral`, '{"valid":true}')
    localStorage.setItem(`${CURRENT_CACHE_PREFIXES.jogosDia}_2026-09-17`, '{"valid":true}')
    localStorage.setItem(`${CURRENT_CACHE_PREFIXES.palpites}_user1_geral_p1`, '{"valid":true}')
    localStorage.setItem(`${CURRENT_CACHE_PREFIXES.escudo}_flamengo`, 'https://img/flamengo.png')

    // Chaves legadas antigas
    localStorage.setItem('cr_dashboard_cache_v1_geral', '{"obsolete":1}')
    localStorage.setItem('cr_dashboard_cache_v2_geral', '{"obsolete":2}')
    localStorage.setItem('cr_jogos_dia_cache_v1_2025-01-01', '{"obsolete":1}')
    localStorage.setItem('cr_jogos_dia_cache_v2_2025-01-01', '{"obsolete":2}')
    localStorage.setItem('cr_jogos_dia_cache_v3_2025-01-01', '{"obsolete":3}')
    localStorage.setItem('cr_palpites_cache_v0_legacy', '{"obsolete":0}')

    // Resíduos temporários corrompidos
    localStorage.setItem('bolao_temp_sync_123', 'temp')
    localStorage.setItem('bolao_err_log', 'err')

    purgeObsoleteCaches()

    // Atuais devem ser mantidos
    expect(localStorage.getItem(`${CURRENT_CACHE_PREFIXES.dashboard}_geral`)).toBe('{"valid":true}')
    expect(localStorage.getItem(`${CURRENT_CACHE_PREFIXES.jogosDia}_2026-09-17`)).toBe(
      '{"valid":true}',
    )
    expect(localStorage.getItem(`${CURRENT_CACHE_PREFIXES.palpites}_user1_geral_p1`)).toBe(
      '{"valid":true}',
    )
    expect(localStorage.getItem(`${CURRENT_CACHE_PREFIXES.escudo}_flamengo`)).toBe(
      'https://img/flamengo.png',
    )

    // Legados e temporários devem ter sido expurgados
    expect(localStorage.getItem('cr_dashboard_cache_v1_geral')).toBeNull()
    expect(localStorage.getItem('cr_dashboard_cache_v2_geral')).toBeNull()
    expect(localStorage.getItem('cr_jogos_dia_cache_v1_2025-01-01')).toBeNull()
    expect(localStorage.getItem('cr_jogos_dia_cache_v2_2025-01-01')).toBeNull()
    expect(localStorage.getItem('cr_jogos_dia_cache_v3_2025-01-01')).toBeNull()
    expect(localStorage.getItem('cr_palpites_cache_v0_legacy')).toBeNull()
    expect(localStorage.getItem('bolao_temp_sync_123')).toBeNull()
    expect(localStorage.getItem('bolao_err_log')).toBeNull()
  })

  it('setWithBoundedCapacity respeita o limite máximo e remove os mais antigos em FIFO/LRU', () => {
    const map = new Map<string, number>()
    const MAX = 3

    setWithBoundedCapacity(map, 'a', 1, MAX)
    setWithBoundedCapacity(map, 'b', 2, MAX)
    setWithBoundedCapacity(map, 'c', 3, MAX)

    expect(map.size).toBe(3)
    expect(Array.from(map.keys())).toEqual(['a', 'b', 'c'])

    // Inserção do 4º elemento deve evictar 'a' (o mais antigo)
    setWithBoundedCapacity(map, 'd', 4, MAX)
    expect(map.size).toBe(3)
    expect(map.has('a')).toBe(false)
    expect(Array.from(map.keys())).toEqual(['b', 'c', 'd'])

    // Ao atualizar um item existente ('b'), ele deve ir para o final como mais recente
    setWithBoundedCapacity(map, 'b', 20, MAX)
    expect(map.size).toBe(3)
    expect(Array.from(map.keys())).toEqual(['c', 'd', 'b'])

    // Ao inserir um novo ('e'), 'c' (que agora é o mais antigo) deve sair
    setWithBoundedCapacity(map, 'e', 5, MAX)
    expect(map.size).toBe(3)
    expect(map.has('c')).toBe(false)
    expect(Array.from(map.keys())).toEqual(['d', 'b', 'e'])
  })
})
