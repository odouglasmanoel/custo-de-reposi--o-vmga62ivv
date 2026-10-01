import type { RecordModel } from 'pocketbase'
import pb from '@/lib/pocketbase/client'
import type { Jogo } from '@/types/bolao'
import {
  getFlagCdnUrl,
  isNationalTeam,
  isOfficialNationalTeamBadge,
  isContaminatedBadge,
} from '@/lib/flags'

export interface EnqueteModel extends RecordModel {
  titulo: string
  descricao?: string
  data_inicio: string
  data_fim: string
  status: 'aberta' | 'encerrada' | 'cadastrada'
  criado_por?: string
  limite_votos: number
  data_limite_votacao?: string
}

export interface EnqueteJogoModel extends RecordModel {
  enquete: string
  time_a: string
  time_b: string
  campeonato?: string
  regiao?: string
  data: string
  horario?: string
  fixture_id?: string
  logo_casa?: string
  logo_visitante?: string
  campeonato_logo?: string
  selecionado_admin?: boolean
  cadastrado_bolao?: boolean
  origem?: 'api' | 'manual'
}

export interface EnqueteVotoModel extends RecordModel {
  enquete: string
  jogo: string
  user: string
  user_name: string
}

export interface JogoBuscado {
  id: string
  fixture_id?: string
  time_a: string
  time_b: string
  campeonato: string
  prioridade?: number
  regiao: string
  data: string
  horario: string
  logo_casa?: string
  logo_visitante?: string
  campeonato_logo?: string
  origem?: 'api' | 'manual'
}

export interface JogoComVotos extends EnqueteJogoModel {
  totalVotos: number
  votantes: string[]
  votadoPorMim: boolean
}

/**
 * Retorna as datas padrão: hoje até a próxima segunda-feira
 */
export function getDefaultDatasIntervalo(): { dataInicio: string; dataFim: string } {
  const agora = new Date()
  // Ajuste aproximado para fuso America/Sao_Paulo (UTC-3)
  const spTime = new Date(agora.getTime() - 3 * 3600 * 1000)
  const y = spTime.getUTCFullYear()
  const m = ('0' + (spTime.getUTCMonth() + 1)).slice(-2)
  const d = ('0' + spTime.getUTCDate()).slice(-2)
  const dataInicio = `${y}-${m}-${d}`

  // Calcula próxima segunda-feira
  // getUTCDay: 0 = domingo, 1 = segunda, ..., 6 = sábado
  const diaSemana = spTime.getUTCDay()
  let diasAteSegunda = 1 - diaSemana
  if (diasAteSegunda <= 0) {
    diasAteSegunda += 7 // Próxima segunda
  }

  const proxSegunda = new Date(spTime.getTime() + diasAteSegunda * 24 * 3600 * 1000)
  const py = proxSegunda.getUTCFullYear()
  const pm = ('0' + (proxSegunda.getUTCMonth() + 1)).slice(-2)
  const pd = ('0' + proxSegunda.getUTCDate()).slice(-2)
  const dataFim = `${py}-${pm}-${pd}`

  return { dataInicio, dataFim }
}

/**
 * Busca jogos do intervalo via endpoint backend com cache e contingência
 */
/**
 * Converte qualquer formato de data (ex: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD)
 * rigorosamente para o formato aceito pelas APIs: YYYY-MM-DD
 */
export function formatToISOQueryDate(input: string): string {
  if (!input) return ''
  const trimmed = input.trim()

  // Se já está no formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // Se estiver no formato DD/MM/YYYY ou DD-MM-YYYY
  const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (brMatch) {
    const dia = ('0' + brMatch[1]).slice(-2)
    const mes = ('0' + brMatch[2]).slice(-2)
    const ano = brMatch[3]
    return `${ano}-${mes}-${dia}`
  }

  // Tenta parse via Date
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear()
    const m = ('0' + (parsed.getUTCMonth() + 1)).slice(-2)
    const d = ('0' + parsed.getUTCDate()).slice(-2)
    return `${y}-${m}-${d}`
  }

  return trimmed
}

/**
 * Busca jogos do intervalo via endpoint backend com cache e contingência
 */
