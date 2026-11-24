import type { ForensicAuditResponse, ForensicFollowUpResponse, RuleCode, VerdictLevel } from '@fincopilot/shared-types'
import { categories, type BenchmarkCase, type Difficulty } from './benchmark-cases'
import type { ForensicBenchmarkObservation } from '../forensic.service'

const levels = ['SAFE', 'CAUTION', 'HIGH_RISK'] as const
const difficulty = ['EASY', 'MEDIUM', 'HARD', 'ADVERSARIAL'] as const satisfies readonly Difficulty[]
export type FollowUpResult = {
  intent?: ForensicFollowUpResponse['meta']['intent']
  suggestReaudit?: boolean
  degradedMode: boolean
  provider: string | null
  containsRequiredText: boolean
  unsafeReassurance: boolean
}

export type CaseResult = {
  case: BenchmarkCase
  attempts: number
  latencyMs: number
  stageMs: Record<string, number>
  transport: Record<string, number>
  verdict: VerdictLevel | null
  score?: number
  rules: RuleCode[]
  apr?: string
  impact?: ForensicAuditResponse['personalImpact']
  intentSignals?: ForensicAuditResponse['intentSignals']
  trace?: ForensicBenchmarkObservation
  visionProvider?: string | null
  visionNeeded?: boolean
  media?: { imageCount: number; pdfRasterCount: number; decodedQrCount: number; expectedQrCount: number; purged: boolean }
  ocr?: Array<{ probe: string; matched: boolean }>
  followUps: FollowUpResult[]
  degradedMode: boolean
  fallbacks: string[]
  error?: string
}

function matchesApr(result: CaseResult, [min, max]: readonly [number, number]) {
  const apr = result.apr == null ? NaN : Number(result.apr)
  return apr >= min && apr <= max
}

function matchesTurn(actual: FollowUpResult | undefined, expected: NonNullable<BenchmarkCase['followUp']>[number]) {
  return Boolean(actual && actual.intent === expected.intent && Boolean(actual.suggestReaudit) === Boolean(expected.suggestReaudit) &&
    actual.containsRequiredText && !actual.unsafeReassurance)
}

export function deviations(result: CaseResult) {
  const item = result.case
  if (result.error || !result.verdict) return ['Pipeline: ' + (result.error ?? 'thiếu kết luận')]
  const gaps: string[] = []
  if (!item.expectedVerdicts.includes(result.verdict)) gaps.push('Verdict ' + result.verdict + ' · kỳ vọng ' + item.expectedVerdicts.join('/'))
  const missing = item.expectedRules.filter((rule) => !result.rules.includes(rule))
  if (missing.length) gaps.push('Thiếu ' + missing.join(', '))
  const prohibited = item.mustNotTriggerRules.filter((rule) => result.rules.includes(rule))
  if (prohibited.length) gaps.push('Kích hoạt sai ' + prohibited.join(', '))
  if (item.expectedAprRange) {
    const [min, max] = item.expectedAprRange
    if (!matchesApr(result, item.expectedAprRange)) gaps.push('APR ' + (result.apr ?? 'thiếu') + ' · kỳ vọng ' + min + '–' + max + '%')
  }
  if (item.expectedPersonalImpact && result.impact?.status !== item.expectedPersonalImpact) {
    gaps.push('Tác động cá nhân ' + (result.impact?.status ?? 'thiếu') + ' · kỳ vọng ' + item.expectedPersonalImpact)
  }
  if (result.media) {
    if (!result.media.purged) gaps.push('Buffer chưa được xóa')
    if (result.media.decodedQrCount !== result.media.expectedQrCount) gaps.push('ZXing ' + result.media.decodedQrCount + '/' + result.media.expectedQrCount + ' QR')
  }
  if (result.ocr?.some((probe) => !probe.matched)) gaps.push('OCR thiếu ' + result.ocr.filter((p) => !p.matched).map((p) => p.probe).join(', '))
  if (item.intentTarget && result.intentSignals && result.intentSignals[item.intentTarget] < 0.9) {
    gaps.push('Tín hiệu JEV mục tiêu dưới 0,9 (' + result.intentSignals[item.intentTarget].toFixed(3) + ')')
  }
  for (const [index, turn] of (item.followUp ?? []).entries()) {
    const actual = result.followUps[index]
    if (!matchesTurn(actual, turn)) gaps.push('Chat lượt ' + (index + 1) + ' · ' + (actual?.intent ?? 'thiếu') + '/' + turn.intent)
    if (actual?.degradedMode) gaps.push('Chat lượt ' + (index + 1) + ' · dùng câu trả lời dự phòng')
  }
  return gaps
}

