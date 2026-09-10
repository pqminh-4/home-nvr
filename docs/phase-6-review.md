# Review Phần 6 — Motion, lịch và webhook

## Kết quả

- Event engine tạo và gộp motion event theo camera, ngưỡng confidence và lịch trong múi giờ hệ thống; lịch qua nửa đêm đã có test.
- Pre/post buffer tạo cửa sổ sự kiện và liên kết mọi fMP4 segment giao nhau. Event mode dùng rolling recording để giữ pre-buffer, rồi xóa segment không liên kết sau 180 giây.
- Rule riêng từng camera gồm bật/tắt, sensitivity 1–100, pre-buffer 0–120 giây, post-buffer 1–300 giây, ngày và giờ hoạt động.
- URL webhook được mã hóa AES-256-GCM. Delivery timeout 5 giây, retry exponential backoff, tối đa 5 lần và không gửi dồn cùng một event mới.
- API owner-only: `GET /events`, `GET/PATCH /cameras/:id/event-rule`, `POST /cameras/:id/motion`, `GET/PATCH /settings`.
- UI Sự kiện, Cảnh báo và Cài đặt đã thay dữ liệu minh họa bằng API thật; guest nhận trạng thái từ chối rõ ràng.

## Kiểm thử

- `npm run check`: typecheck, 52/52 unit/integration tests và production build đạt.
- Event tests bao phủ độ nhạy, lịch qua nửa đêm, gộp tín hiệu, liên kết recording và webhook thất bại rồi retry thành công.
- API integration test bao phủ cập nhật rule, motion ingest, list events và settings.
- `NVR_BROWSER_CHANNEL=msedge npm run test:browser`: 16/16 đạt trên desktop/mobile, không tràn ngang hoặc lỗi console.
- Dev smoke status: `phase=6`, `database=ok`, `media=ready`, `recording=ready`, `events=ready`.

## Giới hạn nghiệm thu thực địa

Camera/ONVIF detector cần gửi confidence vào motion ingest. Chưa đo false-positive, sự kiện liên tiếp trên camera thật, webhook Internet hoặc tải CPU nhiều camera vì cấu hình Ubuntu, phần cứng và số camera vẫn chưa xác nhận.
