# Các điểm duyệt triển khai

Sau mỗi phần: triển khai → kiểm thử → review → sửa lỗi → kiểm tra lại → báo cáo → chờ người dùng xác nhận. Không tự chuyển phần chỉ vì kiểm thử đạt.

| Phần | Nội dung | Điều kiện nghiệm thu |
| --- | --- | --- |
| 1 | Khảo sát, nền tảng, hợp đồng kỹ thuật | Build/typecheck, SQLite migration, health, log và WebSocket được kiểm tra |
| 2 | Thiết kế Stitch MCP, Emil, React Bits; dashboard/camera/playback/events/settings | Desktop/mobile, bàn phím/cảm ứng, states, reduced-motion; phân biệt dữ liệu mô phỏng |
| 3 | Chủ/khách, phân quyền, mã hóa secret, ONVIF/RTSP camera | Không vượt quyền, expiry hoạt động, secret không lộ, lỗi nguồn được xử lý |
| 4 | MediaMTX/FFmpeg, WebRTC/LL-HLS, grid, reconnect, PTZ/audio | Camera thật, mất mạng, số đo startup/latency/tải; LAN mục tiêu <2 giây/<500 ms trên cấu hình xác định |
| 5 | Ghi liên tục, retention, playback, timeline, export | Segment/đầy đĩa/restart; không nghẽn live hoặc xóa file đang ghi |
| 6 | Motion, pre/post buffer, lịch và webhook | Sự kiện liên tiếp, lịch qua nửa đêm, retry/chống gửi dồn |
| 7 | Cloudflare Tunnel, đường truyền remote, health, backup/restore | Truy cập mạng ngoài, NAT/fallback, quyền khách, LAN không phụ thuộc Internet |
| 8 | CLI npm từ GitHub, systemd native, update/rollback, tài liệu | Ubuntu sạch, reboot, nâng/gỡ cài, 24 giờ chạy tải; phát hành cần được duyệt |

Cấu hình CPU/RAM/ổ lưu trữ và số camera/codec/độ phân giải: **chưa xác nhận**, theo phản hồi người dùng. Không được dùng kết quả trên máy Windows phát triển để tuyên bố đạt hiệu năng Ubuntu/camera thật.

Ứng dụng tiếng Việt; comment mới trong code dùng tiếng Việt. USB/AI người-xe ngoài phạm vi v1. Bản LAN mặc định, remote tùy chọn. Không xuất bản GitHub hoặc tạo cloud resource nếu chưa đến bước được duyệt.

## Phần 3 đã hoàn tất
- Auth owner/guest, session cookie HttpOnly, Argon2id, rate limit đăng nhập và kiểm tra Origin/CSRF đã hoàn thành.
- Quyền camera theo từng guest, tự hết hạn và thu hồi session khi đổi quyền đã hoàn thành.
- URL RTSP/RTSPS được mã hóa AES-256-GCM; API và log không trả nguồn hoặc credential.
- ONVIF WS-Discovery, WS-Security PasswordDigest, RTSP DESCRIBE/Digest/Basic và trạng thái lỗi đã kiểm tra bằng test cục bộ và thiết bị thật.
- Phần 3 đã được người dùng xác nhận để chuyển sang Phần 4.


## Phần 4 đã hoàn tất
- MediaMTX v1.21 được khởi động như tiến trình native, cấu hình loopback và API quản trị nội bộ; nguồn RTSP được thêm theo profile, chỉ bật khi có phiên xem.
- WebRTC/WHEP là transport ưu tiên; proxy LL-HLS hỗ trợ playlist blocking reload và hls.js được tải khi cần cho trình duyệt không phát HLS native.
- Live session có TTL, kiểm quyền theo owner/guest, cleanup khi đóng, tự kết nối lại tối đa ba lần và không trả URL RTSP hoặc cổng MediaMTX cho trình duyệt.
- Dashboard Live Matrix và chi tiết camera dùng camera thật khi API có dữ liệu, vẫn giữ preview minh họa khi chưa đăng nhập hoặc chưa có camera; player có âm thanh, snapshot khung hiện tại và fullscreen.
- FFmpeg đã có điểm cấu hình `NVR_FFMPEG_BIN`; bản pass-through không gọi FFmpeg để tránh thêm độ trễ, chuyển codec sẽ được nghiệm thu cùng cấu hình camera thật.
- Cần nghiệm thu trên Ubuntu với số camera, codec, độ phân giải và phần cứng chưa xác nhận; chưa tuyên bố đạt mục tiêu `<2 giây/<500 ms` khi chưa có số đo đó.

