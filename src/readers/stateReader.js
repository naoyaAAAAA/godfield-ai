import { globals } from "../globals.js";
import * as logger from "../utils/logger.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// stateReader.js (完成版)
function fireMouseEvent(el, type, x, y) {
  try {
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
  } catch (e) {
    // ignore
  }
}
// Force detail panel refresh: mouseout previous hover target, then mouseover the target
function hoverWithReset(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  const prev = globals.lastHoverEl;
  if (prev && prev.isConnected) {
    const pr = prev.getBoundingClientRect();
    fireMouseEvent(
      prev,
      "mouseout",
      pr.left + pr.width / 2,
      pr.top + pr.height / 2,
    );
  }

  // Nudge hover state away, then back to target
  fireMouseEvent(document.body, "mousemove", 1, 1);
  fireMouseEvent(document.body, "mouseover", 1, 1);

  // Always do "mouseout -> mouseover" on the target (same as miracle-check style)
  fireMouseEvent(el, "mouseout", x, y);
  fireMouseEvent(el, "mouseover", x, y);
  fireMouseEvent(el, "mousemove", x, y);

  globals.lastHoverEl = el;
}
function readDetailPanelTextAfterHover(el, { retries = 2 } = {}) {
  const d0 = findDetailPanel();
  const beforeText = d0 ? (d0.innerText || "").trim() : "";

  let full = "";
  for (let i = 0; i < retries; i++) {
    hoverWithReset(el);
    const d = findDetailPanel();
    full = d ? (d.innerText || "").trim() : "";
    if (!full) continue;
    if (full === beforeText) continue; // try once more if panel seems stale
    break;
  }

  // Even if it's the same as before, accept it as long as it's non-empty.
  return full;
}

function findMiraclesButton() {
  const divs = Array.from(document.querySelectorAll("div"));

  // 1. 「透明」かつ「絶対配置」の要素を探す
  const candidates = divs.filter((el) => {
    const s = window.getComputedStyle(el);
    // 透明度が0.1未満、かつ absolute 配置されているか
    return parseFloat(s.opacity) < 0.1 && s.position === "absolute";
  });

  // 2. その中から「幅が 240px〜260px」のものを探して返す
  return (
    candidates.find((el) => {
      const w = parseFloat(window.getComputedStyle(el).width);
      return w >= 240 && w <= 260;
    }) || null
  );
}

function findDetailPanel() {
  const divs = Array.from(document.querySelectorAll("#main div"));
  const candidates = divs.filter((el) => {
    const style = window.getComputedStyle(el);
    return (
      style.backgroundColor === "rgb(221, 255, 204)" &&
      el.getBoundingClientRect().width > 150
    );
  });
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
  );
  return candidates[candidates.length - 1].parentElement;
}

function readGF() {
  const all = Array.from(document.querySelectorAll("div, span"));
  const gfEl = all.find((el) => el.textContent.includes("G.F."));
  if (!gfEl) return null;
  const m = gfEl.textContent.match(/G\.F\.\s*([0-9]+)\s*\/\s*([0-9]+)/);
  return m ? { current: parseInt(m[1]), max: parseInt(m[2]) } : null;
}

function pickHudBox(el) {
  let p = el;
  for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
    const r = p.getBoundingClientRect();
    const t = (p.textContent || "").replace(/\s+/g, "");

    const looksLikeHud = /HP/.test(t) && /MP/.test(t) && /¥/.test(t);

    if (
      r.width >= 320 &&
      r.width <= 360 &&
      r.height >= 30 &&
      r.height <= 50 &&
      looksLikeHud
    )
      return p;
  }
  return null;
}

function rectKey(el) {
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
}

