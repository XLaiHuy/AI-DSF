# Phân hệ 2 — Luồng Khảo sát và Công thức Tài chính

Tài liệu này mô tả cách chạy, luồng xử lý của `/survey` và các công thức được dùng trong `packages/financial-math`.

## 1. Chạy local

Mở PowerShell tại thư mục dự án:

```powershell
corepack pnpm install
docker compose up -d
corepack pnpm --filter api db:migrate
corepack pnpm --filter api db:seed
```

Chạy API và frontend ở hai terminal riêng:

```powershell
corepack pnpm --filter api dev
```

```powershell
corepack pnpm --filter web dev
```

Mở: `http://localhost:3000/survey`.

Kiểm tra dịch vụ Docker:

```powershell
docker compose ps
```

Chạy test công thức:

```powershell
corepack pnpm --filter @fincopilot/financial-math test
```

## 2. Luồng xử lý khảo sát

```text
Người dùng mở /survey
        |
        v
Chọn một trong ba tab:
  1. Khảo sát vay
  2. Đầu tư / tích lũy
  3. Tự nhập số liệu so sánh
        |
        v
Nhập dữ liệu và bấm tính toán
        |
        v
Frontend gọi API Survey hoặc Calculator
        |
        +--> Kiểm tra Trust Filter
        |      Tổ chức không hợp pháp -> chuyển /forensic
        |
        +--> Tính toán bằng Decimal.js
        |
        +--> Lưu phiên khảo sát / lịch sử nếu có session
        |
        v
Trả kết quả:
  - Bảng đối chiếu gói vay
  - Khoản phải trả hàng tháng
  - Lịch trả nợ từng tháng
  - DTI và mức cảnh báo
  - Biểu đồ / mô phỏng cú sốc lãi suất
  - Kịch bản đầu tư hoặc dữ liệu tự nhập
```

Các thành phần chính:

- UI: `apps/web/src/app/survey/page.tsx` và `apps/web/src/components/survey/SurveyWorkspace.tsx`.
- API: `apps/api/src/modules/survey-calc/survey-calc.controller.ts`.
- Nghiệp vụ: `apps/api/src/modules/survey-calc/survey-calc.service.ts`.
- Công thức: `packages/financial-math/src/index.ts`.
- DTO dùng chung: `packages/shared-types/src/dto/survey.dto.ts`.

## 3. Các API chính

Base URL khi chạy local: `http://localhost:4000`.

| Mục đích | Method | Endpoint |
|---|---:|---|
| Tính khảo sát vay | POST | `/api/v1/survey/loan` |
| Tính đầu tư / tích lũy | POST | `/api/v1/survey/investment` |
| So sánh số liệu tự nhập | POST | `/api/v1/calculator/manual-compare` |
| Mở phiên đã lưu theo chủ sở hữu | GET | `/api/v1/survey/sessions/:id` |
| Lấy lịch sử khảo sát | GET | `/api/v1/survey/history` |

Mở lại kết quả qua /survey?sessionId=ID. Máy chủ kiểm tra chủ sở hữu và trả 404 nếu phiên không thuộc người gọi. Với phiên vay mới, máy chủ khôi phục lịch trả nợ khi lãi tăng từ các tham số đã lưu tại thời điểm tính. Các phiên cũ vẫn dùng lịch đã lưu.

| Mục đích vay | Giá trị loanUseCase | Khoảng kỳ hạn trong bản danh mục tham chiếu |
|---|---|---|
| Tín chấp theo lương | UNSECURED_SALARY | 6–60 tháng |
| Mua nhà | HOME_MORTGAGE | 12–420 tháng |
| Mua ô tô | AUTO_LOAN | 12–96 tháng |
| Bổ sung vốn kinh doanh | BUSINESS_WORKING_CAPITAL | 1–12 tháng |
| Trả góp tiêu dùng | CONSUMER_FLAT_INSTALLMENT | 6–36 tháng |

Danh mục đang hoạt động quyết định số tiền, kỳ hạn và gói đủ điều kiện. Khoảng trên là biên tổng hợp của các sản phẩm trong từng nhóm.

