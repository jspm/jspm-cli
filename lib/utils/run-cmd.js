"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const childProcess = require("child_process");
const process = require("process");
const common_1 = require("./common");
const path = require("path");
async function runCmd(script, cwd) {
    const env = {};
    const pathArr = [];
    pathArr.push(path.join(cwd, 'jspm_packages', '.bin'));
    pathArr.push(path.join(__dirname, 'node-gyp-bin'));
    pathArr.push(path.join(cwd, 'node_modules', '.bin'));
    pathArr.push(process.env[common_1.PATH]);
    env[common_1.PATH] = pathArr.join(common_1.PATHS_SEP);
    const sh = common_1.isWindows ? process.env.comspec || 'cmd' : 'sh';
    const shFlag = common_1.isWindows ? '/d /s /c' : '-c';
    const proc = childProcess.spawn(sh, [shFlag, script], { cwd, env, stdio: 'inherit', windowsVerbatimArguments: true });
    return new Promise((resolve, reject) => proc.on('close', resolve).on('error', reject));
}
exports.runCmd = runCmd;
//# sourceMappingURL=run-cmd.js.map