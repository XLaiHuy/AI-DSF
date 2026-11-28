'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUpRight, ExternalLink, RefreshCw, Search, Bell, CalendarDays, Zap, Bookmark, ScanLine } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { handoffRoutes } from '@fincopilot/shared-types'
import { Button } from '@/components/ui'
import { MarketRateBenchmarkChart } from '@/components/charts/MarketRateBenchmarkChart'
import { useRadarDesk, type DeskPanel, type RadarTab } from '@/components/layout/RadarDeskContext'
import { useWorkspaceField } from '@/components/layout/WorkspaceSessionContext'
import { DeskDialog } from '@/components/radar/DeskDialog'
import { ThreatTrendBoard } from '@/components/radar/ThreatTrendBoard'
import { EditorialImage } from '@/components/radar/EditorialImage'
import { getReadingHistory, getSavedArticles, readingStoreEvent, toggleSavedArticle, type ReadingEntry } from '@/components/radar/ReadingStore'
import { QuickSurvey, RecentActivity, ProfileStatus } from '@/components/home/OverviewWidgets'
import { RadarDailyBrief, type DailyBriefResponse } from '@/components/radar/RadarDailyBrief'
import { ApiError, apiClient } from '@/lib/api-client'
import { marketOverviewQuery, sessionQuery } from '@/lib/workspace-data'

type Source = { sourceKey: string; name: string; lastFetchStatus: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null }
type ArticleSource = { sourceName: string; url: string; firstSeenAt?: string | null; lastSeenAt?: string | null }
type Article = { id: string; title: string; canonicalUrl?: string; publishedAt: string | null; image?: { url: string; proxyUrl?: string | null; alt: string; credit: string | null; sourceUrl: string | null } | null; categories: string[]; sources: ArticleSource[]; sourceName?: string | null; readMinutes?: number; trendReason?: string }
type ArticlePage = { items: Article[]; page: { hasMore: boolean; nextCursor: string | null }; sources: Source[] }
type AlertItem = { id: string; threatCategory: string; tacticSummary: string; preventionGuidance?: string | null; verificationStatus: string; publishedAt: string | null; evidence: { articleId?: string; sourceName: string; title?: string; url?: string }[] }
type Highlight = Article & { editorialPriority?: 'HIGH' | 'STANDARD'; priorityReasons?: string[] | null }
type RecommendationSignal = { categoryCode: string; source: 'PROFILE_GOAL' | 'SURVEY_TOPIC' | 'FORENSIC_HISTORY'; reason: string }

