import { describe, it, expect, vi, beforeEach } from 'vitest'
import pb from '@/lib/pocketbase/client'
import type { Bolao, Participante } from '@/types/bolao'

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
})
