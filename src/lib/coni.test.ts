import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import fs from 'node:fs'

describe('Inspect Excel Coni', () => {
  it('prints sheets and headers', () => {
    const fileBuffer = fs.readFileSync('src/assets/bolao-do-grupo-copa-coni-63940.xlsx')
    const wb = XLSX.read(fileBuffer, { type: 'buffer' })

    const summary: string[] = []
    summary.push('SheetNames: ' + wb.SheetNames.join(', '))

    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
      summary.push(`\n=== Sheet: "${name}" (${rows.length} rows) ===`)
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        const row = rows[i]
        if (row && row.some((c: any) => c !== '')) {
          summary.push(`Row ${i}: ${JSON.stringify(row)}`)
        }
      }
    }
    expect(summary.join('\n')).toBe('')
  })
})
