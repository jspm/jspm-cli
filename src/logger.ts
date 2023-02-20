import fs from "fs/promises";
import os from "os";
import c from "picocolors";

export type Log = (type: string, message: string) => void;
export type LogStream = () => AsyncGenerator<
  { type: string; message: string },
  never,
  unknown
>;

// Switch for checking if debug logging is on:
export const logEnabled = !!process.env.JSPM_CLI_LOG;

// Actual debug logger implementation:
let _log: Log, _logStream: LogStream;
if (logEnabled) {
  ({ log: _log, logStream: _logStream } = createLogger());

  try {
    let logPath;
    if (
      process.env.JSPM_CLI_LOG === "1" ||
      process.env.JSPM_CLI_LOG?.toLowerCase() === "true"
    ) {
      logPath = `${os.tmpdir()}/jspm-${new Date()
        .toISOString()
        .slice(0, 19)}.log`;
    } else {
      logPath = process.env.JSPM_CLI_LOG;
    }

    const logWriter = async (msg: string) =>
      await fs.writeFile(logPath, msg, {
        encoding: "utf-8",
        flag: "a+",
        mode: 0o666,
      });

    (async () => {
      console.log(c.red(`Creating debug logger at ${logPath}`));
      await logWriter(""); // touch

      for await (const { type, message } of _logStream()) {
        const time = new Date().toISOString().slice(11, 23);
        const prefix = c.bold(`${time} ${type}:`);
        await logWriter(`${prefix} ${message}\n`);
      }
    })();
  } catch (e) {
    console.log(c.red(`Failed to create debug logger: ${e.message}`));
  }
}

export function log(type: string, message: string) {
  _log && _log(type, message);
}

export function withType(type: string) {
  return (message: string) => log(type, message);
}

// Actual logger implementation, ripped from the generator:
function createLogger() {
  let resolveQueue: () => void;
  let queuePromise = new Promise<void>((resolve) => (resolveQueue = resolve));
  let queue: { type: string; message: string }[] = [];

  const logStream = async function* () {
    while (true) {
      while (queue.length) yield queue.shift()!;
      await queuePromise;
    }
  };

  function log(type: string, message: string) {
    if (queue.length) {
      queue.push({ type, message });
    } else {
      queue = [{ type, message }];
      const _resolveQueue = resolveQueue;
      queuePromise = new Promise<void>((resolve) => (resolveQueue = resolve));
      _resolveQueue();
    }
  }

  return { log, logStream };
}
