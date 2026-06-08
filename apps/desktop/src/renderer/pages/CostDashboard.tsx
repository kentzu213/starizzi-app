import React, { useEffect, useState, useCallback } from 'react';

// ── Types (mirrored from backend) ──

interface BudgetPeriod {
  used: number;
  limit: number;
  percent: number;
  exceeded: boolean;
}

interface BudgetStatus {
  daily: BudgetPeriod;
  weekly: BudgetPeriod;
  monthly: BudgetPeriod;
  totalSpent: number;
  totalRequests: number;
  avgCostPerRequest: number;
  modelBreakdown: Record<string, { count: number; costUSD: number }>;
}

interface BudgetLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

interface CostDashboardPageProps {
  t: any; // Translation object
}

// ── Helpers ──

/** Status color token for a budget period, by usage level. */
function periodColor(data: BudgetPeriod): string {
  if (data.exceeded) return 'var(--color-error)';
  if (data.percent >= 80) return 'var(--color-warning)';
  return 'var(--color-success)';
}

/** Progress-fill background token: solid until 80%, gradient when healthy. */
function periodFillBackground(data: BudgetPeriod): string {
  if (data.exceeded) return 'var(--color-error)';
  if (data.percent >= 80) return 'var(--color-warning)';
  return 'linear-gradient(90deg, var(--color-success), var(--color-accent-cyan))';
}

// ── Component ──

