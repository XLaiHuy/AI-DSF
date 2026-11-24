'use client'

import { parseForensicHandoff } from '@fincopilot/shared-types'
import { useSearchParams } from 'next/navigation'
import { ForensicWorkbench } from './ForensicWorkbench'

export function ForensicRouteWorkbench(props: { uploadMaxMb: number; pdfMaxPages: number }) {
  const params = useSearchParams()
  const values = params.getAll('claimedEntity')
  const { claimedEntity } = parseForensicHandoff({ claimedEntity: values.length > 1 ? values : values[0] })
  return <ForensicWorkbench key={claimedEntity} claimedEntity={claimedEntity} {...props} />
}
