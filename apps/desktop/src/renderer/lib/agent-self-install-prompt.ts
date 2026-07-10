/**
 * Builds the "Loop Prompt" — a self-install instruction seeded into an agent
 * chat composer when the user clicks "Tự cài đặt" on an agent/tool card. The
 * agent then works in a loop (assess → act → verify → retry) to install and
 * configure the target, using whatever tools it has, and reports when done.
 *
 * Pure + framework-free so it can be unit tested and reused by both the Agent
 * Hub cards and the Marketplace tool cards.
 */

export interface SelfInstallTarget {
  /** 'agent' = a chat agent installs/configures itself; 'tool' = an extension. */
  kind: 'agent' | 'tool';
  id: string;
  displayName: string;
  /** For agents: 'izzi' personas are always ready; others may need Docker setup. */
  runtime?: string;
  /** One-line extra context (e.g. platforms to connect, docker image). Optional. */
  setupHint?: string;
}

/** Escape nothing — plain text prompt. Trims the target name for safety. */
function cleanName(name: string): string {
  return (name || '').trim() || 'mục tiêu';
}

/**
 * Compose the loop prompt (Vietnamese — the app's UI language). Deterministic so
 * the same target always yields the same prompt (easy to test + review).
 */
export function buildSelfInstallPrompt(target: SelfInstallTarget): string {
  const name = cleanName(target.displayName);
  const isTool = target.kind === 'tool';
  const isIzzi = (target.runtime || '').toLowerCase() === 'izzi';

  const subject = isTool
    ? `tiện ích (extension) "${name}"`
    : `agent "${name}"`;

  const lines: string[] = [];
  lines.push(`Hãy tự động CÀI ĐẶT và CẤU HÌNH ${subject} giúp tôi, làm việc theo vòng lặp cho tới khi hoàn tất.`);
  lines.push('');
  lines.push('Quy trình lặp (assess → act → verify → retry):');
  lines.push('1. Kiểm tra hiện trạng: đã cài chưa, thiếu gì (phụ thuộc, quyền, token/kết nối, Docker nếu cần).');
  if (isTool) {
    lines.push('2. Cài đặt tiện ích và khởi động backend cục bộ của nó nếu có (managed local service).');
  } else if (isIzzi) {
    lines.push('2. Agent này chạy qua Izzi API nên luôn sẵn sàng — tập trung cấu hình đúng ngữ cảnh + kiểm tra kết nối.');
  } else {
    lines.push('2. Thực hiện các bước cài đặt (vd: pull/run Docker, cấu hình biến môi trường, kết nối nền tảng).');
  }
  lines.push('3. Xác minh: chạy health-check / lệnh kiểm tra thực tế, KHÔNG chỉ giả định là xong.');
  lines.push('4. Nếu lỗi: chẩn đoán nguyên nhân gốc, sửa, rồi thử lại (tối đa vài vòng); nếu bế tắc thì báo rõ tôi cần cung cấp gì.');
  lines.push('5. Khi hoàn tất: tóm tắt đã làm gì, trạng thái cuối, và cách tôi bắt đầu dùng.');
  if (target.setupHint) {
    lines.push('');
    lines.push(`Gợi ý bối cảnh: ${target.setupHint}`);
  }
  lines.push('');
  lines.push('Nguyên tắc: chỉ dùng thông tin/khoá thật khi tôi cung cấp; hỏi trước khi làm điều khó hoàn tác; báo tiến độ từng vòng.');

  return lines.join('\n');
}
