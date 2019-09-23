import child_process = require('child_process');
import os = require('os');

const { exec } = child_process;

type execFn = (command, opts) => Promise<string | Buffer | undefined>;

class Pool {
  count: number;
  queue: execFn[];
  promises: Promise<string | undefined>[];
  constructor (count) {
    this.count = count;
    this.queue = [];
    this.promises = new Array(count);
  }

  execute (executionFunction: execFn) {
    var idx = -1;
    for (var i = 0; i < this.count; i++)
      if (!this.promises[i])
        idx = i;
    if (idx !== -1)
      return run(this, idx, executionFunction);
    else
      return enqueue(this, executionFunction);
  }
}

/* Run the function immediately. */
function run (pool, idx, executionFunction) {
  var p = Promise.resolve()
  .then(executionFunction)
  .then(() => {
    delete pool.promises[idx];
    var next = pool.queue.pop();
    if (next)
      pool.execute(next);
  });
  pool.promises[idx] = p;
  return p;
}

/* Defer function to run once all running and queued functions have run. */
function enqueue (pool, executeFunction) {
  return new Promise(resolve => {
    pool.queue.push(() => {
      return Promise.resolve()
      .then(executeFunction)
      .then(resolve);
    });
  });
}

/* Take a function to execute within pool, and return promise delivering the functions
 * result immediately once it is run. */
let execute: execFn;
if (process.platform === 'win32') {
  var gitPool = new Pool(Math.min(os.cpus().length, 2));
  execute = function (command, execOpt) {
    return new Promise((topResolve, topReject) => {
      return gitPool.execute(function() {
        return new Promise(resolve => {
          exec('git ' + command, execOpt, (err, stdout, stderr) => {
            if (err)
              topReject(stderr || err);
            else
              topResolve(stdout);
            resolve();
          });
        });
      });  
    });
  };
}
else {
  execute = (command, execOpt, ignoreLock = false) => new Promise((resolve, reject) => {
    exec('git ' + command, execOpt, (err, stdout, stderr) => {
      if (err) {
        if (ignoreLock) {
          const errStr = (stderr || err).toString();
          if (errStr.indexOf('.git/index.lock') !== -1) {
            console.log("TODO: Git lock file removal.");
          }
        }
        reject(stderr || err);
      }
      resolve(stdout);
    });
  });
}

export default execute;