function readPlayers() {
  if (globals.isCheckingMiracles) return globals.lastPlayers ?? null;

  const hits = Array.from(document.querySelectorAll("div, span")).filter(
    (el) =>
      /HP/.test(el.textContent) &&
      /MP/.test(el.textContent) &&
      /¥/.test(el.textContent),
  );

  const seen = new Set();
  const huds = [];
  for (const h of hits) {
    const box = pickHudBox(h);
    if (!box) continue;
    const key = rectKey(box);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = box.getBoundingClientRect();
    huds.push({ el: box, r, area: r.width * r.height });
  }

  huds.sort((a, b) => b.area - a.area);
  if (huds.length < 2) return globals.lastPlayers ?? null;

  let a = huds[0].el;
  let b = huds[1].el;

  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const cyA = ra.top + ra.height / 2;
  const cyB = rb.top + rb.height / 2;
  const vh = window.innerHeight;

  const horizontal = Math.abs(cyA - cyB) < Math.max(30, vh * 0.08);

  // me/enの割当：名前が入ってる方をme、それ以外は fallback
  const aHasMe = a.textContent.includes(globals.MY_NAME);
  const bHasMe = b.textContent.includes(globals.MY_NAME);

  let meRow, enRow;
  if (aHasMe && !bHasMe) {
    meRow = a;
    enRow = b;
  } else if (!aHasMe && bHasMe) {
    meRow = b;
    enRow = a;
  } else {
    // 名前で決められないとき：上下ならtop、左右ならleftで仮決め
    if (!horizontal) {
      meRow = ra.top <= rb.top ? a : b;
      enRow = meRow === a ? b : a;
    } else {
      meRow = ra.left <= rb.left ? a : b;
      enRow = meRow === a ? b : a;
    }
  }

  globals.lastMeRowEl = meRow;
  globals.lastEnemyRowEl = enRow;

  // meIsTopLastKnownは「上下配置が確実なときだけ更新」
  if (!horizontal)
    globals.meIsTopLastKnown =
      meRow.getBoundingClientRect().top < enRow.getBoundingClientRect().top;

  const parseRow = (row) => {
    const m = row.textContent.replace(/\s+/g, "").match(/HP(\d+)MP(\d+)¥(\d+)/);
    return m ? { hp: +m[1], mp: +m[2], gold: +m[3] } : null;
  };

  const prev = globals.lastPlayers ?? {
    me: { name: globals.MY_NAME },
    enemy: { name: "Enemy" },
  };

  const mStat = meRow ? parseRow(meRow) : null;
  const eStat = enRow ? parseRow(enRow) : null;

  // 片方だけ取れたらそこだけ更新
  globals.lastPlayers = {
    me: { ...prev.me, name: globals.MY_NAME, ...(mStat ?? {}) },
    enemy: { ...prev.enemy, name: "Enemy", ...(eStat ?? {}) },

    // あると便利（LLMに「霧で相手ステ不明」を伝えられる）
    enemyStatsHidden: !eStat,
  };

  return globals.lastPlayers;
}

