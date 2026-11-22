import { parseSurveyHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { Calculator } from 'lucide-react'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

export default async function SurveyPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const { amount, term, shockDelta, from, articleId, auditId } = parseSurveyHandoff(await searchParams)
  const values = [
    ['Số tiền', amount && `${amount} VND`],
    ['Kỳ hạn', term === undefined ? undefined : `${term} tháng`],
    ['Thay đổi lãi suất', shockDelta && `${shockDelta} điểm phần trăm`],
    ['Chuyển từ', from && (from === 'radar' ? 'Radar' : 'Giám định')],
    ['Mã bài viết', articleId],
    ['Mã báo cáo', auditId],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined)

  return (
    <PlaceholderPage
      eyebrow="Phân hệ 2 · Tân"
      statusLabel="SCR-04 & SCR-05"
      title="Khảo sát và tính toán"
      description="So sánh khoản vay, xem lựa chọn tích lũy, phân tích DTI và mô phỏng cú sốc lãi suất bằng decimal.js."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator size={17} className="text-primary" aria-hidden="true" />
            <Badge variant={values.length > 0 ? 'safe' : 'secondary'}>
              {values.length > 0 ? 'Đã nhận tham số URL Handoff' : 'Chế độ mở trực tiếp'}
            </Badge>
          </div>
          <CardTitle className="pt-1">Trạng thái tham số đầu vào (Ổ cắm 3)</CardTitle>
          <CardDescription>
            Thành phần 3 tabs, bảng đối chiếu, biểu đồ và lịch trả nợ của Tân sẽ đặt tại{' '}
            <code className="font-mono text-xs text-foreground">src/components/survey/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {values.length > 0 ? (
            <dl className="divide-y divide-border rounded-lg border border-border bg-muted/40 px-4">
              {values.map(([label, value]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono font-semibold text-foreground font-numeric break-all">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Chưa có tham số truy vấn. Hãy thử nút khảo sát mẫu từ Trang chủ hoặc trang chi tiết Radar.
            </p>
          )}
        </CardContent>
      </Card>
    </PlaceholderPage>
  )
}