export async function buscarJogosIntervalo(
  dataInicio: string,
  dataFim: string,
  semCorte: boolean = false,
): Promise<JogoBuscado[]> {
  const token = pb.authStore.token
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''

  const inicioISO = formatToISOQueryDate(dataInicio)
  const fimISO = formatToISOQueryDate(dataFim)
  const corteParam = semCorte ? '&sem_corte=1' : ''

  const res = await fetch(
    `${baseUrl}/backend/v1/enquetes/buscar-jogos?data_inicio=${encodeURIComponent(inicioISO)}&data_fim=${encodeURIComponent(fimISO)}${corteParam}`,
    {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    },
  )

  if (!res.ok) {
    let msg = 'Erro ao buscar jogos do intervalo'
    try {
      const err = await res.json()
      if (err.message || err.error) msg = err.message || err.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }

  const data = await res.json()
  return data.fixtures || []
}

/**
 * Cria uma nova enquete com a lista de jogos encontrados e selecionados
 */
export async function criarEnquete(params: {
  titulo: string
  descricao?: string
  dataInicio: string
  dataFim: string
  jogos: JogoBuscado[]
  limiteVotos?: number
  dataLimiteVotacao?: string
}): Promise<EnqueteModel> {
  const userId = pb.authStore.record?.id || ''

  const payload: Record<string, any> = {
    titulo: params.titulo.trim(),
    descricao: params.descricao?.trim() || '',
    data_inicio: params.dataInicio,
    data_fim: params.dataFim,
    status: 'aberta',
    criado_por: userId || null,
    limite_votos: params.limiteVotos || 10,
  }

  if (params.dataLimiteVotacao) {
    payload.data_limite_votacao = params.dataLimiteVotacao.trim()
  }

  const enquete = await pb.collection('enquetes').create<EnqueteModel>(payload)

  // Insere os jogos associados à enquete
  for (const j of params.jogos) {
    try {
      await pb.collection('enquete_jogos').create({
        enquete: enquete.id,
        time_a: j.time_a.trim(),
        time_b: j.time_b.trim(),
        campeonato: j.campeonato || 'Futebol',
        regiao: j.regiao || 'Brasileirão & Copas',
        data: j.data,
        horario: j.horario || '16:00',
        fixture_id: j.fixture_id || '',
        logo_casa: j.logo_casa || '',
        logo_visitante: j.logo_visitante || '',
        campeonato_logo: j.campeonato_logo || '',
        selecionado_admin: false,
        cadastrado_bolao: false,
        origem: j.origem || 'api',
      })
    } catch (err) {
      console.error('Erro ao adicionar jogo na enquete:', err)
    }
  }

  invalidateEnqueteCache()
  return enquete
}

// -------------------------------------------------------------
// Cache de Enquetes em Dois Níveis (Memória + LocalStorage/SessionStorage)
// -------------------------------------------------------------
import { setWithBoundedCapacity } from '@/lib/cacheManager'

export interface EnqueteCachePayload {
  enquete: EnqueteModel
  jogos: JogoComVotos[]
  meusVotosIds: string[]
  timestamp: number
}

const CACHE_ENQUETE_PREFIX = 'cr_enquete_detalhe_v1'
const CACHE_LISTA_ENQUETES_KEY = 'cr_enquetes_lista_v1'

const enqueteMemoryCache = new Map<string, EnqueteCachePayload>()
let listaEnquetesMemoryCache: { lista: EnqueteModel[]; timestamp: number } | null = null

export function readListaEnquetesCache(): EnqueteModel[] | null {
  if (listaEnquetesMemoryCache) {
    return listaEnquetesMemoryCache.lista
  }
  try {
    const raw = localStorage.getItem(CACHE_LISTA_ENQUETES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { lista: EnqueteModel[]; timestamp: number }
      listaEnquetesMemoryCache = parsed
      return parsed.lista
    }
  } catch {
    // LocalStorage indisponível
  }
  return null
}

export function writeListaEnquetesCache(lista: EnqueteModel[]): void {
  const payload = { lista, timestamp: Date.now() }
  listaEnquetesMemoryCache = payload
  try {
    localStorage.setItem(CACHE_LISTA_ENQUETES_KEY, JSON.stringify(payload))
  } catch {
    // Ignora quota cheia
  }
}

export function readEnqueteDetalhesCache(
  enqueteId: string,
  userId?: string,
): { enquete: EnqueteModel; jogos: JogoComVotos[]; meusVotosIds: Set<string> } | null {
  const cacheKey = `${enqueteId}_${userId || 'anon'}`
  const fromMem = enqueteMemoryCache.get(cacheKey)
  if (fromMem) {
    return {
      enquete: fromMem.enquete,
      jogos: fromMem.jogos,
      meusVotosIds: new Set(fromMem.meusVotosIds),
    }
  }

  try {
    const raw = localStorage.getItem(`${CACHE_ENQUETE_PREFIX}_${cacheKey}`)
    if (raw) {
      const parsed = JSON.parse(raw) as EnqueteCachePayload
      setWithBoundedCapacity(enqueteMemoryCache, cacheKey, parsed, 100)
      return {
        enquete: parsed.enquete,
        jogos: parsed.jogos,
        meusVotosIds: new Set(parsed.meusVotosIds),
      }
    }
  } catch {
    // LocalStorage indisponível
  }
  return null
}

export function writeEnqueteDetalhesCache(
  enqueteId: string,
  userId: string | undefined,
  data: { enquete: EnqueteModel; jogos: JogoComVotos[]; meusVotosIds: Set<string> },
): void {
  const cacheKey = `${enqueteId}_${userId || 'anon'}`
  const payload: EnqueteCachePayload = {
    enquete: data.enquete,
    jogos: data.jogos,
    meusVotosIds: Array.from(data.meusVotosIds),
    timestamp: Date.now(),
  }

  setWithBoundedCapacity(enqueteMemoryCache, cacheKey, payload, 100)
  try {
    localStorage.setItem(`${CACHE_ENQUETE_PREFIX}_${cacheKey}`, JSON.stringify(payload))
  } catch {
    // Ignora quota cheia
  }
}

/**
 * Invalida cache de uma enquete (útil após criação, voto ou edição)
 */
export function invalidateEnqueteCache(enqueteId?: string): void {
  if (enqueteId) {
    for (const key of Array.from(enqueteMemoryCache.keys())) {
      if (key.startsWith(enqueteId)) {
        enqueteMemoryCache.delete(key)
        try {
          localStorage.removeItem(`${CACHE_ENQUETE_PREFIX}_${key}`)
        } catch {
          /* intentionally ignored */
        }
      }
    }
  } else {
    enqueteMemoryCache.clear()
    listaEnquetesMemoryCache = null
    try {
      localStorage.removeItem(CACHE_LISTA_ENQUETES_KEY)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(CACHE_ENQUETE_PREFIX)) {
          localStorage.removeItem(k)
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }
}

/**
 * Lista enquetes cadastradas (mais recentes primeiro)
 */
export async function listarEnquetes(): Promise<EnqueteModel[]> {
  const records = await pb.collection('enquetes').getFullList<EnqueteModel>({
    sort: '-created',
    fields:
      'id,titulo,descricao,data_inicio,data_fim,status,limite_votos,data_limite_votacao,criado_por',
  })
  writeListaEnquetesCache(records)
  return records
}

/**
 * Obtém os jogos e votos de uma enquete com contagem
 */
export async function obterDadosEnquete(
  enqueteId: string,
  currentUserId?: string,
): Promise<{
  enquete: EnqueteModel
  jogos: JogoComVotos[]
  meusVotosIds: Set<string>
}> {
  const [enquete, jogos, votos] = await Promise.all([
    pb.collection('enquetes').getOne<EnqueteModel>(enqueteId),
    pb.collection('enquete_jogos').getFullList<EnqueteJogoModel>({
      filter: `enquete = '${enqueteId}'`,
      sort: 'data,horario',
    }),
    pb.collection('enquete_votos').getFullList<EnqueteVotoModel>({
      filter: `enquete = '${enqueteId}'`,
    }),
  ])

  // Agrupa votos por jogo
  const votosPorJogo = new Map<
    string,
    { count: number; votantes: string[]; votadoPorMim: boolean }
  >()
  const meusVotosIds = new Set<string>()

  for (const v of votos) {
    if (!votosPorJogo.has(v.jogo)) {
      votosPorJogo.set(v.jogo, { count: 0, votantes: [], votadoPorMim: false })
    }
    const item = votosPorJogo.get(v.jogo)!
    item.count += 1
    if (v.user_name && !item.votantes.includes(v.user_name)) {
      item.votantes.push(v.user_name)
    }
    if (currentUserId && v.user === currentUserId) {
      item.votadoPorMim = true
      meusVotosIds.add(v.jogo)
    }
  }

  const jogosCompletos: JogoComVotos[] = jogos.map((j) => {
    const stats = votosPorJogo.get(j.id) || { count: 0, votantes: [], votadoPorMim: false }
    return {
      ...j,
      totalVotos: stats.count,
      votantes: stats.votantes,
      votadoPorMim: stats.votadoPorMim,
    }
  })

  const resultado = { enquete, jogos: jogosCompletos, meusVotosIds }
  writeEnqueteDetalhesCache(enqueteId, currentUserId, resultado)

  return resultado
}

/**
 * Alterna voto em um jogo (adiciona se não votado, remove se já votado)
 * Respeita a trava de no máximo 10 votos (ou o limite_votos configurado na enquete)
 *
 * Utiliza o endpoint dedicado com privilégios de sistema (/backend/v1/enquetes/votar)
 * com fallback direto via SDK caso a rota customizada falhe por rede,
 * garantindo mensagens de erro descritivas e nunca um genérico "Something went wrong".
 */
export async function toggleVotoJogo(
  enqueteId: string,
  jogoId: string,
  limiteVotosParam: number = 10,
): Promise<{ voted: boolean; totalVotosUsuario: number; totalVotosJogo?: number }> {
  const user = pb.authStore.record
  const token = pb.authStore.token
  if (!user && !pb.authStore.isValid) {
    throw new Error(
      'Você precisa estar autenticado para votar. Acesse sua conta e tente novamente.',
    )
  }

  const userId = user?.id || ''
  const userName = user?.name || user?.username || 'Participante'
  const limiteVotos = Math.max(10, Number(limiteVotosParam) || 10)

  // 1. Prioridade: endpoint customizado com privilégios no backend (/backend/v1/enquetes/votar)
  try {
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
    const response = await fetch(`${baseUrl}/backend/v1/enquetes/votar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        enquete_id: enqueteId,
        jogo_id: jogoId,
        user_id: userId,
        limite_votos: limiteVotos,
      }),
    })

    const data = await response.json().catch(() => null)

    if (response.ok && data && data.success) {
      invalidateEnqueteCache(enqueteId)
      return {
        voted: Boolean(data.voted),
        totalVotosUsuario: Number(data.totalVotosUsuario) || 0,
        totalVotosJogo: data.totalVotosJogo !== undefined ? Number(data.totalVotosJogo) : undefined,
      }
    }

    // Se o backend retornou um erro descritivo em JSON, lança o motivo exato
    if (data && data.error) {
      throw new Error(data.error)
    }

    if (response.status === 401) {
      throw new Error('Sua sessão expirou ou você não está autenticado. Faça login novamente.')
    }
  } catch (backendErr: any) {
    // Se o erro já foi uma validação descritiva lançada acima, propaga imediatamente
    if (
      backendErr instanceof Error &&
      backendErr.message &&
      !backendErr.message.includes('fetch') &&
      !backendErr.message.includes('NetworkError')
    ) {
      throw backendErr
    }
    console.warn('[toggleVotoJogo] Tentando fallback direto via SDK após erro:', backendErr)
  }

  // 2. Fallback resiliente via PocketBase SDK
  try {
    const meusVotos = await pb.collection('enquete_votos').getFullList<EnqueteVotoModel>({
      filter: `enquete = '${enqueteId}' && user = '${userId}'`,
    })

    const votoExistente = meusVotos.find((v) => v.jogo === jogoId)

    if (votoExistente) {
      // Remove voto
      await pb.collection('enquete_votos').delete(votoExistente.id)
      invalidateEnqueteCache(enqueteId)
      return { voted: false, totalVotosUsuario: Math.max(0, meusVotos.length - 1) }
    } else {
      // Verifica limite
      if (meusVotos.length >= limiteVotos) {
        throw new Error(
          `Limite de ${limiteVotos} votos atingido para esta enquete. Desmarque outro jogo primeiro.`,
        )
      }
      // Cria voto
      await pb.collection('enquete_votos').create({
        enquete: enqueteId,
        jogo: jogoId,
        user: userId,
        user_name: userName,
      })
      invalidateEnqueteCache(enqueteId)
      return { voted: true, totalVotosUsuario: meusVotos.length + 1 }
    }
  } catch (sdkErr: any) {
    // Extrai mensagem limpa do PocketBase SDK evitando "Something went wrong"
    const rawMsg = sdkErr?.response?.message || sdkErr?.message || 'Falha ao registrar voto.'
    if (rawMsg.includes('Failed to authenticate') || sdkErr?.status === 401) {
      throw new Error(
        'Você precisa estar autenticado para votar. Acesse sua conta e tente novamente.',
      )
    }
    if (rawMsg.includes('Something went wrong')) {
      throw new Error(
        'Não foi possível gravar o voto no momento. Verifique sua conexão e tente novamente.',
      )
    }
    throw new Error(rawMsg)
  }
}

/**
 * Admin: Adiciona um jogo manualmente a uma enquete já ativa/criada
 */
export interface FixtureDetalhesItem {
  id: number | string
  homeTeamName?: string
  awayTeamName?: string
  homeTeamLogo?: string
  awayTeamLogo?: string
  leagueName?: string
  date?: string
}

export interface FixtureDetalhesResultado {
  success: boolean
  auto_lookup?: boolean
  fixture?: FixtureDetalhesItem
  alternativas?: FixtureDetalhesItem[]
  error?: string
  rate_limited?: boolean
  matches_found?: number
}

/**
 * Helper para verificar se uma URL de escudo já é a oficial da API-Sports
 */
export function isApiSportsLogo(url?: string | null): boolean {
  if (!url) return false
  return url.includes('media.api-sports.io')
}

export function isTheSportsDbLogo(url?: string | null): boolean {
  if (!url) return false
  return url.includes('thesportsdb.com')
}

export interface SalvarJogoEnqueteResult {
  jogo: EnqueteJogoModel
  fixtureIdEncontrado?: string
  escudosAtualizados?: boolean
  autoLookupSucesso?: boolean
  rateLimited?: boolean
  aviso?: string
}

/**
 * Consulta detalhes da fixture pelo ID na API-Sports via endpoint backend (/backend/v1/enquetes/fixture-detalhes)
 * Respeita a cota diária de 80 requisições (reset 21h Brasília).
 */
export async function buscarFixtureDetalhes(
  fixtureId: string | number,
): Promise<FixtureDetalhesResultado> {
  const cleanId = String(fixtureId || '')
    .replace(/\D/g, '')
    .trim()
  if (!cleanId) {
    return { success: false, error: 'ID da fixture inválido.' }
  }

  try {
    const token = pb.authStore.token
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
    const res = await fetch(
      `${baseUrl}/backend/v1/enquetes/fixture-detalhes?id=${encodeURIComponent(cleanId)}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    )

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `Falha na requisição (status ${res.status}).`,
        rate_limited: Boolean(data?.rate_limited || res.status === 429),
      }
    }

    return {
      success: true,
      fixture: data.fixture,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Erro ao buscar fixture: ${msg}`,
    }
  }
}

/**
 * Busca/Geração Automática do ID da Partida (Auto-Lookup) via backend (/backend/v1/enquetes/fixture-detalhes)
 * Consulta fixtures na data e encontra confronto entre Mandante e Visitante.
 * Se encontrar exatamente 1 correspondência, retorna o fixture com seu ID e logos oficiais.
 * Respeita a cota diária de 80 requisições (reset 21h Brasília).
 */
export async function buscarFixtureAutoLookup(params: {
  mandante: string
  visitante: string
  data: string
}): Promise<FixtureDetalhesResultado> {
  const mandante = (params.mandante || '').trim()
  const visitante = (params.visitante || '').trim()
  const data = (params.data || '').trim()

  if (!mandante || !visitante || !data) {
    return { success: false, error: 'Mandante, visitante e data são obrigatórios.' }
  }

  try {
    const token = pb.authStore.token
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
    const url = `${baseUrl}/backend/v1/enquetes/fixture-detalhes?mandante=${encodeURIComponent(
      mandante,
    )}&visitante=${encodeURIComponent(visitante)}&data=${encodeURIComponent(data)}`

    const res = await fetch(url, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    })

    const dataRes = await res.json().catch(() => null)
    if (!res.ok || !dataRes?.success) {
      return {
        success: false,
        alternativas: Array.isArray(dataRes?.alternativas) ? dataRes.alternativas : undefined,
        error: dataRes?.error || `Nenhuma partida correspondente (status ${res.status}).`,
        rate_limited: Boolean(dataRes?.rate_limited || res.status === 429),
        matches_found: dataRes?.matches_found,
      }
    }

    return {
      success: true,
      auto_lookup: true,
      fixture: dataRes.fixture,
      alternativas: Array.isArray(dataRes.alternativas) ? dataRes.alternativas : undefined,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Erro no auto-lookup da fixture: ${msg}`,
    }
  }
}