function readStatuses(players) {
  const root = document.querySelector("#main") || document.body;
  const detail = findDetailPanel();
  const vw = window.innerWidth;
  const minX = vw * 0.45;

  const raw = Array.from(root.querySelectorAll("div, span, img")).filter(
    (el) => {
      if (detail && detail.contains(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.width > 40) return false;
      const cx = r.left + r.width / 2;
      if (cx < minX) return false;
      return hasVisualImage(el);
    },
  );

  const vh = window.innerHeight;
  const topSlots = [],
    botSlots = [];

  raw.forEach((el) => {
    const cy =
      el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
    if (cy < vh * 0.2) topSlots.push({ el, cx: 0, cy });
    else if (cy < vh * 0.4) botSlots.push({ el, cx: 0, cy });
  });

  const meIsTop = getMeIsTop(vh);

  const meRaw = meIsTop ? topSlots : botSlots;
  const enRaw = meIsTop ? botSlots : topSlots;

  return {
    me: readStatusesFromSlots(dedup(meRaw)),
    enemy: readStatusesFromSlots(dedup(enRaw)),
  };
}

function dedup(slots) {
  const out = [];
  for (const s of slots) {
    const rect = s.el.getBoundingClientRect();
    const cx = rect.left;
    const cy = rect.top;
    if (
      !out.find((o) => Math.abs(o.cx - cx) < 10 && Math.abs(o.cy - cy) < 10)
    ) {
      out.push({ el: s.el, cx, cy });
    }
  }
  return out;
}

function readStatusesFromSlots(slots) {
  const res = [];
  for (const s of slots) {
    const full = readDetailPanelTextAfterHover(s.el, { retries: 3 });
    if (!full) continue;

    const lines = full
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (lines.length)
      res.push({ name: lines[0], raw_text: lines.slice(1).join(" ") });
  }
  return res;
}

async function readMiracleNamesFromSlots(slots, sleep) {
  const names = [];
  const detail0 = findDetailPanel();
  let lastFull = detail0 ? (detail0.innerText || "").trim() : "";

  // 【対策1】手札の読み取り情報が残っていれば、明示的に mouseout して「手札を見ていない状態」にする
  if (globals.lastHandDomElements && globals.lastHandDomElements.length > 0) {
    globals.lastHandDomElements.forEach((el) => {
      try {
        el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      } catch (e) {
        // 要素が消えている場合などは無視
      }
    });
    // 念のため一瞬待つ（不要なら削除可）
    await sleep(20);
  }

  for (const s of slots) {
    // const before = lastFull; // (未使用なら削除可)

    // 【対策2】いきなりクリックせず、まず「カーソルを合わせた」ことにする
    s.el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    // 詳細パネルが「前のカード」から「この奇跡」に切り替わるきっかけを与えるため少し待つ
    await sleep(50);

    // そのあとクリック
    s.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    s.el.click();

    // クリック後の描画待ち（リクエストのあった待ち時間）
    await sleep(150);

    let full = "";
    const t0 = performance.now();

    // 待ち時間を少し減らしてもいいかもしれませんが、安定重視でそのまま
    while (performance.now() - t0 < 700) {
      const d = findDetailPanel();
      if (d) {
        full = (d.innerText || "").trim();
        // ここで「前のパネルの内容(lastFull)と違うこと」を確認条件に加えるとさらに盤石ですが、
        // 変化しない場合（同じアイテムを連打など）もあるので一旦「非空」チェックのみにします
        if (full) break;
      }
      await sleep(70);
    }

    if (!full) continue;

    const lines = full
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!lines.length) continue;

    const name = lines[0];
    // 重複チェック
    if (name && !names.includes(name)) names.push(name);

    lastFull = full;
  }

  return names;
}
async function readMiraclesFromView() {
  const vh = window.innerHeight;

  const prev = globals.lockedMeIsTop;
  globals.lockedMeIsTop =
    globals.meIsTopLastKnown ?? globals.lockedMeIsTop ?? getMeIsTop(vh);

  try {
    const root = document.querySelector("#main") || document.body;
    const detail = findDetailPanel();
    const vw = window.innerWidth;
    const minX = vw * 0.45; // 状態異常と同じ

    // 状態異常と同じ「右側×小さめ×(IMG or bg)」で拾う
    const raw = Array.from(root.querySelectorAll("div, span, img")).filter(
      (el) => {
        if (detail && detail.contains(el)) return false;

        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.width > 60) return false; // 40x40想定 + バッファ
        if (r.height < 10 || r.height > 60) return false;

        const cx = r.left + r.width / 2;
        if (cx < minX) return false;

        return hasVisualImage(el);
      },
    );

    if (!raw.length) {
      logger.log("[GF AI] no miracle icons found (raw=0)");
      return false;
    }

    // 状態異常と同じ2段分割
    const topSlots = [];
    const botSlots = [];

    raw.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      if (cy < vh * 0.2) topSlots.push({ el, cx: 0, cy });
      else if (cy < vh * 0.5) botSlots.push({ el, cx: 0, cy });
    });

    const meIsTop = getMeIsTop(vh);
    logger.log("[GF AI] meIsTop debug", {
      locked: globals.lockedMeIsTop,
      lastKnown: globals.meIsTopLastKnown,
      meTop: globals.lastMeRowEl?.getBoundingClientRect()?.top,
      enTop: globals.lastEnemyRowEl?.getBoundingClientRect()?.top,
    });
    const meRaw = meIsTop ? topSlots : botSlots;
    const enRaw = meIsTop ? botSlots : topSlots;

    const meNames = await readMiracleNamesFromSlots(dedup(meRaw), sleep);
    const enemyNames = await readMiracleNamesFromSlots(dedup(enRaw), sleep);

    // ★アイコンはあるのに名前が1つも取れないなら、空で上書きしない
    if (
      meRaw.length + enRaw.length > 0 &&
      meNames.length + enemyNames.length === 0
    ) {
      logger.log("[GF AI] miracle icons found but names empty; keep previous", {
        raw: raw.length,
        top: topSlots.length,
        bot: botSlots.length,
        meIsTop,
      });
      return false;
    }
    // ★毎回リセットして「画面から読んだ結果」で上書きする
    globals.mySeenMiracles.clear();
    globals.enemySeenMiracles.clear();

    meNames.forEach((n) => globals.mySeenMiracles.add(n));
    enemyNames.forEach((n) => globals.enemySeenMiracles.add(n));

    logger.log("[GF AI] refresh miracles from view", {
      me: Array.from(globals.mySeenMiracles),
      enemy: Array.from(globals.enemySeenMiracles),
    });

    return true;
  } finally {
    globals.lockedMeIsTop = prev;
  }
}

function cardSizeLimits() {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return {
    minW: 40,
    maxW: Math.max(120, Math.min(240, vw * 0.1)),
    minH: 50,
    maxH: Math.max(140, Math.min(280, vh * 0.22)),
  };
}

function isCardLikeRect(rect, limits = cardSizeLimits()) {
  if (!rect) return false;
  return (
    rect.width >= limits.minW &&
    rect.width <= limits.maxW &&
    rect.height >= limits.minH &&
    rect.height <= limits.maxH
  );
}

function hasCssBackgroundImage(el) {
  const bg = window.getComputedStyle(el).backgroundImage;
  return !!bg && bg !== "none";
}

function findNestedImage(el) {
  if (!el) return null;
  if (el.tagName === "IMG") return el;
  return el.querySelector?.("img") || null;
}

function hasVisualImage(el) {
  return hasCssBackgroundImage(el) || !!findNestedImage(el);
}

function hasCardImage(el) {
  if (hasCssBackgroundImage(el)) return true;
  const img = findNestedImage(el);
  const src = img?.currentSrc || img?.src || "";
  return src.includes("/images/items/");
}

function cardHoverElement(el) {
  return findNestedImage(el) || el;
}

