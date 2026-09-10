# Truy cập từ xa qua Cloudflare Tunnel

Home NVR luôn lắng nghe tại `127.0.0.1`. `cloudflared` tạo kết nối outbound tới Cloudflare; không mở port router và không đổi `NVR_HOST` sang `0.0.0.0`.

## Cấu hình Cloudflare

1. Trong Cloudflare Zero Trust, tạo một named tunnel cho Home NVR.
2. Thêm Public Hostname HTTPS, ví dụ `nvr.example.com`, với service `http://127.0.0.1:3000`.
3. Tạo Access application loại **Self-hosted** cho đúng hostname đó. Policy Allow phải giới hạn email hoặc nhóm chủ nhà; tránh policy Allow Everyone.
4. Lưu tunnel token dạng một dòng vào tệp chỉ tài khoản dịch vụ đọc được:

   ```bash
   sudo install -d -o root -g home-nvr -m 750 /etc/home-nvr
   sudo sh -c 'umask 027; cat > /etc/home-nvr/cloudflare-tunnel-token'
   sudo chown root:home-nvr /etc/home-nvr/cloudflare-tunnel-token
   sudo chmod 640 /etc/home-nvr/cloudflare-tunnel-token
   ```

5. Thêm vào `.env`:

   ```dotenv
   NVR_PUBLIC_ORIGIN=https://nvr.example.com
   NVR_CLOUDFLARED_BIN=cloudflared
   NVR_TUNNEL_TOKEN_FILE=/etc/home-nvr/cloudflare-tunnel-token
   ```

6. Khởi động lại Home NVR, đăng nhập bằng owner, mở **Cài đặt → Truy cập từ xa**, bật truy cập từ xa rồi lưu.

Home NVR gọi `cloudflared tunnel --protocol auto run --token-file ...`. Token không xuất hiện trong command line hoặc API. Chỉ public origin đã khai báo được qua kiểm tra Host/Origin. Cookie remote có `Secure`, mọi mutation phiên cookie cần Origin hợp lệ, HSTS được gửi trên hostname remote.

Mạng ra ngoài cần TCP hoặc UDP port 7844. Chế độ `auto` ưu tiên QUIC và chuyển sang HTTP/2 khi UDP không dùng được. Mất Internet chỉ làm Tunnel ngắt; `/health/ready`, ghi hình và xem trong LAN không phụ thuộc trạng thái remote.

WebRTC trực tiếp có thể không thiết lập được từ một số mạng ngoài. Live player tự chuyển sang LL-HLS cùng origin qua Tunnel. Không đưa RTSP, ONVIF hay cổng MediaMTX ra Cloudflare.


## Cấu hình DNS-only trong giao diện

Sau khi đã tạo Tunnel, owner có thể mở **Cài đặt → Truy cập từ xa → DNS-only** để quản lý CNAME của hostname:

1. Tạo Cloudflare API token riêng, giới hạn đúng zone và quyền **Zone → DNS → Edit**.
2. Nhập zone gốc, hostname đầy đủ và tunnel target dạng `xxxxxxxx.cfargotunnel.com`.
3. Để đúng chế độ DNS-only, giữ **Proxy qua Cloudflare** ở trạng thái tắt; sau đó bấm **Xem trước DNS** để kiểm tra thao tác `create`, `update` hoặc `unchanged`. Có thể bật proxy nếu muốn hostname đi qua edge Cloudflare.
4. Chỉ khi bản xem trước đúng, bấm **Xác nhận cập nhật DNS**.

API token chỉ tồn tại trong request và bị xóa khỏi form sau khi áp dụng; Home NVR không ghi token vào SQLite, `.env` hay log. Thay đổi bất kỳ trường DNS nào cũng hủy bản xem trước cũ để tránh xác nhận nhầm dữ liệu.

Tính năng này chỉ quản lý bản ghi DNS. Nó không tạo Tunnel, không cấu hình Cloudflare Access và không thay thế các bước bảo vệ hostname ở phần trên.
## Backup và restore

Backup online dùng SQLite backup API và chỉ sao chép segment `ready`. Checksum SHA-256 được tính theo luồng nên tệp video lớn không bị nạp toàn bộ vào RAM.

```bash
npm run backup -- --output /mnt/backup/home-nvr-2026-09-08
npm run backup -- --output /mnt/backup/home-nvr-metadata --metadata-only
```

Backup mặc định không chứa `NVR_SECRET_KEY`. Muốn tạo bản phục hồi độc lập, dùng `--include-secrets` và bảo vệ thư mục backup như một secret:

```bash
npm run backup -- --output /mnt/backup/home-nvr-full --include-secrets
```

Restore yêu cầu dừng Home NVR. Lệnh luôn đổi tên thư mục dữ liệu hiện tại thành `.before-restore-<timestamp>` trước khi thay, nên còn điểm quay lui:

```bash
sudo systemctl stop home-nvr
npm run restore -- --input /mnt/backup/home-nvr-full --force
sudo systemctl start home-nvr
```

Nếu manifest cho biết có secret, lệnh trả đường dẫn `secret-key.txt`; cập nhật `NVR_SECRET_KEY` ở kho bí mật của máy đích trước khi khởi động. Tunnel token không được backup và nên được cấp lại trên máy mới.
