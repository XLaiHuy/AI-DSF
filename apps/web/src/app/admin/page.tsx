'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ApiError, apiClient } from '@/lib/api-client'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

type Source = { id: string; sourceKey: string; name: string; sourceType: string; isTrustedForAlerts: boolean; isActive: boolean; lastFetchStatus: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; _count: { articles: number } }
type Product = { id: string; productName: string; productCategory: string; nominalRateMin: string; nominalRateMax: string; effectiveDate: string; isActive: boolean; sourceUrl: string; institution: { name: string } }
type Job = { jobId: string; state: string }

export default function AdminPage() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Product | null>(null)
  const [productJson, setProductJson] = useState('')
  const [message, setMessage] = useState('')
  const sources = useQuery({ queryKey: ['admin-radar-sources'], queryFn: () => apiClient.get<Source[]>('/admin/radar/sources') })
  const products = useQuery({ queryKey: ['admin-products'], queryFn: () => apiClient.get<Product[]>('/admin/products') })
  const fetchMutation = useMutation({ mutationFn: (sourceKey?: string) => apiClient.post<Job>('/admin/radar/fetch', { sourceKey }), onSuccess: (job) => { setMessage(`Đã đưa tác vụ ${job.jobId} vào hàng đợi.`); void queryClient.invalidateQueries({ queryKey: ['admin-radar-sources'] }) }, onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Không thể bắt đầu quét.') })
  const saveMutation = useMutation({ mutationFn: async () => {
    const body: unknown = JSON.parse(productJson)
    return selected ? apiClient.patch(`/admin/products/${selected.id}`, body) : apiClient.post('/admin/products', body)
  }, onSuccess: () => { setMessage('Đã lưu sản phẩm.'); setSelected(null); setProductJson(''); void queryClient.invalidateQueries({ queryKey: ['admin-products'] }) }, onError: (error) => setMessage(error instanceof ApiError ? error.message : 'JSON sai định dạng hoặc dữ liệu không hợp lệ.') })

  function editProduct(product: Product) {
    setSelected(product)
    setProductJson(JSON.stringify({ productName: product.productName, isActive: product.isActive, nominalRateMin: product.nominalRateMin, nominalRateMax: product.nominalRateMax, effectiveDate: product.effectiveDate.slice(0, 10), sourceUrl: product.sourceUrl }, null, 2))
  }

  return <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
    <header><p className="mb-2 text-sm text-primary">SCR-09 · DATA OPERATIONS</p><h1 className="text-3xl font-bold">Quản trị Radar</h1><p className="mt-2 text-muted-foreground">Theo dõi độ mới, thử lại nguồn lỗi và cập nhật catalog sản phẩm có nguồn tham chiếu.</p></header>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle>Nguồn Radar</CardTitle><CardDescription>Trạng thái quét gần nhất; lần quét lỗi không làm mới tin cũ.</CardDescription></div><Button onClick={() => fetchMutation.mutate(undefined)} disabled={fetchMutation.isPending}><Play size={15}/> Quét tất cả</Button></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Nguồn</th><th className="p-3">Loại</th><th className="p-3">Tin</th><th className="p-3">Quét gần nhất</th><th className="p-3">Trạng thái</th><th className="p-3">Thao tác</th></tr></thead><tbody>{sources.data?.map((source) => <tr key={source.id} className="border-b"><td className="p-3 font-medium">{source.name}{source.isTrustedForAlerts && <Badge className="ml-2" variant="safe">Nguồn tin cậy</Badge>}</td><td className="p-3">{source.sourceType}</td><td className="p-3">{source._count.articles}</td><td className="p-3">{source.lastAttemptAt ? new Date(source.lastAttemptAt).toLocaleString('vi-VN') : 'Chưa chạy'}</td><td className="p-3"><Badge variant={source.lastFetchStatus === 'ERROR' ? 'danger' : source.lastFetchStatus === 'SUCCESS' ? 'safe' : 'secondary'}>{source.lastFetchStatus ?? 'Chưa chạy'}</Badge></td><td className="p-3"><Button variant="outline" size="sm" onClick={() => fetchMutation.mutate(source.sourceKey)} disabled={fetchMutation.isPending}><RefreshCw size={14}/> {source.lastFetchStatus === 'ERROR' ? 'Thử lại' : 'Quét'}</Button></td></tr>)}</tbody></table>{sources.isError && <p role="alert" className="pt-4 text-sm">Không đọc được trạng thái. Hãy kiểm tra API key quản trị.</p>}</CardContent></Card>
    <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle>Sản phẩm tài chính</CardTitle><CardDescription>Chỉ lưu sản phẩm có nguồn công khai và ngày hiệu lực đã xác nhận.</CardDescription></div><Button variant="outline" onClick={() => { setSelected(null); setProductJson('{}'); }}><Plus size={15}/> Thêm sản phẩm</Button></CardHeader><CardContent className="space-y-4">{products.isError && <p role="alert">Không đọc được catalog. Kiểm tra quyền quản trị.</p>}<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Tổ chức</th><th className="p-3">Sản phẩm</th><th className="p-3">Lãi suất</th><th className="p-3">Hiệu lực</th><th className="p-3">Trạng thái</th><th className="p-3">Sửa</th></tr></thead><tbody>{products.data?.map((product) => <tr key={product.id} className="border-b"><td className="p-3">{product.institution.name}</td><td className="p-3">{product.productName}</td><td className="p-3">{product.nominalRateMin}%–{product.nominalRateMax}%</td><td className="p-3">{new Date(product.effectiveDate).toLocaleDateString('vi-VN')}</td><td className="p-3">{product.isActive ? 'Đang dùng' : 'Ngừng dùng'}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => editProduct(product)}>Sửa</Button></td></tr>)}</tbody></table></div>{products.data?.length === 0 && <p className="text-sm text-muted-foreground">Catalog chưa có dữ liệu được xác minh. Không nạp mức lãi suất mẫu chưa có nguồn dẫn.</p>}
      {(selected || productJson !== '') && <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate() }}><div><label className="text-sm font-medium" htmlFor="product-json">{selected ? `Sửa ${selected.productName}` : 'Payload sản phẩm (JSON)'}</label><p className="text-xs text-muted-foreground">Với sản phẩm mới, cung cấp đầy đủ trường bắt buộc trong FinancialProduct cùng `institutionId` và nguồn URL.</p></div><textarea id="product-json" className="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-xs" value={productJson} onChange={(event) => setProductJson(event.target.value)} placeholder={'{ "institutionId": "…", "productCategory": "UNSECURED_LOAN", ... }'}/><div className="flex gap-2"><Button type="submit" disabled={saveMutation.isPending}>Lưu</Button><Button type="button" variant="outline" onClick={() => { setSelected(null); setProductJson('') }}>Hủy</Button></div></form>}
    </CardContent></Card>
  </main>
}
