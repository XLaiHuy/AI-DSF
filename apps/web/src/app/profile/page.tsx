import { CircleUserRound } from 'lucide-react'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

export default function ProfilePage() {
  return (
    <PlaceholderPage
      eyebrow="Phân hệ 0 · Lead"
      statusLabel="SCR-08"
      title="Hồ sơ tài chính"
      description="Thông tin thu nhập, chi phí, nghĩa vụ nợ hiện tại và mục tiêu tiết kiệm (ngữ cảnh R07) sẽ được quản lý ở đây."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CircleUserRound size={17} className="text-primary" aria-hidden="true" />
            <Badge variant="info">Guest Cookie & Google OAuth</Badge>
          </div>
          <CardTitle className="pt-1">Ngữ cảnh tài chính cá nhân & Bảo mật</CardTitle>
          <CardDescription>
            Phiên khách sử dụng cookie ký điện tử HttpOnly từ Backend và đồng bộ qua Ổ cắm 4 (<code className="font-mono text-xs text-foreground">apiClient</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Dữ liệu hồ sơ tại đây được dùng chung cho Radar (lọc tác động R07) và Khảo sát (tự động tính tỷ lệ DTI).
          </p>
        </CardContent>
      </Card>
    </PlaceholderPage>
  )
}
