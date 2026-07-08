# Social Auto Poster (.ocx)

Tiện ích Starizzi/OpenClaw: lên lịch và tự động đăng bài social qua **Auto-Post Tool**
(backend izzi thống nhất, mặc định `http://127.0.0.1:3001`). Thiết kế để **agent gọi trực tiếp**
và **bán trên Marketplace** (freemium). Dùng chung tài khoản izzi — **Starizzi tự bơm** Backend URL +
token (JWT) + workspace từ phiên đăng nhập, người dùng **không cần nhập tay**.

## Cài đặt
1-click từ Marketplace trong app (khuyến nghị), hoặc "Install from .ocx", hoặc copy thư mục này vào
`userData/extensions/social-auto-poster/`.

```
tar -czf social-auto-poster-0.2.0.ocx -C extensions/social-auto-poster manifest.json README.md dist
```

## Cấu hình (Settings — Starizzi tự điền)
- `backendUrl` — API Auto-Post Tool (mặc định `http://127.0.0.1:3001`).
- `apiKey` — token izzi (JWT), **tự bơm** từ phiên đăng nhập; lưu cục bộ, không log.
- `targetId` — Social Account ID trong Auto-Post (chạy `listAccounts` để lấy). Để trống = tạo **bản nháp**.
- `scheduleTimes` — mặc định `10:00,17:00,20:00`.
- `timezone` — mặc định `Asia/Ho_Chi_Minh`.

## Commands (agent gọi qua executeCommand)
| Command | Params | Mô tả |
|---|---|---|
| `social-auto-poster.status` | `{}` | Kiểm tra kết nối + xác thực |
| `social-auto-poster.listAccounts` | `{}` | Liệt kê tài khoản MXH (lấy `socialAccountId`) |
| `social-auto-poster.postNow` | `{ content, title?, mediaUrls?, targetId? }` | Tạo bài (có `targetId` = đăng; không = nháp) |
| `social-auto-poster.schedule` | `{ content, times?, days?, targetId? }` | Lên lịch (1 bài/mốc giờ) |
| `social-auto-poster.listScheduled` | `{ status? }` | Xem bài đã lên lịch |
| `social-auto-poster.cancelScheduled` | `{ id }` | Huỷ / xoá bài |

Backend mapping: `GET /social-auth/accounts`, `POST /posts` (`scheduledAt` tương lai = lên lịch),
`GET /posts?status=`, `DELETE /posts/:id`. Auth `Authorization: Bearer <JWT izzi>`.

## An toàn
- Bài **không chọn tài khoản** (`targetId` trống) → tạo **bản nháp**, không tự đăng.
- Có tài khoản + không hẹn giờ → đăng ngay (hành động chủ động của người dùng).
- Token chỉ gửi tới backend đã cấu hình; không log, không chia sẻ.
