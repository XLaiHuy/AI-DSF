import { parseForensicHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { ShieldCheck } from 'lucide-react'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Alert, AlertDescription, AlertTitle, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

export default async function ForensicPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const { claimedEntity, from } = parseForensicHandoff(await searchParams)

  return (
    <PlaceholderPage
      eyebrow="Phân hệ 3 · Lead"
      statusLabel="SCR-06 & SCR-07"
      title="Giám định tài chính"
      description="Kiểm tra điều khoản vay PDF, ảnh chụp chuyển khoản, mã VietQR và đối chiếu 7 Luật Cứng chống lừa đảo."
    >
      {claimedEntity && (
        <Alert variant="warning">
          <AlertTitle>Đã nhận yêu cầu kiểm tra đơn vị từ Bộ lọc Tin cậy</AlertTitle>
          <AlertDescription>
            Hồ sơ cần đối chiếu chéo với danh sách cảnh báo NCSC và 18 tổ chức tài chính hợp pháp.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-primary" aria-hidden="true" />
            <Badge variant={claimedEntity ? 'warning' : 'info'}>
              {claimedEntity ? 'Luồng 4 · Trust Filter ➔ Forensic' : 'Sẵn sàng Phase 2'}
            </Badge>
          </div>
          <CardTitle className="pt-1">Khung tiếp nhận tài liệu & VietQR</CardTitle>
          <CardDescription>
            Các widget tải tệp, bộ đếm 7 Luật Cứng và kết quả 3 mức An toàn / Cảnh báo / Nguy hiểm sẽ đặt tại{' '}
            <code className="font-mono text-xs text-foreground">src/components/forensic/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {claimedEntity ? (
            <dl className="divide-y divide-border rounded-lg border border-border bg-muted/40 px-4">
              <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <dt className="text-muted-foreground">Đơn vị cần kiểm tra</dt>
                <dd className="font-mono font-semibold text-foreground break-all">{claimedEntity}</dd>
              </div>
              {from === 'trust-filter' && (
                <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <dt className="text-muted-foreground">Chuyển từ</dt>
                  <dd className="font-medium text-foreground">Bộ lọc tin cậy (Khảo sát)</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Chưa có tham số <code className="font-mono text-xs text-foreground">claimedEntity</code> trong URL.
            </p>
          )}
        </CardContent>
      </Card>
    </PlaceholderPage>
  )
}
