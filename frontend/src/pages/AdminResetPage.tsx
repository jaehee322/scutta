import { ArrowLeft, CircleDot, Coins, DatabaseZap, Gamepad2, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import type {
  DatabaseResetPreview,
  DatabaseResetResponse,
  MinigameResetGame,
  MinigameResetPreview,
  MinigameResetResponse,
} from "../types";

const MINIGAME_RESET_OPTIONS = [
  {
    game: "coin-flip",
    title: "동전 던지기",
    description: "연승·최고 기록과 오늘의 플레이 횟수가 모두 삭제됩니다.",
    icon: Coins,
  },
  {
    game: "paddle-flight",
    title: "탁구공 날리기",
    description: "모든 선수의 최고 점수와 랭킹 기록이 삭제됩니다.",
    icon: CircleDot,
  },
] as const;

interface MinigameResetFormState {
  confirmation: string;
  password: string;
  error: string;
  success: string;
  submitting: boolean;
}

const emptyMinigameResetForm = (): MinigameResetFormState => ({
  confirmation: "",
  password: "",
  error: "",
  success: "",
  submitting: false,
});

export function AdminResetPage() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<DatabaseResetPreview | null>(null);
  const [selectedMinigame, setSelectedMinigame] = useState<MinigameResetGame | null>(null);
  const [minigamePreviews, setMinigamePreviews] = useState<
    Partial<Record<MinigameResetGame, MinigameResetPreview>>
  >({});
  const [minigamePreviewError, setMinigamePreviewError] = useState("");
  const [minigamePreviewsLoading, setMinigamePreviewsLoading] = useState(true);
  const [minigameForms, setMinigameForms] = useState<
    Record<MinigameResetGame, MinigameResetFormState>
  >({
    "coin-flip": emptyMinigameResetForm(),
    "paddle-flight": emptyMinigameResetForm(),
  });
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<DatabaseResetPreview>("/admin/database/reset-preview")
      .then(setPreview)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "초기화 정보를 불러오지 못했습니다."),
      );
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all(
      MINIGAME_RESET_OPTIONS.map(({ game }) =>
        apiRequest<MinigameResetPreview>(`/admin/minigames/${game}/reset-preview`),
      ),
    )
      .then((previews) => {
        if (!active) return;
        setMinigamePreviews(
          Object.fromEntries(previews.map((gamePreview) => [gamePreview.game, gamePreview])),
        );
      })
      .catch((caught) => {
        if (!active) return;
        setMinigamePreviewError(
          caught instanceof Error
            ? caught.message
            : "미니게임 기록 정보를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setMinigamePreviewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateMinigameForm = (
    game: MinigameResetGame,
    changes: Partial<MinigameResetFormState>,
  ) => {
    setMinigameForms((current) => ({
      ...current,
      [game]: { ...current[game], ...changes },
    }));
  };

  const submitMinigameReset = async (event: FormEvent, game: MinigameResetGame) => {
    event.preventDefault();
    const gamePreview = minigamePreviews[game];
    const form = minigameForms[game];
    if (!gamePreview || form.submitting || form.confirmation !== gamePreview.confirmation_required) {
      return;
    }

    updateMinigameForm(game, { submitting: true, error: "", success: "" });
    try {
      const result = await apiRequest<MinigameResetResponse>(
        `/admin/minigames/${game}/reset`,
        {
          method: "POST",
          body: jsonBody({
            confirmation: form.confirmation,
            admin_password: form.password,
          }),
        },
      );
      setMinigamePreviews((current) => ({
        ...current,
        [game]: { ...gamePreview, record_count: 0 },
      }));
      updateMinigameForm(game, {
        confirmation: "",
        password: "",
        success: result.message,
      });
    } catch (caught) {
      updateMinigameForm(game, {
        error: caught instanceof Error ? caught.message : "미니게임 기록을 초기화하지 못했습니다.",
      });
    } finally {
      updateMinigameForm(game, { submitting: false });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await apiRequest<DatabaseResetResponse>("/admin/database/reset", {
        method: "POST",
        body: jsonBody({ confirmation, admin_password: password }),
      });
      window.alert(`${result.deleted.players}명의 선수, ${result.deleted.competitions}개의 대회와 ${result.deleted.matches}개의 경기를 삭제했습니다.`);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "초기화하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!preview && !error) return <PageLoader />;

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 홈
      </Link>
      <header className="admin-page-heading">
        <div>
          <h1>데이터 초기화</h1>
          <p>삭제할 데이터의 범위를 선택하세요.</p>
        </div>
      </header>

      <section className="admin-reset-section" aria-labelledby="minigame-reset-title">
        <div className="section-heading">
          <div className="section-icon section-icon--blue"><Gamepad2 size={22} /></div>
          <div><h2 id="minigame-reset-title">미니게임 기록 초기화</h2></div>
        </div>

        <div className="reset-warning reset-warning--minigame">
          <ShieldAlert size={24} />
          <div>
            <strong>선택한 게임의 모든 기록이 영구 삭제돼요</strong>
            <p>선수 계정과 다른 미니게임 기록은 유지됩니다.</p>
          </div>
        </div>

        {minigamePreviewError && <Notice>{minigamePreviewError}</Notice>}

        <div className="minigame-reset-grid">
          {MINIGAME_RESET_OPTIONS.map((option) => {
            const gamePreview = minigamePreviews[option.game];
            const GameIcon = option.icon;

            return (
              <article className="minigame-reset-card card" key={option.game}>
                <header className="minigame-reset-card__header">
                  <span><GameIcon size={21} /></span>
                  <div>
                    <h3>{option.title}</h3>
                    <p>{option.description}</p>
                  </div>
                  <div className="minigame-reset-card__count" aria-label={`저장된 기록 ${gamePreview?.record_count ?? 0}개`}>
                    <span>저장된 기록</span>
                    <strong>{gamePreview ? `${gamePreview.record_count}개` : "-"}</strong>
                  </div>
                </header>
                <button
                  type="button"
                  className="secondary-button minigame-reset-card__select"
                  onClick={() => setSelectedMinigame(option.game)}
                  disabled={!gamePreview || gamePreview.record_count === 0}
                >
                  {!gamePreview
                    ? minigamePreviewsLoading ? "기록 확인 중" : "정보를 불러오지 못함"
                    : gamePreview.record_count === 0 ? "초기화할 기록 없음" : "이 기록 초기화"}
                </button>
              </article>
            );
          })}
        </div>

        {selectedMinigame && (() => {
          const option = MINIGAME_RESET_OPTIONS.find(({ game }) => game === selectedMinigame);
          const gamePreview = minigamePreviews[selectedMinigame];
          const form = minigameForms[selectedMinigame];
          if (!option || !gamePreview) return null;
          const isReady = Boolean(
            form.confirmation === gamePreview.confirmation_required && form.password,
          );

          return (
            <form
              className="minigame-reset-confirmation card"
              onSubmit={(event) => void submitMinigameReset(event, selectedMinigame)}
            >
              <div className="minigame-reset-confirmation__heading">
                <div>
                  <h3>{option.title} 기록 삭제</h3>
                  <p>이 게임의 저장된 기록 {gamePreview.record_count}개만 삭제합니다.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSelectedMinigame(null)}
                  disabled={form.submitting}
                >
                  취소
                </button>
              </div>

              {form.error && <Notice>{form.error}</Notice>}
              {form.success && <Notice tone="success">{form.success}</Notice>}

              <div className="minigame-reset-confirmation__fields">
                <label className="field">
                  <span>아래 문구를 그대로 입력하세요</span>
                  <code>{gamePreview.confirmation_required}</code>
                  <input
                    value={form.confirmation}
                    onChange={(event) => updateMinigameForm(selectedMinigame, {
                      confirmation: event.target.value,
                      error: "",
                      success: "",
                    })}
                    disabled={form.submitting || gamePreview.record_count === 0}
                    required
                  />
                </label>
                <label className="field">
                  <span>현재 관리자 비밀번호</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(event) => updateMinigameForm(selectedMinigame, {
                      password: event.target.value,
                      error: "",
                      success: "",
                    })}
                    minLength={4}
                    disabled={form.submitting || gamePreview.record_count === 0}
                    required
                  />
                </label>
              </div>
              <button
                className="danger-button danger-button--large"
                disabled={!isReady || form.submitting || gamePreview.record_count === 0}
              >
                {form.submitting ? "초기화하는 중" : `${option.title} 기록 초기화`}
              </button>
            </form>
          );
        })()}
      </section>

      {preview && (
        <section className="admin-reset-section admin-reset-section--database" aria-labelledby="database-reset-title">
          <div className="section-heading">
            <div className="section-icon section-icon--red"><DatabaseZap size={22} /></div>
            <div><h2 id="database-reset-title">학기 데이터 전체 초기화</h2></div>
          </div>

          {error && <Notice>{error}</Notice>}

          <section className="reset-warning">
            <ShieldAlert size={28} />
            <div>
              <strong>이 작업은 되돌릴 수 없어요</strong>
              <p>관리자 계정과 관리자 로그인 세션, 상품 설정은 유지됩니다.</p>
            </div>
          </section>

          <section className="reset-counts">
            <div><span>경기</span><strong>{preview.matches}</strong></div>
            <div><span>선수</span><strong>{preview.players}</strong></div>
            <div><span>대회</span><strong>{preview.competitions}</strong></div>
            <div><span>선수 세션</span><strong>{preview.player_sessions}</strong></div>
          </section>

          <form className="reset-form card" onSubmit={submit}>
            <div className="section-heading">
              <div className="section-icon section-icon--red"><DatabaseZap size={22} /></div>
              <div><h2>최종 확인</h2></div>
            </div>
            <label className="field">
              <span>아래 문구를 그대로 입력하세요</span>
              <code>{preview.confirmation_required}</code>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            </label>
            <label className="field">
              <span>현재 관리자 비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={4}
                required
              />
            </label>
            <button
              className="danger-button danger-button--large"
              disabled={submitting || confirmation !== preview.confirmation_required}
            >
              {submitting ? "초기화하는 중" : "모든 선수·대회·경기 데이터 삭제"}
            </button>
          </form>
        </section>
      )}

      {!preview && error && <Notice>{error}</Notice>}
    </div>
  );
}
