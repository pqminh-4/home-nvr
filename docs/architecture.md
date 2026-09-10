# Kiến trúc và hợp đồng Phần 1

## Ranh giới triển khai

- `apps/web`: React/Vite/Tailwind; chỉ có trang kỹ thuật kiểm tra kết nối. Stitch, Emil và React Bits áp dụng vào sản phẩm ở Phần 2 sau khi được duyệt.
- `apps/api`: Fastify/TypeScript, cấu hình, logging, SQLite và trạng thái hệ thống.
- `packages/contracts`: JSON Schema và TypeScript dùng chung; không đưa secret vào DTO đầu ra.
- MediaMTX chạy như tiến trình native riêng, cung cấp WebRTC/LL-HLS và ghi fMP4; Node chỉ quản lý cấu hình, session, chỉ mục và HTTP proxy, không kéo khung video qua vòng lặp ứng dụng. `MediaGateway` giữ ranh giới tích hợp và FFmpeg chỉ dùng khi cần chuyển codec.
- SQLite dùng `node:sqlite` trên Node 24 đã pin; adapter tập trung tại một module để kiểm soát thay đổi runtime. WAL, foreign key, busy timeout; tác vụ ghi sau này phải ngắn, không chạy phân tích video trong transaction.

## API hoạt động hiện tại

| Giao diện | Kết quả |
| --- | --- |
| `GET /health/live` | 200 khi tiến trình đáp ứng |
| `GET /health/ready` | 200 khi SQLite đọc được; 503 nếu không |
| `GET /api/v1/system/status` | Trạng thái database, phase=1, media=not-configured |
| `GET /api/v1/openapi.json` | OpenAPI 3.1; chỉ `paths` hiện có được coi đã triển khai |
| `WS /ws/v1/system` | `system.status`, version=1, timestamp UTC, data; gửi ngay rồi mỗi 10 giây |

WebSocket chỉ đọc, payload tối đa 1 KiB, đóng client ghi dữ liệu hoặc quá chậm. Kênh không truyền camera/secret. Khi có xác thực ở Phần 3 phải kiểm tra phiên khi upgrade và khi hết hạn; không được giữ cơ chế loopback-only cho bản LAN chính thức.

Hiện chỉ lắng nghe `127.0.0.1`, kiểm tra Host và Origin, không bật CORS mở. Không được mở Tunnel hay bind `0.0.0.0` trước khi có xác thực. Readiness Phần 1 không xác nhận media pipeline hoạt động.

## Hợp đồng cho các phần sau

Danh mục method/path/phần triển khai/quyền ở `plannedOperations`. Đây là thiết kế, gọi các route đó hiện trả 404. Schema request chứa trường `writeOnly`; không được trộn vào DTO hoặc OpenAPI response của camera.

