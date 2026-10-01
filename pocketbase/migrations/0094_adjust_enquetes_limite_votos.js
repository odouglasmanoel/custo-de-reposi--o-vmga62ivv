/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Garante que o campo limite_votos na collection enquetes permita valores a partir de 1
    // (com valor padrão flexível definido na criação da enquete).
    try {
      const col = app.findCollectionByNameOrId('enquetes')
      const field = col.fields.getByName('limite_votos')
      if (field) {
        field.min = 1
        field.max = 50
        app.save(col)
      }
    } catch (err) {
      console.log('[Migration 0094] Aviso ao ajustar campo limite_votos:', err)
    }
  },
  (app) => {
    // Reversão
  },
)
