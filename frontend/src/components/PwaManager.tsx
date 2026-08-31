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
  if (environment === "kakao-android") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>카카오톡에서 Chrome으로 먼저 이동하세요</strong>
            <span>카카오톡 인앱 브라우저에는 PWA 설치 메뉴가 표시되지 않습니다.</span>
          </div>
        </div>
        <InstallRoute items={["카카오톡 ⋮", "다른 브라우저로 열기", "Chrome", "설치"]} />
        <ol className="pwa-install-steps">
          <InstallStep
            title="카카오톡 오른쪽 아래의 ⋮를 누릅니다"
            detail="버전에 따라 ‘더보기’ 아이콘으로 표시될 수 있습니다."
          />
          <InstallStep
            title="‘다른 브라우저로 열기’를 누릅니다"
            detail="앱 선택 화면이 나오면 Chrome을 선택합니다."
          />
          <InstallStep
            title="Chrome 오른쪽 위의 ⋮를 누릅니다"
            detail="SCUTTA 페이지가 Chrome에서 열린 것을 먼저 확인하세요."
          />
          <InstallStep
            title="‘설치 및 바로가기 만들기’를 누릅니다"
            detail="메뉴 이름이 다르면 ‘홈 화면에 추가’를 누르세요."
          />
          <InstallStep
            title="다음 화면에서 ‘설치’를 누릅니다"
            detail="확인창이 한 번 더 나오면 다시 ‘설치’를 누르세요. 완료되면 홈 화면에 SCUTTA 아이콘이 생깁니다."
          />
        </ol>
        <InstallTip>‘바로가기 만들기’만 선택하면 Chrome 바로가기로 열릴 수 있으므로 ‘설치’를 선택하세요.</InstallTip>
      </div>
    );
  }

  if (environment === "kakao-ios") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>카카오톡에서 Safari 또는 Chrome으로 이동하세요</strong>
            <span>외부 브라우저의 공유 메뉴에서 홈 화면에 추가할 수 있습니다.</span>
          </div>
        </div>
        <InstallRoute items={["카카오톡 공유", "브라우저로 열기", "홈 화면에 추가"]} />
        <ol className="pwa-install-steps">
          <InstallStep
            title="카카오톡 하단의 공유 또는 ⋯를 누릅니다"
            detail="카카오톡 버전에 따라 아이콘 위치와 모양이 다를 수 있습니다."
          />
          <InstallStep
            title="‘Safari로 열기’ 또는 ‘다른 브라우저로 열기’를 누릅니다"
            detail="선택 화면이 나오면 Safari나 Chrome을 고르세요. 항목이 없으면 링크를 복사해 브라우저 주소창에 붙여넣습니다."
          />
          <InstallStep
            title="열린 브라우저에서 공유 버튼을 누릅니다"
            detail="위쪽 화살표가 있는 사각형 아이콘입니다. Chrome에서는 주소창 오른쪽에 있습니다."
          />
          <InstallStep
            title="아래로 내려 ‘홈 화면에 추가’를 누릅니다"
            detail="보이지 않으면 목록 맨 아래 ‘동작 편집’에서 추가할 수 있습니다."
          />
          <InstallStep
            title="‘웹 앱으로 열기’가 보이면 켠 뒤 ‘추가’를 누릅니다"
            detail="이 옵션이 없는 iOS 버전에서는 바로 오른쪽 위의 ‘추가’를 누르세요."
          />
        </ol>
        <InstallTip>외부 브라우저나 설치된 SCUTTA 앱에서 처음 한 번 다시 로그인해야 할 수 있습니다.</InstallTip>
      </div>
    );
  }

  if (environment === "ios") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <Smartphone size={20} />
          <div>
            <strong>Safari 또는 Chrome에서 홈 화면에 추가하세요</strong>
            <span>설치 후에는 브라우저 메뉴 없이 앱처럼 실행됩니다.</span>
          </div>
        </div>
        <InstallRoute items={["공유", "홈 화면에 추가", "추가"]} />
        <ol className="pwa-install-steps">
          <InstallStep
            title="브라우저의 공유 버튼을 누릅니다"
            detail="Safari는 도구 막대, Chrome은 주소창 오른쪽의 위쪽 화살표가 있는 사각형 아이콘입니다."
          />
          <InstallStep
            title="목록을 아래로 내려 ‘홈 화면에 추가’를 누릅니다"
            detail="보이지 않으면 목록 맨 아래 ‘동작 편집’에서 추가하세요."
          />
          <InstallStep
            title="‘웹 앱으로 열기’를 켭니다"
            detail="이 옵션이 표시되지 않는 iOS 버전에서는 이 단계를 건너뜁니다."
          />
          <InstallStep
            title="오른쪽 위의 ‘추가’를 누릅니다"
            detail="홈 화면에 생긴 SCUTTA 아이콘으로 실행하세요."
          />
        </ol>
      </div>
    );
  }

  if (environment === "kakao") {
    return (
      <div className="pwa-install-guide">
        <div className="pwa-install-guide__notice">
          <ExternalLink size={20} />
          <div>
            <strong>먼저 외부 브라우저로 열어주세요</strong>
            <span>Android는 Chrome, iPhone은 Safari를 선택합니다.</span>
          </div>
        </div>
        <ol className="pwa-install-steps">
          <InstallStep title="카카오톡의 공유 또는 ⋮ 메뉴를 누릅니다" />
          <InstallStep title="‘다른 브라우저로 열기’ 또는 ‘Safari로 열기’를 누릅니다" />
          <InstallStep
            title="Android는 Chrome 메뉴에서 ‘설치’를 누릅니다"
            detail="⋮ → 설치 및 바로가기 만들기 → 설치 순서입니다."
          />
          <InstallStep
            title="iPhone은 Safari 공유 메뉴에서 추가합니다"
            detail="공유 → 홈 화면에 추가 → 웹 앱으로 열기 → 추가 순서입니다."
          />
        </ol>
      </div>
    );
  }

  return (
    <div className="pwa-install-guide">
      <div className="pwa-install-guide__notice">
        <Smartphone size={20} />
        <div>
          <strong>Chrome에서 SCUTTA를 설치하세요</strong>
          <span>Chrome의 설치 메뉴를 이용하면 홈 화면에서 앱처럼 실행할 수 있습니다.</span>
        </div>
      </div>
      <InstallRoute items={["Chrome ⋮", "설치 및 바로가기 만들기", "설치"]} />
      <ol className="pwa-install-steps">
        <InstallStep title="Chrome 오른쪽 위의 ⋮를 누릅니다" />
        <InstallStep
          title="‘설치 및 바로가기 만들기’를 누릅니다"
          detail="일부 버전에서는 ‘홈 화면에 추가’로 표시될 수 있습니다."
        />
        <InstallStep title="‘설치’를 선택합니다" />
        <InstallStep
          title="확인창에서 다시 ‘설치’를 누릅니다"
          detail="완료되면 홈 화면에 SCUTTA 아이콘이 생깁니다."
        />
      </ol>
    </div>
  );
}

function InstallRoute({ items }: { items: string[] }) {
  return (
    <div className="pwa-install-route" aria-label={`설치 순서: ${items.join(", ")}`}>
      {items.map((item, index) => (
        <span key={item}>
          {index > 0 && <b aria-hidden="true">→</b>}
          <em>{item}</em>
        </span>
      ))}
    </div>
  );
}

function InstallStep({ title, detail }: { title: string; detail?: string }) {
  return (
    <li>
      <div>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </li>
  );
}

function InstallTip({ children }: { children: ReactNode }) {
  return <p className="pwa-install-guide__tip"><strong>참고</strong><span>{children}</span></p>;
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
