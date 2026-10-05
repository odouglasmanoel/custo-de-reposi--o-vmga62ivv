// pocketbase/hooks/resolver_escudo_central.js
// Hook centralizado para resolução e auto-preenchimento de escudos
// Todas as funções e dicionários estão rigorosamente DENTRO dos callbacks do hook,
// garantindo compatibilidade total com o runtime isolado de execução de hooks do PocketBase.

onRecordCreate(
  (e) => {
    // Dicionário canônico expandido de clubes (media.api-sports.io)
    var CLUB_ID_MAP = {
      // Série A e B Brasil
      botafogo: 120,
      botafogorj: 120,
      botafogofr: 120,
      bfr: 120,
      vasco: 133,
      vascodagama: 133,
      crvascodagama: 133,
      flamengo: 127,
      crflamengo: 127,
      fluminense: 124,
      fluminensefc: 124,
      palmeiras: 121,
      sepalmeiras: 121,
      corinthians: 131,
      sccorinthians: 131,
      corinthianspaulista: 131,
      sccorinthianspaulista: 131,
      sccp: 131,
      saopaulo: 126,
      spfc: 126,
      saopaulofc: 126,
      santos: 128,
      santosfc: 128,
      gremio: 130,
      gremiofbpa: 130,
      internacional: 119,
      inter: 119,
      scinternacional: 119,
      sci: 119,
      atleticomineiro: 1062,
      atleticomg: 1062,
      cam: 1062,
      cruzeiro: 135,
      cruzeiroec: 135,
      bahia: 118,
      ecbahia: 118,
      fortaleza: 154,
      fortalezaec: 154,
      athleticopr: 134,
      athleticoparanaense: 134,
      athletico: 134,
      atleticopr: 134,
      atleticoparanaense: 134,
      coritiba: 132,
      coritibafbc: 132,
      cfc: 132,
      coxa: 132,
      chapecoense: 147,
      chapecoenseaf: 147,
      chape: 147,
      acf: 147,
      vitoria: 136,
      ecvitoria: 136,
      esporteclubevitoria: 136,
      criciuma: 140,
      criciumaec: 140,
      cuiaba: 1200,
      cuiabaec: 1200,
      juventude: 152,
      ecjuventude: 152,
      redbullbragantino: 1199,
      bragantino: 1199,
      rbbragantino: 1199,
      mirassol: 10214,
      mirassolfc: 10214,
      remo: 10213,
      clubedoremo: 10213,
      goias: 144,
      goiasec: 144,
      sport: 794,
      sportrecife: 794,
      ceara: 129,
      cearasc: 129,
      avai: 138,
      avaifc: 138,
      pontepreta: 148,
      pontepretafc: 148,
      novorizontino: 10215,
      gremionovorizontino: 10215,
      vilanova: 141,
      vilanovaec: 141,
      operario: 143,
      operariopr: 143,
      operarioferroviario: 143,
      amazonas: 18561,
      amazonasfc: 18561,
      paysandu: 149,
      paysandusc: 149,
      brusque: 10216,
      brusquefc: 10216,
      ituano: 145,
      ituanofc: 145,
      guarani: 146,
      guaranifc: 146,
      botafogosp: 142,
      crb: 150,
      crbal: 150,
      americamg: 137,
      americamineiro: 137,
      londrina: 139,
      londrinaec: 139,
      nautico: 151,
      nauticope: 151,
      figueirense: 153,
      figueirensefc: 153,
      csa: 155,
      csaal: 155,
      sampaiocorrea: 156,
      confianca: 157,
      adconfianca: 157,
      brasildepelotas: 158,
      oeste: 159,
      oestefc: 159,
      ferroviaria: 10218,
      athleticclub: 18560,
      voltaredonda: 10217,
      saobernardo: 10219,
      saobernardofc: 10219,
      botafogopb: 10220,
      ypiranga: 10221,
      ypirangars: 10221,
      aparecidense: 10222,
      tombense: 10223,
      tombensefc: 10223,
      ferroviario: 10224,
      abc: 10225,
      abcfc: 10225,
      caxias: 10226,
      sercaxias: 10226,

      // América do Sul
      bocajuniors: 451,
      boca: 451,
      riverplate: 435,
      river: 435,
      estudiantes: 450,
      estudiantesdelaplata: 450,
      estudanteslp: 450,
      montevideocitytorque: 2365,
      montevideocity: 2365,
      torque: 2365,
      penarol: 2348,
      nacional: 2356,
      nacionalmontevideo: 2347,
      clubnacional: 2356,
      racingclub: 436,
      racing: 436,
      independiente: 453,
      caindependiente: 453,
      sanlorenzo: 460,
      velez: 438,
      velezsarsfield: 438,
      lanus: 446,
      rosariocentral: 437,
      newells: 455,
      newellsoldboys: 455,
      olimpia: 1182,
      clubolimpia: 1182,
      cerroporteno: 1176,
      libertad: 1179,
      libertadasuncion: 1179,
      ldu: 1158,
      lduquito: 1158,
      ldudequito: 1158,
      universidadcentral: 3710,
      ucv: 3710,
      ucvfc: 3710,
      independientemedellin: 1137,
      indepmedellin: 1137,
      dim: 1137,
      independienterivadavia: 440,
      independientesantafe: 1138,
      santafe: 1138,
      macara: 1162,
      cdmacara: 1162,
      platense: 448,
      caplatense: 448,
      cienciano: 2548,
      clubcienciano: 2548,
      independientedelvalle: 1153,
      barcelonasc: 1152,
      barcelonadeguayaquil: 1152,
      colocolo: 2315,
      universidaddechile: 2314,
      udechile: 2314,
      universidadcatolica: 2994,
      ucatolica: 2994,
      bolivar: 3702,
      thestrongest: 3703,
      sportingcristal: 2546,
      alianzalima: 2541,
      universitario: 2540,
      universitariodedeportes: 2540,

      // Europa e Mundiais
      psg: 85,
      parissaintgermain: 85,
      realmadrid: 541,
      barcelona: 529,
      fcbarcelona: 529,
      atleticodemadrid: 530,
      atleticomadrid: 530,
      manchestercity: 50,
      manchesterunited: 33,
      liverpool: 40,
      arsenal: 42,
      chelsea: 49,
      tottenham: 47,
      newcastle: 34,
      newcastleunited: 34,
      fulham: 36,
      fulhamfc: 36,
      lens: 116,
      rclens: 116,
      bayernmunique: 157,
      bayernmunich: 157,
      bayernmunchen: 157,
      borussiadortmund: 165,
      juventus: 496,
      milan: 489,
      acmilan: 489,
      interdemilao: 505,
      intermilan: 505,
      roma: 497,
      asroma: 497,
      napoli: 492,
      benfica: 211,
      slbenfica: 211,
      porto: 212,
      fcporto: 212,
      sporting: 228,
      sportingcp: 228,
      ajax: 194,
      alhilal: 2939,
      alnassr: 2938,
      intermiami: 8983,
    }

    // Bandeiras de seleções (FlagCDN)
    var SELECAO_FLAG_MAP = {
      brasil: 'br',
      brazil: 'br',
      argentina: 'ar',
      alemanha: 'de',
      germany: 'de',
      holanda: 'nl',
      paisesbaixos: 'nl',
      estadosunidos: 'us',
      usa: 'us',
      eua: 'us',
      mexico: 'mx',
      canada: 'ca',
      colombia: 'co',
      chile: 'cl',
      peru: 'pe',
      equador: 'ec',
      ecuador: 'ec',
      paraguai: 'py',
      paraguay: 'py',
      venezuela: 've',
      bolivia: 'bo',
      catar: 'qa',
      qatar: 'qa',
      marrocos: 'ma',
      morocco: 'ma',
      senegal: 'sn',
      gana: 'gh',
      ghana: 'gh',
      nigeria: 'ng',
      camaroes: 'cm',
      cameroon: 'cm',
      coreiadosul: 'kr',
      southkorea: 'kr',
      coreiadonorte: 'kp',
      arabiasaudita: 'sa',
      saudiarabia: 'sa',
      ira: 'ir',
      iran: 'ir',
      australia: 'au',
      suica: 'ch',
      switzerland: 'ch',
      suecia: 'se',
      sweden: 'se',
      polonia: 'pl',
      poland: 'pl',
      servia: 'rs',
      serbia: 'rs',
      ucrania: 'ua',
      ukraine: 'ua',
      austria: 'at',
      hungria: 'hu',
      hungary: 'hu',
      eslovenia: 'si',
      slovenia: 'si',
      eslovaquia: 'sk',
      slovakia: 'sk',
      romenia: 'ro',
      romania: 'ro',
      albania: 'al',
      costarica: 'cr',
      panama: 'pa',
      guatemala: 'gt',
      trinidadetobago: 'tt',
      haiti: 'ht',
      cuba: 'cu',
      curacao: 'cw',
      curacau: 'cw',
      suriname: 'sr',
      guiana: 'gy',
      guyana: 'gy',
      emiradosarabesunidos: 'ae',
      emiradosarabes: 'ae',
      uae: 'ae',
      bahrein: 'bh',
      bahrain: 'bh',
      iemen: 'ye',
      yemen: 'ye',
      oma: 'om',
      oman: 'om',
      kuwait: 'kw',
      iraque: 'iq',
      iraq: 'iq',
      jordania: 'jo',
      jordan: 'jo',
      egito: 'eg',
      egypt: 'eg',
      argelia: 'dz',
      algeria: 'dz',
      tunisia: 'tn',
      marrocos: 'ma',
      marruecos: 'ma',
      costadomarfim: 'ci',
      ivorycoast: 'ci',
      mali: 'ml',
      burkinafaso: 'bf',
      guine: 'gn',
      guinea: 'gn',
      africadosul: 'za',
      southafrica: 'za',
      angola: 'ao',
      rdcongo: 'cd',
      drcongo: 'cd',
      zambia: 'zm',
      'cabo-verde': 'cv',
      caboverde: 'cv',
      franca: 'fr',
      france: 'fr',
      inglaterra: 'gb-eng',
      england: 'gb-eng',
      espanha: 'es',
      spain: 'es',
      italia: 'it',
      italy: 'it',
      portugal: 'pt',
      belgica: 'be',
      belgium: 'be',
      croacia: 'hr',
      croatia: 'hr',
      dinamarca: 'dk',
      denmark: 'dk',
      noruega: 'no',
      norway: 'no',
      finlandia: 'fi',
      finland: 'fi',
      turquia: 'tr',
      turkey: 'tr',
      grecia: 'gr',
      greece: 'gr',
      escocia: 'gb-sct',
      scotland: 'gb-sct',
      paisdegales: 'gb-wls',
      wales: 'gb-wls',
      irlandadonorte: 'gb-nir',
      irlanda: 'ie',
      ireland: 'ie',
      republicadairlanda: 'ie',
      japao: 'jp',
      japan: 'jp',
    }

    // Normalização de competições canônicas
    var LEAGUE_CANONICAL_MAP = {
      'brazilian serie a': 'Brasileirão Série A',
      'brazilian série a': 'Brasileirão Série A',
      'serie a brazil': 'Brasileirão Série A',
      'serie a brasil': 'Brasileirão Série A',
      brasileirao: 'Brasileirão Série A',
      brasileirão: 'Brasileirão Série A',
      'brasileirao serie a': 'Brasileirão Série A',
      'brasileirão serie a': 'Brasileirão Série A',
      'brazilian serie b': 'Brasileirão Série B',
      'brazilian série b': 'Brasileirão Série B',
      'brasileirao serie b': 'Brasileirão Série B',
      'brasileirão serie b': 'Brasileirão Série B',
    }

    function normalizarChave(str) {
      if (!str) return ''
      var s = String(str).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '')
    }

    function levenshtein(a, b) {
      var m = a.length
      var n = b.length
      if (m === 0) return n
      if (n === 0) return m
      var d = []
      for (var i = 0; i <= m; i++) d[i] = [i]
      for (var j = 0; j <= n; j++) d[0][j] = j
      for (var i1 = 1; i1 <= m; i1++) {
        for (var j1 = 1; j1 <= n; j1++) {
          var cost = a[i1 - 1] === b[j1 - 1] ? 0 : 1
          d[i1][j1] = Math.min(d[i1 - 1][j1] + 1, d[i1][j1 - 1] + 1, d[i1 - 1][j1 - 1] + cost)
        }
      }
      return d[m][n]
    }

    function similaridadeNomes(a, b) {
      var na = normalizarChave(a)
      var nb = normalizarChave(b)
      if (!na || !nb) return 0
      if (na === nb) return 1
      if (na.length < 4 || nb.length < 4) return 0
      // Regra de ouro: Coritiba e Chapecoense nunca dão match
      if (
        (na.indexOf('coritiba') !== -1 && nb.indexOf('chapecoense') !== -1) ||
        (na.indexOf('chapecoense') !== -1 && nb.indexOf('coritiba') !== -1)
      ) {
        return 0
      }
      if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) {
        if (Math.min(na.length, nb.length) >= 4) return 0.95
      }
      var maxL = Math.max(na.length, nb.length)
      if (maxL === 0) return 1
      var dist = levenshtein(na, nb)
      return Math.max(0, 1 - dist / maxL)
    }

    function buscarTheSportsDbBadge(nomeTime) {
      if (!nomeTime) return ''
      var normClean = normalizarChave(nomeTime)
      if (normClean.length < 3) return ''

      // Trava Boca, River, Estudiantes e os 6 blindados de usar TheSportsDB
      if (
        normClean.indexOf('boca') !== -1 ||
        normClean.indexOf('river') !== -1 ||
        normClean.indexOf('estudiantes') !== -1 ||
        normClean === 'cfc' ||
        normClean === 'coxa' ||
        normClean.indexOf('coritiba') !== -1 ||
        normClean === 'acf' ||
        normClean === 'chape' ||
        normClean.indexOf('chapecoense') !== -1 ||
        normClean.indexOf('mirassol') !== -1 ||
        normClean.indexOf('bragantino') !== -1 ||
        normClean === 'remo' ||
        normClean === 'clubedoremo' ||
        normClean === 'vitoria' ||
        normClean === 'ecvitoria'
      ) {
        return ''
      }

      // Se for seleção nacional, não usa TheSportsDB (usa FlagCDN / oficial)
      if (SELECAO_FLAG_MAP[normClean]) return ''

      try {
        var cleanTerm = String(nomeTime)
          .replace(/\b(FC|EC|SC|AC|CR|SE|CF|CD|SD|Futebol|Clube|Club|de|do|da|dos|das)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!cleanTerm || cleanTerm.length < 3) cleanTerm = nomeTime

        var url =
          'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=' +
          encodeURIComponent(cleanTerm)
        var res = $http.send({
          url: url,
          method: 'GET',
          timeout: 4,
        })

        if (
          res.statusCode === 200 &&
          res.json &&
          Array.isArray(res.json.teams) &&
          res.json.teams.length > 0
        ) {
          for (var tIdx = 0; tIdx < res.json.teams.length; tIdx++) {
            var tm = res.json.teams[tIdx]
            if (!tm || !tm.strBadge) continue

            var badgeCandidate = String(tm.strBadge).trim()
            if (!badgeCandidate) continue
            var badgeLow = badgeCandidate.toLowerCase()
            // Descarta placeholders conhecidos
            if (
              badgeLow.indexOf('z3v04x') !== -1 ||
              badgeLow.indexOf('v6mk4r') !== -1 ||
              badgeLow.indexOf('bsc') !== -1
            ) {
              continue
            }

            var teamStr = tm.strTeam || ''
            var teamAlt = tm.strTeamAlternate || tm.strAlternate || ''

            var simTeam = similaridadeNomes(nomeTime, teamStr)
            var simAlt = teamAlt ? similaridadeNomes(nomeTime, teamAlt) : 0
            var bestSim = Math.max(simTeam, simAlt)

            if (bestSim >= 0.88) {
              return badgeCandidate
            }
          }
        }
      } catch (errTsdb) {
        console.log('[resolver_escudo_central TSDB] Erro ao consultar ' + nomeTime + ':', errTsdb)
      }
      return ''
    }

    function resolverEscudoUrl(nomeTime) {
      if (!nomeTime) return ''
      var key = normalizarChave(nomeTime)
      if (!key) return ''

      // Trava seleção
      if (SELECAO_FLAG_MAP[key]) {
        return 'https://flagcdn.com/w80/' + SELECAO_FLAG_MAP[key] + '.png'
      }

      // Prioridade 1: TheSportsDB (para buscas por nome de clubes)
      var tsdbBadge = buscarTheSportsDbBadge(nomeTime)
      if (tsdbBadge) {
        return tsdbBadge
      }

      // Prioridade 2 e 3: CLUB_ID_MAP / API-Football e SELECAO_FLAG_MAP
      if (CLUB_ID_MAP[key]) {
        return 'https://media.api-sports.io/football/teams/' + CLUB_ID_MAP[key] + '.png'
      }

      var keys = Object.keys(CLUB_ID_MAP)
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]
        if (k.length >= 4 && (key.indexOf(k) !== -1 || k.indexOf(key) !== -1)) {
          return 'https://media.api-sports.io/football/teams/' + CLUB_ID_MAP[k] + '.png'
        }
      }

      var selKeys = Object.keys(SELECAO_FLAG_MAP)
      for (var j = 0; j < selKeys.length; j++) {
        var sk = selKeys[j]
        if (sk.length >= 4 && (key.indexOf(sk) !== -1 || sk.indexOf(key) !== -1)) {
          return 'https://flagcdn.com/w80/' + SELECAO_FLAG_MAP[sk] + '.png'
        }
      }

      return ''
    }

    function normalizarCompeticao(comp) {
      if (!comp) return ''
      var clean = String(comp).trim()
      var low = clean.toLowerCase()
      try {
        low = low.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      low = low.replace(/\s+/g, ' ').trim()

      if (LEAGUE_CANONICAL_MAP[low]) {
        return LEAGUE_CANONICAL_MAP[low]
      }
      if (
        low.indexOf('brazilian serie a') !== -1 ||
        low === 'brasileirao' ||
        low === 'brasileirao serie a'
      ) {
        return 'Brasileirão Série A'
      }
      if (low.indexOf('brazilian serie b') !== -1 || low === 'brasileirao serie b') {
        return 'Brasileirão Série B'
      }
      return clean
    }

    var collectionName = e.record.collection().name

    // Helper específico dos 6 clubes nacionais para sobrescrita forçada mesmo se URL já existir
    function obterCanonicoSeisClubes(nome) {
      if (!nome) return null
      var k = normalizarChave(nome)
      if (!k) return null
      // Protege Boca, River, Estudiantes e seleções
      if (
        k.indexOf('boca') !== -1 ||
        k.indexOf('river') !== -1 ||
        k.indexOf('estudiantes') !== -1
      ) {
        return null
      }
      if (k === 'cfc' || k === 'coxa' || k.indexOf('coritiba') !== -1) {
        return 'https://media.api-sports.io/football/teams/132.png'
      }
      if (k === 'acf' || k === 'chape' || k.indexOf('chapecoense') !== -1) {
        return 'https://media.api-sports.io/football/teams/147.png'
      }
      if (k.indexOf('mirassol') !== -1) {
        return 'https://media.api-sports.io/football/teams/10214.png'
      }
      if (k.indexOf('bragantino') !== -1) {
        return 'https://media.api-sports.io/football/teams/1199.png'
      }
      if (k === 'remo' || k === 'clubedoremo') {
        return 'https://media.api-sports.io/football/teams/10213.png'
      }
      if (
        k === 'vitoria' ||
        k === 'ecvitoria' ||
        k === 'esporteclubevitoria' ||
        (k.indexOf('vitoria') !== -1 && k.indexOf('setubal') === -1)
      ) {
        return 'https://media.api-sports.io/football/teams/136.png'
      }
      return null
    }

    if (collectionName === 'jogos') {
      var timeA = e.record.get('time_a')
      var timeB = e.record.get('time_b')
      var escudoA = e.record.get('url_escudo_mandante')
      var escudoB = e.record.get('url_escudo_visitante')
      var competicao = e.record.get('competicao')

      if (!escudoA && timeA) {
        var canonA = obterCanonicoSeisClubes(timeA)
        if (canonA) {
          e.record.set('url_escudo_mandante', canonA)
        } else {
          var resolvedA = resolverEscudoUrl(timeA)
          if (resolvedA) e.record.set('url_escudo_mandante', resolvedA)
        }
      }

      if (!escudoB && timeB) {
        var canonB = obterCanonicoSeisClubes(timeB)
        if (canonB) {
          e.record.set('url_escudo_visitante', canonB)
        } else {
          var resolvedB = resolverEscudoUrl(timeB)
          if (resolvedB) e.record.set('url_escudo_visitante', resolvedB)
        }
      }

      if (competicao) {
        var normComp = normalizarCompeticao(competicao)
        if (normComp !== competicao) {
          e.record.set('competicao', normComp)
        }
      }
    } else if (collectionName === 'enquete_jogos') {
      var timeAEnq = e.record.get('time_a')
      var timeBEnq = e.record.get('time_b')
      var logoCasa = e.record.get('logo_casa')
      var logoVisitante = e.record.get('logo_visitante')
      var campEnq = e.record.get('campeonato')

      if (!logoCasa && timeAEnq) {
        var canonCasa = obterCanonicoSeisClubes(timeAEnq)
        if (canonCasa) {
          e.record.set('logo_casa', canonCasa)
        } else {
          var resCasa = resolverEscudoUrl(timeAEnq)
          if (resCasa) e.record.set('logo_casa', resCasa)
        }
      }

      if (!logoVisitante && timeBEnq) {
        var canonVis = obterCanonicoSeisClubes(timeBEnq)
        if (canonVis) {
          e.record.set('logo_visitante', canonVis)
        } else {
          var resVis = resolverEscudoUrl(timeBEnq)
          if (resVis) e.record.set('logo_visitante', resVis)
        }
      }

      if (campEnq) {
        var normCamp = normalizarCompeticao(campEnq)
        if (normCamp !== campEnq) {
          e.record.set('campeonato', normCamp)
        }
      }
    }

    e.next()
  },
  'jogos',
  'enquete_jogos',
)