function isHandCardElement(el, detail) {
  if (detail && detail.contains(el)) return false;

  if (!hasCardImage(el)) return false;

  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  if (r.top + r.height / 2 < vh * 0.5) return false;
  if (r.left + r.width / 2 > vw * 0.88) return false;
  if (!isCardLikeRect(r)) return false;

  return true;
}

function findCardContainer(el) {
  const limits = cardSizeLimits();
  let p = el;
  for (
    let i = 0;
    i < 8 && p && p.tagName !== "BODY";
    i++, p = p.parentElement
  ) {
    const r = p.getBoundingClientRect();
    if (isCardLikeRect(r, limits)) return p;
  }
  return el;
}

function readHand(phase) {
  const detail = findDetailPanel();
  const root = document.querySelector("#main");
  if (!root) return [];

  const labels = Array.from(root.querySelectorAll("div, span")).filter((el) => {
    if (detail && detail.contains(el)) return false;
    return /^(攻[0-9]+|守[0-9]+|\+攻[0-9]+|¥[0-9]+)$/.test(
      el.textContent.trim(),
    );
  });
  const cards = Array.from(root.querySelectorAll("div")).filter((el) => {
    return isHandCardElement(el, detail);
  });
  const rows = [];
  for (const el of cards) {
    const top = el.getBoundingClientRect().top;
    let row = rows.find((r) => Math.abs(r.top - top) < 40);
    if (!row) {
      row = { top, els: [] };
      rows.push(row);
    }
    row.els.push(el);
  }
  rows.sort((a, b) => a.top - b.top);
  const myEls = rows.slice(-2).flatMap((r) => r.els);
  const uniqueEls = [];
  for (const el of myEls) {
    const r = el.getBoundingClientRect();
    if (
      !uniqueEls.find(
        (u) =>
          Math.abs(u.r.left - r.left) < 10 && Math.abs(u.r.top - r.top) < 10,
      )
    ) {
      uniqueEls.push({ el, r });
    }
  }
  uniqueEls.sort((a, b) =>
    Math.abs(a.r.top - b.r.top) < 20 ? a.r.left - b.r.left : a.r.top - b.r.top,
  );
  const limited = uniqueEls.slice(0, 18);
  globals.lastHandDomElements = limited.map((u) => u.el);
  return limited.map((u, i) => {
    let bestL = null,
      bestD = 999;
    for (const l of labels) {
      const lr = l.getBoundingClientRect();
      const dy = lr.top - u.r.bottom;
      const cardCx = u.r.left + u.r.width / 2;
      const labelCx = lr.left + lr.width / 2;
      const maxDx = Math.max(50, u.r.width * 0.65);
      const maxDy = Math.max(80, u.r.height * 0.65);
      if (dy > -20 && dy < maxDy && Math.abs(labelCx - cardCx) < maxDx) {
        if (Math.abs(dy) < bestD) {
          bestD = Math.abs(dy);
          bestL = l;
        }
      }
    }
    const info = readCardInfo(u.el, phase);
    return {
      index: i,
      overlay: bestL ? bestL.textContent.trim() : info.overlay || "",
      name: info.name,
      raw_text: info.raw_text,
      usable: info.usable,
    };
  });
}

function readCardInfo(el, phase) {
  hoverWithReset(cardHoverElement(el));
  const d = findDetailPanel();
  let name = "",
    raw = "";
  if (d) {
    const lines = d.innerText.trim().split("\n");
    if (lines.length) {
      name = lines[0];
      raw = lines.slice(1).join(" ");
    }
  }
  let usable = true;
  const p = findCardContainer(el);
  if (p) {
    const masks = Array.from(p.querySelectorAll("div")).filter((m) => {
      const ms = window.getComputedStyle(m);
      return (
        ms.backgroundColor === "rgb(0, 0, 0)" && parseFloat(ms.opacity) > 0.1
      );
    });
    if (masks.length) usable = false;
  }
  return { name, raw_text: raw, usable };
}

function readCardInfoForIncoming(el) {
  const full = readDetailPanelTextAfterHover(cardHoverElement(el), {
    retries: 3,
  });
  if (!full) return null;

  const lines = full
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!lines.length) return null;
  return { name: lines[0], raw_text: lines.slice(1).join(" ") };
}

