/*
    3D Modeler - test runner

    Runs every *.test.mjs in this folder under plain Node (20 or newer):

        node tests/run.mjs            from the app folder
        node tests/run.mjs kernel     only files whose name contains "kernel"

    The tests import the app's own modules and the vendored WASM libraries in
    lib/, so nothing has to be installed. Each test file prints one summary
    line and sets a failing exit code when a check fails.
*/

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here).filter(function (f) {
    return f.endsWith('.test.mjs') && f.indexOf(filter) >= 0;
}).sort();

let failed = 0;
files.forEach(function (file) {
    const run = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' });
    // OpenCascade prints STEP transfer statistics; keep only what the test says
    const lines = (run.stdout + run.stderr).split('\n').filter(function (line) {
        return line.trim() && !/^\*|Step File|WorkSession|Transfer|^\s*$/.test(line);
    });
    const ok = run.status === 0 && !lines.some(function (line) {
        return /FAIL/.test(line);
    });
    if (!ok) {
        failed++;
    }
    console.log((ok ? 'ok    ' : 'FAILED') + ' ' + file + (ok ? '' : '\n       ' + lines.slice(-12).join('\n       ')));
});
console.log(failed ? failed + ' of ' + files.length + ' test files failed' : 'all ' + files.length + ' test files passed');
process.exitCode = failed ? 1 : 0;
