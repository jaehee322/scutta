import {
  PADDLE_FLIGHT_WORLD,
  type PaddleFlightPaddleGeometry,
  type PaddleFlightState,
  createInitialPaddleFlightState,
  getPaddleFlightPaddleGeometry,
} from "./paddleFlight";
import {
  DEFAULT_PADDLE_FLIGHT_EQUIPPED,
  PADDLE_FLIGHT_SKINS,
  type PaddleFlightEquipped,
} from "./paddleFlightSkins";

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function drawPaddleHandle(
  context: CanvasRenderingContext2D,
  paddle: PaddleFlightPaddleGeometry,
  fromTop: boolean,
) {
  const [neckLeft, neckRight, buttRight] = paddle.handleBody;
  if (!neckLeft || !neckRight || !buttRight) return;
  const direction = fromTop ? 1 : -1;
  const handleGradient = context.createLinearGradient(
    paddle.handleButt.x - paddle.handleButt.radius,
    0,
    paddle.handleButt.x + paddle.handleButt.radius,
    0,
  );
  handleGradient.addColorStop(0, "#65351f");
  handleGradient.addColorStop(0.16, "#a85e35");
  handleGradient.addColorStop(0.43, "#e1a069");
  handleGradient.addColorStop(0.62, "#f0bd82");
  handleGradient.addColorStop(0.84, "#a95d34");
  handleGradient.addColorStop(1, "#5f311d");

  context.save();
  context.beginPath();
  context.moveTo(neckLeft.x, neckLeft.y);
  context.lineTo(neckRight.x, neckRight.y);
  context.lineTo(buttRight.x, buttRight.y);
  context.arc(
    paddle.handleButt.x,
    paddle.handleButt.y,
    paddle.handleButt.radius,
    0,
    fromTop ? Math.PI : -Math.PI,
    !fromTop,
  );
  context.closePath();
  context.fillStyle = handleGradient;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#5d321f";
  context.stroke();

  context.save();
  context.clip();
  const neckY = neckLeft.y;
  const buttY = paddle.handleButt.y;
  const middleY = (neckY + buttY) / 2;
  context.globalAlpha = 0.34;
  context.strokeStyle = "#fff0cf";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(paddle.handleButt.x - 4, neckY + direction * 5);
  context.quadraticCurveTo(
    paddle.handleButt.x - 6,
    middleY,
    paddle.handleButt.x - 5,
    buttY + direction * (paddle.handleButt.radius - 3),
  );
  context.stroke();

  context.globalAlpha = 0.3;
  context.strokeStyle = "#67351f";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(paddle.handleButt.x + 4, neckY + direction * 8);
  context.quadraticCurveTo(
    paddle.handleButt.x + 6,
    middleY,
    paddle.handleButt.x + 7,
    buttY + direction * (paddle.handleButt.radius - 5),
  );
  context.stroke();
  context.restore();
  context.restore();
}

function drawPaddleHead(
  context: CanvasRenderingContext2D,
  paddle: PaddleFlightPaddleGeometry,
  fromTop: boolean,
) {
  const { head } = paddle;
  const rimGradient = context.createLinearGradient(
    head.x - head.radius,
    head.y,
    head.x + head.radius,
    head.y,
  );
  rimGradient.addColorStop(0, "#6a351e");
  rimGradient.addColorStop(0.3, "#d68e54");
  rimGradient.addColorStop(0.52, "#f1bf7e");
  rimGradient.addColorStop(0.78, "#b56538");
  rimGradient.addColorStop(1, "#5d2e1b");
  const faceGradient = context.createRadialGradient(
    head.x - 12,
    head.y - 12,
    4,
    head.x,
    head.y,
    head.radius,
  );
  if (fromTop) {
    faceGradient.addColorStop(0, "#ff747a");
    faceGradient.addColorStop(0.56, "#d93442");
    faceGradient.addColorStop(1, "#921b28");
  } else {
    faceGradient.addColorStop(0, "#555b63");
    faceGradient.addColorStop(0.5, "#1d2025");
    faceGradient.addColorStop(1, "#050607");
  }

  context.save();
  context.beginPath();
  context.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
  context.fillStyle = rimGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#552c1c";
  context.stroke();

  context.beginPath();
  context.arc(head.x, head.y, head.radius - 4.5, 0, Math.PI * 2);
  context.fillStyle = faceGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = fromTop ? "#781722" : "#020304";
  context.stroke();

  context.beginPath();
  context.arc(
    head.x,
    head.y,
    head.radius - 10,
    Math.PI * 1.08,
    Math.PI * 1.68,
  );
  context.strokeStyle = fromTop ? "#ffffff45" : "#ffffff30";
  context.lineWidth = 2;
  context.stroke();

  context.beginPath();
  context.arc(head.x + 13, head.y + 19, 2.1, 0, Math.PI * 2);
  context.fillStyle = fromTop ? "#ffd7d84f" : "#ffffff35";
  context.fill();
  context.restore();
}

function drawBall(context: CanvasRenderingContext2D, state: PaddleFlightState) {
  const { ball } = state;
  const velocityRatio = Math.max(-0.55, Math.min(0.85, ball.velocityY / 520));

  if (state.status === "playing") {
    context.save();
    for (let index = 3; index >= 1; index -= 1) {
      context.beginPath();
      context.arc(
        ball.x - index * 8,
        ball.y - velocityRatio * index * 5,
        Math.max(2, ball.radius - index * 2.7),
        0,
        Math.PI * 2,
      );
      context.globalAlpha = 0.08 * (4 - index);
      context.fillStyle = "#69809b";
      context.fill();
    }
    context.restore();
  }

  context.save();
  context.translate(ball.x, ball.y);
  context.rotate(velocityRatio * 0.42);

  context.beginPath();
  context.arc(2, 3, ball.radius + 1, 0, Math.PI * 2);
  context.fillStyle = "#17202c24";
  context.filter = "blur(3px)";
  context.fill();
  context.filter = "none";

  const ballGradient = context.createRadialGradient(
    -ball.radius * 0.42,
    -ball.radius * 0.48,
    1,
    0,
    0,
    ball.radius * 1.25,
  );
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.62, "#f8f7f1");
  ballGradient.addColorStop(1, "#d8d8d2");
  context.beginPath();
  context.arc(0, 0, ball.radius, 0, Math.PI * 2);
  context.fillStyle = ballGradient;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#aeb4ba";
  context.stroke();

  context.beginPath();
  context.arc(3.8, -3.2, 1.25, 0, Math.PI * 2);
  context.fillStyle = "#e66c45";
  context.fill();
  context.restore();
}

