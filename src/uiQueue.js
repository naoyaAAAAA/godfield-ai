// uiQueue.js
import { globals } from "./globals.js";

export function enqueueUI(job) {
  globals.uiQueue = globals.uiQueue
    .then(job)
    .catch((e) => console.error("[GF AI] UI job failed:", e));
  return globals.uiQueue;
}