const ratio = (n: number, d: number) => d ? (100 * n / d).toFixed(1).replace('.', ',') + '%' : '—'
const fraction = (n: number, d: number) => n + '/' + d + ' (' + ratio(n, d) + ')'
const mean = (values: number[]) => values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length) : 0
const p95 = (values: number[]) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!) : 0

function metrics(rows: CaseResult[]) {
  const usable = rows.filter((row) => row.verdict !== null)
  const negatives = rows.filter((row) => row.case.expectedVerdicts[0] === 'SAFE')
  const positives = rows.filter((row) => row.case.expectedVerdicts[0] !== 'SAFE')
  const count = (list: CaseResult[], predicate: (row: CaseResult) => boolean) => list.filter(predicate).length
  return {
    complete: usable.length,
    exact: fraction(count(rows, (r) => r.verdict === r.case.expectedVerdicts[0]), rows.length),
    accepted: fraction(count(rows, (r) => r.verdict !== null && r.case.expectedVerdicts.includes(r.verdict)), rows.length),
    safeSide: fraction(count(rows, (r) => r.verdict !== null && (r.case.expectedVerdicts.includes(r.verdict) ||
      levels.indexOf(r.verdict) >= levels.indexOf(r.case.expectedVerdicts[0]!))), rows.length),
    fp: fraction(count(negatives, (r) => r.verdict !== null && r.verdict !== 'SAFE'), negatives.length),
    fn: fraction(count(positives, (r) => r.verdict === 'SAFE'), positives.length),
    severeDowngrades: count(rows, (r) => r.case.expectedVerdicts[0] === 'HIGH_RISK' && r.verdict === 'CAUTION'),
    degraded: fraction(count(usable, (r) => r.degradedMode), usable.length),
    latencies: { averageMs: mean(rows.map((r) => r.latencyMs)), p95Ms: p95(rows.map((r) => r.latencyMs)) },
  }
}

