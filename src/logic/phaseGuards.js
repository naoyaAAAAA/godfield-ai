import { globals } from "../globals.js";
import * as logger from "../utils/logger.js";
import { enqueueUI } from "../uiQueue.js"; // ★追加

function createPhaseGuards({
  sleep,
  withActionLock,
  findMiraclesButton,
  clickElementCenter,
  readMiraclesFromView,
}) {
  async function checkMiracles() {
    await withActionLock("checkMiracles", async () => {
      const btn = findMiraclesButton?.();
      if (!btn) {
        logger.log("[GF AI] miracles button not found");
        return;
      }

      // open
      clickElementCenter(btn);
      await sleep(600);

      const ok = await readMiraclesFromView?.();

      if (!ok) {
        logger.log("[GF AI] miracle view opened but icons still not found");
      }

      // close (toggle)
      clickElementCenter(btn);
      await sleep(400);

      globals.lastMiracleCheckTime = Date.now();
    });
  }

  async function checkMiraclesOnce() {
    // UI操作を必ずキューに積む（/decide のクリックと衝突しないように）
    await enqueueUI(async () => {
      globals.isCheckingMiracles = true;
      try {
        await checkMiracles();
      } finally {
        globals.isCheckingMiracles = false;
      }
    });

    // ★奇跡チェック中にサーバー返答が来た場合は、ここで回収して実行
    if (typeof globals.flushDeferredAction === "function") {
      await globals.flushDeferredAction();
    }
  }

  // 以降、maybeCheckMiracles(state) が checkMiraclesOnce() を呼ぶ形でOK

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
    return (state.enemy?.statuses || []).some((s) => s.name === "夢");
  }

  function isHarmlessTradeIncoming(incoming) {
    if (!incoming || !incoming.length) {
      return false;
    }

    const names = incoming.map((c) => c.name || "");

    if (incoming.length === 1 && names[0].includes("売る")) {
      return true;
    }

    if (incoming.length === 1 && names[0].includes("許す")) {
      return true;
    }

    if (incoming.length === 2 && names.some((n) => n.includes("買う"))) {
      return true;
    }

    return false;
  }

  function isLikelyMyAttackEchoNoReflect(incoming) {
    if (!globals.lastAttackSig.length) return false;
    if (!incoming || !incoming.length) return false;

    const zones = Array.from(
      new Set(incoming.map((c) => c.zone).filter(Boolean)),
    );
    if (zones.length !== 1) return false;
    const incZone = zones[0];

    if (incoming.length !== globals.lastAttackSig.length) return false;

    const incSig = incoming.map((c) => ({
      name: c.name,
      overlay: c.overlay || "",
    }));

    const namesMatch =
      incSig.every((x) =>
        globals.lastAttackSig.some((y) => y.name === x.name),
      ) &&
      globals.lastAttackSig.every((x) => incSig.some((y) => y.name === x.name));

    if (!namesMatch) return false;

    const allHaveOverlay =
      incSig.every((x) => x.overlay) &&
      globals.lastAttackSig.every((x) => x.overlay);
    if (allHaveOverlay) {
      const overlayMatch = incSig.every((x) =>
        globals.lastAttackSig.some(
          (y) => y.name === x.name && y.overlay === x.overlay,
        ),
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
    globals.lastAttackSig = (indices || [])
      .map((i) => byIndex.get(i))
      .filter(Boolean)
      .map((c) => ({ name: c.name, overlay: c.overlay || "" }));

    globals.lastAttackZone = null;
  }

  function shouldActNow(state) {
    updatePhaseTiming(state);
    const DEFENSE_COOLDOWN_MS = 3000;
    if (state.phase === "defense" && enemyHasYume(state)) {
      const elapsed = performance.now() - globals.lastDefensePhaseStartedAt;
      if (elapsed < 3000) return false;
    }

    if (globals.isDoingAction) return false;

    if (state.phase === "defense") {
      if (!state.incomingCards || state.incomingCards.length === 0) {
        logger.log("[GF AI] defense but incoming empty -> wait");
        return false;
      }
      if (isHarmlessTradeIncoming(state.incomingCards)) {
        logger.log(
          "[GF AI] skip defense (trade animation only)",
          state.incomingCards,
        );
        globals.lastActionFinishTime = Date.now();
        return false;
      }

      const timeSinceAction = Date.now() - globals.lastActionFinishTime;
      if (timeSinceAction < DEFENSE_COOLDOWN_MS) {
        logger.log(`[GF AI] Cooling down... (${timeSinceAction}ms / 3000ms)`);
        return false;
      }
    }

    if (state.phase === "buy_choice") {
      const cand = (state.buyCandidates && state.buyCandidates[0]) || null;
      const sig = cand ? `${cand.name}:${cand.overlay}` : "";
      if (globals.lastPhase === "buy_choice" && sig === globals.lastBuySig)
        return false;
      globals.lastPhase = "buy_choice";
      globals.lastBuySig = sig;
      globals.lastHandSig = null;
      return true;
    }

    if (state.phase !== "attack" && state.phase !== "defense") return false;

    const handSig = (state.hand || [])
      .map((c) => `${c.name}:${c.overlay}`)
      .join("|");
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
    maybeCheckMiracles,
  };
}

export { createPhaseGuards };
