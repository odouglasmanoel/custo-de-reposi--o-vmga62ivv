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
export async function buscarJogosIntervalo(
  dataInicio: string,
  dataFim: string,
): Promise<JogoBuscado[]> {
  const token = pb.authStore.token
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL
  const res = await fetch(
    `${baseUrl}/backend/v1/enquetes/buscar-jogos?data_inicio=${encodeURIComponent(dataInicio)}&data_fim=${encodeURIComponent(dataFim)}`,
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
}): Promise<EnqueteModel> {
  const userId = pb.authStore.record?.id || ''

  const enquete = await pb.collection('enquetes').create<EnqueteModel>({
    titulo: params.titulo.trim(),
    descricao: params.descricao?.trim() || '',
    data_inicio: params.dataInicio,
    data_fim: params.dataFim,
    status: 'aberta',
    criado_por: userId || null,
    limite_votos: params.limiteVotos || 8,
  })

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
      })
    } catch (err) {
      console.error('Erro ao adicionar jogo na enquete:', err)
    }
  }

  return enquete
}

/**
 * Lista enquetes cadastradas (mais recentes primeiro)
 */
export async function listarEnquetes(): Promise<EnqueteModel[]> {
  return pb.collection('enquetes').getFullList<EnqueteModel>({
    sort: '-created',
  })
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

  return { enquete, jogos: jogosCompletos, meusVotosIds }
}

/**
 * Alterna voto em um jogo (adiciona se não votado, remove se já votado)
 * Respeita a trava de no máximo 8 votos
 */
export async function toggleVotoJogo(
  enqueteId: string,
  jogoId: string,
  limiteVotos: number = 8,
): Promise<{ voted: boolean; totalVotosUsuario: number }> {
  const user = pb.authStore.record
  if (!user) throw new Error('Usuário não autenticado.')

  const userId = user.id
  const userName = user.name || user.username || 'Participante'

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
    return { voted: true, totalVotosUsuario: meusVotos.length + 1 }
  }
}

/**
 * Admin: Atualiza seleção manual do admin para um jogo da enquete
 */
export async function toggleAdminSelecaoJogo(jogoId: string, selecionado: boolean): Promise<void> {
  await pb.collection('enquete_jogos').update(jogoId, {
    selecionado_admin: selecionado,
  })
}

/**
 * Admin: Atualiza status da enquete (aberta | encerrada | cadastrada)
 */
export async function atualizarStatusEnquete(
  enqueteId: string,
  status: 'aberta' | 'encerrada' | 'cadastrada',
): Promise<void> {
  await pb.collection('enquetes').update(enqueteId, { status })
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
}
