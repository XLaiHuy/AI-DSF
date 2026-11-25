'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUpRight, ExternalLink, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { Button, Input } from '@/components/ui'
import { CategoryArtwork } from '@/components/radar/CategoryArtwork'
import { RadarDailyBrief, type DailyBriefResponse } from '@/components/radar/RadarDailyBrief'
import { ApiError, apiClient } from '@/lib/api-client'

type Source = { sourceKey: string; name: string; lastFetchStatus: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null }
type ArticleSource = { sourceName: string; url: string; firstSeenAt?: string | null; lastSeenAt?: string | null }
type Article = { id: string; title: string; canonicalUrl: string; publishedAt: string | null; image?: { url: string; alt: string; credit: string | null; sourceUrl: string | null } | null; categories: string[]; sources: ArticleSource[] }
type ArticlePage = { items: Article[]; page: { hasMore: boolean; nextCursor: string | null }; sources: Source[] }
type AlertItem = { id: string; threatCategory: string; tacticSummary: string; verificationStatus: string; publishedAt: string | null; evidence: { articleId?: string; sourceName: string; title?: string; url?: string }[] }
type Highlight = Article & { editorialPriority?: 'HIGH' | 'STANDARD'; priorityReasons?: string[] | null }
type RecommendationSignal = { categoryCode: string; source: 'PROFILE_GOAL' | 'SURVEY_TOPIC' | 'FORENSIC_HISTORY'; reason: string }

const categoryLabels: Record<string, string> = {
  INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính',
}
const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
})
const compactDateTimeFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
})

function formatDateTime(value: string | null | undefined, compact = false) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : (compact ? compactDateTimeFormat : dateTimeFormat).format(date)
}

function vietnamCalendarDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function msUntilNextVietnamDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const fields = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
  const nextMidnightUtc = Date.UTC(fields.year, fields.month - 1, fields.day + 1) - 7 * 60 * 60_000
  return Math.max(1_000, nextMidnightUtc - value.getTime() + 1_000)
}

function articleCategory(article: Article) {
  const category = article.categories[0]
  return category ? categoryLabels[category] ?? category : 'Tin thị trường'
}

function highlightReasons(item: Highlight) {
  return Array.isArray(item.priorityReasons) ? item.priorityReasons : []
}

function SourceLinks({ article, compact = false }: { article: Article; compact?: boolean }) {
  if (!article.sources.length) return <span className="radar-source-missing">Chưa rõ nguồn</span>
  return <span className="radar-source-links" aria-label="Nguồn gốc bài viết">
    {article.sources.map((source, index) => <span className="radar-source-item" key={`${source.sourceName}-${source.url}`}>
      {index > 0 && <span aria-hidden="true" className="radar-source-separator">·</span>}
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.sourceName}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> mở trong tab mới</span>
      </a>
      {index === 0 && formatDateTime(source.firstSeenAt, compact) && <span className="radar-first-seen">Ghi nhận {formatDateTime(source.firstSeenAt, compact)}</span>}
    </span>)}
  </span>
}

function ArticleImage({ article, className, onError }: { article: Article; className: string; onError: () => void }) {
  if (!article.image) return <CategoryArtwork categories={article.categories} className={className} />
  return <Image unoptimized width={800} height={450} className={className} src={article.image.url} alt={article.image.alt}
    loading="lazy" referrerPolicy="no-referrer" onError={onError} />
}

function StoryThumbnail({ article }: { article: Article }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <figure className="radar-story-thumb">
    {article.image && !imageFailed ? <><ArticleImage article={article} className="radar-story-thumb-image" onError={() => setImageFailed(true)} /><figcaption>{article.image.credit ? `Nguồn ảnh: ${article.image.credit}` : 'Ảnh từ nguồn bài viết'}</figcaption></> : <><CategoryArtwork categories={article.categories} /><figcaption>Minh họa theo chủ đề</figcaption></>}
  </figure>
}

