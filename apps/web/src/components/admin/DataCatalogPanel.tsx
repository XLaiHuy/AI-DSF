'use client'

import { AdminProductSyncResultSchema, CalcMethod, ProductCategory, RateType, ThreatCrawlStatsSchema } from '@fincopilot/shared-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Badge, Button } from '@/components/ui'
import { formatVietnamTime, requestError } from '@/lib/workspace-data'
import { adminClient, adminField, type AdminCredentials } from './admin-client'

type Source = {
  id: string; sourceKey: string; name: string; sourceType: string; isTrustedForAlerts: boolean; isActive: boolean;
  lastFetchStatus: string | null; lastAttemptAt: string | null; _count: { articles: number }
}
type Product = {
  id: string; institutionId: string; productName: string; productCategory: string; calcMethod: string; rateType: string;
  nominalRateMin: string; nominalRateMax: string; promoMonths: number | null; floatingMargin: string | null;
  upfrontFeeRate: string; monthlyFeeVnd: string; earlySettlementFeeRate: string;
  minAmountVnd: string; maxAmountVnd: string; minTermMonths: number; maxTermMonths: number;
  effectiveDate: string; isActive: boolean; sourceUrl: string; dataProvenance: string; institution: { name: string }
}
type Institution = { id: string; name: string }

