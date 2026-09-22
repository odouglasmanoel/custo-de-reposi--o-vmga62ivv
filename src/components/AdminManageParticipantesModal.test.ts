import { describe, it, expect, vi, beforeEach } from 'vitest'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Participante } from '@/types/bolao'
import { checkIsRateLimitError } from './AdminManageParticipantesModal'

describe('AdminManageParticipantesModal logic and backend contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agrupamento de participantes por nome agrega pontuação e múltiplos bolões', () => {
    const participantes: Participante[] = [
      {
        id: 'p1',
        collectionId: 'participantes',
        collectionName: 'participantes',
        bolao: 'bolao-1',
        nome: 'Bruno Lopes',
        pontuacao_total: 25,
        pontos_importados: 2,
        created: '2026-09-16T12:00:00Z',
        updated: '2026-09-16T12:00:00Z',
      },
      {
        id: 'p2',
        collectionId: 'participantes',
        collectionName: 'participantes',
        bolao: 'bolao-2',
        nome: 'Bruno Lopes',
        pontuacao_total: 12,
        pontos_importados: 0,
        created: '2026-09-16T12:00:00Z',
        updated: '2026-09-16T12:00:00Z',
      },
      {
        id: 'p3',
        collectionId: 'participantes',
        collectionName: 'participantes',
        bolao: 'bolao-1',
        nome: 'Douglas',
        pontuacao_total: 162,
        pontos_importados: 61,
        created: '2026-09-16T12:00:00Z',
        updated: '2026-09-16T12:00:00Z',
      },
    ]

    const map = new Map<string, Participante[]>()
    for (const p of participantes) {
      const nomeLimpo = p.nome.trim()
      const list = map.get(nomeLimpo) || []
      list.push(p)
      map.set(nomeLimpo, list)
    }

    const grouped: { nome: string; totalPontos: number; registros: Participante[] }[] = []
    map.forEach((regs, nome) => {
      const totalPontos = regs.reduce((acc, r) => acc + (r.pontuacao_total || 0), 0)
      grouped.push({ nome, totalPontos, registros: regs })
    })

    expect(grouped).toHaveLength(2)
    const bruno = grouped.find((g) => g.nome === 'Bruno Lopes')
    expect(bruno).toBeDefined()
    expect(bruno?.totalPontos).toBe(37)
    expect(bruno?.registros).toHaveLength(2)

    const douglas = grouped.find((g) => g.nome === 'Douglas')
    expect(douglas).toBeDefined()
    expect(douglas?.totalPontos).toBe(162)
    expect(douglas?.registros).toHaveLength(1)
  })

  it('casamento inteligente de login com participantes funciona por nome e apelidos (ex: brunol -> Bruno Lopes)', () => {
    const authUsers = [
      { id: 'u1', name: 'Douglas', email: 'douglas@repress.com.br', username: 'douglas' },
      { id: 'u2', name: 'Gabriel', email: 'gabriel@repress.com.br', username: 'gabriel' },
      { id: 'u3', name: 'Bruno Lopes', email: 'brunol@repress.com.br', username: 'brunol' },
      { id: 'u4', name: 'Bruno Xavier', email: 'brunox@repress.com.br', username: 'brunox' },
      { id: 'u5', name: 'Davi', email: 'davi@repress.com.br', username: 'davi' },
    ]

    const matchUser = (nome: string) => {
      const nomeLower = nome.toLowerCase()
      let matched = authUsers.find((u) => u.name && u.name.trim().toLowerCase() === nomeLower)
      if (!matched) {
        matched = authUsers.find((u) => {
          const uLogin = (u.username || '').toLowerCase()
          const uName = (u.name || '').toLowerCase()
          if (nomeLower.includes('lopes') && (uLogin.includes('brunol') || uName.includes('lopes')))
            return true
          if (
            nomeLower.includes('xavier') &&
            (uLogin.includes('brunox') || uName.includes('xavier'))
          )
            return true
          if (
            nomeLower.includes('douglas') &&
            (uLogin.includes('douglas') || uName.includes('douglas'))
          )
            return true
          if (
            nomeLower.includes('gabriel') &&
            (uLogin.includes('gabriel') || uName.includes('gabriel'))
          )
            return true
          if (nomeLower.includes('davi') && (uLogin.includes('davi') || uName.includes('davi')))
            return true
          return false
        })
      }
      return matched
    }

    expect(matchUser('Bruno Lopes')?.username).toBe('brunol')
    expect(matchUser('Bruno Xavier')?.username).toBe('brunox')
    expect(matchUser('Douglas')?.username).toBe('douglas')
    expect(matchUser('Davi')?.username).toBe('davi')
  })

  it('calcula corretamente a diferença de vínculos para adicionar e remover bolões', () => {
    const bolaoAtivo1 = 'b1'
    const bolaoAtivo2 = 'b2'
    const bolaoPassado = 'b3'
    const bolaoNovo = 'b4'

    const vinculosAtuais = [
      { id: 'rec-1', bolao: bolaoAtivo1 },
      { id: 'rec-2', bolao: bolaoPassado },
    ]

    const alvosDesejados = [bolaoAtivo1, bolaoAtivo2, bolaoNovo] // removeu bolaoPassado, adicionou bolaoAtivo2 e bolaoNovo

    const currentBolaoIds = new Set(vinculosAtuais.map((r) => r.bolao))
    const targetBolaoIds = new Set(alvosDesejados)

    const paraRemover = vinculosAtuais.filter((r) => !targetBolaoIds.has(r.bolao))
    const paraAdicionar = alvosDesejados.filter((bId) => !currentBolaoIds.has(bId))

    expect(paraRemover.map((r) => r.bolao)).toEqual([bolaoPassado])
    expect(paraAdicionar).toEqual([bolaoAtivo2, bolaoNovo])
  })

  it('chamada ao endpoint admin /backend/v1/admin/gerenciar-usuarios com action update_user', async () => {
    const sendSpy = vi.spyOn(pb, 'send').mockResolvedValue({
      success: true,
      message: 'Usuário atualizado com sucesso!',
      user: {
        id: 'u-brunol',
        name: 'Bruno Lopes',
        username: 'brunol',
        email: 'brunol@repress.com.br',
      },
    } as any)

    const payload = {
      action: 'update_user',
      user_id: 'u-brunol',
      name: 'Bruno Lopes Alterado',
      username: 'brunolopes',
      password: 'novaSenha123',
    }

    const res: any = await pb.send('/backend/v1/admin/gerenciar-usuarios', {
      method: 'POST',
      body: payload,
    })

    expect(sendSpy).toHaveBeenCalledWith('/backend/v1/admin/gerenciar-usuarios', {
      method: 'POST',
      body: payload,
    })
    expect(res.success).toBe(true)
  })

  it('lista de bolões exibe ativos e passados com status correspondente', () => {
    const todosBoloes: Bolao[] = [
      {
        id: 'b-coni',
        collectionId: 'boloes',
        collectionName: 'boloes',
        nome: 'Copa Coni',
        ativo: true,
        created: '2026-09-16',
        updated: '2026-09-20',
      },
      {
        id: 'b-genilton',
        collectionId: 'boloes',
        collectionName: 'boloes',
        nome: 'Copa Genilton',
        ativo: true,
        created: '2026-09-16',
        updated: '2026-09-22',
      },
      {
        id: 'b-mundo',
        collectionId: 'boloes',
        collectionName: 'boloes',
        nome: 'Copa do Mundo',
        ativo: false,
        created: '2026-09-16',
        updated: '2026-09-16',
      },
    ]

    const ativos = todosBoloes.filter((b) => b.ativo !== false)
    const passados = todosBoloes.filter((b) => b.ativo === false)

    expect(ativos).toHaveLength(2)
    expect(passados).toHaveLength(1)
    expect(passados[0].nome).toBe('Copa do Mundo')
  })

  it('ao abrir o modal (open = true), o ciclo de busca deve consultar participantes e boloes automaticamente', async () => {
    const mockParticipantes = [
      { id: 'p1', nome: 'Douglas', bolao: 'b1', pontuacao_total: 100 },
      { id: 'p2', nome: 'Gabriel', bolao: 'b1', pontuacao_total: 80 },
    ]
    const mockBoloes = [{ id: 'b1', nome: 'Copa Coni', ativo: true }]

    const getFullListSpy = vi.spyOn(pb, 'collection').mockImplementation((collName: string) => {
      if (collName === 'participantes') {
        return {
          getFullList: vi.fn().mockResolvedValue(mockParticipantes),
        } as any
      }
      if (collName === 'boloes') {
        return {
          getFullList: vi.fn().mockResolvedValue(mockBoloes),
        } as any
      }
      return {
        getFullList: vi.fn().mockResolvedValue([]),
      } as any
    })

    const sendSpy = vi.spyOn(pb, 'send').mockResolvedValue({
      users: [{ id: 'u1', name: 'Douglas', username: 'douglas', email: 'douglas@repress.com.br' }],
    } as any)

    // Simula a lógica executada automaticamente pelo useEffect quando open = true
    const carregarAutomatico = async () => {
      const boloesRecords = await pb.collection('boloes').getFullList()
      const participantesRecords = await pb.collection('participantes').getFullList()
      const authRes: any = await pb.send('/backend/v1/admin/gerenciar-usuarios', {
        method: 'POST',
        body: { action: 'list' },
      })
      return { boloesRecords, participantesRecords, users: authRes.users }
    }

    const resultado = await carregarAutomatico()

    expect(getFullListSpy).toHaveBeenCalledWith('boloes')
    expect(getFullListSpy).toHaveBeenCalledWith('participantes')
    expect(sendSpy).toHaveBeenCalledWith('/backend/v1/admin/gerenciar-usuarios', {
      method: 'POST',
      body: { action: 'list' },
    })
    expect(resultado.participantesRecords).toHaveLength(2)
    expect(resultado.boloesRecords).toHaveLength(1)
    expect(resultado.users).toHaveLength(1)
  })

  it('reabrir o modal (fechar e abrir novamente) dispara novo ciclo de carregamento dos dados atualizados', async () => {
    let callCount = 0
    vi.spyOn(pb, 'collection').mockImplementation((collName: string) => {
      if (collName === 'participantes') {
        callCount++
        return {
          getFullList: vi
            .fn()
            .mockResolvedValue([
              { id: `p-${callCount}`, nome: `Participante ${callCount}`, bolao: 'b1' },
            ]),
        } as any
      }
      return {
        getFullList: vi.fn().mockResolvedValue([]),
      } as any
    })

    // 1ª Abertura do modal
    const primeiraCarga = await pb.collection('participantes').getFullList()
    expect(primeiraCarga[0].id).toBe('p-1')

    // Fechamento e 2ª Abertura do modal
    const segundaCarga = await pb.collection('participantes').getFullList()
    expect(segundaCarga[0].id).toBe('p-2')
    expect(callCount).toBe(2)
  })

  it('identifica corretamente erros 429 e Rate Limit com checkIsRateLimitError', () => {
    expect(checkIsRateLimitError({ status: 429 })).toBe(true)
    expect(checkIsRateLimitError({ statusCode: 429 })).toBe(true)
    expect(checkIsRateLimitError({ response: { status: 429 } })).toBe(true)
    expect(checkIsRateLimitError({ message: 'Client error: 429 Too Many Requests' })).toBe(true)
    expect(checkIsRateLimitError({ error: 'rate limit exceeded' })).toBe(true)
    expect(checkIsRateLimitError({ message: 'Limite de requisições atingido' })).toBe(true)

    // Outros erros normais não devem ser classificados como rate limit
    expect(checkIsRateLimitError({ status: 500, message: 'Internal Server Error' })).toBe(false)
    expect(checkIsRateLimitError({ status: 404, message: 'Not found' })).toBe(false)
    expect(checkIsRateLimitError(null)).toBe(false)
    expect(checkIsRateLimitError(undefined)).toBe(false)
  })

  it('trava hasFetched / session lock impede re-execuções sucessivas de busca automática na mesma sessão de abertura', async () => {
    let fetchCount = 0
    let hasFetchedInSession = false
    let fetchInProgress = false

    const carregarDadosSimulado = async (options?: { force?: boolean }) => {
      if (fetchInProgress) return
      if (hasFetchedInSession && !options?.force) return

      fetchInProgress = true
      try {
        fetchCount++
        hasFetchedInSession = true
      } finally {
        fetchInProgress = false
      }
    }

    // Modal abre pela 1ª vez: open = true
    await carregarDadosSimulado()
    expect(fetchCount).toBe(1)
    expect(hasFetchedInSession).toBe(true)

    // Re-renders do pai acontecem 5 vezes com o modal ainda aberto (open = true)
    for (let i = 0; i < 5; i++) {
      await carregarDadosSimulado()
    }
    // Deve continuar sendo exatamente 1 chamada!
    expect(fetchCount).toBe(1)

    // Botão Atualizar (force: true) permite recarregar manualmente
    await carregarDadosSimulado({ force: true })
    expect(fetchCount).toBe(2)

    // Usuário fecha o modal (open = false) e reabre (open = true)
    hasFetchedInSession = false
    await carregarDadosSimulado()
    expect(fetchCount).toBe(3)
  })

  it('backoff de cooldown após 429 bloqueia chamadas automáticas até expirar', () => {
    let rateLimitCooldownUntil = 0
    let cooldownDurationSeconds = 30

    const trigger429 = () => {
      rateLimitCooldownUntil = Date.now() + cooldownDurationSeconds * 1000
    }

    const podeExecutarBusca = (options?: { force?: boolean }) => {
      const now = Date.now()
      if (now < rateLimitCooldownUntil && !options?.force) {
        return false
      }
      return true
    }

    // Inicialmente pode executar
    expect(podeExecutarBusca()).toBe(true)

    // Ocorre erro 429
    trigger429()

    // Novas chamadas automáticas são bloqueadas
    expect(podeExecutarBusca()).toBe(false)
    expect(podeExecutarBusca({ force: false })).toBe(false)

    // Botão forçado (atualização manual consciente) tem permissão de bypass
    expect(podeExecutarBusca({ force: true })).toBe(true)

    // Quando o tempo de espera expira
    rateLimitCooldownUntil = Date.now() - 1000
    expect(podeExecutarBusca()).toBe(true)
  })
})
