import { RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

const CHUNK_RELOAD_GUARD = "scutta:chunk-reload-attempted";
const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

function isLikelyChunkLoadError(error: Error): boolean {
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(`${error.name}: ${error.message}`));
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (!isLikelyChunkLoadError(error)) return;

    try {
      if (window.sessionStorage.getItem(CHUNK_RELOAD_GUARD) === "1") return;
      window.sessionStorage.setItem(CHUNK_RELOAD_GUARD, "1");
    } catch {
      // If storage is unavailable, avoid an unguarded reload loop.
      return;
    }

    window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="connection-error-screen">
        <div className="connection-error-card" role="alert">
          <span className="connection-error-card__icon" aria-hidden="true">
            <TriangleAlert size={26} />
          </span>
          <h1>화면을 불러오지 못했습니다</h1>
          <p>일시적인 오류가 발생했습니다. 인터넷 연결을 확인한 뒤 다시 불러와 주세요.</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            <RefreshCw size={18} aria-hidden="true" />
            다시 불러오기
          </button>
        </div>
      </main>
    );
  }
}
