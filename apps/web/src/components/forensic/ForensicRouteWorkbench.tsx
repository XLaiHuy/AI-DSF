'use client'

import { parseForensicHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { useSearchParams } from 'next/navigation'
import { ForensicWorkbench } from './ForensicWorkbench'

export function ForensicRouteWorkbench(props: { uploadMaxMb: number; pdfMaxPages: number }) {
  const params = useSearchParams()
  const fields: RouteSearchParams = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    fields[key] = values.length === 1 ? values[0] : values
  }
  const handoff = parseForensicHandoff(fields)
  return <ForensicWorkbench key={params.toString()} handoff={{
    ...handoff, from: handoff.from ?? (handoff.claimedEntity ? 'trust-filter' : undefined),
  }} {...props} />
}