function drawClassicPaddleFlight(
  canvas: HTMLCanvasElement,
  state: PaddleFlightState,
  chests: readonly PaddleFlightChestSprite[],
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = PADDLE_FLIGHT_WORLD;
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#e8f7ff");
  background.addColorStop(0.58, "#f5fbff");
  background.addColorStop(1, "#eef8f5");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.34;
  context.strokeStyle = "#9fc9df";
  context.lineWidth = 1;
  const drift = (state.elapsedSeconds * 26) % 56;
  for (let x = -56 - drift; x < width + 56; x += 56) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 90, height);
    context.stroke();
  }
  context.globalAlpha = 0.22;
  context.strokeStyle = "#5cbca4";
  context.setLineDash([8, 12]);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.restore();

  for (const obstacle of state.obstacles) {
    // Keep the stroke visible until the entire paddle is outside the canvas.
    if (obstacle.x + obstacle.width < -2 || obstacle.x > width + 2) continue;
    const topPaddle = getPaddleFlightPaddleGeometry(obstacle, true);
    const bottomPaddle = getPaddleFlightPaddleGeometry(obstacle, false);
    drawPaddleHandle(context, topPaddle, true);
    drawPaddleHandle(context, bottomPaddle, false);
    drawPaddleHead(context, topPaddle, true);
    drawPaddleHead(context, bottomPaddle, false);
  }

  drawChests(context, chests, pixelRatio);
  drawBall(context, state);

  context.save();
  context.strokeStyle = "#ffffffb8";
  context.lineWidth = 2;
  roundedRectangle(context, 1, 1, width - 2, height - 2, 20);
  context.stroke();
  context.restore();
}

