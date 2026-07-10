# AI Company on Starizzi — Requirements (v2)

> Bám 4 ưu tiên chủ sở hữu: (1) việc hằng ngày mượt · (2) phân cấp công ty + chức năng ·
> (3) tối đa tự-xác-định + tự-hoàn-thành · (4) bộ lưu trữ thật tốt. Chi tiết: design.md (đã council).

## R1 — Việc hằng ngày mượt
- Từ 1 mục tiêu ngắn, hệ thống SHALL tự chia việc + chạy; user chỉ chạm khi gặp cổng 🔴 hoặc muốn.
- Việc lặp SHALL nhận ra "giống Run cũ" và tái dùng lộ trình (recall) để chạy nhanh.

## R2 — Phân cấp công ty + chức năng
- Hệ thống SHALL tổ chức agent theo cấp: Điều hành (Orchestrator điều phối + Socrates chất lượng)
  → 3 phòng chức năng (Kỹ thuật: Prototyper→Builder→Sweeper→Maintainer · Thiết kế: Designer · Thị trường: Grower).
- Orchestrator SHALL nhận mục tiêu → xác định + chia + định tuyến tới phòng/nhiệm vụ đúng.

## R3 — Tối đa tự-hoàn-thành, an toàn (autonomy hiệu chỉnh theo rủi ro)
- Việc 🟢 (đảo ngược được, cục bộ, không secret/prod/tiền) SHALL tự chạy + tự chuyển giai đoạn, KHÔNG hỏi.
- Việc 🟡 (dep/config/refactor lớn) SHALL tự làm nhưng báo rõ + có undo.
- Việc 🔴 (deploy prod, xóa/ghi đè diện rộng, tiêu tiền, đăng/gửi ra ngoài, auth/billing/dữ liệu khách)
  SHALL DỪNG chờ người OK (+ council nếu ngã rẽ khó). Council/agent SHALL KHÔNG tự duyệt việc 🔴.
- Mỗi Run SHALL có giới hạn bước/thời lượng + nút Dừng + đường lùi.

## R4 — Bộ lưu trữ thật tốt (nền tảng)
- Bộ nhớ SHALL 2 tầng: private (local/phiên) + shared (izzi `kb_memory_nodes`, đồng bộ web).
- Mọi bản ghi shared SHALL kèm **provenance** (agent/nhiệm vụ · Run · thời điểm · nguồn); chống rò rỉ/cũ/mâu thuẫn/mất gốc.
- Blackboard "Run" (mục tiêu + giai đoạn + artifacts + notes) SHALL bền, không mất, tìm/RAG được.
- Trước khi làm SHALL đọc bộ nhớ liên quan; xong SHALL ghi chắt lọc (agent write-loop). Cấm secret/PII vào shared.

## NFR
- Human-in-the-loop cho 🔴; maintainer fail-closed cho prod/destructive.
- Tái dùng bề mặt sẵn có (tasks board, izzi memory, missions, izzi-agent); không runtime nặng.
- Provenance + verification-loop trước khi "xong".