export function CostDashboardPage({ t }: CostDashboardPageProps) {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [limits, setLimits] = useState<BudgetLimits>({ daily: 1, weekly: 5, monthly: 15 });
  const [advice, setAdvice] = useState<{ tier: string; reasonVi: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLimits, setEditLimits] = useState<BudgetLimits>({ daily: 1, weekly: 5, monthly: 15 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      if (!window.electronAPI?.budget) return;
      const [s, l, a] = await Promise.all([
        window.electronAPI.budget.getStatus(),
        window.electronAPI.budget.getLimits(),
        window.electronAPI.budget.getAdvice(),
      ]);
      setStatus(s);
      setLimits(l);
      setEditLimits(l);
      setAdvice(a);
    } catch (err) {
      console.warn('[CostDashboard] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    // Refresh every 30s
    const interval = setInterval(() => void loadData(), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Save limits ──

  async function saveLimits() {
    try {
      await window.electronAPI?.budget.setLimits(editLimits);
      setLimits(editLimits);
      setEditing(false);
      await loadData();
    } catch { /* ignore */ }
  }

  // ── Format helpers ──

  const fmtUSD = (n: number) => `$${n.toFixed(4)}`;
  const fmtVND = (n: number) => `${Math.round(n * 25500).toLocaleString('vi-VN')}₫`;
  const fmtPercent = (n: number) => `${Math.min(n, 100)}%`;

  // ── Render ──

  if (loading) {
    return (
      <div className="cost-dash">
        <div className="cost-dash__loading">
          <div className="cost-dash__spinner" />
          <span>{t?.app?.loading || 'Loading...'}</span>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="cost-dash">
        <h2 className="cost-dash__title">{t?.cost?.dashboardTitle || '💰 Cost Management'}</h2>
        <div className="cost-dash__empty-state">
          <span className="cost-dash__empty-icon">📊</span>
          <p>{t?.cost?.noData || 'No spending data yet'}</p>
        </div>
      </div>
    );
  }

  const periods: Array<{ key: 'daily' | 'weekly' | 'monthly'; data: BudgetPeriod }> = [
    { key: 'daily', data: status.daily },
    { key: 'weekly', data: status.weekly },
    { key: 'monthly', data: status.monthly },
  ];

  const periodLabels = {
    daily: t?.cost?.period?.daily || 'Daily',
    weekly: t?.cost?.period?.weekly || 'Weekly',
    monthly: t?.cost?.period?.monthly || 'Monthly',
  };

  // Sort model breakdown by cost desc
  const modelEntries = Object.entries(status.modelBreakdown)
    .sort(([, a], [, b]) => b.costUSD - a.costUSD);

  return (
    <div className="cost-dash">
      {/* ── Header ── */}
      <div className="cost-dash__header">
        <div>
          <h2 className="cost-dash__title">{t?.cost?.dashboardTitle || '💰 Cost Management'}</h2>
          <p className="cost-dash__subtitle">{t?.cost?.dashboardDesc || 'Track spending and optimize your AI budget'}</p>
        </div>
        <button className="cost-dash__refresh-btn" onClick={() => void loadData()}>
          🔄 {t?.app?.refresh || 'Refresh'}
        </button>
      </div>

      {/* ── Budget Cards ── */}
      <div className="cost-dash__cards-grid">
        {periods.map(({ key, data }) => (
          <div
            key={key}
            className="glass-card cost-dash__card"
            style={{ borderLeft: `4px solid ${periodColor(data)}` }}
          >
            <div className="cost-dash__card-header">
              <span className="cost-dash__card-label">{periodLabels[key]}</span>
              {data.exceeded && <span className="cost-dash__badge">⚠️</span>}
            </div>
            {/* Progress bar */}
            <div className="cost-dash__progress-bg">
              <div
                className="cost-dash__progress-fill"
                style={{
                  width: `${Math.min(data.percent, 100)}%`,
                  background: periodFillBackground(data),
                }}
              />
            </div>
            <div className="cost-dash__card-row">
              <span>{t?.cost?.spent || 'Spent'}: <strong>{fmtUSD(data.used)}</strong></span>
              <span>{fmtPercent(data.percent)}</span>
            </div>
            <div className="cost-dash__card-row">
              <span className="cost-dash__muted">{t?.cost?.limit || 'Limit'}: {fmtUSD(data.limit)}</span>
              <span className="cost-dash__muted">{t?.cost?.remaining || 'Remaining'}: {fmtUSD(Math.max(0, data.limit - data.used))}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Summary Stats ── */}
      <div className="cost-dash__stats-row">
        <div className="cost-dash__stat-box">
          <span className="cost-dash__stat-value">{fmtUSD(status.totalSpent)}</span>
          <span className="cost-dash__stat-label">{t?.cost?.totalSpent || 'Total Spent'}</span>
          <span className="cost-dash__stat-sub">{fmtVND(status.totalSpent)}</span>
        </div>
        <div className="cost-dash__stat-box">
          <span className="cost-dash__stat-value">{status.totalRequests}</span>
          <span className="cost-dash__stat-label">{t?.cost?.requests || 'Requests'}</span>
        </div>
        <div className="cost-dash__stat-box">
          <span className="cost-dash__stat-value">{fmtUSD(status.avgCostPerRequest)}</span>
          <span className="cost-dash__stat-label">{t?.cost?.avgPerRequest || 'Avg/Request'}</span>
        </div>
      </div>

      {/* ── Model Breakdown ── */}
      {modelEntries.length > 0 && (
        <div className="cost-dash__section">
          <h3 className="cost-dash__section-title">{t?.cost?.modelUsage || 'Usage by Model'}</h3>
          <div className="cost-dash__model-list">
            {modelEntries.map(([modelId, { count, costUSD }]) => {
              const pct = status.monthly.used > 0 ? Math.round((costUSD / status.monthly.used) * 100) : 0;
              return (
                <div key={modelId} className="cost-dash__model-row">
                  <div className="cost-dash__model-info">
                    <span className="cost-dash__model-name">{modelId}</span>
                    <span className="cost-dash__muted">{count} {t?.cost?.requests || 'requests'}</span>
                  </div>
                  <div className="cost-dash__model-bar">
                    <div className="cost-dash__model-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="cost-dash__model-cost">{fmtUSD(costUSD)} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Budget Limits Editor ── */}
      <div className="cost-dash__section">
        <div className="cost-dash__section-header">
          <h3 className="cost-dash__section-title">{t?.cost?.alertSettings || 'Alert Settings'}</h3>
          {!editing ? (
            <button className="cost-dash__edit-btn" onClick={() => setEditing(true)}>
              ✏️ {t?.app?.edit || 'Edit'}
            </button>
          ) : (
            <div className="cost-dash__edit-actions">
              <button className="cost-dash__save-btn" onClick={saveLimits}>💾 {t?.app?.save || 'Save'}</button>
              <button className="cost-dash__cancel-btn" onClick={() => { setEditing(false); setEditLimits(limits); }}>
                {t?.app?.cancel || 'Cancel'}
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="cost-dash__limits-grid">
            {(['daily', 'weekly', 'monthly'] as const).map(key => (
              <div key={key} className="cost-dash__limit-field">
                <label className="cost-dash__limit-label">{periodLabels[key]}</label>
                <div className="cost-dash__input-group">
                  <span className="cost-dash__input-prefix">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editLimits[key]}
                    onChange={e => setEditLimits({ ...editLimits, [key]: parseFloat(e.target.value) || 0 })}
                    className="cost-dash__input"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="cost-dash__limits-grid">
            {(['daily', 'weekly', 'monthly'] as const).map(key => (
              <div key={key} className="cost-dash__limit-display">
                <span className="cost-dash__muted">{periodLabels[key]}:</span>
                <span className="cost-dash__limit-value">{fmtUSD(limits[key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Subscription Advice ── */}
      {advice && (
        <div
          className="cost-dash__advice-box"
          style={{
            // data-driven border color routed to Hệ_Token (Req 4.3)
            borderColor: advice.tier === 'max'
              ? 'var(--color-warning)'
              : advice.tier === 'pro'
                ? 'var(--color-accent-cyan)'
                : 'var(--color-success)',
          }}
        >
          <span className="cost-dash__advice-icon">
            {advice.tier === 'max' ? '🚀' : advice.tier === 'pro' ? '⭐' : '✅'}
          </span>
          <span>{advice.reasonVi || t?.cost?.subscriptionAdvice?.[advice.tier] || ''}</span>
        </div>
      )}
    </div>
  );
}
