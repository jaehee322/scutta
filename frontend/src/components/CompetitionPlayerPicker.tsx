import { Plus, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import type { UserRead } from "../types";

interface CompetitionPlayerPickerProps {
  players: UserRead[];
  selectedIds: number[];
  label: string;
  maxPlayers: number;
  locked: boolean;
  disabled: boolean;
  unavailableIds?: ReadonlySet<number>;
  onAdd: (playerId: number) => void;
  onRemove: (playerId: number) => void;
}

export function CompetitionPlayerPicker({
  players,
  selectedIds,
  label,
  maxPlayers,
  locked,
  disabled,
  unavailableIds,
  onAdd,
  onRemove,
}: CompetitionPlayerPickerProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  const results = useMemo(() => normalizedQuery
    ? players.filter((player) => player.username.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    : [], [players, normalizedQuery]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const full = selectedIds.length >= maxPlayers;

  return (
    <div className="competition-player-picker">
      {!locked && (
        <>
          <div className="input-shell competition-player-search">
            <Search size={19} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              aria-label={`${label} 검색`}
              aria-controls={normalizedQuery ? resultsId : undefined}
              value={query}
              disabled={disabled}
              placeholder="선수 이름 검색"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Search/IME Enter must not submit the competition form.
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </div>
          {normalizedQuery && (
            <div className="competition-player-results" id={resultsId} aria-label={`${label} 검색 결과`}>
              {results.length ? results.map((player) => {
                const reason = selectedIds.includes(player.id)
                  ? "선택됨"
                  : unavailableIds?.has(player.id)
                    ? "다른 팀에 편성됨"
                    : full ? "정원 도달" : "";
                return (
                  <button
                    className="competition-player-result"
                    type="button"
                    key={player.id}
                    disabled={disabled || Boolean(reason)}
                    aria-label={`${player.username} 추가${reason ? ` (${reason})` : ""}`}
                    onClick={() => {
                      onAdd(player.id);
                      setQuery("");
                      searchRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    <span className="competition-player-name"><strong>{player.username}</strong>{player.club_rank !== null && <small>{player.club_rank}부</small>}</span>
                    {reason ? <span className="competition-player-reason">{reason}</span> : <Plus size={18} aria-hidden="true" />}
                  </button>
                );
              }) : <p className="competition-player-hint">검색 결과가 없습니다.</p>}
            </div>
          )}
        </>
      )}

      {selectedIds.length ? (
        <ul className="competition-player-selected" aria-label={`${label} 선택 목록`}>
          {selectedIds.map((id) => {
            const player = playersById.get(id);
            const username = player?.username ?? `선수 #${id}`;
            return (
              <li className="competition-player-row" key={id}>
                <span className="competition-player-name"><strong>{username}</strong>{player?.club_rank != null && <small>{player.club_rank}부</small>}</span>
                {!locked && (
                  <button
                    className="competition-player-remove"
                    type="button"
                    disabled={disabled}
                    aria-label={`${username} 제외`}
                    onClick={() => {
                      onRemove(id);
                      searchRef.current?.focus({ preventScroll: true });
                    }}
                  ><X size={18} aria-hidden="true" /></button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <div className="competition-player-empty">{locked ? "선택한 선수가 없습니다." : "위에서 선수를 검색해 추가해 주세요."}</div>}
      {!locked && full && <p className="competition-player-hint" role="status">최대 {maxPlayers}명을 선택했습니다. 변경하려면 선수를 먼저 제외해 주세요.</p>}
    </div>
  );
}
