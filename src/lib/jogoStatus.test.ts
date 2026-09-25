import { describe, it, expect } from 'vitest'
import { jogoPontua, isJogoIniciado, isJogoConcluido } from './jogoStatus'

describe('isJogoConcluido', () => {
  it('retorna true quando resultado_finalizado for true', () => {
    expect(isJogoConcluido({ resultado_finalizado: true })).toBe(true)
    expect(isJogoConcluido({ resultado_finalizado: true, status: 'pendente' })).toBe(true)
  })

  it('retorna true para status de término: finalizado, encerrado, ft, finished, aet, pen', () => {
    expect(isJogoConcluido({ status: 'finalizado' })).toBe(true)
    expect(isJogoConcluido({ status: 'encerrado' })).toBe(true)
    expect(isJogoConcluido({ status: 'FT' })).toBe(true)
    expect(isJogoConcluido({ status: 'finished' })).toBe(true)
    expect(isJogoConcluido({ status: 'AET' })).toBe(true)
    expect(isJogoConcluido({ status: 'PEN' })).toBe(true)
    expect(isJogoConcluido({ status: 'Match Finished' })).toBe(true)
  })

  it('retorna false para jogos abertos, agendados, ao vivo ou indefinidos', () => {
    expect(isJogoConcluido(null)).toBe(false)
    expect(isJogoConcluido(undefined)).toBe(false)
    expect(isJogoConcluido({ status: 'pendente', resultado_finalizado: false })).toBe(false)
    expect(isJogoConcluido({ status: 'ao_vivo', resultado_finalizado: false })).toBe(false)
    expect(isJogoConcluido({ status: 'em_andamento' })).toBe(false)
    expect(isJogoConcluido({ status: '1h' })).toBe(false)
  })
})

describe('isJogoIniciado', () => {
  const agoraRef = new Date('2026-09-24T12:00:00-03:00').getTime()

  it('retorna false para jogo futuro pendente ou agendado', () => {
    const jogoFuturo = {
      data: '2026-09-26',
      hora: '15:45',
      status: 'pendente',
      resultado_finalizado: false,
    }
    expect(isJogoIniciado(jogoFuturo, agoraRef)).toBe(false)
  })

  it('retorna true para jogo futuro com resultado_finalizado=true (exceção/encerramento antecipado)', () => {
    const jogoFinalizado = {
      data: '2026-09-26',
      hora: '15:45',
      status: 'finalizado',
      resultado_finalizado: true,
    }
    expect(isJogoIniciado(jogoFinalizado, agoraRef)).toBe(true)
  })

  it('retorna true para jogo cujo horário de início já passou (kickoff <= agoraMs)', () => {
    const jogoPassado = {
      data: '2026-09-24',
      hora: '11:00', // iniciou às 11:00, agoraRef é 12:00
      status: 'pendente',
      resultado_finalizado: false,
    }
    expect(isJogoIniciado(jogoPassado, agoraRef)).toBe(true)
  })

  it('retorna true para jogo ao vivo', () => {
    const jogoAoVivo = {
      data: '2026-09-24',
      hora: '11:45',
      status: 'ao_vivo',
      resultado_finalizado: false,
    }
    expect(isJogoIniciado(jogoAoVivo, agoraRef)).toBe(true)
  })

  it('retorna false para jogos adiados ou cancelados', () => {
    const jogoAdiado = {
      data: '2026-09-24',
      hora: '10:00',
      status: 'postponed',
      resultado_finalizado: false,
    }
    expect(isJogoIniciado(jogoAdiado, agoraRef)).toBe(false)
  })
})

describe('jogoPontua', () => {
  const agoraRef = new Date('2026-09-24T12:00:00-03:00').getTime()

  it('retorna false para jogos futuros mesmo com resultado_finalizado=true', () => {
    const jogoFuturo = {
      data: '2026-09-26',
      hora: '15:45',
      status: 'finalizado',
      resultado_finalizado: true,
    }
    expect(jogoPontua(jogoFuturo, agoraRef)).toBe(false)
  })

  it('retorna false para status pendente ou agendado', () => {
    const jogoPendente = {
      data: '2026-09-20',
      hora: '16:00',
      status: 'pendente',
      resultado_finalizado: false,
    }
    expect(jogoPontua(jogoPendente, agoraRef)).toBe(false)

    const jogoAgendado = {
      data: '2026-09-20',
      hora: '16:00',
      status: 'agendado',
      resultado_finalizado: false,
    }
    expect(jogoPontua(jogoAgendado, agoraRef)).toBe(false)
  })

  it('retorna true para jogos passados com resultado_finalizado=true', () => {
    const jogoPassado = {
      data: '2026-09-20',
      hora: '16:00',
      status: 'finalizado',
      resultado_finalizado: true,
    }
    expect(jogoPontua(jogoPassado, agoraRef)).toBe(true)
  })

  it('retorna true para jogos em andamento / ao vivo já iniciados', () => {
    const jogoAoVivo = {
      data: '2026-09-24',
      hora: '11:30', // iniciou há 30 min em relação ao agoraRef
      status: 'ao_vivo',
      resultado_finalizado: false,
    }
    expect(jogoPontua(jogoAoVivo, agoraRef)).toBe(true)
  })

  it('retorna false para jogo ao vivo cujo horário ainda é futuro', () => {
    const jogoBugado = {
      data: '2026-09-24',
      hora: '15:00',
      status: 'ao_vivo',
      resultado_finalizado: false,
    }
    expect(jogoPontua(jogoBugado, agoraRef)).toBe(false)
  })

  it('retorna false para jogo nulo ou indefinido', () => {
    expect(jogoPontua(null, agoraRef)).toBe(false)
    expect(jogoPontua(undefined, agoraRef)).toBe(false)
  })
})
