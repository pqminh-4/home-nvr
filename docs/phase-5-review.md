# Review Phần 5 — Ghi hình, playback và export

## Phạm vi

Phần 5 nối ghi hình liên tục bằng MediaMTX native fMP4, chỉ mục segment trong SQLite, retention, playback theo HTTP Range, timeline và export clip từ giao diện web.

## Kết quả nghiệm thu kỹ thuật

- MediaMTX v1.21.0 ghi theo thư mục `.data/recordings/<camera-id>/` với segment fMP4 dài một phút; record path được cấu hình theo từng camera.
- `RecordingManagerService` lập chỉ mục sau khởi động và mỗi 30 giây, nhận diện file đang ghi, phục hồi file sau restart và không phát/xóa segment còn ở trạng thái `writing`.
- Retention mặc định 7 ngày, có giới hạn dung lượng tùy chọn, đánh dấu `deleting` trước khi unlink và chuyển `failed` nếu file không thể xóa.
- Export dùng `copyFile` theo stream của hệ điều hành, không đọc toàn bộ video vào RAM; asset export hết hạn sau 30 phút và được dọn khi tick/shutdown.
- Route owner-only:
  - `GET /api/v1/recordings`
  - `GET /api/v1/recordings/:id/playback` với `Range: bytes=...`
  - `POST /api/v1/recordings/export`
  - `GET /api/v1/recordings/exports/:exportId/:asset`
- Nút chi tiết camera bật/tắt `recordingMode=continuous`, sau đó recorder cấu hình MediaMTX động.
- UI Bản ghi dùng video thật khi có dữ liệu, lọc camera, chọn segment trên timeline và xuất tệp; trạng thái preview vẫn được gắn nhãn khi kho chưa có bản ghi.

## Kiểm thử

- `npm run typecheck`: đạt.
- `npm test`: 49 tests đạt, gồm 3 test Recordings API cho list, Range playback, export, restart/retention và quyền owner.
- `npm run build`: đạt; bundle web production tạo thành công.
- `NVR_BROWSER_CHANNEL=msedge npm run test:browser`: 16/16 đạt trên desktop và mobile.
- Smoke test API với MediaMTX local: `/api/v1/system/status` trả `{"phase":5,"database":"ok","media":"ready","recording":"ready","setup":"owner-required"}`.

## Giới hạn còn lại

Chưa có số đo ghi liên tục 24 giờ, đầy đĩa, reboot trên Ubuntu hoặc nhiều camera thật vì cấu hình CPU/RAM/ổ đĩa, số camera và độ phân giải chưa được xác nhận. Phần 6 sẽ bổ sung motion, pre/post buffer, lịch và webhook sau khi Phần 5 được người dùng duyệt.
