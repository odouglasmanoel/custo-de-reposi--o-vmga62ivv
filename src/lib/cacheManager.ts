/**
 * Utilitários compartilhados de gerenciamento e higiene de cache (localStorage e memória).
 * Limpa caches obsoletos de versões anteriores sem tocar em auth ou configurações do usuário.
 */

// Prefixos atuais ativos de cache no Repress
export const CURRENT_CACHE_PREFIXES = {
  dashboard: 'cr_dashboard_cache_v3',
  palpites: 'cr_palpites_cache_v1',
  jogosDia: 'cr_jogos_dia_cache_v4',
  escudo: 'cr_escudo_cache_v3',
  enquetesLista: 'cr_enquetes_lista_v3',
  enqueteDetalhe: 'cr_enquete_detalhe_v2',
  estatisticas: 'cr_estatisticas_cache_v2',
  historico: 'cr_historico_cache_v1',
} as const

// Famílias de cache do app para detecção de versões legadas / obsoletas
const CACHE_FAMILIES: Array<{
  base: string
  activePrefix: string
}> = [
  { base: 'cr_dashboard_cache_', activePrefix: CURRENT_CACHE_PREFIXES.dashboard },
  { base: 'cr_palpites_cache_', activePrefix: CURRENT_CACHE_PREFIXES.palpites },
  { base: 'cr_jogos_dia_cache_', activePrefix: CURRENT_CACHE_PREFIXES.jogosDia },
  { base: 'cr_escudo_cache_', activePrefix: CURRENT_CACHE_PREFIXES.escudo },
  { base: 'cr_enquetes_lista_', activePrefix: CURRENT_CACHE_PREFIXES.enquetesLista },
  { base: 'cr_enquete_detalhe_', activePrefix: CURRENT_CACHE_PREFIXES.enqueteDetalhe },
  { base: 'cr_estatisticas_cache_', activePrefix: CURRENT_CACHE_PREFIXES.estatisticas },
  { base: 'cr_historico_cache_', activePrefix: CURRENT_CACHE_PREFIXES.historico },
]

/**
 * Remove do localStorage caches de versões legadas de cada família de cache do app
 * (ex: v1 e v2 do dashboard se o atual for v3; v1, v2, v3 de jogos do dia se o atual for v4).
 * NUNCA remove chaves de autenticação (PocketBase auth store) ou preferências do usuário.
 */
export function purgeObsoleteCaches(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  try {
    const keysToRemove: string[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // Protege explicitamente chaves de autenticação do PocketBase e preferências
      if (
        key === 'pocketbase_auth' ||
        key.startsWith('pb_') ||
        key === 'bolao_sidebar_collapsed' ||
        key.startsWith('user_pref_')
      ) {
        continue
      }

      // 1. Limpa resíduos temporários corrompidos de sessões anteriores
      if (
        key.startsWith('bolao_temp_') ||
        key.startsWith('bolao_err_') ||
        key.includes('corrupted')
      ) {
        keysToRemove.push(key)
        continue
      }

      // 2. Verifica se a chave pertence a uma família conhecida mas com versão legada
      for (const fam of CACHE_FAMILIES) {
        if (key.startsWith(fam.base) && !key.startsWith(fam.activePrefix)) {
          keysToRemove.push(key)
          break
        }
      }
    }

    for (const key of keysToRemove) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    }

    // Purga definitiva de caches e resíduos associados ao PSG com escudo incorreto
    try {
      const psgOfficial = 'https://media.api-sports.io/football/teams/85.png'
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (k.toLowerCase().includes('paris') || k.toLowerCase().includes('psg')) {
          const val = localStorage.getItem(k) || ''
          if (
            val.includes('192.') ||
            val.includes('koln') ||
            val.includes('cologne') ||
            (k.startsWith('escudo_cache_') && val !== psgOfficial)
          ) {
            localStorage.setItem(k, psgOfficial)
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Limpa também sessionStorage de resíduos temporários
    if (window.sessionStorage) {
      const sessionKeysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const sk = sessionStorage.key(i)
        if (
          sk &&
          (sk.startsWith('bolao_temp_') || sk.startsWith('bolao_err_') || sk.includes('corrupted'))
        ) {
          sessionKeysToRemove.push(sk)
        }
      }
      for (const sk of sessionKeysToRemove) {
        try {
          sessionStorage.removeItem(sk)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore fallback em caso de storage bloqueado */
  }
}

/**
 * Insere ou atualiza um item em um Map garantindo tamanho máximo e evicção dos itens mais antigos.
 * Em JavaScript, a iteração de Map segue a ordem de inserção. Ao atingir `maxEntries`,
 * remove a chave mais antiga (a primeira retornada por map.keys()).
 */
export function setWithBoundedCapacity<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries = 200,
): void {
  // Se a chave já existia, deleta para que ao reinserir ela vá para o fim (mais recente)
  if (map.has(key)) {
    map.delete(key)
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) {
      map.delete(oldestKey)
    }
  }
  map.set(key, value)
}
