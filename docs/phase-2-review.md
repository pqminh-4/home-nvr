# Báo cáo nghiệm thu Phần 2 · Thiết kế và giao diện

Ngày: 2026-09-06

## Kết quả

- Đã tạo project Stitch projects/8003660950270278324, design system assets/18339652265580951422, và các screen dashboard desktop/mobile, quản lý camera trống/thêm mới.
- Đã chuyển các token Stitch thành giao diện React responsive: dashboard, camera, bản ghi, sự kiện, cảnh báo và cài đặt.
- Dữ liệu camera, feed, timeline và sự kiện đều có nhãn “minh họa”; không gửi credential, không lưu URL RTSP, không giả nhận camera thật.
- Luồng thao tác có hash navigation, modal native, validation RTSP client-side, trạng thái loading/offline/denied, empty state, fullscreen/mute/snapshot feedback, lọc/tìm kiếm và các hành động mẫu.
- Mobile có rail chọn camera và bottom navigation; desktop có sidebar, metric cards, feed grid 1/4/9 và event panel.
- Đã áp dụng focus-visible, semantic buttons/links, target cảm ứng tối thiểu, dialog Escape/focus return và prefers-reduced-motion.
- React Bits Animated List đã được xem xét. Không thêm motion/react vào grid live vì chi phí bundle và main-thread không phù hợp với màn hình nhiều feed; dùng transition CSS ngắn cho feedback nút và trạng thái, phù hợp hướng dẫn Emil.

## Kiểm thử

- npm run typecheck: đạt.
- npm test: đạt, 33 test trong 5 file.
- npm run build: đạt.
- NVR_BROWSER_CHANNEL=msedge npm run test:browser: đạt, 8 test trên desktop/mobile.
- Rà soát bổ sung 12 tổ hợp route × viewport: không overflow ngang, không lỗi console, có phần tử focusable.
- Cấu hình Ubuntu, số camera, độ phân giải và lưu trữ thật vẫn chưa xác nhận; chưa có kết luận hiệu năng live.

## Review giao diện

| Before | After | Why |
| --- | --- | --- |
| Trang kiểm tra nền tảng đơn sắc, chỉ có trạng thái API | Shell Home NVR với sidebar/topbar, metric, feed và các route sản phẩm | Đưa layout Stitch vào component React có thể duyệt được ngay |
| Feed dùng trạng thái thành công chung | Mỗi feed có nhãn KHUNG HÌNH MẪU, offline/loading/denied và hành động rõ phạm vi | Không tạo ấn tượng camera thật trước Phần 4 |
| Không có mobile navigation hoặc rail | Bottom nav, camera rail ngang, feed đơn ở màn hình hẹp | Giữ thao tác một tay và không làm grid co giật |
| Form thêm camera không có | Dialog native có tab RTSP/ONVIF, validation và empty state | Kiểm tra được flow, focus và lỗi mà không gửi secret |
| Chưa có motion/accessibility rules | Transition transform/opacity ngắn, active feedback, focus-visible và reduced motion | Giữ phản hồi nhanh, giảm rủi ro giật khung hình |

## Giới hạn cần chuyển sang phần sau

Phần này chưa kết nối ONVIF/RTSP, WebRTC/LL-HLS, tài khoản, secret encryption, recording, retention, remote access hoặc installer Ubuntu. Những tính năng đó chỉ triển khai ở phần tương ứng và cần nghiệm thu riêng.

## Iteration UI · Cinematic Monitor

Sau review trực quan, dashboard được đổi sang variant Cinematic Monitor của Stitch: feed Phòng khách là hero chính, feed phụ xếp dọc, panel sự kiện dùng timeline dọc, metric chuyển thành status strip ít khung hơn. Motion dùng fade/translate ngắn cho feed và feedback hover; không dùng dependency animation mới để bảo vệ hiệu năng khi có nhiều stream. Đã sửa lỗi bottom navigation bị tràn ngoài viewport mô phỏng mobile và chạy lại 8 browser test đạt.
