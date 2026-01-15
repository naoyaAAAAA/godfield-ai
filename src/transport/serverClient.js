import { globals } from "../globals.js";
import * as logger from "../utils/logger.js";
function stateSigForDefer(state) {
  if (!state) return "";
  if (state.phase === "buy_choice") {
    const c = state.buyCandidates && state.buyCandidates[0];
    return `buy:${c ? `${c.name}:${c.overlay}` : ""}`;
  }
  const handSig = (state.hand || [])
    .map((c) => `${c.name}:${c.overlay}`)
    .join("|");
  const incSig = (state.incomingCards || [])
    .map((c) => `${c.name}:${c.overlay || ""}`)
    .join("|");
  return `${state.phase}|${handSig}|${incSig}`;
}

function createServerClient({ rememberLastAttackSig, actions }) {
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
      seenMiracles: {
        me: Array.from(globals.mySeenMiracles),
        enemy: Array.from(globals.enemySeenMiracles),
      },
    };
  }
  if (typeof globals.flushDeferredAction !== "function") {
    globals.flushDeferredAction = async () => {
      const d = globals.deferredAction;
      if (!d) return;

      // まだ奇跡チェック中 / 他アクション中なら次回に回す
      if (globals.isCheckingMiracles || globals.isDoingAction) return;

      // 古すぎる返答は捨てる（事故防止）
      if (d.createdAt && Date.now() - d.createdAt > 5000) {
        globals.deferredAction = null;
        return;
      }

      globals.deferredAction = null;

      // 状態が変わってないなら lastState を優先（より新鮮）
      const now = globals.lastState;
      const useNow = now && stateSigForDefer(now) === d.sig;
      const st = useNow ? now : d.stateSnapshot;

      // ★ ここは「元の onload の actions 実行部分」を関数化して呼ぶのが理想だけど、
      //   雑にコピペでも動く：以下は bundle の元ロジックそのまま
      const type = d.ai.type;
      const indices = d.ai.cardIndices || [];
      const target = d.ai.target || void 0;

      if (type === "attack") {
        rememberLastAttackSig(indices, st.hand);
      }
      if (type === "buy_choice") actions.handleBuyChoice(d.ai);
      else if (type === "exchange")
        actions.performRyougae(indices, st, d.ai.exchange);
      else if (type === "sell") actions.performUru(indices, st);
      else if (type === "buy") actions.performKau(indices, st);
      else if (type === "attack" || type === "defend" || type === "shield")
        actions.useCardIndices(indices, st.phase, target);
      else if (type === "attack-pass" || type === "defense-pass")
        actions.useCardIndices([], st.phase, target);
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
          // onload の try { const ai = ... } の直後あたりに追加
          if (globals.isCheckingMiracles || globals.isDoingAction) {
            const sig = stateSigForDefer(state);
            globals.deferredAction = {
              ai,
              sig,
              stateSnapshot: state,
              createdAt: Date.now(),
            };
            logger.log("[GF AI] deferred server response", sig);
            return;
          }
          logger.log("[GF AI SERVER RESPONSE]", ai);
          const type = ai.type;
          const indices = ai.cardIndices || [];
          const target = ai.target || undefined;
          if (type === "attack") {
            rememberLastAttackSig(indices, state.hand);
          }
          if (type === "buy_choice") actions.handleBuyChoice(ai);
          else if (type === "exchange")
            actions.performRyougae(indices, state, ai.exchange);
          else if (type === "sell") actions.performUru(indices, state);
          else if (type === "buy") actions.performKau(indices, state);
          else if (type === "attack" || type === "defend" || type === "shield")
            actions.useCardIndices(indices, state.phase, target);
          else if (type === "attack-pass" || type === "defense-pass")
            actions.useCardIndices([], state.phase, target);
        } catch (e) {
          logger.error("[GF AI CLIENT ERROR]", e);
        }
      },
      onerror: (err) => {
        logger.error("[GF AI SERVER ERROR]", err);
      },
    });
  }

  return { sendStateToServer };
}

export { createServerClient };
