import { supabase } from '@/lib/supabase'
import type { PrescriptionFileRow, PrescriptionRow } from '@/types/database'

export interface NewPrescriptionInput
  extends Omit<
    Partial<PrescriptionRow>,
    'id' | 'created_at' | 'created_by' | 'branch_id' | 'voided_at' | 'void_reason'
  > {
  customer_id: string
}

export async function createPrescription(input: NewPrescriptionInput): Promise<PrescriptionRow> {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as PrescriptionRow
}

export async function voidPrescription(id: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('prescriptions')
    .update({ voided_at: new Date().toISOString(), void_reason: reason })
    .eq('id', id)
  if (error) throw error
}

export async function listRecentPrescriptions(limit = 25, page = 0) {
  const { data, error, count } = await supabase
    .from('prescriptions')
    .select('*, customers!inner(id, full_name, customer_code, mobile)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1)
  if (error) throw error
  return {
    rows: (data ?? []) as Array<
      PrescriptionRow & { customers: { id: string; full_name: string; customer_code: string; mobile: string } }
    >,
    total: count ?? 0,
  }
}

// ── Prescription images (private bucket, signed URLs) ────────────────────────

const BUCKET = 'prescription-files'

export async function uploadPrescriptionFile(
  customerId: string,
  prescriptionId: string,
  file: File,
): Promise<PrescriptionFileRow> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${customerId}/${prescriptionId}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('prescription_files')
    .insert({
      prescription_id: prescriptionId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as PrescriptionFileRow
}

export async function listPrescriptionFiles(prescriptionId: string): Promise<PrescriptionFileRow[]> {
  const { data, error } = await supabase
    .from('prescription_files')
    .select('*')
    .eq('prescription_id', prescriptionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PrescriptionFileRow[]
}

/** Short-lived signed URL — the bucket is private (ARCHITECTURE.md §4.4). */
export async function getPrescriptionFileUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300)
  if (error) throw error
  return data.signedUrl
}
