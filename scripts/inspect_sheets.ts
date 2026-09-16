import * as XLSX from 'xlsx'
import * as fs from 'fs'

const buffer = fs.readFileSync('src/assets/bolao-do-grupo-copa-coni-63940.xlsx')
const wb = XLSX.read(buffer, { type: 'buffer' })
const sheetNames = wb.SheetNames

const report: any = { sheetNames, sheets: {} }

for (const name of sheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]
  report.sheets[name] = {
    rowCount: rows.length,
    headers: rows.slice(0, 5),
    sampleRows: rows.slice(5, 12),
  }
}

fs.writeFileSync('src/lib/temp_inspection.json', JSON.stringify(report, null, 2))
