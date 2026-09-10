# Review Phần 7 — remote, health và backup

## Kết quả triển khai

- API tiếp tục chỉ bind loopback; public origin HTTPS là allowlist riêng cho Host, Origin, WebSocket và cookie.
- Cloudflare Tunnel chạy bằng token file chỉ service user đọc được, `protocol=auto`; output tiến trình bị loại khỏi log ứng dụng và token không nằm trong đối số dòng lệnh.
- Owner bật/tắt remote trong Cài đặt. Trạng thái `configured/starting/ready/error` xuất hiện ở API, WebSocket system status và giao diện.
- Trình hướng dẫn DNS-only cho phép owner xem trước rồi tạo/cập nhật CNAME tới Tunnel; API token chỉ dùng trong request và không được lưu.
- Readiness LAN chỉ phụ thuộc SQLite; Tunnel lỗi hoặc Internet mất không kéo API, recording hay media LAN sang trạng thái lỗi.
- Auth và camera grants vẫn được kiểm tra ở API sau lớp Cloudflare Access. Access là lớp xác thực bổ sung tại edge.
- Backup dùng snapshot SQLite, chỉ lấy bản ghi immutable `ready`, manifest checksum; restore kiểm tra integrity và giữ thư mục dữ liệu cũ.

## Review UI theo Emil Design Engineering

| Before | After | Why |
| --- | --- | --- |
| Remote chỉ là boolean không giải thích trạng thái | Tab riêng có trạng thái Tunnel, hostname và tín hiệu cấu hình lỗi | Chủ nhà biết cần sửa cấu hình hay chờ kết nối |
| Trạng thái hệ thống không tách LAN và Internet | UI nói rõ LAN độc lập và API trả `lanIndependent=true` | Tránh hiểu nhầm Tunnel lỗi là camera nội bộ ngừng |
| Không có phản hồi trực quan khi Tunnel khởi động | Vòng trạng thái quay nhẹ khi starting, pulse khi ready | Motion thể hiện thay đổi trạng thái có mục đích |
| Chuyển động luôn chạy | `prefers-reduced-motion` tắt quay/pulse | Giữ khả năng tiếp cận và giảm tải GPU |

React Bits được dùng theo nguyên tắc chọn lọc: hiệu ứng trạng thái được viết bằng CSS transform/box-shadow nhỏ, không thêm dependency hay WebGL vào dashboard video. Stitch MCP không khả dụng trong phiên triển khai này; component bám design tokens và convention từ giao diện Stitch đã áp dụng trước đó.

## Kiểm tra

- 58 unit/integration tests trên Node.js 24.20.0: auth, grants, Host/Origin, Secure cookie/HSTS, Tunnel config, LAN independence, backup/restore.
- Typecheck toàn workspace và build production.
- 18 browser tests trên Edge desktop/mobile: điều hướng, xác thực, tab remote, responsive, reduced motion, console và ảnh viewport.
- Chưa có Cloudflare account/hostname/tunnel token trong workspace nên chưa thể nghiệm thu mạng ngoài thật, NAT hoặc QUIC→HTTP/2 trên hạ tầng của người dùng.
- Ubuntu đích, số camera và phần cứng vẫn chưa xác nhận; chưa tuyên bố số đo live remote.

## Trạng thái duyệt

Phần 7 đã được người dùng xác nhận nghiệm thu ngày 10/09/2026. Được phép chuyển sang Phần 8.