- ID: UUID được server tạo. Thời gian: ISO 8601 UTC; UI hiển thị theo `Asia/Ho_Chi_Minh`. Khoảng thời gian dùng `[from,to)`, kiểm tra `from < to` ở tầng dịch vụ.
- Response đơn: DTO trực tiếp. Danh sách: `{ items, nextCursor }`, cursor opaque, mặc định 50, tối đa 100; sự kiện/bản ghi sắp theo thời điểm và ID để phân trang ổn định.
- Lỗi: `{ error: { code, message, requestId } }`; 400 sai đầu vào, 401 chưa xác thực, 403 không có quyền, 404 không tồn tại/không được nhìn thấy, 409 xung đột, 503 dịch vụ không sẵn sàng. Không đưa exception gốc/URL/đường dẫn vào lỗi.
- Tạo trả 201, đọc/cập nhật trả 200, xóa/logout/đóng phiên trả 204. PATCH bỏ qua trường không gửi; `subSourceUrl: null` xóa substream; PATCH rỗng bị từ chối. Field lạ bị từ chối, không âm thầm strip.
- Thiết lập chủ: token một lần do server/installer sinh, username ASCII 3–80 ký tự, password 12–128 ký tự. Guest cần expiry tương lai, danh sách camera; chỉ chủ xem playback, sự kiện và điều khiển PTZ trong bản đầu.
- Phần 3 dùng cookie phiên HttpOnly, SameSite, Secure khi HTTPS; hash mật khẩu bằng Argon2id và hash token phiên lưu DB. Mutation kiểm tra Origin/CSRF. Chưa có tài khoản hoặc mật khẩu mặc định trong Phần 1.
- Tạo camera nhận name/location/mainSourceUrl/subSourceUrl. Server kiểm tra URL thực, chỉ chấp nhận RTSP/RTSPS, mã hóa toàn bộ URL nguồn bằng AES-256-GCM trước lưu. Khóa nằm ngoài DB/Git, backup/restore phải kèm khóa riêng. Tính năng mã hóa triển khai Phần 3; Phần 1 chưa nhận credential.
- Camera mới mặc định enabled=true, recordingMode=off, capabilities chưa được xác minh đều false. Kiểm tra ONVIF/RTSP phải có timeout; không quét LAN tự động khi chỉ khởi động app.
- Tạo live session nhận cameraId/profile/transport; trả endpoint tương đối cùng origin, không trả địa chỉ nội bộ MediaMTX. Session gắn với user và quyền camera, có hạn dùng; fallback là tạo phiên mới khi WebRTC thất bại, hủy phiên cũ.
- `GET recordings/events` nhận TimeRange; playback/snapshot/media vẫn kiểm quyền ở mỗi truy cập. URL đã đoán được không thay thế kiểm tra quyền.
- Settings mặc định retention 7 ngày, storageLimitBytes=null (chưa cấu hình hạn mức), remote=false. Không bắt đầu ghi trước khi kiểm tra dung lượng và chính sách lưu trữ.

## Vòng đời và tính nhất quán

- Camera: disabled → connecting → online; lỗi kết nối chuyển offline/error; reconnect về connecting, tắt về disabled. Trạng thái kết nối nằm ở runtime, không coi trạng thái cũ trong DB là đang online sau restart.
- Live session: starting → playing → reconnecting → playing; kết thúc bằng closed/failed. Phiên không phục hồi sau restart, client phải tạo lại; chưa có bảng session live bền vững.
- Recording: writing → ready/failed → deleting → bỏ chỉ mục sau khi file đã được xử lý. Chỉ ready được retention bình thường chọn; không xóa file đang ghi. Segment được đối soát lại khi khởi động và theo chu kỳ; file đang mở không được retention chọn.
- Xóa camera là soft delete trước, dừng nguồn và thu hồi quyền; FK RESTRICT giữ lịch sử video/sự kiện. Xóa khách cascade grants/session. Xóa segment chỉ bỏ liên kết event-recordings, không tự xóa sự kiện.
- Motion liên kết nhiều segment qua event_recordings; ghi liên tục chỉ thêm dấu sự kiện, không ghi trùng video. Giữ tác vụ ghi hình độc lập với phiên live.
- Migration chạy trong transaction và khóa ghi; checksum phát hiện lịch sử bị sửa. Không down-migrate tự động, không tự xóa DB khi schema không tương thích. Backup/rollback bản phát hành thuộc Phần 8.

## Nguồn kỹ thuật đã đối chiếu

- [Node.js LTS](https://nodejs.org/en/about/previous-releases)
- [Node SQLite](https://nodejs.org/api/sqlite.html)
- [Fastify Server](https://fastify.dev/docs/latest/Reference/Server/)
- [Fastify WebSocket](https://github.com/fastify/fastify-websocket)
- [Vite](https://vite.dev/guide/)
- [Tailwind/Vite](https://tailwindcss.com/docs/installation/using-vite)

Dependency chính xác được khóa trong package-lock.json; kiểm tra npm audit khi nâng cấp.
