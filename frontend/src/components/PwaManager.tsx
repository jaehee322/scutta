import { Download, ExternalLink, RefreshCw, Smartphone, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { registerSW } from "virtual:pwa-register";

import { Modal } from "./Modal";
import { detectInstallEnvironment, type InstallEnvironment } from "./pwaEnvironment";
import { applyPwaUpdateLifecycle } from "./pwaUpdate";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaContextValue {
  offerInstall: boolean;
  requestInstall: () => Promise<void>;
}

const PwaContext = createContext<PwaContextValue | null>(null);

function runningStandalone(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(runningStandalone);
  const [guideOpen, setGuideOpen] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const environment = useMemo(
    () => detectInstallEnvironment(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    [],
  );

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setGuideOpen(false);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedsRefresh(true),
      onRegisteredSW: (_workerUrl, nextRegistration) => {
        setRegistration(nextRegistration ?? null);
      },
    });
  }, []);

  useEffect(() => {
    if (!registration) return;

    const checkForUpdate = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1_000);
    window.addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", checkForUpdate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [registration]);

  const requestInstall = useCallback(async () => {
    if (!installPrompt) {
      setGuideOpen(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setGuideOpen(true);
    }
  }, [installPrompt]);

  const applyUpdate = async () => {
    const pluginUpdate = updateServiceWorker.current;
    const waitingWorker = registration?.waiting ?? null;
    if (!pluginUpdate && !waitingWorker) {
      setUpdateError("업데이트 준비가 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setUpdating(true);
    setUpdateError("");
    try {
      await applyPwaUpdateLifecycle({
        activate: async () => {
          if (waitingWorker) {
            waitingWorker.postMessage({ type: "SKIP_WAITING" });
            return;
          }
          await pluginUpdate?.(false);
        },
        reload: () => window.location.reload(),
        subscribeToControllerChange: (listener) => {
          navigator.serviceWorker.addEventListener("controllerchange", listener, { once: true });
          return () => navigator.serviceWorker.removeEventListener("controllerchange", listener);
        },
        subscribeToWaitingStateChange: waitingWorker
          ? (listener) => {
              waitingWorker.addEventListener("statechange", listener);
              return () => waitingWorker.removeEventListener("statechange", listener);
            }
          : undefined,
        waitingState: waitingWorker ? () => waitingWorker.state : undefined,
      });
    } catch {
      setUpdateError("업데이트하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setUpdating(false);
    }
  };

  const contextValue = useMemo(
    () => ({
      offerInstall: !installed && (installPrompt !== null || environment !== "desktop"),
      requestInstall,
    }),
    [environment, installPrompt, installed, requestInstall],
  );

  return (
    <PwaContext.Provider value={contextValue}>
      {children}

      {needsRefresh && (
        <aside className="pwa-update-toast" role="status" aria-live="polite">
          <span className="pwa-update-toast__icon"><RefreshCw size={20} /></span>
          <div>
            <strong>새 버전이 준비됐어요</strong>
            <span>{updateError || "입력 중인 내용을 저장한 뒤 적용해 주세요."}</span>
          </div>
          <button
            type="button"
            className="pwa-update-toast__apply"
            disabled={updating}
            onClick={() => void applyUpdate()}
          >
            {updating ? "적용 중" : updateError ? "다시 시도" : "업데이트"}
          </button>
          <button
            type="button"
            className="pwa-update-toast__close"
            aria-label="업데이트 알림 닫기"
            onClick={() => {
              setNeedsRefresh(false);
              setUpdateError("");
            }}
          >
            <X size={18} />
          </button>
        </aside>
      )}

      {guideOpen && (
        <Modal
          title="홈 화면에 SCUTTA 설치"
          description="브라우저 종류에 맞게 한 번만 설정하면 앱처럼 실행할 수 있어요."
          onClose={() => setGuideOpen(false)}
        >
          <InstallGuide environment={environment} />
        </Modal>
      )}
    </PwaContext.Provider>
  );
}

function InstallGuide({ environment }: { environment: InstallEnvironment }) {
  if (environment === "kakao") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>카카오톡 안에서는 바로 설치할 수 없어요</strong>
            <span>카카오톡의 더보기 메뉴에서 ‘다른 브라우저로 열기’를 먼저 선택하세요.</span>
          </div>
        </div>
        <ol>
          <li>iPhone은 Safari, Android는 Chrome으로 이 페이지를 엽니다.</li>
          <li>iPhone은 공유 → 홈 화면에 추가 → 웹 앱으로 열기 → 추가를 누릅니다.</li>
          <li>Android는 ⋮ → 설치 및 바로가기 → 설치를 누릅니다.</li>
        </ol>
        <p>외부 브라우저나 설치된 앱에서 처음 한 번 다시 로그인해야 할 수 있습니다.</p>
      </div>
    );
  }

  if (environment === "ios") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <Smartphone size={20} />
          <div><strong>Safari에서 설치해 주세요</strong></div>
        </div>
        <ol>
          <li>Safari 하단의 공유 버튼을 누릅니다.</li>
          <li>‘홈 화면에 추가’를 선택합니다.</li>
          <li>‘웹 앱으로 열기’를 켜고 ‘추가’를 누릅니다.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="pwa-install-guide">
      <div className="pwa-install-guide__notice">
        <Smartphone size={20} />
        <div><strong>Chrome에서 설치해 주세요</strong></div>
      </div>
      <ol>
        <li>주소창 옆의 ⋮ 메뉴를 누릅니다.</li>
        <li>‘설치 및 바로가기’ 또는 ‘홈 화면에 추가’를 선택합니다.</li>
        <li>‘설치’를 누르면 홈 화면에 SCUTTA 아이콘이 생깁니다.</li>
      </ol>
    </div>
  );
}

export function PwaInstallButton({ className = "" }: { className?: string }) {
  const context = useContext(PwaContext);
  if (!context) throw new Error("PwaInstallButton must be used inside PwaProvider");
  if (!context.offerInstall) return null;

  const settingsButton = className === "settings-list__install";
  return (
    <button type="button" className={className} onClick={() => void context.requestInstall()}>
      {settingsButton ? (
        <span className="settings-list__icon"><Smartphone size={20} /></span>
      ) : (
        <Download size={19} />
      )}
      <span>홈 화면에 설치</span>
      {settingsButton && <ExternalLink size={18} />}
    </button>
  );
}