onRecordUpdate(
  (e) => {
    // Dicionário canônico expandido de clubes (media.api-sports.io)
    var CLUB_ID_MAP = {
      // Série A e B Brasil
      botafogo: 120,
      botafogorj: 120,
      botafogofr: 120,
      bfr: 120,
      vasco: 133,
      vascodagama: 133,
      crvascodagama: 133,
      flamengo: 127,
      crflamengo: 127,
      fluminense: 124,
      fluminensefc: 124,
      palmeiras: 121,
      sepalmeiras: 121,
      corinthians: 131,
      sccorinthians: 131,
      corinthianspaulista: 131,
      sccorinthianspaulista: 131,
      sccp: 131,
      saopaulo: 126,
      spfc: 126,
      saopaulofc: 126,
      santos: 128,
      santosfc: 128,
      gremio: 130,
      gremiofbpa: 130,
      internacional: 119,
      inter: 119,
      scinternacional: 119,
      sci: 119,
      atleticomineiro: 1062,
      atleticomg: 1062,
      cam: 1062,
      cruzeiro: 135,
      cruzeiroec: 135,
      bahia: 118,
      ecbahia: 118,
      fortaleza: 154,
      fortalezaec: 154,
      athleticopr: 134,
      athleticoparanaense: 134,
      athletico: 134,
      atleticopr: 134,
      atleticoparanaense: 134,
      coritiba: 132,
      coritibafbc: 132,
      cfc: 132,
      coxa: 132,
      chapecoense: 147,
      chapecoenseaf: 147,
      chape: 147,
      acf: 147,
      vitoria: 136,
      ecvitoria: 136,
      esporteclubevitoria: 136,
      criciuma: 140,
      criciumaec: 140,
      cuiaba: 1200,
      cuiabaec: 1200,
      juventude: 152,
      ecjuventude: 152,
      redbullbragantino: 1199,
      bragantino: 1199,
      rbbragantino: 1199,
      mirassol: 10214,
      mirassolfc: 10214,
      remo: 10213,
      clubedoremo: 10213,
      goias: 144,
      goiasec: 144,
      sport: 794,
      sportrecife: 794,
      ceara: 129,
      cearasc: 129,
      avai: 138,
      avaifc: 138,
      pontepreta: 148,
      pontepretafc: 148,
      novorizontino: 10215,
      gremionovorizontino: 10215,
      vilanova: 141,
      vilanovaec: 141,
      operario: 143,
      operariopr: 143,
      operarioferroviario: 143,
      amazonas: 18561,
      amazonasfc: 18561,
      paysandu: 149,
      paysandusc: 149,
      brusque: 10216,
      brusquefc: 10216,
      ituano: 145,
      ituanofc: 145,
      guarani: 146,
      guaranifc: 146,
      botafogosp: 142,
      crb: 150,
      crbal: 150,
      americamg: 137,
      americamineiro: 137,
      londrina: 139,
      londrinaec: 139,
      nautico: 151,
      nauticope: 151,
      figueirense: 153,
      figueirensefc: 153,
      csa: 155,
      csaal: 155,
      sampaiocorrea: 156,
      confianca: 157,
      adconfianca: 157,
      brasildepelotas: 158,
      oeste: 159,
      oestefc: 159,
      ferroviaria: 10218,
      athleticclub: 18560,
      voltaredonda: 10217,
      saobernardo: 10219,
      saobernardofc: 10219,
      botafogopb: 10220,
      ypiranga: 10221,
      ypirangars: 10221,
      aparecidense: 10222,
      tombense: 10223,
      tombensefc: 10223,
      ferroviario: 10224,
      abc: 10225,
      abcfc: 10225,
      caxias: 10226,
      sercaxias: 10226,

      // América do Sul
      bocajuniors: 451,
      boca: 451,
      riverplate: 435,
      river: 435,
      estudiantes: 450,
      estudiantesdelaplata: 450,
      estudanteslp: 450,
      montevideocitytorque: 2365,
      montevideocity: 2365,
      torque: 2365,
      penarol: 2348,
      nacional: 2356,
      nacionalmontevideo: 2347,
      clubnacional: 2356,
      racingclub: 436,
      racing: 436,
      independiente: 453,
      caindependiente: 453,
      sanlorenzo: 460,
      velez: 438,
      velezsarsfield: 438,
      lanus: 446,
      rosariocentral: 437,
      newells: 455,
      newellsoldboys: 455,
      olimpia: 1182,
      clubolimpia: 1182,
      cerroporteno: 1176,
      libertad: 1179,
      libertadasuncion: 1179,
      ldu: 1158,
      lduquito: 1158,
      ldudequito: 1158,
      universidadcentral: 3710,
      ucv: 3710,
      ucvfc: 3710,
      independientemedellin: 1137,
      indepmedellin: 1137,
      dim: 1137,
      independienterivadavia: 440,
      independientesantafe: 1138,
      santafe: 1138,
      macara: 1162,
      cdmacara: 1162,
      platense: 448,
      caplatense: 448,
      cienciano: 2548,
      clubcienciano: 2548,
      independientedelvalle: 1153,
      barcelonasc: 1152,
      barcelonadeguayaquil: 1152,
      colocolo: 2315,
      universidaddechile: 2314,
      udechile: 2314,
      universidadcatolica: 2994,
      ucatolica: 2994,
      bolivar: 3702,
      thestrongest: 3703,
      sportingcristal: 2546,
      alianzalima: 2541,
      universitario: 2540,
      universitariodedeportes: 2540,

      // Europa e Mundiais
      psg: 85,
      parissaintgermain: 85,
      realmadrid: 541,
      barcelona: 529,
      fcbarcelona: 529,
      atleticodemadrid: 530,
      atleticomadrid: 530,
      manchestercity: 50,
      manchesterunited: 33,
      liverpool: 40,
      arsenal: 42,
      chelsea: 49,
      tottenham: 47,
      newcastle: 34,
      newcastleunited: 34,
      fulham: 36,
      fulhamfc: 36,
      lens: 116,
      rclens: 116,
      bayernmunique: 157,
      bayernmunich: 157,
      bayernmunchen: 157,
      borussiadortmund: 165,
      juventus: 496,
      milan: 489,
      acmilan: 489,
      interdemilao: 505,
      intermilan: 505,
      roma: 497,
      asroma: 497,
      napoli: 492,
      benfica: 211,
      slbenfica: 211,
      porto: 212,
      fcporto: 212,
      sporting: 228,
      sportingcp: 228,
      ajax: 194,
      alhilal: 2939,
      alnassr: 2938,
      intermiami: 8983,
    }

    // Bandeiras de seleções (FlagCDN)
    var SELECAO_FLAG_MAP = {
      brasil: 'br',
      brazil: 'br',
      argentina: 'ar',
      alemanha: 'de',
      germany: 'de',
      holanda: 'nl',
      paisesbaixos: 'nl',
      estadosunidos: 'us',
      usa: 'us',
      eua: 'us',
      mexico: 'mx',
      canada: 'ca',
      colombia: 'co',
      chile: 'cl',
      peru: 'pe',
      equador: 'ec',
      ecuador: 'ec',
      paraguai: 'py',
      paraguay: 'py',
      venezuela: 've',
      bolivia: 'bo',
      catar: 'qa',
      qatar: 'qa',
      marrocos: 'ma',
      morocco: 'ma',
      senegal: 'sn',
      gana: 'gh',
      ghana: 'gh',
      nigeria: 'ng',
      camaroes: 'cm',
      cameroon: 'cm',
      coreiadosul: 'kr',
      southkorea: 'kr',
      coreiadonorte: 'kp',
      arabiasaudita: 'sa',
      saudiarabia: 'sa',
      ira: 'ir',
      iran: 'ir',
      australia: 'au',
      suica: 'ch',
      switzerland: 'ch',
      suecia: 'se',
      sweden: 'se',
      polonia: 'pl',
      poland: 'pl',
      servia: 'rs',
      serbia: 'rs',
      ucrania: 'ua',
      ukraine: 'ua',
      austria: 'at',
      hungria: 'hu',
      hungary: 'hu',
      eslovenia: 'si',
      slovenia: 'si',
      eslovaquia: 'sk',
      slovakia: 'sk',
      romenia: 'ro',
      romania: 'ro',
      albania: 'al',
      costarica: 'cr',
      panama: 'pa',
      guatemala: 'gt',
      trinidadetobago: 'tt',
      haiti: 'ht',
      cuba: 'cu',
      curacao: 'cw',
      curacau: 'cw',
      suriname: 'sr',
      guiana: 'gy',
      guyana: 'gy',
      emiradosarabesunidos: 'ae',
      emiradosarabes: 'ae',
      uae: 'ae',
      bahrein: 'bh',
      bahrain: 'bh',
      iemen: 'ye',
      yemen: 'ye',
      oma: 'om',
      oman: 'om',
      kuwait: 'kw',
      iraque: 'iq',
      iraq: 'iq',
      jordania: 'jo',
      jordan: 'jo',
      egito: 'eg',
      egypt: 'eg',
      argelia: 'dz',
      algeria: 'dz',
      tunisia: 'tn',
      marrocos: 'ma',
      marruecos: 'ma',
      costadomarfim: 'ci',
      ivorycoast: 'ci',
      mali: 'ml',
      burkinafaso: 'bf',
      guine: 'gn',
      guinea: 'gn',
      africadosul: 'za',
      southafrica: 'za',
      angola: 'ao',
      rdcongo: 'cd',
      drcongo: 'cd',
      zambia: 'zm',
      'cabo-verde': 'cv',
      caboverde: 'cv',
      franca: 'fr',
      france: 'fr',
      inglaterra: 'gb-eng',
      england: 'gb-eng',
      espanha: 'es',
      spain: 'es',
      italia: 'it',
      italy: 'it',
      portugal: 'pt',
      belgica: 'be',
      belgium: 'be',
      croacia: 'hr',
      croatia: 'hr',
      dinamarca: 'dk',
      denmark: 'dk',
      noruega: 'no',
      norway: 'no',
      finlandia: 'fi',
      finland: 'fi',
      turquia: 'tr',
      turkey: 'tr',
      grecia: 'gr',
      greece: 'gr',
      escocia: 'gb-sct',
      scotland: 'gb-sct',
      paisdegales: 'gb-wls',
      wales: 'gb-wls',
      irlandadonorte: 'gb-nir',
      irlanda: 'ie',
      ireland: 'ie',
      republicadairlanda: 'ie',
      japao: 'jp',
      japan: 'jp',
    }

    // Normalização de competições canônicas
    var LEAGUE_CANONICAL_MAP = {
      'brazilian serie a': 'Brasileirão Série A',
      'brazilian série a': 'Brasileirão Série A',
      'serie a brazil': 'Brasileirão Série A',
      'serie a brasil': 'Brasileirão Série A',
      brasileirao: 'Brasileirão Série A',
      brasileirão: 'Brasileirão Série A',
      'brasileirao serie a': 'Brasileirão Série A',
      'brasileirão serie a': 'Brasileirão Série A',
      'brazilian serie b': 'Brasileirão Série B',
      'brazilian série b': 'Brasileirão Série B',
      'brasileirao serie b': 'Brasileirão Série B',
      'brasileirão serie b': 'Brasileirão Série B',
    }

    function normalizarChave(str) {
      if (!str) return ''
      var s = String(str).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '')
    }

    function resolverEscudoUrl(nomeTime) {
      if (!nomeTime) return ''
      var key = normalizarChave(nomeTime)
      if (!key) return ''

      if (CLUB_ID_MAP[key]) {
        return 'https://media.api-sports.io/football/teams/' + CLUB_ID_MAP[key] + '.png'
      }
      if (SELECAO_FLAG_MAP[key]) {
        return 'https://flagcdn.com/w80/' + SELECAO_FLAG_MAP[key] + '.png'
      }

      var keys = Object.keys(CLUB_ID_MAP)
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]
        if (k.length >= 4 && (key.indexOf(k) !== -1 || k.indexOf(key) !== -1)) {
          return 'https://media.api-sports.io/football/teams/' + CLUB_ID_MAP[k] + '.png'
        }
      }

      var selKeys = Object.keys(SELECAO_FLAG_MAP)
      for (var j = 0; j < selKeys.length; j++) {
        var sk = selKeys[j]
        if (sk.length >= 4 && (key.indexOf(sk) !== -1 || sk.indexOf(key) !== -1)) {
          return 'https://flagcdn.com/w80/' + SELECAO_FLAG_MAP[sk] + '.png'
        }
      }

      return ''
    }

    function normalizarCompeticao(comp) {
      if (!comp) return ''
      var clean = String(comp).trim()
      var low = clean.toLowerCase()
      try {
        low = low.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      low = low.replace(/\s+/g, ' ').trim()

      if (LEAGUE_CANONICAL_MAP[low]) {
        return LEAGUE_CANONICAL_MAP[low]
      }
      if (
        low.indexOf('brazilian serie a') !== -1 ||
        low === 'brasileirao' ||
        low === 'brasileirao serie a'
      ) {
        return 'Brasileirão Série A'
      }
      if (low.indexOf('brazilian serie b') !== -1 || low === 'brasileirao serie b') {
        return 'Brasileirão Série B'
      }
      return clean
    }

    // Helper específico dos 6 clubes nacionais para sobrescrita forçada mesmo se URL já existir
    function obterCanonicoSeisClubes(nome) {
      if (!nome) return null
      var k = normalizarChave(nome)
      if (!k) return null
      // Protege Boca, River, Estudiantes e seleções
      if (
        k.indexOf('boca') !== -1 ||
        k.indexOf('river') !== -1 ||
        k.indexOf('estudiantes') !== -1
      ) {
        return null
      }
      if (k === 'cfc' || k === 'coxa' || k.indexOf('coritiba') !== -1) {
        return 'https://media.api-sports.io/football/teams/132.png'
      }
      if (k === 'acf' || k === 'chape' || k.indexOf('chapecoense') !== -1) {
        return 'https://media.api-sports.io/football/teams/147.png'
      }
      if (k.indexOf('mirassol') !== -1) {
        return 'https://media.api-sports.io/football/teams/10214.png'
      }
      if (k.indexOf('bragantino') !== -1) {
        return 'https://media.api-sports.io/football/teams/1199.png'
      }
      if (k === 'remo' || k === 'clubedoremo') {
        return 'https://media.api-sports.io/football/teams/10213.png'
      }
      if (
        k === 'vitoria' ||
        k === 'ecvitoria' ||
        k === 'esporteclubevitoria' ||
        (k.indexOf('vitoria') !== -1 && k.indexOf('setubal') === -1)
      ) {
        return 'https://media.api-sports.io/football/teams/136.png'
      }
      return null
    }

    // Checagem de override do Admin: se o admin informou explicitamente admin_override_escudos,
    // pula a resolução automática de escudos para respeitar a edição manual (inclusive limpar campo ou URL própria)
    var reqBody = {}
    try {
      if (e.requestInfo) {
        reqBody = e.requestInfo().body || e.requestInfo().data || {}
      }
    } catch (_) {
      reqBody = {}
    }
    var adminOverrideEscudos =
      reqBody &&
      (reqBody.admin_override_escudos === true ||
        reqBody.admin_override_escudos === 'true' ||
        reqBody.admin_override_escudos === 1 ||
        reqBody.admin_override_escudos === '1')

    var collectionName = e.record.collection().name

    if (collectionName === 'jogos') {
      var timeA = e.record.get('time_a')
      var timeB = e.record.get('time_b')
      var escudoA = e.record.get('url_escudo_mandante')
      var escudoB = e.record.get('url_escudo_visitante')
      var competicao = e.record.get('competicao')

      if (!adminOverrideEscudos) {
        if (!escudoA && timeA) {
          var canonA = obterCanonicoSeisClubes(timeA)
          if (canonA) {
            e.record.set('url_escudo_mandante', canonA)
          } else {
            var resolvedA = resolverEscudoUrl(timeA)
            if (resolvedA) e.record.set('url_escudo_mandante', resolvedA)
          }
        }

        if (!escudoB && timeB) {
          var canonB = obterCanonicoSeisClubes(timeB)
          if (canonB) {
            e.record.set('url_escudo_visitante', canonB)
          } else {
            var resolvedB = resolverEscudoUrl(timeB)
            if (resolvedB) e.record.set('url_escudo_visitante', resolvedB)
          }
        }
      }

      if (competicao) {
        var normComp = normalizarCompeticao(competicao)
        if (normComp !== competicao) {
          e.record.set('competicao', normComp)
        }
      }
    } else if (collectionName === 'enquete_jogos') {
      var timeAEnq = e.record.get('time_a')
      var timeBEnq = e.record.get('time_b')
      var logoCasa = e.record.get('logo_casa')
      var logoVisitante = e.record.get('logo_visitante')
      var campEnq = e.record.get('campeonato')

      if (!adminOverrideEscudos) {
        if (!logoCasa && timeAEnq) {
          var canonCasa = obterCanonicoSeisClubes(timeAEnq)
          if (canonCasa) {
            e.record.set('logo_casa', canonCasa)
          } else {
            var resCasa = resolverEscudoUrl(timeAEnq)
            if (resCasa) e.record.set('logo_casa', resCasa)
          }
        }

        if (!logoVisitante && timeBEnq) {
          var canonVis = obterCanonicoSeisClubes(timeBEnq)
          if (canonVis) {
            e.record.set('logo_visitante', canonVis)
          } else {
            var resVis = resolverEscudoUrl(timeBEnq)
            if (resVis) e.record.set('logo_visitante', resVis)
          }
        }
      }

      if (campEnq) {
        var normCamp = normalizarCompeticao(campEnq)
        if (normCamp !== campEnq) {
          e.record.set('campeonato', normCamp)
        }
      }
    }

    e.next()
  },
  'jogos',
  'enquete_jogos',
)
