'use client'

import { parseForensicHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { useSearchParams } from 'next/navigation'
import { useWorkspaceSession } from '@/components/layout/WorkspaceSessionContext'
import { ForensicWorkbench } from './ForensicWorkbench'

export function ForensicRouteWorkbench(props: { uploadMaxMb: number; pdfMaxPages: number }) {
  const params = useSearchParams()
  const { viewerKey } = useWorkspaceSession()
  const fields: RouteSearchParams = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    fields[key] = values.length === 1 ? values[0] : values
  }
  const handoff = parseForensicHandoff(fields)
  return <ForensicWorkbench key={viewerKey} handoff={{
    ...handoff, from: handoff.from ?? (handoff.claimedEntity ? 'trust-filter' : undefined),
  }} {...props} />
}
