import {
  ArrowRight,
  CalendarDays,
  Check,
  Search,
  Swords,
  Trophy,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { ApiError, apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AccountSettings } from "../components/AccountSettings";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import { formatKoreanDate, getMatchPerspective, toMatchScore } from "../lib/match";
import { findPlayerByName, searchPlayers } from "../lib/playerSearch";
import type { MatchListResponse, PlayerSummary, PlayerWithStats } from "../types";

type Outcome = "win" | "loss";
type MatchScore = "3:0" | "2:1";

const statMeta = [
  { key: "matches", label: "경기", suffix: "판" },
  { key: "wins", label: "승리", suffix: "승" },
  { key: "losses", label: "패배", suffix: "패" },
  { key: "opponents", label: "만난 상대", suffix: "명" },
] as const;

export function HomePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<PlayerWithStats | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [matches, setMatches] = useState<MatchListResponse | null>(null);
  const [opponentQuery, setOpponentQuery] = useState("");
  const [selectedOpponentId, setSelectedOpponentId] = useState<number | null>(null);
  const [isOpponentListOpen, setIsOpponentListOpen] = useState(false);
  const [activeOpponentIndex, setActiveOpponentIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>("win");
  const [score, setScore] = useState<MatchScore>("3:0");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const opponentOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const load = useCallback(async () => {
    try {
      const [nextProfile, nextPlayers, nextMatches] = await Promise.all([
        apiRequest<PlayerWithStats>("/players/me"),
        apiRequest<PlayerSummary[]>("/players?exclude_self=true"),
        apiRequest<MatchListResponse>("/matches?limit=5"),
      ]);
      setProfile(nextProfile);
      setPlayers(nextPlayers);
      setMatches(nextMatches);
      setLoadError("");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const suggestedPlayers = useMemo(
    () => searchPlayers(players, opponentQuery),
    [opponentQuery, players],
  );
  const selectedOpponent = useMemo(
    () =>
      (selectedOpponentId === null
        ? findPlayerByName(players, opponentQuery)
        : players.find((player) => player.id === selectedOpponentId)),
    [opponentQuery, players, selectedOpponentId],
  );
  const showOpponentList = isOpponentListOpen && opponentQuery.trim().length > 0;

  useEffect(() => {
    if (!showOpponentList) return;
    opponentOptionRefs.current[activeOpponentIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeOpponentIndex, showOpponentList]);

  const selectOpponent = (player: PlayerSummary) => {
    setOpponentQuery(player.username);
    setSelectedOpponentId(player.id);
    setIsOpponentListOpen(false);
    setActiveOpponentIndex(0);
    setFormError("");
    setSuccess("");
  };

  const handleOpponentKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!suggestedPlayers.length) return;
      setIsOpponentListOpen(true);
      setActiveOpponentIndex((current) =>
        isOpponentListOpen ? (current + 1) % suggestedPlayers.length : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!suggestedPlayers.length) return;
      setIsOpponentListOpen(true);
      setActiveOpponentIndex((current) =>
        isOpponentListOpen
          ? (current - 1 + suggestedPlayers.length) % suggestedPlayers.length
          : suggestedPlayers.length - 1,
      );
      return;
    }

    if (event.key === "Enter" && showOpponentList && suggestedPlayers.length) {
      event.preventDefault();
      selectOpponent(suggestedPlayers[activeOpponentIndex] ?? suggestedPlayers[0]);
      return;
    }

    if (event.key === "Escape") {
      setIsOpponentListOpen(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!opponentQuery.trim()) {
      setFormError("상대 이름을 입력해 주세요.");
      return;
    }
    if (!selectedOpponent) {
      setFormError("검색 결과에서 선수를 선택해 주세요.");
      setIsOpponentListOpen(true);
      return;
    }

    const submittedScore = toMatchScore(outcome, score);
    const myScore = submittedScore.my_score;
    const opponentScore = submittedScore.opponent_score;
    const confirmed = window.confirm(
      `${selectedOpponent.username}님과의 경기를 ${myScore}:${opponentScore}로 기록할까요?\n제출 후에는 관리자만 수정할 수 있습니다.`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setFormError("");
    setSuccess("");
    try {
      await apiRequest("/matches", {
        method: "POST",
        body: jsonBody({ opponent_id: selectedOpponent.id, ...submittedScore }),
      });
      setSuccess(`${selectedOpponent.username}님과의 경기를 제출했습니다.`);
      setOpponentQuery("");
      setSelectedOpponentId(null);
      setIsOpponentListOpen(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setFormError("오늘은 이 상대와 이미 경기를 기록했어요.");
      } else {
        setFormError(caught instanceof Error ? caught.message : "경기를 기록하지 못했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoader />;

  if (loadError && !profile && !matches) {
    return (
      <div className="page home-page">
        <div className="card home-load-error">
          <Notice>{loadError}</Notice>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            다시 불러오기
          </button>
        </div>
        <AccountSettings />
      </div>
    );
  }

  return (
    <div className="page home-page">
      {loadError && <Notice>{loadError}</Notice>}
      <div className="home-grid">
        <section className="card submit-card">
          <header className="section-heading">
            <div className="section-icon section-icon--blue">
              <Swords size={22} />
            </div>
            <div>
              <h1>경기 결과 제출</h1>
            </div>
          </header>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="opponent-search">상대</label>
              <div
                className="opponent-combobox"
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setIsOpponentListOpen(false);
                  }
                }}
              >
                <div className="input-shell opponent-input-shell">
                  <Search size={20} />
                  <input
                    id="opponent-search"
                    type="search"
                    value={opponentQuery}
                    placeholder="선수 이름 입력"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showOpponentList}
                    aria-controls="opponent-suggestions"
                    aria-activedescendant={
                      showOpponentList && suggestedPlayers[activeOpponentIndex]
                        ? `opponent-option-${suggestedPlayers[activeOpponentIndex].id}`
                        : undefined
                    }
                    onFocus={() => setIsOpponentListOpen(opponentQuery.trim().length > 0)}
                    onChange={(event) => {
                      setOpponentQuery(event.target.value);
                      setSelectedOpponentId(null);
                      setIsOpponentListOpen(event.target.value.trim().length > 0);
                      setActiveOpponentIndex(0);
                      setFormError("");
                      setSuccess("");
                    }}
                    onKeyDown={handleOpponentKeyDown}
                  />
                </div>

                {showOpponentList && (
                  <div
                    id="opponent-suggestions"
                    className="opponent-suggestions"
                    role="listbox"
                    aria-label="선수 검색 결과"
                  >
                    {suggestedPlayers.length ? (
                      suggestedPlayers.map((player, index) => (
                        <button
                          type="button"
                          tabIndex={-1}
                          ref={(element) => {
                            opponentOptionRefs.current[index] = element;
                          }}
                          id={`opponent-option-${player.id}`}
                          role="option"
                          aria-selected={selectedOpponent?.id === player.id}
                          key={player.id}
                          className={`opponent-suggestion ${
                            index === activeOpponentIndex ? "is-active" : ""
                          }`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveOpponentIndex(index)}
                          onClick={() => selectOpponent(player)}
                        >
                          <span>
                            <strong>{player.username}</strong>
                            {player.club_rank !== null && <small>{player.club_rank}부</small>}
                          </span>
                          {selectedOpponent?.id === player.id && <Check size={16} />}
                        </button>
                      ))
                    ) : (
                      <p className="opponent-suggestions__empty">일치하는 선수가 없습니다.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <fieldset className="choice-group">
              <legend>경기 결과</legend>
              <div className="choice-grid">
                <button
                  type="button"
                  className={outcome === "win" ? "is-selected" : ""}
                  onClick={() => setOutcome("win")}
                  aria-pressed={outcome === "win"}
                >
                  <Trophy size={20} />
                  승리
                  {outcome === "win" && <Check className="choice-check" size={16} />}
                </button>
                <button
                  type="button"
                  className={outcome === "loss" ? "is-selected" : ""}
                  onClick={() => setOutcome("loss")}
                  aria-pressed={outcome === "loss"}
                >
                  <UsersRound size={20} />
                  패배
                  {outcome === "loss" && <Check className="choice-check" size={16} />}
                </button>
              </div>
            </fieldset>

            <fieldset className="choice-group">
              <legend>스코어</legend>
              <div className="score-choice">
                {(["3:0", "2:1"] as MatchScore[]).map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={score === option ? "is-selected" : ""}
                    onClick={() => setScore(option)}
                    aria-pressed={score === option}
                  >
                    <strong>{option}</strong>
                  </button>
                ))}
              </div>
            </fieldset>

            {formError && <Notice>{formError}</Notice>}
            {success && <Notice tone="success">{success}</Notice>}

            <button className="primary-button primary-button--large" disabled={submitting}>
              {submitting ? "제출 중" : "제출"}
              {!submitting && <ArrowRight size={20} />}
            </button>
            <p className="form-hint">같은 상대와는 하루 1경기만 기록할 수 있습니다.</p>
          </form>
        </section>

        <section className="card recent-card">
          <header className="card-title-row">
            <h2>최근 경기</h2>
            <Link to="/history" className="text-link">
              전체 <ArrowRight size={16} />
            </Link>
          </header>

          {!matches?.items.length ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <CalendarDays size={25} />
              </span>
              <strong>경기 기록이 없습니다.</strong>
            </div>
          ) : (
            <div className="match-list">
              {matches.items.map((match) => {
                const view = getMatchPerspective(match, user!.id);
                return (
                  <article className="match-row" key={match.id}>
                    <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                      {view.won ? "승" : "패"}
                    </span>
                    <div className="match-row__opponent">
                      <strong>{view.opponentName}</strong>
                      <span>{formatKoreanDate(match.played_on)}</span>
                    </div>
                    <div className="match-row__score" aria-label={`${view.myScore} 대 ${view.opponentScore}`}>
                      <strong>{view.myScore}</strong>
                      <span>:</span>
                      <strong>{view.opponentScore}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {profile && (
        <section className="stats-strip" aria-label="내 누적 기록">
          {statMeta.map(({ key, label, suffix }) => (
            <div key={key} className="stat-item">
              <span>{label}</span>
              <strong>
                {profile.stats[key]}
                <small>{suffix}</small>
              </strong>
            </div>
          ))}
        </section>
      )}

      <AccountSettings />
    </div>
  );
}
