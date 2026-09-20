/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users')
  const participantesCollection = app.findCollectionByNameOrId('participantes')
  const palpitesCollection = app.findCollectionByNameOrId('palpites')

  // 1. Atualizar Bruno antigo (id 4ps5aojl228n7th ou busca por e-mail bruno@repress.com.br / brunol@repress.com.br)
  let userBruno = null
  try {
    userBruno = app.findRecordById('users', '4ps5aojl228n7th')
  } catch {
    try {
      userBruno = app.findAuthRecordByEmail('users', 'bruno@repress.com.br')
    } catch {
      try {
        userBruno = app.findAuthRecordByEmail('users', 'brunol@repress.com.br')
      } catch {
        userBruno = null
      }
    }
  }

  if (userBruno) {
    userBruno.set('email', 'brunol@repress.com.br')
    userBruno.set('name', 'Bruno Lopes')
    userBruno.set('password', '123456')
    userBruno.set('verified', true)
    app.save(userBruno)
  }

  // 2. Criar ou atualizar usuário 'Bruno Xavier' (brunox@repress.com.br)
  let userBrunox = null
  try {
    userBrunox = app.findAuthRecordByEmail('users', 'brunox@repress.com.br')
  } catch {
    userBrunox = null
  }

  if (!userBrunox) {
    userBrunox = new Record(usersCollection)
    userBrunox.set('email', 'brunox@repress.com.br')
    userBrunox.set('name', 'Bruno Xavier')
    userBrunox.set('password', '123456')
    userBrunox.set('verified', true)
    app.save(userBrunox)
  } else {
    userBrunox.set('name', 'Bruno Xavier')
    userBrunox.set('password', '123456')
    userBrunox.set('verified', true)
    app.save(userBrunox)
  }

  // 3. Renomear todos os registros de participantes "Bruno" para "Bruno Lopes" em todos os bolões
  const allParticipantes = app.findAllRecords('participantes')
  for (let i = 0; i < allParticipantes.length; i++) {
    const p = allParticipantes[i]
    const pNome = (p.get('nome') || '').trim()
    if (pNome === 'Bruno') {
      p.set('nome', 'Bruno Lopes')
      app.save(p)
    }
  }

  // 4. Criar participante "Bruno Xavier" nos 3 bolões ativos (Copa Coni, Copa Genilton, Copa Sormani)
  // IDs dos 3 bolões ativos:
  // - kr20rfjisajd6ro (Copa Coni)
  // - qdpy2honwivb5zw (Copa Genilton)
  // - xdtvijyapxuw99y (Copa Sormani)
  // NÃO criar na Copa do Mundo (hy6ade9obylh404).
  const bolaoIdsAtivos = ['kr20rfjisajd6ro', 'qdpy2honwivb5zw', 'xdtvijyapxuw99y']
  const partBrunoxMap = {}

  for (let b = 0; b < bolaoIdsAtivos.length; b++) {
    const bId = bolaoIdsAtivos[b]
    // Verificar se já existe participante Bruno Xavier neste bolão
    let found = null
    try {
      const partsInBolao = app.findRecordsByFilter(
        'participantes',
        `bolao = '${bId}' && (nome = 'Bruno Xavier' || nome = 'brunox')`,
        '',
        1,
        0,
      )
      if (partsInBolao && partsInBolao.length > 0) {
        found = partsInBolao[0]
      }
    } catch {
      found = null
    }

    if (!found) {
      const newPart = new Record(participantesCollection)
      newPart.set('bolao', bId)
      newPart.set('nome', 'Bruno Xavier')
      newPart.set('pontos_importados', 0)
      newPart.set('pontuacao_total', 0)
      app.save(newPart)
      partBrunoxMap[bId] = newPart
    } else {
      partBrunoxMap[bId] = found
    }
  }

  // 5. Reatribuir os 4 palpites de hoje (2026-09-20) do participante Bruno Lopes (c1a3v87mi2v8iiy)
  // para o novo participante Bruno Xavier da Copa Coni (kr20rfjisajd6ro).
  // Palpites:
  // - t2jnr96c7jrt0ih (jogo pl5z08b8tupuewg)
  // - gqebno808bunxf9 (jogo ynbuwlk0600nwlf)
  // - bc11izigtllhdr2 (jogo pfliz8m05oqef6s)
  // - l1t2gdg9d46zasy (jogo p7rcfl1xoatr7qu)
  const palpiteIdsHoje = [
    't2jnr96c7jrt0ih',
    'gqebno808bunxf9',
    'bc11izigtllhdr2',
    'l1t2gdg9d46zasy',
  ]

  const partBrunoxConi = partBrunoxMap['kr20rfjisajd6ro']
  if (partBrunoxConi) {
    let pontosTransferidos = 0
    for (let pIdx = 0; pIdx < palpiteIdsHoje.length; pIdx++) {
      const pid = palpiteIdsHoje[pIdx]
      try {
        const palpite = app.findRecordById('palpites', pid)
        if (palpite) {
          palpite.set('participante', partBrunoxConi.id)
          app.save(palpite)
          pontosTransferidos += Number(palpite.get('pontuacao_jogo') || 0)
        }
      } catch (err) {
        // Ignora se não encontrar
      }
    }

    // Recalcular pontuação total do participante Bruno Lopes na Copa Coni (c1a3v87mi2v8iiy)
    // e do novo participante Bruno Xavier na Copa Coni
    try {
      const partBrunoConi = app.findRecordById('participantes', 'c1a3v87mi2v8iiy')
      if (partBrunoConi) {
        // Somar todos os palpites que permanecem no partBrunoConi
        const palpitesBruno = app.findRecordsByFilter(
          'palpites',
          `participante = '${partBrunoConi.id}'`,
          '',
          500,
          0,
        )
        let somaPtsBruno = 0
        for (let k = 0; k < palpitesBruno.length; k++) {
          somaPtsBruno += Number(palpitesBruno[k].get('pontuacao_jogo') || 0)
        }
        const pontosImportadosBruno = Number(partBrunoConi.get('pontos_importados') || 0)
        partBrunoConi.set('pontuacao_total', pontosImportadosBruno + somaPtsBruno)
        app.save(partBrunoConi)
      }
    } catch (e) {
      // Ignora erro
    }

    try {
      // Somar todos os palpites do Bruno Xavier na Copa Coni
      const palpitesBrunox = app.findRecordsByFilter(
        'palpites',
        `participante = '${partBrunoxConi.id}'`,
        '',
        500,
        0,
      )
      let somaPtsBrunox = 0
      for (let k = 0; k < palpitesBrunox.length; k++) {
        somaPtsBrunox += Number(palpitesBrunox[k].get('pontuacao_jogo') || 0)
      }
      const pontosImportadosBrunox = Number(partBrunoxConi.get('pontos_importados') || 0)
      partBrunoxConi.set('pontuacao_total', pontosImportadosBrunox + somaPtsBrunox)
      app.save(partBrunoxConi)
    } catch (e) {
      // Ignora erro
    }
  }

  // 6. Atualizar enquete_votos se houver algum voto do user Bruno
  try {
    const votosBruno = app.findRecordsByFilter(
      'enquete_votos',
      `user = '${userBruno?.id || '4ps5aojl228n7th'}' || user_name = 'Bruno'`,
      '',
      200,
      0,
    )
    for (let v = 0; v < votosBruno.length; v++) {
      const voto = votosBruno[v]
      voto.set('user_name', 'Bruno Lopes')
      app.save(voto)
    }
  } catch {
    // Tabela pode não ter votos
  }
})
