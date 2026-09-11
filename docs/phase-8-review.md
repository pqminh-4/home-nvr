# Review Phần 8 — installer Ubuntu và phát hành

Trạng thái: **đã hoàn thành phần triển khai và review cục bộ; repository phát hành đã được chọn, đang chờ CI và máy Ubuntu để nghiệm thu thực địa**.

## Kết quả triển khai

- Root package có `bin` tên `home-nvr`; tarball phát hành chứa API/web/contracts đã build, CLI quản trị, tài liệu và release lock tái lập được.
- Lệnh `npm exec` từ GitHub Release chạy CLI mà không cần cài global. Installer chỉ chấp nhận Ubuntu, Node.js 24, npm 11, quyền root và kiến trúc x64/arm64.
- Release được tạo trước trong `/opt/home-nvr/releases`, cài production dependencies bằng lockfile và kiểm tra cú pháp/import trước khi chuyển symlink `/opt/home-nvr/current`.
- Update chờ readiness 30 giây; nếu lỗi thì symlink và systemd quay về release trước. Rollback thủ công hoán đổi current/previous; giữ tối thiểu ba release gần nhất.
- systemd chạy bằng user không đăng nhập `home-nvr`, chỉ bind loopback, tự restart khi lỗi và áp dụng `NoNewPrivileges`, `ProtectSystem=strict`, giới hạn namespace/device/kernel cùng danh sách thư mục ghi rõ ràng.
- Setup token và secret key được tạo bằng random bytes; env mode 0600 do systemd đọc. Thư mục cấu hình là `root:home-nvr` mode 0750 để tunnel token mode 0640 có thể được cloudflared dưới service user đọc.
- Installer cài FFmpeg từ Ubuntu APT, tải MediaMTX 1.21.0 và cloudflared từ GitHub Releases chính thức, kiểm tra SHA-256 trước khi ghi binary.
- CLI có status, doctor, backup, restore, rollback và uninstall. Uninstall mặc định giữ dữ liệu; purge yêu cầu đồng thời `--purge --yes` trước khi mutation.
- Workflow CI có job Ubuntu cài thật, health check, update, rollback và purge. Workflow tag `v*` tạo asset ổn định `home-nvr-linux.tgz` trên GitHub Release.

## Lỗi đã phát hiện và sửa trong review

| Lỗi | Cách sửa |
| --- | --- |
| npm loại `.npmrc` khỏi tarball | Installer tự tạo `.npmrc` trong release staging trước `npm ci` |
| `package-lock.json` không được npm pack phát hành | Dùng `release-lock.json` đồng bộ và đổi tên lại khi staging |
| Node chạy dưới user dịch vụ không đọc được env root 0600 | systemd nạp `EnvironmentFile`; bỏ `--env-file` khỏi ExecStart |
| Tunnel token root 0600 không đọc được dưới user `home-nvr` | Thư mục root:home-nvr 0750, token root:home-nvr 0640 |
| `uninstall --purge` kiểm tra `--yes` sau khi đã gỡ service | Chuyển validation lên trước mọi mutation |
| Smoke test Windows truyền sai thuộc tính đường dẫn tarball | Gán đường dẫn tuyệt đối trước khi gọi npm exec |

## Kiểm tra đã đạt

- `npm run check`: typecheck strict toàn workspace, **61/61 tests** trong 16 test files và production build.
- Ba test installer bao phủ env/systemd hardening, lựa chọn asset/checksum MediaMTX/cloudflared, path containment và gói release bắt buộc có dist.
- `npm pack --dry-run`: tarball 38 file, khoảng 365 kB nén/1,3 MB giải nén; có API, web, contracts, CLI, tài liệu và release lock.
- Smoke test tạo tarball thật rồi chạy `npm exec --package=<tarball> -- home-nvr plan`: đạt trên máy phát triển.
- Secret cục bộ, `.env`, certificate, private key và tarball không xuất hiện trong danh sách Git nhờ `.gitignore`.

## Chưa thể nghiệm thu trong môi trường hiện tại

- Máy Windows không có WSL/Ubuntu/systemd nên chưa chạy được installer mutation, reboot hoặc service hardening thật.
- Repository phát hành được tạo riêng tại `pqminh-4/home-nvr`; không ghi đè các repository camera hiện hữu.
- Source đã được đẩy lên nhánh `main`; workflow Ubuntu đang được kiểm tra trên GitHub Actions. Workflow phát hành sẽ chạy khi tạo tag `v*`.
- Chưa có bài chạy 24 giờ, đầy ổ, nhiều camera, reboot và update/rollback trên máy Ubuntu đích vì cấu hình máy vẫn chưa xác nhận.

## Điểm dừng

Cần CI trên repository mới chạy đạt và cung cấp máy Ubuntu để nghiệm thu cuối. Chỉ tạo tag/release sau khi kết quả CI đạt.
