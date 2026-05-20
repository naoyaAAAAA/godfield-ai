import { globals } from "./globals.js";
import * as logger from "./utils/logger.js";
import { sleep, createWithActionLock } from "./utils/async.js";
import { createClickHelpers } from "./executors/clickHelpers.js";
import { createActions } from "./executors/actions.js";
import { createStateReader } from "./readers/stateReader.js";
import { createPhaseGuards } from "./logic/phaseGuards.js";
import { createServerClient } from "./transport/serverClient.js";
import { createPollingLoop } from "./transport/pollingLoop.js";

const withActionLock = createWithActionLock(globals);
const clickHelpers = createClickHelpers();
const stateReader = createStateReader();
const phaseGuards = createPhaseGuards({
  sleep,
  withActionLock,
  findMiraclesButton: stateReader.findMiraclesButton,
  clickElementCenter: clickHelpers.clickElementCenter,
  readMiraclesFromView: stateReader.readMiraclesFromView,
});
const actions = createActions({
  withActionLock,
  sleep,
  clickElementCenter: clickHelpers.clickElementCenter,
  clickTargetsForPhase: clickHelpers.clickTargetsForPhase,
  findExchangeButtons: stateReader.findExchangeButtons,
  findBuyHitboxesPair: stateReader.findBuyHitboxesPair,
});
const serverClient = createServerClient({
  rememberLastAttackSig: phaseGuards.rememberLastAttackSig,
  actions,
});
const pollingLoop = createPollingLoop({
  globals,
  logger,
  readState: stateReader.readState,
  shouldActNow: phaseGuards.shouldActNow,
  sendStateToServer: serverClient.sendStateToServer,
  maybeCheckMiracles: phaseGuards.maybeCheckMiracles,
  escapeDefensePass: () => actions.useCardIndices([], "defense"),
});

function installDebugApi() {
  const api = {
    globals,
    readState() {
      const state = stateReader.readState();
      if (state) globals.lastState = state;
      logger.log("[GF AI STATE]", state);
      return state;
    },
    lastState() {
      logger.log("[GF AI LAST STATE]", globals.lastState);
      return globals.lastState;
    },
    diagnose(options = {}) {
      const opts =
        typeof options === "boolean" ? { highlight: options } : options;
      return stateReader.diagnose(opts);
    },
    highlight() {
      return stateReader.diagnose({ highlight: true });
    },
    clearHighlights() {
      stateReader.clearDebugOverlays();
    },
    async checkMiracles() {
      await phaseGuards.checkMiraclesOnce();
      return {
        me: Array.from(globals.mySeenMiracles),
        enemy: Array.from(globals.enemySeenMiracles),
      };
    },
    setMyName(name) {
      globals.MY_NAME = String(name || "AI");
      logger.log("[GF AI] MY_NAME =", globals.MY_NAME);
      return globals.MY_NAME;
    },
  };

  globalThis.GFAI = api;
  try {
    if (typeof unsafeWindow !== "undefined") unsafeWindow.GFAI = api;
  } catch (e) {
    // ignore
  }
}

(function init() {
  const now = new Date().toISOString();
  logger.log("[GF] bundle loaded", now);
  installDebugApi();
  pollingLoop.startLoop();
})();

export {
  globals,
  sleep,
  withActionLock,
  clickHelpers,
  stateReader,
  phaseGuards,
  actions,
  serverClient,
  pollingLoop,
  logger,
};
