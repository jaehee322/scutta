import { useEffect, useState } from "react";

import { apiRequest } from "../api/client";
import { settlementCategoryMeta } from "../lib/settlement";
import type { SettlementCategoryKey, SettlementDistributionResponse, SettlementTicketEntry } from "../types";
import { Modal } from "./Modal";
import { Notice } from "./Notice";

function TicketBar({ entry, viewerId, maxTickets }: {
  entry: SettlementTicketEntry;
  viewerId: number;
  maxTickets: number;
}) {
  const isMe = entry.player_id === viewerId;
  const width = maxTickets > 0 ? Math.min(100, entry.tickets / maxTickets * 100) : 0;
  return (
    <li className={`ticket-bar-row ${isMe ? "is-me" : ""}`}>
      <div className="ticket-bar-row__heading">
        <div className="ticket-bar-row__player">
          <span className="ticket-bar-row__rank">{entry.rank}위</span>
          <strong>{entry.username}</strong>
          {isMe && <small>나</small>}
        </div>
        <span className="ticket-bar-row__value">
          <strong>{entry.tickets}장</strong>
          <span>{entry.probability_percent.toFixed(1)}%</span>
        </span>
      </div>
      <div className="ticket-bar-row__track" aria-hidden="true">
        <i style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

export function SettlementDistributionModal({ category, viewerId, onClose }: {
  category: SettlementCategoryKey;
  viewerId: number;
  onClose: () => void;
}) {
  const meta = settlementCategoryMeta[category];
  const [data, setData] = useState<SettlementDistributionResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiRequest<SettlementDistributionResponse>(`/settlements/${category}/distribution`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "추첨권 분포를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, attempt]);

  const entries = data?.entries ?? [];
  const mine = entries.find((entry) => entry.player_id === viewerId);
  const displayed = entries.slice(0, visibleCount ?? 5);
  const separateMine = visibleCount === null && mine
    && !displayed.some((entry) => entry.player_id === viewerId) ? mine : null;
  const maxTickets = entries[0]?.tickets ?? 0;
  const progress = (data?.value ?? 0) % 10;

  return (
    <div className={`settlement-distribution-dialog settlement-distribution--${meta.color}`}>
      <Modal title={`${meta.label} 부문 추첨권`} onClose={onClose}>
        {loading && <p className="ticket-distribution-message" role="status">추첨권 분포를 불러오는 중이에요.</p>}
        {error && (
          <div className="ticket-distribution-error">
            <Notice>{error}</Notice>
            <button className="secondary-button" type="button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>
              다시 불러오기
            </button>
          </div>
        )}
        {data && (
          <div className="ticket-distribution-content">
            <section className="ticket-my-summary" aria-label="내 추첨권 요약">
              <p>{data.prize}</p>
              <div>
                <span>내 추첨권 <strong>{data.tickets}장</strong></span>
                <span>당첨 확률 <strong>{data.probability_percent.toFixed(1)}%</strong></span>
              </div>
              {mine && <small>추첨권 수 기준 {mine.rank}위 · 동점자는 같은 순위</small>}
              {data.tickets === 0 && <small>아직 내 추첨권이 없어요. 기록 10개마다 1장이 지급돼요.</small>}
            </section>

            <section aria-label="선수별 추첨권 분포" className="ticket-distribution-chart">
              <header>
                <h3>선수별 추첨권</h3>
                <p>추첨권 보유 <strong>{data.holder_count}명</strong> · 전체 <strong>{data.total_tickets}장</strong></p>
              </header>
              {entries.length === 0 ? (
                <p className="ticket-distribution-message">아직 이 부문의 추첨권을 가진 선수가 없어요.</p>
              ) : (
                <>
                  <p className="ticket-distribution-caption">막대는 최다 보유자의 추첨권 수를 기준으로 비교해요. 확률은 전체 추첨권 기준이에요.</p>
                  <h4>{visibleCount === null ? "상위 5명" : "전체 보유 선수"}</h4>
                  <ul className="ticket-bar-list" aria-label={visibleCount === null ? "추첨권 상위 선수" : "전체 추첨권 보유 선수"}>
                    {displayed.map((entry) => <TicketBar key={entry.player_id} entry={entry} viewerId={viewerId} maxTickets={maxTickets} />)}
                  </ul>
                  {separateMine && (
                    <div className="ticket-distribution-my-position">
                      <h4>내 위치</h4>
                      <ul className="ticket-bar-list" aria-label="내 추첨권 위치">
                        <TicketBar entry={separateMine} viewerId={viewerId} maxTickets={maxTickets} />
                      </ul>
                    </div>
                  )}
                  {entries.length > 5 && (
                    <div className="ticket-distribution-footer">
                      {visibleCount === null ? (
                        <button className="secondary-button" type="button" onClick={() => setVisibleCount(10)}>
                          전체 보기 ({data.holder_count}명)
                        </button>
                      ) : (
                        <>
                          <span role="status">{displayed.length} / {data.holder_count}명 표시</span>
                          {visibleCount < entries.length && (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => setVisibleCount((count) => Math.min((count ?? 0) + 10, entries.length))}
                            >
                              {Math.min(10, entries.length - visibleCount)}명 더보기
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <p className="ticket-distribution-caption">추첨권이 없는 선수는 그래프에 표시하지 않아요.</p>
                </>
              )}
            </section>

            <section className="ticket-progress" aria-label="다음 추첨권 진행도">
              <div className="ticket-progress__heading">
                <h3>다음 추첨권</h3>
                <strong>{progress} / 10</strong>
              </div>
              <div className="ticket-progress__steps" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => <i key={index} className={index < progress ? "is-filled" : ""} />)}
              </div>
              <p>내 기록 {data.value}{meta.unit} · 추첨권 {data.tickets}장 보유</p>
              <span>{10 - progress}{meta.unit} 누적 시 추첨권 1장이 추가돼요.</span>
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}
