migrate(
  (app) => {
    // Bcrypt hash de "123456" ($2a$10$trT3.R/Nfey62eczbKEnueTcIbJXW.u1ffAo/XfyLpofwNDbEB86O)
    const BCRYPT_123456 = '$2a$10$trT3.R/Nfey62eczbKEnueTcIbJXW.u1ffAo/XfyLpofwNDbEB86O'

    // 1. Atualizar ou garantir usuário Douglas Manoel (Admin)
    // O usuário admin anterior era douglas@repress.com.br; o correto passa a ser douglas.manoel@repress.com.br
    let douglasUser = null

    try {
      douglasUser = app.findAuthRecordByEmail('_pb_users_auth_', 'douglas.manoel@repress.com.br')
    } catch (_) {}

    if (!douglasUser) {
      try {
        douglasUser = app.findAuthRecordByEmail('_pb_users_auth_', 'douglas@repress.com.br')
        if (douglasUser) {
          douglasUser.setEmail('douglas.manoel@repress.com.br')
        }
      } catch (_) {}
    }

    if (douglasUser) {
      douglasUser.setEmail('douglas.manoel@repress.com.br')
      douglasUser.setVerified(true)
      douglasUser.set('name', 'Douglas')
      app.save(douglasUser)
    } else {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      const newDouglas = new Record(usersCol)
      newDouglas.setEmail('douglas.manoel@repress.com.br')
      newDouglas.setPassword('Skip@2026')
      newDouglas.setVerified(true)
      newDouglas.set('name', 'Douglas')
      app.save(newDouglas)
    }

    // 2. Garantir os outros 3 membros do bolão
    const members = [
      { email: 'gabriel@repress.com.br', name: 'Gabriel' },
      { email: 'davi@repress.com.br', name: 'Davi' },
      { email: 'bruno@repress.com.br', name: 'Bruno' },
    ]

    for (const m of members) {
      let rec = null
      try {
        rec = app.findAuthRecordByEmail('_pb_users_auth_', m.email)
      } catch (_) {}

      if (rec) {
        rec.setVerified(true)
        rec.set('name', m.name)
        app.save(rec)
      } else {
        const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
        const newRec = new Record(usersCol)
        newRec.setEmail(m.email)
        newRec.setPassword('Skip@2026')
        newRec.setVerified(true)
        newRec.set('name', m.name)
        app.save(newRec)
      }
    }

    // 3. Atualizar diretamente a coluna password no SQLite com o hash bcrypt de "123456"
    // para todos os 4 usuários do bolão
    app
      .db()
      .newQuery(
        'UPDATE users SET password = {:hash} WHERE email IN (' +
          "'douglas.manoel@repress.com.br', 'gabriel@repress.com.br', 'davi@repress.com.br', 'bruno@repress.com.br'" +
          ')',
      )
      .bind({ hash: BCRYPT_123456 })
      .execute()

    // 4. Remover usuários que não pertençam aos 4 usuários oficiais do bolão
    const allowedEmails = [
      'douglas.manoel@repress.com.br',
      'gabriel@repress.com.br',
      'davi@repress.com.br',
      'bruno@repress.com.br',
    ]

    const allUsers = app.findRecordsByFilter('_pb_users_auth_', '', '', 100, 0)
    for (const u of allUsers) {
      const email = (u.getString('email') || '').toLowerCase().trim()
      if (!allowedEmails.includes(email)) {
        try {
          app.delete(u)
        } catch (err) {
          console.log('Não foi possível remover usuário extra ' + email + ': ' + err)
        }
      }
    }
  },
  (app) => {
    // down migration
  },
)
