# Báo cáo nghiệm thu Phần 1

Ngày kiểm tra: 05/09/2026. Trạng thái: **hoàn thành nền tảng, đã review/sửa lỗi/kiểm tra lại; chờ người dùng duyệt Phần 2**.

## Kết quả triển khai

- Khảo sát xác nhận D:\NVR trống trước khi tạo mã nguồn. Git cục bộ trên nhánh `codex/foundation`; chưa commit, push hoặc tạo tài nguyên bên ngoài.
- Ba workspace web/API/contracts, TypeScript strict, build/dev scripts và lockfile npm tái lập được.
- React/Vite/Tailwind chạy với API thật trên trang kiểm tra kỹ thuật. Chưa thiết kế hoặc triển khai dashboard sản phẩm.
- Fastify có liveness/readiness, REST trạng thái, OpenAPI 3.1 và WebSocket trạng thái chỉ đọc.
- SQLite có migration transaction/checksum, WAL, foreign key, chỉ mục và ràng buộc dữ liệu cho các phần tiếp theo.
- Hợp đồng DTO/request, danh mục API dự kiến, ranh giới MediaGateway và vòng đời dữ liệu được ghi trong architecture.md.
- Logging che thông tin nhạy cảm, không phản chiếu request-id/URL/header/exception của client. Host/Origin được kiểm tra; chỉ bind loopback trong Phần 1.
- Cấu hình CI cho Ubuntu/Windows đã được viết; chưa có lần chạy GitHub Actions vì chưa xuất bản repository.

## Kiểm chứng đã thực hiện

| Kiểm tra | Kết quả |
| --- | --- |
| Cài sạch `npm ci` | Đạt, 226 package từ lockfile |
| Typecheck API/web/contracts/test/config | Đạt |
| Unit/integration | **33/33 đạt**: migration, dữ liệu bền vững, rollback, FK, tài khoản/grants constraints, cấu hình, secret logging, HTTP, WebSocket, readiness |
| Build production | Đạt |
| Playwright/Edge headless | **6/6 đạt**, desktop 1440×900 và mobile 390×844; kết nối API, bàn phím, không tràn ngang, lỗi API và chặn truy cập file ngoài build |
| Lệnh dev thực tế | Đạt: npm run dev, Vite HTTP proxy/WebSocket proxy, React StrictMode; không có pageerror |
| Migration CLI hai lần liên tiếp | Đạt, vẫn một migration version 1 |
| npm audit sau cập nhật dependency | **0 lỗ hổng được báo cáo** tại thời điểm kiểm tra |
| Git ignore | `.env`, database, runtime portable, node_modules và build output đều được loại trừ |

## Những lỗi phát hiện và đã sửa

| Before | After | Why |
| --- | --- | --- |
| Request React bị hủy vẫn có thể cập nhật lỗi sau request mới | Cờ active và cleanup AbortController ngăn callback cũ cập nhật state | Tránh báo API lỗi giả trong StrictMode |
| Guard Origin chạy trước hook đánh dấu WebSocket của plugin | Đăng ký plugin trước guard; kiểm thử handshake bị từ chối và đóng app | Không giữ socket khiến shutdown bị treo |
| Readiness chỉ dùng SELECT 1 | Đọc phiên bản thật từ schema_migrations; thêm test xóa schema | Không báo sẵn sàng khi schema không đọc được |
| Schema JSON hiện đại đặt trong OpenAPI 3.0 | Dùng OpenAPI 3.1; tách operation tương lai khỏi paths đã triển khai | Tránh hợp đồng sai chuẩn hoặc khiến client tưởng route đã tồn tại |
| Cấu hình logger/404 không phù hợp API Fastify hiện tại | Dùng LogController và chữ ký handler đúng; thu hẹp kiểu lỗi unknown | Typecheck đạt, bỏ cấu hình logger deprecated |
| @fastify/static 8.3.0 có cảnh báo bảo mật cao | Nâng lên 10.1.3, kiểm tra tương thích Fastify 5, thử đường dẫn file và audit lại | Khắc phục advisory được npm báo cáo |

## Môi trường và giới hạn

- Đã kiểm tra trên Windows x64, Intel i5-12600K, RAM 32 GiB. Đây là máy phát triển, **không phải cấu hình Ubuntu nghiệm thu**.
- Node 24.20.0/npm 11.19.0 và Git 2.55.0 được chuẩn bị dạng portable trong `.tools`, kiểm tra checksum từ nguồn phát hành; không cài global hoặc thay cấu hình hệ thống.
- Sandbox Windows vẫn lỗi CryptUnprotectData. Các lệnh cần thiết được thực thi qua cơ chế ngoài sandbox đã được hệ thống chấp thuận.
- Git nhận diện SID chủ thư mục khác SID phiên chạy; kiểm tra dùng `-c safe.directory=D:/NVR` riêng từng lệnh, không sửa cấu hình Git global.
- Không tìm thấy FFmpeg, MediaMTX, cloudflared hoặc systemd trong PATH kiểm tra. Chúng chưa cần để nghiệm thu nền tảng; thêm khi đến Phần 4/7/8.
- Ubuntu/WSL chưa sẵn sàng để kiểm chứng. CPU/RAM/ổ đĩa Ubuntu, số camera, codec và độ phân giải vẫn **chưa xác nhận**, theo phản hồi người dùng.
- Chưa kiểm thử camera thật hoặc hiệu năng live. Chưa có auth, mã hóa credential đang hoạt động, recorder, motion, remote hay installer; các schema tương ứng chỉ là nền móng.
- Các kiểm thử giao diện ở đây dành cho trang kỹ thuật. Thiết kế Stitch, review UI/UX đầy đủ và hiệu ứng React Bits thuộc Phần 2.

## Điểm dừng

Không bắt đầu Phần 2 khi chưa nhận xác nhận mới từ người dùng. Sau khi được duyệt, đọc lại roadmap.md và architecture.md trước khi thiết kế bằng Stitch MCP phối hợp Emil Design Engineering và React Bits.
