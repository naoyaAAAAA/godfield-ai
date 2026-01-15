import * as logger from "./logger.js";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWithActionLock(globals) {
  return async function withActionLock(actionName, asyncFn) {
    if (globals.isDoingAction) {
      logger.log(`[GF AI] Skipped ${actionName}: action already in progress.`);
      return;
    }
    globals.isDoingAction = true;
    try {
      logger.log(`[GF AI] Start Action: ${actionName}`);
      await asyncFn();
    } catch (e) {
      logger.error(`[GF AI] Error in ${actionName}:`, e);
    } finally {
      await sleep(500);
      globals.lastActionFinishTime = Date.now();
      globals.isDoingAction = false;
      logger.log(`[GF AI] End Action: ${actionName} (Lock released)`);
    }
  };
}