export async function adicionarJogoManualNaEnquete(params: {
  enqueteId: string
  time_a: string
  time_b: string
  campeonato?: string
  regiao?: string
  data: string
  horario?: string
  fixture_id?: string
  logo_casa?: string
  logo_visitante?: string
  campeonato_logo?: string
}): Promise<EnqueteJogoModel & { _saveMeta?: SalvarJogoEnqueteResult }> {
  let cleanFixtureId = (params.fixture_id || '').replace(/\D/g, '').trim()
  let logoCasa = (params.logo_casa || '').trim()
  let logoVisitante = (params.logo_visitante || '').trim()

  // Se vier com URL thesportsdb, descarta imediatamente
  if (isTheSportsDbLogo(logoCasa)) logoCasa = ''
  if (isTheSportsDbLogo(logoVisitante)) logoVisitante = ''

  let fixtureIdEncontrado = ''
  let escudosAtualizados = false
  let autoLookupSucesso = false
  let rateLimited = false
  let aviso = ''

  // 1. Se o campo 'ID da Partida' estiver VAZIO:
  // Faz busca automática por confronto na API-Football (endpoint /fixtures por data + times tolerantes)
  if (!cleanFixtureId && params.time_a && params.time_b && params.data) {
    try {
      const lookupRes = await buscarFixtureAutoLookup({
        mandante: params.time_a,
        visitante: params.time_b,
        data: params.data,
      })
      if (lookupRes.success && lookupRes.fixture?.id) {
        cleanFixtureId = String(lookupRes.fixture.id).replace(/\D/g, '').trim()
        fixtureIdEncontrado = cleanFixtureId
        autoLookupSucesso = true

        // Substitui URLs de escudo pelos logos oficiais da API
        if (lookupRes.fixture.homeTeamLogo) {
          logoCasa = lookupRes.fixture.homeTeamLogo
          escudosAtualizados = true
        }
        if (lookupRes.fixture.awayTeamLogo) {
          logoVisitante = lookupRes.fixture.awayTeamLogo
          escudosAtualizados = true
        }
      } else if (lookupRes.rate_limited) {
        rateLimited = true
        aviso =
          'Cota diária da API atingida (80/dia, reset 21h). O jogo foi cadastrado com sucesso.'
      }
    } catch (errLookup) {
      console.warn('[adicionarJogoManualNaEnquete] Aviso no auto-lookup ao salvar:', errLookup)
    }
  }

  // 2. Se o ID já estiver preenchido manualmente:
  // Consulta diretamente a API-Football pelo fixture ID (/fixtures?id={api_fixture_id})
  // e atualiza/sobrescreve as URLs de escudos/bandeiras com as imagens oficiais da partida
  // (substituindo links antigos do TheSportsDB). URLs que já são oficiais (media.api-sports.io)
  // são preservadas para economia de cota.
  if (cleanFixtureId && (!isApiSportsLogo(logoCasa) || !isApiSportsLogo(logoVisitante))) {
    try {
      const res = await buscarFixtureDetalhes(cleanFixtureId)
      if (res.success && res.fixture) {
        if (res.fixture.homeTeamLogo && !isApiSportsLogo(logoCasa)) {
          logoCasa = res.fixture.homeTeamLogo
          escudosAtualizados = true
        }
        if (res.fixture.awayTeamLogo && !isApiSportsLogo(logoVisitante)) {
          logoVisitante = res.fixture.awayTeamLogo
          escudosAtualizados = true
        }
      } else if (res.rate_limited) {
        rateLimited = true
        aviso =
          'Cota diária da API atingida (80/dia, reset 21h). O jogo foi cadastrado com o ID intacto.'
      }
    } catch (errFixture) {
      console.warn('[adicionarJogoManualNaEnquete] Aviso ao buscar logos da fixture:', errFixture)
    }
  }

  const novoJogo = await pb.collection('enquete_jogos').create<EnqueteJogoModel>({
    enquete: params.enqueteId,
    time_a: params.time_a.trim(),
    time_b: params.time_b.trim(),
    campeonato: params.campeonato?.trim() || 'Futebol',
    regiao: params.regiao?.trim() || 'Brasileirão & Copas',
    data: params.data,
    horario: params.horario || '16:00',
    fixture_id: cleanFixtureId,
    logo_casa: logoCasa,
    logo_visitante: logoVisitante,
    campeonato_logo: params.campeonato_logo || '',
    selecionado_admin: false,
    cadastrado_bolao: false,
    origem: 'manual',
  })
  invalidateEnqueteCache(params.enqueteId)

  const meta: SalvarJogoEnqueteResult = {
    jogo: novoJogo,
    fixtureIdEncontrado: fixtureIdEncontrado || undefined,
    escudosAtualizados,
    autoLookupSucesso,
    rateLimited,
    aviso: aviso || undefined,
  }

  return Object.assign(novoJogo, { _saveMeta: meta })
}

