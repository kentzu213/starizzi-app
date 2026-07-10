# AI Company on Starizzi — Tasks (v2, phân pha)

> Lưu trữ TRƯỚC (ưu tiên #4 = xương sống), rồi phân cấp/định tuyến, rồi autonomy, rồi council.
> Lớp điều phối MỎNG trên đồ có sẵn. Mỗi pha verify + (tùy) release increment.

## P1 — Bộ lưu trữ "thật tốt" (nền tảng)
- [ ] 1.1 "Run" record bền (mục tiêu + giai đoạn + artifacts[] + handoff notes[]) neo trên Replay tasks board (agent_tasks).
- [ ] 1.2 Provenance trên mọi bản ghi (agent/nhiệm vụ · Run · thời điểm). Cấm secret/PII.
- [ ] 1.3 Đồng bộ shared brain izzi (nối memory-sync) + đọc-trước/ghi-sau (recall). Verify + security-review.

## P2 — Phân cấp + tự xác định việc (routing)
- [ ] 2.1 Orchestrator: từ mục tiêu → chia task + định tuyến phòng/nhiệm vụ + đặt DONE (ghi vào Run).
- [ ] 2.2 "Company view": Run theo cấp/phòng + trạng thái giai đoạn (đọc-hợp-nhất). Verify.

## P3 — Tự hoàn thành hiệu chỉnh theo rủi ro (autonomy)
- [ ] 3.1 Phân loại hành động 🟢/🟡/🔴 (dùng lại classifier risk có sẵn) cho mỗi bước.
- [ ] 3.2 🟢 tự chuyển giai đoạn (handoff auto, seed ngữ cảnh); 🔴 dừng chờ người OK; 🟡 làm + báo + undo.
- [ ] 3.3 Dây an toàn: giới hạn bước/thời lượng + nút Dừng + đường lùi. Verify + security-review.

## P4 — Thảo luận (council theo yêu cầu)
- [ ] 4.1 "Hội đồng": 4 lăng kính → 1 kết luận; Socrates chủ tọa; cho ngã rẽ 🔴/khó đảo ngược.
- [ ] 4.2 Chặn council/agent tự duyệt deploy prod/destructive. Verify + Socrates gate.

## Trạng thái
- Sẵn sàng P1 (tái dùng tasks board + memory-sync). P3 phụ thuộc endpoint memory-write Bearer (izzi-backend).
- Grower chạy song song xuyên các pha. Chờ user chốt hướng v2 trước khi code.
