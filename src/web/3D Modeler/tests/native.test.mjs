/*
    The Mac app's files (js/io/native.js, the native branch of js/io/files.js):
    "local:" paths keep links between files relative exactly as ArozOS
    paths do, so a project folder moves between ArozOS and a Mac; paths
    read as "~/..." for the person; the requests carry the token; a write
    the shell refuses falls back to the Save dialog; a link into an ArozOS
    drive fails like a missing file.
    Run with: node tests/run.mjs native
*/
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// The shell's announcement, and a fake of its API, before the modules load
const calls = [];
const disk = { '/Users/me/Robot/parts/Pin.aopart': '{"format":"aopart","version":1,"features":[]}' };
const allowed = new Set(); // files the "person" picked
let saveAnswer = null;
globalThis.window = {
    MODELER_NATIVE: { platform: 'macos', version: 't', token: 'secret', home: '/Users/me' },
    fetch: null
};
globalThis.fetch = window.fetch = async function (url, init) {
    const u = new URL(url, 'http://127.0.0.1:1');
    const method = (init && init.method) || 'GET';
    const token = init && init.headers && init.headers['X-Modeler-Token'];
    calls.push({ path: u.pathname, method, token, body: init && init.body });
    const json = (status, v) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (token !== 'secret') {
        return json(403, { error: 'not allowed' });
    }
    if (u.pathname === '/__native/file') {
        const p = u.searchParams.get('path').slice('local:'.length);
        if (method === 'PUT') {
            if (!allowed.has(p) && !(p.endsWith('.aopart') && p in disk)) {
                return json(403, { error: 'pick it first', code: 'nogrant' });
            }
            disk[p] = String(init.body);
            return json(200, { ok: true });
        }
        return p in disk ? new Response(disk[p]) : json(404, { error: 'The file does not exist', code: 'notfound' });
    }
    if (u.pathname === '/__native/pick-save') {
        const req = JSON.parse(init.body);
        calls[calls.length - 1].req = req;
        if (!saveAnswer) {
            return json(200, { cancelled: true });
        }
        allowed.add(saveAnswer);
        return json(200, { path: 'local:' + saveAnswer, name: saveAnswer.split('/').pop() });
    }
    if (u.pathname === '/__native/pick-open') {
        return json(200, { files: [{ path: 'local:/Users/me/Robot/parts/Pin.aopart', name: 'Pin.aopart' }] });
    }
    return json(404, { error: 'no such endpoint' });
};

const N = await import('../js/io/native.js');
const F = await import('../js/io/files.js');
const P = await import('../js/io/paths.js');

/* ---- local paths are paths like any other ---- */
a(N.available(), 'the shell is seen');
a(N.isLocal('local:/Users/me/a.aopart') && !N.isLocal('user:/Desktop/a.aopart') && !N.isLocal('local:a') && !N.isLocal(''), 'local paths');
const asm = 'local:/Users/me/Robot/Robot.aoasm';
a(P.relativeTo(asm, 'local:/Users/me/Robot/parts/Pin.aopart') === 'parts/Pin.aopart', 'links stay relative on the Mac');
a(P.relativeTo(asm, 'local:/Volumes/USB/Bolt.aopart') === '../../../Volumes/USB/Bolt.aopart', 'another disk is still under the same root');
a(P.resolveFrom(asm, '../Pin.aopart') === 'local:/Users/me/Pin.aopart', 'and resolve back to Mac paths');
a(N.displayPath('local:/Users/me/Desktop/a.aopart') === '~/Desktop/a.aopart' && N.displayPath('local:/Users/me') === '~', 'the home folder reads as ~');
a(N.displayPath('local:/Users/meg/a.aopart') === '/Users/meg/a.aopart', 'a folder that only starts like home is not home');
a(N.displayPath('user:/Desktop/a.aopart') === 'user:/Desktop/a.aopart' && F.displayPath('') === '', 'other paths are shown as they are');

/* ---- reading ---- */
const part = await F.readPath('local:/Users/me/Robot/parts/Pin.aopart');
a(part.data.format === 'aopart' && part.name === 'Pin', 'a part is read through the shell', part);
a(calls.every(c => c.token === 'secret'), 'every request carries the token');
let err = await F.readPath('user:/Desktop/Pin.aopart').catch(e => e);
a(err instanceof Error && err.code === 'notfound' && /not a file on this Mac/.test(err.message), 'a link into an ArozOS drive is a missing file', err && err.message);
err = await F.readPath('local:/Users/me/Gone.aopart').catch(e => e);
a(err instanceof Error && err.code === 'notfound', 'a missing file says so', err && err.message);
a((await F.open()).path === 'local:/Users/me/Robot/parts/Pin.aopart', 'File > Open goes through the Open dialog');
a(F.launchPath() === null, 'the Mac app takes no ArozOS launch files');
a(await F.hasBackend() === false && !calls.some(c => /ajgi/.test(c.path)), 'the ArozOS backend is never probed');

/* ---- saving ---- */
calls.length = 0;
let saved = await F.save('{"x":1}', 'Pin', 'local:/Users/me/Robot/parts/Pin.aopart', false, '.aopart');
a(saved && saved.path === 'local:/Users/me/Robot/parts/Pin.aopart' && disk['/Users/me/Robot/parts/Pin.aopart'] === '{"x":1}', 'Save writes a document in place', saved);
a(!calls.some(c => /pick-save/.test(c.path)), 'without asking');

calls.length = 0;
saveAnswer = '/Users/me/Robot/Robot.aoasm';
saved = await F.save(function (target) { return 'for ' + target; }, 'Robot', '', false, '.aoasm');
a(saved && saved.name === 'Robot' && disk['/Users/me/Robot/Robot.aoasm'] === 'for local:/Users/me/Robot/Robot.aoasm', 'a new document asks where, and is written for where it lands', saved);
const ask = calls.find(c => /pick-save/.test(c.path));
a(ask && ask.req.name === 'Robot.aoasm' && ask.req.ext === '.aoasm' && ask.req.purpose === 'part', 'the Save dialog gets the name and the type', ask && ask.req);

calls.length = 0;
saveAnswer = '/Users/me/Elsewhere/Restored.aodrw';
saved = await F.save('{}', 'Restored', 'local:/Users/me/Never/Restored.aodrw', false, '.aodrw');
const fallback = calls.find(c => /pick-save/.test(c.path));
a(saved && saved.path === 'local:' + saveAnswer && fallback && fallback.req.near === 'local:/Users/me/Never/Restored.aodrw', 'a write the shell refuses asks where instead, starting in its folder', saved);

saveAnswer = null;
a(await F.save('{}', 'X', '', true, '.aopart') === null, 'a cancelled Save dialog saves nothing');

/* ---- exports and imports ---- */
saveAnswer = '/Users/me/Robot/Pin.stl';
saved = await F.saveAs('Pin.stl', { bytes: new Uint8Array([1, 2, 3]) });
a(saved && saved.name === 'Pin.stl' && saved.path === 'local:/Users/me/Robot/Pin.stl', 'an export goes where the Save dialog says', saved);
const pick = calls.filter(c => /pick-save/.test(c.path)).pop();
a(pick.req.ext === '.stl' && pick.req.purpose === 'export', 'with its own type and folder memory', pick.req);

console.log(failed ? failed + ' native checks FAILED' : 'native: all checks passed');
process.exitCode = failed ? 1 : 0;