/**
 * Admin: Atualiza informações de um confronto da enquete
 * Mantém os votos computados intactos sem tocar na coleção de votos
 */
/**
 * Busca escudo de um clube através do endpoint backend
 * Fallback seguro: se falhar ou não encontrar, retorna string vazia
 */
// -------------------------------------------------------------
// Cache de Escudos em Dois Níveis (Memória + LocalStorage)
// -------------------------------------------------------------
const ESCUDO_CACHE_PREFIX = 'cr_escudo_cache_v1'
const escudoMemoryCache = new Map<string, string>()

function normalizeEscudoKey(name: string): string {
  try {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()
  } catch {
    return name.toLowerCase().trim()
  }
}

export function readEscudoCache(teamName: string): string | null {
  const key = normalizeEscudoKey(teamName)
  if (!key) return null

  // Invalidação e purga de cache contaminado:
  // Se o time for Paris / PSG mas a URL apontar para 192 (Köln) ou koln/cologne, expurga!
  const isParis = key.includes('paris') || key === 'psg'
  const isCoritiba =
    key === 'coritiba' || key === 'cfc' || key === 'coxa' || key.includes('coritiba')
  const isChapecoense =
    key === 'chapecoense' || key === 'chape' || key === 'acf' || key.includes('chapecoense')
  const isSelecao = isNationalTeam(teamName)
  const flagUrl = getFlagCdnUrl(teamName)

  // Escudos oficiais conhecidos para seleções/times recorrentes (fallback instantâneo da API-Sports)
  const KNOWN_OFFICIAL_BADGES: Record<string, string> = {
    botafogo: 'https://media.api-sports.io/football/teams/120.png',
    botafogorj: 'https://media.api-sports.io/football/teams/120.png',
    vasco: 'https://media.api-sports.io/football/teams/133.png',
    vascodagama: 'https://media.api-sports.io/football/teams/133.png',
    crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
    flamengo: 'https://media.api-sports.io/football/teams/127.png',
    fluminense: 'https://media.api-sports.io/football/teams/124.png',
    palmeiras: 'https://media.api-sports.io/football/teams/121.png',
    corinthians: 'https://media.api-sports.io/football/teams/131.png',
    saopaulo: 'https://media.api-sports.io/football/teams/126.png',
    santos: 'https://media.api-sports.io/football/teams/128.png',
    gremio: 'https://media.api-sports.io/football/teams/130.png',
    internacional: 'https://media.api-sports.io/football/teams/119.png',
    atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
    cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
    bahia: 'https://media.api-sports.io/football/teams/118.png',
    fortaleza: 'https://media.api-sports.io/football/teams/154.png',
    athleticopr: 'https://media.api-sports.io/football/teams/134.png',
    coritiba: 'https://media.api-sports.io/football/teams/132.png',
    chapecoense: 'https://media.api-sports.io/football/teams/147.png',
    paisdegales: 'https://media.api-sports.io/football/teams/767.png',
    gales: 'https://media.api-sports.io/football/teams/767.png',
    wales: 'https://media.api-sports.io/football/teams/767.png',
    portugal: 'https://media.api-sports.io/football/teams/27.png',
    dinamarca: 'https://media.api-sports.io/football/teams/21.png',
    denmark: 'https://media.api-sports.io/football/teams/21.png',
    noruega: 'https://media.api-sports.io/football/teams/1090.png',
    norway: 'https://media.api-sports.io/football/teams/1090.png',
    brasil: 'https://media.api-sports.io/football/teams/6.png',
    argentina: 'https://media.api-sports.io/football/teams/26.png',
    franca: 'https://media.api-sports.io/football/teams/2.png',
    espanha: 'https://media.api-sports.io/football/teams/9.png',
    inglaterra: 'https://media.api-sports.io/football/teams/10.png',
    alemanha: 'https://media.api-sports.io/football/teams/25.png',
    italia: 'https://media.api-sports.io/football/teams/768.png',
    holanda: 'https://media.api-sports.io/football/teams/1118.png',
    paisesbaixos: 'https://media.api-sports.io/football/teams/1118.png',
    belgica: 'https://media.api-sports.io/football/teams/1.png',
    croacia: 'https://media.api-sports.io/football/teams/3.png',
    uruguai: 'https://media.api-sports.io/football/teams/7.png',
    turquia: 'https://media.api-sports.io/football/teams/777.png',
    georgia: 'https://media.api-sports.io/football/teams/1104.png',
    irlandadonorte: 'https://media.api-sports.io/football/teams/771.png',
  }

  // Se for PSG, SEMPRE retorna a URL oficial hardcoded independente de qualquer resíduo
  if (isParis) {
    const psgOfficial = 'https://media.api-sports.io/football/teams/85.png'
    setWithBoundedCapacity(escudoMemoryCache, key, psgOfficial, 200)
    try {
      localStorage.setItem(`${ESCUDO_CACHE_PREFIX}_${key}`, psgOfficial)
    } catch {
      /* intentionally ignored */
    }
    return psgOfficial
  }

  // Invalidação e purga de contaminação para Dinamarca:
  const isDinamarca = key === 'dinamarca' || key === 'denmark'
  if (isDinamarca) {
    const dinamarcaOfficial = 'https://media.api-sports.io/football/teams/21.png'
    setWithBoundedCapacity(escudoMemoryCache, key, dinamarcaOfficial, 200)
    try {
      localStorage.setItem(`${ESCUDO_CACHE_PREFIX}_${key}`, dinamarcaOfficial)
    } catch {
      /* intentionally ignored */
    }
    return dinamarcaOfficial
  }

  // Sanitização de escudos invertidos Coritiba x Chapecoense no cache
  const sanitizeCachedUrl = (url: string): string => {
    if (!url) return url
    if (
      isCoritiba &&
      (url.includes('/147.png') || url.includes('/147_') || url.includes('/teams/147.'))
    ) {
      return 'https://media.api-sports.io/football/teams/132.png'
    }
    if (
      isChapecoense &&
      (url.includes('/132.png') || url.includes('/132_') || url.includes('/teams/132.'))
    ) {
      return 'https://media.api-sports.io/football/teams/147.png'
    }
    return url
  }

  // Helper de validação do valor do cache
  const isValidCachedUrl = (url: string) => {
    if (!url) return false
    if (isContaminatedBadge(teamName, url)) return false
    if (
      isCoritiba &&
      (url.includes('/147.png') || url.includes('/147_') || url.includes('/teams/147.'))
    ) {
      return false
    }
    if (
      isChapecoense &&
      (url.includes('/132.png') || url.includes('/132_') || url.includes('/teams/132.'))
    ) {
      return false
    }
    if (isSelecao) {
      // Se for seleção nacional, só aceita se for a FlagCDN ou escudo oficial da seleção
      if (url.startsWith('https://flagcdn.com/')) return true
      if (isOfficialNationalTeamBadge(teamName, url)) return true
      return false
    }
    return true
  }

  // 1. Memória RAM
  const fromMem = escudoMemoryCache.get(key)
  if (fromMem !== undefined) {
    const sanitizedMem = sanitizeCachedUrl(fromMem)
    if (!isValidCachedUrl(sanitizedMem)) {
      escudoMemoryCache.delete(key)
      try {
        localStorage.removeItem(`${ESCUDO_CACHE_PREFIX}_${key}`)
      } catch {
        /* ignore */
      }
    } else {
      if (sanitizedMem !== fromMem) {
        setWithBoundedCapacity(escudoMemoryCache, key, sanitizedMem, 200)
        try {
          localStorage.setItem(`${ESCUDO_CACHE_PREFIX}_${key}`, sanitizedMem)
        } catch {
          /* ignore */
        }
      }
      return sanitizedMem
    }
  }

  // 2. LocalStorage
  try {
    const raw = localStorage.getItem(`${ESCUDO_CACHE_PREFIX}_${key}`)
    if (raw !== null) {
      const sanitizedRaw = sanitizeCachedUrl(raw)
      if (!isValidCachedUrl(sanitizedRaw)) {
        localStorage.removeItem(`${ESCUDO_CACHE_PREFIX}_${key}`)
      } else {
        if (sanitizedRaw !== raw) {
          try {
            localStorage.setItem(`${ESCUDO_CACHE_PREFIX}_${key}`, sanitizedRaw)
          } catch {
            /* ignore */
          }
        }
        setWithBoundedCapacity(escudoMemoryCache, key, sanitizedRaw, 200)
        return sanitizedRaw
      }
    }
  } catch {
    // LocalStorage indisponível
  }

  if (KNOWN_OFFICIAL_BADGES[key]) {
    const badge = KNOWN_OFFICIAL_BADGES[key]
    setWithBoundedCapacity(escudoMemoryCache, key, badge, 200)
    return badge
  }

  // Se for seleção nacional e não tiver escudo oficial nos conhecidos, retorna FlagCDN
  if (isSelecao && flagUrl) {
    setWithBoundedCapacity(escudoMemoryCache, key, flagUrl, 200)
    return flagUrl
  }

  return null
}

