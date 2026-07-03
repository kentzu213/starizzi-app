import React, { useCallback, useEffect, useState } from 'react';

/**
 * AffiliatePage — desktop port of the izziapi.com `/dashboard/affiliate` surface.
 *
 * All data comes from the MAIN process over IPC (window.electronAPI.affiliate.*);
 * the JWT never reaches the renderer. This is a money flow, so every read
 * fails closed to a safe empty state and every write surfaces a clear result.
 */

const MIN_WITHDRAW_VND = 500000;

function fmtVnd(n: number): string {
  return (n || 0).toLocaleString('vi-VN') + ' đ';
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  available: 'Khả dụng',
  paid: 'Đã trả',
  processing: 'Đang xử lý',
  rejected: 'Từ chối',
  completed: 'Hoàn tất',
};

export function AffiliatePage() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.affiliate : undefined;

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [commissions, setCommissions] = useState<AffiliateCommission[]>([]);
  const [withdrawals, setWithdrawals] = useState<AffiliateWithdrawal[]>([]);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Withdraw form
  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState<'bank_transfer' | 'credit_convert'>('bank_transfer');
  const [wBankName, setWBankName] = useState('');
  const [wAccountNo, setWAccountNo] = useState('');
  const [wAccountName, setWAccountName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    if (!api) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [s, c, w] = await Promise.all([
      api.stats(),
      api.commissions(),
      api.withdrawals(),
    ]);
    setStats(s);
    setCommissions(c);
    setWithdrawals(w);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const copyLink = async () => {
    if (!stats?.referralLink) return;
    try {
      await navigator.clipboard.writeText(stats.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const submitWithdraw = async () => {
    if (!api) return;
    const amount = Number(wAmount);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_VND) {
      setNotice({ kind: 'err', text: `Tối thiểu ${fmtVnd(MIN_WITHDRAW_VND)}` });
      return;
    }
    if ((stats?.availableVnd ?? 0) < amount) {
      setNotice({ kind: 'err', text: 'Số dư khả dụng không đủ' });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    const res =
      wMethod === 'credit_convert'
        ? await api.convertCredit(amount)
        : await api.withdraw({
            amount,
            method: 'bank_transfer',
            bankInfo: { bank: wBankName, accountNo: wAccountNo, accountName: wAccountName },
          });
    setSubmitting(false);
    if (res.success) {
      setNotice({
        kind: 'ok',
        text:
          wMethod === 'credit_convert'
            ? `Đã đổi thành ${fmtVnd(res.creditsAdded ?? amount)} credit!`
            : 'Yêu cầu rút tiền đã gửi!',
      });
      setWAmount('');
      setWBankName('');
      setWAccountNo('');
      setWAccountName('');
      void loadAll();
    } else {
      setNotice({ kind: 'err', text: res.error });
    }
  };

  const openWeb = () => {
    void api?.openWeb();
  };

  if (loading) {
    return (
      <div className="affiliate">
        <div className="affiliate__loading">
          <span className="affiliate__spinner" aria-hidden />
          <span>Đang tải dữ liệu affiliate…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="affiliate">
      {/* Header */}
      <header className="affiliate__header">
        <div>
          <div className="affiliate__kicker">Affiliate Program</div>
          <h1 className="affiliate__title">Kiếm 20% hoa hồng trọn đời</h1>
          <p className="affiliate__subtitle">
            Chia sẻ link giới thiệu — nhận 20% mỗi giao dịch của người bạn mời. Không giới hạn, không hết hạn.
          </p>
        </div>
        <button type="button" className="affiliate__weblink" onClick={openWeb}>
          Mở trên web ↗
        </button>
      </header>

      {notice && (
        <div className={`affiliate__notice affiliate__notice--${notice.kind}`}>{notice.text}</div>
      )}

      {/* Referral link */}
      <section className="affiliate__panel affiliate__refcard">
        <div className="affiliate__refcard-label">Link giới thiệu của bạn</div>
        <div className="affiliate__refcard-row">
          <code className="affiliate__reflink">
            {stats?.referralLink || 'Đăng nhập để nhận link giới thiệu'}
          </code>
          <button
            type="button"
            className="affiliate__copybtn"
            onClick={copyLink}
            disabled={!stats?.referralLink}
          >
            {copied ? 'Đã sao chép ✓' : 'Sao chép'}
          </button>
        </div>
        {stats?.code && (
          <div className="affiliate__refcard-code">
            Mã của bạn: <strong>{stats.code}</strong>
          </div>
        )}
      </section>

      {/* Stat tiles */}
      <section className="affiliate__stats">
        <StatTile label="Đã giới thiệu" value={String(stats?.totalReferrals ?? 0)} accent="cyan" />
        <StatTile label="Chờ duyệt" value={fmtVnd(stats?.pendingVnd ?? 0)} accent="amber" />
        <StatTile label="Khả dụng" value={fmtVnd(stats?.availableVnd ?? 0)} accent="green" highlight />
        <StatTile label="Tổng thu nhập" value={fmtVnd(stats?.totalEarningsVnd ?? 0)} accent="violet" />
      </section>

      <div className="affiliate__grid">
        {/* Withdraw */}
        <section className="affiliate__panel affiliate__withdraw">
          <h2 className="affiliate__panel-title">Rút tiền / Đổi credit</h2>
          <p className="affiliate__panel-hint">
            Số dư khả dụng: <strong>{fmtVnd(stats?.availableVnd ?? 0)}</strong> · tối thiểu {fmtVnd(MIN_WITHDRAW_VND)}
          </p>

          <div className="affiliate__method">
            <button
              type="button"
              className={`affiliate__method-btn ${wMethod === 'bank_transfer' ? 'is-active' : ''}`}
              onClick={() => setWMethod('bank_transfer')}
            >
              Chuyển khoản
            </button>
            <button
              type="button"
              className={`affiliate__method-btn ${wMethod === 'credit_convert' ? 'is-active' : ''}`}
              onClick={() => setWMethod('credit_convert')}
            >
              Đổi thành credit
            </button>
          </div>

          <label className="affiliate__field">
            <span>Số tiền (VND)</span>
            <input
              type="number"
              min={MIN_WITHDRAW_VND}
              step={50000}
              value={wAmount}
              onChange={(e) => setWAmount(e.target.value)}
              placeholder={String(MIN_WITHDRAW_VND)}
            />
          </label>

          {wMethod === 'bank_transfer' && (
            <div className="affiliate__bank">
              <label className="affiliate__field">
                <span>Ngân hàng</span>
                <input value={wBankName} onChange={(e) => setWBankName(e.target.value)} placeholder="VD: Vietcombank" />
              </label>
              <label className="affiliate__field">
                <span>Số tài khoản</span>
                <input value={wAccountNo} onChange={(e) => setWAccountNo(e.target.value)} placeholder="0123456789" />
              </label>
              <label className="affiliate__field">
                <span>Chủ tài khoản</span>
                <input value={wAccountName} onChange={(e) => setWAccountName(e.target.value)} placeholder="NGUYEN VAN A" />
              </label>
            </div>
          )}

          <button
            type="button"
            className="affiliate__submit"
            onClick={submitWithdraw}
            disabled={submitting}
          >
            {submitting ? 'Đang gửi…' : wMethod === 'credit_convert' ? 'Đổi credit' : 'Gửi yêu cầu rút'}
          </button>
        </section>

        {/* Commissions */}
        <section className="affiliate__panel affiliate__history">
          <h2 className="affiliate__panel-title">Hoa hồng gần đây</h2>
          {commissions.length === 0 ? (
            <p className="affiliate__empty">Chưa có hoa hồng nào. Chia sẻ link để bắt đầu kiếm tiền.</p>
          ) : (
            <ul className="affiliate__list">
              {commissions.map((c) => (
                <li key={c.id} className="affiliate__row">
                  <div className="affiliate__row-main">
                    <span className="affiliate__row-email">{c.referred_email || 'ẩn danh'}</span>
                    <span className="affiliate__row-sub">
                      {fmtVnd(c.amount_vnd)} · {fmtDate(c.created_at)}
                    </span>
                  </div>
                  <div className="affiliate__row-side">
                    <span className="affiliate__row-amount">+{fmtVnd(c.commission_vnd)}</span>
                    <span className={`affiliate__badge affiliate__badge--${c.status}`}>
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Withdrawals */}
      <section className="affiliate__panel affiliate__history">
        <h2 className="affiliate__panel-title">Lịch sử rút tiền</h2>
        {withdrawals.length === 0 ? (
          <p className="affiliate__empty">Chưa có yêu cầu rút tiền nào.</p>
        ) : (
          <ul className="affiliate__list">
            {withdrawals.map((w) => (
              <li key={w.id} className="affiliate__row">
                <div className="affiliate__row-main">
                  <span className="affiliate__row-email">{fmtVnd(w.amount_vnd)}</span>
                  <span className="affiliate__row-sub">
                    {w.method === 'credit_convert' ? 'Đổi credit' : 'Chuyển khoản'} · {fmtDate(w.created_at)}
                  </span>
                  {w.admin_note && <span className="affiliate__row-note">Ghi chú: {w.admin_note}</span>}
                </div>
                <span className={`affiliate__badge affiliate__badge--${w.status}`}>
                  {STATUS_LABEL[w.status] || w.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
  highlight,
}: {
  label: string;
  value: string;
  accent: 'cyan' | 'amber' | 'green' | 'violet';
  highlight?: boolean;
}) {
  return (
    <div className={`affiliate__tile affiliate__tile--${accent} ${highlight ? 'affiliate__tile--pop' : ''}`}>
      <div className="affiliate__tile-label">{label}</div>
      <div className="affiliate__tile-value">{value}</div>
    </div>
  );
}