function readIncomingCards(phase) {
  if (phase !== "defense") return [];
  const root = document.querySelector("#main");
  if (!root) return [];

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const ZONES = {
    left: { minX: vw * 0.05, maxX: vw * 0.2, minY: vh * 0.1, maxY: vh * 0.42 },
    right: { minX: vw * 0.25, maxX: vw * 0.5, minY: vh * 0.1, maxY: vh * 0.42 },
  };

  const cards = Array.from(root.querySelectorAll("div"))
    .map((el) => {
      if (!hasCardImage(el)) return null;

      const r = el.getBoundingClientRect();
      if (r.width < 50) return null;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const isLeft =
        cx > ZONES.left.minX &&
        cx < ZONES.left.maxX &&
        cy > ZONES.left.minY &&
        cy < ZONES.left.maxY;
      const isRight =
        cx > ZONES.right.minX &&
        cx < ZONES.right.maxX &&
        cy > ZONES.right.minY &&
        cy < ZONES.right.maxY;

      if (!isLeft && !isRight) return null;

      return { el, r, zone: isLeft ? "left" : "right" };
    })
    .filter(Boolean);

  const unique = [];
  for (const obj of cards) {
    const r = obj.r;
    const isDuplicate = unique.find(
      (u) => Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20,
    );
    if (!isDuplicate) unique.push(obj);
  }
  unique.sort((a, b) => a.r.left - b.r.left);

  return unique
    .map((u, i) => {
      const info = readCardInfoForIncoming(u.el);
      if (!info) return null;
      const l = u.el.querySelector("span, div");
      const ov = l ? l.textContent : "";
      return {
        index: i,
        name: info.name,
        raw_text: info.raw_text,
        overlay: ov,
        zone: u.zone,
      };
    })
    .filter(Boolean)
    .map((c, i) => ({ ...c, index: i }));
}

function readBuyCandidate(phase) {
  if (phase !== "buy_choice") return [];

  const root = document.querySelector("#main") || document;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const detail = findDetailPanel();

  const zone = {
    minX: vw * 0.3,
    maxX: vw * 0.55,
    minY: vh * 0.05,
    maxY: vh * 0.45,
  };

  const limits = cardSizeLimits();
  const rawCards = Array.from(root.querySelectorAll("div"))
    .map((el) => {
      if (detail && detail.contains(el)) return null;
      if (!hasCardImage(el)) return null;

      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (r.width < limits.minW || r.width > Math.max(180, limits.maxW))
        return null;
      if (r.height < limits.minH || r.height > Math.max(220, limits.maxH))
        return null;

      const inPrimaryZone =
        cx >= zone.minX &&
        cx <= zone.maxX &&
        cy >= zone.minY &&
        cy <= zone.maxY;
      const inFallbackZone =
        cy >= vh * 0.05 && cy <= vh * 0.58 && cx >= vw * 0.05 && cx <= vw * 0.9;

      if (!inPrimaryZone && !inFallbackZone) return null;

      const targetX = vw * 0.42;
      const targetY = vh * 0.25;
      const distance = Math.hypot(cx - targetX, cy - targetY);
      return { el, r, inPrimaryZone, distance };
    })
    .filter(Boolean);

  if (!rawCards.length) return [];

  const unique = [];
  for (const obj of rawCards) {
    const r = obj.r;
    const dup = unique.find(
      (u) => Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20,
    );
    if (!dup) unique.push(obj);
  }

  unique.sort((a, b) => {
    if (a.inPrimaryZone !== b.inPrimaryZone) return a.inPrimaryZone ? -1 : 1;
    return a.distance - b.distance;
  });
  const cardEl = unique[0].el;

  const info = readCardInfoForIncoming(cardEl);
  if (!info) return [];

  let overlay = "";
  const label = cardEl.querySelector("span, div");
  if (label) overlay = (label.textContent || "").trim();

  return [
    {
      index: 0,
      name: info.name,
      raw_text: info.raw_text,
      overlay,
    },
  ];
}

function getMeIsTop(vh) {
  // ★奇跡チェック中などはロック値を最優先
  if (globals.lockedMeIsTop !== null) return globals.lockedMeIsTop;

  if (globals.lastMeRowEl && globals.lastEnemyRowEl) {
    return (
      globals.lastMeRowEl.getBoundingClientRect().top <
      globals.lastEnemyRowEl.getBoundingClientRect().top
    );
  }
  if (globals.meIsTopLastKnown !== null) return globals.meIsTopLastKnown;

  if (globals.lastMeRowEl) {
    return globals.lastMeRowEl.getBoundingClientRect().top < vh * 0.2;
  }
  return true; // 最後の最後だけ
}

function hasClickableHand() {
  const root = document.querySelector("#main");
  if (!root) return false;

  const detail = findDetailPanel();

  const cards = Array.from(root.querySelectorAll("div")).filter((el) => {
    return isHandCardElement(el, detail);
  });

  return cards.length > 0;
}

function findTextElement(text) {
  const viewportArea = window.innerWidth * window.innerHeight;
  const candidates = Array.from(document.querySelectorAll("button, div, span"))
    .filter((el) => {
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join("")
        .trim();
      const textContent = (el.textContent || "").trim();
      return ownText.includes(text) || textContent === text;
    })
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 20 && r.height > 20)
    .filter(({ r }) => r.width * r.height < viewportArea * 0.12)
    .filter(({ r }) => r.width < window.innerWidth * 0.6)
    .filter(({ r }) => r.height < window.innerHeight * 0.25)
    .sort((a, b) => {
      const aArea = a.r.width * a.r.height;
      const bArea = b.r.width * b.r.height;
      return aArea - bArea;
    });
  return candidates.length ? candidates[0].el : null;
}

