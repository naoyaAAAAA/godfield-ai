// ==UserScript==
// @name         Godfield AI
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  ゴッドフィールドAI (Ver1.3 Logic + 2.0s Cooldown)
// @match        https://godfield.net/*
// @match        https://www.godfield.net/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// ==/UserScript==

(function () {
  "use strict";
  const MY_NAME = "AI";

  // ★ DOMキャッシュ
  let lastMeRowEl = null;
  let lastEnemyRowEl = null;
  let lastHandDomElements = [];

  // ★ 状態管理
  let isDoingAction = false;
  let lastPhase = null;
  let lastHandSig = null;
  let lastBuySig = null;
  let lastDefensePhaseStartedAt = 0;
  // 「許す」が見え始めた時刻（防御フェーズ判定用）
  let forgiveVisibleAt = 0;
  let lastActionFinishTime = 0;
  // ★ 自分の直前攻撃シグネチャ
  let lastAttackSig = [];
  // ★ 直前攻撃の「演出側」（'left' / 'right'）。反射判定に使う
  let lastAttackZone = null;
  let lastState = null;
  // ★ 奇跡ビュー関連
  let isCheckingMiracles = false;
  let lastMiracleCheckTime = 0;
  let mySeenMiracles = new Set();
  let enemySeenMiracles = new Set();
  const MIRACLE_CHECK_INTERVAL_MS = 20000; // 20秒に1回くらいチェック

  // ========================================================================
  // 1. Utility: Async / Locking
  // ========================================================================

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function withActionLock(actionName, asyncFn) {
    if (isDoingAction) {
      console.log(`[GF AI] Skipped ${actionName}: action already in progress.`);
      return;
    }
    isDoingAction = true;
    try {
      console.log(`[GF AI] Start Action: ${actionName}`);
      await asyncFn();
    } catch (e) {
      console.error(`[GF AI] Error in ${actionName}:`, e);
    } finally {
      await sleep(500);

      // ★重要: アクションが終わった時刻を記録
      lastActionFinishTime = Date.now();

      isDoingAction = false;
      console.log(`[GF AI] End Action: ${actionName} (Lock released)`);
    }
  }
  function findMiraclesButton() {
    const candidates = Array.from(
      document.querySelectorAll("button, div, span"),
    ).filter((el) => el.textContent.includes("起こした奇跡"));
    if (!candidates.length) return null;
    // 一番幅が広いものを採用（ボタン本体っぽいやつ）
    candidates.sort(
      (a, b) =>
        b.getBoundingClientRect().width - a.getBoundingClientRect().width,
    );
    return candidates[0];
  }

  async function checkMiraclesOnce() {
    const btn = findMiraclesButton();
    if (!btn) {
      console.log("[GF AI] miracles button not found");
      return;
    }

    await withActionLock("checkMiracles", async () => {
      isCheckingMiracles = true;
      lastMiracleCheckTime = Date.now();

      // ビューを開く
      clickElementCenter(btn);
      await sleep(400);

      try {
        readMiraclesFromView();
      } catch (e) {
        console.error("[GF AI] error in readMiraclesFromView", e);
      }

      // 元の HP/MP 表示に戻す
      clickElementCenter(btn);
      await sleep(400);

      isCheckingMiracles = false;
    });
  }

  function maybeCheckMiracles(state) {
    if (!state) return;
    if (isDoingAction || isCheckingMiracles) return;
    if (state.phase !== "attack") return; // 防御中などは触らない

    const now = Date.now();
    if (now - lastMiracleCheckTime < MIRACLE_CHECK_INTERVAL_MS) return;

    checkMiraclesOnce();
  }

  // ========================================================================
  // 2. DOM Interaction / Clicking
  // ========================================================================

  function clickPoint(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) return;
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
    if (phase === "attack" && target && lastState) {
      let row = null;

      if (target === "self" && lastMeRowEl) {
        row = lastMeRowEl;
      } else if (target === "enemy" && lastEnemyRowEl) {
        row = lastEnemyRowEl;
      }

      if (row) {
        const rect = row.getBoundingClientRect();
        // HPバーの中を「横3点 × 縦2点」ぐらいまとめてクリックして当てにいく
        const xs = [
          rect.left + rect.width * 0.2,
          rect.left + rect.width * 0.5,
          rect.left + rect.width * 0.8,
        ];
        const ys = [
          rect.top + rect.height * 0.35,
          rect.top + rect.height * 0.65,
        ];

        console.log("[GF AI] click self name row sweep", {
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

    // ★ 従来通りの座標クリックは常に行う
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const redX = vw * 0.1;
    const redY = vh * 0.32;
    const blueX = vw * 0.5;
    const blueY = vh * 0.3;
    clickPoint(redX, redY);
    clickPoint(blueX, blueY);
  }

  // ========================================================================
  // 3. Action Executors
  // ========================================================================

  async function useCardIndices(indices, phase, target) {
    if (!indices || !indices.length) {
      await withActionLock("pass", async () => {
        clickTargetsForPhase(phase, target);
        await sleep(500);
      });
      return;
    }
    await withActionLock(`useCardIndices(${phase})`, async () => {
      for (const idx of indices) {
        const el = lastHandDomElements[idx];
        if (!el) continue;
        clickElementCenter(el);
        await sleep(400);
      }
      clickTargetsForPhase(phase, target);
      await sleep(800);
    });
  }

  async function performUru(indices, state) {
    if (!indices || indices.length < 2) return;
    const sellIdx = indices[0];
    const targetIdx = indices[1];
    const sellEl = lastHandDomElements[sellIdx];
    const targetEl = lastHandDomElements[targetIdx];
    if (!sellEl || !targetEl) return;

    await withActionLock("performUru", async () => {
      clickElementCenter(sellEl);
      await sleep(300);
      clickElementCenter(targetEl);
      await sleep(300);
      clickTargetsForPhase(state.phase);
      await sleep(800);
    });
  }

  async function performKau(indices, state) {
    if (!indices || !indices.length) return;
    const kauIdx = indices[0];
    const el = lastHandDomElements[kauIdx];
    if (!el) return;

    await withActionLock("performKau", async () => {
      clickElementCenter(el);
      await sleep(400);
      clickTargetsForPhase(state.phase);
      await sleep(800);
    });
  }

  async function performRyougae(indices, state, exchangePlan) {
    if (!indices || !indices.length) return;
    const idx = indices[0];
    const el = lastHandDomElements[idx];
    if (!el) return;

    await withActionLock("performRyougae", async () => {
      clickElementCenter(el);
      await sleep(600);

      if (!exchangePlan) {
        clickTargetsForPhase(state.phase);
        return;
      }

      let buttons = null;
      for (let i = 0; i < 20; i++) {
        buttons = findExchangeButtons();
        if (buttons && buttons.mp && buttons.gold) break;
        await sleep(200);
      }

      if (!buttons) {
        clickTargetsForPhase(state.phase);
        return;
      }

      const curMp = state.me.mp || 0;
      const curGold = state.me.gold || 0;
      const targetMp = exchangePlan.mp;
      const targetGold = exchangePlan.gold;

      adjustExchangeColumn(curMp, targetMp, buttons.mp, "MP");
      adjustExchangeColumn(curGold, targetGold, buttons.gold, "GOLD");
      await sleep(400);

      clickTargetsForPhase(state.phase);
      await sleep(800);
    });
  }

  function handleBuyChoice(ai) {
    if (ai.buy === 1) clickBuyYesAsync();
    else clickBuyNoAsync();
  }

  async function clickBuyYesAsync() {
    await withActionLock("clickBuyYes", async () => {
      const MAX_RETRY = 15;
      for (let i = 0; i < MAX_RETRY; i++) {
        const { yes } = findBuyHitboxesPair();
        if (yes) {
          clickElementCenter(yes);
          await sleep(500);
          return;
        }
        await sleep(200);
      }
    });
  }

  async function clickBuyNoAsync() {
    await withActionLock("clickBuyNo", async () => {
      const MAX_RETRY = 15;
      for (let i = 0; i < MAX_RETRY; i++) {
        const { no } = findBuyHitboxesPair();
        if (no) {
          clickElementCenter(no);
          await sleep(500);
          return;
        }
        await sleep(200);
      }
    });
  }

  // ========================================================================
  // 4. State Reading & Main Loop
  // ========================================================================

  setInterval(() => {
    try {
      const state = readState();
      if (state) {
        lastState = state; // ★ これだけ追加
        if (shouldActNow(state)) {
          sendStateToServer(state);
        }
        // ★ 安全そうなときにだけ「起こした奇跡」を自動チェック
        maybeCheckMiracles(state);
      }
    } catch (e) {
      console.error("readState error", e);
    }
  }, 1000);

  function shouldActNow(state) {
    updatePhaseTiming(state);
    const DEFENSE_COOLDOWN_MS = 3000;
    // 夢対策
    if (state.phase === "defense" && enemyHasYume(state)) {
      const elapsed = performance.now() - lastDefensePhaseStartedAt;
      if (elapsed < 3000) return false;
    }

    if (isDoingAction) return false;

    if (state.phase === "defense") {
      if (isHarmlessTradeIncoming(state.incomingCards)) {
        console.log(
          "[GF AI] skip defense (trade animation only)",
          state.incomingCards,
        );
        lastActionFinishTime = Date.now();
        return false;
      }

      // if (isLikelyMyAttackEchoNoReflect(state.incomingCards)) {
      //   console.log('[GF AI] skip defense (own attack echo, not reflect)', state.incomingCards);
      // lastActionFinishTime = Date.now();
      //return false;
      // }

      // ③ 通常のクールダウン
      const timeSinceAction = Date.now() - lastActionFinishTime;
      if (timeSinceAction < DEFENSE_COOLDOWN_MS) {
        console.log(`[GF AI] Cooling down... (${timeSinceAction}ms / 2000ms)`);
        return false;
      }
    }

    if (state.phase === "buy_choice") {
      const cand = (state.buyCandidates && state.buyCandidates[0]) || null;
      const sig = cand ? `${cand.name}:${cand.overlay}` : "";
      if (lastPhase === "buy_choice" && sig === lastBuySig) return false;
      lastPhase = "buy_choice";
      lastBuySig = sig;
      lastHandSig = null;
      return true;
    }

    if (state.phase !== "attack" && state.phase !== "defense") return false;

    const handSig = (state.hand || [])
      .map((c) => `${c.name}:${c.overlay}`)
      .join("|");
    if (state.phase === lastPhase && handSig === lastHandSig) return false;

    lastPhase = state.phase;
    lastHandSig = handSig;
    return true;
  }
  function rememberLastAttackSig(indices, hand) {
    const byIndex = new Map((hand || []).map((c) => [c.index, c]));
    lastAttackSig = (indices || [])
      .map((i) => byIndex.get(i))
      .filter(Boolean)
      .map((c) => ({ name: c.name, overlay: c.overlay || "" }));

    // 新しい攻撃をしたので、「どっち側に出る攻撃か」はまだ未確定に戻す
    lastAttackZone = null;
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
          console.log("[GF AI SERVER RESPONSE]", ai);
          const type = ai.type;
          const indices = ai.cardIndices || [];
          const target = ai.target || undefined; // ★ ここ追加
          if (type === "attack") {
            rememberLastAttackSig(indices, state.hand);
          }
          if (type === "buy_choice") handleBuyChoice(ai);
          else if (type === "exchange")
            performRyougae(indices, state, ai.exchange);
          else if (type === "sell") performUru(indices, state);
          else if (type === "buy") performKau(indices, state);
          else if (type === "attack" || type === "defend" || type === "shield")
            useCardIndices(indices, state.phase, target);
          else if (type === "attack-pass" || type === "defense-pass")
            useCardIndices([], state.phase, target);
        } catch (e) {
          console.error("[GF AI CLIENT ERROR]", e);
        }
      },
      onerror: (err) => {
        console.error("[GF AI SERVER ERROR]", err);
      },
    });
  }

  // 「売る」「買う」「許す」＋ 取引直後 のパターンは防御しない
  function isHarmlessTradeIncoming(incoming) {
    // カードが1枚も見えていない：売るアニメが消えた直後など
    if (!incoming || !incoming.length) {
      return true;
    }

    const names = incoming.map((c) => c.name || "");

    // 1枚だけ「売る」
    if (incoming.length === 1 && names[0].includes("売る")) {
      return true;
    }

    // 1枚だけ「許す」
    // → 売る動作後、「売る＋売ったもの」が消えて「許す」だけ残るタイミングを想定
    if (incoming.length === 1 && names[0].includes("許す")) {
      return true;
    }

    // 「買う」＋アイテム1枚
    if (incoming.length === 2 && names.some((n) => n.includes("買う"))) {
      return true;
    }

    return false;
  }

  function isLikelyMyAttackEchoNoReflect(incoming) {
    if (!lastAttackSig.length) return false;
    if (!incoming || !incoming.length) return false;

    // zone（left/right）が混ざっている場合は安全のため自動スキップしない
    const zones = Array.from(
      new Set(incoming.map((c) => c.zone).filter(Boolean)),
    );
    if (zones.length !== 1) return false;
    const incZone = zones[0]; // 'left' or 'right'

    if (incoming.length !== lastAttackSig.length) return false;

    const incSig = incoming.map((c) => ({
      name: c.name,
      overlay: c.overlay || "",
    }));

    // ゆるい多重集合一致（名前ベース）
    const namesMatch =
      incSig.every((x) => lastAttackSig.some((y) => y.name === x.name)) &&
      lastAttackSig.every((x) => incSig.some((y) => y.name === x.name));

    if (!namesMatch) return false;

    // 両方 overlay を持っているなら overlay まで合わせる
    const allHaveOverlay =
      incSig.every((x) => x.overlay) && lastAttackSig.every((x) => x.overlay);
    if (allHaveOverlay) {
      const overlayMatch = incSig.every((x) =>
        lastAttackSig.some((y) => y.name === x.name && y.overlay === x.overlay),
      );
      if (!overlayMatch) return false;
    }

    // ★ここから zone ロジック
    // 1回目に一致したとき：「この側が自分攻撃の演出側なんだな」と覚える
    if (lastAttackZone === null) {
      lastAttackZone = incZone;
      return true; // 自分の攻撃エコーなので無視
    }

    // 2回目以降：「前回覚えた側と同じ側なら、自分攻撃の残像」とみなす
    return incZone === lastAttackZone;
  }

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
        usable: c.usable,
      })),
      incomingCards: (state.incomingCards || []).map((c, idx) => ({
        index: typeof c.index === "number" ? c.index : idx,
        overlay: c.overlay || "",
        name: c.name || "",
        raw_text: c.raw_text || "",
      })),
      buyCandidate:
        state.buyCandidates && state.buyCandidates[0]
          ? {
              index: state.buyCandidates[0].index ?? 0,
              overlay: state.buyCandidates[0].overlay || "",
              name: state.buyCandidates[0].name || "",
              raw_text: state.buyCandidates[0].raw_text || "",
            }
          : null,
      // ★ 追加：これまでに画面から確認できた奇跡
      seenMiracles: {
        me: Array.from(mySeenMiracles),
        enemy: Array.from(enemySeenMiracles),
      },
    };
  }

  function updatePhaseTiming(state) {
    if (state.phase === "defense" && lastPhase !== "defense") {
      lastDefensePhaseStartedAt = performance.now();
    }
  }
  function enemyHasYume(state) {
    return (state.enemy?.statuses || []).some((s) => s.name === "夢");
  }

  function readState() {
    // 奇跡チェック中は HP/MP が崩れるので、このティックはスキップ
    if (isCheckingMiracles) return null;
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
    };
  }
  function getMeIsTop(vh) {
    if (lastMeRowEl && lastEnemyRowEl) {
      return (
        lastMeRowEl.getBoundingClientRect().top <
        lastEnemyRowEl.getBoundingClientRect().top
      );
    }
    if (lastMeRowEl) {
      return lastMeRowEl.getBoundingClientRect().top < vh * 0.2;
    }
    // デフォルトで「上」を自分扱い
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
    const hasPray = buttons.some((el) => el.textContent.includes("祈る"));
    const hasForgive = buttons.some((el) => el.textContent.includes("許す"));

    const buyBox = findBuyHitbox();
    if (buyBox) {
      // 購入フェーズでは「許す」タイマーはリセット
      forgiveVisibleAt = 0;
      return "buy_choice";
    }

    // 攻撃優先
    if (hasPray) {
      // 攻撃フェーズに入ったなら「許す」タイマーはリセット
      forgiveVisibleAt = 0;
      return "attack";
    }

    // 「許す」が見えるとき：
    //  - 出た瞬間は様子見（即 defense にしない）
    //  - 2秒以上連続して見えていたら、初めて defense とみなす
    if (hasForgive) {
      const now = performance.now();

      if (!forgiveVisibleAt) {
        // 初回に見えたフレーム → タイムスタンプだけ記録して、この時点では 'other'
        forgiveVisibleAt = now;
        return "other";
      }

      const elapsed = now - forgiveVisibleAt;
      if (elapsed >= 2000) {
        // 2秒以上連続で「許す」がある → 本物の防御フェーズ
        return "defense";
      } else {
        // まだ2秒経ってない → 演出中の可能性が高いので様子見
        return "other";
      }
    } else {
      // 「許す」が一旦消えたらタイマーリセット
      forgiveVisibleAt = 0;
    }

    return "other";
  }

  function findBuyHitbox() {
    const divs = Array.from(document.querySelectorAll("div"));

    // 1) inline style で厳密に探す
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

    // 2) 保険：computedStyle + 矩形で拾う（1.0系）
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

    // 1) inline strict
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

    // 2) 保険：computedStyle
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

  function adjustExchangeColumn(current, target, btns, label) {
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
        clickElementCenter(el);
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

  function readPlayers() {
    const cands = Array.from(document.querySelectorAll("div, span"))
      .filter(
        (el) =>
          el.textContent.includes("HP") &&
          el.textContent.includes("MP") &&
          el.textContent.includes("¥"),
      )
      .sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );

    if (cands.length < 2) return null;

    const top = cands[0];
    const bot = cands[cands.length - 1];

    const topHasMe = top.textContent.includes(MY_NAME);
    const botHasMe = bot.textContent.includes(MY_NAME);

    let meRow = null;
    let enRow = null;

    if (topHasMe && !botHasMe) {
      meRow = top;
      enRow = bot;
    } else if (!topHasMe && botHasMe) {
      meRow = bot;
      enRow = top;
    } else {
      // ★ 名前が見つからない場合は「下が自分」
      meRow = bot;
      enRow = top;
    }

    lastMeRowEl = meRow;
    lastEnemyRowEl = enRow;

    const parse = (row) => {
      const m = row.textContent
        .replace(/\s+/g, "")
        .match(/HP(\d+)MP(\d+)¥(\d+)/);
      return m
        ? { hp: parseInt(m[1]), mp: parseInt(m[2]), gold: parseInt(m[3]) }
        : null;
    };

    const mStat = parse(meRow);
    const eStat = parse(enRow);
    if (!mStat || !eStat) return null;

    return {
      me: { name: MY_NAME, ...mStat },
      enemy: { name: "Enemy", ...eStat },
    };
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
      else if (cy < vh * 0.5) botSlots.push({ el, cx: 0, cy });
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
    const detail = findDetailPanel();
    const before = detail ? detail.innerText : "";
    for (const s of slots) {
      s.el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const d = findDetailPanel();
      if (!d) continue;
      const full = d.innerText.trim();
      if (!full || full === before) continue;
      const lines = full
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (lines.length)
        res.push({ name: lines[0], raw_text: lines.slice(1).join(" ") });
    }
    return res;
  }
  function readMiracleNamesFromSlots(slots) {
    const names = [];
    const detail = findDetailPanel();
    const before = detail ? detail.innerText : "";

    for (const s of slots) {
      s.el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const d = findDetailPanel();
      if (!d) continue;

      const full = (d.innerText || "").trim();
      if (!full || full === before) continue;

      const lines = full
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!lines.length) continue;

      const name = lines[0];
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }

  function readMiraclesFromView() {
    const root = document.querySelector("#main") || document.body;
    const detail = findDetailPanel();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minX = vw * 0.45; // 右半分だけ見る

    const raw = Array.from(root.querySelectorAll("div, span, img")).filter(
      (el) => {
        if (detail && detail.contains(el)) return false;
        const r = el.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        if (w < 10 || w > 60) return false;
        if (h < 10 || h > 60) return false;

        const cx = r.left + w / 2;
        if (cx < minX) return false;

        const bg = window.getComputedStyle(el).backgroundImage;
        return el.tagName === "IMG" || (bg && bg !== "none");
      },
    );

    if (!raw.length) {
      console.log("[GF AI] no miracle icons found");
      return;
    }

    const topSlots = [];
    const botSlots = [];

    raw.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left;
      const cy = r.top;
      if (cy < vh * 0.2) topSlots.push({ el, cx, cy });
      else if (cy < vh * 0.5) botSlots.push({ el, cx, cy });
    });

    const meIsTop = getMeIsTop(vh);
    const meRaw = meIsTop ? topSlots : botSlots;
    const enRaw = meIsTop ? botSlots : topSlots;

    const meNames = readMiracleNamesFromSlots(dedup(meRaw));
    const enemyNames = readMiracleNamesFromSlots(dedup(enRaw));

    meNames.forEach((n) => mySeenMiracles.add(n));
    enemyNames.forEach((n) => enemySeenMiracles.add(n));

    console.log("[GF AI] update miracles from view", {
      me: Array.from(mySeenMiracles),
      enemy: Array.from(enemySeenMiracles),
    });
  }

  function readHand(phase) {
    const detail = findDetailPanel();
    const root = document.querySelector("#main");
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const labels = Array.from(root.querySelectorAll("div, span")).filter(
      (el) => {
        if (detail && detail.contains(el)) return false;
        return /^(攻[0-9]+|守[0-9]+|\+攻[0-9]+|¥[0-9]+)$/.test(
          el.textContent.trim(),
        );
      },
    );
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
      Math.abs(a.r.top - b.r.top) < 20
        ? a.r.left - b.r.left
        : a.r.top - b.r.top,
    );
    const limited = uniqueEls.slice(0, 18);
    lastHandDomElements = limited.map((u) => u.el);
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
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
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
    const beforePanel = findDetailPanel();
    const beforeText = beforePanel ? beforePanel.innerText : "";
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const d = findDetailPanel();
    if (!d) return null;
    const full = (d.innerText || "").trim();
    if (!full || full === beforeText) return null;
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
      left: {
        minX: vw * 0.05,
        maxX: vw * 0.2,
        minY: vh * 0.1,
        maxY: vh * 0.42,
      },
      right: {
        minX: vw * 0.25,
        maxX: vw * 0.5,
        minY: vh * 0.1,
        maxY: vh * 0.42,
      },
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
        (u) =>
          Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20,
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

    // 1) 絶対座標で「買う候補カードゾーン」を決める（今のロジックベースでOK）
    const zone = {
      minX: vw * 0.3,
      maxX: vw * 0.55,
      minY: vh * 0.05,
      maxY: vh * 0.45,
    };

    // 2) ゾーン内の「カードっぽい div」を集める（incoming と同じノリ）
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

        // あまりに小さすぎる / デカすぎるカードは除外
        if (r.width < 50 || r.width > 140) return null;
        if (r.height < 60 || r.height > 180) return null;

        return { el, r };
      })
      .filter(Boolean);

    if (!rawCards.length) return [];

    // 3) 近接dup除去（incoming／hand と同じスタイル）
    const unique = [];
    for (const obj of rawCards) {
      const r = obj.r;
      const dup = unique.find(
        (u) =>
          Math.abs(u.r.left - r.left) < 20 && Math.abs(u.r.top - r.top) < 20,
      );
      if (!dup) unique.push(obj);
    }

    // 買う候補は1枚だけ想定なので、一番上にあるやつを採用
    unique.sort((a, b) => a.r.top - b.r.top);
    const cardEl = unique[0].el;

    // 4) 名前・raw_textは incoming と同じロジックで読む
    const info = readCardInfoForIncoming(cardEl);
    if (!info) return [];

    // 5) overlay はシンプルにカード内のラベルを拾う or 要らなければ空でもOK
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
})();