So sánh thủ công nhận 2–4 phương án, mỗi phương án có phương thức trả nợ, phí trả trước, phí hằng tháng, lãi sau ưu đãi và tùy chọn tất toán. Khi tất toán sau kỳ đã chọn, tổng chi gồm các khoản đã trả, dư nợ còn lại và phí tất toán trên dư nợ. APR tại thời điểm tất toán được tính từ dòng tiền đến kỳ đó.

Đầu tư có ba nhóm tiết kiệm, tích lũy và quỹ mở. Với OPEN_FUND, kịch bản cơ sở lấy tỷ suất mô phỏng từ sản phẩm. Kịch bản thận trọng giảm 3,5 điểm phần trăm với sàn 1%, kịch bản tích cực tăng 3,5 điểm. Đường dự phóng thể hiện vốn góp và giá trị ròng sau phí, thuế theo giả định.

Recharts hiển thị lịch trả nợ và lịch khi lãi tăng, lãi công bố so với APR, DTI, dự phóng đầu tư và chi phí khoản vay trong Giám định. Với kỳ hạn trên 36 tháng, biểu đồ cộng dòng tiền từng năm và lấy dư nợ cuối kỳ. Bảng giữ chi tiết từng tháng.

Ví dụ body khảo sát vay:

```json
{
  "principalVnd": "1000000000",
  "termMonths": 120,
  "productCategory": "SECURED_LOAN",
  "priority": "LOWEST_APR",
  "checkEntityName": "BIDV",
  "dtiOverride": {
    "monthlyIncomeVnd": "30000000",
    "monthlyExpenseVnd": "12000000",
    "existingDebtPaymentVnd": "3000000"
  }
}
```

Kỳ hạn từ 1 đến 600 tháng. Tiền và lãi suất truyền dưới dạng chuỗi thập phân. Phí trả trước làm giảm tiền thực nhận và được phản ánh trong APR qua dòng tiền. Gói thả nổi hiển thị giả định về lãi tương lai khi nguồn chưa có đủ dữ liệu.

`POST /api/v1/admin/products/sync` nhập danh mục UTF-8 từ `config/loan-rate-snapshot.json`. Trang nguồn được kiểm tra khả năng truy cập độc lập với việc đối chiếu mức lãi. Dùng `pnpm crawl:loan-rates --out test-results/loan-rate-candidates.json` để xuất ứng viên cần rà soát.

