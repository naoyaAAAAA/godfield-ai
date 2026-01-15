import { globals } from "../globals.js";
import * as logger from "../utils/logger.js";

// clickHelpers.js

function clickPoint(x, y) {
  // 2. その座標に何があるかをログに出す
  const target = document.elementFromPoint(x, y);

  if (!target) {
    console.warn("[ClickDebug] クリック対象が見つかりませんでした (null)");
    return;
  }

  const evInit = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(
    (type) => {
      target.dispatchEvent(new MouseEvent(type, evInit));
    },
  );
}

function clickElementCenter(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  clickPoint(x, y);
}

function clickTargetsForPhase(phase, target) {
  if (phase === "attack" && target && globals.lastState) {
    let row = null;

    if (target === "self" && globals.lastMeRowEl) {
      row = globals.lastMeRowEl;
    } else if (target === "enemy" && globals.lastEnemyRowEl) {
      row = globals.lastEnemyRowEl;
    }

    if (row) {
      const rect = row.getBoundingClientRect();
      const xs = [
        rect.left + rect.width * 0.2,
        rect.left + rect.width * 0.5,
        rect.left + rect.width * 0.8,
      ];
      const ys = [rect.top + rect.height * 0.35, rect.top + rect.height * 0.65];

      logger.log("[GF AI] click self name row sweep", {
        target,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });

      for (const y of ys) {
        for (const x of xs) {
          clickPoint(x, y);
        }
      }
    }
  }

  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const redX = vw * 0.1;
  const redY = vh * 0.32;
  const blueX = vw * 0.5;
  const blueY = vh * 0.3;
  clickPoint(redX, redY);
  clickPoint(blueX, blueY);
}

export function createClickHelpers() {
  return { clickPoint, clickElementCenter, clickTargetsForPhase };
}
