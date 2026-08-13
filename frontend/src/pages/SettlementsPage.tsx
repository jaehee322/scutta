import { CalendarCheck2, Gift, Sparkles, TicketCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "../api/client";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import type { RankingCategory, SettlementResponse } from "../types";

const meta: Record<RankingCategory, { label: string; unit: string; color: string }> = {
  matches: { label: "경기 수", unit: "판", color: "blue" },
  wins: { label: "승리 수", unit: "승", color: "green" },
  losses: { label: "패배 수", unit: "패", color: "orange" },
  opponents: { label: "상대 수", unit: "명", color: "purple" },
};

export function SettlementsPage() {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<SettlementResponse>("/settlements")
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "정산 정보를 불러오지 못했습니다."));
  }, []);

  const totalTickets = useMemo(
    () => data?.categories.reduce((sum, category) => sum + category.tickets, 0) ?? 0,
    [data],
  );

  if (!data && !error) return <PageLoader />;

  return (
    <div className="page settlement-page">
      <header className="page-heading">
        <span className="eyebrow">LUCKY DRAW</span>
        <h1>내 추첨권과 당첨 확률</h1>
        <p>모든 기록은 학기 동안 차곡차곡 누적돼요.</p>
      </header>

      {error && <Notice>{error}</Notice>}

      {data && (
        <>
          <section className="ticket-hero">
            <div className="ticket-hero__icon">
              <TicketCheck size={28} />
            </div>
            <div>
              <span>지금까지 모은 추첨권</span>
              <strong>
                {totalTickets}<small>장</small>
              </strong>
              <p>각 부문의 기록 10개마다 추첨권 1장이 생겨요.</p>
            </div>
            <Sparkles className="ticket-hero__sparkle" size={72} />
          </section>

          <section className="draw-schedule" aria-label="추첨 일정">
            <div className="section-heading">
              <div className="section-icon section-icon--blue">
                <CalendarCheck2 size={21} />
              </div>
              <div>
                <span>추첨 일정</span>
                <h2>이번 학기 두 번의 기회</h2>
              </div>
            </div>
            <div className="draw-timeline">
              {data.draws.map((draw, index) => (
                <div className="draw-timeline__item" key={draw}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{draw}</strong>
                    <small>{index === 0 ? "1차 추첨" : "최종 추첨"}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="settlement-grid">
            {data.categories.map((category) => {
              const categoryMeta = meta[category.category];
              return (
                <article className={`settlement-card settlement-card--${categoryMeta.color}`} key={category.category}>
                  <header>
                    <span className="settlement-card__icon">
                      <Gift size={21} />
                    </span>
                    <div>
                      <span>{categoryMeta.label} 부문</span>
                      <strong>{category.prize}</strong>
                    </div>
                  </header>

                  <div className="settlement-metrics">
                    <div>
                      <span>내 기록</span>
                      <strong>{category.value}<small>{categoryMeta.unit}</small></strong>
                    </div>
                    <div>
                      <span>추첨권</span>
                      <strong>{category.tickets}<small>장</small></strong>
                    </div>
                  </div>

                  <div className="probability-row">
                    <div>
                      <span>당첨 확률</span>
                      <strong>{category.probability_percent.toFixed(1)}%</strong>
                    </div>
                    <div className="probability-track" aria-hidden="true">
                      <i style={{ width: `${Math.min(category.probability_percent, 100)}%` }} />
                    </div>
                    <small>전체 {category.total_tickets}장 중 내 추첨권 기준</small>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="info-banner">
            <span>꼭 알아두세요</span>
            <p>중간 추첨 이후에도 기록과 추첨권은 초기화되지 않고 종강총회까지 계속 누적돼요.</p>
          </aside>
        </>
      )}
    </div>
  );
}
