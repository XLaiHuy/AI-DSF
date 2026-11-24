'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ApiError, apiClient } from '@/lib/api-client'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/components/ui'

type Candidate = {
  id: string; title: string; canonicalUrl: string; imageUrl: string; imageAlt: string | null
  imageCredit: string | null; imageSourceUrl: string | null; imageLicenseStatus: string
  sources: Array<{ sourceName: string; url: string }>
}
type ReviewHistory = { id: string; previousStatus: string; decisionStatus: string; rightsBasis: string | null; licenseIdentifier: string | null; licenseUrl: string | null; evidenceUrl: string | null; note: string; reviewerLabel: string; reviewedAt: string; article: { id: string; title: string; canonicalUrl: string } }
type ReviewPayload = {
  imageLicenseStatus: 'PERMITTED' | 'REVIEW_REQUIRED' | 'PROHIBITED'
  rightsBasis: 'PUBLISHER_PERMISSION' | 'OPEN_LICENSE' | 'PUBLIC_DOMAIN' | 'FINCOPILOT_OWNED' | null
  licenseIdentifier: string | null; licenseUrl: string | null; evidenceUrl: string | null
  imageCredit: string; note: string; reviewerLabel: string
}

const basisLabels: Record<NonNullable<ReviewPayload['rightsBasis']>, string> = {
  PUBLISHER_PERMISSION: 'Cho phép trực tiếp từ nhà xuất bản/chủ sở hữu',
  OPEN_LICENSE: 'Giấy phép mở (ví dụ CC BY)',
  PUBLIC_DOMAIN: 'Miền công cộng (có căn cứ)',
  FINCOPILOT_OWNED: 'Tài sản gốc do FINCOPILOT sở hữu',
}

