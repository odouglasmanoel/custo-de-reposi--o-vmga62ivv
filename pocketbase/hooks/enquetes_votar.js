/**
 * Hook dedicado para alternância e registro de votos nas Enquetes.
 * Endpoint: POST /backend/v1/enquetes/votar
 *
 * Utiliza privilégios administrativos via $app para contornar bloqueios de API Rules
 * garantindo:
 * 1. Identificação correta do usuário logado (via token de autenticação e/ou ID informado);
 * 2. Validação se a enquete e o jogo existem e se a enquete está aberta / não expirada;
 * 3. Validação do limite de votos (mínimo de 10 votos permitidos);
 * 4. Alternância atômica (se já votou, remove o voto; se não votou, insere);
 * 5. Respostas claras em JSON com mensagens detalhadas em caso de erro;
 * 6. Retorno de estado completo: { success, voted, totalVotosUsuario, totalVotosJogo, limiteVotos }.
 */

routerAdd(
  'POST',
  '/backend/v1/enquetes/votar',
  (e) => {
    try {
      const authRecord = e.auth
      const body = e.requestInfo().body || {}

      const enqueteId = (body.enquete_id || body.enquete || '').trim()
      const jogoId = (body.jogo_id || body.jogo || '').trim()
      const limiteParam = parseInt(body.limite_votos || body.limite || '10', 10) || 10
      const limiteVotos = Math.max(10, limiteParam)

      // 1. Verificação de autenticação
      let userId = authRecord ? authRecord.id : ''
      let userName = authRecord
        ? (authRecord.getString('name') || authRecord.getString('username') || '').trim()
        : ''

      // Se não veio no token diretamente, mas veio no body do request autenticado
      if (!userId && body.user_id) {
        userId = String(body.user_id).trim()
      }

      if (!userId) {
        return e.json(401, {
          success: false,
          error:
            'Você precisa estar logado para votar na enquete. Faça login no sistema e tente novamente.',
          code: 'UNAUTHENTICATED',
        })
      }

      // Se ainda não temos o userName, busca o registro do usuário
      if (!userName) {
        try {
          const userRec = $app.findRecordById('users', userId)
          if (userRec) {
            userName = (userRec.getString('name') || userRec.getString('username') || '').trim()
          }
        } catch (_) {}
      }
      if (!userName) {
        userName = 'Participante'
      }

      // 2. Validação dos IDs obrigatórios
      if (!enqueteId) {
        return e.json(400, {
          success: false,
          error: 'ID da enquete (enquete_id) não foi informado na requisição.',
        })
      }
      if (!jogoId) {
        return e.json(400, {
          success: false,
          error: 'ID do confronto (jogo_id) não foi informado na requisição.',
        })
      }

      // 3. Busca e validação da Enquete
      let enqueteRec = null
      try {
        enqueteRec = $app.findRecordById('enquetes', enqueteId)
      } catch (_) {
        return e.json(404, {
          success: false,
          error:
            'Enquete não encontrada no sistema. Atualize a página e selecione uma enquete válida.',
        })
      }

      const enqueteStatus = (enqueteRec.getString('status') || '').trim().toLowerCase()
      if (enqueteStatus !== 'aberta') {
        const statusLabel =
          enqueteStatus === 'cadastrada' ? 'já foi cadastrada na Copa Coni' : 'está encerrada'
        return e.json(400, {
          success: false,
          error: `Esta enquete ${statusLabel} e não aceita mais novos votos.`,
        })
      }

      // 4. Verificação de encerramento por prazo limite (data_limite_votacao / data_fim)
      const dataLimiteStr = (enqueteRec.getString('data_limite_votacao') || '').trim()
      const dataFimStr = (enqueteRec.getString('data_fim') || '').trim()

      if (dataLimiteStr || dataFimStr) {
        try {
          var targetDateStr = dataLimiteStr || (dataFimStr ? dataFimStr + 'T23:59:59' : '')
          if (targetDateStr) {
            // Verifica prazo considerando horário de Brasília (UTC-3)
            var clean = targetDateStr.replace(' ', 'T')
            var isoString = clean
            if (clean.indexOf('Z') === -1 && !/[+-]\d{2}:\d{2}$/.test(clean)) {
              if (clean.length === 10) clean += 'T23:59:59'
              isoString = clean + '-03:00'
            }
            var deadlineMs = new Date(isoString).getTime()
            if (!isNaN(deadlineMs) && Date.now() >= deadlineMs) {
              return e.json(400, {
                success: false,
                error: 'O prazo limite para votação desta enquete já expirou.',
              })
            }
          }
        } catch (_) {}
      }

      // 5. Busca e validação do Jogo
      let jogoRec = null
      try {
        jogoRec = $app.findRecordById('enquete_jogos', jogoId)
      } catch (_) {
        return e.json(404, {
          success: false,
          error:
            'Confronto não encontrado na enquete. A lista pode ter sido atualizada pelo administrador.',
        })
      }

      const jogoEnqueteId = jogoRec.getString('enquete')
      if (jogoEnqueteId && jogoEnqueteId !== enqueteId) {
        return e.json(400, {
          success: false,
          error: 'O confronto selecionado pertence a uma enquete diferente da ativa.',
        })
      }

      // 6. Busca os votos do usuário nesta enquete
      const meusVotos = $app.findRecordsByFilter(
        'enquete_votos',
        `enquete = '${enqueteId}' && user = '${userId}'`,
        '-created',
        100,
        0,
      )

      // Procura se já votou especificamente neste jogo
      const votoExistente = meusVotos.find((v) => v.getString('jogo') === jogoId)

      let isVoted = false
      let totalVotosUsuario = meusVotos.length

      if (votoExistente) {
        // DESMARCAR VOTO: Deleta o registro existente
        try {
          $app.delete(votoExistente)
          isVoted = false
          totalVotosUsuario = Math.max(0, meusVotos.length - 1)
        } catch (delErr) {
          return e.json(500, {
            success: false,
            error: 'Erro ao remover o voto: ' + (delErr ? delErr.message : 'Falha na deleção'),
          })
        }
      } else {
        // MARCAR VOTO: Verifica trava de limite
        if (meusVotos.length >= limiteVotos) {
          return e.json(400, {
            success: false,
            error: `Limite de ${limiteVotos} votos atingido para esta enquete. Desmarque outro jogo primeiro.`,
          })
        }

        // Cria o registro do voto via $app (bypassa eventuais regras RLS com privilégios de sistema)
        try {
          const colVotos = $app.findCollectionByNameOrId('enquete_votos')
          const novoVoto = new Record(colVotos)
          novoVoto.set('enquete', enqueteId)
          novoVoto.set('jogo', jogoId)
          novoVoto.set('user', userId)
          novoVoto.set('user_name', userName)
          $app.save(novoVoto)

          isVoted = true
          totalVotosUsuario = meusVotos.length + 1
        } catch (saveErr) {
          const saveMsg = saveErr ? saveErr.message : 'Falha ao salvar voto'
          // Se for violação de chave única (já votou concorrentemente)
          if (
            saveMsg.indexOf('UNIQUE') !== -1 ||
            saveMsg.indexOf('idx_enquete_votos_user_jogo') !== -1
          ) {
            return e.json(200, {
              success: true,
              voted: true,
              totalVotosUsuario: meusVotos.length,
              message: 'Voto já registrado anteriormente.',
            })
          }
          return e.json(500, {
            success: false,
            error: 'Erro ao registrar voto: ' + saveMsg,
          })
        }
      }

      // 7. Conta o total atual de votos neste confronto
      let totalVotosJogo = 0
      try {
        const votosJogo = $app.findRecordsByFilter(
          'enquete_votos',
          `jogo = '${jogoId}'`,
          '',
          1000,
          0,
        )
        totalVotosJogo = votosJogo.length
      } catch (_) {}

      return e.json(200, {
        success: true,
        voted: isVoted,
        totalVotosUsuario: totalVotosUsuario,
        totalVotosJogo: totalVotosJogo,
        limiteVotos: limiteVotos,
        message: isVoted ? 'Voto registrado com sucesso!' : 'Voto removido com sucesso!',
      })
    } catch (err) {
      return e.json(500, {
        success: false,
        error: err ? err.message : 'Erro interno ao processar votação.',
      })
    }
  },
  $apis.requireAuth(),
)