export function writeEscudoCache(teamName: string, badgeUrl: string): void {
  const key = normalizeEscudoKey(teamName)
  if (!key) return

  setWithBoundedCapacity(escudoMemoryCache, key, badgeUrl, 200)
  try {
    // Evita crescimento descontrolado de escudos em localStorage (limite de ~500 entradas)
    pruneEscudosLocalStorage(500)
    localStorage.setItem(`${ESCUDO_CACHE_PREFIX}_${key}`, badgeUrl)
  } catch {
    // LocalStorage indisponível ou cheio
  }
}

function pruneEscudosLocalStorage(maxCount = 500): void {
  try {
    const escudoKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${ESCUDO_CACHE_PREFIX}_`)) {
        escudoKeys.push(k)
      }
    }
    if (escudoKeys.length >= maxCount) {
      const toRemoveCount = escudoKeys.length - maxCount + 10
      for (let i = 0; i < toRemoveCount; i++) {
        localStorage.removeItem(escudoKeys[i])
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Busca escudo de um clube através do endpoint backend com cache de dois níveis
 * Fallback seguro: se falhar ou não encontrar, retorna string vazia
 */
export async function buscarEscudoTime(teamName: string): Promise<string> {
  const trimmed = (teamName || '').trim()
  if (!trimmed) return ''

  // Consulta cache de dois níveis primeiro
  // Tratamento direto para PSG para garantir o escudo oficial imediatamente
  const normKey = normalizeEscudoKey(trimmed)
  if (normKey.includes('paris') || normKey === 'psg') {
    const psgLogo = 'https://media.api-sports.io/football/teams/85.png'
    setWithBoundedCapacity(escudoMemoryCache, normKey, psgLogo, 200)
    writeEscudoCache(trimmed, psgLogo)
    return psgLogo
  }

  const cached = readEscudoCache(trimmed)
  if (cached !== null && cached !== '') {
    return cached
  }

  try {
    const token = pb.authStore.token
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
    const res = await fetch(
      `${baseUrl}/backend/v1/enquetes/buscar-escudo?team=${encodeURIComponent(trimmed)}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    )

    if (!res.ok) return ''
    const data = await res.json()
    const badge = data && typeof data.badgeUrl === 'string' ? data.badgeUrl.trim() : ''
    if (badge) {
      writeEscudoCache(trimmed, badge)
    }
    return badge
  } catch (err) {
    console.warn('[buscarEscudoTime] Erro na requisição:', err)
    return ''
  }
}

