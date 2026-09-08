import { ChevronRight, Gift } from "lucide-react";
import { useEffect, useState } from "react";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import { SettlementDistributionModal } from "../components/SettlementDistributionModal";
import { settlementCategoryMeta, settlementCategoryOrder } from "../lib/settlement";
import type { SettlementCategoryKey, SettlementResponse } from "../types";

export function SettlementsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<SettlementCategoryKey | null>(null);

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
            {settlementCategoryOrder.map((categoryKey) => {
              const category = data.categories.find(({ category: key }) => key === categoryKey);
              if (!category) return null;

              const categoryMeta = settlementCategoryMeta[categoryKey];
              return (
                <article className={`settlement-card settlement-card--${categoryMeta.color}`} key={categoryKey}>
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
                  <button
                    type="button"
                    className="settlement-card__open"
                    aria-haspopup="dialog"
                    aria-label={`${categoryMeta.label} 부문, ${category.prize}, 내 기록 ${category.value}${categoryMeta.unit}, 추첨권 ${category.tickets}장, 당첨 확률 ${category.probability_percent.toFixed(1)}%, 추첨권 분포 보기`}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setSelectedCategory(categoryKey);
                    }}
                  >
                    추첨권 분포 보기 <ChevronRight size={16} aria-hidden="true" />
                  </button>
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
      {selectedCategory && user && (
        <SettlementDistributionModal
          key={`${selectedCategory}-${user.id}`}
          category={selectedCategory}
          viewerId={user.id}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
}
