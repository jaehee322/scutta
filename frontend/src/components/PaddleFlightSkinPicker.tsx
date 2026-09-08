import { Check, ChevronDown, LockKeyhole } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { PaddleFlightCosmetics, PaddleFlightEquipped } from "../types";
import { drawSkinPreview } from "../utils/paddleFlightRender";
import { DEFAULT_PADDLE_FLIGHT_EQUIPPED, PADDLE_FLIGHT_SKINS } from "../utils/paddleFlightSkins";

const categories = [
  { id: "background", name: "배경" },
  { id: "paddle", name: "탁구채" },
  { id: "ball", name: "탁구공" },
] as const;
const rarityNames = { default: "기본", common: "일반", rare: "희귀", legendary: "전설" };
const collectibleSkins = PADDLE_FLIGHT_SKINS.filter((skin) => skin.rarity !== "default");

export function PaddleSkinThumbnail({ skinId }: { skinId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) drawSkinPreview(canvasRef.current, skinId);
  }, [skinId]);
  return <canvas ref={canvasRef} className="paddle-skin-thumbnail" aria-hidden="true" draggable={false} onContextMenu={(event) => event.preventDefault()} />;
}

export function PaddleFlightSkinPicker({ inventory, loading, saving, onEquip, onReload }: {
  inventory: PaddleFlightCosmetics | null;
  loading: boolean;
  saving: boolean;
  onEquip: (equipped: PaddleFlightEquipped) => void;
  onReload: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const [category, setCategory] = useState<keyof PaddleFlightEquipped>("background");
  const equipped = inventory?.equipped ?? DEFAULT_PADDLE_FLIGHT_EQUIPPED;
  const owned = new Set(inventory?.owned ?? Object.values(DEFAULT_PADDLE_FLIGHT_EQUIPPED));
  const collected = collectibleSkins.filter((skin) => owned.has(skin.id)).length;

  return (
    <section className="paddle-skin-picker" aria-label="탁구공 날리기 스킨 선택">
      <button
        type="button"
        className="paddle-skin-toggle"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{isOpen ? "스킨 닫기" : "스킨 열기"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={contentId} className="paddle-skin-picker__content" hidden={!isOpen}>
        {isOpen && (
          <>
            <header>
              <h3>내 스킨</h3>
              <span>{loading ? "불러오는 중" : saving ? "선택 저장 중" : `수집 ${collected} / ${collectibleSkins.length}`}</span>
            </header>
            <p>보물상자에 닿으면 무작위 스킨을 얻어요. 희귀·전설 스킨은 드물게 나오며 중복될 수 있어요.</p>
            <div className="segmented-control" role="group" aria-label="스킨 종류">
              {categories.map((item) => (
                <button key={item.id} type="button" className={category === item.id ? "is-active" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
            <div className="paddle-skin-grid">
              {PADDLE_FLIGHT_SKINS.filter((skin) => skin.category === category).map((skin) => {
                const unlocked = owned.has(skin.id);
                const selected = equipped[skin.category] === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    className={`paddle-skin-option ${selected ? "is-selected" : ""} ${!unlocked ? "is-locked" : ""}`}
                    disabled={!unlocked || !inventory || saving}
                    aria-pressed={selected}
                    aria-label={`${skin.name}, ${rarityNames[skin.rarity]}${unlocked ? selected ? ", 선택됨" : ", 선택" : ", 아직 미보유"}`}
                    onClick={() => {
                      if (!selected) onEquip({ ...equipped, [skin.category]: skin.id });
                    }}
                  >
                    <PaddleSkinThumbnail skinId={skin.id} />
                    <span className="paddle-skin-option__name">{skin.name}</span>
                    <span className={`paddle-skin-rarity paddle-skin-rarity--${skin.rarity}`}>{rarityNames[skin.rarity]}</span>
                    <span className="paddle-skin-option__status">
                      {selected ? <><Check size={12} /> 사용 중</> : unlocked ? "보유" : <><LockKeyhole size={12} /> 미보유</>}
                    </span>
                  </button>
                );
              })}
            </div>
            {!inventory && !loading && <button type="button" className="secondary-button" onClick={onReload}>스킨 다시 불러오기</button>}
            <small>공 크기·속도·충돌 판정은 모든 스킨이 같아요.</small>
          </>
        )}
      </div>
    </section>
  );
}
