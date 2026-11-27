import type { ForensicAuditResponse, RiskTier } from '@fincopilot/shared-types'
import { Download, Printer } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/utils'

const stages: readonly [RiskTier, string, string][] = [
  ['T0', 'Chưa thấy dấu hiệu bất thường', 'bg-verdict-safe'],
  ['T1', 'Cần kiểm chứng thêm', 'bg-verdict-warning'],
  ['T2', 'Rủi ro cao', 'bg-[#b95621]'],
  ['T3', 'Dừng giao dịch ngay', 'bg-verdict-danger'],
]

const help = [
  ['Mức rủi ro từ chưa thấy bất thường, cần kiểm chứng, rủi ro cao đến dừng giao dịch.', 'NIST RMF / ISO 31000', 'https://csrc.nist.gov/pubs/sp/800/37/r2/final'],
  ['Độ chắc chắn gồm bằng chứng xác thực, có trích dẫn, dấu hiệu ban đầu hoặc chưa đủ dữ kiện.', 'NATO Admiralty / STIX 2.1', 'https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html'],
  ['Đối chiếu cảnh báo và thông tin giao dịch theo nguồn công bố.', 'SIMO – Ngân hàng Nhà nước', 'https://www.sbv.gov.vn/'],
  ['Gọi tên thủ đoạn dựa trên dấu hiệu trong báo cáo.', '24 hình thức của Cục An toàn thông tin', 'https://vkist.mst.gov.vn/vi/post/thang-hanh-dong-tuyen-truyen-ve-nhan-dien-va-phong-chong-lua-dao-truc-tuyen-602.htm'],
] as const

export function reportRisk(audit: ForensicAuditResponse) {
  if (audit.riskAssessment) return audit.riskAssessment
  const serious = audit.deterministicOverride || audit.riskScore >= 75 || audit.findings.some(item => item.severity === 'CRITICAL')
  const enough = Boolean(audit.qrPayloads.length || audit.entityLicense || audit.mathBreakdown || audit.findings.length)
  const riskTier: RiskTier = serious ? 'T3' : audit.verdictLevel === 'HIGH_RISK' ? 'T2' : audit.verdictLevel === 'CAUTION' || !enough ? 'T1' : 'T0'
  const abstention = !enough && riskTier === 'T1'
  return {
    riskTier, abstention, actionLabelVi: abstention ? 'Chưa đủ dữ kiện để kết luận' : stages.find(([id]) => id === riskTier)![1],
    confidenceLabelVi: enough ? 'Có dữ kiện trong báo cáo' : 'Chưa đủ bằng chứng để kết luận',
    abstentionPrompt: abstention ? 'Bạn có thể gửi thêm hợp đồng, mã QR hoặc tên đơn vị cần kiểm tra.' : null,
  }
}

export function FersRiskScale({ tier }: { tier: RiskTier }) {
  return <>
    <ol data-testid="fers-risk-scale" aria-label="Bốn mức rủi ro" className="grid grid-cols-4 gap-1.5" role="list">
      {stages.map(([id, label, color]) => <li key={id} aria-current={id === tier ? 'step' : undefined}
        className={cn('h-2 rounded-full', id === tier ? color : 'bg-current/20')}>
        <span className="sr-only">{label}</span>
      </li>)}
    </ol>
    <details className="print-hidden">
      <summary aria-label="Cách FinCopilot đánh giá" className="grid size-8 cursor-pointer list-none place-items-center rounded-full border border-current/30 bg-card font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">?</summary>
      <ul className="mt-2 grid gap-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground" role="list">
        {help.map(([text, source, href]) => <li className="[overflow-wrap:anywhere]" key={source}>{text}{' '}
          <a href={href} target="_blank" rel="noreferrer" className="underline">{source}</a></li>)}
      </ul>
    </details>
  </>
}

export function FersEvidenceLedger({ audit }: { audit: ForensicAuditResponse }) {
  const assessment = audit.riskAssessment
  if (!assessment) return null
  return <details data-print-open className="report-print-card rounded-lg border border-border p-4">
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">Sổ bằng chứng &amp; Chuẩn đối chiếu</summary>
    <p className="pb-2 text-sm">{assessment.standardVersion} · {assessment.riskTier} · {assessment.evidenceConfidence}</p>
    <p className="text-sm">{assessment.standardsCited.join(' · ')}</p>
    {assessment.taxonomy.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" role="list">
      {assessment.taxonomy.map(item => <li className="max-w-full rounded-lg border bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]" key={item.vnAisCode}>
        {item.vnAisCode} · {item.vnAisLabel}<span className="block text-muted-foreground">GASA · {item.gasaCategory}</span>
      </li>)}
    </ul>}
    {assessment.evidenceChain.length ? <div className="mt-4 max-w-full">
      <table role="table" className="block w-full table-fixed border-collapse text-left text-sm [overflow-wrap:anywhere] sm:table">
        <caption className="block pb-2 text-left font-semibold sm:table-caption">Chuỗi bằng chứng</caption>
        <thead role="rowgroup" className="sr-only sm:not-sr-only sm:table-header-group"><tr role="row" className="border-b text-muted-foreground">
          <th scope="col" className="py-2 pe-2">Hạng bằng chứng</th>
          <th scope="col" className="w-[36%] py-2 pe-2">Trích dẫn / Dữ liệu giải mã</th>
          <th scope="col" className="py-2 pe-2">Quy định / Chuẩn đối chiếu</th>
          <th scope="col" className="py-2">Tác động tài chính</th>
        </tr></thead>
        <tbody role="rowgroup" className="block sm:table-row-group">{assessment.evidenceChain.map((item, index) =>
          <tr role="row" key={index} className="mb-3 flex flex-col gap-2 rounded-lg border p-3 align-top sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:p-0">
            <td role="cell" className="block sm:table-cell sm:py-2 sm:pe-2">
              <strong>Hạng {item.grade}</strong><span className="block">{item.gradeLabel}</span>
            </td>
            <td role="cell" className="block sm:table-cell sm:py-2 sm:pe-2">
              <span className="block text-muted-foreground">{item.sourceType}</span>{item.quoteOrDecoded}
            </td>
            <td role="cell" className="block sm:table-cell sm:py-2 sm:pe-2">
              <span aria-hidden="true" className="block text-muted-foreground sm:hidden">Quy định / Chuẩn đối chiếu</span>{item.ruleOrLawRef}
            </td>
            <td role="cell" className="block sm:table-cell sm:py-2">
              <span aria-hidden="true" className="block text-muted-foreground sm:hidden">Tác động tài chính</span>{item.financialImpact ?? '—'}
            </td>
          </tr>)}</tbody>
      </table>
    </div> : <p className="mt-3 text-sm">Chưa có dữ kiện đủ để ghi vào sổ bằng chứng.</p>}
    <div className="print-hidden mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11" onClick={() => window.print()}>
        <Printer size={16} aria-hidden="true" /> In sổ bằng chứng
      </Button>
      <a className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 whitespace-normal')} download
        href={'/api/v1/forensic/audits/' + encodeURIComponent(audit.auditId) + '/export?format=stix'}>
        <Download size={16} aria-hidden="true" /> Tải hồ sơ STIX 2.1 (JSON)
      </a>
    </div>
  </details>
}
