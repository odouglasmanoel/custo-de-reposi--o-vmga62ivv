/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0098] Iniciando correção canônica de escudos Série A em enquete_jogos e jogos...',
    )

    const CANONICAL_CLUB_BADGES = {
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      criciuma: 'https://media.api-sports.io/football/teams/140.png',
      criciumaec: 'https://media.api-sports.io/football/teams/140.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      fortaleza: 'https://media.api-sports.io/football/teams/154.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      juventude: 'https://media.api-sports.io/football/teams/152.png',
      ecjuventude: 'https://media.api-sports.io/football/teams/152.png',
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      cuiaba: 'https://media.api-sports.io/football/teams/1200.png',
      cuiabaec: 'https://media.api-sports.io/football/teams/1200.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
    }

    function normalizeName(name) {
      if (!name) return ''
      var s = String(name).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9]/g, '').trim()
      return s
    }

    function getCanonicalBadge(teamName) {
      var k = normalizeName(teamName)
      if (!k) return null
      return CANONICAL_CLUB_BADGES[k] || null
    }

    // 1. Atualizações prioritárias explícitas em enquete_jogos
    try {
      // jijsxhxzgpzvn6j (Vitória x Chapecoense)
      try {
        var recVitoria = app.findFirstRecordByData('enquete_jogos', 'id', 'jijsxhxzgpzvn6j')
        recVitoria.set('logo_casa', 'https://media.api-sports.io/football/teams/136.png')
        recVitoria.set('logo_visitante', 'https://media.api-sports.io/football/teams/147.png')
        app.save(recVitoria)
        console.log(
          '[migration 0098] Enquete jogo jijsxhxzgpzvn6j atualizado (Vitória 136 x Chapecoense 147)',
        )
      } catch (e1) {
        console.log('[migration 0098] Registro jijsxhxzgpzvn6j não localizado:', e1)
      }

      // 0phijbzmxzaski5 (Fluminense x Coritiba)
      try {
        var recFlu = app.findFirstRecordByData('enquete_jogos', 'id', '0phijbzmxzaski5')
        recFlu.set('logo_casa', 'https://media.api-sports.io/football/teams/124.png')
        recFlu.set('logo_visitante', 'https://media.api-sports.io/football/teams/132.png')
        app.save(recFlu)
        console.log(
          '[migration 0098] Enquete jogo 0phijbzmxzaski5 atualizado (Fluminense 124 x Coritiba 132)',
        )
      } catch (e2) {
        console.log('[migration 0098] Registro 0phijbzmxzaski5 não localizado:', e2)
      }

      // Varrer todos os enquete_jogos para preencher escudos canônicos da Série A que estejam vazios ou incorretos
      var allEnqueteJogos = app.findRecordsByFilter('enquete_jogos', '', '', 500, 0)
      for (var i = 0; i < allEnqueteJogos.length; i++) {
        var ej = allEnqueteJogos[i]
        var tA = ej.getString('time_a') || ''
        var tB = ej.getString('time_b') || ''
        var lCasa = ej.getString('logo_casa') || ''
        var lVis = ej.getString('logo_visitante') || ''
        var modified = false

        var canonA = getCanonicalBadge(tA)
        var canonB = getCanonicalBadge(tB)

        // Se for time com canônico conhecido e o logo atual estiver vazio, incorreto (ex: Vitória com 140) ou thesportsdb
        if (canonA) {
          var isWrongA =
            !lCasa ||
            lCasa.indexOf('thesportsdb.com') !== -1 ||
            (normalizeName(tA).indexOf('vitoria') >= 0 && lCasa.indexOf('/140.') !== -1) ||
            (normalizeName(tA).indexOf('cruzeiro') >= 0 && lCasa.indexOf('/132.') !== -1) ||
            (normalizeName(tA).indexOf('coritiba') >= 0 && lCasa.indexOf('/147.') !== -1) ||
            (normalizeName(tA).indexOf('chapecoense') >= 0 && lCasa.indexOf('/132.') !== -1)
          if (isWrongA || lCasa !== canonA) {
            ej.set('logo_casa', canonA)
            modified = true
          }
        }

        if (canonB) {
          var isWrongB =
            !lVis ||
            lVis.indexOf('thesportsdb.com') !== -1 ||
            (normalizeName(tB).indexOf('vitoria') >= 0 && lVis.indexOf('/140.') !== -1) ||
            (normalizeName(tB).indexOf('cruzeiro') >= 0 && lVis.indexOf('/132.') !== -1) ||
            (normalizeName(tB).indexOf('coritiba') >= 0 && lVis.indexOf('/147.') !== -1) ||
            (normalizeName(tB).indexOf('chapecoense') >= 0 && lVis.indexOf('/132.') !== -1)
          if (isWrongB || lVis !== canonB) {
            ej.set('logo_visitante', canonB)
            modified = true
          }
        }

        if (modified) {
          app.save(ej)
          console.log(
            '[migration 0098] Enquete jogo ' +
              ej.id +
              ' (' +
              tA +
              ' x ' +
              tB +
              ') atualizado com escudos canônicos.',
          )
        }
      }
    } catch (errEJ) {
      console.log('[migration 0098] Erro ao varrer enquete_jogos:', errEJ)
    }

    // 2. Atualizações em jogos
    try {
      // ufsrjcaztbajuzy (São Paulo x Santos)
      try {
        var recSaoPauloSantos = app.findFirstRecordByData('jogos', 'id', 'ufsrjcaztbajuzy')
        recSaoPauloSantos.set(
          'url_escudo_mandante',
          'https://media.api-sports.io/football/teams/126.png',
        )
        recSaoPauloSantos.set(
          'url_escudo_visitante',
          'https://media.api-sports.io/football/teams/128.png',
        )
        app.save(recSaoPauloSantos)
        console.log('[migration 0098] Jogo ufsrjcaztbajuzy atualizado (São Paulo 126 x Santos 128)')
      } catch (e3) {
        console.log('[migration 0098] Jogo ufsrjcaztbajuzy não localizado:', e3)
      }

      // Varrer todos os jogos para corrigir Vitória com 140, Cruzeiro com 132, Coritiba com 147, Chapecoense com 132 e preencher Série A
      var allJogos = app.findRecordsByFilter('jogos', '', '', 1000, 0)
      for (var j = 0; j < allJogos.length; j++) {
        var jg = allJogos[j]
        var jTimeA = jg.getString('time_a') || ''
        var jTimeB = jg.getString('time_b') || ''
        var jEscA = jg.getString('url_escudo_mandante') || ''
        var jEscB = jg.getString('url_escudo_visitante') || ''
        var jMod = false

        var jCanonA = getCanonicalBadge(jTimeA)
        var jCanonB = getCanonicalBadge(jTimeB)

        if (jCanonA) {
          var isWrongJA =
            !jEscA ||
            jEscA.indexOf('thesportsdb.com') !== -1 ||
            (normalizeName(jTimeA).indexOf('vitoria') >= 0 && jEscA.indexOf('/140.') !== -1) ||
            (normalizeName(jTimeA).indexOf('cruzeiro') >= 0 && jEscA.indexOf('/132.') !== -1) ||
            (normalizeName(jTimeA).indexOf('coritiba') >= 0 && jEscA.indexOf('/147.') !== -1) ||
            (normalizeName(jTimeA).indexOf('chapecoense') >= 0 && jEscA.indexOf('/132.') !== -1)
          if (isWrongJA || jEscA !== jCanonA) {
            jg.set('url_escudo_mandante', jCanonA)
            jMod = true
          }
        }

        if (jCanonB) {
          var isWrongJB =
            !jEscB ||
            jEscB.indexOf('thesportsdb.com') !== -1 ||
            (normalizeName(jTimeB).indexOf('vitoria') >= 0 && jEscB.indexOf('/140.') !== -1) ||
            (normalizeName(jTimeB).indexOf('cruzeiro') >= 0 && jEscB.indexOf('/132.') !== -1) ||
            (normalizeName(jTimeB).indexOf('coritiba') >= 0 && jEscB.indexOf('/147.') !== -1) ||
            (normalizeName(jTimeB).indexOf('chapecoense') >= 0 && jEscB.indexOf('/132.') !== -1)
          if (isWrongJB || jEscB !== jCanonB) {
            jg.set('url_escudo_visitante', jCanonB)
            jMod = true
          }
        }

        if (jMod) {
          app.save(jg)
          console.log(
            '[migration 0098] Jogo ' +
              jg.id +
              ' (' +
              jTimeA +
              ' x ' +
              jTimeB +
              ') atualizado com escudos canônicos.',
          )
        }
      }
    } catch (errJG) {
      console.log('[migration 0098] Erro ao varrer jogos:', errJG)
    }

    console.log('[migration 0098] Migração finalizada com sucesso!')
  },
  (app) => {},
)
