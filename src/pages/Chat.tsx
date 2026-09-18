import React, { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Sparkles, Loader2, BookOpen, AlertCircle } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { streamAgentChat, type AgentCitation, type DisplayMessage } from '@/lib/skipAi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: AgentCitation[]
  created?: string
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Olá! Eu sou o Assistente do Bolão do Grupo. Posso tirar dúvidas sobre as regras de pontuação oficiais, ranking atual, jogos cadastrados e palpites. Em que posso te ajudar hoje?',
      created: new Date().toISOString(),
    },
  ])
  const [inputMessage, setInputMessage] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [citations, setCitations] = useState<AgentCitation[] | undefined>(undefined)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming])

  const starterChips = [
    'Como funciona a pontuação?',
    'Quem lidera a classificação?',
    'Quais são as regras para gols de jogadores?',
    'Quantos pontos vale o placar exato?',
  ]

  const handleSend = async (messageText?: string) => {
    const textToSend = (messageText || inputMessage).trim()
    if (!textToSend || isStreaming) return

    setInputMessage('')

    // Append user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      created: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMsg])
    setIsStreaming(true)
    setCitations(undefined)

    // Placeholder assistant message for streaming
    const assistantMsgId = `assistant-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        created: new Date().toISOString(),
      },
    ])

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch(`${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: pb.authStore.token,
        },
        body: JSON.stringify({
          message: textToSend,
          conversation_id: conversationId,
        }),
        signal: controller.signal,
      })

      let streamedText = ''
      const streamResult = await streamAgentChat(res, {
        onChunk: (_delta, full) => {
          streamedText = full
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: full } : m)),
          )
        },
        onCitations: (items) => {
          setCitations(items)
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, citations: items } : m)),
          )
        },
        signal: controller.signal,
      })

      const newConvId = res.headers.get('X-Conversation-Id') || streamResult.conversation_id
      if (newConvId) {
        setConversationId(newConvId)
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: streamResult.content || streamedText,
                citations: streamResult.citations,
              }
            : m,
        ),
      )
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return
      console.error('Erro no chat com o assistente:', err)
      const errorMsg =
        err instanceof Error ? err.message : 'Não foi possível obter resposta no momento.'

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content:
                  'Desculpe, ocorreu uma instabilidade temporária ao consultar o banco de dados. Por favor, tente novamente.',
              }
            : m,
        ),
      )
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-[14px] border border-[#E2E8F0] bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-100 p-2 text-[#10B981]">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Assistente do Bolão</h1>
            <p className="text-xs text-[#64748B]">
              Tire dúvidas sobre regras de pontuação, classificações e palpites oficiais.
            </p>
          </div>
        </div>

        <Badge
          variant="outline"
          className="border-emerald-300 bg-emerald-50 text-[11px] text-emerald-800"
        >
          <Sparkles className="mr-1 h-3 w-3 text-emerald-600" /> IA Ativa
        </Badge>
      </div>

      {/* Chat messages viewport */}
      <Card className="flex flex-1 flex-col overflow-hidden rounded-[14px] border-[#E2E8F0] bg-white shadow-xs">
        {/* Suggested Starter Chips */}
        <div className="border-b border-slate-100 bg-slate-50/70 p-3">
          <p className="mb-2 text-[11px] font-semibold text-slate-500">Perguntas sugeridas:</p>
          <div className="flex flex-wrap gap-2">
            {starterChips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isStreaming}
                onClick={() => handleSend(chip)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:border-[#10B981] hover:bg-emerald-50/40 hover:text-emerald-800 disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Messages scroll area */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.map((msg) => {
            const isUser = msg.role === 'user'

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#10B981] shadow-2xs">
                    <Bot className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-xs leading-relaxed shadow-2xs ${
                    isUser
                      ? 'bg-[#0F2A43] text-white rounded-br-xs'
                      : 'bg-[#F8FAFC] text-[#0F172A] border border-[#E2E8F0] rounded-bl-xs'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Cursor animation while streaming */}
                  {!isUser && isStreaming && msg.id === messages[messages.length - 1]?.id && (
                    <span className="inline-block h-3 w-1.5 animate-pulse bg-emerald-600 ml-1" />
                  )}

                  {/* Citations chip */}
                  {!isUser && msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 border-t border-slate-200/80 pt-2 text-[10px] text-slate-500">
                      <div className="flex items-center gap-1 font-semibold text-slate-600 mb-1">
                        <BookOpen className="h-3 w-3 text-emerald-600" />
                        <span>Fontes consultadas:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.map((c, i) => (
                          <span
                            key={i}
                            className="inline-block rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-600"
                            title={c.excerpt}
                          >
                            Fonte [{c.n || i + 1}]
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0F2A43] text-white shadow-2xs">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="border-t border-[#E2E8F0] bg-white p-3 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex items-center gap-2"
          >
            <Input
              placeholder="Digite sua dúvida sobre o bolão..."
              value={inputMessage}
              disabled={isStreaming}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-11 border-[#CBD5E1] text-xs focus-visible:border-[#10B981] focus-visible:ring-[#10B981]"
            />
            <Button
              type="submit"
              disabled={isStreaming || !inputMessage.trim()}
              className="h-11 rounded-lg bg-[#0F2A43] px-5 font-bold text-white shadow-xs hover:bg-[#1B3A5C] disabled:opacity-50"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}
