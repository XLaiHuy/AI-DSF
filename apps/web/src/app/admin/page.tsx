import { SlidersHorizontal } from 'lucide-react'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

export default function AdminPage() {
  return (
    <PlaceholderPage
      eyebrow="Quản trị · Tài"
      statusLabel="SCR-09"
      title="Quản trị hệ thống"
      description="Quản lý 5 nguồn thu thập Radar, theo dõi trạng thái crawl và cập nhật danh mục 18 tổ chức / sản phẩm tài chính."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={17} className="text-primary" aria-hidden="true" />
            <Badge variant="warning">Bảo vệ bởi AdminGuard</Badge>
          </div>
          <CardTitle className="pt-1">Bảng điều khiển nguồn Radar & Sản phẩm</CardTitle>
          <CardDescription>
            Giao diện chi tiết đặt tại <code className="font-mono text-xs text-foreground">src/components/admin/</code>, gọi qua các route <code className="font-mono text-xs text-foreground">/api/v1/admin/*</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Trong môi trường production, các endpoint quản trị yêu cầu header <code className="font-mono text-xs text-foreground">x-admin-key</code> hoặc cơ chế xác thực quản trị tương ứng.
          </p>
        </CardContent>
      </Card>
    </PlaceholderPage>
  )
}
