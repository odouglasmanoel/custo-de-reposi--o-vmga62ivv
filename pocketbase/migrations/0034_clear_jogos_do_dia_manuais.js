migrate(
  (app) => {
    // Esvazia os registros de jogos manuais legados/antigos sem alterar estrutura de tabelas ou bolão
    try {
      const records = app.findRecordsByFilter('jogos_do_dia_manuais', '1=1', '', 500, 0)
      for (let i = 0; i < records.length; i++) {
        app.delete(records[i])
      }
    } catch (_) {}
  },
  () => {
    // Reversão vazia
  },
)
