/*
    Paint - test runner

    Runs every *.test.mjs in this folder under plain Node (20 or newer):

        node tests/run.mjs            from the app folder
        node tests/run.mjs raster     only files whose name contains "raster"

    The tests import the app's DOM-free modules (shapes, raster, textwrap),
    so nothing has to be installed.
*/

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs') && f.indexOf(filter) >= 0).sort();

let failed = 0;
for (const file of files) {
    const run = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' });
    const lines = (run.stdout + run.stderr).split('\n').filter((line) => line.trim());
    const ok = run.status === 0 && !lines.some((line) => /FAIL/.test(line));
    if (!ok) {
        failed++;
    }
    console.log((ok ? 'ok    ' : 'FAILED') + ' ' + file + (ok ? '' : '\n       ' + lines.slice(-12).join('\n       ')));
}
console.log(failed ? failed + ' of ' + files.length + ' test files failed' : 'all ' + files.length + ' test files passed');
process.exitCode = failed ? 1 : 0;
