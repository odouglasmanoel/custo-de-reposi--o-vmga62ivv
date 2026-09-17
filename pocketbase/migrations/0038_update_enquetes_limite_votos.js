migrate(
  (app) => {
    // Atualiza limite de votos para no mínimo 10 em todas as enquetes (idempotente)
    // Especificamente o registro 'i5meuj2wnvan704' (Enquete Copa Coni) e quaisquer outros < 10
    app
      .db()
      .newQuery(
        "UPDATE enquetes SET limite_votos = 10 WHERE limite_votos < 10 OR id = 'i5meuj2wnvan704'",
      )
      .execute()
  },
  (app) => {
    // Reversão opcional (não reverte para preservar dados consistentes)
  },
)
