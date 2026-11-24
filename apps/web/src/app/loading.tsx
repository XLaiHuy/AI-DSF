export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status">
      <span className="sr-only">Đang tải trang…</span>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-8 w-52 rounded-md bg-muted" />
        <div className="h-4 w-full max-w-sm rounded bg-muted" />
        <div className="mt-6 h-28 rounded-xl border border-border bg-card" />
      </div>
    </div>
  )
}
