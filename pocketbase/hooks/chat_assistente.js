routerAdd(
  'POST',
  '/backend/v1/chat',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const userId = e.auth ? e.auth.id : null
      if (!userId) {
        return e.unauthorizedError('Autenticação necessária')
      }

      if (!body.message || !body.message.trim()) {
        return e.badRequestError('A mensagem é obrigatória')
      }

      const conv = $ai.agent('assistente-do-bolao').getOrCreateConversation({
        user_id: userId,
        id: body.conversation_id || null,
      })

      const iter = $ai.agent('assistente-do-bolao').chat({
        user_id: userId,
        conversation_id: conv.id,
        message: body.message,
        stream: true,
      })

      e.response.header().set('Content-Type', 'text/event-stream')
      e.response.header().set('Cache-Control', 'no-cache')
      e.response.header().set('X-Conversation-Id', conv.id)

      return $response.stream(e, iter)
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'Serviço de IA temporariamente indisponível' })
      }
      if (err instanceof SkipAiAgentsError) {
        const status = err.status || 500
        return e.json(status, { error: status >= 500 ? 'Falha no agente de IA' : err.message })
      }
      if (err instanceof SkipAiError) {
        const status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'IA temporariamente indisponível' : err.message,
        })
      }
      return e.json(500, { error: err ? err.message : 'Erro interno ao processar chat' })
    }
  },
  $apis.requireAuth(),
)

routerAdd(
  'GET',
  '/backend/v1/chat/messages',
  (e) => {
    try {
      const userId = e.auth ? e.auth.id : null
      if (!userId) return e.unauthorizedError('Autenticação necessária')
      const conversationId = e.requestInfo().query?.conversation_id
      if (!conversationId) return e.badRequestError('conversation_id é obrigatório')

      const result = $ai.agent('assistente-do-bolao').listMessages({
        conversation_id: conversationId,
        user_id: userId,
        limit: 50,
      })

      return e.json(200, result)
    } catch (err) {
      return e.json(500, { error: err ? err.message : 'Erro ao carregar mensagens' })
    }
  },
  $apis.requireAuth(),
)
