/*
    Paint - start up: locale, server check, tools, interface, then a blank
    picture (or the file the window was opened with).
*/
import { App } from './app.js';
import { History } from './history.js';
import { View } from './view.js';
import { registerPaintTools } from './tools.js';
import { registerShapeTool } from './shapetool.js';
import { registerSelectTools } from './selection.js';
import { registerTextTool } from './texttool.js';
import { registerOps, Ops } from './imageops.js';
import { FileIO } from './fileio.js';
import { buildUI, initTheme } from './ui.js';
import { clamp } from './util.js';

function loadLocale() {
    return new Promise((resolve) => {
        if (typeof applocale === 'undefined' || !applocale) {
            resolve();
            return;
        }
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                resolve();
            }
        };
        setTimeout(finish, 3000);
        try {
            applocale.init('locale/paint.json', finish, finish);
        } catch (e) {
            finish();
        }
    });
}

async function boot() {
    App.loadPrefs();
    await loadLocale();
    App.backend = await FileIO.detectBackend();
    document.body.classList.toggle('standalone', !App.backend);

    App.history = new History();
    View.init();
    registerOps();
    registerPaintTools();
    registerShapeTool();
    registerSelectTools();
    registerTextTool();
    buildUI();
    initTheme();
    FileIO.bindDrop(View.ws);

    // A blank picture that fills the window at 100 %
    const w = clamp(Math.round(View.ws.clientWidth - 96), 320, 1920);
    const h = clamp(Math.round(View.ws.clientHeight - 96), 240, 1080);
    Ops.newImage(w, h, false);
    App.setTool(App.state.tool || 'brush');
    FileIO.openLaunchFiles();
    document.body.classList.add('ready');
}

boot();
