import React, { useEffect, useState } from 'react';

interface BusinessStripProps {
  user: { plan?: string; balance?: number } | null;
  onBuyApi?: () => void;
}

interface MonthlyBudget {
  percent: number;
  exceeded: boolean;
}

const VND_RATE = 25500;

/** Gauge fill level class — keeps colour in tokens (no inline colour literal). */
function gaugeLevelClass(b: MonthlyBudget | null): string {
  if (!b) return '';
  if (b.exceeded) return 'aw-business__gauge-fill--danger';
  if (b.percent >= 80) return 'aw-business__gauge-fill--warn';
  return '';
}

export function BusinessStrip({ user, onBuyApi }: BusinessStripProps) {
  const [monthly, setMonthly] = useState<MonthlyBudget | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBudget() {
      try {
        const status = await window.electronAPI?.budget?.getStatus();
        if (!cancelled && status?.monthly) {
          setMonthly({
            percent: Math.min(status.monthly.percent ?? 0, 100),
            exceeded: Boolean(status.monthly.exceeded),
          });
        }
      } catch {
        // Budget API unavailable — leave gauge empty (Req 4.6), no throw.
      }
    }
    void loadBudget();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasBalance = typeof user?.balance === 'number';
  const usd = hasBalance ? (user!.balance as number) : 0;
  const balanceLabel = hasBalance ? `$${usd.toFixed(2)}` : '—';
  const vndLabel = hasBalance ? `${Math.round(usd * VND_RATE).toLocaleString('vi-VN')}₫` : '';
  const planLabel = user?.plan ? user.plan : 'Free';

  return (
    <section className="aw-business" aria-label="Tài khoản và chi phí">
      <div className="aw-business__row">
        <div className="aw-business__balance-block">
          <span className="aw-business__balance">{balanceLabel}</span>
          {vndLabel && <span className="aw-business__vnd">{vndLabel}</span>}
        </div>
        <span className="aw-business__plan">{planLabel}</span>
      </div>

      <div className="aw-business__gauge" role="presentation">
        <div
          className={`aw-business__gauge-fill ${gaugeLevelClass(monthly)}`}
          style={{ width: `${monthly ? monthly.percent : 0}%` }}
        />
      </div>
      <div className="aw-business__gauge-label">
        {monthly ? `Đã dùng ${monthly.percent}% ngân sách tháng` : 'Ngân sách tháng'}
      </div>

      <button type="button" className="aw-business__cta" onClick={onBuyApi}>
        Nạp tiền / Nâng gói
      </button>
    </section>
  );
}
