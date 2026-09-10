# Home NVR · Garden Studio

Thiết kế lại toàn bộ Phần 2 theo yêu cầu thay màu sắc và bố cục.

## Thiết kế

- Stitch design system: assets/7403708413119552408.
- Stitch screen: projects/8003660950270278324/screens/edf6034b258b44779de1279ac46ac74c.
- Nền kem #f5f4ee, nền thẻ trắng, chữ #202b24, xanh lá #245c44, xanh nhạt và đất nung cho trạng thái.
- Header ngang thay sidebar. Phần giới thiệu bên trái, tình trạng camera mẫu bên phải.
- Camera 2×2 toàn chiều rộng; chọn 1/4/9 ô trên desktop. Mobile một camera cùng thanh chọn ngang.
- Hoạt động và dung lượng lưu trữ chuyển xuống dưới camera.
- Sáu route cùng dùng một stylesheet mới, không còn các lớp override của thiết kế cũ.
- Chữ giao diện dùng system font có tiếng Việt; tiêu đề điểm nhấn dùng serif. Không tải font hoặc script từ CDN khi mở ứng dụng.

## Motion và khả năng truy cập

Áp dụng Emil Design Engineering và đánh giá React Bits Animated List. Không cần thêm thư viện animation cho phiên bản này: WAAPI tạo hiệu ứng vào trang 240ms với khoảng cách 35ms giữa các nhóm, CSS phản hồi nhấn nút 160ms. Hiệu ứng vào trang chỉ chạy lần đầu, không áp dụng lại khi chuyển route bằng bàn phím; không có hiệu ứng lặp trên video. Reduced motion tắt các hiệu ứng dịch chuyển.

Điều khiển chính có vùng chạm 44px; mobile menu dùng vùng chạm cao 52px. Dialog native giữ focus, hỗ trợ Escape và trả focus về nút mở. Đã review trực quan dashboard desktop/mobile, quản lý camera và dialog mobile.

## Review

| Before | After | Why |
| --- | --- | --- |
| Nền navy/cyan, sidebar dọc | Kem/xanh lá, điều hướng ngang | Tạo ngôn ngữ thị giác hoàn toàn mới |
| Hero feed lệch cột và hoạt động ở sidebar | Lưới 2×2, hoạt động phía dưới | Camera giữ tỷ lệ 16:9 và có không gian rộng |
| Stylesheet thiếu quy tắc nền tảng, nhiều override | Reset và token thống nhất trong stylesheet mới | Bố cục và kích thước điều khiển có thể dự đoán |
| Test overflow so với innerWidth có thể bỏ sót lỗi mobile | So với clientWidth; minmax(0,1fr) cho grid | Không coi layout viewport tự nới rộng là nghiệm thu đạt |
| Test menu mobile thay click bằng Enter | Khôi phục click, bổ sung tap thật trong môi trường giả lập | Kiểm chứng thao tác trỏ và cảm ứng |
| Chọn trạng thái camera 1 ô có thể giữ state cũ | Đồng bộ state camera và kiểm thử denied | Giao diện phản hồi đúng lựa chọn |

## Kiểm chứng

- Browser test: 16/16 desktop và mobile, gồm sáu route, click/tap, focus dialog, giảm chuyển động và API lỗi.
- Bổ sung kiểm tra không tràn ngang trên các chiều rộng 320, 768, 1024px; desktop 1440px và mobile 390px đã kiểm tra bằng ảnh chụp.
- Không thêm dependency; JS gzip khoảng 70.7 kB.
- Chưa nghiệm thu thiết bị cảm ứng vật lý, camera thật hoặc hiệu năng streaming; phần này vẫn là UI preview.
- Không chuyển sang Phần 3 cho đến khi người dùng xác nhận.