function FeatureStory({ article, index }: { article: Article; index: number }) {
  const isLead = index === 0
  const [imageFailed, setImageFailed] = useState(false)
  return <article className={`radar-feature ${isLead ? 'radar-feature--lead' : 'radar-feature--second'}`}>
    <div className="radar-feature-copy">
      <p className="radar-feature-index"><span>{isLead ? 'Mới nhất' : 'Tiếp theo'}</span><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></p>
      <p className="radar-feature-topic">{articleCategory(article)}</p>
      <h2><Link href={`/radar/${article.id}`}>{article.title}</Link></h2>
      <div className="radar-feature-meta">
        <span>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt)}</time></> : 'Chưa rõ thời gian công bố'}</span>
        <SourceLinks article={article} compact />
      </div>
    </div>
    <figure className="radar-feature-visual">{article.image && !imageFailed ? <><ArticleImage article={article} className="radar-feature-image" onError={() => setImageFailed(true)} /><figcaption>{article.image.credit ? `Ảnh: ${article.image.credit}` : 'Ảnh từ nguồn bài viết'}{article.image.sourceUrl && <> · <a href={article.image.sourceUrl} target="_blank" rel="noreferrer">Bài nguồn</a></>}</figcaption></> : <><CategoryArtwork categories={article.categories} /><figcaption>Minh họa theo chủ đề</figcaption></>}</figure>
  </article>
}

function RecommendationStory({ article, reason }: { article: Article; reason: string }) {
  return <article className="radar-recommendation-row">
    <h4><Link href={`/radar/${article.id}`}>{article.title}</Link></h4>
    <p className="radar-recommendation-meta">
      <span>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt)}</time></> : 'Chưa rõ thời gian công bố'}</span>
      <SourceLinks article={article} compact />
    </p>
    <p className="radar-recommendation-reason">{reason}</p>
  </article>
}

function sourceState(status: string | null) {
  if (status === 'SUCCESS') return { label: 'Hoạt động', className: 'is-success' }
  if (status === 'ERROR') return { label: 'Có lỗi', className: 'is-error' }
  return { label: 'Chưa quét', className: 'is-idle' }
}

