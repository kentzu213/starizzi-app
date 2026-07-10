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

## Trạng thái (v1.8.0)
- **P1 DONE** (v1.7.9): agent_runs + agent_run_entries + provenance + no-orphan + helpers pure-tested + IPC/preload/store + UI Runs.
- **P2 DONE (reachable)**: run-pipeline (stages→phòng/agent/mission, pure-tested) + Company view (pipeline strip, phụ trách) + "🧭 Lập kế hoạch" (Orchestrator tự chia việc qua izzi-agent → Run entry).
- **P3 DONE (reachable)**: "Chuyển giai đoạn →" gate theo rủi ro (🟢 tự, 🔴 confirm) + handoff entry có provenance. *(Đồng bộ shared lên izzi kb_memory_nodes: HOÃN — cần endpoint memory-write Bearer ở izzi-backend.)*
- **P4 DONE (reachable)**: "🏛️ Hội đồng" (izzi-agent 4 lăng kính → 1 kết luận, chỉ cố vấn, không tự deploy).
- **HOÃN có chủ đích**: (a) đồng bộ Run/memory lên izzi cloud (chờ backend Bearer); (b) auto-execution KHÔNG người (Red-team: chống chạy loạn) — bản này dùng advance có người gác là hình thức an toàn.
