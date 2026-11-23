import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ForensicReportView } from '@/components/forensic/ForensicReportView'

export const metadata: Metadata = { title: 'Báo cáo giám định' }

export default async function ForensicAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  return <ForensicReportView id={id} />
}
