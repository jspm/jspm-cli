interface Log {
  type: string;
  message: string;
}

let resolveQueue: () => void;
let queuePromise = new Promise<void>(resolve => resolveQueue = resolve);
let queue: Log[] = [];

export const logStream = async function* () {
  while (true) {
    while (queue.length) yield queue.shift();
    await queuePromise;
  }
};

export function log (type: string, message: string) {
  if (queue.length) {
    queue.push({ type, message });
  }
  else {
    queue = [{ type, message }];
    const _resolveQueue = resolveQueue;
    queuePromise = new Promise<void>(resolve => resolveQueue = resolve);
    _resolveQueue();
  }
}
