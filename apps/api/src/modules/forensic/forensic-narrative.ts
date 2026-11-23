import type { ForensicAuditResponse, VerdictLevel } from '@fincopilot/shared-types'

export function deterministicNarrative(verdict: VerdictLevel, count: number) {
  switch (verdict) {
    case 'HIGH_RISK':
      return {
        narrative: `Mình thấy ${count} dấu hiệu đáng lo. Bạn nên dừng chuyển tiền và kiểm tra lại qua kênh chính thức.`,
        immediateActions: [
          'Dừng chuyển tiền và ngừng chia sẻ OTP hoặc thông tin sinh trắc học.',
          'Nếu đã chuyển tiền, gọi tổng đài chính thức của ngân hàng để yêu cầu hỗ trợ khẩn cấp.',
          'Giữ lại biên lai và tin nhắn, sau đó trình báo cơ quan Công an.',
        ],
      }
    case 'CAUTION':
      return {
        narrative: 'Mình chưa có đủ thông tin để yên tâm về giao dịch này. Bạn nên kiểm tra lại người nhận trước khi chuyển.',
        immediateActions: ['Hỏi lại người nhận qua số bạn đã biết. Với bên cho vay hoặc đầu tư, kiểm tra thêm qua kênh chính thức của họ.'],
      }
    case 'SAFE':
      return {
        narrative: 'Mình chưa thấy dấu hiệu đáng ngờ trong phần bạn gửi. Bạn vẫn nên đối chiếu tên người nhận và số tiền trên app trước khi xác nhận.',
        immediateActions: ['Nếu tên hoặc số tiền hiện trên app khác với thỏa thuận, hãy hỏi lại người nhận trước khi chuyển.'],
      }
  }
}

export function followUpAnchor(audit: ForensicAuditResponse) {
  const headline = audit.verdictLevel === 'HIGH_RISK' ? 'Mức nguy hiểm cao'
    : audit.verdictLevel === 'CAUTION' ? 'Cần thận trọng' : 'Chưa thấy dấu hiệu đáng ngờ'
  const action = deterministicNarrative(audit.verdictLevel, audit.findings.length).immediateActions[0]
  return `${headline} (${audit.riskScore}/100). ${action}`
}
