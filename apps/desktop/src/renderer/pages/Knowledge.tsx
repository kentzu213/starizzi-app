import React, { useEffect, useRef, useState } from 'react';

/**
 * Knowledge / Graph page — embeds the REAL izziapi.com knowledge-universe
 * graphview ("vũ trụ tri thức") inside the desktop via an Electron <webview>,
 * so it looks and behaves exactly like the web (single source of truth — the
 * web owns the canonical graph UI; the desktop renders it).
 *
 * The public graph loads in guest mode without login; signing in on the embedded
 * page unlocks the personal graph. The webview uses a persistent partition so the
 * login is remembered. Token-only styling for the surrounding chrome (Req 11.4).
 */

const GRAPH_URL = 'https://izziapi.com/aibase/graph';

type LoadState = 'loading' | 'ready' | 'error';

// Electron <webview> DOM element — typed loosely (custom element not in lib.dom).
interface WebviewEl extends HTMLElement {
  reload: () => void;
  src: string;
}

export function KnowledgePage() {
  const webviewRef = useRef<WebviewEl | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return undefined;

    const onStart = () => setState('loading');
    const onStop = () => setState('ready');
    const onFail = (e: Event) => {
      // errorCode -3 = ERR_ABORTED (navigation superseded) — not a real failure.
      const code = (e as unknown as { errorCode?: number }).errorCode;
      if (typeof code === 'number' && code === -3) return;
      setState('error');
    };

    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-fail-load', onFail as EventListener);
    return () => {
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-fail-load', onFail as EventListener);
    };
  }, []);

  function handleReload() {
    const el = webviewRef.current;
    if (el && typeof el.reload === 'function') {
      setState('loading');
      el.reload();
    }
  }

  function handleOpenExternal() {
    const openExternal = window.electronAPI?.system?.openExternal;
    if (typeof openExternal === 'function') {
      openExternal(GRAPH_URL);
    } else {
      window.open(GRAPH_URL, '_blank', 'noopener');
    }
  }

  return (
    <div className="knowledge-page knowledge-page--embed">
      <div className="knowledge-embed__bar">
        <span className="knowledge-embed__title">Vũ trụ tri thức — Knowledge Graph</span>
        <div className="knowledge-embed__actions">
          <button type="button" className="knowledge-embed__btn" onClick={handleReload}>
            Tải lại
          </button>
          <button type="button" className="knowledge-embed__btn" onClick={handleOpenExternal}>
            Mở trên web
          </button>
        </div>
      </div>

      <div className="knowledge-embed__stage">
        {state === 'loading' && (
          <div className="knowledge-embed__overlay" aria-busy="true">
            Đang tải vũ trụ tri thức…
          </div>
        )}
        {state === 'error' && (
          <div className="knowledge-embed__overlay">
            <p className="knowledge-page__empty-text">
              Không tải được graphview (cần kết nối mạng).
            </p>
            <div className="knowledge-embed__actions">
              <button type="button" className="knowledge-page__cta" onClick={handleReload}>
                Thử lại
              </button>
              <button type="button" className="knowledge-embed__btn" onClick={handleOpenExternal}>
                Mở trên web
              </button>
            </div>
          </div>
        )}
        {React.createElement('webview', {
          ref: webviewRef,
          src: GRAPH_URL,
          partition: 'persist:izzigraph',
          allowpopups: 'true',
          className: 'knowledge-embed__webview',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)}
      </div>
    </div>
  );
}
