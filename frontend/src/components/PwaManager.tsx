import { Download, ExternalLink, RefreshCw, Share, Smartphone, X } from "lucide-react";
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
  installButtonLabel: string;
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
      installButtonLabel: installPrompt ? "SCUTTA 앱 설치하기" : "SCUTTA 앱 설치 방법 보기",
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
          title="SCUTTA 앱 설치"
          onClose={() => setGuideOpen(false)}
        >
          <InstallGuide environment={environment} />
        </Modal>
      )}
    </PwaContext.Provider>
  );
}

function InstallGuide({ environment }: { environment: InstallEnvironment }) {
  if (environment === "kakao-android") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>Chrome으로 먼저 열어 주세요</strong>
            <span>카카오톡에서는 설치 메뉴가 보이지 않아요.</span>
          </div>
        </div>
        <InstallRoute
          items={["카카오톡 ⋮", "다른 브라우저로 열기", "Chrome ⋮", "설치"]}
        />
        <InstallHint>‘설치’가 없으면 ‘홈 화면에 추가’를 선택하세요.</InstallHint>
      </div>
    );
  }

  if (environment === "kakao-ios") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>Safari로 먼저 열어 주세요</strong>
            <span>카카오톡에서는 홈 화면에 추가할 수 없어요.</span>
          </div>
        </div>
        <InstallRoute
          items={[
            "카카오톡 공유/⋯",
            "Safari로 열기",
            { label: "공유", icon: "share" },
            "홈 화면에 추가",
            "추가",
          ]}
        />
        <InstallHint>‘웹 앱으로 열기’가 보이면 켜 주세요.</InstallHint>
      </div>
    );
  }

  if (environment === "ios") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <Share size={20} />
          <div>
            <strong>공유 버튼으로 추가하세요</strong>
            <span>Safari 또는 Chrome에서 진행할 수 있어요.</span>
          </div>
        </div>
        <InstallRoute
          items={[
            { label: "공유", icon: "share" },
            "홈 화면에 추가",
            "추가",
          ]}
        />
        <InstallHint>‘웹 앱으로 열기’가 보이면 켜 주세요.</InstallHint>
      </div>
    );
  }

  if (environment === "kakao") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>외부 브라우저로 열어 주세요</strong>
            <span>Android는 Chrome, iPhone은 Safari를 선택하세요.</span>
          </div>
        </div>
        <div className="pwa-install-platform-routes">
          <div>
            <strong>Android</strong>
            <InstallRoute items={["Chrome ⋮", "설치"]} />
          </div>
          <div>
            <strong>iPhone</strong>
            <InstallRoute
              items={[
                "Safari",
                { label: "공유", icon: "share" },
                "홈 화면에 추가",
                "추가",
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pwa-install-guide">
      <div className="pwa-install-guide__notice">
        <Smartphone size={20} />
        <div>
          <strong>Chrome 메뉴에서 설치하세요</strong>
          <span>설치 후에는 홈 화면에서 바로 열 수 있어요.</span>
        </div>
      </div>
      <InstallRoute items={["Chrome ⋮", "설치 및 바로가기 만들기", "설치"]} />
      <InstallHint>‘설치’가 없으면 ‘홈 화면에 추가’를 선택하세요.</InstallHint>
    </div>
  );
}

type InstallRouteItem = string | {
  label: string;
  icon: "share";
};

function InstallRoute({ items }: { items: InstallRouteItem[] }) {
  const labels = items.map((item) => typeof item === "string" ? item : item.label);
  return (
    <div className="pwa-install-route" aria-label={`설치 순서: ${labels.join(", ")}`}>
      {items.map((item, index) => (
        <span key={`${labels[index]}-${index}`}>
          {index > 0 && <b aria-hidden="true">→</b>}
          <em>
            {typeof item !== "string" && item.icon === "share" && (
              <Share size={15} aria-hidden="true" />
            )}
            {labels[index]}
          </em>
        </span>
      ))}
    </div>
  );
}

function InstallHint({ children }: { children: ReactNode }) {
  return <p className="pwa-install-hint">{children}</p>;
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
      <span>{context.installButtonLabel}</span>
      {settingsButton && <ExternalLink size={18} />}
    </button>
  );
}