function detectPhase() {
  const prayEl = findTextElement("祈る");
  const forgiveEl = findTextElement("許す");
  const hasPray = !!prayEl;
  const hasForgiveRaw = !!forgiveEl;

  const now = performance.now();
  const GRACE_MS = 1500;

  if (hasForgiveRaw) globals.forgiveLastSeenAt = now;

  // 一瞬見失っても GRACE_MS は「見えてる扱い」
  const hasForgive =
    hasForgiveRaw ||
    (globals.forgiveLastSeenAt && now - globals.forgiveLastSeenAt < GRACE_MS);

  const buyBox = findBuyHitbox();
  if (buyBox) {
    globals.forgiveVisibleAt = 0;
    return "buy_choice";
  }

  if (hasPray) {
    globals.forgiveVisibleAt = 0;
    return "attack";
  }

  if (hasForgive) {
    if (!globals.forgiveVisibleAt) {
      globals.forgiveVisibleAt = now;
      return "other";
    }
    const elapsed = now - globals.forgiveVisibleAt;
    return elapsed >= 2000 ? "defense" : "other";
  } else {
    // GRACEを超えて完全に消えたときだけリセット
    globals.forgiveVisibleAt = 0;
  }

  return "other";
}

function findBuyHitbox() {
  const divs = Array.from(document.querySelectorAll("div"));

  const strict = divs.filter((el) => {
    const s = (el.getAttribute("style") || "").replace(/\s+/g, "");
    return (
      s.includes("width:300px") &&
      s.includes("height:90px") &&
      s.includes("opacity:0") &&
      s.includes("background-color:rgb(255,255,255)")
    );
  });

  if (strict.length) {
    strict.sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    );
    return strict[0];
  }

  const winW = window.innerWidth || document.documentElement.clientWidth;

  const cand = divs
    .map((el) => ({
      el,
      r: el.getBoundingClientRect(),
      cs: getComputedStyle(el),
    }))
    .filter(
      ({ r }) =>
        r.width > 260 && r.width < 340 && r.height > 80 && r.height < 100,
    )
    .filter(({ r }) => r.left < winW * 0.6)
    .filter(({ cs }) => {
      const op = parseFloat(cs.opacity || "1");
      const pe = cs.pointerEvents || "auto";
      return op <= 0.1 && pe !== "none";
    })
    .sort((a, b) => a.r.top - b.r.top);

  return cand.length ? cand[0].el : null;
}

function findBuyHitboxesPair() {
  const divs = Array.from(document.querySelectorAll("div"));

  const strict = divs.filter((el) => {
    const s = (el.getAttribute("style") || "").replace(/\s+/g, "");
    return (
      s.includes("width:300px") &&
      s.includes("height:90px") &&
      s.includes("opacity:0") &&
      s.includes("background-color:rgb(255,255,255)")
    );
  });

  if (strict.length >= 2) {
    strict.sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    );
    const yes = strict[0];
    const no = strict[strict.length - 1];
    return { yes, no };
  }

  const winW = window.innerWidth || document.documentElement.clientWidth;

  const cand = divs
    .map((el) => ({
      el,
      r: el.getBoundingClientRect(),
      cs: getComputedStyle(el),
    }))
    .filter(
      ({ r }) =>
        r.width > 260 && r.width < 340 && r.height > 80 && r.height < 100,
    )
    .filter(({ r }) => r.left < winW * 0.6)
    .filter(({ cs }) => {
      const op = parseFloat(cs.opacity || "1");
      const pe = cs.pointerEvents || "auto";
      return op <= 0.1 && pe !== "none";
    })
    .sort((a, b) => a.r.top - b.r.top);

  if (cand.length === 0) return { yes: null, no: null };
  if (cand.length === 1) return { yes: cand[0].el, no: null };

  const yes = cand[0].el;
  const no = cand[cand.length - 1].el;
  return { yes, no };
}