const categoryLabels: Record<string, string> = {
  INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường', POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính',
}
const threatCategoryLabels: Record<string, string> = { PHISHING: 'Lừa đảo qua đường dẫn hoặc tin nhắn', IMPERSONATION: 'Mạo danh', FAKE_LOAN: 'Vay giả mạo', INVESTMENT_SCAM: 'Đầu tư giả mạo' }
const threatCategoryLabel = (value: string) => threatCategoryLabels[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('vi-VN')
const threatIllustration = (alert: AlertItem) => {
  const summary = alert.tacticSummary.toLocaleLowerCase('vi-VN')
  if (alert.threatCategory === 'FAKE_LOAN' && /chuyển phí|nộp phí|phí trước|đặt cọc|giải ngân/.test(summary)) return { src: '/illustrations/fraud-advance-fee.svg', alt: 'Minh họa gốc: hồ sơ vay và yêu cầu nộp phí trước' }
  if (alert.threatCategory === 'PHISHING' && /chuyển phí|nộp phí|mở khóa tài khoản/.test(summary)) return { src: '/illustrations/fraud-transfer.svg', alt: 'Minh họa gốc: tin nhắn yêu cầu chuyển phí' }
  if (alert.threatCategory === 'PHISHING') return { src: '/illustrations/fraud-phishing.svg', alt: 'Minh họa gốc: tin nhắn chứa đường dẫn chưa rõ nguồn' }
  if (alert.threatCategory === 'IMPERSONATION' || (alert.threatCategory === 'INVESTMENT_SCAM' && /mạo danh|nhân viên|tư vấn/.test(summary))) return { src: '/illustrations/fraud-identity.svg', alt: 'Minh họa gốc: hồ sơ người gửi tự nhận là nhân viên hỗ trợ' }
  return { src: '/illustrations/fraud-source-check.svg', alt: 'Minh họa gốc: kiểm tra nguồn thông tin' }
}
const alertPublishedFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
function formatAlertPublished(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Chưa rõ thời điểm công bố'
  const parts = Object.fromEntries(alertPublishedFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`
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
  if (!article.sources.length) return <span className="radar-source-missing">{article.sourceName || 'Chưa rõ nguồn'}</span>
  return <span className="radar-source-links" aria-label="Nguồn gốc bài viết">
    {article.sources.map((source, index) => <span className="radar-source-item" key={`${source.sourceName}-${source.url}`}>
      {index > 0 && <span aria-hidden="true" className="radar-source-separator">·</span>}
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.sourceName}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> mở trong tab mới</span>
      </a>
      {index === 0 && formatDateTime(source.firstSeenAt, compact) && <span className="radar-first-seen">Ghi nhận lần đầu {formatDateTime(source.firstSeenAt, compact)}</span>}
    </span>)}
  </span>
}

function Byline({ article }: { article: Article }) {
  const source = article.sources[0]
  const name = source?.sourceName || article.sourceName || 'Chưa rõ nguồn'
  return <div className="desk-byline"><span className="desk-seal" aria-hidden="true">{name.slice(0, 2)}</span>
    {source ? <a href={source.url} target="_blank" rel="noreferrer">{source.sourceName}</a> : <span>{name}</span>}
    <span aria-hidden="true">·</span><span>{articleCategory(article)}</span></div>
}
function Published({ article }: { article: Article }) {
  return <div className="desk-stamp"><CalendarDays size={15} aria-hidden="true" />
    {article.publishedAt ? <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt, true)}</time> : 'Chưa rõ thời gian công bố'}</div>
}
function DeskPicture({ article, cover = false }: {article: Article; cover?: boolean}) {
  return <EditorialImage imageUrl={article.image?.url} proxyUrl={article.image?.proxyUrl} alt={article.image?.alt || article.title}
    credit={article.image?.credit} sourceUrl={article.image?.sourceUrl} categories={article.categories}
    priority={cover} />
}
function DeskThumb({ article }: {article: Article}) {
  return <div className="desk-thumb"><DeskPicture article={article}/></div>
}
function FeatureStory({ article, index, saved, onSave }: { article: Article; index: number; saved: boolean; onSave: () => void }) {
  return <article className="desk-feature"><DeskPicture article={article} cover />
    <span className="desk-badge"><b><Zap size={14} aria-hidden="true"/></b>Xu hướng #{index+1}</span>
    <button className="desk-save desk-save-feature" aria-label={saved ? `Bỏ lưu ${article.title}` : `Lưu ${article.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={17} fill={saved ? 'currentColor' : 'none'}/></button>
    <div className="desk-cover-copy"><Byline article={article}/><h2><Link href={`/radar/${article.id}`}>{article.title}</Link></h2><Published article={article}/>{article.readMinutes && <small>{article.readMinutes} phút đọc</small>}</div>
  </article>
}

function RecommendationStory({ article, reason, lead = false }: { article: Article; reason: string; lead?: boolean }) {
  return <article className={`radar-recommendation-row ${lead ? 'is-lead' : ''}`}>
    <div className="radar-recommendation-thumb"><div className="desk-thumb"><EditorialImage imageUrl={article.image?.url} proxyUrl={article.image?.proxyUrl} alt={article.image?.alt || article.title} credit={article.image?.credit} sourceUrl={article.image?.sourceUrl} categories={article.categories} /></div></div>
    <div className="radar-recommendation-copy">
      <p className="radar-recommendation-category">{articleCategory(article)}</p>
      <h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>
      <div className="radar-recommendation-meta"><SourceLinks article={article} compact />
        <span className="radar-recommendation-published">{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt, true)}</time></> : 'Chưa rõ thời gian công bố'}</span>
      </div>
      {article.categories.includes('FINANCIAL_FRAUD') && <p className="radar-recommendation-verification">Bài viết cùng chủ đề · Chưa có trạng thái xác minh cảnh báo</p>}
      <p className="radar-recommendation-reason"><strong>Vì sao hiển thị</strong> {reason}</p>
    </div>
  </article>
}

function sourceState(status: string | null) {
  if (status === 'SUCCESS') return { label: 'Đang hoạt động', className: 'is-success' }
  if (status === 'ERROR') return { label: 'Quét lỗi', className: 'is-error' }
  return { label: status ? 'Chưa rõ trạng thái' : 'Chưa có lần quét', className: 'is-idle' }
}

function readRadarTab(params: Pick<URLSearchParams, 'get'>): RadarTab {
  const feed = params.get('feed')
  const view = params.get('tab')
  return feed === 'saved' || feed === 'history' ? feed : view === 'alerts' || view === 'personal' ? view : 'articles'
}

const radarTabs = [['personal', 'Dành cho bạn'], ['articles', 'Xu hướng'], ['alerts', 'Cảnh báo'], ['saved', 'Đã lưu']] as const

function RadarTabs({ tab, selectView }: { tab: RadarTab; selectView: (view: RadarTab) => void }) {
  const [pendingTab, setPendingTab] = useState<RadarTab>()
  const [pending, loadView] = useTransition()
  const activeTab = pending ? pendingTab ?? tab : tab
  return <div className="desk-tabs" role="group" aria-label="Loại nội dung">
    {radarTabs.map(([key, label]) => <button className="desk-tab" key={key} type="button"
      aria-pressed={activeTab === key} onClick={() => {
        setPendingTab(key)
        loadView(() => selectView(key))
      }}>{label}</button>)}
  </div>
}

function RadarWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tab, setTab] = useWorkspaceField('radar', 'tab')
  const { register } = useRadarDesk()
  const [panel, setPanel] = useState<DeskPanel | null>(null)
  const [quickCheck, setQuickCheck] = useState('')
  const [savedEntries, setSavedEntries] = useState<ReadingEntry[]>([])
  const [historyEntries, setHistoryEntries] = useState<ReadingEntry[]>([])
  const feed = useRef<HTMLElement>(null)
  const [scrollByTab] = useWorkspaceField('radar', 'scrollByTab')
  const changeTab = useCallback((view: RadarTab) => setTab(view), [setTab])

  useLayoutEffect(() => {
    const node = feed.current
    if (!node) return
    const top = scrollByTab[tab] ?? 0
    const frame = requestAnimationFrame(() => {
      if (window.innerWidth <= 900) window.scrollTo({ top, behavior: 'instant' })
      else node.scrollTo({ top, behavior: 'instant' })
    })
    const save = () => {
      scrollByTab[tab] = window.innerWidth <= 900 ? window.scrollY : node.scrollTop
    }
    node.addEventListener('scroll', save, { passive: true })
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      node.removeEventListener('scroll', save)
      window.removeEventListener('scroll', save)
    }
  }, [scrollByTab, tab])

  const replaceQuery = useCallback((query: URLSearchParams) => {
    startTransition(() => window.history.replaceState(null, '', pathname + (query.size ? '?' + query : '')))
  }, [pathname])

  const selectView = useCallback((view: RadarTab) => {
    changeTab(view)
    const query = new URLSearchParams(window.location.search)
    query.delete('feed')
    query.delete('tab')
    if (view === 'saved' || view === 'history') query.set('feed', view)
    else if (view === 'alerts' || view === 'personal') query.set('tab', view)
    replaceQuery(query)
  }, [changeTab, replaceQuery])

  useLayoutEffect(() => {
    register({ openPanel: setPanel, selectView, isAlertsTab: tab === 'alerts' })
    return () => register(undefined)
  }, [register, selectView, tab])

  function chooseTopic(code: string) {
    const next = category === code ? '' : code
    setCategory(next)
    changeTab('articles')
    const query = new URLSearchParams(window.location.search)
    query.delete('feed')
    query.delete('tab')
    if (next) query.set('category', next)
    else query.delete('category')
    replaceQuery(query)
  }

  function clearFilters() {
    setCategory(''); setSearch(''); setPeriod('all'); setDateFrom(''); setDateTo('')
    const query = new URLSearchParams(window.location.search)
    query.delete('category')
    replaceQuery(query)
  }
  const [category, setCategory] = useWorkspaceField('radar', 'category')
  const [search, setSearch] = useWorkspaceField('radar', 'search')
  const [period, setPeriod] = useWorkspaceField('radar', 'period')
  const [year, setYear] = useWorkspaceField('radar', 'year')
  const [dateFrom, setDateFrom] = useWorkspaceField('radar', 'dateFrom')
  const [dateTo, setDateTo] = useWorkspaceField('radar', 'dateTo')
  const urlTab = searchParams.has('feed') || searchParams.has('tab') ? readRadarTab(searchParams) : undefined
  const urlCategory = searchParams.get('category')
  useLayoutEffect(() => {
    if (urlTab) changeTab(urlTab)
    else if (urlCategory !== null) changeTab('articles')
    if (urlCategory !== null) setCategory(urlCategory)
  }, [urlTab, urlCategory, changeTab, setCategory])
  useEffect(() => {
    const refresh = () => { setSavedEntries(getSavedArticles()); setHistoryEntries(getReadingHistory()) }
    refresh()
    window.addEventListener(readingStoreEvent, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(readingStoreEvent, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  function saveArticle(article: Article) {
    toggleSavedArticle({ id: article.id, title: article.title, publishedAt: article.publishedAt, sourceName: article.sources[0]?.sourceName ?? article.sourceName ?? null })
  }
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
    staleTime: 3 * 60_000,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '10', ...(category ? { category } : {}), ...(search ? { search } : {}), ...(period !== 'all' && period !== 'year' && period !== 'custom' ? { period } : {}), ...(period === 'year' ? { year } : {}), ...(period === 'custom' && dateFrom ? { from: dateFrom } : {}), ...(period === 'custom' && dateTo ? { to: dateTo } : {}) })
      if (pageParam) params.set('cursor', pageParam)
      return apiClient.get<ArticlePage>(`/radar/articles?${params}`)
    },
    getNextPageParam: (lastPage) => lastPage.page.hasMore ? lastPage.page.nextCursor ?? undefined : undefined,
  })
  const market = useQuery(marketOverviewQuery)
  const session = useQuery(sessionQuery)
  const alertsQuery = useQuery({ queryKey: ['radar-alerts'], enabled: tab === 'alerts', staleTime: 3 * 60_000, queryFn: () => apiClient.get<{ items: AlertItem[] }>('/radar/alerts') })
  const fraudArticlesQuery = useQuery({ queryKey: ['radar-fraud-articles'], enabled: tab === 'alerts', staleTime: 3 * 60_000, queryFn: () => apiClient.get<ArticlePage>('/radar/articles?category=FINANCIAL_FRAUD&limit=5') })
  const highlightsQuery = useQuery({ queryKey: ['radar-highlights'], enabled: tab === 'personal' || (!market.isPending && !market.data?.scamFinanceRail?.length), staleTime: 3 * 60_000, queryFn: () => apiClient.get<{ items: Highlight[]; ranking: string }>('/radar/articles/highlights') })
  const dailyBriefQuery = useQuery({
    queryKey: ['radar-daily-brief', dailyBriefDay, personalizationEnabled, interests, includeProfileGoal, includeSurveyTopics, includeForensicHistory],
    queryFn: () => apiClient.post<DailyBriefResponse>('/radar/daily-brief', {
      personalizationEnabled, topics: personalizationEnabled ? interests : [],
      includeProfileGoal: personalizationEnabled && includeProfileGoal,
      includeSurveyTopics: personalizationEnabled && includeSurveyTopics,
      includeForensicHistory: personalizationEnabled && includeForensicHistory,
    }),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })
  const signalsQuery = useQuery({
    queryKey: ['radar-recommendation-signals', includeProfileGoal, includeSurveyTopics, includeForensicHistory],
    queryFn: () => apiClient.post<{ signals: RecommendationSignal[] }>('/radar/recommendation-signals', { includeProfileGoal, includeSurveyTopics, includeForensicHistory }),
    enabled: personalizationEnabled && (includeProfileGoal || includeSurveyTopics || includeForensicHistory),
  })
  const articles = useMemo(() => articlesQuery.data?.pages.flatMap((page) => page.items) ?? [], [articlesQuery.data])
  const sources = articlesQuery.data?.pages[0]?.sources ?? []
  const staleSources = sources.filter((source) => source.lastFetchStatus === 'ERROR')
  const useTrending = !category && !search && period === 'all'
  const featured: Article[] = useTrending && market.data?.trending?.length ? market.data.trending.slice(0, 2).map((item) => {
    const full = articles.find((article) => article.id === item.id)
    return { ...full, id: item.id, title: item.title, publishedAt: item.publishedAt, categories: item.categories,
      sources: full?.sources ?? [], sourceName: item.sourceName, readMinutes: item.readMinutes, trendReason: item.trendReason,
      image: item.imageUrl ? { url: item.imageUrl, proxyUrl: item.proxyUrl, alt: item.title, credit: item.sourceName, sourceUrl: full?.image?.sourceUrl ?? null } : null }
  }) : articles.slice(0, 2)
  const featuredIds = new Set(featured.map((article) => article.id))
  const otherArticles = articles.filter((article) => !featuredIds.has(article.id))
  const publishedAlerts = alertsQuery.data?.items.filter((alert) => alert.verificationStatus === 'VERIFIED' && alert.publishedAt)
  const alertArticleIds = new Set(publishedAlerts?.flatMap((alert) => alert.evidence.map((item) => item.articleId).filter((id): id is string => Boolean(id))) ?? [])
  const fraudArticles = fraudArticlesQuery.data?.items.filter((article) => !alertArticleIds.has(article.id)) ?? []
  const recommendations = useMemo(() => {
    if (!personalizationEnabled) return []
    const consentedSignals = (signalsQuery.data?.signals ?? []).filter((signal) =>
      signal.categoryCode in categoryLabels && ((signal.source === 'PROFILE_GOAL' && includeProfileGoal) || (signal.source === 'SURVEY_TOPIC' && includeSurveyTopics) || (signal.source === 'FORENSIC_HISTORY' && includeForensicHistory)))
    const signalCategories = consentedSignals.map((signal) => signal.categoryCode)
    const selectedTopics = [...new Set([...interests, ...signalCategories])]
    if (selectedTopics.length === 0) return []
    const highPriorityIds = new Set(highlightsQuery.data?.items.filter((item) => item.editorialPriority === 'HIGH').map((item) => item.id) ?? [])
    const ranked = articles.filter((article) => article.categories.some((topic) => selectedTopics.includes(topic))).map((article) => {
      const matchedTopics = article.categories.filter((topic) => selectedTopics.includes(topic))
      const matchedTopic = matchedTopics[0] ?? ''
      const ageDays = article.publishedAt ? Math.max(0, (Date.now() - new Date(article.publishedAt).getTime()) / 86_400_000) : Number.POSITIVE_INFINITY
      const forensicFraudPriority = matchedTopics.includes('FINANCIAL_FRAUD') && consentedSignals.some((signal) => signal.source === 'FORENSIC_HISTORY' && signal.categoryCode === 'FINANCIAL_FRAUD') ? 45 : 0
      const score = matchedTopics.length * 25 + forensicFraudPriority + (ageDays <= 1 ? 10 : ageDays <= 7 ? 5 : 0) + (highPriorityIds.has(article.id) ? 16 : 0) + Math.min(article.sources.length, 3) * 2
      const reasons = matchedTopics.flatMap((topic) => {
        const signal = consentedSignals.find((item) => item.categoryCode === topic)
        return [interests.includes(topic) ? `Chủ đề bạn đã chọn: ${categoryLabels[topic]?.toLocaleLowerCase('vi')}` : signal?.reason ?? 'Tin phù hợp với tín hiệu đã cho phép']
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
  }, [articles, highlightsQuery.data, interests, personalizationEnabled, signalsQuery.data, includeProfileGoal, includeSurveyTopics, includeForensicHistory])

  const coldStart = useMemo(() => (highlightsQuery.data?.items ?? []).slice(0, 3), [highlightsQuery.data])
  const publicStories = useMemo(() => {
    const seen = new Set<string>()
    return [...coldStart, ...articles].filter((article) => {
      if (seen.has(article.id)) return false
      seen.add(article.id)
      return true
    }).slice(0, 4)
  }, [articles, coldStart])
  const publicReason = (article: Article) => {
    const highlighted = coldStart.find((item) => item.id === article.id)
    return highlighted ? highlightReasons(highlighted).join(' · ') || 'Tin công khai trong mục nổi bật của Radar.' : 'Tin thị trường công khai hiện có trên Radar.'
  }
  const consentedSignalCount = (signalsQuery.data?.signals ?? []).filter((signal) =>
    signal.categoryCode in categoryLabels && ((signal.source === 'PROFILE_GOAL' && includeProfileGoal) || (signal.source === 'SURVEY_TOPIC' && includeSurveyTopics) || (signal.source === 'FORENSIC_HISTORY' && includeForensicHistory))).length
  const personalStories = personalizationEnabled && recommendations.length ? recommendations.map(({ article }) => article) : publicStories
  const railArticleIds = new Set(tab === 'personal' ? personalStories.map((article) => article.id) : [])
  const railItems = (market.data?.scamFinanceRail ?? []).filter((item) =>
    !(tab === 'alerts' && item.kind === 'ALERT' && publishedAlerts?.some((alert) => alert.id === item.id)) &&
    (item.kind === 'ALERT' || !railArticleIds.has(item.id)))
  const railFallback = coldStart.filter((article) => !railArticleIds.has(article.id))
  const isGuest = session.data?.kind === 'guest'
  const hasPersonalStories = personalizationEnabled && recommendations.length > 0

  const panelTitles = {brief: 'Bản tin trong ngày', topics: 'Chủ đề & thời gian', sources: 'Trạng thái nguồn', quick: 'Khảo sát nhanh', history: 'Hoạt động gần đây', profile: 'Tổng quan hồ sơ', preferences: 'Tùy chỉnh gợi ý'}
  const showTopics = (entries: [string,string][]) => entries.map(([code,label]) =>
    <button key={code} type="button" aria-pressed={category===code} onClick={()=>chooseTopic(code)}>{label}</button>)
  const preferenceControls = <section className="radar-v2-personal" aria-labelledby="radar-v2-personal-title">
      <header className="radar-personal-intro">
        <p className="radar-context-kicker">TÙY CHỌN CỦA BẠN</p>
        <h2 id="radar-v2-personal-title">Chủ đề bạn quan tâm</h2>
        <p>Chọn những điều bạn muốn theo dõi. Bạn có thể chọn bao nhiêu chủ đề tùy thích và thay đổi bất cứ lúc nào.</p>
      </header>
      <section className="radar-preference-topics" aria-labelledby="radar-topics-title">
        <div className="radar-preference-heading"><h3 id="radar-topics-title">Chọn chủ đề</h3><span aria-live="polite">{interests.length} chủ đề đã chọn</span></div>
        <div className="radar-v2-interest-list" role="group" aria-label="Chọn chủ đề quan tâm">{Object.entries(categoryLabels).map(([code, label]) => {
          const next = interests.includes(code) ? interests.filter((topic) => topic !== code) : [...interests, code]
          return <button type="button" key={code} aria-pressed={interests.includes(code)} onClick={() => saveInterests(personalizationEnabled, next)}>{label}</button>
        })}</div>
        <div className="radar-preference-action"><p>Chủ đề được lưu trên thiết bị này ngay khi bạn chọn.</p>
          <button className="radar-personal-action" type="button" aria-pressed={personalizationEnabled} onClick={() => saveInterests(!personalizationEnabled, interests)}>{personalizationEnabled ? 'Tắt gợi ý cá nhân' : 'Bật gợi ý cá nhân'}</button>
        </div>
      </section>
      <section className="radar-preference-privacy" aria-labelledby="radar-privacy-title">
        <div className="radar-preference-heading"><h3 id="radar-privacy-title">Quyền dùng dữ liệu</h3><span>Tùy chọn</span></div>
        <p className="radar-privacy-intro">Các dữ liệu dưới đây chỉ được dùng khi bạn bật gợi ý cá nhân và cho phép từng mục riêng.</p>
        <fieldset className="radar-consent-options"><legend className="sr-only">Cho phép dùng thêm tín hiệu</legend>
          <label className="radar-consent-row"><span className="radar-consent-copy"><strong>Mục tiêu trong hồ sơ tài chính</strong><span id="radar-consent-profile-desc">Dùng mục tiêu bạn đã lưu để ưu tiên tin liên quan.</span></span><span className="radar-consent-toggle"><span aria-hidden="true">{includeProfileGoal ? 'Bật' : 'Tắt'}</span><input type="checkbox" aria-label="Mục tiêu trong hồ sơ tài chính" aria-describedby="radar-consent-profile-desc" checked={includeProfileGoal} onChange={(event) => saveConsent(event.target.checked, includeSurveyTopics, includeForensicHistory)} /></span></label>
          <label className="radar-consent-row"><span className="radar-consent-copy"><strong>Loại Khảo sát đã dùng gần đây</strong><span id="radar-consent-survey-desc">Dùng loại khảo sát gần đây để chọn tin phù hợp hơn.</span></span><span className="radar-consent-toggle"><span aria-hidden="true">{includeSurveyTopics ? 'Bật' : 'Tắt'}</span><input type="checkbox" aria-label="Loại Khảo sát đã dùng gần đây" aria-describedby="radar-consent-survey-desc" checked={includeSurveyTopics} onChange={(event) => saveConsent(includeProfileGoal, event.target.checked, includeForensicHistory)} /></span></label>
          <label className="radar-consent-row"><span className="radar-consent-copy"><strong>Kết quả Giám định rủi ro cao trong 30 ngày</strong><span id="radar-consent-forensic-desc">Chỉ dùng dấu hiệu có rủi ro cao; không đọc tài liệu, QR hay thông tin tổ chức.</span></span><span className="radar-consent-toggle"><span aria-hidden="true">{includeForensicHistory ? 'Bật' : 'Tắt'}</span><input type="checkbox" aria-label="Kết quả Giám định rủi ro cao trong 30 ngày" aria-describedby="radar-consent-forensic-desc" checked={includeForensicHistory} onChange={(event) => saveConsent(includeProfileGoal, includeSurveyTopics, event.target.checked)} /></span></label>
        </fieldset>
        <p className="radar-consent-summary">Chỉ dùng từng tín hiệu khi bạn bật quyền tương ứng. Bạn có thể tắt từng quyền bất cứ lúc nào.</p>
        <details className="radar-consent-details">
          <summary>Chi tiết về dữ liệu và quyền kiểm soát</summary>
          <p>Lựa chọn chủ đề và quyền dùng tín hiệu được lưu trên thiết bị này. Khi tắt gợi ý cá nhân, các quyền đã chọn vẫn được lưu nhưng các tín hiệu tương ứng không được dùng cho Radar. Cảnh báo công khai vẫn luôn hiển thị. Khi không có tín hiệu được phép dùng, danh sách dựa trên tiêu chí tin công khai.</p>
        </details>
      </section>
    </section>
  return <>
    <main className="desk-main"><div className="desk-body">
      <section ref={feed} className="desk-feed" aria-label="Tin tức và cảnh báo">
        <header className="desk-banner desk-quick-check"><span className="desk-icon"><ScanLine size={24} /></span>
          <div className="desk-banner-copy"><h1>Kiểm tra trước khi chuyển tiền</h1><p>Nhập nội dung đáng ngờ để chuyển sang Giám định.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); if (quickCheck.trim()) router.push(handoffRoutes.homeQuickForensic({ prefillText: quickCheck.trim() })) }}>
            <input aria-label="Nội dung cần giám định" value={quickCheck} maxLength={2000} onChange={(event) => setQuickCheck(event.target.value)} placeholder="Tên tổ chức, lời mời vay hoặc tin nhắn…" required />
            <button type="submit">Giám định <ArrowUpRight size={14} /></button>
          </form></header>
        <div className="desk-tools"><div className="desk-actions">
          <label className="desk-search"><Search size={22} aria-hidden="true"/><input type="search" aria-label="Tìm tin theo tiêu đề" placeholder="Tìm kiếm tin tức" value={search} onChange={e=>{setSearch(e.target.value); if (tab !== 'articles') selectView('articles')}} /></label>
          <button className="desk-bell" aria-label="Xem cảnh báo lừa đảo" onClick={()=>selectView('alerts')}><Bell size={20}/></button></div>
          <div className="desk-chips" role="group" aria-label="Lọc nhanh theo chủ đề">{showTopics(Object.entries(categoryLabels).slice(0,4))}
            {(category || search || period!=='all') && <button onClick={clearFilters}>Xóa bộ lọc</button>}</div></div>
        <RadarTabs tab={tab} selectView={selectView} />
        <div className="desk-stream">
        {tab === 'articles' ? <div className="radar-article-content" aria-label="Tin thị trường">
          {articlesQuery.isPending && <p role="status" className="radar-state-message">Đang tải tin…</p>}
          {articlesQuery.isError && <div className="radar-state-message radar-error-state"><p role="alert">{articlesQuery.error instanceof ApiError ? articlesQuery.error.message : 'Không tải được Radar.'} Hãy kiểm tra kết nối rồi thử lại.</p><Button variant="outline" size="sm" onClick={() => void articlesQuery.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {featured.length > 0 && <>
            <div className="desk-features" aria-label="Tin nổi bật theo thời gian công bố">
              {featured.map((article, index) => <FeatureStory key={article.id} article={article} index={index} saved={savedEntries.some((item) => item.id === article.id)} onSave={() => saveArticle(article)} />)}
            </div>
            <section className="desk-market-feed" aria-label="Mặt bằng thị trường và bản tin trong ngày"><MarketRateBenchmarkChart />
              <div className="desk-brief-inline"><RadarDailyBrief data={dailyBriefQuery.data} isPending={dailyBriefQuery.isPending} isError={dailyBriefQuery.isError} onRetry={()=>void dailyBriefQuery.refetch()}/></div>
            </section>
            {otherArticles.length > 0 && <div className="desk-rows">{otherArticles.map((article) => <article key={article.id} className="desk-row">
              <DeskThumb article={article} />
              <div className="desk-row-copy"><Byline article={article} /><h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>
                <Published article={article} /></div>
              <button className="desk-save desk-save-row" aria-label={savedEntries.some((item) => item.id === article.id) ? `Bỏ lưu ${article.title}` : `Lưu ${article.title}`} aria-pressed={savedEntries.some((item) => item.id === article.id)} onClick={() => saveArticle(article)}><Bookmark size={17} fill={savedEntries.some((item) => item.id === article.id) ? 'currentColor' : 'none'} /></button>
            </article>)}</div>}
            {articlesQuery.hasNextPage && <div className="radar-load-more">
              {articlesQuery.isFetchNextPageError && <p role="alert">Không tải thêm được tin. Bạn có thể thử lại.</p>}
              <Button variant="outline" onClick={() => void articlesQuery.fetchNextPage()} disabled={articlesQuery.isFetchingNextPage}>
                {articlesQuery.isFetchingNextPage ? 'Đang tải…' : articlesQuery.isFetchNextPageError ? 'Thử tải lại' : 'Tải thêm tin'}
                {!articlesQuery.isFetchingNextPage && <ArrowDown size={15} aria-hidden="true" />}
              </Button>
            </div>}
          </>}
          {articlesQuery.data && featured.length === 0 && <div className="radar-empty-state">
            <span className="radar-empty-mark" aria-hidden="true">R</span>
            <p className="radar-story-topic">CHƯA CÓ KẾT QUẢ</p>
            <h2>Chưa có tin phù hợp</h2>
            <p>Thử tìm với từ khóa khác hoặc bỏ bộ lọc chủ đề.</p>
            {(category || search || period !== 'all') && <button type="button" onClick={clearFilters}>Xóa bộ lọc</button>}
          </div>}
        </div> : tab === 'alerts' ? <div className="radar-alert-feed" aria-label="Cảnh báo lừa đảo">
          <header className="radar-alert-intro"><h1>Cảnh báo lừa đảo</h1><p>Mở nguồn của cảnh báo đã xác minh để so sánh dấu hiệu với trường hợp của bạn.</p></header>
          <ThreatTrendBoard />
          {alertsQuery.isPending && <p role="status" className="radar-state-message">Đang tải cảnh báo…</p>}
          {alertsQuery.isError && <div className="radar-state-message radar-error-state"><p role="alert">Không tải được cảnh báo.</p><Button variant="outline" size="sm" onClick={() => void alertsQuery.refetch()}><RefreshCw size={14} aria-hidden="true"/> Thử lại</Button></div>}
          {publishedAlerts?.map((alert, index) => <article className={`radar-alert-row ${index === 0 ? 'is-lead' : ''}`} key={alert.id}>
            <figure className="radar-alert-art">
              <Image src={threatIllustration(alert).src} width={800} height={600} alt={threatIllustration(alert).alt} />
              <figcaption>Minh họa gốc · không phải ảnh sự việc</figcaption>
            </figure>
            <div className="radar-alert-head">
              <div className="radar-alert-status"><span className="radar-alert-category">{threatCategoryLabel(alert.threatCategory)}</span><span className="is-verified">Đã xác minh cảnh báo</span></div>
              <h2><Link href={`/radar/${alert.id}?kind=alert`}>{alert.tacticSummary}</Link></h2>
              <p className="radar-alert-published">{alert.publishedAt ? <>Công bố <time dateTime={alert.publishedAt}>{formatAlertPublished(alert.publishedAt)}</time></> : 'Chưa rõ thời điểm công bố'}</p>
            </div>
            {alert.preventionGuidance?.trim() && <p className="radar-alert-guidance">{alert.preventionGuidance}</p>}
            <div className="radar-alert-body">
              <div className="radar-alert-evidence"><span className="radar-alert-evidence-label">Nguồn dẫn chứng:</span>{alert.evidence.length ? <ul>{alert.evidence.map((item, sourceIndex) => <li key={`${item.sourceName}-${item.url ?? sourceIndex}`}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.sourceName}<ExternalLink size={12} aria-hidden="true"/><span className="sr-only"> mở trong tab mới</span></a> : <span>{item.sourceName} · Chưa có liên kết</span>}</li>)}</ul> : <p>Chưa có dẫn chứng được cung cấp.</p>}</div>
              <Link className="radar-alert-detail" href={`/radar/${alert.id}?kind=alert`}>Xem dấu hiệu &amp; bằng chứng <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </div>
          </article>)}
          {publishedAlerts?.length === 0 && <div className="radar-empty-state">
            <span className="radar-empty-mark" aria-hidden="true">!</span><p className="radar-story-topic">THREAT RADAR</p><h2>Chưa có cảnh báo được công bố</h2><p>Chỉ cảnh báo đã công bố mới xuất hiện tại đây.</p>
          </div>}
        </div> : tab === 'saved' || tab === 'history' ? <section className="desk-reading-list" aria-label={tab === 'saved' ? 'Tin đã lưu' : 'Lịch sử đọc'}>
          <h2>{tab === 'saved' ? 'Tin đã lưu' : 'Lịch sử đọc'}</h2>
          {(tab === 'saved' ? savedEntries : historyEntries).length ? (tab === 'saved' ? savedEntries : historyEntries).map((item) => <article key={item.id}>
            <p>{item.sourceName || 'Chưa rõ nguồn'}{item.publishedAt && <> · <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time></>}</p>
            <h3><Link href={`/radar/${item.id}`}>{item.title}</Link></h3>
            {tab === 'saved' && <button onClick={() => toggleSavedArticle(item)}>Bỏ lưu</button>}
          </article>) : <div className="desk-reading-empty"><p className="radar-state-message">{tab === 'saved' ? 'Bạn chưa lưu tin nào trên thiết bị này.' : 'Bạn chưa đọc bài viết nào trên thiết bị này.'}</p><button type="button" onClick={() => selectView('articles')}>Xem tin xu hướng <ArrowUpRight size={14} aria-hidden="true" /></button></div>}
        </section> : null}
{tab === 'personal' && <section className="radar-personal-feed" aria-labelledby="radar-personal-feed-title">
      <header className="radar-personal-feed-head">
        <div><p className="radar-context-kicker">{hasPersonalStories ? isGuest ? 'PHIÊN KHÁCH · CHỦ ĐỀ ĐÃ CHỌN' : 'BẢN TIN CỦA BẠN' : 'TIN CÔNG KHAI'}</p><h2 id="radar-personal-feed-title">{hasPersonalStories ? isGuest ? 'Tin theo lựa chọn của bạn' : 'Bản tin theo sở thích của bạn' : 'Tin thị trường công khai'}</h2>
          <p>{hasPersonalStories ? isGuest ? 'Tin phù hợp với chủ đề và tín hiệu bạn đã cho phép trong phiên này.' : 'Tin phù hợp với chủ đề và tín hiệu bạn đã cho phép.' : 'Tin thị trường công khai để bạn bắt đầu đọc, không dựa trên hồ sơ hay hoạt động cá nhân.'}</p></div>
        <button type="button" onClick={() => setPanel('preferences')}>Tùy chỉnh <ArrowUpRight size={15} aria-hidden="true" /></button>
      </header>
      {personalizationEnabled && signalsQuery.isError && (includeProfileGoal || includeSurveyTopics || includeForensicHistory) && <p role="status" className="radar-recommendation-status">Không tải được tín hiệu được phép; vẫn dùng chủ đề đã chọn.</p>}
      {articlesQuery.isPending && publicStories.length === 0 && <p role="status" className="radar-state-message">Đang tải tin thị trường…</p>}
      {articlesQuery.isError && publicStories.length === 0 && <div className="radar-state-message radar-error-state"><p role="alert">Không tải được tin thị trường.</p><Button variant="outline" size="sm" onClick={() => void articlesQuery.refetch()}>Thử lại</Button></div>}
      {hasPersonalStories ? <>
        <p className="radar-personal-list-label">TIN PHÙ HỢP VỚI LỰA CHỌN CỦA BẠN</p>
        <div className="radar-recommendation-list">{recommendations.map(({ article, reason }, index) => <RecommendationStory key={article.id} article={article} reason={reason} lead={index === 0} />)}</div>
      </> : <>
        {!articlesQuery.isPending && <p className="radar-personal-explanation">{personalizationEnabled ? interests.length || consentedSignalCount ? 'Chưa có bài phù hợp trong các tin đã tải. Dưới đây là tin công khai; Radar không suy đoán thêm sở thích.' : 'Chưa có tín hiệu cá nhân được phép dùng. Dưới đây là tin công khai theo tiêu chí của Radar.' : 'Gợi ý cá nhân đang tắt. Các tin dưới đây là tin công khai, không dựa trên dữ liệu cá nhân của bạn.'}</p>}
        {publicStories.length > 0 && <><p className="radar-personal-list-label">TIN THỊ TRƯỜNG CÔNG KHAI</p><div className="radar-recommendation-list">{publicStories.map((article, index) => <RecommendationStory key={article.id} article={article} reason={publicReason(article)} lead={index === 0} />)}</div></>}
        {!articlesQuery.isPending && !articlesQuery.isError && publicStories.length === 0 && <p role="status" className="radar-recommendation-empty">Hiện chưa có tin công khai để hiển thị. Bạn có thể xem lại sau.</p>}
      </>}
    </section>}
{tab === 'alerts' && fraudArticles.length > 0 && <section className="radar-v2-alerts" aria-labelledby="radar-v2-alerts-title">
      <div className="radar-v2-section-head"><div><p className="radar-context-kicker">TIN CÙNG CHỦ ĐỀ</p><h2 id="radar-v2-alerts-title">Bài viết chưa có trạng thái xác minh cảnh báo</h2></div></div>
      <div className="radar-v2-alert-list">{fraudArticles.slice(0, 2).map((article) => <article className="radar-v2-alert-item radar-v2-alert-item--report" key={`report-${article.id}`}>
        <span className="radar-verification is-unverified">Bài viết cùng chủ đề · Chưa có trạng thái xác minh cảnh báo</span>
        <h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>
        <p>{article.publishedAt ? <>Công bố <time dateTime={article.publishedAt}>{formatDateTime(article.publishedAt)}</time></> : 'Chưa rõ thời điểm công bố'} · <SourceLinks article={article} compact /></p>
      </article>)}</div>
    </section>}
        </div>
      </section>
      <aside className="desk-rail" aria-label={tab === 'alerts' ? 'Cách đọc cảnh báo' : 'Khám phá tin'}>
        {tab === 'alerts' ? <div className="radar-alert-rail"><p className="radar-alert-eyebrow">ĐỌC CẢNH BÁO</p><h2>Kiểm tra trước khi tin</h2><p>“Đã xác minh” là trạng thái của cảnh báo được công bố; không phải mức độ nghiêm trọng của trường hợp bạn gặp.</p><div className="radar-alert-rail-note"><strong>Nguồn dẫn chứng</strong><span>Mở liên kết gốc trong mỗi cảnh báo để tự xem thông tin có sẵn.</span></div><div className="radar-alert-rail-note"><strong>Cần đối chiếu trường hợp của bạn?</strong><span>Giám định là một bước kiểm tra riêng, chưa được thực hiện chỉ bằng việc đọc cảnh báo.</span></div><Link href="/forensic" className="radar-alert-rail-action">Mở Giám định <ArrowUpRight size={15} aria-hidden="true"/></Link></div> : <><h2>{railItems.length ? 'Cảnh báo & Tài chính' : 'Đọc thêm'}</h2>
        {market.isPending && <p role="status">Đang tải tin chọn lọc…</p>}
        {market.isError && <button onClick={()=>void market.refetch()}>Tải lại tin chọn lọc</button>}
        {railItems.map((item) => <article className="desk-pick" key={`${item.kind}-${item.id}`}>
          <p className="desk-rail-meta"><span className="desk-rail-badge" data-kind={item.kind}>{item.kind === 'ALERT' ? 'Cảnh báo' : item.kind === 'SCAM_NEWS' ? 'Tin lừa đảo' : 'Tin tài chính'}</span><span>{item.sourceName || 'Chưa rõ nguồn'}</span></p>
          <div className={`desk-pick-main ${item.imageUrl ? '' : 'desk-pick-main--text'}`}><h3><Link href={item.kind === 'ALERT' ? `/radar/${item.id}?kind=alert` : `/radar/${item.id}`}>{item.title}</Link></h3>
            {item.imageUrl && <EditorialImage className="desk-rail-image" imageUrl={item.imageUrl} proxyUrl={item.proxyUrl} alt={item.title} categories={[item.kind === 'FINANCE_NEWS' ? 'MARKET' : 'FINANCIAL_FRAUD']} />}</div>
          <div className="desk-pick-foot">{item.publishedAt ? <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt, true)}</time> : <span>Chưa rõ ngày công bố</span>}
            <Link href={item.handoffHref}>Kiểm tra <ArrowUpRight size={14} aria-hidden="true"/></Link></div>
        </article>)}
        {!market.isPending && !market.data?.scamFinanceRail?.length && railFallback.map((article)=><article className="desk-pick" key={article.id}>
          <Byline article={article}/>{article.categories.includes('FINANCIAL_FRAUD') && <p className="desk-rail-badge">Bài viết cùng chủ đề · Chưa xác minh cảnh báo</p>}<div className={`desk-pick-main ${article.image?.url ? '' : 'desk-pick-main--text'}`}><h3><Link href={`/radar/${article.id}`}>{article.title}</Link></h3>{article.image?.url && <div className="desk-thumb"><EditorialImage imageUrl={article.image.url} proxyUrl={article.image.proxyUrl} alt={article.image.alt || article.title} credit={article.image.credit} sourceUrl={article.image.sourceUrl} categories={article.categories} /></div>}</div>
          <div className="desk-pick-foot"><Published article={article}/><details><summary>Vì sao?</summary><p>{highlightReasons(article).join(' · ') || 'Theo thời gian công bố.'}</p></details></div>
        </article>)}
        {tab === 'personal' && !market.isPending && !market.isError && railItems.length === 0 && railFallback.length === 0 && <p className="desk-rail-empty">Chưa có tin khác ngoài bản tin đang đọc.</p>}
        <section className="desk-section"><h2>Trạng thái nguồn</h2>{sources.length ? sources.map((source) => <p className="desk-source-line" key={source.sourceKey}>{source.name}<span><i className={'radar-source-state ' + sourceState(source.lastFetchStatus).className} aria-label={sourceState(source.lastFetchStatus).label} /> {source.lastAttemptAt ? formatDateTime(source.lastAttemptAt, true) : sourceState(source.lastFetchStatus).label}</span></p>) : <p>Chưa có dữ liệu trạng thái.</p>}
          <button className="desk-underline" onClick={() => setPanel('sources')}>Xem chi tiết nguồn</button></section>
        <section className="desk-section"><h2>Hoạt động gần đây</h2><button className="desk-underline" onClick={() => setPanel('history')}>Xem hoạt động</button></section></>}
      </aside>
    </div></main>
    {panel && <DeskDialog title={panelTitles[panel]} close={()=>setPanel(null)}>
      {panel==='preferences' && preferenceControls}
      {panel==='brief' && <RadarDailyBrief data={dailyBriefQuery.data} isPending={dailyBriefQuery.isPending} isError={dailyBriefQuery.isError} onRetry={()=>void dailyBriefQuery.refetch()}/>}
      {panel==='quick' && <QuickSurvey/>}{panel==='history' && <RecentActivity/>}{panel==='profile' && <ProfileStatus/>}
      {panel==='sources' && <section className="radar-context-sources">
          <div className="radar-context-heading"><p className="radar-context-kicker">DATA DESK</p><h2>Nguồn thu thập</h2></div>
          {staleSources.length > 0 && <p role="status" className="radar-stale-note">Nguồn tạm gián đoạn: {staleSources.map(source=>source.name).join(', ')}. Ngày công bố tin cũ được giữ nguyên.</p>}
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
        </section>}
      {panel==='topics' && <><div className="desk-cloud">{showTopics(Object.entries(categoryLabels))}</div><div className="radar-date-controls">
            <label><span className="sr-only">Lọc thời gian</span><select aria-label="Lọc thời gian" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
              <option value="all">Mọi thời gian</option><option value="today">Hôm nay</option><option value="7d">7 ngày qua</option><option value="month">Tháng này</option><option value="year">Lưu trữ theo năm</option><option value="custom">Chọn ngày</option>
            </select></label>
            {period === 'year' && <label><span className="sr-only">Năm công bố</span><select aria-label="Năm công bố" value={year} onChange={(event) => setYear(event.target.value)}>{Array.from({ length: 11 }, (_, index) => String(new Date().getFullYear() - index)).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
            {period === 'custom' && <><label><span className="sr-only">Từ ngày</span><input type="date" aria-label="Từ ngày" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label><span className="sr-only">Đến ngày</span><input type="date" aria-label="Đến ngày" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></>}
          </div>
        <button className="desk-small-button" onClick={()=>{setPanel(null);selectView('articles')}}>Xem kết quả</button></>}
    </DeskDialog>}
  </>
}

export default function RadarPage() {
  return <Suspense fallback={<p role="status">Đang mở bản tin thị trường…</p>}><RadarWorkspace /></Suspense>
}
