/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    $ai.agents.define(app, {
      slug: 'assistente-do-bolao',
      name: 'Assistente do Bolão',
      description:
        'Tire dúvidas sobre regras de pontuação, classificações e palpites do Bolão do Grupo.',
      systemPrompt:
        'Você é o Assistente oficial do Bolão do Grupo da Repress. Responda sempre em português do Brasil (pt-BR) de forma amigável, clara e concisa. Você responde estritamente a perguntas sobre o Bolão (regras de pontuação, jogos cadastrados, placares, classificação dos participantes, palpites e estatísticas). Se o usuário perguntar algo fora desse escopo, recuse educadamente explicando seu propósito.',
      tier: 'fast',
      tools: [
        { collection: 'jogos', perms: { list: true, read: true } },
        { collection: 'palpites', perms: { list: true, read: true } },
        { collection: 'participantes', perms: { list: true, read: true } },
        { collection: 'boloes', perms: { list: true, read: true } },
        { collection: 'regras', perms: { list: true, read: true } },
      ],
      memory: [
        {
          type: 'faq',
          payload: {
            qa: [
              {
                question: 'Quantos pontos dá o placar exato?',
                answer: 'Cravar o placar exato concede 8 pontos.',
              },
              {
                question: 'Como funciona a pontuação por vencedor e empate?',
                answer: 'Acertar o vencedor ou empate (mas não o placar exato) vale 2 pontos.',
              },
              {
                question: 'Quantos pontos vale a diferença de gols e metade do placar?',
                answer:
                  'Acertar a diferença de gols adiciona +1 ponto. Acertar a quantidade exata de gols de um dos times (metade do placar) também adiciona +1 ponto.',
              },
              {
                question: 'Quantos pontos dão os gols dos jogadores?',
                answer:
                  'Gol de atacante ou meia vale +1 ponto por gol acertado; gol de zagueiro ou lateral vale +3 pontos; gol de goleiro vale +10 pontos; gol contra (acertando o jogador) vale +5 pontos.',
              },
              {
                question: 'Quantos pontos vale acertar o vencedor nos pênaltis?',
                answer: 'Acertar o vencedor na disputa por pênaltis concede +2 pontos.',
              },
              {
                question: 'Quem são os participantes do Bolão?',
                answer: 'Os participantes são Douglas (Administrador), Gabriel, Bruno e Davi.',
              },
            ],
          },
        },
        {
          type: 'text',
          payload: {
            text: 'Regras de Pontuação Oficiais: Placar Exato = 8 pts; Vencedor ou Empate = 2 pts; Diferença de Gols = +1 pt; Metade do Placar = +1 pt; Gol Atacante/Meia = +1 pt; Gol Zagueiro/Lateral = +3 pts; Gol Goleiro = +10 pts; Gol Contra = +5 pts; Pênaltis = +2 pts.',
          },
        },
      ],
    })
  },
  (app) => {
    $ai.agents.delete(app, 'assistente-do-bolao')
  },
)
