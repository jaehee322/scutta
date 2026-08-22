import { useEffect, useState } from "react";

import { apiRequest } from "../api/client";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import type { RankingCategory, SettlementResponse } from "../types";

const meta: Record<RankingCategory, { label: string; unit: string }> = {
  matches: { label: "경기 수", unit: "판" },
  wins: { label: "승리 수", unit: "승" },
  losses: { label: "패배 수", unit: "패" },
  opponents: { label: "상대 수", unit: "명" },
};

export function SettlementsPage() {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<SettlementResponse>("/settlements")
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "정산 정보를 불러오지 못했습니다."));
  }, []);

  if (!data && !error) return <PageLoader />;

  return (
    <div className="page">
      <header className="page-heading">
        <h1>정산</h1>
      </header>

      {error && <Notice>{error}</Notice>}

      {data && (
        <>
          <div className="settlement-grid">
            {data.categories.map((category) => {
              const categoryMeta = meta[category.category];
              return (
                <article className="settlement-card" key={category.category}>
                  <header>
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
                    <small>전체 {category.total_tickets}장 중 내 추첨권 기준</small>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="settlement-schedule" aria-labelledby="settlement-schedule-title">
            <h2 id="settlement-schedule-title">추첨 일정</h2>
            <div>
              {data.draws.map((draw, index) => (
                <span key={`${draw}-${index}`}>{index + 1}차 · {draw}</span>
              ))}
            </div>
          </section>

          <p className="settlement-note">
            각 부문 기록 10개마다 추첨권 1장이 지급되며 종강총회까지 누적됩니다.
          </p>
        </>
      )}
    </div>
  );
}
