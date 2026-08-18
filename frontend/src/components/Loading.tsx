import { RefreshCw, WifiOff } from "lucide-react";

export function LoadingScreen() {
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
        <button type="button" className="primary-button" onClick={onRetry}>
          <RefreshCw size={18} />
          다시 시도
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
