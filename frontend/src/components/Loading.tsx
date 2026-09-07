import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export function LoadingScreen({
  connecting = false,
  onRetry,
}: {
  connecting?: boolean;
  onRetry?: () => void;
}) {
  const [slowConnection, setSlowConnection] = useState(false);
  useEffect(() => {
    if (!connecting) return;
    const timer = window.setTimeout(() => setSlowConnection(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [connecting]);

  if (connecting && slowConnection) {
    return (
      <main className="connection-error-screen">
        <div className="connection-error-card">
          <span className="spinner" aria-hidden="true" />
          <div role="status" aria-live="polite">
            <h1>서버에 연결하고 있어요</h1>
            <p>오랜만에 접속하면 서버 준비에 1분 정도 걸릴 수 있어요. 잠시만 기다려 주세요.</p>
          </div>
          {onRetry && (
            <button type="button" className="primary-button" onClick={onRetry}>
              <RefreshCw size={18} aria-hidden="true" />
              연결 다시 시도
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="splash" role="status" aria-live="polite" aria-label="앱을 불러오는 중">
      <img className="splash__logo" src="/scutta-logo.png" alt="" />
      <span className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </main>
  );
}

export function ConnectionErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="connection-error-screen">
      <div className="connection-error-card">
        <span className="connection-error-card__icon" aria-hidden="true">
          <WifiOff size={26} />
        </span>
        <h1>서버에 연결할 수 없습니다</h1>
        <p>{message}</p>
        <p>첫 연결은 서버 준비에 시간이 걸릴 수 있어요. 잠시 뒤 다시 시도해 주세요. 로그인 정보는 그대로 유지됩니다.</p>
        <button type="button" className="primary-button" onClick={onRetry}>
          <RefreshCw size={18} aria-hidden="true" />
          연결 다시 시도
        </button>
      </div>
    </main>
  );
}

export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>불러오는 중</span>
    </div>
  );
}
