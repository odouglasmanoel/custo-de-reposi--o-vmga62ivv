import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  getFlagCdnUrl,
  resolveTeamBadgeUrl,
  fixtureLogosMemoryCache,
  extractLogosFromFichaDetalhes,
  fetchAndCacheFixtureLogos,
  isNationalTeam,
  getClubLogoUrl,
} from '@/lib/flags'
import { readEscudoCache } from '@/services/enquetes'

export interface TeamShieldProps {
  teamName: string
  /**
   * URL de escudo cadastrada manualmente (url_escudo_mandante / url_escudo_visitante / savedBadge)
   */
  escudo?: string | null
  fixtureId?: string | number | null
  fichaDetalhes?: any
  isSide?: 'home' | 'away'
  /**
   * Sigla de fallback opcional (se ausente, timeName.slice(0, 2).toUpperCase())
   */
  sigla?: string
  /**
   * Classes de dimensão do contêiner. Mantém dimensões fixas no desktop e mobile sem colapso.
   */
  sizeClass?: string
  textClass?: string
  className?: string
  /**
   * Se true, força o componente a buscar a fixture na API se não houver escudo resolvido
   */
  lazyFetch?: boolean
  /**
   * Quando true, permite que o escudo permaneça vazio sem tentar buscar URLs alternativas
   */
  allowEmpty?: boolean
}

/**
 * Componente ÚNICO compartilhado de exibição de escudo/bandeira para Mobile e Desktop.
 *
 * HIERARQUIA ESTRITA DE RESOLUÇÃO:
 * - Prioridade 1: Logo salvo em ficha_detalhes do jogo (extração síncrona custo zero)
 *                 -> se ausente, fixtureLogosMemoryCache ou busca sob demanda (/backend/v1/enquetes/fixture-detalhes)
 * - Prioridade 2: Busca por NOME EXATO na tabela canônica (OFFICIAL_CLUB_TEAM_IDS / OFFICIAL_NATIONAL_TEAM_IDS
 *                 em flags.ts: Botafogo->120, Vasco->133, Fluminense->124, Palmeiras->121, Coritiba->132, Chapecoense->147)
 *                 -> URL https://media.api-sports.io/football/teams/{id}.png; para seleções, FlagCDN (https://flagcdn.com/w80/{iso}.png)
 * - Prioridade 3: URL manual do cadastro (url_escudo_mandante / url_escudo_visitante / savedBadge) ou cache local
 * - Sigla de 2 letras SOMENTE se a URL estiver completamente vazia E todas as prioridades falharem.
 *   NUNCA por erro de carregamento transitório: em onError tenta as prioridades restantes antes de exibir a sigla.
 * - Paridade mobile: contêiner com dimensão fixa garantida (shrink-0 min-w-[28px] min-h-[28px]), sem display:none.
 */