function findExchangeButtons() {
  const elems = Array.from(document.querySelectorAll("div"));
  const candidates = [];

  for (const el of elems) {
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 110 || w > 130) continue;
    if (h < 45 || h > 55) continue;
    const cx = rect.left + w / 2;
    const cy = rect.top + h / 2;
    if (cx < 460 || cx > 720) continue;
    if (cy < 100 || cy > 400) continue;
    candidates.push({ el, cx, cy });
  }

  if (candidates.length < 8) return null;

  candidates.sort((a, b) => a.cx - b.cx);
  const mid = (candidates[0].cx + candidates[candidates.length - 1].cx) / 2;
  const leftCol = candidates.filter((c) => c.cx <= mid);
  const rightCol = candidates.filter((c) => c.cx > mid);
  if (!leftCol.length || !rightCol.length) return null;

  function mapColumn(col) {
    col.sort((a, b) => a.cy - b.cy);
    const groups = [];
    for (const c of col) {
      let g = groups.find((g) => Math.abs(g.cy - c.cy) <= 20);
      if (!g) groups.push({ cy: c.cy, items: [c] });
      else g.items.push(c);
    }
    if (groups.length < 4) return null;
    groups.sort((a, b) => a.cy - b.cy);
    return {
      plus10: groups[0].items[0].el,
      plus1: groups[1].items[0].el,
      minus1: groups[2].items[0].el,
      minus10: groups[3].items[0].el,
    };
  }

  const mpBtns = mapColumn(leftCol);
  const goldBtns = mapColumn(rightCol);
  if (!mpBtns || !goldBtns) return null;

  return { mp: mpBtns, gold: goldBtns };
}

function rectInfo(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
    cx: Math.round(r.left + r.width / 2),
    cy: Math.round(r.top + r.height / 2),
  };
}

function describeElement(el) {
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  const bg = cs.backgroundImage;
  const img = findNestedImage(el);
  return {
    tag: el.tagName,
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    rect: rectInfo(el),
    opacity: cs.opacity,
    position: cs.position,
    pointerEvents: cs.pointerEvents,
    hasBg: !!bg && bg !== "none",
    hasImg: !!img,
    imgSrc: img ? (img.currentSrc || img.src || "").slice(0, 120) : "",
    bg: bg && bg !== "none" ? bg.slice(0, 120) : "",
  };
}

function clearDebugOverlays() {
  document
    .querySelectorAll(".gf-ai-debug-overlay")
    .forEach((el) => el.remove());
}

function drawDebugBox(el, color, label) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;

  const box = document.createElement("div");
  box.className = "gf-ai-debug-overlay";
  box.style.cssText = [
    "position:fixed",
    `left:${Math.round(r.left)}px`,
    `top:${Math.round(r.top)}px`,
    `width:${Math.round(r.width)}px`,
    `height:${Math.round(r.height)}px`,
    `border:2px solid ${color}`,
    "box-sizing:border-box",
    "z-index:2147483647",
    "pointer-events:none",
    "font:12px/1.2 monospace",
  ].join(";");

  const tag = document.createElement("div");
  tag.textContent = label;
  tag.style.cssText = [
    `background:${color}`,
    "color:#111",
    "padding:1px 3px",
    "position:absolute",
    "left:0",
    "top:-16px",
    "white-space:nowrap",
  ].join(";");
  box.appendChild(tag);
  document.body.appendChild(box);
}

