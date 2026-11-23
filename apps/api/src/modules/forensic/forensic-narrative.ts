import type { VerdictLevel } from '@fincopilot/shared-types'

export function deterministicNarrative(verdict: VerdictLevel, count: number) {
  switch (verdict) {
    case 'HIGH_RISK':
      return {
        narrative: `Nguy hiểm cao. Báo cáo ghi nhận ${count} dấu hiệu cần đối chiếu. Dừng chuyển tiền ngay.`,
        immediateActions: [
          'Dừng chuyển tiền và ngừng chia sẻ OTP hoặc thông tin sinh trắc học.',
          'Nếu đã chuyển tiền, gọi tổng đài chính thức của ngân hàng để yêu cầu hỗ trợ khẩn cấp.',
          'Giữ lại biên lai và tin nhắn, sau đó trình báo cơ quan Công an.',
        ],
      }
    case 'CAUTION':
      return {
        narrative: 'Cần thận trọng. Hãy xác minh danh tính bên nhận và điều khoản qua kênh chính thức trước khi giao dịch.',
        immediateActions: ['Đối chiếu giấy phép và tên bên nhận qua kênh chính thức trước khi chuyển tiền.'],
      }
    case 'SAFE':
      return {
        narrative: 'Chưa phát hiện dấu hiệu rủi ro trong dữ liệu đã kiểm tra. Kết quả phụ thuộc vào bằng chứng được cung cấp.',
        immediateActions: ['Xác nhận điều khoản và tài khoản nhận tiền với tổ chức qua kênh chính thức.'],
      }
  }
}
