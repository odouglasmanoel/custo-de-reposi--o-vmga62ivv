/**
 * Utilitários para normalização de login/e-mail no app.
 *
 * A collection `users` do PocketBase requer o campo de e-mail institucional.
 * Os usuários autorizados do bolão podem entrar utilizando apenas o identificador
 * de usuário simples (ex.: "brunol", "brunox", "gabriel", "davi"), que é automaticamente
 * transformado para o domínio institucional "@repress.com.br".
 *
 * Caso o usuário digite o e-mail completo com "@" (ex.: Douglas com "douglas.manoel@repress.com.br"),
 * o formato é preservado, aplicando apenas trim e lowercase na parte local antes do "@"
 * para evitar falhas por maiúsculas ou espaços acidentais.
 */

export const REPRESS_EMAIL_DOMAIN = '@repress.com.br'

/**
 * Normaliza o login/e-mail digitado pelo usuário:
 * - Se não contém "@": aplica trim(), lowercase() e concatena "@repress.com.br"
 * - Se contém "@": divide em local e domínio, aplica trim() e lowercase() na parte local,
 *   preserva/normaliza o domínio em lowercase com trim() seguro.
 */
export function normalizarLogin(input: string): string {
  const trimmed = (input || '').trim()
  if (!trimmed) {
    return ''
  }

  const atIndex = trimmed.indexOf('@')
  if (atIndex === -1) {
    // Apenas login simples (ex.: "brunol" -> "brunol@repress.com.br")
    return `${trimmed.toLowerCase()}${REPRESS_EMAIL_DOMAIN}`
  }

  const localPart = trimmed.slice(0, atIndex).trim().toLowerCase()
  const domainPart = trimmed
    .slice(atIndex + 1)
    .trim()
    .toLowerCase()

  if (!domainPart) {
    // Caso especial defensivo: usuário digitou algo como "brunol@"
    return `${localPart}${REPRESS_EMAIL_DOMAIN}`
  }

  return `${localPart}@${domainPart}`
}
