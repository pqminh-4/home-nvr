# Cài Home NVR trên Ubuntu

Home NVR hỗ trợ Ubuntu 24.04 trên `x64` và `arm64`. Máy cần có Node.js 24.20.x và npm 11 trở lên ở đường dẫn hệ thống; installer sẽ cài FFmpeg, MediaMTX 1.21.0, cloudflared, tạo service user, systemd unit và các thư mục vận hành.

## Cài bằng một dòng từ GitHub Releases

Sau khi repository và release `v0.1.0` được xuất bản, thay `CHU_SO_HUU/KHO_MA` bằng repository thật:

```bash
sudo npm exec --yes --prefer-online --package=https://github.com/CHU_SO_HUU/KHO_MA/releases/latest/download/home-nvr-linux.tgz -- home-nvr install
```

Lệnh tải tarball đã build từ GitHub Release, cài dependencies production đúng lockfile, tải MediaMTX và cloudflared từ release chính thức rồi kiểm tra SHA-256 trước khi kích hoạt service. Installer in setup token đúng một lần ở kết quả cài mới; lưu token để tạo tài khoản owner.

Mở giao diện trên chính máy Ubuntu tại `http://127.0.0.1:3000`. Muốn mở từ thiết bị khác, cấu hình Cloudflare Tunnel trong tài liệu remote; dịch vụ vẫn bind loopback.

## Bố cục hệ thống

| Đường dẫn | Nội dung |
| --- | --- |
| `/opt/home-nvr/releases/<version-timestamp>` | Release bất biến và dependencies production |
| `/opt/home-nvr/current` | Symlink tới release đang chạy |
| `/opt/home-nvr/bin/mediamtx` | MediaMTX đã kiểm tra checksum |
| `/opt/home-nvr/bin/cloudflared` | Cloudflare Tunnel client đã kiểm tra checksum |
| `/etc/home-nvr/home-nvr.env` | Cấu hình và secret, mode `0600` |
| `/var/lib/home-nvr` | SQLite, recording, runtime media |
| `/var/backups/home-nvr` | Backup do CLI tạo |
| `/etc/systemd/system/home-nvr.service` | systemd unit |
| `/usr/local/bin/home-nvr` | CLI quản trị |

Service chạy bằng user không đăng nhập `home-nvr`, dùng `ProtectSystem=strict`, `NoNewPrivileges`, giới hạn namespace/device và chỉ được ghi vào thư mục dữ liệu/backup.

## Quản trị

```bash
sudo home-nvr status
sudo home-nvr doctor
sudo home-nvr backup
sudo home-nvr backup --output /mnt/backup/home-nvr
sudo home-nvr restore --input /mnt/backup/home-nvr --force
sudo home-nvr rollback
```

Cập nhật bằng chính lệnh npm một dòng ở trên và đổi `install` thành `update`. Installer tạo release mới trước, chuyển symlink rồi chờ `/health/ready`. Nếu release mới không sẵn sàng trong 30 giây, symlink tự quay về release trước và systemd khởi động lại bản cũ.

```bash
sudo npm exec --yes --prefer-online --package=https://github.com/CHU_SO_HUU/KHO_MA/releases/latest/download/home-nvr-linux.tgz -- home-nvr update
```

Rollback thủ công đổi qua lại giữa release hiện tại và release trước. Dữ liệu nằm ngoài release nên không bị ghi đè. Migration hiện tại chỉ bổ sung schema; trước một nâng cấp lớn vẫn nên chạy `sudo home-nvr backup`.

## Gỡ cài đặt

Mặc định giữ database, recording, backup và cấu hình:

```bash
sudo home-nvr uninstall
```

Xóa cả dữ liệu và secret cần chỉ định rõ cả hai cờ:

```bash
sudo home-nvr uninstall --purge --yes
```

## Kiểm tra sau reboot

```bash
sudo systemctl status home-nvr --no-pager
curl --fail http://127.0.0.1:3000/health/ready
journalctl -u home-nvr --since today --no-pager
```

Nghiệm thu cuối cần chạy trên máy Ubuntu đích: reboot, update/rollback, đầy ổ đĩa, nhiều camera và tải liên tục 24 giờ. Không dùng kết quả Windows để kết luận các chỉ số này.
