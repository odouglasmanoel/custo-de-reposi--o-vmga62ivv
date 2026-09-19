import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ClientResponseError)) return {}
  const data = error.response?.data
  if (!data || typeof data !== 'object') return {}
  const errors: FieldErrors = {}
  for (const [field, detail] of Object.entries(data)) {
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof (detail as { message: unknown }).message === 'string'
    ) {
      errors[field] = (detail as { message: string }).message
    }
  }
  return errors
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error
      ? error.message
      : 'Ocorreu um erro inesperado ao comunicar com o servidor.'
  }
  const fieldErrors = extractFieldErrors(error)
  const fieldKeys = Object.keys(fieldErrors)
  if (fieldKeys.length > 0) {
    const fieldTranslations: Record<string, string> = {
      bolao: 'Bolão/Competição',
      time_a: 'Time A (Mandante)',
      time_b: 'Time B (Visitante)',
      competicao: 'Competição',
      fixture_id: 'ID da Partida (Fixture)',
      data: 'Data do Jogo',
      hora: 'Hora do Jogo',
      placar_a: 'Placar Time A',
      placar_b: 'Placar Time B',
      resultado_finalizado: 'Resultado Finalizado',
      tem_penaltis: 'Disputa de Pênaltis',
      vencedor_penaltis: 'Vencedor dos Pênaltis',
      gols_time_a: 'Gols Time A',
      gols_time_b: 'Gols Time B',
    }
    const descriptions = fieldKeys.map((field) => {
      const label = fieldTranslations[field] || field
      const msg = fieldErrors[field]
      return `${label}: ${msg}`
    })
    return `Campos inválidos: ${descriptions.join('; ')}`
  }

  // Tratamento de mensagens genéricas do PocketBase
  if (error.message === 'Failed to create record.') {
    if (error.status === 403 || error.status === 401) {
      return 'Permissão negada para cadastrar a partida. Certifique-se de estar logado como Administrador.'
    }
    return 'Falha ao salvar a partida no banco de dados. Verifique os dados preenchidos.'
  }

  if (error.status === 400) {
    return error.message || 'Requisição inválida. Verifique o formulário.'
  }
  if (error.status === 403) {
    return 'Acesso não autorizado. Apenas o administrador pode realizar esta alteração.'
  }
  if (error.status === 404) {
    return 'Registro ou recurso não encontrado.'
  }

  return error.message || 'Ocorreu um erro inesperado ao salvar os dados.'
}
