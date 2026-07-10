import React, { useCallback, useEffect, useState } from 'react';

/**
 * Honest model control for the composer (non-izzi gateway agents, e.g. Hermes).
 *
 * The whole point: "pick model X → call model X". Non-izzi agents route through
 * the enabled custom connection (codex-lb / 9router) using its `selectedModel`,
 * which is the exact id sent to the endpoint (see custom-openai-provider.ts).
 * So this reads/writes that single source of truth and shows the REAL model +
 * the endpoint it goes to — no more static "GPT-5.6" label that lies.
 *
 * Two modes:
 *  - custom connection enabled  → a model dropdown. Changing it saves
 *    `selectedModel` (key preserved) so the next turn calls exactly that model.
 *    codex-lb honors the id verbatim; 9router smart-route may override (flagged).
 *  - no custom connection        → the agent falls back to its Docker container /
 *    izzi smart router (model auto-selected server-side). We show that honestly
 *    and keep the reasoning-effort control (the Docker/Hermes path uses it).
 */

// codex-lb models, verified against /v1/models. Free text lives in the
// "Kết nối Model" tab for arbitrary endpoints; the composer offers quick picks.
const CODEX_LB_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const;

const REASONING_OPTIONS: { value: string; label: string }[] = [
  { value: 'low', label: 'Low · nhanh' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'xHigh · sâu nhất' },
];

interface ConnState {
  enabled: boolean;
  model: string;
  baseUrl: string;
  authType: 'bearer' | 'x-api-key';
}

interface GatewayModelPickerProps {
  /** Current reasoning effort (used only on the Docker/izzi fallback path). */
  reasoningEffort?: string;
  onSetReasoningEffort: (effort: string) => void;
  isReconfiguring: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function customProviderApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI?.customProvider ?? null;
}

/** Friendly endpoint name + whether it smart-routes (may override the model). */
function describeEndpoint(baseUrl: string): { name: string; smartRoute: boolean } {
  if (baseUrl.includes(':2455')) return { name: 'codex-lb', smartRoute: false };
  if (baseUrl.includes(':4000')) return { name: '9router', smartRoute: true };
  try {
    return { name: new URL(baseUrl).host || 'endpoint', smartRoute: false };
  } catch {
    return { name: 'endpoint', smartRoute: false };
  }
}

export function GatewayModelPicker({
  reasoningEffort,
  onSetReasoningEffort,
  isReconfiguring,
}: GatewayModelPickerProps) {
  const [conn, setConn] = useState<ConnState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const api = customProviderApi();
    if (!api?.getConfig) {
      setConn(null);
      return;
    }
    void api
      .getConfig()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((c: any) => {
        setConn({
          enabled: !!(c?.enabled && c?.hasKey),
          model: c?.config?.selectedModel ?? '',
          baseUrl: c?.config?.baseUrl ?? '',
          authType: c?.config?.authType === 'x-api-key' ? 'x-api-key' : 'bearer',
        });
      })
      .catch(() => setConn(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onPickModel = useCallback(
    async (next: string) => {
      const api = customProviderApi();
      if (!api?.saveConfig || !conn) return;
      setSaving(true);
      try {
        // No apiKey in the payload — the stored key is preserved (see
        // provider-settings-store.saveConfig, which only persists non-secret fields).
        const r = await api.saveConfig({
          baseUrl: conn.baseUrl,
          authType: conn.authType,
          selectedModel: next,
        });
        if (r?.ok !== false) setConn({ ...conn, model: next });
      } catch {
        /* leave UI as-is; a failed save just keeps the old model */
      } finally {
        setSaving(false);
      }
    },
    [conn],
  );

  // No bridge / still loading — render nothing rather than a misleading label.
  if (!conn) return null;

  // Fallback path: no custom connection → agent runs via its Docker container /
  // izzi smart router. Model is chosen server-side; expose reasoning depth only.
  if (!conn.enabled) {
    return (
      <div
        className="gw-effort"
        title="Chưa bật kết nối model riêng — agent chạy qua izzi smart router (server tự chọn model). Bật codex-lb trong tab 'Kết nối Model' để chọn model cụ thể."
      >
        <span className="gw-effort__label">☁️ izzi smart · Reasoning</span>
        <select
          className="gw-effort__select"
          value={reasoningEffort ?? 'xhigh'}
          disabled={isReconfiguring}
          onChange={(e) => onSetReasoningEffort(e.target.value)}
        >
          {REASONING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {isReconfiguring && <span className="gw-effort__applying">Đang áp dụng… (~30s)</span>}
      </div>
    );
  }

  const ep = describeEndpoint(conn.baseUrl);
  // Always include the current model so a custom/9router id still displays.
  const options =
    conn.model && !(CODEX_LB_MODELS as readonly string[]).includes(conn.model)
      ? [conn.model, ...CODEX_LB_MODELS]
      : [...CODEX_LB_MODELS];

  return (
    <div
      className="gw-effort"
      title={
        ep.smartRoute
          ? `Model gửi tới ${ep.name}. ⚠️ 9router smart-route có thể tự đổi model — dùng codex-lb để gọi đúng model đã chọn.`
          : `Model gửi tới ${ep.name} — chọn model nào gọi đúng model đó.`
      }
    >
      <span className="gw-effort__label">
        🧠 {ep.name}
        {ep.smartRoute ? ' ⚠️' : ''}
      </span>
      <select
        className="gw-effort__select"
        value={conn.model}
        disabled={saving}
        onChange={(e) => void onPickModel(e.target.value)}
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {saving && <span className="gw-effort__applying">Đang đổi…</span>}
    </div>
  );
}
