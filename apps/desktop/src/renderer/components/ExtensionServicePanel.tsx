import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ServicePhase,
  type ServiceStatusResult,
  capLogs,
  deriveEndpoint,
  endpointFromBaseUrl,
  phaseFromStatus,
  shouldAutoStart,
  statusHasService,
} from './extension-service-panel.logic';

/**
 * ExtensionServicePanel — shows the state of an extension's managed local backend
 * (the manifest `service` block) and lets the user start/stop it. When the user
 * opens an installed extension that declares a service, this auto-boots the
 * backend (docker compose) and streams the first-run progress, then shows the
 * loopback endpoint it's reachable on.
 *
 * Self-hiding: renders nothing when the extension has no `service` block.
 * All styling comes from izzi house tokens (see styles/extension-service.css).
 */

type Phase = ServicePhase;
type ServiceStatus = ServiceStatusResult;

interface Props {
  extensionId: string;
  isInstalled: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  checking: 'Đang kiểm tra…',
  idle: 'Chưa chạy',
  starting: 'Đang khởi động…',
  running: 'Đã kết nối',
  stopped: 'Đã dừng',
  error: 'Lỗi',
};

export function ExtensionServicePanel({ extensionId, isInstalled }: Props) {
  const rt = (window as Window).electronAPI?.extensionRuntime;

  const [phase, setPhase] = useState<Phase>('checking');
  const [hasService, setHasService] = useState<boolean | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const autoStartedRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => capLogs(prev, line));
  }, []);

  const start = useCallback(async () => {
    if (!rt) return;
    setPhase('starting');
    setError(null);
    setLogs([]);
    try {
      const res = await rt.start(extensionId);
      if (res?.success) {
        const s: ServiceStatus = await rt.serviceStatus(extensionId);
        setEndpoint(deriveEndpoint(s.ports) ?? endpoint);
        setPhase('running');
      } else {
        setError(res?.error || 'Không khởi động được backend.');
        setPhase('error');
      }
    } catch (err: any) {
      setError(err?.message || 'Không khởi động được backend.');
      setPhase('error');
    }
  }, [rt, extensionId, endpoint]);

  const stop = useCallback(async () => {
    if (!rt) return;
    try {
      await rt.serviceStop(extensionId);
    } catch {
      /* best-effort */
    }
    setPhase('stopped');
  }, [rt, extensionId]);

  // Initial status + live log/status subscriptions.
  useEffect(() => {
    if (!rt) {
      setHasService(false);
      return;
    }
    let active = true;

    const offLog = rt.onServiceLog?.((data: { extensionId: string; line: string }) => {
      if (data.extensionId === extensionId) appendLog(data.line);
    });
    const offStatus = rt.onServiceStatus?.((data: { extensionId: string; running: boolean; baseUrl?: string }) => {
      if (data.extensionId !== extensionId) return;
      if (data.baseUrl) setEndpoint(endpointFromBaseUrl(data.baseUrl));
      if (data.running) setPhase('running');
    });

    (async () => {
      const s: ServiceStatus = await rt.serviceStatus(extensionId);
      if (!active) return;
      const has = statusHasService(s);
      setHasService(has);
      if (!has) return;
      setEndpoint(deriveEndpoint(s.ports));
      setPhase(phaseFromStatus(s));
      // Opening an installed extension = "click the app" → auto-boot its backend.
      if (shouldAutoStart({ isInstalled, hasService: true, running: !!s.running, alreadyStarted: autoStartedRef.current })) {
        autoStartedRef.current = true;
        void start();
      }
    })();

    return () => {
      active = false;
      offLog?.();
      offStatus?.();
    };
    // start is intentionally excluded — auto-start is guarded by autoStartedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, extensionId, isInstalled, appendLog]);

  // Auto-scroll the log to the newest line.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  if (hasService === false || hasService === null) return null;

  const busy = phase === 'starting';
  const isUp = phase === 'running';
  const showLog = logs.length > 0 && (phase === 'starting' || phase === 'error');

  return (
    <section className={`svc-panel svc-panel--${phase}`} aria-label="Backend cục bộ">
      <div className="svc-panel__head">
        <span className="svc-panel__kicker">LOCAL SERVICE</span>
        <span className={`svc-status svc-status--${phase}`}>
          <span className="svc-status__dot" />
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <div className="svc-panel__row">
        <div className="svc-panel__endpoint">
          <span className="svc-panel__endpoint-label">Cổng</span>
          <code className="svc-panel__endpoint-value">{endpoint || '—'}</code>
        </div>

        {isUp ? (
          <button className="svc-btn svc-btn--ghost" onClick={stop} type="button">
            Dừng
          </button>
        ) : (
          <button className="svc-btn svc-btn--primary" onClick={start} disabled={busy} type="button">
            {busy ? 'Đang khởi động…' : phase === 'error' ? 'Thử lại' : 'Khởi động'}
          </button>
        )}
      </div>

      {phase === 'starting' && (
        <p className="svc-panel__hint">
          Lần đầu có thể mất 1–2 phút để tải image. Các lần sau chỉ vài giây.
        </p>
      )}

      {error && <p className="svc-panel__error">{error}</p>}

      {showLog && (
        <div className="svc-log" role="log" aria-live="polite">
          {logs.map((line, i) => (
            <div key={i} className="svc-log__line">{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </section>
  );
}
