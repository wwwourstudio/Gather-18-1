const Module = require('node:module');
const fs = require('node:fs');
const origLoad = Module._load;
const FALLBACK_EXE = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (request === 'playwright' && mod && mod.chromium && !mod.chromium.__patchedExec) {
    mod.chromium.__patchedExec = true;
    const origLaunch = mod.chromium.launch.bind(mod.chromium);
    mod.chromium.launch = function (opts = {}) {
      if (!opts.executablePath && fs.existsSync(FALLBACK_EXE) && !fs.existsSync(mod.chromium.executablePath())) {
        opts = { ...opts, executablePath: FALLBACK_EXE };
      }
      return origLaunch(opts);
    };
  }
  return mod;
};
