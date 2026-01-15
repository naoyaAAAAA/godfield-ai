function createPollingLoop({
  globals,
  logger,
  readState,
  shouldActNow,
  sendStateToServer,
  maybeCheckMiracles,
  escapeDefensePass, // ★追加（任意）
}) {
  let tickRunning = false;

  function stateSig(state) {
    if (!state) return "";
    const handSig = (state.hand || []).map(c => `${c.name}:${c.overlay}`).join("|");
    const incSig  = (state.incomingCards || []).map(c => `${c.name}:${c.overlay || ""}`).join("|");
    const buy = state.buyCandidates && state.buyCandidates[0];
    const buySig = buy ? `${buy.name}:${buy.overlay}` : "";
    return `${state.phase}|${handSig}|${incSig}|${buySig}`;
  }

  async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const state = readState();
      if (!state) return;

      globals.lastState = state;

      const now = Date.now();
      const sig = stateSig(state);
      if (sig !== globals.lastStateSig) {
        globals.lastStateSig = sig;
        globals.lastProgressAt = now;
      }

      if (state.phase !== "other") {
        globals.lastNonOtherAt = now;
      }

      // --- ★ burst のトリガ ---
      if (state.phase === "defense" && (!state.incomingCards || state.incomingCards.length === 0)) {
        if (!globals.defenseIncomingEmptySince) globals.defenseIncomingEmptySince = now;
        globals.burstUntil = Math.max(globals.burstUntil, now + 1500); // 1.5sだけ高頻度で再読
      } else {
        globals.defenseIncomingEmptySince = 0;
      }

      if (state.phase === "other") {
        const otherFor = globals.lastNonOtherAt ? (now - globals.lastNonOtherAt) : 0;
        if (otherFor > 2500) {
          globals.burstUntil = Math.max(globals.burstUntil, now + 2500); // 2.5s burst
        }
      }

      // --- ★ 詰まり解除（最終手段）---
      // defense なのに incoming が 4.5秒以上ずっと空なら、進行優先で defense-pass
      if (
        state.phase === "defense" &&
        globals.defenseIncomingEmptySince &&
        now - globals.defenseIncomingEmptySince > 4500
      ) {
        logger.log("[GF AI] watchdog: defense incoming empty too long -> pass");
        if (escapeDefensePass) {
          escapeDefensePass().catch(() => {});
        } else {
          // ないならサーバに投げてでも進める（最悪策）
          sendStateToServer(state);
        }
        globals.defenseIncomingEmptySince = now; // 連打防止
        return;
      }

      // 通常処理
      if (shouldActNow(state)) {
        sendStateToServer(state);
      }
      maybeCheckMiracles(state);

      if (typeof globals.flushDeferredAction === "function") {
        globals.flushDeferredAction().catch(() => {});
      }
    } catch (e) {
      logger.error("readState error", e);
    } finally {
      tickRunning = false;
    }
  }

  function startLoop() {
    // 通常 tick（いままで通り）
    setInterval(() => { tick().catch(() => {}); }, 1000);

    // ★burst tick（詰まりそうな間だけ）
    setInterval(() => {
      if (Date.now() < globals.burstUntil) tick().catch(() => {});
    }, 250);
  }

  return { startLoop };
}

export { createPollingLoop };