export function summarizeBenchmark(rows: CaseResult[], runtime: { durationMs: number; cleaned: boolean }) {
  const overall = metrics(rows)
  const matrix = Object.fromEntries(levels.map((expected) => [expected, Object.fromEntries(levels.map((actual) =>
    [actual, rows.filter((row) => row.case.expectedVerdicts[0] === expected && row.verdict === actual).length]))]))
  const fixtures = rows.filter((r) => r.case.fixtureKey)
  const ocr = fixtures.flatMap((r) => r.ocr ?? [])
  const ocrExact = fixtures.filter((r) => r.ocr?.length && r.ocr.every((p) => p.matched)).length
  const vlmProviders = fixtures.reduce<Record<string, number>>((tally, row) => {
    const key = row.visionProvider ?? 'Không phản hồi'
    tally[key] = (tally[key] ?? 0) + 1
    return tally
  }, {})
  const intent = rows.filter((row) => row.case.intentTarget)
  const intentMetrics = Object.fromEntries((['biometricPhishingProb', 'recoveryScamProb', 'urgentCoercionProb'] as const).map((field) => {
    const subset = intent.filter((row) => row.case.intentTarget === field)
    const values = subset.flatMap((row) => row.intentSignals ? [row.intentSignals[field]] : [])
    return [field, { received: fraction(values.length, subset.length), average: values.length ? values.reduce((s, n) => s + n, 0) / values.length : null,
      low: values.filter((n) => n < 0.5).length, medium: values.filter((n) => n >= 0.5 && n < 0.9).length,
      high: values.filter((n) => n >= 0.9).length }]
  }))
  const narratives = rows.filter((row) => row.trace?.narrativeProvider)
  const grounding = fraction(narratives.filter((row) => row.trace?.narrativeGrounded).length, narratives.length)
  const payment = fraction(narratives.filter((row) => row.trace?.paymentMentioned).length, narratives.length)
  const reasoning = {
    responded: rows.filter((row) => row.trace?.reasoningProvider).length,
    proposed: rows.reduce((sum, row) => sum + (row.trace?.reasoningProposed ?? 0), 0),
    grounded: rows.reduce((sum, row) => sum + (row.trace?.reasoningGrounded ?? 0), 0),
    promoted: rows.filter((row) => row.trace && row.trace.baselineVerdict !== row.verdict).length,
  }
  const groupMetrics = Object.fromEntries(Object.keys(categories).map((key) => [key, metrics(rows.filter((row) => row.case.category === key))]))
  const difficultyMetrics = Object.fromEntries(difficulty.map((key) => [key, metrics(rows.filter((row) => row.case.difficulty === key))]))
  const stageTimes = Object.fromEntries(['EXTRACT', 'RULES', 'REASONING', 'NARRATIVE', 'FOLLOW_UP'].map((key) => {
    const values = rows.flatMap((row) => row.stageMs[key] === undefined ? [] : [row.stageMs[key]])
    return [key, { n: values.length, avg: mean(values), p95: p95(values) }]
  }))
  const transport: Record<string, number> = {}
  for (const row of rows) for (const [key, count] of Object.entries(row.transport)) transport[key] = (transport[key] ?? 0) + count
  const aprCases = rows.flatMap((row) => row.case.expectedAprRange ? [{ row, range: row.case.expectedAprRange }] : [])
  const impactCases = rows.filter((row) => row.case.expectedPersonalImpact)
  const expectationRules = rows.flatMap((row) => row.case.expectedRules.map((rule) => row.rules.includes(rule)))
  const chat = rows.flatMap((row) => (row.case.followUp ?? []).map((turn, index) => matchesTurn(row.followUps[index], turn)))
  return { runtime, overall, matrix, groupMetrics, difficultyMetrics, stageTimes,
    apr: fraction(aprCases.filter(({ row, range }) => matchesApr(row, range)).length, aprCases.length),
    personalImpact: fraction(impactCases.filter((row) => row.impact?.status === row.case.expectedPersonalImpact).length, impactCases.length),
    rules: fraction(expectationRules.filter(Boolean).length, expectationRules.length),
    followUp: fraction(chat.filter(Boolean).length, chat.length),
    vlm: { fixtures: fixtures.length, skipped: rows.filter((row) => row.visionNeeded === false).length, fullyCorrect: fraction(ocrExact, fixtures.length), probes: fraction(ocr.filter((p) => p.matched).length, ocr.length), providers: vlmProviders,
      zxExact: fraction(fixtures.filter((r) => r.media && r.media.decodedQrCount === r.media.expectedQrCount).length, fixtures.length),
      rasterPages: fixtures.reduce((sum, row) => sum + (row.media?.pdfRasterCount ?? 0), 0),
      purged: fixtures.filter((row) => row.media?.purged).length },
    jev: { all: fraction(rows.filter((row) => row.intentSignals).length, rows.length),
      targeted: fraction(intent.filter((row) => row.intentSignals).length, intent.length), targetDistribution: intentMetrics },
    reasoning, narrative: { responded: narratives.length, grounding, payment,
      retried: narratives.filter((row) => row.trace?.narrativeRetried).length }, transport }
}

