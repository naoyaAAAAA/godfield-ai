(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/globals.js
  var globals = {
    MY_NAME: "AI",
    lastMeRowEl: null,
    lastEnemyRowEl: null,
    lastHandDomElements: [],
    isDoingAction: false,
    lastPhase: null,
    lastHandSig: null,
    lastBuySig: null,
    lastDefensePhaseStartedAt: 0,
    forgiveVisibleAt: 0,
    lastActionFinishTime: 0,
    lastAttackSig: [],
    lastAttackZone: null,
    lastState: null,
    isCheckingMiracles: false,
    uiQueue: Promise.resolve(),
    deferredAction: null,
    // { action, sig }
    lastMiracleCheckTime: 0,
    mySeenMiracles: /* @__PURE__ */ new Set(),
    enemySeenMiracles: /* @__PURE__ */ new Set(),
    MIRACLE_CHECK_INTERVAL_MS: 2e4,
    // globals.js
    meIsTopLastKnown: null,
    lockedMeIsTop: null,
    lastNonOtherAt: 0,
    defenseIncomingEmptySince: 0,
    burstUntil: 0,
    lastStateSig: "",
    lastProgressAt: 0,
    forgiveLastSeenAt: 0,
    lastHoverEl: null
    // last element we hovered for detail panel
  };

  // src/utils/logger.js
  var logger_exports = {};
  __export(logger_exports, {
    debug: () => debug,
    error: () => error,
    log: () => log
  });
  function log(...args) {
    console.log(...args);
  }
  function error(...args) {
    console.error(...args);
  }
  function debug(...args) {
    if (console.debug) {
      console.debug(...args);
    } else {
      console.log(...args);
    }
  }

  // src/utils/async.js
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function createWithActionLock(globals2) {
    return async function withActionLock2(actionName, asyncFn) {
      if (globals2.isDoingAction) {
        log(`[GF AI] Skipped ${actionName}: action already in progress.`);
        return;
      }
      globals2.isDoingAction = true;
      try {
        log(`[GF AI] Start Action: ${actionName}`);
        await asyncFn();
      } catch (e) {
        error(`[GF AI] Error in ${actionName}:`, e);
      } finally {
        await sleep(500);
        globals2.lastActionFinishTime = Date.now();
        globals2.isDoingAction = false;
        log(`[GF AI] End Action: ${actionName} (Lock released)`);
      }
    };
  }

  // src/executors/clickHelpers.js
  function clickPoint(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) {
      console.warn("[ClickDebug] \u30AF\u30EA\u30C3\u30AF\u5BFE\u8C61\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F (null)");
      return;
    }
    const evInit = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(
      (type) => {
        target.dispatchEvent(new MouseEvent(type, evInit));
      }
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
          rect.left + rect.width * 0.8
        ];
        const ys = [rect.top + rect.height * 0.35, rect.top + rect.height * 0.65];
        log("[GF AI] click self name row sweep", {
          target,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
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
  function createClickHelpers() {
    return { clickPoint, clickElementCenter, clickTargetsForPhase };
  }

  // src/executors/actions.js
  function createActions({
    withActionLock: withActionLock2,
    sleep: sleep3,
    clickElementCenter: clickElementCenter2,
    clickTargetsForPhase: clickTargetsForPhase2,
    findExchangeButtons: findExchangeButtons2,
    findBuyHitboxesPair: findBuyHitboxesPair2
  }) {
    async function useCardIndices(indices, phase, target) {
      if (!indices || !indices.length) {
        await withActionLock2("pass", async () => {
          clickTargetsForPhase2(phase, target);
          await sleep3(500);
        });
        return;
      }
      await withActionLock2(`useCardIndices(${phase})`, async () => {
        for (const idx of indices) {
          const el = globals.lastHandDomElements[idx];
          if (!el) continue;
          clickElementCenter2(el);
          await sleep3(400);
        }
        clickTargetsForPhase2(phase, target);
        await sleep3(800);
      });
    }
    async function performUru(indices, state) {
      if (!indices || indices.length < 2) return;
      const sellIdx = indices[0];
      const targetIdx = indices[1];
      const sellEl = globals.lastHandDomElements[sellIdx];
      const targetEl = globals.lastHandDomElements[targetIdx];
      if (!sellEl || !targetEl) return;
      await withActionLock2("performUru", async () => {
        clickElementCenter2(sellEl);
        await sleep3(300);
        clickElementCenter2(targetEl);
        await sleep3(300);
        clickTargetsForPhase2(state.phase);
        await sleep3(800);
      });
    }
    async function performKau(indices, state) {
      if (!indices || !indices.length) return;
      const kauIdx = indices[0];
      const el = globals.lastHandDomElements[kauIdx];
      if (!el) return;
      await withActionLock2("performKau", async () => {
        clickElementCenter2(el);
        await sleep3(400);
        clickTargetsForPhase2(state.phase);
        await sleep3(800);
      });
    }
    async function performRyougae(indices, state, exchangePlan) {
      if (!indices || !indices.length) return;
      const idx = indices[0];
      const el = globals.lastHandDomElements[idx];
      if (!el) return;
      await withActionLock2("performRyougae", async () => {
        clickElementCenter2(el);
        await sleep3(600);
        if (!exchangePlan) {
          clickTargetsForPhase2(state.phase);
          return;
        }
        let buttons = null;
        for (let i = 0; i < 20; i++) {
          buttons = findExchangeButtons2();
          if (buttons && buttons.mp && buttons.gold) break;
          await sleep3(200);
        }
        if (!buttons) {
          clickTargetsForPhase2(state.phase);
          return;
        }
        const curMp = state.me.mp || 0;
        const curGold = state.me.gold || 0;
        const targetMp = exchangePlan.mp;
        const targetGold = exchangePlan.gold;
        adjustExchangeColumn(
          curMp,
          targetMp,
          buttons.mp,
          "MP",
          clickElementCenter2
        );
        adjustExchangeColumn(
          curGold,
          targetGold,
          buttons.gold,
          "GOLD",
          clickElementCenter2
        );
        await sleep3(400);
        clickTargetsForPhase2(state.phase);
        await sleep3(800);
      });
    }
    function handleBuyChoice(ai) {
      if (ai.buy === 1) clickBuyYesAsync();
      else clickBuyNoAsync();
    }
    async function clickBuyYesAsync() {
      await withActionLock2("clickBuyYes", async () => {
        const MAX_RETRY = 15;
        for (let i = 0; i < MAX_RETRY; i++) {
          const { yes } = findBuyHitboxesPair2();
          if (yes) {
            clickElementCenter2(yes);
            await sleep3(500);
            return;
          }
          await sleep3(200);
        }
      });
    }
    async function clickBuyNoAsync() {
      await withActionLock2("clickBuyNo", async () => {
        const MAX_RETRY = 15;
        for (let i = 0; i < MAX_RETRY; i++) {
          const { no } = findBuyHitboxesPair2();
          if (no) {
            clickElementCenter2(no);
            await sleep3(500);
            return;
          }
          await sleep3(200);
        }
      });
    }
    return {
      useCardIndices,
      performUru,
      performKau,
      performRyougae,
      handleBuyChoice,
      clickBuyYesAsync,
      clickBuyNoAsync
    };
  }
  function adjustExchangeColumn(current, target, btns, label, clickElementCenter2) {
    if (!btns) return;
    current = Number(current) || 0;
    target = Math.max(0, Number(target) || 0);
    let diff = target - current;
    let clicks = 0;
    const MAX = 40;
    const clickN = (el, n) => {
      if (!el || n <= 0) return;
      const times = Math.min(n, MAX - clicks);
      for (let i = 0; i < times; i++) {
        clickElementCenter2(el);
        clicks++;
      }
    };
    if (diff > 0) {
      clickN(btns.plus10, Math.floor(diff / 10));
      clickN(btns.plus1, diff % 10);
    } else if (diff < 0) {
      diff = -diff;
      clickN(btns.minus10, Math.floor(diff / 10));
      clickN(btns.minus1, diff % 10);
    }
  }

  // src/readers/stateReader.js
  var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  function fireMouseEvent(el, type, x, y) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y
        })
      );
    } catch (e) {
    }
  }
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
        pr.top + pr.height / 2
      );
    }
    fireMouseEvent(document.body, "mousemove", 1, 1);
    fireMouseEvent(document.body, "mouseover", 1, 1);
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
      if (full === beforeText) continue;
      break;
    }
    return full;
  }
  function findMiraclesButton() {
    const divs = Array.from(document.querySelectorAll("div"));
    const candidates = divs.filter((el) => {
      const s = window.getComputedStyle(el);
      return parseFloat(s.opacity) < 0.1 && s.position === "absolute";
    });
    return candidates.find((el) => {
      const w = parseFloat(window.getComputedStyle(el).width);
      return w >= 240 && w <= 260;
    }) || null;
  }
  function findDetailPanel() {
    const divs = Array.from(document.querySelectorAll("#main div"));
    const candidates = divs.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.backgroundColor === "rgb(221, 255, 204)" && el.getBoundingClientRect().width > 150;
    });
    if (!candidates.length) return null;
    candidates.sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
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
      if (r.width >= 320 && r.width <= 360 && r.height >= 30 && r.height <= 50 && looksLikeHud) return p;
    }
    return null;
  }
  function rectKey(el) {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
  }
  function readPlayers() {
    if (globals.isCheckingMiracles) return globals.lastPlayers ?? null;
    const hits = Array.from(document.querySelectorAll("div, span")).filter((el) => /HP/.test(el.textContent) && /MP/.test(el.textContent) && /¥/.test(el.textContent));
    const seen = /* @__PURE__ */ new Set();
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
    huds.sort((a2, b2) => b2.area - a2.area);
    if (huds.length < 2) return globals.lastPlayers ?? null;
    let a = huds[0].el;
    let b = huds[1].el;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const cyA = ra.top + ra.height / 2;
    const cyB = rb.top + rb.height / 2;
    const vh = window.innerHeight;
    const horizontal = Math.abs(cyA - cyB) < Math.max(30, vh * 0.08);
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
    if (!horizontal) globals.meIsTopLastKnown = meRow.getBoundingClientRect().top < enRow.getBoundingClientRect().top;
    const parseRow = (row) => {
      const m = row.textContent.replace(/\s+/g, "").match(/HP(\d+)MP(\d+)¥(\d+)/);
      return m ? { hp: +m[1], mp: +m[2], gold: +m[3] } : null;
    };
    const prev = globals.lastPlayers ?? {
      me: { name: globals.MY_NAME },
      enemy: { name: "Enemy" }
    };
    const mStat = meRow ? parseRow(meRow) : null;
    const eStat = enRow ? parseRow(enRow) : null;
    globals.lastPlayers = {
      me: { ...prev.me, name: globals.MY_NAME, ...mStat ?? {} },
      enemy: { ...prev.enemy, name: "Enemy", ...eStat ?? {} },
      // あると便利（LLMに「霧で相手ステ不明」を伝えられる）
      enemyStatsHidden: !eStat
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
        return el.tagName === "IMG" || bg && bg !== "none";
      }
    );
    const vh = window.innerHeight;
    const topSlots = [], botSlots = [];
    raw.forEach((el) => {
      const cy = el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
      if (cy < vh * 0.2) topSlots.push({ el, cx: 0, cy });
      else if (cy < vh * 0.4) botSlots.push({ el, cx: 0, cy });
    });
    const meIsTop = getMeIsTop(vh);
    const meRaw = meIsTop ? topSlots : botSlots;
    const enRaw = meIsTop ? botSlots : topSlots;
    return {
      me: readStatusesFromSlots(dedup(meRaw)),
      enemy: readStatusesFromSlots(dedup(enRaw))
    };
  }
  function dedup(slots) {
    const out = [];
    for (const s of slots) {
      const rect = s.el.getBoundingClientRect();
      const cx = rect.left;
      const cy = rect.top;
      if (!out.find((o) => Math.abs(o.cx - cx) < 10 && Math.abs(o.cy - cy) < 10)) {
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
      const lines = full.split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines.length)
        res.push({ name: lines[0], raw_text: lines.slice(1).join(" ") });
    }
    return res;
  }
  async function readMiracleNamesFromSlots(slots, sleep3) {
    const names = [];
    const detail0 = findDetailPanel();
    let lastFull = detail0 ? (detail0.innerText || "").trim() : "";
    if (globals.lastHandDomElements && globals.lastHandDomElements.length > 0) {
      globals.lastHandDomElements.forEach((el) => {
        try {
          el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        } catch (e) {
        }
      });
      await sleep3(20);
    }
    for (const s of slots) {
      s.el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await sleep3(50);
      s.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      s.el.click();
      await sleep3(150);
      let full = "";
      const t0 = performance.now();
      while (performance.now() - t0 < 700) {
        const d = findDetailPanel();
        if (d) {
          full = (d.innerText || "").trim();
          if (full) break;
        }
        await sleep3(70);
      }
      if (!full) continue;
      const lines = full.split("\n").map((x) => x.trim()).filter(Boolean);
      if (!lines.length) continue;
      const name = lines[0];
      if (name && !names.includes(name)) names.push(name);
      lastFull = full;
    }
    return names;
  }
  async function readMiraclesFromView() {
    const vh = window.innerHeight;
    const prev = globals.lockedMeIsTop;
    globals.lockedMeIsTop = globals.meIsTopLastKnown ?? globals.lockedMeIsTop ?? getMeIsTop(vh);
    try {
      const root = document.querySelector("#main") || document.body;
      const detail = findDetailPanel();
      const vw = window.innerWidth;
      const minX = vw * 0.45;
      const raw = Array.from(root.querySelectorAll("div, span, img")).filter(
        (el) => {
          if (detail && detail.contains(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.width > 60) return false;
          if (r.height < 10 || r.height > 60) return false;
          const cx = r.left + r.width / 2;
          if (cx < minX) return false;
          const bg = window.getComputedStyle(el).backgroundImage;
          return el.tagName === "IMG" || bg && bg !== "none";
        }
      );
      if (!raw.length) {
        log("[GF AI] no miracle icons found (raw=0)");
        return false;
      }
      const topSlots = [];
      const botSlots = [];
      raw.forEach((el) => {
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy < vh * 0.2) topSlots.push({ el, cx: 0, cy });
        else if (cy < vh * 0.5) botSlots.push({ el, cx: 0, cy });
      });
      const meIsTop = getMeIsTop(vh);
      log("[GF AI] meIsTop debug", {
        locked: globals.lockedMeIsTop,
        lastKnown: globals.meIsTopLastKnown,
        meTop: globals.lastMeRowEl?.getBoundingClientRect()?.top,
        enTop: globals.lastEnemyRowEl?.getBoundingClientRect()?.top
      });
      const meRaw = meIsTop ? topSlots : botSlots;
      const enRaw = meIsTop ? botSlots : topSlots;
      const meNames = await readMiracleNamesFromSlots(dedup(meRaw), sleep2);
      const enemyNames = await readMiracleNamesFromSlots(dedup(enRaw), sleep2);
      if (meRaw.length + enRaw.length > 0 && meNames.length + enemyNames.length === 0) {
        log("[GF AI] miracle icons found but names empty; keep previous", {
          raw: raw.length,
          top: topSlots.length,
          bot: botSlots.length,
          meIsTop
        });
        return false;
      }
      globals.mySeenMiracles.clear();
      globals.enemySeenMiracles.clear();
      meNames.forEach((n) => globals.mySeenMiracles.add(n));
      enemyNames.forEach((n) => globals.enemySeenMiracles.add(n));
      log("[GF AI] refresh miracles from view", {
        me: Array.from(globals.mySeenMiracles),
        enemy: Array.from(globals.enemySeenMiracles)
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
        el.textContent.trim()
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
      if (!uniqueEls.find(
        (u) => Math.abs(u.r.left - r.left) < 10 && Math.abs(u.r.top - r.top) < 10
      )) {
        uniqueEls.push({ el, r });
      }
    }
    uniqueEls.sort(
      (a, b) => Math.abs(a.r.top - b.r.top) < 20 ? a.r.left - b.r.left : a.r.top - b.r.top
    );
    const limited = uniqueEls.slice(0, 18);
    globals.lastHandDomElements = limited.map((u) => u.el);
    return limited.map((u, i) => {
      let bestL = null, bestD = 999;
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
        usable: info.usable
      };
    });
  }
  function readCardInfo(el, phase) {
    hoverWithReset(el);
    const d = findDetailPanel();
    let name = "", raw = "";
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
        return ms.backgroundColor === "rgb(0, 0, 0)" && parseFloat(ms.opacity) > 0.1;
      });
      if (masks.length) usable = false;
    }
    return { name, raw_text: raw, usable };
  }
  function readCardInfoForIncoming(el) {
    const full = readDetailPanelTextAfterHover(el, { retries: 3 });
    if (!full) return null;
    const lines = full.split("\n").map((s) => s.trim()).filter(Boolean);
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
      right: { minX: vw * 0.25, maxX: vw * 0.5, minY: vh * 0.1, maxY: vh * 0.42 }
    };
    const cards = Array.from(root.querySelectorAll("div")).map((el) => {
      const s = window.getComputedStyle(el);
      if (!s.backgroundImage || s.backgroundImage === "none") return null;
      const r = el.getBoundingClientRect();
      if (r.width < 50) return null;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const isLeft = cx > ZONES.left.minX && cx < ZONES.left.maxX && cy > ZONES.left.minY && cy < ZONES.left.maxY;
      const isRight = cx > ZONES.right.minX && cx < ZONES.right.maxX && cy > ZONES.right.minY && cy < ZONES.right.maxY;
      if (!isLeft && !isRight) return null;
      return { el, r, zone: isLeft ? "left" : "right" };
    }).filter(Boolean);
    const unique = [];
    for (const obj of cards) {
      const r = obj.r;
      const isDuplicate = unique.find(
        (u) => Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20
      );
      if (!isDuplicate) unique.push(obj);
    }
    unique.sort((a, b) => a.r.left - b.r.left);
    return unique.map((u, i) => {
      const info = readCardInfoForIncoming(u.el);
      if (!info) return null;
      const l = u.el.querySelector("span, div");
      const ov = l ? l.textContent : "";
      return {
        index: i,
        name: info.name,
        raw_text: info.raw_text,
        overlay: ov,
        zone: u.zone
      };
    }).filter(Boolean).map((c, i) => ({ ...c, index: i }));
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
      maxY: vh * 0.45
    };
    const rawCards = Array.from(root.querySelectorAll("div")).map((el) => {
      const s = window.getComputedStyle(el);
      if (!s.backgroundImage || s.backgroundImage === "none") return null;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < zone.minX || cx > zone.maxX || cy < zone.minY || cy > zone.maxY) {
        return null;
      }
      if (r.width < 50 || r.width > 140) return null;
      if (r.height < 60 || r.height > 180) return null;
      return { el, r };
    }).filter(Boolean);
    if (!rawCards.length) return [];
    const unique = [];
    for (const obj of rawCards) {
      const r = obj.r;
      const dup = unique.find(
        (u) => Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20
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
        overlay
      }
    ];
  }
  function getMeIsTop(vh) {
    if (globals.lockedMeIsTop !== null) return globals.lockedMeIsTop;
    if (globals.lastMeRowEl && globals.lastEnemyRowEl) {
      return globals.lastMeRowEl.getBoundingClientRect().top < globals.lastEnemyRowEl.getBoundingClientRect().top;
    }
    if (globals.meIsTopLastKnown !== null) return globals.meIsTopLastKnown;
    if (globals.lastMeRowEl) {
      return globals.lastMeRowEl.getBoundingClientRect().top < vh * 0.2;
    }
    return true;
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
    const hasPray = buttons.some((el) => el.textContent.includes("\u7948\u308B"));
    const hasForgiveRaw = buttons.some((el) => el.textContent.includes("\u8A31\u3059"));
    const now = performance.now();
    const GRACE_MS = 1500;
    if (hasForgiveRaw) globals.forgiveLastSeenAt = now;
    const hasForgive = hasForgiveRaw || globals.forgiveLastSeenAt && now - globals.forgiveLastSeenAt < GRACE_MS;
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
      return elapsed >= 2e3 ? "defense" : "other";
    } else {
      globals.forgiveVisibleAt = 0;
    }
    return "other";
  }
  function findBuyHitbox() {
    const divs = Array.from(document.querySelectorAll("div"));
    const strict = divs.filter((el) => {
      const s = (el.getAttribute("style") || "").replace(/\s+/g, "");
      return s.includes("width:300px") && s.includes("height:90px") && s.includes("opacity:0") && s.includes("background-color:rgb(255,255,255)");
    });
    if (strict.length) {
      strict.sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      );
      return strict[0];
    }
    const winW = window.innerWidth || document.documentElement.clientWidth;
    const cand = divs.map((el) => ({
      el,
      r: el.getBoundingClientRect(),
      cs: getComputedStyle(el)
    })).filter(
      ({ r }) => r.width > 260 && r.width < 340 && r.height > 80 && r.height < 100
    ).filter(({ r }) => r.left < winW * 0.6).filter(({ cs }) => {
      const op = parseFloat(cs.opacity || "1");
      const pe = cs.pointerEvents || "auto";
      return op <= 0.1 && pe !== "none";
    }).sort((a, b) => a.r.top - b.r.top);
    return cand.length ? cand[0].el : null;
  }
  function findBuyHitboxesPair() {
    const divs = Array.from(document.querySelectorAll("div"));
    const strict = divs.filter((el) => {
      const s = (el.getAttribute("style") || "").replace(/\s+/g, "");
      return s.includes("width:300px") && s.includes("height:90px") && s.includes("opacity:0") && s.includes("background-color:rgb(255,255,255)");
    });
    if (strict.length >= 2) {
      strict.sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      );
      const yes2 = strict[0];
      const no2 = strict[strict.length - 1];
      return { yes: yes2, no: no2 };
    }
    const winW = window.innerWidth || document.documentElement.clientWidth;
    const cand = divs.map((el) => ({
      el,
      r: el.getBoundingClientRect(),
      cs: getComputedStyle(el)
    })).filter(
      ({ r }) => r.width > 260 && r.width < 340 && r.height > 80 && r.height < 100
    ).filter(({ r }) => r.left < winW * 0.6).filter(({ cs }) => {
      const op = parseFloat(cs.opacity || "1");
      const pe = cs.pointerEvents || "auto";
      return op <= 0.1 && pe !== "none";
    }).sort((a, b) => a.r.top - b.r.top);
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
        let g = groups.find((g2) => Math.abs(g2.cy - c.cy) <= 20);
        if (!g) groups.push({ cy: c.cy, items: [c] });
        else g.items.push(c);
      }
      if (groups.length < 4) return null;
      groups.sort((a, b) => a.cy - b.cy);
      return {
        plus10: groups[0].items[0].el,
        plus1: groups[1].items[0].el,
        minus1: groups[2].items[0].el,
        minus10: groups[3].items[0].el
      };
    }
    const mpBtns = mapColumn(leftCol);
    const goldBtns = mapColumn(rightCol);
    if (!mpBtns || !goldBtns) return null;
    return { mp: mpBtns, gold: goldBtns };
  }
  function readState() {
    if (globals.isCheckingMiracles) return null;
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
        enemy: Array.from(globals.enemySeenMiracles)
      }
    };
  }
  function createStateReader() {
    return {
      readState,
      readMiraclesFromView,
      findMiraclesButton,
      findExchangeButtons,
      findBuyHitboxesPair,
      findBuyHitbox,
      findDetailPanel,
      getMeIsTop,
      hasClickableHand
    };
  }

  // src/uiQueue.js
  function enqueueUI(job) {
    globals.uiQueue = globals.uiQueue.then(job).catch((e) => console.error("[GF AI] UI job failed:", e));
    return globals.uiQueue;
  }

  // src/logic/phaseGuards.js
  function createPhaseGuards({
    sleep: sleep3,
    withActionLock: withActionLock2,
    findMiraclesButton: findMiraclesButton2,
    clickElementCenter: clickElementCenter2,
    readMiraclesFromView: readMiraclesFromView2
  }) {
    async function checkMiracles() {
      await withActionLock2("checkMiracles", async () => {
        const btn = findMiraclesButton2?.();
        if (!btn) {
          log("[GF AI] miracles button not found");
          return;
        }
        clickElementCenter2(btn);
        await sleep3(600);
        const ok = await readMiraclesFromView2?.();
        if (!ok) {
          log("[GF AI] miracle view opened but icons still not found");
        }
        clickElementCenter2(btn);
        await sleep3(400);
        globals.lastMiracleCheckTime = Date.now();
      });
    }
    async function checkMiraclesOnce() {
      await enqueueUI(async () => {
        globals.isCheckingMiracles = true;
        try {
          await checkMiracles();
        } finally {
          globals.isCheckingMiracles = false;
        }
      });
      if (typeof globals.flushDeferredAction === "function") {
        await globals.flushDeferredAction();
      }
    }
    function maybeCheckMiracles(state) {
      if (!state) return;
      if (globals.isDoingAction || globals.isCheckingMiracles) return;
      if (state.phase !== "attack") return;
      const now = Date.now();
      if (now - globals.lastMiracleCheckTime < globals.MIRACLE_CHECK_INTERVAL_MS)
        return;
      checkMiraclesOnce();
    }
    function updatePhaseTiming(state) {
      if (state.phase === "defense" && globals.lastPhase !== "defense") {
        globals.lastDefensePhaseStartedAt = performance.now();
      }
    }
    function enemyHasYume(state) {
      return (state.enemy?.statuses || []).some((s) => s.name === "\u5922");
    }
    function isHarmlessTradeIncoming(incoming) {
      if (!incoming || !incoming.length) {
        return false;
      }
      const names = incoming.map((c) => c.name || "");
      if (incoming.length === 1 && names[0].includes("\u58F2\u308B")) {
        return true;
      }
      if (incoming.length === 1 && names[0].includes("\u8A31\u3059")) {
        return true;
      }
      if (incoming.length === 2 && names.some((n) => n.includes("\u8CB7\u3046"))) {
        return true;
      }
      return false;
    }
    function isLikelyMyAttackEchoNoReflect(incoming) {
      if (!globals.lastAttackSig.length) return false;
      if (!incoming || !incoming.length) return false;
      const zones = Array.from(
        new Set(incoming.map((c) => c.zone).filter(Boolean))
      );
      if (zones.length !== 1) return false;
      const incZone = zones[0];
      if (incoming.length !== globals.lastAttackSig.length) return false;
      const incSig = incoming.map((c) => ({
        name: c.name,
        overlay: c.overlay || ""
      }));
      const namesMatch = incSig.every(
        (x) => globals.lastAttackSig.some((y) => y.name === x.name)
      ) && globals.lastAttackSig.every((x) => incSig.some((y) => y.name === x.name));
      if (!namesMatch) return false;
      const allHaveOverlay = incSig.every((x) => x.overlay) && globals.lastAttackSig.every((x) => x.overlay);
      if (allHaveOverlay) {
        const overlayMatch = incSig.every(
          (x) => globals.lastAttackSig.some(
            (y) => y.name === x.name && y.overlay === x.overlay
          )
        );
        if (!overlayMatch) return false;
      }
      if (globals.lastAttackZone === null) {
        globals.lastAttackZone = incZone;
        return true;
      }
      return incZone === globals.lastAttackZone;
    }
    function rememberLastAttackSig(indices, hand) {
      const byIndex = new Map((hand || []).map((c) => [c.index, c]));
      globals.lastAttackSig = (indices || []).map((i) => byIndex.get(i)).filter(Boolean).map((c) => ({ name: c.name, overlay: c.overlay || "" }));
      globals.lastAttackZone = null;
    }
    function shouldActNow(state) {
      updatePhaseTiming(state);
      const DEFENSE_COOLDOWN_MS = 3e3;
      if (state.phase === "defense" && enemyHasYume(state)) {
        const elapsed = performance.now() - globals.lastDefensePhaseStartedAt;
        if (elapsed < 3e3) return false;
      }
      if (globals.isDoingAction) return false;
      if (state.phase === "defense") {
        if (!state.incomingCards || state.incomingCards.length === 0) {
          log("[GF AI] defense but incoming empty -> wait");
          return false;
        }
        if (isHarmlessTradeIncoming(state.incomingCards)) {
          log(
            "[GF AI] skip defense (trade animation only)",
            state.incomingCards
          );
          globals.lastActionFinishTime = Date.now();
          return false;
        }
        const timeSinceAction = Date.now() - globals.lastActionFinishTime;
        if (timeSinceAction < DEFENSE_COOLDOWN_MS) {
          log(`[GF AI] Cooling down... (${timeSinceAction}ms / 3000ms)`);
          return false;
        }
      }
      if (state.phase === "buy_choice") {
        const cand = state.buyCandidates && state.buyCandidates[0] || null;
        const sig = cand ? `${cand.name}:${cand.overlay}` : "";
        if (globals.lastPhase === "buy_choice" && sig === globals.lastBuySig)
          return false;
        globals.lastPhase = "buy_choice";
        globals.lastBuySig = sig;
        globals.lastHandSig = null;
        return true;
      }
      if (state.phase !== "attack" && state.phase !== "defense") return false;
      const handSig = (state.hand || []).map((c) => `${c.name}:${c.overlay}`).join("|");
      if (state.phase === globals.lastPhase && handSig === globals.lastHandSig)
        return false;
      globals.lastPhase = state.phase;
      globals.lastHandSig = handSig;
      return true;
    }
    return {
      shouldActNow,
      updatePhaseTiming,
      isHarmlessTradeIncoming,
      isLikelyMyAttackEchoNoReflect,
      rememberLastAttackSig,
      maybeCheckMiracles
    };
  }

  // src/transport/serverClient.js
  function stateSigForDefer(state) {
    if (!state) return "";
    if (state.phase === "buy_choice") {
      const c = state.buyCandidates && state.buyCandidates[0];
      return `buy:${c ? `${c.name}:${c.overlay}` : ""}`;
    }
    const handSig = (state.hand || []).map((c) => `${c.name}:${c.overlay}`).join("|");
    const incSig = (state.incomingCards || []).map((c) => `${c.name}:${c.overlay || ""}`).join("|");
    return `${state.phase}|${handSig}|${incSig}`;
  }
  function createServerClient({ rememberLastAttackSig, actions: actions2 }) {
    function buildServerState(state) {
      return {
        phase: state.phase,
        me: state.me,
        enemy: state.enemy,
        hand: (state.hand || []).map((c) => ({
          index: c.index,
          overlay: c.overlay || "",
          name: c.name || "",
          raw_text: c.raw_text || "",
          usable: c.usable
        })),
        incomingCards: (state.incomingCards || []).map((c, idx) => ({
          index: typeof c.index === "number" ? c.index : idx,
          overlay: c.overlay || "",
          name: c.name || "",
          raw_text: c.raw_text || ""
        })),
        buyCandidate: state.buyCandidates && state.buyCandidates[0] ? {
          index: state.buyCandidates[0].index ?? 0,
          overlay: state.buyCandidates[0].overlay || "",
          name: state.buyCandidates[0].name || "",
          raw_text: state.buyCandidates[0].raw_text || ""
        } : null,
        seenMiracles: {
          me: Array.from(globals.mySeenMiracles),
          enemy: Array.from(globals.enemySeenMiracles)
        }
      };
    }
    if (typeof globals.flushDeferredAction !== "function") {
      globals.flushDeferredAction = async () => {
        const d = globals.deferredAction;
        if (!d) return;
        if (globals.isCheckingMiracles || globals.isDoingAction) return;
        if (d.createdAt && Date.now() - d.createdAt > 5e3) {
          globals.deferredAction = null;
          return;
        }
        globals.deferredAction = null;
        const now = globals.lastState;
        const useNow = now && stateSigForDefer(now) === d.sig;
        const st = useNow ? now : d.stateSnapshot;
        const type = d.ai.type;
        const indices = d.ai.cardIndices || [];
        const target = d.ai.target || void 0;
        if (type === "attack") {
          rememberLastAttackSig(indices, st.hand);
        }
        if (type === "buy_choice") actions2.handleBuyChoice(d.ai);
        else if (type === "exchange")
          actions2.performRyougae(indices, st, d.ai.exchange);
        else if (type === "sell") actions2.performUru(indices, st);
        else if (type === "buy") actions2.performKau(indices, st);
        else if (type === "attack" || type === "defend" || type === "shield")
          actions2.useCardIndices(indices, st.phase, target);
        else if (type === "attack-pass" || type === "defense-pass")
          actions2.useCardIndices([], st.phase, target);
      };
    }
    function sendStateToServer(state) {
      const payload = buildServerState(state);
      GM_xmlhttpRequest({
        method: "POST",
        url: "http://127.0.0.1:8000/decide",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: (response) => {
          try {
            const ai = JSON.parse(response.responseText);
            if (globals.isCheckingMiracles || globals.isDoingAction) {
              const sig = stateSigForDefer(state);
              globals.deferredAction = {
                ai,
                sig,
                stateSnapshot: state,
                createdAt: Date.now()
              };
              log("[GF AI] deferred server response", sig);
              return;
            }
            log("[GF AI SERVER RESPONSE]", ai);
            const type = ai.type;
            const indices = ai.cardIndices || [];
            const target = ai.target || void 0;
            if (type === "attack") {
              rememberLastAttackSig(indices, state.hand);
            }
            if (type === "buy_choice") actions2.handleBuyChoice(ai);
            else if (type === "exchange")
              actions2.performRyougae(indices, state, ai.exchange);
            else if (type === "sell") actions2.performUru(indices, state);
            else if (type === "buy") actions2.performKau(indices, state);
            else if (type === "attack" || type === "defend" || type === "shield")
              actions2.useCardIndices(indices, state.phase, target);
            else if (type === "attack-pass" || type === "defense-pass")
              actions2.useCardIndices([], state.phase, target);
          } catch (e) {
            error("[GF AI CLIENT ERROR]", e);
          }
        },
        onerror: (err) => {
          error("[GF AI SERVER ERROR]", err);
        }
      });
    }
    return { sendStateToServer };
  }

  // src/transport/pollingLoop.js
  function createPollingLoop({
    globals: globals2,
    logger,
    readState: readState2,
    shouldActNow,
    sendStateToServer,
    maybeCheckMiracles,
    escapeDefensePass
    // ★追加（任意）
  }) {
    let tickRunning = false;
    function stateSig(state) {
      if (!state) return "";
      const handSig = (state.hand || []).map((c) => `${c.name}:${c.overlay}`).join("|");
      const incSig = (state.incomingCards || []).map((c) => `${c.name}:${c.overlay || ""}`).join("|");
      const buy = state.buyCandidates && state.buyCandidates[0];
      const buySig = buy ? `${buy.name}:${buy.overlay}` : "";
      return `${state.phase}|${handSig}|${incSig}|${buySig}`;
    }
    async function tick() {
      if (tickRunning) return;
      tickRunning = true;
      try {
        const state = readState2();
        if (!state) return;
        globals2.lastState = state;
        const now = Date.now();
        const sig = stateSig(state);
        if (sig !== globals2.lastStateSig) {
          globals2.lastStateSig = sig;
          globals2.lastProgressAt = now;
        }
        if (state.phase !== "other") {
          globals2.lastNonOtherAt = now;
        }
        if (state.phase === "defense" && (!state.incomingCards || state.incomingCards.length === 0)) {
          if (!globals2.defenseIncomingEmptySince) globals2.defenseIncomingEmptySince = now;
          globals2.burstUntil = Math.max(globals2.burstUntil, now + 1500);
        } else {
          globals2.defenseIncomingEmptySince = 0;
        }
        if (state.phase === "other") {
          const otherFor = globals2.lastNonOtherAt ? now - globals2.lastNonOtherAt : 0;
          if (otherFor > 2500) {
            globals2.burstUntil = Math.max(globals2.burstUntil, now + 2500);
          }
        }
        if (state.phase === "defense" && globals2.defenseIncomingEmptySince && now - globals2.defenseIncomingEmptySince > 4500) {
          logger.log("[GF AI] watchdog: defense incoming empty too long -> pass");
          if (escapeDefensePass) {
            escapeDefensePass().catch(() => {
            });
          } else {
            sendStateToServer(state);
          }
          globals2.defenseIncomingEmptySince = now;
          return;
        }
        if (shouldActNow(state)) {
          sendStateToServer(state);
        }
        maybeCheckMiracles(state);
        if (typeof globals2.flushDeferredAction === "function") {
          globals2.flushDeferredAction().catch(() => {
          });
        }
      } catch (e) {
        logger.error("readState error", e);
      } finally {
        tickRunning = false;
      }
    }
    function startLoop() {
      setInterval(() => {
        tick().catch(() => {
        });
      }, 1e3);
      setInterval(() => {
        if (Date.now() < globals2.burstUntil) tick().catch(() => {
        });
      }, 250);
    }
    return { startLoop };
  }

  // src/index.js
  var withActionLock = createWithActionLock(globals);
  var clickHelpers = createClickHelpers();
  var stateReader = createStateReader();
  var phaseGuards = createPhaseGuards({
    sleep,
    withActionLock,
    findMiraclesButton: stateReader.findMiraclesButton,
    clickElementCenter: clickHelpers.clickElementCenter,
    readMiraclesFromView: stateReader.readMiraclesFromView
  });
  var actions = createActions({
    withActionLock,
    sleep,
    clickElementCenter: clickHelpers.clickElementCenter,
    clickTargetsForPhase: clickHelpers.clickTargetsForPhase,
    findExchangeButtons: stateReader.findExchangeButtons,
    findBuyHitboxesPair: stateReader.findBuyHitboxesPair
  });
  var serverClient = createServerClient({
    rememberLastAttackSig: phaseGuards.rememberLastAttackSig,
    actions
  });
  var pollingLoop = createPollingLoop({
    globals,
    logger: logger_exports,
    readState: stateReader.readState,
    shouldActNow: phaseGuards.shouldActNow,
    sendStateToServer: serverClient.sendStateToServer,
    maybeCheckMiracles: phaseGuards.maybeCheckMiracles,
    escapeDefensePass: () => actions.useCardIndices([], "defense")
  });
  (function init() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    log("[GF] bundle loaded", now);
    pollingLoop.startLoop();
  })();
})();
