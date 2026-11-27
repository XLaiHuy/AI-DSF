'use client'

import { UserAuditFeedbackResponseSchema, UserAuditFeedbackSchema, type ForensicAuditResponse, type UserAuditFeedback } from '@fincopilot/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Button, Label } from '@/components/ui'
import { apiClient, ApiError } from '@/lib/api-client'
import { auditQuery, requestError } from '@/lib/workspace-data'

export function AuditFeedback({ audit }: { audit: ForensicAuditResponse }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const queries = useQueryClient()
  const submission = useMutation({
    mutationFn: (input: UserAuditFeedback) =>
      apiClient.post('/forensic/audits/' + audit.auditId + '/feedback', input, { schema: UserAuditFeedbackResponseSchema }),
    onSuccess: result => {
      const userFeedback = { assessment: result.assessment, reviewStatus: result.reviewStatus, createdAt: result.createdAt }
      queries.setQueryData(auditQuery(audit.auditId).queryKey, { ...audit, userFeedback })
    },
  })
  const status = audit.userFeedback?.reviewStatus ?? submission.data?.reviewStatus
  const duplicate = submission.error instanceof ApiError && submission.error.status === 409
  const complete = Boolean(status || duplicate)
  return <section className="print-hidden space-y-3 border-y border-border py-4" aria-labelledby={id + '-heading'}>
    <h2 id={id + '-heading'} className="text-lg font-semibold">Góp ý chất lượng giám định</h2>
    {complete ? <p role="status" className="text-sm">
      {status === 'APPROVED' ? 'Góp ý của bạn đã được duyệt.' :
        status === 'REJECTED' ? 'Góp ý của bạn đã được quản trị viên xem xét.' :
          status === 'PENDING' ? 'Đã gửi góp ý. Phản hồi đang chờ kiểm duyệt.' : 'Bạn đã gửi góp ý cho báo cáo này.'}
    </p> : <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={submission.isPending} onClick={() => submission.mutate({ assessment: 'ACCURATE' })}>Chính xác</Button>
        <Button type="button" variant="outline" disabled={submission.isPending} aria-expanded={open} aria-controls={id + '-form'}
          onClick={() => { submission.reset(); setOpen(!open) }}>Báo sai / Chưa đủ</Button>
      </div>
      <form id={id + '-form'} hidden={!open} onSubmit={event => {
        event.preventDefault()
        if (submission.isPending) return
        const form = new FormData(event.currentTarget)
        const parsed = UserAuditFeedbackSchema.safeParse({
          assessment: 'INCORRECT', suggestedVerdict: form.get('verdict') || undefined, note: form.get('note') || undefined,
        })
        if (parsed.success) submission.mutate(parsed.data)
      }}>
        <fieldset disabled={submission.isPending} className="grid max-w-xl gap-2">
          <Label htmlFor={id + '-verdict'}>Mức rủi ro bạn đề xuất</Label>
          <select id={id + '-verdict'} name="verdict" className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm">
            <option value="">Chưa xác định</option>
            <option value="SAFE">An toàn</option>
            <option value="CAUTION">Cần thận trọng</option>
            <option value="HIGH_RISK">Nguy hiểm cao</option>
          </select>
          <Label htmlFor={id + '-note'}>Ghi chú (tùy chọn)</Label>
          <textarea id={id + '-note'} name="note" rows={2} maxLength={500} className="w-full rounded-md border border-border bg-card p-3 text-sm" />
          <Button type="submit" className="justify-self-start">{submission.isPending ? 'Đang gửi…' : 'Gửi góp ý'}</Button>
        </fieldset>
      </form>
      {submission.isPending && <p role="status" className="sr-only">Đang gửi góp ý.</p>}
      {submission.isError && <p role="alert" className="text-sm text-verdict-danger">{requestError(submission.error, 'Chưa thể gửi góp ý. Hãy thử lại.')}</p>}
    </>}
  </section>
}
