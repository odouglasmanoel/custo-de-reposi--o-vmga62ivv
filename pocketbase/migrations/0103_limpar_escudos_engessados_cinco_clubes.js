// pocketbase/migrations/0103_limpar_escudos_engessados_cinco_clubes.js
// Migration 0103: Limpeza cirúrgica das URLs engessadas dos 5 clubes (Remo, Red Bull Bragantino, Mirassol, Chapecoense, Coritiba)
// nos confrontos de enquete_jogos e jogos para que URLs manuais fornecidas pelo usuário no modal passem a valer
// imediatamente e o pipeline dinâmico possa resolver sem travas antigas.

migrate((app) => {
  console.log('[migration 0103] Iniciando limpeza das URLs engessadas dos 5 clubes...')

  const alvos = [
    {
      nome: 'Coritiba',
      idSports: '132',
      aliases: ['coritiba', 'coritibafbc', 'cfc', 'coxa'],
    },
    {
      nome: 'Chapecoense',
      idSports: '147',
      aliases: ['chapecoense', 'chapecoenseaf', 'chape', 'acf'],
    },
    {
      nome: 'Red Bull Bragantino',
      idSports: '1199',
      aliases: ['redbullbragantino', 'bragantino', 'rbbragantino'],
    },
    {
      nome: 'Mirassol',
      idSports: '10214',
      aliases: ['mirassol', 'mirassolfc'],
    },
    {
      nome: 'Remo',
      idSports: '10213',
      aliases: ['remo', 'clubedoremo'],
    },
  ]

  function normalizar(nome) {
    if (!nome) return ''
    var s = String(nome).toLowerCase().trim()
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    } catch (_) {}
    return s.replace(/[^a-z0-9]/g, '')
  }

  function matchClube(nomeTime) {
    var key = normalizar(nomeTime)
    if (!key) return null
    for (var i = 0; i < alvos.length; i++) {
      var c = alvos[i]
      for (var j = 0; j < c.aliases.length; j++) {
        var alias = c.aliases[j]
        if (key === alias || key.indexOf(alias) !== -1) {
          return c
        }
      }
    }
    return null
  }

  // 1. enquete_jogos
  var enqueteJogosLimpos = 0
  var enqueteJogos = app.findRecordsByFilter('enquete_jogos', '', '-created', 500, 0)
  for (var i = 0; i < enqueteJogos.length; i++) {
    var rec = enqueteJogos[i]
    var alterou = false
    var tA = rec.getString('time_a') || ''
    var tB = rec.getString('time_b') || ''
    var lCasa = rec.getString('logo_casa') || ''
    var lVis = rec.getString('logo_visitante') || ''

    var mCasa = matchClube(tA)
    var mVis = matchClube(tB)

    // Se o time for um dos 5 clubes e a URL for a engessada antiga (api-sports correspondente)
    // limpa para que o admin possa cadastrar livremente ou o pipeline re-resolva
    if (mCasa && lCasa && lCasa.indexOf('/teams/' + mCasa.idSports + '.') !== -1) {
      rec.set('logo_casa', '')
      alterou = true
    }
    if (mVis && lVis && lVis.indexOf('/teams/' + mVis.idSports + '.') !== -1) {
      rec.set('logo_visitante', '')
      alterou = true
    }

    if (alterou) {
      app.save(rec)
      enqueteJogosLimpos++
      console.log('[migration 0103] enquete_jogos ' + rec.id + ' (' + tA + ' x ' + tB + ') destravado com sucesso.')
    }
  }

  // 2. jogos
  var jogosLimpos = 0
  var jogos = app.findRecordsByFilter('jogos', '', '-created', 500, 0)
  for (var k = 0; k < jogos.length; k++) {
    var jRec = jogos[k]
    var jAlterou = false
    var jtA = jRec.getString('time_a') || ''
    var jtB = jRec.getString('time_b') || ''
    var escA = jRec.getString('url_escudo_mandante') || ''
    var escB = jRec.getString('url_escudo_visitante') || ''

    var jmCasa = matchClube(jtA)
    var jmVis = matchClube(jtB)

    if (jmCasa && escA && escA.indexOf('/teams/' + jmCasa.idSports + '.') !== -1) {
      jRec.set('url_escudo_mandante', '')
      jAlterou = true
    }
    if (jmVis && escB && escB.indexOf('/teams/' + jmVis.idSports + '.') !== -1) {
      jRec.set('url_escudo_visitante', '')
      jAlterou = true
    }

    if (jAlterou) {
      app.save(jRec)
      jogosLimpos++
      console.log('[migration 0103] jogos ' + jRec.id + ' (' + jtA + ' x ' + jtB + ') destravado com sucesso.')
    }
  }

  console.log(
    '[migration 0103] Concluído: ' +
      enqueteJogosLimpos +
      ' registros de enquete_jogos e ' +
      jogosLimpos +
      ' registros de jogos destravados.'
  )
}, (app) => {
  console.log('[migration 0103] Revert (no-op para não re-engessar URLs).')
})
