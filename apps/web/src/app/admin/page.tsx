'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ApiError, apiClient } from '@/lib/api-client'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import ImageRightsReviewQueue from '@/components/admin/ImageRightsReviewQueue'

type Source = { id: string; sourceKey: string; name: string; sourceType: string; isTrustedForAlerts: boolean; isActive: boolean; lastFetchStatus: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; _count: { articles: number } }
type Product = { id: string; productName: string; productCategory: string; nominalRateMin: string; nominalRateMax: string; effectiveDate: string; isActive: boolean; sourceUrl: string; institution: { name: string } }
type Job = { jobId: string; state: string }

const viDateTime = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
const viDate = (value: string) => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

export default function AdminPage() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Product | null>(null)
  const [productJson, setProductJson] = useState('')
  const [message, setMessage] = useState('')
  const sources = useQuery({ queryKey: ['admin-radar-sources'], queryFn: () => apiClient.get<Source[]>('/admin/radar/sources') })
  const products = useQuery({ queryKey: ['admin-products'], queryFn: () => apiClient.get<Product[]>('/admin/products') })
  const fetchMutation = useMutation({
    mutationFn: (sourceKey?: string) => apiClient.post<Job>('/admin/radar/fetch', { sourceKey }),
    onSuccess: (job) => { setMessage(`Đã đưa tác vụ ${job.jobId} vào hàng đợi.`); void queryClient.invalidateQueries({ queryKey: ['admin-radar-sources'] }) },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Không thể bắt đầu quét.'),
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: unknown = JSON.parse(productJson)
      return selected ? apiClient.patch(`/admin/products/${selected.id}`, body) : apiClient.post('/admin/products', body)
    },
    onSuccess: () => { setMessage('Đã lưu sản phẩm.'); setSelected(null); setProductJson(''); void queryClient.invalidateQueries({ queryKey: ['admin-products'] }) },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'JSON sai định dạng hoặc dữ liệu không hợp lệ.'),
  })

  function editProduct(product: Product) {
    setSelected(product)
    setProductJson(JSON.stringify({ productName: product.productName, isActive: product.isActive, nominalRateMin: product.nominalRateMin, nominalRateMax: product.nominalRateMax, effectiveDate: product.effectiveDate.slice(0, 10), sourceUrl: product.sourceUrl }, null, 2))
  }

  return <div className="admin-page space-y-8">
    <header>
      <p className="page-kicker">SCR-09 · QUẢN TRỊ NGUỒN DỮ LIỆU</p>
      <h1>Quản trị Radar</h1>
      <p>Theo dõi lần quét và cập nhật catalog sản phẩm từ nguồn có thể đối chiếu.</p>
    </header>
    {message && <p role="status" className="rounded-md border border-border px-3 py-2.5 text-sm">{message}</p>}

    <section aria-labelledby="sources-heading">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div><CardTitle id="sources-heading">Nguồn Radar</CardTitle><CardDescription>Trạng thái quét gần nhất; lần quét lỗi không làm mới tin cũ. Trên màn hình nhỏ, cuộn ngang để xem đủ cột.</CardDescription></div>
          <Button onClick={() => fetchMutation.mutate(undefined)} disabled={fetchMutation.isPending}><Play size={15} aria-hidden="true"/> Quét tất cả</Button>
        </CardHeader>
        <CardContent>
          {sources.isPending && <p role="status" className="py-4 text-sm text-muted-foreground">Đang tải trạng thái nguồn…</p>}
          {sources.isError && <p role="alert" className="pb-4 text-sm">Không đọc được trạng thái. Hãy kiểm tra API key quản trị.</p>}
          {sources.data && <div className="admin-table-scroll" role="region" aria-label="Bảng trạng thái nguồn Radar, cuộn ngang để xem mọi cột" tabIndex={0}>
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b text-muted-foreground"><th scope="col" className="p-3">Nguồn</th><th scope="col" className="p-3">Loại</th><th scope="col" className="p-3">Tin</th><th scope="col" className="p-3">Quét gần nhất</th><th scope="col" className="p-3">Trạng thái</th><th scope="col" className="p-3">Thao tác</th></tr></thead>
              <tbody>{sources.data.map((source) => <tr key={source.id} className="border-b">
                <td className="p-3 font-medium">{source.name}{source.isTrustedForAlerts && <Badge className="ml-2" variant="safe">Nguồn tin cậy</Badge>}</td>
                <td className="p-3">{source.sourceType}</td><td className="p-3 font-data font-numeric">{source._count.articles}</td>
                <td className="p-3">{source.lastAttemptAt ? viDateTime(source.lastAttemptAt) : 'Chưa chạy'}</td>
                <td className="p-3"><Badge variant={source.lastFetchStatus === 'ERROR' ? 'danger' : source.lastFetchStatus === 'SUCCESS' ? 'safe' : 'secondary'}>{source.lastFetchStatus ?? 'Chưa chạy'}</Badge></td>
                <td className="p-3"><Button variant="outline" size="sm" onClick={() => fetchMutation.mutate(source.sourceKey)} disabled={fetchMutation.isPending}><RefreshCw size={14} aria-hidden="true"/> {source.lastFetchStatus === 'ERROR' ? 'Thử lại' : 'Quét'}</Button></td>
              </tr>)}</tbody>
            </table>
          </div>}
        </CardContent>
      </Card>
    </section>

    <section aria-labelledby="products-heading">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div><CardTitle id="products-heading">Sản phẩm tài chính</CardTitle><CardDescription>Chỉ lưu sản phẩm có nguồn công khai và ngày hiệu lực đã xác nhận. Trên màn hình nhỏ, cuộn ngang để xem đủ cột.</CardDescription></div>
          <Button variant="outline" onClick={() => { setSelected(null); setProductJson('{}') }}><Plus size={15} aria-hidden="true"/> Thêm sản phẩm</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.isError && <p role="alert" className="text-sm">Không đọc được catalog. Kiểm tra quyền quản trị.</p>}
          {products.isPending && <p role="status" className="py-2 text-sm text-muted-foreground">Đang tải catalog…</p>}
          {products.data && <div className="admin-table-scroll" role="region" aria-label="Bảng sản phẩm tài chính, cuộn ngang để xem mọi cột" tabIndex={0}>
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead><tr className="border-b text-muted-foreground"><th scope="col" className="p-3">Tổ chức</th><th scope="col" className="p-3">Sản phẩm</th><th scope="col" className="p-3">Lãi suất</th><th scope="col" className="p-3">Hiệu lực</th><th scope="col" className="p-3">Trạng thái</th><th scope="col" className="p-3">Sửa</th></tr></thead>
              <tbody>{products.data.map((product) => <tr key={product.id} className="border-b">
                <td className="p-3">{product.institution.name}</td><td className="p-3">{product.productName}</td>
                <td className="p-3 font-data font-numeric">{product.nominalRateMin}%–{product.nominalRateMax}%</td><td className="p-3">{viDate(product.effectiveDate)}</td>
                <td className="p-3">{product.isActive ? 'Đang dùng' : 'Ngừng dùng'}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => editProduct(product)}>Sửa</Button></td>
              </tr>)}</tbody>
            </table>
          </div>}
          {products.data?.length === 0 && <p className="text-sm text-muted-foreground">Catalog chưa có dữ liệu được xác minh. Không nạp mức lãi suất mẫu chưa có nguồn dẫn.</p>}
          {(selected || productJson !== '') && <form className="admin-product-form space-y-3 border p-4" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate() }}>
            <div><label className="text-sm font-medium" htmlFor="product-json">{selected ? `Sửa ${selected.productName}` : 'Payload sản phẩm (JSON)'}</label><p id="product-json-help" className="text-xs text-muted-foreground">Với sản phẩm mới, cung cấp trường bắt buộc cùng institutionId và nguồn URL.</p></div>
            <textarea id="product-json" aria-describedby="product-json-help" className="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-xs" value={productJson} onChange={(event) => setProductJson(event.target.value)} placeholder={'{ "institutionId": "…", "productCategory": "UNSECURED_LOAN", ... }'}/>
            <div className="flex gap-2"><Button type="submit" disabled={saveMutation.isPending}>Lưu</Button><Button type="button" variant="outline" onClick={() => { setSelected(null); setProductJson('') }}>Hủy</Button></div>
          </form>}
        </CardContent>
      </Card>
    </section>
    <section aria-label="Rà soát quyền sử dụng ảnh Radar">
      <ImageRightsReviewQueue />
    </section>
  </div>
}
