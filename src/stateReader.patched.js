import { globals } from "../globals.js";
import * as logger from "../utils/logger.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


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

// stateReader.js (完成版)

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
  for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
    const r = p.getBoundingClientRect();
    const t = (p.textContent || "").replace(/\s+/g, "");
    if (r.width <= 360 && r.width >= 320 &&   r.height <= 50 && r.height >= 30 &&   /HP\d+MP\d+¥\d+/.test(t)) return p;
  }
  return null;
}

function rectKey(el) {
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
}

function readPlayers() {
  if (globals.isCheckingMiracles) return globals.lastPlayers ?? null;

  const hits = Array.from(document.querySelectorAll("div, span"))
    .filter(el => /HP/.test(el.textContent) && /MP/.test(el.textContent) && /¥/.test(el.textContent));

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

  huds.sort((a,b)=>b.area-a.area);
  if (huds.length < 2) return globals.lastPlayers ?? null;

  let a = huds[0].el;
  let b = huds[1].el;

  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const cyA = ra.top + ra.height/2;
  const cyB = rb.top + rb.height/2;
  const vh = window.innerHeight;

  const horizontal = Math.abs(cyA - cyB) < Math.max(30, vh * 0.08);

  // me/enの割当：名前が入ってる方をme、それ以外は fallback
  const aHasMe = a.textContent.includes(globals.MY_NAME);
  const bHasMe = b.textContent.includes(globals.MY_NAME);

  let meRow, enRow;
  if (aHasMe && !bHasMe) { meRow = a; enRow = b; }
  else if (!aHasMe && bHasMe) { meRow = b; enRow = a; }
  else {
    // 名前で決められないとき：上下ならtop、左右ならleftで仮決め
    if (!horizontal) {
      meRow = (ra.top <= rb.top) ? a : b;
      enRow = (meRow === a) ? b : a;
    } else {
      meRow = (ra.left <= rb.left) ? a : b;
      enRow = (meRow === a) ? b : a;
    }
  }

  globals.lastMeRowEl = meRow;
  globals.lastEnemyRowEl = enRow;

  // meIsTopLastKnownは「上下配置が確実なときだけ更新」
  if (!horizontal) globals.meIsTopLastKnown = meRow.getBoundingClientRect().top < enRow.getBoundingClientRect().top;

  const parse = (row) => {
    const m = row.textContent.replace(/\s+/g, "").match(/HP(\d+)MP(\d+)¥(\d+)/);
    return m ? { hp: parseInt(m[1]), mp: parseInt(m[2]), gold: parseInt(m[3]) } : null;
  };

  const mStat = parse(meRow);
  const eStat = parse(enRow);
  if (!mStat || !eStat) return globals.lastPlayers ?? null;

  globals.lastPlayers = {
    me: { name: globals.MY_NAME, ...mStat },
    enemy: { name: "Enemy", ...eStat },
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
      const bg = window.getComputedStyle(el).backgroundImage;
      return el.tagName === "IMG" || (bg && bg !== "none");
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

        const bg = window.getComputedStyle(el).backgroundImage;
        return el.tagName === "IMG" || (bg && bg !== "none");
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

function readHand(phase) {
  const detail = findDetailPanel();
  const root = document.querySelector("#main");
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const labels = Array.from(root.querySelectorAll("div, span")).filter((el) => {
    if (detail && detail.contains(el)) return false;
    return /^(攻[0-9]+|守[0-9]+|\+攻[0-9]+|¥[0-9]+)$/.test(
      el.textContent.trim(),
    );
  });
  const cards = Array.from(root.querySelectorAll("div")).filter((el) => {
    if (detail && detail.contains(el)) return false;
    const st = window.getComputedStyle(el);
    if (!st.backgroundImage || st.backgroundImage === "none") return false;
    const r = el.getBoundingClientRect();
    if (r.top + r.height / 2 < vh * 0.5) return false;
    if (r.left + r.width / 2 > vw * 0.85) return false;
    if (r.width < 50 || r.width > 100) return false;
    return true;
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
      if (dy > -10 && dy < 80 && Math.abs(lr.left - u.r.left) < 40) {
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
  hoverWithReset(el);
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
  let p = el;
  while (p && p.tagName !== "BODY") {
    const s = window.getComputedStyle(p);
    if (s.width === "80px" && s.height === "100px") break;
    p = p.parentElement;
  }
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
  const full = readDetailPanelTextAfterHover(el, { retries: 3 });
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
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const ZONES = {
    left: { minX: vw * 0.05, maxX: vw * 0.2, minY: vh * 0.1, maxY: vh * 0.42 },
    right: { minX: vw * 0.25, maxX: vw * 0.5, minY: vh * 0.1, maxY: vh * 0.42 },
  };

  const cards = Array.from(root.querySelectorAll("div"))
    .map((el) => {
      const s = window.getComputedStyle(el);
      if (!s.backgroundImage || s.backgroundImage === "none") return null;

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

  const zone = {
    minX: vw * 0.3,
    maxX: vw * 0.55,
    minY: vh * 0.05,
    maxY: vh * 0.45,
  };

  const rawCards = Array.from(root.querySelectorAll("div"))
    .map((el) => {
      const s = window.getComputedStyle(el);
      if (!s.backgroundImage || s.backgroundImage === "none") return null;

      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      if (
        cx < zone.minX ||
        cx > zone.maxX ||
        cy < zone.minY ||
        cy > zone.maxY
      ) {
        return null;
      }

      if (r.width < 50 || r.width > 140) return null;
      if (r.height < 60 || r.height > 180) return null;

      return { el, r };
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

  unique.sort((a, b) => a.r.top - b.r.top);
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
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  const cards = Array.from(root.querySelectorAll("div")).filter((el) => {
    if (detail && detail.contains(el)) return false;

    const st = window.getComputedStyle(el);
    if (!st.backgroundImage || st.backgroundImage === "none") return false;

    const r = el.getBoundingClientRect();
    if (r.top + r.height / 2 < vh * 0.5) return false;
    if (r.left + r.width / 2 > vw * 0.85) return false;
    if (r.width < 50 || r.width > 100) return false;
    if (r.height < 60 || r.height > 140) return false;

    return true;
  });

  return cards.length > 0;
}

function detectPhase() {
  const buttons = Array.from(document.querySelectorAll("button, div, span"));
  const hasPray = buttons.some((el) => el.textContent.includes("祈る"));
  const hasForgive = buttons.some((el) => el.textContent.includes("許す"));

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
    const now = performance.now();

    if (!globals.forgiveVisibleAt) {
      globals.forgiveVisibleAt = now;
      return "other";
    }

    const elapsed = now - globals.forgiveVisibleAt;
    if (elapsed >= 2000) {
      return "defense";
    } else {
      return "other";
    }
  } else {
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
  };
}
