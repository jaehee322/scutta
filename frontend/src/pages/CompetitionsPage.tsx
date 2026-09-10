import { ChevronRight, Info, Plus, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CompetitionRulesModal } from "../components/CompetitionRulesModal";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import {
  competitionProgress,
  competitionStatusLabel,
  competitionTypeLabel,
  splitCompetitions,
} from "../lib/competition";
import type { CompetitionSummary } from "../types";
import { useCompetitionRefresh } from "../lib/useCompetitionRefresh";

export function CompetitionsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<CompetitionSummary[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const requestVersion = useRef(0);

  const requestItems = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    const path = user?.role === "admin" ? "/admin/competitions" : "/competitions";
    const nextItems = await apiRequest<CompetitionSummary[]>(path, { signal });
    return version === requestVersion.current && !signal?.aborted ? nextItems : null;
  }, [user?.role]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextItems = await requestItems();
      if (nextItems) setItems(nextItems);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "리그전을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [requestItems]);

  useCompetitionRefresh(async (signal) => {
    const nextItems = await requestItems(signal);
    if (nextItems && !document.body.classList.contains("modal-open")) setItems(nextItems);
  }, { enabled: items !== null && !loading });

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  const groups = useMemo(() => splitCompetitions(items ?? []), [items]);
  const heading = (
    <header className="competition-page-heading">
      <h1>리그전</h1>
      <div className="competition-page-actions">
        {user?.role === "admin" && (
          <Link className="primary-button" to="/admin/competitions/new">
            <Plus size={18} /> 생성
          </Link>
        )}
        <button
          className="icon-button competition-info-button"
          type="button"
          aria-label="리그전 진행 방식과 순위 안내"
          aria-haspopup="dialog"
          aria-expanded={showRules}
          onClick={() => setShowRules(true)}
        ><Info size={23} aria-hidden="true" /></button>
      </div>
    </header>
  );

  if (loading && !items) return <PageLoader />;

  if (!items) {
    return (
      <div className="page">
        {heading}
        <div className="page-load-error">
          <Notice>{error || "리그전을 불러오지 못했습니다."}</Notice>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "불러오는 중" : "다시 불러오기"}
          </button>
        </div>
        {showRules && <CompetitionRulesModal onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  return (
    <div className="page">
      {heading}

      {error && (
        <div className="page-load-error">
          <Notice>{error}</Notice>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "불러오는 중" : "다시 불러오기"}
          </button>
        </div>
      )}
      {showRules && <CompetitionRulesModal onClose={() => setShowRules(false)} />}

      {!items.length ? (
        <div className="empty-state competition-empty-state">
          <span className="empty-state__icon"><Trophy size={24} /></span>
          <strong>등록된 리그전이 없습니다</strong>
        </div>
      ) : (
        <div className="competition-sections">
          <CompetitionSection title="진행 중" items={groups.ongoing} />
          <CompetitionSection title="종료" items={groups.closed} />
        </div>
      )}
    </div>
  );
}

function CompetitionSection({ title, items }: { title: string; items: CompetitionSummary[] }) {
  return (
    <section className="competition-section">
      <div className="competition-section__heading">
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      {!items.length ? (
        <div className="competition-section__empty">없음</div>
      ) : (
        <div className="competition-card-grid">
          {items.map((item) => <CompetitionCard key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function CompetitionCard({ item }: { item: CompetitionSummary }) {
  const progress = competitionProgress(item);
  return (
    <Link
      className={`competition-card is-${item.status} ${item.is_participant ? "is-participant" : ""}`}
      to={`/competitions/${item.id}`}
    >
      <div className="competition-card__topline">
        <span className="competition-type-badge">{competitionTypeLabel[item.type]}</span>
        <span className={`competition-status-badge is-${item.status}`}>
          {competitionStatusLabel[item.status]}
        </span>
      </div>
      <div className="competition-card__title">
        <h3>{item.name}</h3>
        <ChevronRight size={20} />
      </div>
      <div className="competition-progress-copy">
        <span>경기</span>
        <strong>{item.completed_count} / {item.total_count}</strong>
      </div>
      <div
        className="competition-progress"
        role="progressbar"
        aria-label={`${item.name} 진행률`}
        aria-valuemin={0}
        aria-valuemax={item.total_count}
        aria-valuenow={item.completed_count}
      >
        <i style={{ width: `${progress}%` }} />
      </div>
    </Link>
  );
}