export default function RadarPage() {
  const [tab, setTab] = useState<'articles' | 'alerts'>('articles')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<'all' | 'today' | '7d' | 'month' | 'year' | 'custom'>('all')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false)
  const [includeProfileGoal, setIncludeProfileGoal] = useState(false)
  const [includeSurveyTopics, setIncludeSurveyTopics] = useState(false)
  const [includeForensicHistory, setIncludeForensicHistory] = useState(false)
  const [dailyBriefDay, setDailyBriefDay] = useState(vietnamCalendarDay)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const scheduleNextRefresh = () => {
      timer = setTimeout(() => {
        setDailyBriefDay(vietnamCalendarDay())
        scheduleNextRefresh()
      }, msUntilNextVietnamDay())
    }
    scheduleNextRefresh()
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fincopilot.radar.interests') ?? 'null') as { enabled?: boolean; topics?: string[]; includeProfileGoal?: boolean; includeSurveyTopics?: boolean; includeForensicHistory?: boolean } | null
      setInterests(saved?.topics?.filter((topic) => topic in categoryLabels) ?? [])
      setPersonalizationEnabled(saved?.enabled === true)
      setIncludeProfileGoal(saved?.includeProfileGoal === true)
      setIncludeSurveyTopics(saved?.includeSurveyTopics === true)
      setIncludeForensicHistory(saved?.includeForensicHistory === true)
    } catch { /* Ignore malformed local preferences. */ }
  }, [])
  function saveInterests(enabled: boolean, topics: string[]) {
    setPersonalizationEnabled(enabled)
    setInterests(topics)
    localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled, topics, includeProfileGoal, includeSurveyTopics, includeForensicHistory }))
  }
  function saveConsent(profile: boolean, survey: boolean, forensic: boolean) {
    setIncludeProfileGoal(profile); setIncludeSurveyTopics(survey); setIncludeForensicHistory(forensic)
    localStorage.setItem('fincopilot.radar.interests', JSON.stringify({ enabled: personalizationEnabled, topics: interests, includeProfileGoal: profile, includeSurveyTopics: survey, includeForensicHistory: forensic }))
  }
  const articlesQuery = useInfiniteQuery({
    queryKey: ['radar-articles', category, search, period, year, dateFrom, dateTo],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ ...(category ? { category } : {}), ...(search ? { search } : {}), ...(period !== 'all' && period !== 'year' && period !== 'custom' ? { period } : {}), ...(period === 'year' ? { year } : {}), ...(period === 'custom' && dateFrom ? { from: dateFrom } : {}), ...(period === 'custom' && dateTo ? { to: dateTo } : {}) })
      if (pageParam) params.set('cursor', pageParam)
      return apiClient.get<ArticlePage>(`/radar/articles?${params}`)
    },
    getNextPageParam: (lastPage) => lastPage.page.hasMore ? lastPage.page.nextCursor ?? undefined : undefined,
  })
  const alertsQuery = useQuery({ queryKey: ['radar-alerts'], queryFn: () => apiClient.get<{ items: AlertItem[] }>('/radar/alerts') })
  const fraudArticlesQuery = useQuery({ queryKey: ['radar-fraud-articles'], queryFn: () => apiClient.get<ArticlePage>('/radar/articles?category=FINANCIAL_FRAUD&limit=5') })
  const highlightsQuery = useQuery({ queryKey: ['radar-highlights'], queryFn: () => apiClient.get<{ items: Highlight[]; ranking: string }>('/radar/articles/highlights') })
  const dailyBriefQuery = useQuery({
    queryKey: ['radar-daily-brief', dailyBriefDay, personalizationEnabled, interests, includeProfileGoal, includeSurveyTopics, includeForensicHistory],
    queryFn: () => apiClient.post<DailyBriefResponse>('/radar/daily-brief', {
      personalizationEnabled, topics: personalizationEnabled ? interests : [],
      includeProfileGoal: personalizationEnabled && includeProfileGoal,
      includeSurveyTopics: personalizationEnabled && includeSurveyTopics,
      includeForensicHistory: personalizationEnabled && includeForensicHistory,
    }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  })
  const signalsQuery = useQuery({
    queryKey: ['radar-recommendation-signals', includeProfileGoal, includeSurveyTopics, includeForensicHistory],
    queryFn: () => apiClient.post<{ signals: RecommendationSignal[] }>('/radar/recommendation-signals', { includeProfileGoal, includeSurveyTopics, includeForensicHistory }),
    enabled: personalizationEnabled && (includeProfileGoal || includeSurveyTopics || includeForensicHistory),
  })
  const articles = useMemo(() => articlesQuery.data?.pages.flatMap((page) => page.items) ?? [], [articlesQuery.data])
  const sources = articlesQuery.data?.pages[0]?.sources ?? []
  const staleSources = sources.filter((source) => source.lastFetchStatus === 'ERROR')
  const featured = articles.slice(0, 2)
  const publishedAlerts = alertsQuery.data?.items.filter((alert) => alert.verificationStatus === 'VERIFIED' && alert.publishedAt)
  const latestAlert = publishedAlerts?.[0]
  const alertArticleIds = new Set(publishedAlerts?.flatMap((alert) => alert.evidence.map((item) => item.articleId).filter((id): id is string => Boolean(id))) ?? [])
  const fraudArticles = fraudArticlesQuery.data?.items.filter((article) => !alertArticleIds.has(article.id)) ?? []
  const emptyAlertState = publishedAlerts?.length === 0 && Boolean(fraudArticlesQuery.data) && fraudArticles.length === 0
  const recommendations = useMemo(() => {
    if (!personalizationEnabled) return []
    const signalCategories = signalsQuery.data?.signals.map((signal) => signal.categoryCode) ?? []
    const selectedTopics = [...new Set([...interests, ...signalCategories])]
    if (selectedTopics.length === 0) return []
    const highPriorityIds = new Set(highlightsQuery.data?.items.filter((item) => item.editorialPriority === 'HIGH').map((item) => item.id) ?? [])
    const ranked = articles.filter((article) => article.categories.some((topic) => selectedTopics.includes(topic))).map((article) => {
      const matchedTopics = article.categories.filter((topic) => selectedTopics.includes(topic))
      const matchedTopic = matchedTopics[0] ?? ''
      const ageDays = article.publishedAt ? Math.max(0, (Date.now() - new Date(article.publishedAt).getTime()) / 86_400_000) : Number.POSITIVE_INFINITY
      const forensicFraudPriority = matchedTopics.includes('FINANCIAL_FRAUD') && signalsQuery.data?.signals.some((signal) => signal.source === 'FORENSIC_HISTORY') ? 45 : 0
      const score = matchedTopics.length * 25 + forensicFraudPriority + (ageDays <= 1 ? 10 : ageDays <= 7 ? 5 : 0) + (highPriorityIds.has(article.id) ? 16 : 0) + Math.min(article.sources.length, 3) * 2
      const reasons = matchedTopics.flatMap((topic) => {
        const signal = signalsQuery.data?.signals.find((item) => item.categoryCode === topic)
        return [signal?.reason ?? `Chủ đề bạn đã chọn: ${categoryLabels[topic]?.toLocaleLowerCase('vi')}`]
      })
      if (ageDays <= 7) reasons.push('Bài mới công bố')
      if (highPriorityIds.has(article.id)) reasons.push('Đạt tiêu chí ưu tiên biên tập')
      if (forensicFraudPriority) reasons.push('Ưu tiên cảnh báo lừa đảo theo tín hiệu Giám định gần đây đã bật')
      if (article.sources.length > 1) reasons.push(`Được ${article.sources.length} nguồn ghi nhận`)
      return { article, score, matchedTopic, reason: reasons.join(' · ') }
    }).sort((a, b) => b.score - a.score || new Date(b.article.publishedAt ?? 0).getTime() - new Date(a.article.publishedAt ?? 0).getTime())
    const selected: typeof ranked = []
    const perTopic = new Map<string, number>()
    for (const item of ranked) {
      if (selected.some((entry) => entry.article.id === item.article.id)) continue
      const count = perTopic.get(item.matchedTopic) ?? 0
      if (count >= 2) continue
      selected.push(item)
      perTopic.set(item.matchedTopic, count + 1)
      if (selected.length === 4) break
    }
    return selected
  }, [articles, highlightsQuery.data, interests, personalizationEnabled, signalsQuery.data])

  const coldStart = useMemo(() => (highlightsQuery.data?.items ?? []).slice(0, 3), [highlightsQuery.data])

  return <div className="radar-page">
    <header className="radar-masthead">
      <div>
        <p className="radar-kicker"><span aria-hidden="true" /> Thông tin tài chính · Việt Nam</p>
        <h1>Radar thị trường</h1>
        <p className="radar-deck">Tin tức và cảnh báo có nguồn gốc rõ ràng. Thời điểm công bố được tách riêng khỏi thời điểm hệ thống ghi nhận.</p>
      </div>
      <div className="radar-edition-mark" aria-hidden="true"><span>F</span><small>FINCOPILOT<br/>MARKET DESK</small></div>
    </header>

    {tab === 'articles' && <section className={`radar-v2-alerts ${emptyAlertState ? 'radar-v2-alerts--empty' : ''}`} aria-labelledby="radar-v2-alerts-title">
      {emptyAlertState ? <div className="radar-empty-alert-bar"><p id="radar-v2-alerts-title"><strong>Cảnh báo lừa đảo</strong><span>Hiện chưa có cảnh báo hoặc bài viết cùng chủ đề được công bố.</span></p><button type="button" onClick={() => setTab('alerts')}>Mở danh sách <ArrowUpRight size={14} aria-hidden="true" /></button></div> : <>
      <div className="radar-v2-section-head"><div><p className="radar-context-kicker">CẢNH BÁO CÓ DẪN CHỨNG</p><h2 id="radar-v2-alerts-title">Cảnh báo lừa đảo cần chú ý</h2></div><button type="button" onClick={() => setTab('alerts')}>Tất cả cảnh báo <ArrowUpRight size={14} aria-hidden="true" /></button></div>
      {alertsQuery.isPending && <p className="radar-context-empty">Đang tải cảnh báo…</p>}
      {alertsQuery.isError && <p className="radar-context-empty" role="status">Chưa thể tải cảnh báo. Tin thị trường vẫn có thể xem bên dưới.</p>}
      <div className="radar-v2-alert-list">
        {publishedAlerts?.slice(0, 3).map((alert) => <article className="radar-v2-alert-item" key={alert.id}>
          <span className={`radar-verification ${alert.verificationStatus === 'VERIFIED' ? 'is-verified' : 'is-unverified'}`}>{alert.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : alert.verificationStatus === 'UNVERIFIED' ? 'Chưa xác minh' : `Trạng thái: ${alert.verificationStatus}`}</span>
          <h3><Link href={`/radar/${alert.id}?kind=alert`}>{alert.tacticSummary}</Link></h3>
          <p>{alert.publishedAt ? <>Công bố <time dateTime={alert.publishedAt}>{formatDateTime(alert.publishedAt)}</time></> : 'Chưa rõ thời điểm công bố'}{alert.evidence.length > 0 && <> · Dẫn chứng: {alert.evidence.map((item) => item.sourceName).join(', ')}</>}</p>
        </article>)}
        {fraudArticles.slice(0, 2).map((article) => <article className="radar-v2-alert-item radar-v2-alert-item--report" key={`report-${article.id}`}>
          <span className="radar-verification is-unverified">Bài viết cùng chủ đề · Chưa có trạng thái xác minh cảnh báo</span>
          <h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>
          <p>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt)}</time></> : 'Chưa rõ thời điểm công bố'} · <SourceLinks article={article} compact /></p>
        </article>)}
      </div>
      </>}
    </section>}

    {tab === 'articles' && <section className="radar-v2-highlights" aria-labelledby="radar-v2-highlights-title">
      <div className="radar-v2-section-head"><div><p className="radar-context-kicker">ƯU TIÊN BIÊN TẬP · CÓ GIẢI THÍCH</p><h2 id="radar-v2-highlights-title">Tin đáng chú ý hôm nay</h2></div></div>
      {highlightsQuery.isError && <p className="radar-context-empty" role="status">Chưa thể tạo danh sách ưu tiên. Không có số liệu phổ biến hoặc tương tác giả.</p>}
      <div className="radar-v2-highlight-list">{highlightsQuery.data?.items.slice(0, 3).map((item) => <article key={item.id}>
        <p className="radar-story-topic">{articleCategory(item)}{item.editorialPriority === 'HIGH' ? ' · ƯU TIÊN CAO' : ''}</p>
        <h3><Link href={`/radar/${item.id}`}>{item.title}</Link></h3>
        <p className="radar-v2-reasons">{highlightReasons(item).length ? highlightReasons(item).join(' · ') : 'Xếp theo thời điểm công bố; chưa có tín hiệu ưu tiên bổ sung.'}</p>
      </article>)}</div>
      {highlightsQuery.data?.items.length === 0 && <p className="radar-context-empty">Chưa có bài viết có ngày công bố để xếp hạng.</p>}
    </section>}

    {tab === 'articles' && <section className="radar-v2-personal" aria-labelledby="radar-v2-personal-title">
      <div className="radar-v2-section-head"><div><p className="radar-context-kicker">TÙY CHỌN · LƯU TRÊN THIẾT BỊ NÀY</p><h2 id="radar-v2-personal-title">Chủ đề bạn quan tâm</h2></div>
        <button type="button" aria-pressed={personalizationEnabled} onClick={() => saveInterests(!personalizationEnabled, interests)}>{personalizationEnabled ? 'Tắt gợi ý cá nhân' : 'Bật gợi ý cá nhân'}</button>
      </div>
      <div className="radar-preference-group">
        <div className="radar-v2-interest-list" role="group" aria-label="Chọn chủ đề quan tâm">{Object.entries(categoryLabels).map(([code, label]) => {
          const next = interests.includes(code) ? interests.filter((topic) => topic !== code) : [...interests, code]
          return <button type="button" key={code} aria-pressed={interests.includes(code)} onClick={() => saveInterests(personalizationEnabled, next)}>{label}</button>
        })}</div>
        <fieldset className="radar-consent-options"><legend>Cho phép dùng thêm tín hiệu (tùy chọn)</legend>
          <label><input type="checkbox" checked={includeProfileGoal} onChange={(event) => saveConsent(event.target.checked, includeSurveyTopics, includeForensicHistory)} /> Mục tiêu trong hồ sơ tài chính</label>
          <label><input type="checkbox" checked={includeSurveyTopics} onChange={(event) => saveConsent(includeProfileGoal, event.target.checked, includeForensicHistory)} /> Loại Khảo sát đã dùng gần đây</label>
          <label><input type="checkbox" checked={includeForensicHistory} onChange={(event) => saveConsent(includeProfileGoal, includeSurveyTopics, event.target.checked)} /> Kết quả Giám định rủi ro cao trong 30 ngày</label>
        </fieldset>
        <p className="radar-consent-summary">Chỉ dùng từng tín hiệu khi bạn bật quyền tương ứng. Với Giám định, hệ thống chỉ kiểm tra có kết quả rủi ro cao trong 30 ngày hay không; không đọc nội dung tài liệu, QR hay thông tin tổ chức.</p>
        <details className="radar-consent-details">
          <summary>Chi tiết về dữ liệu và quyền kiểm soát</summary>
          <p>Lựa chọn chủ đề và quyền dùng tín hiệu được lưu trên thiết bị này. Bạn có thể tắt gợi ý hoặc bỏ từng quyền bất cứ lúc nào; cảnh báo công khai vẫn luôn hiển thị. Khi không có tín hiệu được phép dùng, danh sách dựa trên tiêu chí tin công khai.</p>
        </details>
      </div>
      {personalizationEnabled && <section className="radar-v2-recommendations" aria-labelledby="radar-recommendations-title">
        <div className="radar-recommendations-heading">
          <div><p className="radar-context-kicker">{interests.length || signalsQuery.data?.signals.length ? 'THEO CHỦ ĐỀ ĐÃ CHỌN' : 'THEO TIN CÔNG KHAI'}</p><h3 id="radar-recommendations-title">{interests.length || signalsQuery.data?.signals.length ? 'Gợi ý cho bạn' : 'Tin ưu tiên công khai'}</h3></div>
        </div>
        {signalsQuery.isError && (includeProfileGoal || includeSurveyTopics || includeForensicHistory) && <p role="status" className="radar-recommendation-status">Không tải được tín hiệu được phép; vẫn dùng chủ đề đã chọn.</p>}
        {recommendations.length ? <div className="radar-recommendation-list">{recommendations.map(({ article, reason }) => <RecommendationStory key={article.id} article={article} reason={reason} />)}</div> : interests.length || signalsQuery.data?.signals.length ? <p className="radar-recommendation-empty">Chưa có bài phù hợp trong các tin đã tải. Không suy đoán sở thích khác.</p> : <>
          <p className="radar-recommendation-empty">Chưa có tín hiệu cá nhân được phép dùng; các tin dưới đây theo tiêu chí công khai.</p>
          <div className="radar-recommendation-list">{coldStart.map((article) => <RecommendationStory key={article.id} article={article} reason={highlightReasons(article).join(' · ') || 'Ưu tiên công khai theo thời gian công bố'} />)}</div>
        </>}
      </section>}
    </section>}

    <div className="radar-workspace">
      <section className="radar-feed" id="radar-feed" aria-label="Bản tin Radar">
        <div className="radar-discovery" role="group" aria-label="Tìm kiếm và lọc tin">
        <div className="radar-controls">
          <div className="radar-tabs" role="group" aria-label="Loại nội dung">
            <button type="button" aria-pressed={tab === 'articles'} onClick={() => setTab('articles')}>Thị trường</button>
            <button type="button" aria-pressed={tab === 'alerts'} onClick={() => setTab('alerts')}>Cảnh báo lừa đảo</button>
          </div>
          {tab === 'articles' && <label className="radar-search">
            <span className="sr-only">Tìm tin theo tiêu đề</span>
            <Search size={16} aria-hidden="true" />
            <Input aria-label="Tìm tin theo tiêu đề" placeholder="Tìm tin theo tiêu đề" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>}
          {tab === 'articles' && <div className="radar-date-controls">
            <label><span className="sr-only">Lọc thời gian</span><select aria-label="Lọc thời gian" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
              <option value="all">Mọi thời gian</option><option value="today">Hôm nay</option><option value="7d">7 ngày qua</option><option value="month">Tháng này</option><option value="year">Lưu trữ theo năm</option><option value="custom">Chọn ngày</option>
            </select></label>
            {period === 'year' && <label><span className="sr-only">Năm công bố</span><select aria-label="Năm công bố" value={year} onChange={(event) => setYear(event.target.value)}>{Array.from({ length: 11 }, (_, index) => String(new Date().getFullYear() - index)).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
            {period === 'custom' && <><label><span className="sr-only">Từ ngày</span><input type="date" aria-label="Từ ngày" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label><span className="sr-only">Đến ngày</span><input type="date" aria-label="Đến ngày" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></>}
          </div>}
        </div>

        {tab === 'articles' && <div className="radar-topics" role="group" aria-label="Lọc theo chủ đề">
          <button type="button" aria-pressed={category === ''} onClick={() => setCategory('')}>Tất cả</button>
          {Object.entries(categoryLabels).map(([code, label]) => <button type="button" key={code} aria-pressed={category === code} onClick={() => setCategory(category === code ? '' : code)}>{label}</button>)}
        </div>}
        </div>

        {tab === 'articles' && staleSources.length > 0 && <div role="status" className="radar-stale-note">
          <AlertTriangle size={16} aria-hidden="true" />
          <p><strong>Nguồn tạm gián đoạn:</strong> {staleSources.map((source) => source.name).join(', ')}. Ngày công bố tin cũ được giữ nguyên.</p>
        </div>}

        {tab === 'articles' ? <div className="radar-article-content" aria-label="Tin thị trường">
          {articlesQuery.isPending && <p role="status" className="radar-state-message">Đang tải tin…</p>}
          {articlesQuery.isError && <div className="radar-state-message radar-error-state"><p role="alert">{articlesQuery.error instanceof ApiError ? articlesQuery.error.message : 'Không tải được Radar.'} Hãy kiểm tra kết nối rồi thử lại.</p><Button variant="outline" size="sm" onClick={() => void articlesQuery.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {featured.length > 0 && <>
            <div className={`radar-feature-grid ${featured.length === 1 ? 'radar-feature-grid--single' : ''}`} aria-label="Tin nổi bật theo thời gian công bố">
              {featured.map((article, index) => <FeatureStory key={article.id} article={article} index={index} />)}
            </div>
            {articles.length > 2 && <section className="radar-secondary" aria-label="Các tin tiếp theo">
              <h2 className="radar-section-heading"><span>Tin tiếp theo</span><span>THEO THỜI GIAN CÔNG BỐ</span></h2>
              <div className="radar-story-list">
                {articles.slice(2).map((article, index) => <article className="radar-story-row" key={article.id}>
                  <span className="radar-story-index" aria-hidden="true">{String(index + 3).padStart(2, '0')}</span>
                  <div className="radar-story-copy">
                    <p className="radar-story-topic">{articleCategory(article)}</p>
                    <h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>
                    <div className="radar-story-meta"><span>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt)}</time></> : 'Chưa rõ thời gian công bố'}</span><SourceLinks article={article} compact /></div>
                  </div>
                  <StoryThumbnail article={article} />
                </article>)}
              </div>
            </section>}
            {articlesQuery.hasNextPage && <div className="radar-load-more">
              {articlesQuery.isFetchNextPageError && <p role="alert">Không tải thêm được tin. Bạn có thể thử lại.</p>}
              <Button variant="outline" onClick={() => void articlesQuery.fetchNextPage()} disabled={articlesQuery.isFetchingNextPage}>
                {articlesQuery.isFetchingNextPage ? 'Đang tải…' : articlesQuery.isFetchNextPageError ? 'Thử tải lại' : 'Tải thêm tin'}
                {!articlesQuery.isFetchingNextPage && <ArrowDown size={15} aria-hidden="true" />}
              </Button>
            </div>}
          </>}
          {articlesQuery.data && articles.length === 0 && <div className="radar-empty-state">
            <span className="radar-empty-mark" aria-hidden="true">R</span>
            <p className="radar-story-topic">CHƯA CÓ KẾT QUẢ</p>
            <h2>Chưa có tin phù hợp</h2>
            <p>Thử tìm với từ khóa khác hoặc bỏ bộ lọc chủ đề.</p>
            {(category || search || period !== 'all') && <button type="button" onClick={() => { setCategory(''); setSearch(''); setPeriod('all'); setDateFrom(''); setDateTo('') }}>Xóa bộ lọc</button>}
          </div>}
        </div> : <div className="radar-alert-feed" aria-label="Cảnh báo lừa đảo">
          {alertsQuery.isPending && <p role="status" className="radar-state-message">Đang tải cảnh báo…</p>}
          {alertsQuery.isError && <div className="radar-state-message radar-error-state"><p role="alert">Không tải được cảnh báo.</p><Button variant="outline" size="sm" onClick={() => void alertsQuery.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {publishedAlerts?.map((alert) => <article className="radar-alert-row" key={alert.id}>
            <div className="radar-alert-status"><span>{alert.threatCategory}</span><strong className={alert.verificationStatus === 'VERIFIED' ? 'is-verified' : 'is-unverified'}>{alert.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : 'Chưa xác minh'}</strong></div>
            <h2><Link href={`/radar/${alert.id}?kind=alert`}>{alert.tacticSummary}</Link></h2>
            <p>{alert.publishedAt ? <>Công bố <time dateTime={alert.publishedAt}>{formatDateTime(alert.publishedAt)}</time></> : 'Chưa rõ thời điểm công bố'}{alert.evidence.length > 0 && <> · Dẫn chứng từ {alert.evidence.map((item) => item.sourceName).join(', ')}</>}</p>
            <Link className="radar-alert-detail" href={`/radar/${alert.id}?kind=alert`}>Xem dấu hiệu và bằng chứng <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </article>)}
          {publishedAlerts?.length === 0 && <div className="radar-empty-state">
            <span className="radar-empty-mark" aria-hidden="true">!</span><p className="radar-story-topic">THREAT RADAR</p><h2>Chưa có cảnh báo được công bố</h2><p>Chỉ cảnh báo đã công bố mới xuất hiện tại đây.</p>
          </div>}
        </div>}
      </section>

      <aside className="radar-context" aria-label="Thông tin liên quan">
        <RadarDailyBrief data={dailyBriefQuery.data} isPending={dailyBriefQuery.isPending} isError={dailyBriefQuery.isError} onRetry={() => void dailyBriefQuery.refetch()} />
        <section className="radar-context-alert">
          <div className="radar-context-heading"><p className="radar-context-kicker">PROVENANCE</p><h2>Dẫn chứng cảnh báo gần nhất</h2></div>
          {alertsQuery.isPending && <p className="radar-context-empty">Đang tải nguồn dẫn chứng…</p>}
          {alertsQuery.isError && <p className="radar-context-empty">Chưa thể lấy nguồn dẫn chứng.</p>}
          {latestAlert && <>
            <p className="radar-context-meta">{latestAlert.verificationStatus === 'VERIFIED' ? 'Trạng thái: đã xác minh' : 'Trạng thái: chưa xác minh'}</p>
            {latestAlert.evidence.length > 0 ? <ul className="radar-context-evidence">{latestAlert.evidence.map((item, index) => <li key={`${item.sourceName}-${item.url ?? index}`}>
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.sourceName}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> mở trong tab mới</span></a> : <span>{item.sourceName}</span>}
              {item.title && <p>{item.title}</p>}
            </li>)}</ul> : <p className="radar-context-empty">Chưa có dẫn chứng được cung cấp.</p>}
            <Link className="radar-context-action" href={`/radar/${latestAlert.id}?kind=alert`}>Mở chi tiết cảnh báo <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </>}
          {publishedAlerts?.length === 0 && <p className="radar-context-empty">Chưa có cảnh báo được công bố.</p>}
        </section>

        <section className="radar-context-sources">
          <div className="radar-context-heading"><p className="radar-context-kicker">DATA DESK</p><h2>Nguồn thu thập</h2></div>
          {sources.length > 0 ? <ul>
            {sources.map((source) => {
              const state = sourceState(source.lastFetchStatus)
              const stateTime = source.lastFetchStatus === 'ERROR' ? source.lastAttemptAt : source.lastSuccessAt ?? source.lastAttemptAt
              return <li key={source.sourceKey}>
                <div><span className={`radar-source-state ${state.className}`} aria-hidden="true" /><span className="radar-source-name">{source.name}</span></div>
                <span className={`radar-source-status ${state.className}`}>{state.label}</span>
                <time dateTime={stateTime ?? undefined}>{stateTime ? formatDateTime(stateTime, true) : 'Chưa có lần quét'}</time>
              </li>
            })}
          </ul> : <p className="radar-context-empty">Trạng thái nguồn chưa được API cung cấp.</p>}
          <p className="radar-source-footnote">Nguồn hoạt động không đồng nghĩa nội dung đã được xác minh.</p>
        </section>
      </aside>
    </div>
  </div>
}