Danh mục ghi ngày hiệu lực khi nguồn công bố ngày đó. Các mức quan sát và lịch sử có ghi chú riêng. Ví dụ, mức gửi VietinBank tháng 5 được lưu dưới dạng tham khảo lịch sử. [Bản chụp biểu công bố ngày 08/05/2026](https://storage.googleapis.com/vinhomes-data-02/2026.05.13_VHMB2126003_TB%20LS%20CHO%20KY%20TINH%20LAI%2019_0.pdf)

## 4. Công thức khoản vay

### 4.1. Trả góp đều — EMI / dư nợ giảm dần

Đặt:

- `P`: số tiền vay ban đầu.
- `r`: lãi suất tháng = lãi suất năm / 12 / 100.
- `n`: tổng số tháng.

Nếu `r > 0`:

```text
EMI = P × r × (1 + r)^n / ((1 + r)^n - 1)
```

Nếu `r = 0`:

```text
EMI = P / n
```

Mỗi tháng:

```text
Lãi tháng       = Dư nợ đầu kỳ × r
Gốc tháng       = EMI - Lãi tháng
Dư nợ cuối kỳ   = Dư nợ đầu kỳ - Gốc tháng
```

Tháng cuối được hiệu chỉnh để dư nợ cuối kỳ bằng `0`, tránh sai số làm tròn.

### 4.2. Gốc đều

```text
Gốc mỗi tháng = P / n
Lãi tháng     = Dư nợ đầu kỳ × r
Thanh toán    = Gốc mỗi tháng + Lãi tháng
```

Khoản thanh toán giảm dần theo thời gian vì dư nợ giảm đều.

### 4.3. Lãi phẳng

Với lãi suất phẳng năm `f`:

```text
Tổng lãi       = P × f × n / 12
Tổng phải trả  = P + Tổng lãi
Thanh toán tháng = Tổng phải trả / n
```

Lãi phẳng tính trên `P` ban đầu trong toàn bộ thời hạn, không tính trên dư nợ thực tế.

## 5. Quy đổi APR / EAR

### 5.1. APR danh nghĩa

Nếu có lãi suất tháng `r`:

```text
APR = r × 12 × 100
```

Đối với khoản vay lãi phẳng, hệ thống xây dựng dòng tiền thực tế và tìm lãi suất tháng `i` sao cho giá trị hiện tại ròng bằng `0`:

```text
0 = -P + Σ (Payment_t / (1 + i)^t)
APR thực = i × 12 × 100
```

`i` được tìm bằng Newton–Raphson với Decimal.js.

### 5.2. EAR / lãi suất hiệu dụng năm

```text
EAR = ((1 + i)^12 - 1) × 100
```

Trong đó `i` là lãi suất tháng thực tế.

## 6. Tỷ lệ nợ DTI

```text
DTI = (Tổng nghĩa vụ trả nợ hàng tháng / Thu nhập hàng tháng) × 100
```

Trong đó:

```text
Tổng nghĩa vụ = Khoản vay mới hàng tháng + Các khoản nợ hiện tại
```

Mức diễn giải mặc định:

- `<= 35%`: tương đối an toàn.
- `> 35%` đến `45%`: cần thận trọng.
- `> 45%` đến `50%`: áp lực cao.
- `> 50%`: rủi ro cao, nên giảm khoản vay hoặc tăng thu nhập.

Nếu thu nhập bằng `0`, hệ thống trả DTI `null` với trạng thái `UNAVAILABLE` và vẫn tính dòng tiền còn lại.

## 7. Lãi kép và tích lũy định kỳ

Với vốn ban đầu `P`, khoản nộp mỗi kỳ `C`, lãi suất năm `a`, số kỳ ghép lãi mỗi năm `m`, số năm `t`:

```text
r = a / m
n = m × t
```

Vốn ban đầu:

```text
FV_initial = P × (1 + r)^n
```

Khoản đóng cuối mỗi kỳ:

```text
FV_contribution = C × ((1 + r)^n - 1) / r
```

Tổng giá trị tương lai:

```text
FV = FV_initial + FV_contribution
```

Khi `r = 0`:

```text
FV = P + C × n
```

## 8. Kiểm thử chuẩn V1–V4

Các test nằm tại `packages/financial-math/src/math.spec.ts` và bao phủ:

- V1: EMI / dư nợ giảm dần.
- V2: gốc đều.
- V3: lãi phẳng và quy đổi APR/EAR.
- V4: DTI, lãi kép và tích lũy định kỳ.

Lệnh chạy:

```powershell
corepack pnpm --filter @fincopilot/financial-math test
```

## 9. Lỗi thường gặp

- `P1001 Can't reach database`: Docker chưa chạy hoặc PostgreSQL chưa healthy; kiểm tra bằng `docker compose ps`.
- `'pnpm' is not recognized`: dùng `corepack pnpm ...`, không gọi trực tiếp `pnpm`.
- `Cannot use 'in' operator ... undefined`: API chưa trả `offers`; kiểm tra API đang chạy đúng branch và database đã seed.
- AI trả `401`: key/model trong `.env` không hợp lệ. Có thể dùng chuỗi fallback của dự án, nhưng không commit `.env`.
- Trang `/survey` trả `404`: frontend đang chạy code cũ hoặc route chưa được build; dừng dev server rồi chạy lại `corepack pnpm --filter web dev`.

## 10. Quy tắc an toàn

- Không commit hoặc push file `.env`.
- Không đưa dữ liệu cá nhân thật vào test hoặc log.
- Nếu Trust Filter từ chối tổ chức tài chính, giữ nguyên hướng chuyển sang `/forensic` để kiểm tra thêm.
