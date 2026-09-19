import { describe, it, expect } from 'vitest'
import { ClientResponseError } from 'pocketbase'
import { getErrorMessage, extractFieldErrors } from './errors'

describe('pocketbase/errors helper', () => {
  it('extrai mensagens detalhadas de erros de campos do PocketBase', () => {
    const error = new ClientResponseError({
      url: '/api/collections/jogos/records',
      status: 400,
      data: {
        data: {
          time_a: { message: 'Cannot be blank' },
          hora: { message: 'Formato inválido' },
        },
        message: 'Failed to create record.',
      },
    })

    const extracted = extractFieldErrors(error)
    expect(extracted).toEqual({
      time_a: 'Cannot be blank',
      hora: 'Formato inválido',
    })

    const message = getErrorMessage(error)
    expect(message).toContain('Time A (Mandante): Cannot be blank')
    expect(message).toContain('Hora do Jogo: Formato inválido')
  })

  it('retorna mensagem em pt-BR quando o erro for Failed to create record sem campos específicos', () => {
    const error = new ClientResponseError({
      url: '/api/collections/jogos/records',
      status: 400,
      data: {
        message: 'Failed to create record.',
      },
    })

    const message = getErrorMessage(error)
    expect(message).toBe(
      'Falha ao salvar a partida no banco de dados. Verifique os dados preenchidos.',
    )
  })

  it('retorna aviso de permissão quando o status for 403', () => {
    const error = new ClientResponseError({
      url: '/api/collections/jogos/records',
      status: 403,
      data: {
        message: 'Failed to create record.',
      },
    })

    const message = getErrorMessage(error)
    expect(message).toContain('Permissão negada')
  })

  it('retorna a mensagem original para erros genéricos comuns do JavaScript', () => {
    const error = new Error('Falha de conexão com a rede')
    expect(getErrorMessage(error)).toBe('Falha de conexão com a rede')
  })
})
