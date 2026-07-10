# AI Company on Starizzi — Operating Model (phương hướng v2)

> 8 agent (Orchestrator, Socrates, Designer + Prototyper→Builder→Sweeper→Maintainer, Grower)
> vận hành như **một công ty AI**. Bám 4 ưu tiên của chủ sở hữu:
> 1) chạy việc hằng ngày MƯỢT · 2) PHÂN CẤP theo công ty + chức năng · 3) TỐI ĐA tự-xác-định
> + tự-hoàn-thành · 4) bộ LƯU TRỮ thật tốt. Bám 5 nhiệm vụ vòng đời, không thêm nhiệm vụ.
> Neo trên nghiên cứu multi-agent (MetaGPT SOP, CrewAI hierarchical, blackboard, governed memory).

## 1) Phân cấp công ty + chức năng (ưu tiên #2)
Sơ đồ tổ chức (hierarchical + functional — kiểu CrewAI/MetaGPT):

```
        Điều hành
   Orchestrator (COO/điều phối)  ── nhận mục tiêu → xác định + chia việc → giao phòng
   Socrates (GĐ Chất lượng)      ── soi ngang mọi phòng, gác cổng, chủ tọa hội đồng
        │
   ┌────┼──────────────┬──────────────┐
   ▼                   ▼              ▼
 Phòng Kỹ thuật     Phòng Thiết kế   Phòng Thị trường
 (vòng đời SP)       Designer         Grower (song song)
 Prototyper → Builder → Sweeper → Maintainer
```
- Orchestrator là **đỉnh điều phối** (router + chia việc); Socrates là **cổng chất lượng** cắt ngang.
- 3 phòng chức năng: Kỹ thuật (dây chuyền 4 nhiệm vụ) · Thiết kế · Thị trường. Grower chạy song song.

## 2) Tối đa tự-xác-định + tự-hoàn-thành, AN TOÀN (ưu tiên #3) — "autonomy hiệu chỉnh theo rủi ro"
Đây là điểm cốt lõi (đã re-council). Không "chặn từng bước", cũng không "tự trị mù":

- **Tự XÁC ĐỊNH việc:** từ 1 mục tiêu ngắn, Orchestrator **tự chia thành task + định tuyến** phòng/nhiệm vụ (task routing engine) + đặt tiêu chí DONE. Nhận diện "việc này giống Run cũ X" → tái dùng lộ trình (recall).
- **Tự HOÀN THÀNH theo màu rủi ro** (dùng lại security-baseline Tầng1→Tầng2):
  - 🟢 **XANH = tự chạy, không hỏi:** việc đảo ngược được, cục bộ, không secret/prod/tiền — prototype, code, thiết kế, nghiên cứu, bản nháp, chạy test. → Agent tự làm + tự chuyển giai đoạn khi DONE.
  - 🟡 **VÀNG = tự làm + báo rõ, dễ hoàn tác:** cài dependency, đổi config, refactor lớn. → Làm nhưng hiện rõ, có undo.
  - 🔴 **ĐỎ = DỪNG, cần người OK:** không đảo ngược/tác động lớn — deploy prod, xóa/ghi đè diện rộng, tiêu tiền, đăng/gửi ra ngoài, đụng auth/billing/dữ liệu khách. → Chặn cứng, chờ người duyệt (+ hội đồng nếu ngã rẽ khó).
- **Nguyên tắc:** *tự động theo mặc định (xanh), chặn theo ngoại lệ (đỏ)* → tối đa auto‑complete mà vẫn an toàn.
- Có **"dây an toàn"**: giới hạn số bước/thời lượng mỗi Run; luôn có wrap-up + đường lùi; user xem tiến độ realtime và **bấm Dừng** bất cứ lúc nào.

## 3) Bộ lưu trữ thật tốt (ưu tiên #4) — nền tảng, không phải phụ kiện
Bộ nhớ là **xương sống** khiến auto-complete đáng tin + việc hằng ngày mượt:

- **2 tầng có quản trị:** *private* (local/phiên, nhanh) + *shared* = **bộ não izzi** (`kb_memory_nodes`, nguồn chung, đồng bộ web).
- **Provenance mọi bản ghi:** ai (nhiệm vụ/agent) · Run nào · khi nào · nguồn → truy vết + chống 4 lỗi governed-memory (rò rỉ / cũ kỹ / mâu thuẫn / mất gốc).
- **Blackboard = Run record bền:** mục tiêu + giai đoạn + artifacts + handoff notes, neo trên Replay tasks board; là "trí nhớ làm việc" của công ty.
- **Recall cho việc lặp (ưu tiên #1):** trước khi làm, agent **đọc bộ nhớ liên quan**; xong thì **ghi chắt lọc** lại. Việc hằng ngày → nhận ra "giống Run cũ" → tái dùng lộ trình ("Recall routes for repeat work").
- **Bền + tìm được:** không mất Run/artifact; tìm/RAG trên bộ não; cấm secret/PII vào shared.

## 4) Việc hằng ngày mượt (ưu tiên #1)
- Một ô "Giao mục tiêu" → Orchestrator tự chia + chạy → user xem bảng Run tiến triển, chỉ chạm khi gặp cổng 🔴.
- Mẫu Run lặp lại (daily) lưu sẵn + recall từ bộ não → bấm 1 phát chạy lại lộ trình quen.
- Grower chạy song song, không chặn; kết quả cùng đổ về blackboard.

## Kết nối / giao việc / thảo luận (chốt)
- **Kết nối:** qua **blackboard** (Run record), decoupled — không gọi trực tiếp agent khác (kiểu MetaGPT pub/sub).
- **Giao việc:** Orchestrator ghi task + handoff note lên Run; nhiệm vụ kế đọc & tiếp (🟢 tự sang, 🔴 chờ người).
- **Thảo luận:** **#council theo yêu cầu** (Architect/Red-team/Pragmatist/Verifier → 1 kết luận) cho ngã rẽ 🔴/khó đảo ngược; Socrates chủ tọa. **Council KHÔNG tự duyệt deploy prod/destructive** — chỉ người dùng.

## Không làm (giữ an toàn + tối thiểu)
- Không tự trị mù ở việc 🔴; không để council/agent tự deploy prod hay chạy lệnh phá hủy.
- Không dựng state-machine engine nặng; blackboard = tasks board + izzi memory sẵn có.
- Không thêm nhiệm vụ ngoài 5; không dồn mọi thứ vào "1 rổ" bộ nhớ (phải có scope + provenance).