function CatalogTable({ title, headers, children }: { title: string; headers: string[]; children: ReactNode }) {
  return <div tabIndex={0} role="region" aria-label={title} className="max-h-[34rem] overflow-auto rounded-xl border border-border bg-card focus-visible:ring-2 focus-visible:ring-ring">
    <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left text-sm">
      <caption className="sr-only">{title}</caption>
      <thead className="sticky top-0 z-10 bg-muted"><tr>{headers.map((heading) => <th key={heading} scope="col" className="border-b px-3 py-2.5 font-medium">{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}
const cell = 'border-b border-border px-3 py-2.5 align-middle'

export function DataCatalogPanel({ credentials }: { credentials: AdminCredentials }) {
  const client = adminClient(credentials)
  const queryClient = useQueryClient()
  const stem = ['admin', credentials.revision] as const
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const editor = useRef<HTMLDivElement>(null)
  const schedulers = useQuery({ queryKey: [...stem, 'schedulers'], retry: false,
    queryFn: client.schedulers })
  const all = useMutation({ mutationFn: client.hotCrawlAll,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stem }) })
  const sources = useQuery({ queryKey: [...stem, 'sources'], queryFn: () => client.get<Source[]>('/radar/sources'), retry: false, gcTime: 0 })
  const products = useQuery({ queryKey: [...stem, 'products'], queryFn: () => client.get<Product[]>('/products'), retry: false, gcTime: 0 })
  const institutions = useQuery({ queryKey: [...stem, 'institutions'], queryFn: () => client.get<Institution[]>('/institutions'), enabled: editing !== null, retry: false, gcTime: 0 })
  const crawl = useMutation({ mutationFn: (sourceKey: string) => client.post('/crawl-now', { sourceKey }, ThreatCrawlStatsSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: stem }) } })
  const save = useMutation({ mutationFn: ({ id, values }: { id?: string; values: Record<string, unknown> }) =>
    id ? client.patch(`/products/${id}`, values) : client.post('/products', values),
  onSuccess: () => { setEditing(null); void queryClient.invalidateQueries({ queryKey: [...stem, 'products'] }) } })
  const toggle = useMutation({ mutationFn: (product: Product) => client.patch(`/products/${product.id}`, { isActive: !product.isActive }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [...stem, 'products'] }) } })
  const sync = useMutation({ mutationFn: () => client.post('/products/sync', {}, AdminProductSyncResultSchema),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [...stem, 'products'] }) } })
  const openEditor = (product: Product | 'new') => {
    setEditing(product)
    save.reset()
    requestAnimationFrame(() => editor.current?.querySelector('input')?.focus())
  }
  return <div className="space-y-7">
    <section className="space-y-3" aria-labelledby="catalog-schedulers">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="catalog-schedulers" className="text-lg font-semibold">Lịch cập nhật dữ liệu</h2>
        <Button type="button" disabled={all.isPending} onClick={() => all.mutate()}>{all.isPending ? 'Đang cập nhật…' : 'Thu thập ngay từ mọi nguồn'}</Button></div>
      {schedulers.isError && <p role="alert">Chưa tải được lịch cập nhật.</p>}
      {schedulers.data && <CatalogTable title="Lịch tự động" headers={['Luồng dữ liệu', 'Chu kỳ', 'Trạng thái', 'Lần tới']}>
        {schedulers.data.map(row => <tr key={row.name}><th className={cell} scope="row">{row.name}</th><td className={cell}>{row.intervalLabel}</td>
          <td className={cell}>{row.scheduled ? 'Đã lên lịch' : 'Chưa lên lịch'}</td><td className={cell}>{row.nextAt ? formatVietnamTime(row.nextAt) : '—'}</td></tr>)}
      </CatalogTable>}
      {all.isError && <p role="alert">Không thể bắt đầu cập nhật.</p>}
      {all.data && <ul role="status">{all.data.map(row => <li key={row.name}>{row.name} · {row.summary ?? 'Lỗi'}</li>)}</ul>}
    </section>
    <section aria-labelledby="catalog-sources" className="space-y-3">
      <h2 id="catalog-sources" className="text-lg font-semibold">Nguồn Radar</h2>
      {sources.isError && <p role="alert" className="text-sm text-destructive">{requestError(sources.error, 'Không đọc được nguồn Radar.')}</p>}
      {sources.isPending && <p role="status" className="text-sm text-muted-foreground">Đang tải nguồn…</p>}
      {sources.data && <CatalogTable title="Nguồn Radar" headers={['Nguồn', 'Loại', 'Tin', 'Lần quét gần nhất', 'Trạng thái', 'Thao tác']}>
        {sources.data.map((source) => <tr key={source.id}>
          <th scope="row" className={cell + ' font-medium'}>{source.name}{source.isTrustedForAlerts && <Badge variant="safe" className="ml-2">Tin cậy</Badge>}</th>
          <td className={cell}>{source.sourceType}</td><td className={cell + ' tabular-nums'}>{source._count.articles}</td>
          <td className={cell}>{source.lastAttemptAt ? formatVietnamTime(source.lastAttemptAt) : 'Chưa chạy'}</td>
          <td className={cell}><Badge variant={source.lastFetchStatus === 'ERROR' ? 'danger' : source.lastFetchStatus === 'SUCCESS' ? 'safe' : 'secondary'}>
            {source.lastFetchStatus === 'ERROR' ? 'Lỗi' : source.lastFetchStatus === 'SUCCESS' ? 'Thành công' : 'Chưa chạy'}</Badge></td>
          <td className={cell}><Button type="button" variant="outline" size="sm" disabled={!source.isActive || crawl.isPending}
            aria-label={`Hot Crawl ${source.name}`} onClick={() => crawl.mutate(source.sourceKey)}>
            <RefreshCw size={14} aria-hidden="true" /> {crawl.isPending && crawl.variables === source.sourceKey ? 'Đang quét…' : 'Hot Crawl'}
          </Button></td>
        </tr>)}
      </CatalogTable>}
      {crawl.data && <p role="status" className="text-sm text-muted-foreground">{crawl.data.newArticles} tin mới · {crawl.data.newProposals} đề xuất · {crawl.data.skippedDuplicates} mục trùng</p>}
      {crawl.isError && <p role="alert" className="text-sm text-destructive">{requestError(crawl.error, 'Không quét được nguồn.')}</p>}
    </section>
    <section aria-labelledby="catalog-products" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="catalog-products" className="text-lg font-semibold">Kho sản phẩm</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Đang đồng bộ…' : 'Đồng bộ lãi suất uy tín'}
          </Button>
          <Button type="button" onClick={() => openEditor('new')}><Plus size={15} aria-hidden="true" /> Thêm sản phẩm</Button>
        </div>
      </div>
      {sync.data && <p role="status" className="text-sm text-muted-foreground">
        Truy cập được {sync.data.sourcesReachable}/{sync.data.sourcesChecked} nguồn · {sync.data.productsUpserted} gói đã đồng bộ · {sync.data.productsActivated} gói được kích hoạt
      </p>}
      {sync.isError && <p role="alert" className="text-sm text-destructive">{requestError(sync.error, 'Không đồng bộ được danh mục lãi suất.')}</p>}
      {products.isError && <p role="alert" className="text-sm text-destructive">{requestError(products.error, 'Không đọc được kho sản phẩm.')}</p>}
      {products.isPending && <p role="status" className="text-sm text-muted-foreground">Đang tải sản phẩm…</p>}
      {products.data?.length === 0 && <p className="text-sm text-muted-foreground">Kho sản phẩm đang trống.</p>}
      {products.data && products.data.length > 0 && <CatalogTable title="Kho sản phẩm" headers={['Sản phẩm', 'Lãi suất', 'Hiệu lực', 'Trạng thái', 'Thao tác']}>
        {products.data.map((product) => <tr key={product.id}>
          <th scope="row" className={cell + ' font-medium'}><span className="block">{product.productName}</span>
            <span className="text-xs font-normal text-muted-foreground">{product.institution.name}</span></th>
          <td className={cell + ' whitespace-nowrap tabular-nums'}>{product.nominalRateMin}%–{product.nominalRateMax}%</td>
          <td className={cell + ' whitespace-nowrap'}>{product.effectiveDate.slice(0, 10).split('-').reverse().join('/')}</td>
          <td className={cell}><Badge variant={product.isActive ? 'safe' : 'secondary'}>{product.isActive ? 'Đang dùng' : 'Đã tắt'}</Badge></td>
          <td className={cell}><div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(product)}>{product.isActive ? 'Tắt' : 'Bật'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openEditor(product)}>Sửa</Button>
          </div></td>
        </tr>)}
      </CatalogTable>}
      {toggle.isError && <p role="alert" className="text-sm text-destructive">{requestError(toggle.error, 'Không đổi được trạng thái sản phẩm.')}</p>}
      {editing && <div ref={editor} className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-semibold">{editing === 'new' ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}</h3>
        <ProductForm key={editing === 'new' ? editing : editing.id} product={editing === 'new' ? undefined : editing}
          institutions={institutions.data ?? []} pending={save.isPending} close={() => setEditing(null)}
          onSave={(values) => save.mutate({ id: editing === 'new' ? undefined : editing.id, values })} />
        {save.isError && <p role="alert" className="mt-3 text-sm text-destructive">{requestError(save.error, 'Không lưu được sản phẩm.')}</p>}
      </div>}
    </section>
  </div>
}