function diagnose({ highlight = false } = {}) {
  const root = document.querySelector("#main");
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const detail = findDetailPanel();
  const phase = detectPhase();
  const miracleButton = findMiraclesButton();
  const buyBox = findBuyHitbox();
  const prayButton = findTextElement("祈る");
  const forgiveButton = findTextElement("許す");
  const buyCandidates = readBuyCandidate(phase);

  if (highlight) clearDebugOverlays();

  const hudHits = Array.from(document.querySelectorAll("div, span")).filter(
    (el) =>
      /HP/.test(el.textContent) &&
      /MP/.test(el.textContent) &&
      /¥/.test(el.textContent),
  );
  const hudSeen = new Set();
  const huds = [];
  for (const hit of hudHits) {
    const box = pickHudBox(hit);
    if (!box) continue;
    const key = rectKey(box);
    if (hudSeen.has(key)) continue;
    hudSeen.add(key);
    huds.push(box);
  }

  const labels = root
    ? Array.from(root.querySelectorAll("div, span")).filter((el) => {
        if (detail && detail.contains(el)) return false;
        return /^(攻[0-9]+|守[0-9]+|\+攻[0-9]+|¥[0-9]+)$/.test(
          el.textContent.trim(),
        );
      })
    : [];

  const handCandidates = root
    ? Array.from(root.querySelectorAll("div")).filter((el) => {
        return isHandCardElement(el, detail);
      })
    : [];

  const handRows = [];
  for (const el of handCandidates) {
    const top = el.getBoundingClientRect().top;
    let row = handRows.find((r) => Math.abs(r.top - top) < 40);
    if (!row) {
      row = { top, els: [] };
      handRows.push(row);
    }
    row.els.push(el);
  }
  handRows.sort((a, b) => a.top - b.top);
  const selectedHand = handRows.slice(-2).flatMap((r) => r.els);

  const statusRaw = root
    ? Array.from(root.querySelectorAll("div, span, img")).filter((el) => {
        if (detail && detail.contains(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.width > 40) return false;
        const cx = r.left + r.width / 2;
        if (cx < vw * 0.45) return false;
        return hasVisualImage(el);
      })
    : [];
  const statusTop = [];
  const statusBot = [];
  statusRaw.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    if (cy < vh * 0.2) statusTop.push({ el, cx: 0, cy });
    else if (cy < vh * 0.4) statusBot.push({ el, cx: 0, cy });
  });

  const incomingCandidates = root
    ? Array.from(root.querySelectorAll("div"))
        .map((el) => {
          if (!hasCardImage(el)) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 50) return null;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const left =
            cx > vw * 0.05 && cx < vw * 0.2 && cy > vh * 0.1 && cy < vh * 0.42;
          const right =
            cx > vw * 0.25 && cx < vw * 0.5 && cy > vh * 0.1 && cy < vh * 0.42;
          if (!left && !right) return null;
          return { el, zone: left ? "left" : "right" };
        })
        .filter(Boolean)
    : [];

  const summary = {
    viewport: { width: vw, height: vh },
    phase,
    rootFound: !!root,
    detailPanel: describeElement(detail),
    prayButton: describeElement(prayButton),
    forgiveButton: describeElement(forgiveButton),
    miracleButton: describeElement(miracleButton),
    buyBox: describeElement(buyBox),
    players: {
      hudTextHits: hudHits.length,
      hudBoxes: huds.map(describeElement),
      lastPlayers: globals.lastPlayers || null,
      meIsTop: getMeIsTop(vh),
    },
    hand: {
      labelCount: labels.length,
      labels: labels.slice(0, 30).map(describeElement),
      candidateCount: handCandidates.length,
      rowCounts: handRows.map((r) => ({
        top: Math.round(r.top),
        count: r.els.length,
      })),
      selectedCount: selectedHand.length,
      selected: selectedHand.slice(0, 30).map(describeElement),
      lastRead: (globals.lastState?.hand || []).map((c) => ({
        index: c.index,
        name: c.name,
        overlay: c.overlay,
        usable: c.usable,
      })),
    },
    statuses: {
      rawCount: statusRaw.length,
      topCount: statusTop.length,
      bottomCount: statusBot.length,
      meTopAssignment: getMeIsTop(vh) ? "top" : "bottom",
      lastRead: {
        me: globals.lastState?.me?.statuses || [],
        enemy: globals.lastState?.enemy?.statuses || [],
      },
    },
    incoming: {
      candidateCount: incomingCandidates.length,
      candidates: incomingCandidates.slice(0, 30).map((x) => ({
        zone: x.zone,
        ...describeElement(x.el),
      })),
      lastRead: globals.lastState?.incomingCards || [],
    },
    buyCandidates,
    miracles: {
      seen: {
        me: Array.from(globals.mySeenMiracles),
        enemy: Array.from(globals.enemySeenMiracles),
      },
      lastCheckTime: globals.lastMiracleCheckTime,
      isChecking: globals.isCheckingMiracles,
    },
  };

  if (highlight) {
    huds.forEach((el, i) => drawDebugBox(el, "#d58cff", `hud ${i}`));
    if (detail) drawDebugBox(detail, "#51cf66", "detail");
    if (prayButton) drawDebugBox(prayButton, "#69db7c", "pray");
    if (forgiveButton) drawDebugBox(forgiveButton, "#ff8787", "forgive");
    if (miracleButton) drawDebugBox(miracleButton, "#ffd43b", "miracle btn");
    if (buyBox) drawDebugBox(buyBox, "#f06595", "buy box");
    handCandidates.forEach((el, i) =>
      drawDebugBox(el, "#22b8cf", `hand? ${i}`),
    );
    selectedHand.forEach((el, i) => drawDebugBox(el, "#339af0", `hand ${i}`));
    statusRaw.forEach((el, i) => drawDebugBox(el, "#ffa94d", `status? ${i}`));
    incomingCandidates.forEach((x, i) =>
      drawDebugBox(x.el, "#ff6b6b", `inc ${i} ${x.zone}`),
    );
  }

  logger.log("[GF AI DIAGNOSE]", summary);
  return summary;
}

function readState() {
  if (globals.isCheckingMiracles) return null; // ★先に止める
  const phase = detectPhase();
  const gf = readGF();
  const players = readPlayers();
  if (!players) return null;

  const incomingCards = readIncomingCards(phase);
  const hand = readHand(phase);
  const stats = readStatuses(players);
  const buyCandidates = readBuyCandidate(phase);
  return {
    phase,
    gf,
    me: { ...players.me, statuses: stats.me },
    enemy: { ...players.enemy, statuses: stats.enemy },
    hand,
    incomingCards,
    buyCandidates,
    seenMiracles: {
      me: Array.from(globals.mySeenMiracles),
      enemy: Array.from(globals.enemySeenMiracles),
    },
  };
}

export function createStateReader() {
  return {
    readState,
    readMiraclesFromView,
    findMiraclesButton,
    findExchangeButtons,
    findBuyHitboxesPair,
    findBuyHitbox,
    findDetailPanel,
    getMeIsTop,
    hasClickableHand,
    diagnose,
    clearDebugOverlays,
  };
}
