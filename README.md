# Home NVR

Nền tảng quản lý camera gia đình self-host. **Phần 7 đã được nghiệm thu; Phần 8 đang triển khai**: có tài khoản chủ/khách, quyền theo từng camera, secret mã hóa, ONVIF discovery/probe, RTSP probe và live player WebRTC/LL-HLS qua MediaMTX. Ghi hình, motion events, Cloudflare Tunnel tùy chọn và backup/restore đã hoạt động; installer Ubuntu thuộc Phần 8.

## Chạy nền tảng

Yêu cầu Node.js **24.20.0** và npm **11 trở lên**. Runtime phát triển Windows portable ở `.tools` không thuộc mã nguồn và không được phân phối cùng ứng dụng.

```bash
npm ci
npm run check
npm run db:migrate
npm start
```

Mở [trang kiểm tra](http://127.0.0.1:3000). `npm start` dùng bản build và phục vụ frontend cùng API. Có thể sao chép `.env.example` thành `.env` để đổi cổng/thư mục dữ liệu. Không đưa `.env` vào Git.

```bash
npm run dev
```

Frontend phát triển tại [127.0.0.1:5173](http://127.0.0.1:5173), proxy API/WebSocket tới backend. `NVR_PORT` áp dụng cả backend và proxy. Hợp đồng dùng chung được build và watch tự động.

```bash
npm run doctor
```

Doctor chỉ đọc thông tin công cụ/máy hiện tại, không quét mạng hay cấu hình camera. MediaMTX cần có trong PATH hoặc cấu hình `NVR_MEDIAMTX_BIN`; FFmpeg được kiểm tra để dùng khi camera cần chuyển codec nhưng không bắt buộc với luồng pass-through H264/AAC. Ubuntu/systemd và cloudflared lần lượt phục vụ Phần 8 và Phần 7. Không cần Docker theo phương án native đã chọn.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| NVR_HOST | 127.0.0.1 | Chỉ loopback trong Phần 1 |
| NVR_PORT | 3000 | Cổng HTTP API và frontend production |
| NVR_MEDIAMTX_BIN | mediamtx (Windows dùng .tools/mediamtx/mediamtx.exe) | Đường dẫn binary MediaMTX |
| NVR_FFMPEG_BIN | ffmpeg | Đường dẫn FFmpeg khi cần chuyển codec |
| NVR_DATA_DIR | .data | Tương đối với gốc dự án, không phụ thuộc cwd |
| NVR_LOG_LEVEL | info | debug/info/warn/error/silent |
| NVR_WEB_ORIGIN | http://127.0.0.1:5173 | Origin frontend phát triển được phép |
| NVR_SETUP_TOKEN | rỗng | Token một lần, tối thiểu 32 ký tự, để tạo owner đầu tiên |
| NVR_SECRET_KEY | rỗng | Bí mật tối thiểu 32 ký tự để mã hóa URL camera |
| NVR_PUBLIC_ORIGIN | rỗng | HTTPS origin công khai duy nhất được phép |
| NVR_CLOUDFLARED_BIN | cloudflared | Binary Cloudflare Tunnel |
| NVR_TUNNEL_TOKEN_FILE | rỗng | Tệp token Tunnel, quyền 0600 trên Ubuntu |

SQLite tạo tại `.data/home-nvr.sqlite`. Migration tự chạy khi khởi động; lệnh migrate riêng dùng cùng cấu hình. Database lỗi trả readiness 503; dịch vụ không tự xóa dữ liệu. Log không chứa URL camera, header xác thực, mật khẩu hoặc stack lỗi nội bộ.

## Tài liệu

- [Kiến trúc và hợp đồng API](docs/architecture.md)
- [Kế hoạch và điểm duyệt](docs/roadmap.md)
- [Báo cáo nghiệm thu Phần 1](docs/phase-1-review.md)
- [Báo cáo nghiệm thu Phần 2](docs/phase-2-review.md)
- [Báo cáo nghiệm thu Phần 3](docs/phase-3-review.md)
- [Báo cáo nghiệm thu Phần 4](docs/phase-4-review.md)
- [Báo cáo nghiệm thu Phần 5](docs/phase-5-review.md)
- [Báo cáo nghiệm thu Phần 6](docs/phase-6-review.md)
- [Truy cập từ xa và backup](docs/remote-access.md)
- [Cài đặt và vận hành trên Ubuntu](docs/install-ubuntu.md)
- [Báo cáo nghiệm thu Phần 7](docs/phase-7-review.md)
- [Review Phần 8: installer Ubuntu](docs/phase-8-review.md)
- [Thiết kế mới Garden Studio và review](docs/garden-studio-review.md)

CLI cài native/systemd đang được triển khai ở Phần 8. Chỉ dùng lệnh GitHub Release sau khi workflow phát hành và nghiệm thu Ubuntu hoàn tất.

## Công cụ portable trên máy Windows hiện tại

Trong PowerShell tại thư mục dự án, nạp đường dẫn runtime vào phiên hiện tại rồi chạy:

```powershell
. .\scripts\use-local-tools.ps1
npm run dev
```

Script không thay PATH hệ thống. Trên máy khác, cài Node/npm theo yêu cầu trước khi dùng các lệnh npm.

## Kiểm thử trình duyệt

Sau `npm run build`, chạy trên máy có Microsoft Edge:

```powershell
$env:NVR_BROWSER_CHANNEL = 'msedge'
npm run test:browser
```

Hoặc dùng Chromium của Playwright trên Ubuntu:

```bash
npx playwright install --with-deps chromium
npm run test:browser
```

Kiểm thử dùng cổng 4317 và database tạm riêng, tự dừng server khi hoàn tất. Cổng đó phải trống. Bộ kiểm thử kiểm tra cổng xác thực, điều hướng, dialog, responsive, reduced motion, console và ranh giới file tĩnh. Hiệu năng live streaming được đo ở Phần 4.
- [Review giao diện Aegis NVR từ Stitch](docs/aegis-interface-review.md)
