# Review Phần 4 — MediaMTX, WebRTC và LL-HLS

Trạng thái: **đã triển khai, đã review và đang chờ người dùng nghiệm thu**.

## Đã triển khai

- MediaMTX v1.21.0 được quản lý bởi `MediaMtxGateway`, chạy loopback với API quản trị, HLS low-latency và WebRTC/WHEP. Nguồn RTSP chỉ được thêm vào path khi có live session; URL nguồn vẫn được giải mã trong bộ nhớ.
- `POST /api/v1/live-sessions` kiểm tra owner/guest grant, profile, transport, secret key và trạng thái MediaMTX; session có TTL 10 phút và được ghi trong SQLite migration v3.
- WHEP được proxy qua `POST /api/v1/live-sessions/{id}/whep`; HLS playlist/segment được proxy qua `GET /api/v1/live-sessions/{id}/hls/*`. Các tham số `_HLS_msn`, `_HLS_part`, `_HLS_skip` được lọc trước khi chuyển tiếp để blocking reload hoạt động.
- WebRTC là transport mặc định trong `LivePlayer`; khi thương lượng lỗi, player chuyển LL-HLS. Mất kết nối thử lại theo 1/2/5 giây, tối đa ba lần; đóng component sẽ đóng peer, hls.js và session server.
- Live Matrix và chi tiết camera dùng camera thật từ API; khi chưa có session/camera, preview mẫu cũ vẫn được gắn nhãn rõ. Player có bật/tắt âm thanh, snapshot từ khung hình hiện tại, fullscreen, trạng thái kết nối và hỗ trợ `prefers-reduced-motion`.
- `hls.js` được lazy-load chỉ khi trình duyệt không có HLS native. FFmpeg có biến cấu hình `NVR_FFMPEG_BIN`; pass-through không gọi FFmpeg để giữ độ trễ thấp.

## Kiểm thử và review

- `npm run typecheck`: đạt toàn bộ workspace.
- `npm test`: đạt 10 file, 46 test; gồm 2 test mới cho quyền live session, giải mã nguồn trong bộ nhớ, WHEP, LL-HLS và cleanup.
- `npm run build`: contracts, API và web đều đạt. Bundle chính còn khoảng 255 kB gzip chưa nén; chunk hls.js khoảng 592 kB chỉ tải khi fallback.
- `NVR_BROWSER_CHANNEL=msedge npm run test:browser`: đạt 16/16 trên desktop 1440×900 và mobile 390×844, gồm keyboard, touch, reduced-motion, console và không tràn ngang.
- MediaMTX API đã được kiểm tra với cấu hình thật trên máy phát triển: `hlsVariant=lowLatency`, `hlsSegmentCount=7`, API loopback phản hồi. Chưa đo latency end-to-end bằng camera thật vì chưa có path RTSP/codec/độ phân giải và cấu hình phần cứng Ubuntu được xác nhận.

## Giới hạn cần nghiệm thu

PTZ chưa điều khiển runtime trong phần này vì thông tin ONVIF chưa được lưu gắn với camera và chưa có adapter lệnh ONVIF liên tục; capability PTZ vẫn được hiển thị theo dữ liệu camera. Audio playback đã đi theo track WebRTC/HLS và có nút mute. Đo startup, latency, reconnect, CPU/RAM và tải nhiều camera phải thực hiện trên Ubuntu với cấu hình thực tế.

Không chuyển sang Phần 5 cho đến khi người dùng xác nhận nghiệm thu Phần 4.
