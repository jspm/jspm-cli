/// <reference types="node" />
import childProcess = require('child_process');
export declare function runCmd(script: string, cwd: string): Promise<number>;
export declare function runCmd(script: string, cwd: string, pipe: true): Promise<childProcess.ChildProcess>;
