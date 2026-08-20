import { useState } from 'react'
import { Database, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { EXPORTABLE_TABLES, fetchTableForExport, type ExportableTable } from '@/services/admin'
import { downloadCsv } from '@/lib/csv'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/layout'

export function BackupPanel() {
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState('')

  async function exportOne(table: ExportableTable, label: string) {
    setBusy(table)
    setProgress('')
    try {
      const rows = await fetchTableForExport(table, (n) => setProgress(`${n} rows…`))
      if (rows.length === 0) {
        toast.info(`${label}: nothing to export yet`)
        return
      }
      const headers = Object.keys(rows[0]!)
      downloadCsv(
        `${table}-${new Date().toISOString().slice(0, 10)}`,
        headers,
        rows.map((r) => headers.map((h) => formatCell(r[h]))),
      )
      toast.success(`${label}: ${rows.length} rows exported`)
    } catch (err) {
      toast.error(friendlyError(err, `Could not export ${label}.`))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  async function exportEverything() {
    setBusy('__all__')
    try {
      let total = 0
      for (const { table, label } of EXPORTABLE_TABLES) {
        setProgress(label)
        const rows = await fetchTableForExport(table)
        if (rows.length === 0) continue
        const headers = Object.keys(rows[0]!)
        downloadCsv(
          `${table}-${new Date().toISOString().slice(0, 10)}`,
          headers,
          rows.map((r) => headers.map((h) => formatCell(r[h]))),
        )
        total += rows.length
        // Browsers throttle rapid consecutive downloads; a short gap keeps
        // every file arriving instead of silently dropping some.
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      toast.success(`Exported ${total} rows across ${EXPORTABLE_TABLES.length} files`)
    } catch (err) {
      toast.error(friendlyError(err, 'Could not complete the export.'))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Export & backup"
        actions={
          <Button
            onClick={() => void exportEverything()}
            loading={busy === '__all__'}
            disabled={Boolean(busy)}
          >
            <Download className="h-4 w-4" />
            Export everything
          </Button>
        }
      />

      <div className="space-y-4 p-4 sm:p-5">
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          <p className="font-medium">Your data is backed up in three places.</p>
          <ol className="mt-1.5 space-y-1 text-brand-800">
            <li>
              <strong>1. Supabase daily backups</strong> — automatic on the Pro plan. This is the
              one that matters most; the free plan does not include it.
            </li>
            <li>
              <strong>2. These CSV exports</strong> — download them monthly and keep a copy on a
              local drive or Google Drive.
            </li>
            <li>
              <strong>3. Point-in-time recovery</strong> — an optional Supabase add-on that lets
              you rewind the database to any moment.
            </li>
          </ol>
          <p className="mt-2 text-brand-800">
            A backup that lives only inside the same account is not really a backup. The monthly
            download is what protects you if the Supabase account itself is ever lost.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-brand-800">Export a single table</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXPORTABLE_TABLES.map(({ table, label }) => (
              <button
                key={table}
                onClick={() => void exportOne(table, label)}
                disabled={Boolean(busy)}
                className="flex min-h-touch items-center justify-between gap-2 rounded-lg border border-cream-300 px-3 py-2.5 text-left text-sm text-brand-800 transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-brand-500" />
                  {label}
                </span>
                {busy === table ? (
                  <span className="flex items-center gap-1 text-xs text-brand-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {progress}
                  </span>
                ) : (
                  <Download className="h-4 w-4 text-brand-500" />
                )}
              </button>
            ))}
          </div>
        </div>

        {busy === '__all__' && progress && (
          <p className="text-sm text-brand-700">Exporting {progress}…</p>
        )}

        <p className="text-xs text-brand-600">
          Files open directly in Excel. Financial records (invoices, payments, stock movements)
          are exported exactly as stored — this is a copy, never a way to change them.
        </p>
      </div>
    </Card>
  )
}

function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
