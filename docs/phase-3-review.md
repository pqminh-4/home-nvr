# Nghiệm thu Phần 3 — tài khoản, quyền và camera

Trạng thái: **đã triển khai, đã review và đang chờ người dùng xác nhận**. Chưa chuyển sang Phần 4.

## Phạm vi đã hoàn thành

- Khởi tạo owner bằng setup token; đăng nhập, đăng xuất và đọc phiên hiện tại.
- Hash mật khẩu Argon2id với 64 MiB bộ nhớ, ba lượt xử lý; tự nâng cấp hash scrypt cũ sau lần đăng nhập hợp lệ.
- Session token ngẫu nhiên chỉ lưu dạng hash; cookie HttpOnly, SameSite=Strict, tự thêm Secure khi chạy HTTPS.
- Giới hạn năm lần đăng nhập sai trong năm phút theo IP và username.
- Mutation có session cookie bắt buộc gửi Origin hợp lệ để chặn CSRF; Host và Origin chỉ chấp nhận loopback đã cấu hình.
- CRUD camera cho owner; guest chỉ đọc camera được cấp.
- CRUD guest có hạn dùng; đổi mật khẩu/quyền/hạn dùng thu hồi các session cũ.
- URL nguồn RTSP/RTSPS mã hóa AES-256-GCM trước khi ghi SQLite; API không trả URL nguồn hoặc credential.
- RTSP probe qua TCP/TLS, Basic/Digest auth, SDP video/audio, timeout tuyệt đối và giới hạn kích thước phản hồi.
- ONVIF WS-Discovery giới hạn LAN, UsernameToken PasswordDigest, GetDeviceInformation và GetCapabilities.
- UI theo Stitch “Home NVR Dashboard Interface”: cổng setup/login, quản lý RTSP/ONVIF, trạng thái probe, xóa camera và cấp quyền khách theo camera.
- Animation ngắn có prefers-reduced-motion; dialog native giữ focus và hỗ trợ Escape.

## Kết quả kiểm tra

- npm run typecheck: đạt.
- npm test: 44/44 test đạt.
- npm run build: đạt; frontend production khoảng 247 kB JavaScript và 40 kB CSS trước gzip.
- NVR_BROWSER_CHANNEL=msedge npm run test:browser: 16/16 test đạt ở desktop 1440×900 và mobile 390×844.
- Browser review kiểm tra sáu màn hình, tràn ngang, click/touch, focus dialog, reduced motion, lỗi JavaScript/console và chặn file bí mật.
- ONVIF thiết bị thật: phản hồi thành công và công bố Media, PTZ, Imaging, Events, DeviceIO.
- RTSP thiết bị thật với kênh chính: phản hồi thành công, nhận diện video và audio.
- Hai mật khẩu camera thật đã được quét và không tồn tại trong workspace.

## Giới hạn đã xác định

- Dashboard vẫn hiển thị khung hình minh họa. MediaMTX/FFmpeg, WebRTC/LL-HLS, reconnect live, PTZ và audio runtime thuộc Phần 4.
- Chưa thể công bố số đo độ trễ/tải trên Ubuntu vì cấu hình CPU, RAM, ổ đĩa và số camera chưa được xác nhận.
- WS-Discovery multicast có thể không nhận được thiết bị trên một số camera/router; endpoint ONVIF trực tiếp vẫn hoạt động và đã được kiểm tra.
- Dịch vụ tiếp tục lắng nghe loopback. Truy cập từ xa qua Cloudflare thuộc Phần 7.
