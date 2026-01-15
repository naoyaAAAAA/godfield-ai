export const globals = {
  MY_NAME: "AI",
  lastMeRowEl: null,
  lastEnemyRowEl: null,
  lastHandDomElements: [],
  lastHoverEl: null, // last element we hovered for detail panel
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
  deferredAction: null, // { action, sig }
  lastMiracleCheckTime: 0,
  mySeenMiracles: new Set(),
  enemySeenMiracles: new Set(),
  MIRACLE_CHECK_INTERVAL_MS: 20000,
  // globals.js
  meIsTopLastKnown: null,
  lockedMeIsTop: null,
};