function ProductForm({ product, institutions, pending, close, onSave }: {
  product?: Product; institutions: Institution[]; pending: boolean; close: () => void; onSave: (values: Record<string, unknown>) => void
}) {
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
    event.preventDefault()
    const values: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget))
    for (const field of ['minTermMonths', 'maxTermMonths', 'promoMonths']) {
      if (field in values) values[field] = values[field] ? Number(values[field]) : null
    }
    if (!values.floatingMargin) values.floatingMargin = null
    for (const field of ['upfrontFeeRate', 'monthlyFeeVnd', 'earlySettlementFeeRate']) {
      if (!values[field]) delete values[field]
    }
    values.isActive = values.isActive === 'on'
    onSave(values)
  }}>
    <label className="grid gap-1 text-sm">Tên sản phẩm<input className={adminField} name="productName" required maxLength={200} defaultValue={product?.productName} /></label>
    <label className="grid gap-1 text-sm">Tổ chức
      <select className={adminField} name="institutionId" required defaultValue={product?.institutionId ?? ''}>
        <option value="" disabled>Chọn tổ chức</option>
        {product && !institutions.some(({ id }) => id === product.institutionId) && <option value={product.institutionId}>{product.institution.name}</option>}
        {institutions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    {([
      ['productCategory', 'Nhóm sản phẩm', ProductCategory.options],
      ['calcMethod', 'Cách tính', CalcMethod.options],
      ['rateType', 'Loại lãi suất', RateType.options],
      ['dataProvenance', 'Nguồn xác nhận', ['CATALOG_VERIFIED', 'WEB_REFERENCE']],
    ] as const).map(([name, label, options]) => <label className="grid gap-1 text-sm" key={name}>{label}
      <select className={adminField} name={name} defaultValue={product?.[name] ?? options[0]}>{options.map((option) => <option key={option}>{option}</option>)}</select>
    </label>)}
    {([
      ['nominalRateMin', 'Lãi suất thấp nhất (%)', true], ['nominalRateMax', 'Lãi suất cao nhất (%)', true],
      ['minAmountVnd', 'Số tiền tối thiểu (đ)', true], ['maxAmountVnd', 'Số tiền tối đa (đ)', true],
      ['upfrontFeeRate', 'Phí ban đầu (%)', false], ['monthlyFeeVnd', 'Phí hằng tháng (đ)', false],
      ['earlySettlementFeeRate', 'Phí tất toán sớm (%)', false], ['floatingMargin', 'Biên độ lãi suất (%)', false],
    ] as const).map(([name, label, required]) => <label className="grid gap-1 text-sm" key={name}>{label}
      <input className={adminField} name={name} inputMode="decimal" pattern="[0-9]+([.][0-9]+)?" required={required} defaultValue={product?.[name] ?? ''} />
    </label>)}
    {([['minTermMonths', 'Kỳ hạn tối thiểu (tháng)', true], ['maxTermMonths', 'Kỳ hạn tối đa (tháng)', true], ['promoMonths', 'Thời gian ưu đãi (tháng)', false]] as const)
      .map(([name, label, required]) => <label className="grid gap-1 text-sm" key={name}>{label}
        <input className={adminField} type="number" name={name} min={1} step={1} required={required} defaultValue={product?.[name] ?? ''} />
      </label>)}
    <label className="grid gap-1 text-sm">Ngày hiệu lực<input className={adminField} name="effectiveDate" type="date" required defaultValue={product?.effectiveDate.slice(0, 10)} /></label>
    <label className="grid gap-1 text-sm sm:col-span-2">URL tham chiếu<input className={adminField} name="sourceUrl" type="url" required defaultValue={product?.sourceUrl} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" className="accent-primary" defaultChecked={product?.isActive ?? false} /> Bật sản phẩm</label>
    <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={pending}>{pending ? 'Đang lưu…' : 'Lưu sản phẩm'}</Button>
      <Button type="button" variant="outline" onClick={close}>Hủy</Button></div>
  </form>
}
