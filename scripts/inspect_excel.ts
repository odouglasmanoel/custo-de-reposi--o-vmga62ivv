import * as XLSX from 'xlsx'
import * as fs from 'fs'

const fileBuffer = fs.readFileSync('src/assets/bolao-do-grupo-copa-coni-63940.xlsx')
const wb = XLSX.read(fileBuffer, { type: 'buffer' })
console.log('Sheet Names:', wb.SheetNames)

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]
  console.log(`\n=== SHEET: ${name} (Rows: ${rows.length}) ===`)
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    console.log(`Row ${r}:`, JSON.stringify(rows[r]))
  }
}
