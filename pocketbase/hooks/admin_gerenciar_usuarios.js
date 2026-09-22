// Endpoint seguro para gestão completa de participantes e usuários pelo Administrador (Douglas).
// Permite listar usuários auth cadastrados, editar nome, username/email e resetar senha,
// além de remover/desativar usuário com segurança.
//
// REGRAS GOJA / POCKETBASE:
// - Variáveis e helpers inline dentro do callback
// - NENHUM spread ({ ...obj }) nem funções transpiladas globais
// - Atribuição direta de propriedades

routerAdd('POST', '/backend/v1/admin/gerenciar-usuarios', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Acesso não autenticado')
    }

    const authName = (authRecord.getString('name') || '').trim()
    const authEmail = (authRecord.getString('email') || '').trim().toLowerCase()
    const isAdmin =
      authName.toLowerCase() === 'douglas' ||
      authEmail === 'douglas@repress.com.br' ||
      authEmail === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.forbiddenError('Apenas o Administrador pode acessar esta funcionalidade.')
    }

    const body = e.requestInfo().body || {}
    const action = body.action || 'list'

    // 1. LISTAR TODOS OS USUÁRIOS
    if (action === 'list') {
      const allUsers = $app.findRecordsByFilter('users', '', '-created', 200, 0)
      const sanitized = []
      for (let i = 0; i < allUsers.length; i++) {
        const u = allUsers[i]
        const email = u.getString('email') || ''
        let username = email
        if (email.indexOf('@') !== -1) {
          username = email.split('@')[0]
        }
        sanitized.push({
          id: u.id,
          name: u.getString('name') || '',
          email: email,
          username: username,
          verified: u.getBool('verified'),
          created: u.getString('created'),
          updated: u.getString('updated'),
        })
      }
      return e.json(200, { success: true, users: sanitized })
    }

    // 2. ATUALIZAR USUÁRIO (Nome, Username/Email, Nova Senha opcional)
    if (action === 'update_user') {
      const targetUserId = (body.user_id || '').trim()
      const newName = (body.name || '').trim()
      let newUsername = (body.username || '').trim().toLowerCase()
      const newPassword = (body.password || '').trim()

      if (!targetUserId) {
        return e.badRequestError('ID do usuário é obrigatório.')
      }

      let userRec = null
      try {
        userRec = $app.findRecordById('users', targetUserId)
      } catch (_) {
        return e.notFoundError('Usuário não encontrado.')
      }

      const oldName = (userRec.getString('name') || '').trim()
      const oldEmail = (userRec.getString('email') || '').trim().toLowerCase()

      // Tratar username -> email com @repress.com.br se não tiver @
      if (newUsername) {
        if (newUsername.indexOf('@') === -1) {
          newUsername = newUsername + '@repress.com.br'
        }
        // Validar unicidade se o email foi alterado
        if (newUsername !== oldEmail) {
          try {
            const existingWithEmail = $app.findAuthRecordByEmail('users', newUsername)
            if (existingWithEmail && existingWithEmail.id !== targetUserId) {
              return e.badRequestError(
                'O username/e-mail informado já está em uso por outro usuário.',
              )
            }
          } catch (_) {
            // Não existe outro com este email, pode prosseguir
          }
          userRec.setEmail(newUsername)
        }
      }

      if (newName) {
        userRec.set('name', newName)
      }

      if (newPassword) {
        if (newPassword.length < 4) {
          return e.badRequestError('A nova senha deve ter no mínimo 4 caracteres.')
        }
        userRec.setPassword(newPassword)
      }

      $app.save(userRec)

      // Se o nome foi alterado, atualizar em cascata na collection 'participantes'
      // para manter a coerência das tabelas e estatísticas
      let participantesAtualizados = 0
      if (newName && newName !== oldName) {
        try {
          const partsToUpdate = $app.findRecordsByFilter(
            'participantes',
            "nome = '" + oldName.replace(/'/g, "''") + "'",
            '',
            200,
            0,
          )
          for (let p = 0; p < partsToUpdate.length; p++) {
            const pr = partsToUpdate[p]
            pr.set('nome', newName)
            $app.save(pr)
            participantesAtualizados++
          }
        } catch (pErr) {
          console.log('[admin_gerenciar_usuarios] Erro ao sincronizar participantes:', pErr)
        }

        // Também atualizar enquete_votos se houver
        try {
          const votos = $app.findRecordsByFilter(
            'enquete_votos',
            "user = '" + targetUserId + "' || user_name = '" + oldName.replace(/'/g, "''") + "'",
            '',
            500,
            0,
          )
          for (let v = 0; v < votos.length; v++) {
            const vr = votos[v]
            vr.set('user_name', newName)
            $app.save(vr)
          }
        } catch (_) {}
      }

      const updatedEmail = userRec.getString('email') || ''
      let updatedUsername = updatedEmail
      if (updatedEmail.indexOf('@') !== -1) {
        updatedUsername = updatedEmail.split('@')[0]
      }

      return e.json(200, {
        success: true,
        message: 'Usuário atualizado com sucesso!',
        user: {
          id: userRec.id,
          name: userRec.getString('name') || '',
          email: updatedEmail,
          username: updatedUsername,
          participantesAtualizados: participantesAtualizados,
        },
      })
    }

    // 3. REMOVER OU DESATIVAR USUÁRIO / PARTICIPANTE
    if (action === 'delete_user' || action === 'desativar_user') {
      const targetUserId = (body.user_id || '').trim()
      const participantName = (body.participant_name || '').trim()
      const removeParticipantes = body.remover_participantes === true

      if (!targetUserId && !participantName) {
        return e.badRequestError('Informe o ID do usuário ou o nome do participante.')
      }

      // Proteção: não permitir remover o próprio Douglas
      if (targetUserId === authRecord.id) {
        return e.badRequestError('O Administrador principal (Douglas) não pode ser removido.')
      }

      let removedUserName = participantName
      if (targetUserId) {
        try {
          const targetUser = $app.findRecordById('users', targetUserId)
          const targetEmail = (targetUser.getString('email') || '').toLowerCase().trim()
          const targetName = (targetUser.getString('name') || '').toLowerCase().trim()
          if (
            targetName === 'douglas' ||
            targetEmail === 'douglas@repress.com.br' ||
            targetEmail === 'douglas.manoel@repress.com.br'
          ) {
            return e.badRequestError('O Administrador principal (Douglas) não pode ser removido.')
          }
          removedUserName = targetUser.getString('name') || participantName
          $app.delete(targetUser)
        } catch (uErr) {
          console.log('[admin_gerenciar_usuarios] Erro ao deletar usuário:', uErr)
        }
      }

      // Se solicitado, remover vínculos de participantes com todos os bolões
      let deletedPartsCount = 0
      if (removeParticipantes && removedUserName) {
        try {
          const parts = $app.findRecordsByFilter(
            'participantes',
            "nome = '" + removedUserName.replace(/'/g, "''") + "'",
            '',
            100,
            0,
          )
          for (let p = 0; p < parts.length; p++) {
            $app.delete(parts[p])
            deletedPartsCount++
          }
        } catch (pDelErr) {
          console.log('[admin_gerenciar_usuarios] Erro ao deletar participantes:', pDelErr)
        }
      }

      return e.json(200, {
        success: true,
        message: 'Usuário removido/desativado com sucesso.',
        participantesRemovidos: deletedPartsCount,
      })
    }

    // 4. CRIAR NOVO USUÁRIO COM LOGIN E SENHA
    if (action === 'create_user') {
      const name = (body.name || '').trim()
      let username = (body.username || '').trim().toLowerCase()
      const password = (body.password || '').trim()

      if (!name) {
        return e.badRequestError('Nome do participante é obrigatório.')
      }
      if (!username) {
        return e.badRequestError('Login / username é obrigatório.')
      }
      if (!password || password.length < 4) {
        return e.badRequestError('A senha inicial deve ter no mínimo 4 caracteres.')
      }

      if (username.indexOf('@') === -1) {
        username = username + '@repress.com.br'
      }

      try {
        const existing = $app.findAuthRecordByEmail('users', username)
        if (existing) {
          return e.badRequestError('Já existe um usuário com este login/e-mail.')
        }
      } catch (_) {}

      const usersCol = $app.findCollectionByNameOrId('users')
      const newRec = new Record(usersCol)
      newRec.setEmail(username)
      newRec.setPassword(password)
      newRec.setVerified(true)
      newRec.set('name', name)
      $app.save(newRec)

      return e.json(200, {
        success: true,
        message: 'Usuário de login criado com sucesso!',
        user: {
          id: newRec.id,
          name: name,
          email: username,
          username: username.split('@')[0],
        },
      })
    }

    return e.badRequestError('Ação desconhecida.')
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro interno ao processar operação administrativa.',
    })
  }
})