export function benchmarkMarkdown(rows: CaseResult[], summary: ReturnType<typeof summarizeBenchmark>) {
  const { overall, matrix, vlm, jev, reasoning, narrative, stageTimes } = summary
  const findings = rows.filter((row) => deviations(row).length || row.fallbacks.length)
  const weakGroup = (category: BenchmarkCase['category']) => rows.filter((r) => r.case.category === category && deviations(r).length)
  const recommendationCandidates = [
    ['ponzi', 'Mở rộng phát hiện chốt đơn, nhận hoa hồng và tỷ suất cao sau khi quy lãi ngày/tuần về cùng kỳ.'],
    ['adversarial', 'Tăng độ bền của chuẩn hóa với teencode, ký tự ngăn cách và tin nhắn thúc chuyển gấp.'],
    ['loans', 'Đối chiếu lịch trả ngày/tuần và điều khoản với nguồn OCR/PDF trước khi tính APR.'],
    ['phishing', 'Bổ sung ca thu hồi vốn nói tránh và đối chiếu điểm JEV với dấu hiệu trực tiếp.'],
    ['clean', 'Tách câu tuyên truyền có phủ định khỏi yêu cầu chuyển phí hoặc thông tin xác thực.'],
    ['crypto', 'Đối chiếu hành vi yêu cầu nạp để rút, kể cả khi thiếu QR hoặc địa chỉ ví.'],
    ['emv', 'Dùng phân loại từng mã trong ảnh đa QR khi lập kết luận hợp nhất.'],
    ['followUp', 'Đánh giá riêng câu chat bổ sung và các lần phải dùng nội dung dự phòng.'],
  ] as const
  const recommendations = recommendationCandidates.map(([key, text]) => {
    const cases = weakGroup(key)
    const priority = cases.reduce((score, row) => score + (row.verdict === 'SAFE' && row.case.expectedVerdicts[0] !== 'SAFE' ? 4 : 1), 0)
    return { text, cases, priority }
  }).filter(({ cases }) => cases.length).sort((first, second) => second.priority - first.priority)
  const breakdown = (data: Record<string, ReturnType<typeof metrics>>, label: (key: string) => string) => [
    '| Nhóm | Exact | Đạt kỳ vọng | Safe-side | FP | FN | Degraded | p95 (ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(data).map(([key, m]) => '| ' + [label(key), m.exact, m.accepted, m.safeSide, m.fp, m.fn, m.degraded, m.latencies.p95Ms].join(' | ') + ' |'),
  ]
  return [
    '# Benchmark 100 ca giám định tài chính',
    '',
    'Chạy thực tế qua Nest service và Postgres với 2 tác vụ đồng thời. Vision chạy khi có hình ảnh hoặc văn bản phức tạp chưa được trích xuất xác định. JEV, Rules, Deep Reasoning và Narrative được thực thi kể cả với ca dễ. OCR được chấm từ đầu vào hình ảnh.',
    '',
    'Gemini 3.8 Flash xử lý Vision và Deep Reasoning. Gemini 3.5 Flash-Lite xử lý Narrative. Các tuyến OpenRouter có thể dùng Gemini 3.8 Flash, Gemini 3.5 Flash-Lite hoặc GPT-4.1 mini. JEV dùng OpenRouter Decisions với model typesafe/jev-1.13.',
    '',
    '## Tổng quan',
    '',
    '| Chỉ số | Kết quả |',
    '| --- | ---: |',
    '| Hoàn tất | ' + overall.complete + '/' + rows.length + ' |',
    '| Exact Verdict Accuracy | ' + overall.exact + ' |',
    '| Verdict trong tập kỳ vọng | ' + overall.accepted + ' |',
    '| Safe-side Accuracy | ' + overall.safeSide + ' |',
    '| False Positive Rate | ' + overall.fp + ' |',
    '| False Negative Rate | ' + overall.fn + ' |',
    '| HIGH_RISK bị hạ thành CAUTION | ' + overall.severeDowngrades + ' |',
    '| Degraded Mode | ' + overall.degraded + ' |',
    '| Độ trễ trung bình / p95 | ' + overall.latencies.averageMs + ' / ' + overall.latencies.p95Ms + ' ms |',
    '| Đã xóa dữ liệu benchmark trong Postgres | ' + (summary.runtime.cleaned ? 'Có' : 'Chưa xác minh') + ' |',
    '',
    'Exact và ma trận dùng nhãn đầu tiên làm nhãn chuẩn. Safe-side chấp nhận nhãn nằm trong tập kỳ vọng hoặc mức cảnh báo cao hơn nhãn chuẩn. FP là ca SAFE chuẩn bị cảnh báo. FN là ca CAUTION hoặc HIGH_RISK chuẩn bị trả SAFE. Ca lỗi xuất hiện trong tổng số và không tính vào một ô ma trận.',
    '',
    '| Nhãn chuẩn ↓ / Dự đoán → | SAFE | CAUTION | HIGH_RISK |',
    '| --- | ---: | ---: | ---: |',
    ...levels.map((level) => '| ' + level + ' | ' + levels.map((actual) => matrix[level]?.[actual] ?? 0).join(' | ') + ' |'),
    '',
    '## Từng tầng pipeline',
    '',
    '- VLM OCR đúng toàn bộ mốc trong tệp ' + vlm.fullyCorrect + '. Đúng theo từng mốc ' + vlm.probes + '. Có ' + vlm.fixtures + ' tệp và ' + vlm.rasterPages + ' trang PDF được raster. Bỏ qua Vision ở ' + vlm.skipped + ' ca. Provider ' + Object.entries(vlm.providers).map(([key, value]) => key + ' ' + value).join(', ') + '.',
    '- ZXing khớp số lượng nhãn QR ' + vlm.zxExact + '. Xác minh buffer tệp đã xóa ' + vlm.purged + '/' + vlm.fixtures + '.',
    '- Hard Rules khớp ' + summary.rules + ' nhãn rule bắt buộc. CashFlow IRR nằm trong khoảng APR chuẩn ' + summary.apr +
      '. Tác động cá nhân đúng ' + summary.personalImpact + '. Lượt chat đạt tiêu chí ' + summary.followUp + '.',
    '- JEV 1.13 phản hồi ' + jev.all + ' toàn tập và ' + jev.targeted + ' ở nhóm chuyên biệt. Bảng dưới dùng ngưỡng 0,5 và 0,9.',
    '- Deep Reasoning phản hồi ' + reasoning.responded + '/' + rows.length + '. Có ' + reasoning.proposed + ' nhận định đề xuất và ' + reasoning.grounded +
      ' nhận định mới qua kiểm tra dẫn chứng. ' + reasoning.promoted + ' ca đổi mức kết luận sau bước này.',
    '- Narrative có ' + narrative.responded + '/' + rows.length + ' phản hồi. Đạt grounding ' + narrative.grounding +
      '. Đạt kiểm tra nhắc giao dịch ' + narrative.payment + ' trong các ca có phản hồi. Thử lại ' + narrative.retried + ' ca.',
    '',
    '| Tín hiệu JEV | Phản hồi | Trung bình | < 0,5 | 0,5 đến < 0,9 | ≥ 0,9 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(jev.targetDistribution).map(([key, d]) => '| ' + [key, d.received, d.average?.toFixed(3) ?? '—', d.low, d.medium, d.high].join(' | ') + ' |'),
    '',
    '| Tầng | Mẫu đo | Trung bình (ms) | p95 (ms) |',
    '| --- | ---: | ---: | ---: |',
    ...Object.entries(stageTimes).map(([key, item]) => '| ' + [key, item.n, item.avg, item.p95].join(' | ') + ' |'),
    '',
    'HTTP quan sát theo tuyến ' + Object.entries(summary.transport).map(([key, count]) => key + '=' + count).join(', ') + '.',
    '',
    '## Theo nhóm',
    '',
    ...breakdown(summary.groupMetrics, (key) => categories[key as keyof typeof categories]),
    '',
    '## Theo độ khó',
    '',
    ...breakdown(summary.difficultyMetrics, (key) => key),
    '',
    '## Ca sai lệch và ca yếu',
    '',
    ...findings.map((row) => '- **' + row.case.id + ' · ' + row.case.title + '** · ' + [...deviations(row), ...row.fallbacks].join(' · ')),
    ...(!findings.length ? ['Không có sai lệch theo tiêu chí đã định.'] : []),
    '',
    '## Ưu tiên cải thiện từ số liệu',
    '',
    'Xếp theo số ca có sai lệch. Ca rủi ro được trả SAFE có trọng số gấp bốn.',
    '',
    ...recommendations.map((item) => '- ' + item.text + ' Ca quan sát ' + item.cases.map((row) => row.case.id).join(', ') + '.'),
    ...(narrative.responded < rows.length || overall.degraded !== fraction(0, overall.complete)
      ? ['- Phân loại riêng lỗi kết nối, grounding và thiếu nhắc giao dịch khi xem xét cải thiện tỷ lệ fallback.'] : []),
    '',
  ].join('\n')
}
