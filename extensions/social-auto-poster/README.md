# Social Auto Poster (.ocx)

Tiện ích Starizzi/OpenClaw: lên lịch và tự động đăng bài social qua **backend đã cài trên máy** (vd: aitoearn). Thiết kế để **agent gọi trực tiếp** và để **bán trên Marketplace** (pricing: freemium).

## Cài đặt (dev)
Đóng gói và cài qua "Install from .ocx" trong app, hoặc copy thư mục này vào `userData/extensions/social-auto-poster/`.

```
tar -czf social-auto-poster-0.1.0.ocx -C extensions/social-auto-poster .
```

## Cấu hình (Settings)
- `backendUrl` — API của công cụ đăng bài (vd `http://host.docker.internal:8080`).
- `apiKey` — token xác thực (lưu **cục bộ**, không log, không chia sẻ).
- `channel` — `facebook_page` (khuyến nghị) / `facebook_group` / `instagram` / `twitter`.
- `targetId` — ID Page/kênh.
- `scheduleTimes` — mặc định `10:00,17:00,20:00`.

## Commands (agent gọi được qua executeCommand)
| Command | Params | Mô tả |
|---|---|---|
| `social-auto-poster.status` | `{ backendUrl?, apiKey? }` | Kiểm tra kết nối backend |
| `social-auto-poster.postNow` | `{ content, mediaUrls?, targetId?, channel? }` | Đăng ngay |
| `social-auto-poster.schedule` | `{ content, times?, dates?, ... }` | Lên lịch |
| `social-auto-poster.listScheduled` | `{}` | Xem lịch |
| `social-auto-poster.cancelScheduled` | `{ id }` | Huỷ lịch |

Command trả về `{ ok, httpStatus, result, ... }` — minh bạch nguyên trạng thái backend.

## Giới hạn thực tế
- **Facebook Page**: đăng qua API OK (backend cần token Page hợp lệ).
- **Facebook Group**: Meta đã **chặn** đăng group qua API (~2020). Muốn tự đăng group phải dùng **browser automation** ở backend.

## Đường dẫn API backend
Các path mặc định (`/api/v1/publish`, `/api/v1/schedule`) có thể override qua params (`publishPath`, `schedulePath`, ...) để khớp backend cụ thể. Cần map đúng theo API của công cụ đã cài.
