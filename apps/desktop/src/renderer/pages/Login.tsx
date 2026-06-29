import React, { useState } from 'react';
import { AppLogoMark } from '../components/AppIcons';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onGoogleLogin?: () => Promise<string | null>;
  onSignup?: (email: string, password: string, name: string) => Promise<string | null>;
}

export function LoginPage({ onLogin, onGoogleLogin, onSignup }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === 'signup') {
      if (!email || !password || !name) {
        setError('Vui lòng nhập đầy đủ tên, email và mật khẩu');
        return;
      }
      if (password.length < 6) {
        setError('Mật khẩu phải có ít nhất 6 ký tự');
        return;
      }

      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      if (onSignup) {
        const err = await onSignup(email, password, name);
        if (err) {
          setError(err);
        } else {
          setSuccessMessage('Đăng ký thành công. Kiểm tra email để xác thực tài khoản.');
          setMode('login');
        }
      } else {
        setSuccessMessage('Đăng ký thành công. Demo mode đã sẵn sàng.');
        setMode('login');
      }

      setIsLoading(false);
      return;
    }

    if (!email || !password) {
      setError('Vui lòng nhập email và mật khẩu');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    const err = await onLogin(email, password);
    if (err) {
      setError(err);
    }
    setIsLoading(false);
  }

  async function handleGoogleLogin() {
    if (!onGoogleLogin) {
      window.electronAPI?.shell.openExternal('https://izziapi.com/dashboard');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage('Đang mở trình duyệt để đăng nhập Google...');

    const err = await onGoogleLogin();
    if (err) {
      setError(err);
      setSuccessMessage(null);
    }
    setIsLoading(false);
  }

  function toggleMode() {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError(null);
    setSuccessMessage(null);
  }

  return (
    <div className="login-page">
      <section className="login-hero-panel" aria-label="IzziAI Memory Universe overview">
        <div className="login-hero-panel__kicker">IzziAI Memory Universe</div>
        <h2>Remember how your agents work.</h2>
        <p>
          Store task loops, prompts, click paths and reviewed workflows. When similar work returns,
          OpenClaw can recall the route instead of asking for every step again.
        </p>
        <div className="login-hero-panel__steps" aria-label="Memory workflow">
          {['Capture', 'Structure', 'Recall', 'Replay'].map((step, index) => (
            <div className="login-hero-panel__step" key={step}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {step}
            </div>
          ))}
        </div>
      </section>

      <div className="login-card glass-card">
        <div className="login-card__logo">
          <div className="login-card__logo-icon">
            <AppLogoMark />
          </div>
          <h1>IzziAI OpenClaw</h1>
          <p>
            {mode === 'login'
              ? 'Kết nối với IzziAPI.com để bắt đầu'
              : 'Tạo tài khoản mới — đồng bộ với IzziAPI.com'}
          </p>
        </div>

        {error && <div className="login-card__error">Error · {error}</div>}
        {successMessage && (
          <div className="login-card__success login-card__success-banner">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="input-group">
              <label className="input-group__label" htmlFor="signup-name">Tên hiển thị</label>
              <input
                id="signup-name"
                className="input"
                type="text"
                placeholder="Nguyễn Văn A"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                disabled={isLoading}
              />
            </div>
          )}

          <div className="input-group">
            <label className="input-group__label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus={mode === 'login'}
              disabled={isLoading}
            />
          </div>

          <div className="input-group">
            <label className="input-group__label" htmlFor="login-password">Mật khẩu</label>
            <input
              id="login-password"
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <button
            id="btn-login"
            className="btn btn--primary btn--lg btn--full"
            type="submit"
            disabled={isLoading}
          >
            {isLoading
              ? 'Đang xử lý...'
              : mode === 'login'
                ? 'Đăng nhập'
                : 'Đăng ký'}
          </button>
        </form>

        <div className="login-card__divider">hoặc</div>

        <button
          id="btn-google-login"
          className="btn btn--lg btn--oauth"
          onClick={handleGoogleLogin}
          type="button"
          disabled={isLoading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09A7.08 7.08 0 0 1 5.47 12c0-.72.12-1.41.37-2.09V7.07H2.18A11.96 11.96 0 0 0 0 12c0 1.93.46 3.77 1.28 5.4l3.44-2.72.12-.59z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {mode === 'login' ? 'Đăng nhập với Google' : 'Đăng ký với Google'}
        </button>

        <div className="login-card__footer">
          {mode === 'login' ? (
            <>
              Chưa có tài khoản?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
                Đăng ký miễn phí
              </a>
            </>
          ) : (
            <>
              Đã có tài khoản?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
                Đăng nhập ngay
              </a>
            </>
          )}
        </div>

        {/* Fineprint: slate hues routed to Hệ_Token (Req 4.5 tokens) */}
        <div className="login-card__fineprint">
          <div>Powered by IzziAPI.com • Supabase Auth</div>
          <div className="login-card__fineprint-dim">
            Tài khoản đồng bộ với izziapi.com
          </div>
        </div>
      </div>
    </div>
  );
}