export function TeamShield({
  teamName,
  escudo,
  fixtureId,
  fichaDetalhes,
  isSide,
  sigla,
  sizeClass = 'h-9 w-9 sm:h-10 sm:w-10 min-w-[28px] min-h-[28px]',
  textClass = 'text-xs font-bold text-slate-700',
  className = '',
  lazyFetch = true,
  allowEmpty = false,
}: TeamShieldProps) {
  // Lista de candidatos em cascata para fallback seguro no onError
  const [candidates, setCandidates] = useState<string[]>([])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [resolvingAsync, setResolvingAsync] = useState(false)
  const cleanTeam = (teamName || '').trim()

  // Função síncrona que constrói a lista ordenada de URLs candidatas segundo a hierarquia estrita
  const computeCandidateUrls = useCallback((): string[] => {
    // Se o admin explicitamente limpou o escudo (escudo === '' ou allowEmpty === true com escudo vazio)
    // e não há fixture_id nem fichaDetalhes, respeita a decisão do admin de exibir o monograma (sem re-injetar URL)
    const adminLimpouCampo =
      (escudo === '' || (allowEmpty && !escudo)) && !fixtureId && !fichaDetalhes
    if (adminLimpouCampo) {
      return []
    }

    if (!cleanTeam && !escudo) return []
    const list: string[] = []
    const seen = new Set<string>()

    const addCandidate = (url?: string | null) => {
      if (!url) return
      const trimmed = url.trim()
      if (!trimmed) return
      if (!seen.has(trimmed)) {
        seen.add(trimmed)
        list.push(trimmed)
      }
    }

    // 1º HIERARQUIA: URL gravada no registro do jogo / escudo prop (se preenchida e não for placeholder conhecido)
    // REGRA DO USUÁRIO (OVERRIDE MANUAL DO USUÁRIO):
    // Se o escudo estiver preenchido pelo usuário, ele tem PRIORIDADE MÁXIMA sobre qualquer blindagem ou busca automática.
    if (escudo && escudo.trim()) {
      addCandidate(escudo.trim())
    }

    // PRIORIDADE 1: ficha_detalhes do jogo (extração síncrona gratuita)
    if (fichaDetalhes) {
      const extracted = extractLogosFromFichaDetalhes(fichaDetalhes)
      if (extracted) {
        const sideLogo =
          isSide === 'home'
            ? extracted.home
            : isSide === 'away'
              ? extracted.away
              : extracted.home || extracted.away
        addCandidate(sideLogo)
      }
    }

    // PRIORIDADE 1 (cont): fixtureLogosMemoryCache se fixtureId fornecido
    if (fixtureId) {
      const cleanId = String(fixtureId).replace(/\D/g, '').trim()
      if (cleanId && fixtureLogosMemoryCache.has(cleanId)) {
        const c = fixtureLogosMemoryCache.get(cleanId)!
        const cached = isSide === 'home' ? c.home : isSide === 'away' ? c.away : c.home || c.away
        addCandidate(cached)
      }
    }

    // 2º HIERARQUIA: Blindagem / dicionário canônico (para quando NÃO houver URL gravada ou se ela falhar)
    if (cleanTeam) {
      const canonicalClubUrl = getClubLogoUrl(cleanTeam)
      if (canonicalClubUrl) {
        addCandidate(canonicalClubUrl)
      }
    }

    // PRIORIDADE 2.b: Busca por NOME EXATO na tabela canônica (OFFICIAL_CLUB_TEAM_IDS / FlagCDN para seleções)
    if (cleanTeam) {
      // Clube exato (Botafogo -> 120, Vasco -> 133, Coritiba -> 132, Chapecoense -> 147...)
      const clubLogo = getClubLogoUrl(cleanTeam)
      addCandidate(clubLogo)

      // Seleção nacional exata via FlagCDN
      if (isNationalTeam(cleanTeam)) {
        const flagUrl = getFlagCdnUrl(cleanTeam, { cacheBust: true })
        addCandidate(flagUrl)
      }
    }

    // PRIORIDADE 3 (cont): Cache local readEscudoCache
    if (cleanTeam) {
      const cachedLocal = readEscudoCache(cleanTeam)
      addCandidate(cachedLocal)
    }

    // PRIORIDADE 3.b: Se resolveTeamBadgeUrl retornar outra URL válida (ex: seleções sem cacheBust)
    if (cleanTeam) {
      const resolved = resolveTeamBadgeUrl({
        teamName: cleanTeam,
        savedBadge: escudo,
        fixtureId,
        fichaDetalhes,
        isSide,
      })
      addCandidate(resolved)
    }

    // Fallback de bandeira final para seleções mesmo se não entrou antes
    if (cleanTeam && isNationalTeam(cleanTeam)) {
      const flagPlain = getFlagCdnUrl(cleanTeam)
      addCandidate(flagPlain)
    }

    return list
  }, [cleanTeam, escudo, fichaDetalhes, fixtureId, isSide, allowEmpty])

  // Recalcula candidatos ao mudar as propriedades
  useEffect(() => {
    const list = computeCandidateUrls()
    setCandidates(list)
    setCandidateIndex(0)

    // Se a lista está vazia mas temos fixtureId numérico, tenta buscar assincronamente (Prioridade 1 assíncrona)
    if (list.length === 0 && fixtureId && lazyFetch && !resolvingAsync) {
      const cleanId = String(fixtureId).replace(/\D/g, '').trim()
      if (cleanId) {
        setResolvingAsync(true)
        fetchAndCacheFixtureLogos(cleanId)
          .then((res) => {
            if (res) {
              const fetched =
                isSide === 'home' ? res.home : isSide === 'away' ? res.away : res.home || res.away
              if (fetched && fetched.trim()) {
                setCandidates([fetched.trim()])
                setCandidateIndex(0)
                return
              }
            }
            // Se falhou a busca remota, tenta a tabela canônica novamente
            if (cleanTeam) {
              const fallbackClub = getClubLogoUrl(cleanTeam)
              const fallbackFlag = isNationalTeam(cleanTeam)
                ? getFlagCdnUrl(cleanTeam, { cacheBust: true })
                : null
              const fallbacks = [fallbackClub, fallbackFlag].filter(Boolean) as string[]
              if (fallbacks.length > 0) {
                setCandidates(fallbacks)
                setCandidateIndex(0)
              }
            }
          })
          .catch(() => {
            /* ignore network errors */
          })
          .finally(() => {
            setResolvingAsync(false)
          })
      }
    }
  }, [computeCandidateUrls, fixtureId, isSide, cleanTeam, lazyFetch])

  // Trata falha transitória ou 404/304 de imagem: avança para o próximo candidato da hierarquia
  // NUNCA fixa permanentemente a sigla se ainda há prioridades restantes!
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    }
  }, [])

  const handleImageError = () => {
    setCandidateIndex((prevIndex) => {
      if (prevIndex + 1 < candidates.length) {
        return prevIndex + 1
      }
      // Se todos os candidatos falharam mas temos fixtureId e ainda não buscamos assincronamente:
      if (fixtureId && lazyFetch && !resolvingAsync) {
        const cleanId = String(fixtureId).replace(/\D/g, '').trim()
        if (cleanId) {
          setResolvingAsync(true)
          fetchAndCacheFixtureLogos(cleanId)
            .then((res) => {
              if (res) {
                const fetched =
                  isSide === 'home' ? res.home : isSide === 'away' ? res.away : res.home || res.away
                if (fetched && !candidates.includes(fetched.trim())) {
                  setCandidates((prev) => [...prev, fetched.trim()])
                }
              }
            })
            .catch(() => {})
            .finally(() => setResolvingAsync(false))
        }
      }
      return candidates.length // esgotou
    })
  }

  const activeSrc = candidateIndex < candidates.length ? candidates[candidateIndex] : null

  // Sigla exibida SOMENTE se a URL estiver completamente vazia E todas as prioridades falharem
  if (!activeSrc) {
    const fallbackText = sigla || (cleanTeam ? cleanTeam.slice(0, 2).toUpperCase() : '?')

    return (
      <div
        className={`${sizeClass} shrink-0 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center select-none ${textClass} ${className}`}
        title={cleanTeam}
        aria-label={cleanTeam}
      >
        <span>{fallbackText}</span>
      </div>
    )
  }

  const isFlagCdn = activeSrc.includes('flagcdn.com')

  return (
    <div
      className={`${sizeClass} shrink-0 flex items-center justify-center overflow-hidden ${className}`}
    >
      <img
        src={activeSrc}
        alt={cleanTeam}
        className="w-full h-full object-contain drop-shadow-xs"
        loading="eager"
        decoding="async"
        crossOrigin={isFlagCdn ? 'anonymous' : undefined}
        onError={handleImageError}
      />
    </div>
  )
}

export default TeamShield