function ImageCandidate({ candidate }: { candidate: Candidate }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ReviewPayload['imageLicenseStatus']>('REVIEW_REQUIRED')
  const [basis, setBasis] = useState<ReviewPayload['rightsBasis']>('PUBLISHER_PERMISSION')
  const [licenseIdentifier, setLicenseIdentifier] = useState('')
  const [licenseUrl, setLicenseUrl] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [imageCredit, setImageCredit] = useState(candidate.imageCredit ?? '')
  const [reviewerLabel, setReviewerLabel] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const review = useMutation({
    mutationFn: (payload: ReviewPayload) => apiClient.patch(`/admin/radar/articles/${candidate.id}/image-rights`, payload),
    onSuccess: () => {
      setMessage('Quyết định đã lưu vào lịch sử rà soát.')
      void queryClient.invalidateQueries({ queryKey: ['admin-radar-image-rights'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-radar-image-rights-history'] })
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Không lưu được quyết định.'),
  })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    review.mutate({
      imageLicenseStatus: status,
      rightsBasis: status === 'PERMITTED' ? basis : null,
      licenseIdentifier: status === 'PERMITTED' ? licenseIdentifier.trim() || null : null,
      licenseUrl: status === 'PERMITTED' ? licenseUrl.trim() || null : null,
      evidenceUrl: evidenceUrl.trim() || null,
      imageCredit: imageCredit.trim(),
      note: note.trim(), reviewerLabel: reviewerLabel.trim(),
    })
  }

  return <article className="image-rights-review-item">
    <div className="image-rights-review-art">
      <img src={candidate.imageUrl} alt={candidate.imageAlt ?? 'Ảnh ứng viên đang chờ rà soát'} loading="lazy" referrerPolicy="no-referrer" />
      <span>{candidate.imageLicenseStatus}</span>
    </div>
    <div className="image-rights-review-copy">
      <p className="image-rights-review-source">{candidate.sources.map((source) => source.sourceName).join(' · ') || 'Chưa rõ nhà xuất bản'}</p>
      <h3><a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">{candidate.title}<ExternalLink size={13} aria-hidden="true" /></a></h3>
      <p className="image-rights-review-url">Ứng viên ảnh: <a href={candidate.imageUrl} target="_blank" rel="noreferrer">{candidate.imageUrl}</a></p>
      <form className="image-rights-review-form" onSubmit={submit}>
        <label>Quyết định
          <select value={status} onChange={(event) => setStatus(event.target.value as ReviewPayload['imageLicenseStatus'])}>
            <option value="REVIEW_REQUIRED">Tiếp tục chờ rà soát</option>
            <option value="PERMITTED">Cho phép hiển thị</option>
            <option value="PROHIBITED">Không cho phép</option>
          </select>
        </label>
        {status === 'PERMITTED' && <>
          <label>Ghi công ảnh
            <Input value={imageCredit} onChange={(event) => setImageCredit(event.target.value)} placeholder="Tên tác giả/chủ sở hữu theo điều kiện sử dụng" required />
          </label>
          <label>Căn cứ quyền sử dụng
            <select value={basis ?? ''} onChange={(event) => setBasis(event.target.value as ReviewPayload['rightsBasis'])}>
              {Object.entries(basisLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Tên giấy phép / loại quyền
            <Input value={licenseIdentifier} onChange={(event) => setLicenseIdentifier(event.target.value)} placeholder="Ví dụ: CC BY 4.0 hoặc văn bản cho phép" required />
          </label>
          {basis === 'OPEN_LICENSE' && <label>Trang điều khoản giấy phép
            <Input type="url" inputMode="url" value={licenseUrl} onChange={(event) => setLicenseUrl(event.target.value)} placeholder="https://…" required />
          </label>}
        </>}
        <label>Liên kết bằng chứng quyền sử dụng (HTTPS)
          <Input type="url" inputMode="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…/terms-or-permission-for-this-image" required={status === 'PERMITTED'} />
        </label>
        <div className="image-rights-review-grid">
          <label>Nhãn người rà soát
            <Input value={reviewerLabel} onChange={(event) => setReviewerLabel(event.target.value)} minLength={2} maxLength={120} required placeholder="Tên hoặc mã người rà soát" />
          </label>
          <label>Ghi chú quyết định
            <Input value={note} onChange={(event) => setNote(event.target.value)} minLength={8} maxLength={2000} required placeholder="Nêu phạm vi, điều kiện hoặc lý do từ chối" />
          </label>
        </div>
        <p className="image-rights-review-disclaimer">Chỉ chọn “Cho phép hiển thị” sau khi đã mở và kiểm tra căn cứ cho đúng ảnh này. Nhãn người rà soát hiện do người dùng nhập; Admin API chưa xác thực danh tính từng người.</p>
        {message && <p role="status" className="image-rights-review-message">{message}</p>}
        <Button type="submit" disabled={review.isPending}>{review.isPending ? 'Đang lưu…' : 'Lưu quyết định'}</Button>
      </form>
    </div>
  </article>
}

export default function ImageRightsReviewQueue() {
  const query = useQuery({ queryKey: ['admin-radar-image-rights'], queryFn: () => apiClient.get<Candidate[]>('/admin/radar/images/review') })
  const history = useQuery({ queryKey: ['admin-radar-image-rights-history'], queryFn: () => apiClient.get<ReviewHistory[]>('/admin/radar/images/reviews') })
  return <Card className="image-rights-review-card">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><ShieldCheck size={18} aria-hidden="true" /> Rà soát quyền ảnh</CardTitle>
      <CardDescription>Ảnh RSS luôn bắt đầu ở UNKNOWN. Chỉ ảnh được rà soát theo đúng nguồn và căn cứ mới được xuất hiện trên Radar.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {query.isPending && <p role="status">Đang tải ảnh cần rà soát…</p>}
      {query.isError && <p role="alert">Không tải được hàng đợi rà soát quyền ảnh.</p>}
      {query.data?.length === 0 && <p>Không có ảnh RSS đang chờ rà soát.</p>}
      {query.data?.map((candidate) => <ImageCandidate key={candidate.id} candidate={candidate} />)}
      <section className="image-rights-history" aria-labelledby="image-rights-history-heading">
        <h3 id="image-rights-history-heading">Lịch sử quyết định quyền ảnh</h3>
        {history.isPending && <p role="status">Đang tải lịch sử…</p>}
        {history.isError && <p role="alert">Không tải được lịch sử quyết định.</p>}
        {history.data?.length === 0 && <p>Chưa có quyết định nào được ghi nhận.</p>}
        {history.data?.map((item) => <article key={item.id}>
          <p><strong>{item.article.title}</strong> · {item.previousStatus} → {item.decisionStatus}</p>
          <p>{item.reviewerLabel} · {new Date(item.reviewedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {item.rightsBasis ?? 'Chưa ghi căn cứ'}</p>
          <p>{item.note}</p>
          <p>{item.licenseIdentifier ?? 'Chưa ghi mã giấy phép'}{item.licenseUrl && <> · <a href={item.licenseUrl} target="_blank" rel="noreferrer">Điều khoản</a></>}{item.evidenceUrl && <> · <a href={item.evidenceUrl} target="_blank" rel="noreferrer">Bằng chứng</a></>}</p>
        </article>)}
      </section>
    </CardContent>
  </Card>
}
