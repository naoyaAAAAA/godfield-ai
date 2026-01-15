import { globals } from "../globals.js";

function createActions({
  withActionLock,
  sleep,
  clickElementCenter,
  clickTargetsForPhase,
  findExchangeButtons,
  findBuyHitboxesPair,
}) {
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
        const el = globals.lastHandDomElements[idx];
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
    const sellEl = globals.lastHandDomElements[sellIdx];
    const targetEl = globals.lastHandDomElements[targetIdx];
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
    const el = globals.lastHandDomElements[kauIdx];
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
    const el = globals.lastHandDomElements[idx];
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

      adjustExchangeColumn(
        curMp,
        targetMp,
        buttons.mp,
        "MP",
        clickElementCenter,
      );
      adjustExchangeColumn(
        curGold,
        targetGold,
        buttons.gold,
        "GOLD",
        clickElementCenter,
      );
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

  return {
    useCardIndices,
    performUru,
    performKau,
    performRyougae,
    handleBuyChoice,
    clickBuyYesAsync,
    clickBuyNoAsync,
  };
}

function adjustExchangeColumn(
  current,
  target,
  btns,
  label,
  clickElementCenter,
) {
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

export { createActions, adjustExchangeColumn };
