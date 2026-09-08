export type PaddleFlightSkinCategory = "background" | "paddle" | "ball";
export type PaddleFlightSkinRarity = "default" | "common" | "rare" | "legendary";

export interface PaddleFlightSkin {
  readonly id: string;
  readonly category: PaddleFlightSkinCategory;
  readonly name: string;
  readonly description: string;
  readonly rarity: PaddleFlightSkinRarity;
}

export interface PaddleFlightEquipped {
  readonly background: string;
  readonly paddle: string;
  readonly ball: string;
}

export const DEFAULT_PADDLE_FLIGHT_EQUIPPED: PaddleFlightEquipped = {
  background: "bg_classic",
  paddle: "paddle_classic",
  ball: "ball_classic",
};

export const PADDLE_FLIGHT_SKINS = [
  { id: "bg_classic", category: "background", name: "맑은 코트", description: "익숙한 하늘빛 코트와 산뜻한 라인.", rarity: "default" },
  { id: "paddle_classic", category: "paddle", name: "클래식 러버", description: "붉은 러버와 검은 러버, 따뜻한 나무 손잡이.", rarity: "default" },
  { id: "ball_classic", category: "ball", name: "클래식 탁구공", description: "작은 주황 표식이 새겨진 아이보리 탁구공.", rarity: "default" },

  { id: "bg_dawn", category: "background", name: "살구빛 새벽", description: "부드러운 햇살과 겹겹의 새벽 안개.", rarity: "common" },
  { id: "bg_mint", category: "background", name: "민트 정원", description: "옅은 초록빛과 잎사귀 그림자가 머무는 코트.", rarity: "common" },
  { id: "bg_coast", category: "background", name: "푸른 해안", description: "잔잔한 물결과 흰 구름이 펼쳐진 해안.", rarity: "common" },
  { id: "bg_sakura", category: "background", name: "벚꽃 바람", description: "연분홍 꽃잎이 봄빛 하늘을 천천히 건너는 코트.", rarity: "common" },
  { id: "paddle_cobalt", category: "paddle", name: "코발트 스트라이프", description: "푸른 러버 위를 가로지르는 은빛 사선.", rarity: "common" },
  { id: "paddle_jade", category: "paddle", name: "비취 물결", description: "깊은 초록 러버에 새긴 유려한 물결.", rarity: "common" },
  { id: "paddle_coral", category: "paddle", name: "산호 도트", description: "산호빛 러버의 촘촘한 돌기와 구릿빛 테두리.", rarity: "common" },
  { id: "paddle_maple", category: "paddle", name: "단풍 러버", description: "붉은 러버에 새긴 금빛 단풍잎과 섬세한 잎맥.", rarity: "common" },
  { id: "ball_tangerine", category: "ball", name: "귤빛 스핀", description: "따뜻한 주황 구면을 감싸는 크림색 곡선.", rarity: "common" },
  { id: "ball_mint", category: "ball", name: "민트 리본", description: "민트빛 탁구공을 두른 산뜻한 흰 리본.", rarity: "common" },
  { id: "ball_sky", category: "ball", name: "하늘 구름", description: "작은 흰 구름을 품은 하늘빛 탁구공.", rarity: "common" },
  { id: "ball_berry", category: "ball", name: "베리 소다", description: "베리빛 구면에 맺힌 작고 투명한 소다 방울.", rarity: "common" },

  { id: "bg_aurora", category: "background", name: "오로라 베일", description: "보랏빛과 민트빛 장막이 스며든 하늘.", rarity: "rare" },
  { id: "bg_midnight", category: "background", name: "달빛 코트", description: "푸른 밤하늘 아래 달과 고요한 별빛.", rarity: "rare" },
  { id: "bg_glacier", category: "background", name: "빙하 호수", description: "겹겹의 얼음 봉우리와 은은하게 빛나는 호수.", rarity: "rare" },
  { id: "paddle_carbon", category: "paddle", name: "카본 위브", description: "검푸른 탄소 섬유의 섬세한 교차 무늬.", rarity: "rare" },
  { id: "paddle_amethyst", category: "paddle", name: "자수정 컷", description: "빛을 나누는 보랏빛 보석 면과 은빛 테두리.", rarity: "rare" },
  { id: "paddle_titanium", category: "paddle", name: "티타늄 링", description: "차분한 금속 광택 위로 겹쳐진 정교한 은빛 링.", rarity: "rare" },
  { id: "ball_pearl", category: "ball", name: "오팔 진주", description: "분홍과 푸른 빛이 은은하게 겹치는 진주.", rarity: "rare" },
  { id: "ball_obsidian", category: "ball", name: "흑요석", description: "은빛 윤곽 안에 날카로운 광택을 품은 검은 구슬.", rarity: "rare" },
  { id: "ball_lagoon", category: "ball", name: "라군 물결", description: "청록빛 수면처럼 굽이치는 물결과 작은 반짝임.", rarity: "rare" },

  { id: "bg_cosmos", category: "background", name: "별의 궤도", description: "먼 성운과 행성의 궤도가 펼쳐진 우주.", rarity: "legendary" },
  { id: "paddle_imperial", category: "paddle", name: "황금 왕관", description: "왕관과 월계수 문양을 새긴 짙은 남빛 러버.", rarity: "legendary" },
  { id: "ball_solar", category: "ball", name: "태양 코어", description: "황금빛 구면 안에서 부드럽게 굽이치는 불꽃.", rarity: "legendary" },
] as const satisfies readonly PaddleFlightSkin[];