/**
 * Admin: Atualiza informações de um confronto da enquete
 * Mantém os votos computados intactos sem tocar na coleção de votos
 */
export async function editarJogoEnquete(
  jogoId: string,
  params: {
    time_a: string
    time_b: string
    campeonato?: string
    regiao?: string
    data: string
    horario?: string
    fixture_id?: string
    logo_casa?: string
    logo_visitante?: string
  },
): Promise<EnqueteJogoModel & { _saveMeta?: SalvarJogoEnqueteResult }> {
  // Obtém o registro existente para preservar fixture_id se o novo vier vazio
  let jogoExistente: EnqueteJogoModel | null = null
  try {
    jogoExistente = await pb.collection('enquete_jogos').getOne<EnqueteJogoModel>(jogoId)
  } catch {
    jogoExistente = null
  }

  const cleanParamFixtureId =
    params.fixture_id !== undefined ? params.fixture_id.replace(/\D/g, '').trim() : undefined
  const existingFixtureId = (jogoExistente?.fixture_id || '').replace(/\D/g, '').trim()

  // Regra: nunca apagar um fixture_id existente se o campo vier vazio no salvamento
  let fixtureIdFinal = existingFixtureId
  if (cleanParamFixtureId !== undefined && cleanParamFixtureId !== '') {
    fixtureIdFinal = cleanParamFixtureId
  }

  // Se o usuário passou explicitamente params.logo_casa/params.logo_visitante, respeita o valor
  // (mesmo que vazio — NUNCA restaura o valor antigo do banco quando o usuário enviou vazio).
  // Além disso, se o logo existente for do TheSportsDB, ele é descartado imediatamente.
  let logoCasaFinal =
    params.logo_casa !== undefined
      ? params.logo_casa.trim()
      : isTheSportsDbLogo(jogoExistente?.logo_casa)
        ? ''
        : jogoExistente?.logo_casa || ''

  let logoVisitanteFinal =
    params.logo_visitante !== undefined
      ? params.logo_visitante.trim()
      : isTheSportsDbLogo(jogoExistente?.logo_visitante)
        ? ''
        : jogoExistente?.logo_visitante || ''

  // Se o usuário passou link TheSportsDB manualmente, descarta para nunca persistir essa fonte
  if (isTheSportsDbLogo(logoCasaFinal)) {
    logoCasaFinal = ''
  }
  if (isTheSportsDbLogo(logoVisitanteFinal)) {
    logoVisitanteFinal = ''
  }

  let fixtureIdEncontrado = ''
  let escudosAtualizados = false
  let autoLookupSucesso = false
  let rateLimited = false
  let aviso = ''

  // 1. Se NÃO tem fixture_id (nem no banco nem no param) E algum escudo precisa ser resolvido:
  // Faz busca automática por confronto na API-Football (endpoint /fixtures por data + times tolerantes)
  if (!fixtureIdFinal && params.time_a && params.time_b && params.data) {
    try {
      const lookupRes = await buscarFixtureAutoLookup({
        mandante: params.time_a,
        visitante: params.time_b,
        data: params.data,
      })
      if (lookupRes.success && lookupRes.fixture?.id) {
        fixtureIdFinal = String(lookupRes.fixture.id).replace(/\D/g, '').trim()
        fixtureIdEncontrado = fixtureIdFinal
        autoLookupSucesso = true

        // Substitui escudos pelos oficiais retornados pela API se estavam vazios ou não-oficiais
        if (lookupRes.fixture.homeTeamLogo && (!logoCasaFinal || !isApiSportsLogo(logoCasaFinal))) {
          logoCasaFinal = lookupRes.fixture.homeTeamLogo
          escudosAtualizados = true
        }
        if (
          lookupRes.fixture.awayTeamLogo &&
          (!logoVisitanteFinal || !isApiSportsLogo(logoVisitanteFinal))
        ) {
          logoVisitanteFinal = lookupRes.fixture.awayTeamLogo
          escudosAtualizados = true
        }
      } else if (lookupRes.rate_limited) {
        rateLimited = true
        aviso = 'Cota diária da API atingida (80/dia, reset 21h). Alterações salvas com sucesso.'
      }
    } catch (errLookup) {
      console.warn('[editarJogoEnquete] Erro no auto-lookup ao salvar:', errLookup)
    }
  }

  // 2. Se o ID já estiver preenchido (manualmente ou preservado do banco):
  // Consulta diretamente a API-Football (/fixtures?id={api_fixture_id}) e atualiza/sobrescreve
  // as URLs dos escudos/bandeiras com as imagens oficiais retornadas pela API (substituindo TheSportsDB/vazios).
  // URLs que já sejam media.api-sports.io não precisam de nova requisição se ambas forem oficiais.
  if (fixtureIdFinal && (!isApiSportsLogo(logoCasaFinal) || !isApiSportsLogo(logoVisitanteFinal))) {
    try {
      const res = await buscarFixtureDetalhes(fixtureIdFinal)
      if (res.success && res.fixture) {
        if (res.fixture.homeTeamLogo && !isApiSportsLogo(logoCasaFinal)) {
          logoCasaFinal = res.fixture.homeTeamLogo
          escudosAtualizados = true
        }
        if (res.fixture.awayTeamLogo && !isApiSportsLogo(logoVisitanteFinal)) {
          logoVisitanteFinal = res.fixture.awayTeamLogo
          escudosAtualizados = true
        }
      } else if (res.rate_limited) {
        rateLimited = true
        aviso =
          'Cota diária da API atingida (80/dia, reset 21h). Alterações salvas com o ID intacto.'
      }
    } catch (errFixture) {
      console.warn('[editarJogoEnquete] Aviso ao buscar logos da fixture:', errFixture)
    }
  }

  const payload: Record<string, any> = {
    time_a: params.time_a.trim(),
    time_b: params.time_b.trim(),
    campeonato: params.campeonato?.trim() || 'Futebol',
    regiao: params.regiao?.trim() || 'Brasileirão & Copas',
    data: params.data,
    horario: params.horario || '16:00',
    logo_casa: logoCasaFinal,
    logo_visitante: logoVisitanteFinal,
  }

  if (fixtureIdFinal) {
    payload.fixture_id = fixtureIdFinal
  }

  const atualizado = await pb.collection('enquete_jogos').update<EnqueteJogoModel>(jogoId, payload)
  invalidateEnqueteCache()

  // Propaga imediatamente as alterações para o jogo correspondente no bolão se já estiver cadastrado
  try {
    const timeABusca = (jogoExistente?.time_a || params.time_a).trim().replace(/'/g, "\\'")
    const timeBBusca = (jogoExistente?.time_b || params.time_b).trim().replace(/'/g, "\\'")

    const jogosRelacionados = await pb.collection('jogos').getFullList<Jogo>({
      filter: `time_a = '${timeABusca}' && time_b = '${timeBBusca}'`,
    })

    const jogoUpdatePayload: Record<string, unknown> = {
      time_a: params.time_a.trim(),
      time_b: params.time_b.trim(),
    }
    if (logoCasaFinal) {
      jogoUpdatePayload.url_escudo_mandante = logoCasaFinal
    }
    if (logoVisitanteFinal) {
      jogoUpdatePayload.url_escudo_visitante = logoVisitanteFinal
    }
    if (params.campeonato !== undefined) {
      jogoUpdatePayload.competicao = params.campeonato.trim()
    }
    // Propaga fixture_id para jogos quando houver, sem nunca sobrescrever com vazio
    if (fixtureIdFinal) {
      jogoUpdatePayload.fixture_id = fixtureIdFinal
    }

    for (const jr of jogosRelacionados) {
      // Se o jogo já possui fixture_id e o novo não foi fornecido, preserva
      const updateDataForJr = { ...jogoUpdatePayload }
      if (!fixtureIdFinal && jr.fixture_id) {
        delete updateDataForJr.fixture_id
      }
      await pb
        .collection('jogos')
        .update(jr.id, updateDataForJr)
        .catch(() => {})
    }
  } catch (syncErr) {
    console.warn('[editarJogoEnquete] Falha ao sincronizar com tabela de jogos:', syncErr)
  }

  const meta: SalvarJogoEnqueteResult = {
    jogo: atualizado,
    fixtureIdEncontrado: fixtureIdEncontrado || undefined,
    escudosAtualizados,
    autoLookupSucesso,
    rateLimited,
    aviso: aviso || undefined,
  }

  return Object.assign(atualizado, { _saveMeta: meta })
}

/**
 * Admin: Exclui um jogo individual da enquete
 * Também limpa votos associados a esse jogo específico
 */
export async function excluirJogoEnquete(jogoId: string): Promise<void> {
  // Limpa votos do confronto se existirem para não deixar registros órfãos
  try {
    const votosJogo = await pb.collection('enquete_votos').getFullList({
      filter: `jogo = '${jogoId}'`,
    })
    for (const v of votosJogo) {
      await pb
        .collection('enquete_votos')
        .delete(v.id)
        .catch(() => {})
    }
  } catch {
    /* prossegue para deletar o jogo */
  }

  await pb.collection('enquete_jogos').delete(jogoId)
  invalidateEnqueteCache()
}

/**
 * Admin: Atualiza seleção manual do admin para um jogo da enquete
 */
export async function toggleAdminSelecaoJogo(jogoId: string, selecionado: boolean): Promise<void> {
  await pb.collection('enquete_jogos').update(jogoId, {
    selecionado_admin: selecionado,
  })
  invalidateEnqueteCache()
}

/**
 * Admin: Atualiza status da enquete (aberta | encerrada | cadastrada)
 */
export async function atualizarStatusEnquete(
  enqueteId: string,
  status: 'aberta' | 'encerrada' | 'cadastrada',
  dataLimiteVotacao?: string,
): Promise<void> {
  const payload: Record<string, any> = { status }
  if (dataLimiteVotacao !== undefined) {
    payload.data_limite_votacao = dataLimiteVotacao.trim()
  }
  await pb.collection('enquetes').update(enqueteId, payload)
  invalidateEnqueteCache(enqueteId)
  writeListaEnquetesCache([]) // Força revalidação da lista
}

/**
 * Admin: Edita metadados da enquete ativa (título, limite de votos, período, prazo e instruções)
 * NUNCA toca em enquete_jogos ou enquete_votos — votos são preservados intactos.
 */
export async function editarEnquete(
  enqueteId: string,
  dados: {
    titulo: string
    limite_votos: number
    data_inicio: string
    data_fim: string
    data_limite_votacao: string
    descricao?: string
  },
): Promise<EnqueteModel> {
  const payload: Record<string, any> = {
    titulo: dados.titulo.trim(),
    limite_votos: Math.max(1, Number(dados.limite_votos) || 4),
    data_inicio: dados.data_inicio.trim(),
    data_fim: dados.data_fim.trim(),
    data_limite_votacao: dados.data_limite_votacao.trim(),
    descricao: (dados.descricao || '').trim(),
  }
  const atualizada = await pb.collection('enquetes').update<EnqueteModel>(enqueteId, payload)
  invalidateEnqueteCache(enqueteId)
  writeListaEnquetesCache([])
  return atualizada
}

/**
 * Admin: Cadastra automaticamente os jogos aprovados na rodada do bolão Copa Coni
 */
export async function cadastrarJogosAprovadosNaCopaConi(
  enqueteId: string,
  jogosAprovados: JogoComVotos[],
): Promise<{ cadastrados: number; bolaoNome: string }> {
  // 1. Localiza a Copa Coni
  const boloes = await pb.collection('boloes').getFullList<RecordModel>()
  const copaConi = boloes.find(
    (b) => b.nome.toLowerCase().includes('copa coni') || b.nome.toLowerCase().includes('coni'),
  )

  if (!copaConi) {
    throw new Error(
      'Bolão "Copa Coni" não encontrado no sistema. Verifique a listagem de competições.',
    )
  }

  const bolaoId = copaConi.id
  let count = 0

  for (const j of jogosAprovados) {
    // Formata data ISO para o formato de data dos jogos do bolão
    // Campo data na coleção jogos é date: ex: 2026-09-16 17:31:04.267Z ou YYYY-MM-DDT00:00:00.000Z
    const dataISO = j.data.includes('T') ? j.data : `${j.data}T00:00:00.000Z`
    const hora = (j.horario || '16:00').trim()
    const comp = j.campeonato || 'Copa Coni'

    try {
      const fixtureIdFinal = (j.fixture_id || '').replace(/\D/g, '').trim()
      await pb.collection('jogos').create({
        bolao: bolaoId,
        time_a: j.time_a.trim(),
        time_b: j.time_b.trim(),
        competicao: comp,
        fixture_id: fixtureIdFinal,
        data: dataISO,
        hora: hora,
        resultado_finalizado: false,
        tem_penaltis: false,
        gols_time_a: [],
        gols_time_b: [],
        url_escudo_mandante: j.logo_casa || '',
        url_escudo_visitante: j.logo_visitante || '',
      })

      // Marca o jogo da enquete como cadastrado no bolão
      await pb.collection('enquete_jogos').update(j.id, {
        cadastrado_bolao: true,
      })

      count++
    } catch (err) {
      console.error('Erro ao cadastrar jogo aprovado na Copa Coni:', err)
    }
  }

  // Atualiza última atualização da Copa Coni
  try {
    await pb.collection('boloes').update(bolaoId, {
      ultima_atualizacao: new Date().toISOString(),
    })
  } catch {
    /* ignore */
  }

  // Atualiza status da enquete para 'cadastrada' se ao menos 1 jogo foi inserido
  if (count > 0) {
    try {
      await pb.collection('enquetes').update(enqueteId, {
        status: 'cadastrada',
      })
    } catch {
      /* ignore */
    }
  }

  return { cadastrados: count, bolaoNome: copaConi.nome }
}

/**
 * Exclui uma enquete e todos os jogos/votos em cascata
 */
export async function excluirEnquete(enqueteId: string): Promise<void> {
  await pb.collection('enquetes').delete(enqueteId)
  invalidateEnqueteCache(enqueteId)
}
