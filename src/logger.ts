import fs from "fs/promises";
import { statSync } from "fs";
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
let log: Log, logStream: LogStream;
if (logEnabled) {
  ({ log, logStream } = createLogger());

  try {
    // First check if process.env.JSPM_CLI_LOG is a file:
    let logPath;
    try {
      const stats = statSync(process.env.JSPM_CLI_LOG);
      if (stats.isFile()) {
        logPath = process.env.JSPM_CLI_LOG;
      }
    } catch {
      logPath = `${os.tmpdir()}/jspm-${new Date()
        .toISOString()
        .slice(0, 19)}.log`;
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

      for await (const { type, message } of logStream()) {
        const spaces = " ".repeat(6 - type.length);
        const time = new Date().toISOString().slice(11, 23);
        await logWriter(`${time} (${type}):${spaces}${message}\n`);
      }
    })();
  } catch (e) {
    console.log(c.red(`Failed to create debug logger: ${e.message}`));
  }
}

export function info(msg: string) {
  log && log("INFO", msg);
}

export function error(msg: string) {
  log && log("ERROR", msg);
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