export interface PaddleFlightChestSprite {
  readonly id: number;
  /** Chest center, in world coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const EMPTY_CHESTS: readonly PaddleFlightChestSprite[] = [];
const TAU = Math.PI * 2;
type CanvasCache = Map<string, HTMLCanvasElement>;
const backgroundCache: CanvasCache = new Map();
const materialCache: CanvasCache = new Map();
const previewSizes = new WeakMap<HTMLCanvasElement, { width: number; height: number }>();

interface BackgroundTheme {
  colors: readonly [string, string, string];
  guide: string;
}

const BACKGROUNDS: Record<string, BackgroundTheme> = {
  bg_dawn: { colors: ["#f2d9d1", "#fff7ed", "#e5e6f2"], guide: "#b49bb0" },
  bg_mint: { colors: ["#d8eee3", "#f4faf0", "#d8ebe5"], guide: "#71a697" },
  bg_coast: { colors: ["#dcecf6", "#f5f9f8", "#d3e8e7"], guide: "#77aab7" },
  bg_sakura: { colors: ["#f3dfe8", "#fff6f0", "#ece5ef"], guide: "#b792a9" },
  bg_aurora: { colors: ["#d8e0ee", "#f0f5f8", "#dcebe8"], guide: "#94a4bc" },
  bg_midnight: { colors: ["#17243b", "#2c4056", "#263d4a"], guide: "#b9d3e6" },
  bg_glacier: { colors: ["#d3e4f3", "#eef9fc", "#bcdedb"], guide: "#759fb9" },
  bg_cosmos: { colors: ["#211f3d", "#424d6a", "#244154"], guide: "#c4c2e4" },
};

interface PaddleMaterial {
  top: readonly [string, string, string];
  bottom: readonly [string, string, string];
  rim: readonly [string, string, string];
  accent: string;
}

const PADDLES: Record<string, PaddleMaterial> = {
  paddle_cobalt: { top: ["#8ccaff", "#317acf", "#174775"], bottom: ["#699fdb", "#225b9b", "#173457"], rim: ["#677b91", "#e0edf4", "#8198ac"], accent: "#c8eaff" },
  paddle_jade: { top: ["#a1e6c6", "#348d72", "#18554c"], bottom: ["#70b89e", "#296b5a", "#17423c"], rim: ["#657b68", "#dce9c9", "#8b9d76"], accent: "#d1f4cc" },
  paddle_coral: { top: ["#ffc1a9", "#dc7869", "#984747"], bottom: ["#e39c8e", "#b65e5d", "#723a43"], rim: ["#915d49", "#f4d1a4", "#b27b60"], accent: "#ffe7c9" },
  paddle_maple: { top: ["#efb88c", "#bd624a", "#743931"], bottom: ["#d19474", "#974b3d", "#592c2b"], rim: ["#79513a", "#eaca91", "#b88754"], accent: "#f3d299" },
  paddle_carbon: { top: ["#8798ad", "#394b62", "#1b2636"], bottom: ["#6c7d95", "#2b3c53", "#131e2e"], rim: ["#536276", "#c5d4e1", "#6b7b92"], accent: "#9ab9d1" },
  paddle_amethyst: { top: ["#d8b8fb", "#9363bc", "#513879"], bottom: ["#b796dc", "#724c9b", "#38284f"], rim: ["#797087", "#f0e7fb", "#a398ba"], accent: "#efd7ff" },
  paddle_titanium: { top: ["#e3edf2", "#8396a5", "#374e61"], bottom: ["#b5c4cf", "#607486", "#293b4e"], rim: ["#526473", "#f3fafc", "#a2b5c4"], accent: "#e1f3f7" },
  paddle_imperial: { top: ["#69788e", "#2d415b", "#17263e"], bottom: ["#576579", "#27364e", "#101e32"], rim: ["#8b5b27", "#ffe4a2", "#c6974d"], accent: "#f4d68a" },
};

interface BallMaterial {
  colors: readonly [string, string, string];
  outline: string;
  accent: string;
}

const BALLS: Record<string, BallMaterial> = {
  ball_tangerine: { colors: ["#fff3ce", "#ffb646", "#d4651c"], outline: "#c27a35", accent: "#fff5dd" },
  ball_mint: { colors: ["#f3fff3", "#9fe5b8", "#379b86"], outline: "#5a9c86", accent: "#f5fff0" },
  ball_sky: { colors: ["#ffffff", "#9ed5ff", "#468ac7"], outline: "#6697bd", accent: "#ffffff" },
  ball_berry: { colors: ["#fff0f4", "#efa7c4", "#ab4e89"], outline: "#a7658c", accent: "#fff3f8" },
  ball_pearl: { colors: ["#ffffff", "#e7dbf5", "#9fbfc8"], outline: "#d8e4ec", accent: "#ffffff" },
  ball_obsidian: { colors: ["#dadbe5", "#545b74", "#141929"], outline: "#d0dbea", accent: "#e7e9ff" },
  ball_lagoon: { colors: ["#e9fff8", "#6bd6ce", "#237c99"], outline: "#438d9e", accent: "#e4fff7" },
  ball_solar: { colors: ["#fffbd8", "#ffcc49", "#dc6a18"], outline: "#ffe6a0", accent: "#fffbea" },
};

/** Cache only decorative pixels; game state and collision geometry stay outside. */
function cachedCanvas(
  cache: CanvasCache,
  key: string,
  width: number,
  height: number,
  ratio: number,
  paint: (context: CanvasRenderingContext2D) => void,
  maximumEntries = 24,
): HTMLCanvasElement | null {
  const cacheKey = `${key}:${width}:${height}:${ratio}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  paint(context);
  if (cache.size >= maximumEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, canvas);
  return canvas;
}

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, TAU);
}

function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, `${color.slice(0, 7)}00`);
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function paintBackground(context: CanvasRenderingContext2D, skinId: string, theme: BackgroundTheme) {
  const { width, height } = PADDLE_FLIGHT_WORLD;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.colors[0]);
  gradient.addColorStop(0.53, theme.colors[1]);
  gradient.addColorStop(1, theme.colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.save();

  if (skinId === "bg_dawn") {
    glow(context, 282, 136, 154, "#ffd495aa");
    circle(context, 282, 136, 31);
    context.fillStyle = "#fff2c8a3";
    context.fill();
    for (let index = 0; index < 3; index++) {
      const y = 378 + index * 48;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(110, y - 43, 238, y + 47, width, y - 7);
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.closePath();
      context.fillStyle = ["#d9bfd025", "#c2c6df28", "#b8bdd426"][index];
      context.fill();
    }
  } else if (skinId === "bg_mint") {
    glow(context, 76, 194, 178, "#fffdeaaa");
    for (let index = 0; index < 6; index++) {
      const left = index % 2 === 0;
      context.save();
      context.translate(left ? -4 : width + 4, 45 + index * 91);
      context.rotate(left ? -0.45 : 2.6);
      context.beginPath();
      context.moveTo(0, 0);
      context.bezierCurveTo(32, -29, 72, -27, 96, 0);
      context.bezierCurveTo(64, 26, 28, 28, 0, 0);
      context.fillStyle = "#81bba523";
      context.fill();
      context.beginPath();
      context.moveTo(0, 0);
      context.quadraticCurveTo(45, -4, 85, 0);
      context.strokeStyle = "#719b842b";
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    }
  } else if (skinId === "bg_coast") {
    glow(context, 80, 124, 142, "#ffffffc4");
    context.fillStyle = "#ffffff6b";
    for (const [x, y, radius] of [[64, 111, 18], [87, 102, 24], [112, 112, 16]]) {
      circle(context, x, y, radius);
      context.fill();
    }
    for (let index = 0; index < 5; index++) {
      const y = 365 + index * 37;
      context.beginPath();
      context.moveTo(-20, y);
      context.bezierCurveTo(78, y - 18, 246, y + 22, 385, y - 8);
      context.strokeStyle = index % 2 === 0 ? "#6baeb22a" : "#ffffff75";
      context.lineWidth = index % 2 === 0 ? 12 : 3;
      context.stroke();
    }
  } else if (skinId === "bg_sakura") {
    glow(context, 132, 186, 175, "#fff9e2a3");
    context.beginPath();
    context.moveTo(width + 8, 14);
    context.quadraticCurveTo(290, 31, 261, 125);
    context.strokeStyle = "#aa819b29";
    context.lineWidth = 3;
    context.stroke();
    for (const [x, y, size] of [[312, 49, 23], [277, 112, 19], [29, 371, 22], [55, 407, 15]]) {
      context.save();
      context.translate(x, y);
      for (let petal = 0; petal < 5; petal++) {
        context.rotate(TAU / 5);
        context.beginPath();
        context.moveTo(0, 0);
        context.bezierCurveTo(-size * 0.65, -size * 0.35, -size * 0.55, -size, 0, -size * 0.78);
        context.bezierCurveTo(size * 0.55, -size, size * 0.65, -size * 0.35, 0, 0);
        context.fillStyle = "#dfa3be56";
        context.fill();
        context.strokeStyle = "#ffffff79";
        context.lineWidth = 1;
        context.stroke();
      }
      circle(context, 0, 0, 3);
      context.fillStyle = "#e7bc8370";
      context.fill();
      context.restore();
    }
    for (const [x, y, angle] of [[103, 134, -0.6], [240, 241, 0.7], [74, 290, -0.2], [288, 413, 0.5]]) {
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.beginPath();
      context.moveTo(-7, 0);
      context.quadraticCurveTo(0, -9, 9, 0);
      context.quadraticCurveTo(0, 6, -7, 0);
      context.fillStyle = "#dbaaC34a";
      context.fill();
      context.restore();
    }
  } else if (skinId === "bg_glacier") {
    glow(context, 77, 99, 133, "#ffffffba");
    context.beginPath();
    context.moveTo(-30, 307);
    context.lineTo(76, 161);
    context.lineTo(163, 286);
    context.lineTo(241, 116);
    context.lineTo(392, 311);
    context.closePath();
    context.fillStyle = "#95bcd448";
    context.fill();
    for (const [peakX, peakY, leftX, rightX] of [[76, 161, -30, 163], [241, 116, 163, 392]]) {
      context.beginPath();
      context.moveTo(peakX, peakY);
      context.lineTo(peakX + 13, 304);
      context.lineTo(leftX, 307);
      context.closePath();
      context.fillStyle = "#f6ffff83";
      context.fill();
      context.beginPath();
      context.moveTo(peakX, peakY);
      context.lineTo(peakX + 20, peakY + 66);
      context.lineTo(peakX + (rightX - peakX) * 0.38, peakY + 69);
      context.closePath();
      context.fillStyle = "#ffffff94";
      context.fill();
    }
    for (let index = 0; index < 6; index++) {
      const y = 333 + index * 29;
      context.beginPath();
      context.moveTo(index % 2 === 0 ? -20 : 56, y);
      context.quadraticCurveTo(180, y - 7, width + 20, y + 2);
      context.strokeStyle = index % 2 === 0 ? "#eaffffb0" : "#83bcc537";
      context.lineWidth = index % 2 === 0 ? 2 : 7;
      context.stroke();
    }
  } else if (skinId === "bg_aurora") {
    glow(context, 282, 290, 207, "#f4dcff67");
    for (let index = 0; index < 3; index++) {
      const x = 45 + index * 101;
      const ribbon = context.createLinearGradient(x, 0, x, height);
      ribbon.addColorStop(0, index % 2 === 0 ? "#7ecbc252" : "#b48bdd42");
      ribbon.addColorStop(0.52, "#c5e9df13");
      ribbon.addColorStop(1, "#91a9d124");
      context.beginPath();
      context.moveTo(x - 28, -20);
      context.bezierCurveTo(x + 103, 172, x - 126, 340, x + 32, height + 20);
      context.lineTo(x + 93, height + 20);
      context.bezierCurveTo(x - 52, 320, x + 153, 175, x + 10, -20);
      context.closePath();
      context.fillStyle = ribbon;
      context.fill();
    }
  } else {
    const cosmos = skinId === "bg_cosmos";
    glow(context, cosmos ? 274 : 270, cosmos ? 138 : 100, cosmos ? 208 : 115, cosmos ? "#a398e936" : "#8ebce22e");
    if (cosmos) {
      const planet = context.createRadialGradient(327, 47, 14, 352, 22, 152);
      planet.addColorStop(0, "#b6bbdf27");
      planet.addColorStop(0.85, "#93b8d312");
      planet.addColorStop(1, "#cedcff3b");
      circle(context, 352, 22, 152);
      context.fillStyle = planet;
      context.fill();
      for (let index = 0; index < 2; index++) {
        context.beginPath();
        context.ellipse(245, 95, 152 + index * 25, 59 + index * 10, -0.45, 0, TAU);
        context.strokeStyle = "#d6cef32b";
        context.lineWidth = 1;
        context.stroke();
      }
      glow(context, 84, 468, 190, "#7ac6c728");
    } else {
      circle(context, 274, 107, 27);
      context.fillStyle = "#d9e8eea3";
      context.fill();
      circle(context, 284, 99, 25);
      context.fillStyle = "#25394e";
      context.fill();
    }
    for (let index = 0; index < (cosmos ? 26 : 15); index++) {
      const x = (index * 137 + 29) % width;
      const y = (index * 83 + 43) % height;
      circle(context, x, y, index % 5 === 0 ? 1.4 : 0.75);
      context.fillStyle = index % 3 === 0 ? "#eef5ff85" : "#d8e6f447";
      context.fill();
    }
  }
  context.restore();
}

function drawBackground(
  context: CanvasRenderingContext2D,
  state: PaddleFlightState,
  skinId: string,
  ratio: number,
) {
  const { width, height } = PADDLE_FLIGHT_WORLD;
  const theme = BACKGROUNDS[skinId];
  if (theme) {
    // Three full-size backgrounds bound the cache to about 9 MB at DPR 2.
    const asset = cachedCanvas(backgroundCache, skinId, width, height, ratio, (ctx) => paintBackground(ctx, skinId, theme), 3);
    if (asset) context.drawImage(asset, 0, 0, width, height);
    else paintBackground(context, skinId, theme);
  } else {
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#e8f7ff");
    background.addColorStop(0.58, "#f5fbff");
    background.addColorStop(1, "#eef8f5");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.save();
  context.globalAlpha = theme ? 0.14 : 0.34;
  context.strokeStyle = theme?.guide ?? "#9fc9df";
  context.lineWidth = 1;
  const drift = (state.elapsedSeconds * 26) % 56;
  for (let x = -56 - drift; x < width + 56; x += 56) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 90, height);
    context.stroke();
  }
  context.globalAlpha = theme ? 0.12 : 0.22;
  context.strokeStyle = theme?.guide ?? "#5cbca4";
  context.setLineDash([8, 12]);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.restore();
}

function paintPaddleHead(context: CanvasRenderingContext2D, skinId: string, fromTop: boolean, radius: number) {
  const material = PADDLES[skinId];
  const colors = fromTop ? material.top : material.bottom;
  const rim = context.createLinearGradient(-radius, 0, radius, 0);
  rim.addColorStop(0, material.rim[0]);
  rim.addColorStop(0.32, material.rim[2]);
  rim.addColorStop(0.52, material.rim[1]);
  rim.addColorStop(1, material.rim[0]);
  circle(context, 0, 0, radius);
  context.fillStyle = rim;
  context.fill();
  context.strokeStyle = material.rim[1];
  context.lineWidth = 1.5;
  context.stroke();
  const faceRadius = radius - 4.5;
  const face = context.createRadialGradient(-12, -12, 4, 0, 0, radius);
  face.addColorStop(0, colors[0]);
  face.addColorStop(0.56, colors[1]);
  face.addColorStop(1, colors[2]);
  circle(context, 0, 0, faceRadius);
  context.fillStyle = face;
  context.fill();
  context.strokeStyle = colors[2];
  context.lineWidth = 1.5;
  context.stroke();
  context.save();
  circle(context, 0, 0, faceRadius - 1);
  context.clip();

  if (skinId === "paddle_cobalt") {
    context.strokeStyle = "#e8f5ff45";
    for (const offset of [-20, 4, 28]) {
      context.beginPath();
      context.moveTo(-45, offset - 35);
      context.lineTo(45, offset + 35);
      context.lineWidth = offset === 4 ? 6 : 2;
      context.stroke();
    }
  } else if (skinId === "paddle_jade") {
    context.strokeStyle = "#e4ffe453";
    context.lineWidth = 2;
    for (let index = 0; index < 4; index++) {
      const y = -28 + index * 17;
      context.beginPath();
      context.moveTo(-42, y);
      context.bezierCurveTo(-12, y - 23, 9, y + 25, 42, y - 5);
      context.stroke();
    }
  } else if (skinId === "paddle_coral") {
    for (let row = -4; row <= 4; row++) {
      for (let column = -4; column <= 4; column++) {
        const x = column * 8 + (row % 2) * 4;
        const y = row * 8;
        circle(context, x, y + 0.6, 1.35);
        context.fillStyle = "#773b343e";
        context.fill();
        circle(context, x - 0.4, y - 0.5, 0.9);
        context.fillStyle = "#fff0d95c";
        context.fill();
      }
    }
  } else if (skinId === "paddle_carbon") {
    context.rotate(-0.5);
    for (let row = -7; row <= 7; row++) {
      for (let column = -7; column <= 7; column++) {
        context.fillStyle = (row + column) % 2 === 0 ? "#dbe8f124" : "#0713213b";
        context.fillRect(column * 6, row * 6, 5, 3);
      }
    }
  } else if (skinId === "paddle_amethyst") {
    for (let index = 0; index < 8; index++) {
      const angle = index * TAU / 8;
      context.beginPath();
      context.moveTo(-7, -9);
      context.lineTo(Math.cos(angle) * 40, Math.sin(angle) * 40);
      context.lineTo(Math.cos(angle + TAU / 8) * 40, Math.sin(angle + TAU / 8) * 40);
      context.closePath();
      context.fillStyle = index % 2 === 0 ? "#f7eaff27" : "#38235524";
      context.fill();
      context.strokeStyle = "#f2dcff24";
      context.lineWidth = 0.7;
      context.stroke();
    }
  } else if (skinId === "paddle_maple") {
    context.beginPath();
    context.moveTo(0, -25);
    for (const [x, y] of [[6, -10], [15, -16], [12, -4], [27, -7], [18, 5], [23, 9], [7, 14], [3, 24], [-2, 14], [-20, 10], [-16, 5], [-27, -5], [-13, -4], [-16, -16], [-6, -10]]) context.lineTo(x, y);
    context.closePath();
    const leaf = context.createLinearGradient(-15, -24, 18, 24);
    leaf.addColorStop(0, "#fff0b8d4");
    leaf.addColorStop(1, "#db9e57b0");
    context.fillStyle = leaf;
    context.fill();
    context.strokeStyle = "#713c2d70";
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.moveTo(0, -20);
    context.lineTo(1, 27);
    for (const [x, y] of [[-13, -10], [13, -10], [-19, 5], [18, 4]]) {
      context.moveTo(0, 8);
      context.lineTo(x, y);
    }
    context.strokeStyle = "#9f633b8a";
    context.lineWidth = 1.15;
    context.stroke();
  } else if (skinId === "paddle_titanium") {
    context.strokeStyle = "#effaff24";
    context.lineWidth = 0.7;
    for (let y = -32; y < 35; y += 5) {
      context.beginPath();
      context.moveTo(-40, y + 9);
      context.lineTo(40, y - 9);
      context.stroke();
    }
    for (const ring of [12, 22, 30]) {
      circle(context, 0, 0.7, ring);
      context.strokeStyle = "#243e5273";
      context.lineWidth = 2;
      context.stroke();
      circle(context, 0, -0.4, ring);
      context.strokeStyle = "#eefbffd6";
      context.lineWidth = 1;
      context.stroke();
    }
    for (let index = 0; index < 4; index++) {
      const angle = index * TAU / 4 + Math.PI / 4;
      circle(context, Math.cos(angle) * 26, Math.sin(angle) * 26, 1.4);
      context.fillStyle = "#263f539c";
      context.fill();
      circle(context, Math.cos(angle) * 26 - 0.3, Math.sin(angle) * 26 - 0.4, 0.7);
      context.fillStyle = "#edfaff";
      context.fill();
    }
  } else if (skinId === "paddle_imperial") {
    context.fillStyle = "#ecc976c7";
    context.beginPath();
    context.moveTo(-15, -7);
    context.lineTo(-10, 8);
    context.lineTo(10, 8);
    context.lineTo(15, -7);
    context.lineTo(6, -1);
    context.lineTo(0, -13);
    context.lineTo(-6, -1);
    context.closePath();
    context.fill();
    context.strokeStyle = "#ffe6aa";
    context.lineWidth = 1;
    context.stroke();
    context.fillRect(-10, 11, 20, 2);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 5; index++) {
        context.beginPath();
        context.ellipse(side * (22 - index * 1.8), 15 - index * 7, 2, 4, side * 0.5, 0, TAU);
        context.fill();
      }
    }
  }
  context.restore();
  context.beginPath();
  context.arc(0, 0, radius - 10, Math.PI * 1.08, Math.PI * 1.68);
  context.strokeStyle = "#ffffff66";
  context.lineWidth = 2;
  context.stroke();
  circle(context, 13, 19, 2.1);
  context.fillStyle = "#ffffff40";
  context.fill();
}

function drawSkinnedHead(context: CanvasRenderingContext2D, paddle: PaddleFlightPaddleGeometry, fromTop: boolean, skinId: string, ratio: number) {
  const { head } = paddle;
  const halfSize = head.radius + 2;
  const size = halfSize * 2;
  const asset = cachedCanvas(materialCache, `${skinId}:${fromTop}`, size, size, ratio, (ctx) => {
    ctx.translate(halfSize, halfSize);
    paintPaddleHead(ctx, skinId, fromTop, head.radius);
  });
  if (asset) context.drawImage(asset, head.x - halfSize, head.y - halfSize, size, size);
  else drawPaddleHead(context, paddle, fromTop);
}

function drawHandleAccent(context: CanvasRenderingContext2D, paddle: PaddleFlightPaddleGeometry, fromTop: boolean, skinId: string) {
  const neck = paddle.handleBody[0];
  if (!neck) return;
  const direction = fromTop ? 1 : -1;
  const y = neck.y + (paddle.handleButt.y - neck.y) * 0.62;
  context.save();
  context.fillStyle = PADDLES[skinId].accent;
  context.globalAlpha = 0.72;
  context.fillRect(paddle.handleButt.x - 8, y, 16, direction * 3);
  context.fillStyle = "#182233";
  context.globalAlpha = 0.22;
  context.fillRect(paddle.handleButt.x - 8, y + direction * 3, 16, direction);
  context.restore();
}

function paintBall(context: CanvasRenderingContext2D, skinId: string, radius: number) {
  const material = BALLS[skinId];
  const shadow = context.createRadialGradient(2, 4, radius * 0.3, 2, 4, radius + 3);
  shadow.addColorStop(0, "#15233835");
  shadow.addColorStop(1, "#15233800");
  circle(context, 2, 4, radius + 3);
  context.fillStyle = shadow;
  context.fill();
  const ball = context.createRadialGradient(-radius * 0.42, -radius * 0.48, 1, 0, 0, radius * 1.25);
  ball.addColorStop(0, material.colors[0]);
  ball.addColorStop(0.62, material.colors[1]);
  ball.addColorStop(1, material.colors[2]);
  circle(context, 0, 0, radius);
  context.fillStyle = ball;
  context.fill();
  context.lineWidth = 1.25;
  context.strokeStyle = material.outline;
  context.stroke();
  context.save();
  circle(context, 0, 0, radius - 0.6);
  context.clip();
  context.strokeStyle = material.accent;
  context.fillStyle = material.accent;
  if (skinId === "ball_tangerine" || skinId === "ball_mint") {
    context.lineWidth = skinId === "ball_mint" ? 3.1 : 1.6;
    context.globalAlpha = 0.73;
    context.beginPath();
    context.ellipse(1, -1, radius * 0.48, radius * 1.25, -0.65, 0, TAU);
    context.stroke();
    if (skinId === "ball_tangerine") {
      context.beginPath();
      context.arc(2, 1, radius * 0.53, -0.7, 1.1);
      context.lineWidth = 0.85;
      context.stroke();
    }
  } else if (skinId === "ball_sky") {
    context.globalAlpha = 0.84;
    for (const [x, y, r] of [[-5, 2, 2.9], [-1, 0.4, 3.7], [3, 2, 2.5]]) {
      circle(context, x, y, r);
      context.fill();
    }
  } else if (skinId === "ball_pearl") {
    for (let index = 0; index < 3; index++) {
      context.beginPath();
      context.ellipse(-3 + index * 4, 0, radius * 0.7, radius * 1.12, -0.55, 0, TAU);
      context.strokeStyle = ["#ecaecc70", "#9fe0d577", "#d0b6f270"][index];
      context.lineWidth = 2.4;
      context.stroke();
    }
  } else if (skinId === "ball_obsidian") {
    context.beginPath();
    context.moveTo(-10, -8);
    context.lineTo(2, -5);
    context.lineTo(-2, 10);
    context.closePath();
    context.fillStyle = "#e9e9ff40";
    context.fill();
    context.beginPath();
    context.moveTo(2, -5);
    context.lineTo(10, 4);
    context.lineTo(-2, 10);
    context.strokeStyle = "#e5effc78";
    context.lineWidth = 0.9;
    context.stroke();
  } else if (skinId === "ball_berry") {
    for (const [x, y, size] of [[-6, 0.5, 2.6], [-0.5, 6, 1.8], [6, 4.8, 1.55], [-1.5, -6.3, 1.2], [-7.4, 6, 0.9]]) {
      circle(context, x, y, size);
      context.fillStyle = "#fff4fb42";
      context.fill();
      context.strokeStyle = "#fff5facf";
      context.lineWidth = 0.65;
      context.stroke();
      circle(context, x - size * 0.28, y - size * 0.32, size * 0.22);
      context.fillStyle = "#ffffffc4";
      context.fill();
    }
  } else if (skinId === "ball_lagoon") {
    for (let index = 0; index < 3; index++) {
      const y = -1 + index * 5;
      context.beginPath();
      context.moveTo(-14, y);
      context.bezierCurveTo(-7, y - 6, 1, y + 5, 14, y - 3);
      context.strokeStyle = index === 1 ? "#286e946e" : "#e5fff2c2";
      context.lineWidth = index === 1 ? 2.1 : 1.35;
      context.stroke();
    }
    context.beginPath();
    context.moveTo(-4, -9);
    context.lineTo(-3.3, -6.7);
    context.lineTo(-1.1, -6);
    context.lineTo(-3.3, -5.3);
    context.lineTo(-4, -3);
    context.lineTo(-4.7, -5.3);
    context.lineTo(-6.9, -6);
    context.lineTo(-4.7, -6.7);
    context.closePath();
    context.fillStyle = "#f6fff1b8";
    context.fill();
  } else if (skinId === "ball_solar") {
    context.lineWidth = 2;
    context.strokeStyle = "#fff7cfbf";
    for (let index = 0; index < 3; index++) {
      const x = -7 + index * 6;
      context.beginPath();
      context.moveTo(x, 12);
      context.bezierCurveTo(x + 8, 4, x - 7, -1, x + 3, -12);
      context.stroke();
    }
  }
  context.restore();
  context.beginPath();
  context.arc(-1, -1, radius - 3, Math.PI * 1.08, Math.PI * 1.55);
  context.strokeStyle = "#ffffff9c";
  context.lineWidth = 1.2;
  context.stroke();
  circle(context, -3.5, -5.2, 1.25);
  context.fillStyle = "#fffffff0";
  context.fill();

  // Keep the small eye readable over every material pattern.
  const faceColor = skinId === "ball_obsidian" ? "#fff1d9" : "#49333b";
  const faceOutline = skinId === "ball_obsidian" ? "#303047" : "#fff5e6";
  circle(context, 3.8, -3.2, 1.25);
  context.strokeStyle = faceOutline;
  context.lineWidth = 0.65;
  context.stroke();
  context.fillStyle = faceColor;
  context.fill();
}

function drawSkinnedBall(context: CanvasRenderingContext2D, state: PaddleFlightState, skinId: string, ratio: number) {
  const { ball } = state;
  const velocityRatio = Math.max(-0.55, Math.min(0.85, ball.velocityY / 520));
  if (state.status === "playing") {
    context.save();
    for (let index = 3; index >= 1; index--) {
      circle(context, ball.x - index * 8, ball.y - velocityRatio * index * 5, Math.max(2, ball.radius - index * 2.7));
      context.globalAlpha = 0.08 * (4 - index);
      context.fillStyle = BALLS[skinId].colors[1];
      context.fill();
    }
    context.restore();
  }
  const halfSize = ball.radius + 8;
  const size = halfSize * 2;
  const asset = cachedCanvas(materialCache, skinId, size, size, ratio, (ctx) => {
    ctx.translate(halfSize, halfSize);
    paintBall(ctx, skinId, ball.radius);
  });
  if (!asset) {
    drawBall(context, { ...state, status: "ready" });
    return;
  }
  context.save();
  context.translate(ball.x, ball.y);
  context.rotate(velocityRatio * 0.42);
  context.drawImage(asset, -halfSize, -halfSize, size, size);
  context.restore();
}

function paintChest(context: CanvasRenderingContext2D) {
  // Every face fits the 32 × 28 center-based pickup rectangle.
  const body = context.createLinearGradient(0, -6, 0, 13);
  body.addColorStop(0, "#e65d4c");
  body.addColorStop(0.45, "#bd342c");
  body.addColorStop(1, "#782522");
  context.beginPath();
  context.moveTo(-15, -5);
  context.lineTo(9, -5);
  context.lineTo(9, 13);
  context.lineTo(-15, 10);
  context.closePath();
  context.fillStyle = body;
  context.fill();
  context.strokeStyle = "#682423";
  context.lineWidth = 1;
  context.stroke();
  context.beginPath();
  context.moveTo(-15, -5);
  context.lineTo(-9, -13);
  context.lineTo(15, -11);
  context.lineTo(9, -5);
  context.closePath();
  const lid = context.createLinearGradient(0, -13, 0, -4);
  lid.addColorStop(0, "#ff9981");
  lid.addColorStop(1, "#c84232");
  context.fillStyle = lid;
  context.fill();
  context.strokeStyle = "#762b22";
  context.stroke();
  context.beginPath();
  context.moveTo(9, -5);
  context.lineTo(15, -11);
  context.lineTo(15, 7);
  context.lineTo(9, 13);
  context.closePath();
  context.fillStyle = "#862925";
  context.fill();
  context.stroke();
  for (const x of [-10, 3]) {
    context.beginPath();
    context.moveTo(x, -5);
    context.lineTo(x + 6, -12.3 + (x + 10) * 0.08);
    context.lineTo(x + 9, -12.1 + (x + 10) * 0.08);
    context.lineTo(x + 3, -5);
    context.closePath();
    context.fillStyle = "#ffe19a";
    context.fill();
    context.fillStyle = "#d6a12f";
    context.fillRect(x, -4.5, 3, 15);
    context.fillStyle = "#ffe19a";
    context.fillRect(x, -4.5, 0.8, 14.5);
  }
  context.beginPath();
  context.moveTo(-15, -3);
  context.lineTo(9, -2);
  context.lineTo(15, -8);
  context.strokeStyle = "#f4c35f";
  context.lineWidth = 2;
  context.stroke();
  roundedRectangle(context, -3.8, -2.5, 6, 7, 1.2);
  context.fillStyle = "#ffe095";
  context.fill();
  context.strokeStyle = "#aa701d";
  context.lineWidth = 0.8;
  context.stroke();
  circle(context, -0.8, 0.3, 0.85);
  context.fillStyle = "#744c20";
  context.fill();
  context.fillRect(-1.25, 0.7, 0.9, 1.5);
  context.fillStyle = "#fff2c4";
  for (const x of [-8.5, 4.5]) {
    circle(context, x, 7.4, 0.75);
    context.fill();
  }
}

function drawChests(context: CanvasRenderingContext2D, chests: readonly PaddleFlightChestSprite[], ratio: number) {
  for (const chest of chests) {
    if (chest.x + chest.width / 2 < -2 || chest.x - chest.width / 2 > PADDLE_FLIGHT_WORLD.width + 2) continue;
    const asset = cachedCanvas(materialCache, "treasure-chest", 36, 32, ratio, (ctx) => {
      ctx.translate(18, 16);
      paintChest(ctx);
    });
    if (!asset) continue;
    const width = chest.width * 36 / 32;
    const height = chest.height * 32 / 28;
    context.drawImage(asset, chest.x - width / 2, chest.y - height / 2, width, height);
  }
}

export function drawPaddleFlight(
  canvas: HTMLCanvasElement,
  state: PaddleFlightState,
  equipped: PaddleFlightEquipped = DEFAULT_PADDLE_FLIGHT_EQUIPPED,
  chests: readonly PaddleFlightChestSprite[] = EMPTY_CHESTS,
) {
  const background = BACKGROUNDS[equipped.background] ? equipped.background : "bg_classic";
  const paddleSkin = PADDLES[equipped.paddle] ? equipped.paddle : "paddle_classic";
  const ballSkin = BALLS[equipped.ball] ? equipped.ball : "ball_classic";
  if (background === "bg_classic" && paddleSkin === "paddle_classic" && ballSkin === "ball_classic") {
    drawClassicPaddleFlight(canvas, state, chests);
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = PADDLE_FLIGHT_WORLD;
  const backingWidth = Math.round(width * ratio);
  const backingHeight = Math.round(height * ratio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawBackground(context, state, background, ratio);
  for (const obstacle of state.obstacles) {
    if (obstacle.x + obstacle.width < -2 || obstacle.x > width + 2) continue;
    const top = getPaddleFlightPaddleGeometry(obstacle, true);
    const bottom = getPaddleFlightPaddleGeometry(obstacle, false);
    drawPaddleHandle(context, top, true);
    drawPaddleHandle(context, bottom, false);
    if (paddleSkin === "paddle_classic") {
      drawPaddleHead(context, top, true);
      drawPaddleHead(context, bottom, false);
    } else {
      drawHandleAccent(context, top, true, paddleSkin);
      drawHandleAccent(context, bottom, false, paddleSkin);
      drawSkinnedHead(context, top, true, paddleSkin, ratio);
      drawSkinnedHead(context, bottom, false, paddleSkin, ratio);
    }
  }
  drawChests(context, chests, ratio);
  if (ballSkin === "ball_classic") drawBall(context, state);
  else drawSkinnedBall(context, state, ballSkin, ratio);
  context.save();
  context.strokeStyle = "#ffffffb8";
  context.lineWidth = 2;
  roundedRectangle(context, 1, 1, width - 2, height - 2, 20);
  context.stroke();
  context.restore();
}

function preparePreviewCanvas(canvas: HTMLCanvasElement, size?: { width: number; height: number }) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const remembered = previewSizes.get(canvas);
  const width = size?.width ?? (canvas.clientWidth || remembered?.width || canvas.width || 160);
  const height = size?.height ?? (canvas.clientHeight || remembered?.height || canvas.height || 104);
  previewSizes.set(canvas, { width, height });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.round(width * ratio);
  const backingHeight = Math.round(height * ratio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height, ratio };
}

/** Use the same materials as the game, enlarged only inside a shop thumbnail. */
export function drawSkinPreview(canvas: HTMLCanvasElement, skinId: string) {
  const surfaceSize = preparePreviewCanvas(canvas);
  if (!surfaceSize) return;
  const { context, width, height, ratio } = surfaceSize;
  const skin = PADDLE_FLIGHT_SKINS.find((entry) => entry.id === skinId);
  const state = createInitialPaddleFlightState({ seed: 1 });
  if (skin?.category === "background") {
    context.save();
    context.scale(width / PADDLE_FLIGHT_WORLD.width, height / PADDLE_FLIGHT_WORLD.height);
    drawBackground(context, state, skinId, ratio);
    context.restore();
    return;
  }
  const surface = context.createLinearGradient(0, 0, width, height);
  surface.addColorStop(0, "#f6f9fd");
  surface.addColorStop(1, "#e5edf4");
  context.fillStyle = surface;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  if (skin?.category === "paddle") {
    const scale = Math.min(width / 122, height / 140);
    context.scale(scale, scale);
    context.rotate(-0.42);
    context.translate(0, -48);
    const paddle = getPaddleFlightPaddleGeometry({ id: 0, x: -39, width: 78, gapTop: 118, gapBottom: 408, scored: false }, true);
    drawPaddleHandle(context, paddle, true);
    if (PADDLES[skinId]) {
      drawHandleAccent(context, paddle, true, skinId);
      drawSkinnedHead(context, paddle, true, skinId, ratio * scale);
    } else drawPaddleHead(context, paddle, true);
  } else {
    const scale = Math.min(width, height) / 42;
    context.scale(scale, scale);
    const ballState = { ...state, ball: { ...state.ball, x: 0, y: 0, velocityY: -140 } };
    if (BALLS[skinId]) drawSkinnedBall(context, ballState, skinId, ratio * scale);
    else drawBall(context, ballState);
  }
  context.restore();
}

/** The entry banner has its own composition so circular equipment is never squashed. */
export function drawPaddleFlightEntryPreview(
  canvas: HTMLCanvasElement,
  equipped: PaddleFlightEquipped = DEFAULT_PADDLE_FLIGHT_EQUIPPED,
  ballCanvas?: HTMLCanvasElement,
) {
  const surface = preparePreviewCanvas(canvas);
  if (!surface) return;
  const { context, width, height, ratio } = surface;
  const ballSurface = ballCanvas && ballCanvas !== canvas
    ? preparePreviewCanvas(ballCanvas, { width, height })
    : surface;
  const state = createInitialPaddleFlightState({ seed: 1 });
  context.save();
  context.scale(width / PADDLE_FLIGHT_WORLD.width, height / PADDLE_FLIGHT_WORLD.height);
  drawBackground(context, state, equipped.background, ratio);
  context.restore();

  const sceneScale = Math.min(1, height / 190, width / 300);
  const paddleScale = sceneScale * 0.95;
  const centerX = width * 0.72;
  const headInset = 5 + 39 * paddleScale;
  const obstacle = { id: 0, x: -39, width: 78, gapTop: 82, gapBottom: 458, scored: false };
  const top = getPaddleFlightPaddleGeometry(obstacle, true);
  const bottom = getPaddleFlightPaddleGeometry(obstacle, false);
  const topY = headInset - top.head.y * paddleScale;
  const bottomY = height - headInset - bottom.head.y * paddleScale;
  const hasPaddleSkin = Boolean(PADDLES[equipped.paddle]);
  const drawPart = (paddle: PaddleFlightPaddleGeometry, fromTop: boolean, y: number, head: boolean) => {
    context.save();
    context.translate(centerX, y);
    context.scale(paddleScale, paddleScale);
    if (head) {
      if (hasPaddleSkin) drawSkinnedHead(context, paddle, fromTop, equipped.paddle, ratio * paddleScale);
      else drawPaddleHead(context, paddle, fromTop);
    } else {
      drawPaddleHandle(context, paddle, fromTop);
      if (hasPaddleSkin) drawHandleAccent(context, paddle, fromTop, equipped.paddle);
    }
    context.restore();
  };
  drawPart(top, true, topY, false);
  drawPart(bottom, false, bottomY, false);
  drawPart(top, true, topY, true);
  drawPart(bottom, false, bottomY, true);

  context.save();
  context.strokeStyle = BACKGROUNDS[equipped.background]?.guide ?? "#6baac0";
  context.globalAlpha = 0.24;
  context.lineWidth = 2;
  for (const [y, length] of [[height * 0.34, 52], [height * 0.65, 34]]) {
    context.beginPath();
    context.moveTo(width * 0.13, y);
    context.lineTo(width * 0.13 + length * sceneScale, y);
    context.stroke();
  }
  context.restore();

  if (!ballSurface) return;
  const ballContext = ballSurface.context;
  ballContext.save();
  ballContext.translate(width * 0.33, height / 2);
  const ballScale = sceneScale * 1.2;
  ballContext.scale(ballScale, ballScale);
  const ballState = { ...state, ball: { ...state.ball, x: 0, y: 0, velocityY: -100 } };
  if (BALLS[equipped.ball]) drawSkinnedBall(ballContext, ballState, equipped.ball, ratio * ballScale);
  else drawBall(ballContext, ballState);
  ballContext.restore();
}