Người dùng đã xác nhận nghiệm thu Phần 4 để chuyển sang Phần 5.



## Phần 5 đã hoàn tất
- MediaMTX ghi fMP4 native theo thư mục riêng từng camera; không truyền RTSP credential qua process command line. Record path được cấu hình động khi owner bật chế độ ghi liên tục.
- `RecordingManagerService` lập chỉ mục segment sau khi khởi động và theo chu kỳ, phục hồi segment còn lại sau restart, giữ trạng thái `writing` cho file đang mở và chỉ cho playback/retention xử lý file `ready`.
- Retention mặc định 7 ngày, tôn trọng `storageLimitBytes` nếu được lưu trong system settings, đánh dấu `deleting` trước khi xóa và chuyển `failed` nếu xóa thất bại; export tạm tự dọn sau 30 phút.
- API owner-only có danh sách theo camera/khoảng thời gian, HTTP Range playback, export nhiều bản ghi và tải asset export; đường dẫn file được kiểm tra containment.
- Giao diện Bản ghi có player video thật, bộ lọc camera, timeline theo segment và export; khi chưa có dữ liệu thật vẫn hiển thị preview minh họa có nhãn rõ ràng. Chi tiết camera có nút bật/tắt ghi liên tục.
- Đã kiểm tra 49 unit/integration tests, 16 browser tests desktop/mobile, typecheck, production build và smoke test API với MediaMTX: `phase=5`, `media=ready`, `recording=ready`.
- Chưa đo được tải đầy đĩa hoặc 24 giờ ghi trên Ubuntu và camera thật; cần nghiệm thu theo phần cứng/số camera người dùng sẽ cung cấp.

Người dùng đã xác nhận nghiệm thu Phần 5 để chuyển sang Phần 6.
## Phần 6 đã hoàn tất
- Migration v4 thêm rule theo camera và hàng đợi webhook; URL webhook được mã hóa và không trả lại client.
- Event engine áp dụng ngưỡng nhạy, lịch theo ngày/múi giờ (kể cả qua nửa đêm), gộp tín hiệu liên tiếp và cửa sổ pre/post buffer.
- Camera ở event mode duy trì rolling fMP4; segment tự liên kết với cửa sổ sự kiện, segment không liên kết được dọn sau cửa sổ an toàn.
- Webhook gửi payload phiên bản hóa, timeout 5 giây, exponential backoff và dừng sau 5 lần thất bại.
- API owner-only đã có events, event rule, motion ingest và settings. UI Sự kiện, Cảnh báo và Cài đặt đã dùng API thật, có trạng thái quyền guest.
- Đã kiểm tra 52 unit/integration tests, 16 browser tests desktop/mobile, typecheck, production build và smoke status `phase=6`, `events=ready`.
- Nguồn detector camera/ONVIF sẽ gọi motion ingest; độ chính xác phát hiện trên camera thật cần kiểm tra theo model camera và phần cứng chưa xác nhận.

Người dùng đã xác nhận nghiệm thu Phần 6 để chuyển sang Phần 7.

## Phần 7 đã hoàn tất
- Cloudflare Tunnel tùy chọn chạy outbound bằng token file; backend giữ loopback và allowlist đúng HTTPS hostname.
- Host/Origin/CSRF, cookie Secure, HSTS và quyền owner/guest tiếp tục áp dụng qua truy cập remote.
- Tunnel có trạng thái riêng; LAN readiness, recording và live nội bộ không phụ thuộc Internet.
- Backup/restore có SQLite snapshot, checksum streaming, lọc segment ready và giữ bản dữ liệu cũ khi restore.
- Unit/integration, typecheck, build và browser test được ghi tại `docs/phase-7-review.md`.
- Nghiệm thu mạng ngoài thật còn cần Cloudflare hostname/token/account và máy Ubuntu đích.

Người dùng đã xác nhận nghiệm thu Phần 7 để chuyển sang Phần 8 ngày 10/09/2026.

## Phần 8 đang triển khai
- CLI npm từ GitHub Releases, systemd native, release bất biến, update/rollback và tài liệu Ubuntu đang được triển khai.
- Chưa phát hành GitHub Release và chưa nghiệm thu trên máy Ubuntu sạch.
