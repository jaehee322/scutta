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
  updateAvailable: boolean;
  showUpdate: () => void;
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
  const [updateDismissed, setUpdateDismissed] = useState(false);
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
      onNeedRefresh: () => {
        setNeedsRefresh(true);
        setUpdateDismissed(false);
      },
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
    const resumeApp = () => {
      // Dismissing the notice lasts until the user returns to the app.
      setUpdateDismissed(false);
      checkForUpdate();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") resumeApp();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && document.visibilityState === "visible") resumeApp();
    };
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1_000);
    window.addEventListener("online", checkForUpdate);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", checkForUpdate);
      window.removeEventListener("pageshow", handlePageShow);
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
      updateAvailable: needsRefresh,
      showUpdate: () => setUpdateDismissed(false),
    }),
    [environment, installPrompt, installed, needsRefresh, requestInstall],
  );

  return (
    <PwaContext.Provider value={contextValue}>
      {children}

      {needsRefresh && !updateDismissed && (
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
              setUpdateDismissed(true);
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
  const isIos = environment === "ios" || environment === "kakao-ios";
  const isKakao = environment.startsWith("kakao");
  const showBoth = environment === "kakao";
  const isDesktop = environment === "desktop";

  return (
    <div className="pwa-install-guide">
      <div className="pwa-install-guide__notice">
        {isKakao ? <ExternalLink size={20} /> : <Smartphone size={20} />}
        <div>
          <strong>{isKakao ? "먼저 휴대폰 브라우저로 열어 주세요" : "홈 화면에서 SCUTTA를 바로 열 수 있어요"}</strong>
          <span>{isKakao
            ? "카카오톡 안에서는 설치 메뉴가 보이지 않을 수 있어요. 아이폰은 Safari, 안드로이드는 Chrome에서 진행해 주세요."
            : isDesktop
              ? "지금 보고 있는 사이트를 컴퓨터에서도 앱처럼 열 수 있어요."
              : "앱스토어에서 검색할 필요 없이, 지금 보고 있는 사이트를 홈 화면에 추가하면 돼요."}</span>
        </div>
      </div>

      {isKakao && (
        <div>
          <strong>카카오톡에서 브라우저로 이동하기</strong>
          <ol className="pwa-install-steps">
            <li>현재 화면의 <strong>더보기(⋯ 또는 ⋮)나 공유</strong> 메뉴를 누르세요.</li>
            <li><strong>다른 브라우저로 열기</strong> 또는 <strong>Safari로 열기</strong>가 보이면 선택하세요.</li>
            <li>해당 메뉴가 없으면 <strong>주소 복사</strong>를 선택한 뒤, Safari 또는 Chrome을 직접 열고 주소창에 붙여 넣으세요.</li>
          </ol>
        </div>
      )}

      {(isIos || showBoth) && (
        <div>
          <strong>아이폰 · 아이패드 — Safari</strong>
          <ol className="pwa-install-steps">
            <li>Safari에서 SCUTTA 페이지를 여세요.</li>
            <li>주소창 주변의 <strong>공유 <Share size={16} aria-hidden="true" /></strong> 버튼(네모에서 위로 화살표가 나오는 모양)을 누르세요. 바로 보이지 않으면 <strong>더보기(⋯) → 공유</strong>를 누르세요.</li>
            <li>공유 창의 메뉴 목록을 <strong>위로 쓸어 올려</strong> 아래쪽에 있는 <strong>홈 화면에 추가</strong>를 찾아 누르세요.</li>
            <li><strong>웹 앱으로 열기</strong>가 보이면 켠 상태로 두고, <strong>추가</strong>를 누르세요.</li>
            <li>홈 화면으로 돌아가 <strong>SCUTTA 아이콘</strong>을 눌러 실행하세요.</li>
          </ol>
          <p className="pwa-install-hint">‘홈 화면에 추가’가 없으면 공유 목록 맨 아래의 ‘동작 편집’에서 추가해 보세요. 다른 브라우저에서 메뉴를 찾기 어렵다면 주소를 복사해 Safari로 열어 주세요.</p>
        </div>
      )}

      {!isDesktop && (!isIos || showBoth) && (
        <div>
          <strong>갤럭시 · 안드로이드 — Chrome</strong>
          <ol className="pwa-install-steps">
            <li>Chrome에서 SCUTTA 페이지를 여세요.</li>
            <li>주소창 오른쪽의 <strong>더보기(⋮)</strong>를 누르세요.</li>
            <li><strong>설치 및 바로가기 만들기 → 설치</strong>를 선택하세요. 버전에 따라 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>로 표시될 수 있어요.</li>
            <li>확인 창에서 <strong>설치</strong> 또는 <strong>추가</strong>를 누른 뒤, 홈 화면이나 앱 목록의 <strong>SCUTTA 아이콘</strong>으로 실행하세요.</li>
          </ol>
          <p className="pwa-install-hint">메뉴가 보이지 않으면 페이지가 열린 뒤 잠시 기다려 주세요. 이미 설치했다면 홈 화면이나 앱 목록에서 SCUTTA를 찾아보세요. 삼성 인터넷 등에서 메뉴가 다르면 주소를 복사해 Chrome에서 진행할 수 있어요.</p>
        </div>
      )}

      {isDesktop && (
        <div>
          <strong>컴퓨터 — Chrome</strong>
          <ol className="pwa-install-steps">
            <li>Chrome에서 SCUTTA 페이지를 여세요.</li>
            <li>오른쪽 위 <strong>더보기(⋮) → 설치 및 바로가기 만들기 → 설치</strong>를 선택하세요. 주소창에 설치 버튼이 보이면 그 버튼을 눌러도 돼요.</li>
            <li>확인 창에서 <strong>설치</strong>를 누르세요. 설치 메뉴가 없으면 지금처럼 브라우저에서 이용할 수 있어요.</li>
          </ol>
        </div>
      )}

      <p className="pwa-install-hint">설치 후 로그인이 필요하면 기존 아이디와 비밀번호를 그대로 사용하세요. 기록은 같은 계정에 연결돼요. 경기 조회와 저장에는 인터넷 연결이 필요하며, 설치하지 않고 지금처럼 브라우저로 이용해도 돼요.</p>
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
      <span>{context.installButtonLabel}</span>
      {settingsButton && <ExternalLink size={18} />}
    </button>
  );
}

export function PwaUpdateButton() {
  const context = useContext(PwaContext);
  if (!context?.updateAvailable) return null;
  return (
    <button type="button" onClick={context.showUpdate}>
      <span className="settings-list__icon"><RefreshCw size={20} /></span>
      <div><strong>새 버전 업데이트 안내</strong></div>
      <ExternalLink size={18} />
    </button>
  );
}
