export function log(...args) {
  console.log(...args);
}

export function error(...args) {
  console.error(...args);
}

export function debug(...args) {
  if (console.debug) {
    console.debug(...args);
  } else {
    console.log(...args);
  }
}
