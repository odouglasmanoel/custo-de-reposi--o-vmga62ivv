import type { RecordModel } from 'pocketbase'
import pb from '@/lib/pocketbase/client'

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
 */
export async function toggleVotoJogo(
  enqueteId: string,
  jogoId: string,
  limiteVotosParam: number = 10,
): Promise<{ voted: boolean; totalVotosUsuario: number }> {
  const user = pb.authStore.record
  if (!user) throw new Error('Usuário não autenticado.')

  const userId = user.id
  const userName = user.name || user.username || 'Participante'

  // Piso mínimo garantido de 10 votos
  const limiteVotos = Math.max(10, Number(limiteVotosParam) || 10)

  // Busca votos existentes do usuário nesta enquete
  const meusVotos = await pb.collection('enquete_votos').getFullList<EnqueteVotoModel>({
    filter: `enquete = '${enqueteId}' && user = '${userId}'`,
  })

  const votoExistente = meusVotos.find((v) => v.jogo === jogoId)

  if (votoExistente) {
    // Remove voto
    await pb.collection('enquete_votos').delete(votoExistente.id)
    return { voted: false, totalVotosUsuario: meusVotos.length - 1 }
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
}

/**
 * Admin: Adiciona um jogo manualmente a uma enquete já ativa/criada
 */
export async function adicionarJogoManualNaEnquete(params: {
  enqueteId: string
  time_a: string
  time_b: string
  campeonato?: string
  regiao?: string
  data: string
  horario?: string
  logo_casa?: string
  logo_visitante?: string
  campeonato_logo?: string
}): Promise<EnqueteJogoModel> {
  const novoJogo = await pb.collection('enquete_jogos').create<EnqueteJogoModel>({
    enquete: params.enqueteId,
    time_a: params.time_a.trim(),
    time_b: params.time_b.trim(),
    campeonato: params.campeonato?.trim() || 'Futebol',
    regiao: params.regiao?.trim() || 'Brasileirão & Copas',
    data: params.data,
    horario: params.horario || '16:00',
    fixture_id: '',
    logo_casa: params.logo_casa || '',
    logo_visitante: params.logo_visitante || '',
    campeonato_logo: params.campeonato_logo || '',
    selecionado_admin: false,
    cadastrado_bolao: false,
    origem: 'manual',
  })
  invalidateEnqueteCache(params.enqueteId)
  return novoJogo
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

  // 1. Memória RAM
  const fromMem = escudoMemoryCache.get(key)
  if (fromMem !== undefined) return fromMem

  // 2. LocalStorage
  try {
    const raw = localStorage.getItem(`${ESCUDO_CACHE_PREFIX}_${key}`)
    if (raw !== null) {
      setWithBoundedCapacity(escudoMemoryCache, key, raw, 200)
      return raw
    }
  } catch {
    // LocalStorage indisponível
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
    logo_casa?: string
    logo_visitante?: string
  },
): Promise<EnqueteJogoModel> {
  const payload: Record<string, any> = {
    time_a: params.time_a.trim(),
    time_b: params.time_b.trim(),
    campeonato: params.campeonato?.trim() || 'Futebol',
    regiao: params.regiao?.trim() || 'Brasileirão & Copas',
    data: params.data,
    horario: params.horario || '16:00',
  }

  if (params.logo_casa !== undefined) {
    payload.logo_casa = params.logo_casa.trim()
  }
  if (params.logo_visitante !== undefined) {
    payload.logo_visitante = params.logo_visitante.trim()
  }

  const atualizado = await pb.collection('enquete_jogos').update<EnqueteJogoModel>(jogoId, payload)
  invalidateEnqueteCache()
  return atualizado
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
      await pb.collection('jogos').create({
        bolao: bolaoId,
        time_a: j.time_a.trim(),
        time_b: j.time_b.trim(),
        competicao: comp,
        fixture_id: j.fixture_id || '',
        data: dataISO,
        hora: hora,
        resultado_finalizado: false,
        tem_penaltis: false,
        gols_time_a: [],
        gols_time_b: [],
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
