// Build & minify Gather Studio client bundles with esbuild.
// Lives in the project root so Cloud Run / container builds always find it even if scripts/ is omitted.
// - Bundles src/mood-chart.js (zero-dependency native SVG) -> public/mood-chart.js
// - Bundles src/firebase-client.js -> public/firebase-client.js
// - Minifies core public/*.js and public/*.css into public/dist/ (served transparently by server.js)
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(PUBLIC, 'dist');

async function main() {
  if (!fs.existsSync(PUBLIC)) {
    throw new Error(`Missing public directory at ${PUBLIC}`);
  }
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Bundle src/ entrypoints into public/ when present
  const bundleJobs = [];
  const moodEntry = path.join(ROOT, 'src', 'mood-chart.js');
  if (fs.existsSync(moodEntry)) {
    bundleJobs.push(
      esbuild.build({
        entryPoints: [moodEntry],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        minify: true,
        outfile: path.join(PUBLIC, 'mood-chart.js'),
      }),
    );
  }
  const fbEntry = path.join(ROOT, 'src', 'firebase-client.js');
  const fbCfg = path.join(ROOT, 'firebase-applet-config.json');
  if (fs.existsSync(fbEntry) && fs.existsSync(fbCfg)) {
    bundleJobs.push(
      esbuild.build({
        entryPoints: [fbEntry],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        minify: true,
        outfile: path.join(PUBLIC, 'firebase-client.js'),
      }),
    );
  }
  if (bundleJobs.length) await Promise.all(bundleJobs);

  // 2. Minify first-party JS and CSS assets in public/ into public/dist/
  //    (without bundling so ESM dynamic imports & individual cacheability stay intact)
  const skip = new Set(['mood-chart.js', 'firebase-client.js']);
  const entries = fs.readdirSync(PUBLIC).filter((name) => {
    if (skip.has(name)) return false;
    return name.endsWith('.js') || name.endsWith('.css');
  });

  let rawTotal = 0;
  let minTotal = 0;

  await Promise.all(
    entries.map(async (name) => {
      const srcPath = path.join(PUBLIC, name);
      const outPath = path.join(DIST, name);
      const isCss = name.endsWith('.css');
      rawTotal += fs.statSync(srcPath).size;
      await esbuild.build({
        entryPoints: [srcPath],
        bundle: false,
        minify: true,
        target: isCss ? ['chrome105', 'safari15.4', 'firefox105'] : ['es2022'],
        outfile: outPath,
        legalComments: 'none',
      });
      minTotal += fs.statSync(outPath).size;
    }),
  );

  const moodPath = path.join(PUBLIC, 'mood-chart.js');
  const moodSize = fs.existsSync(moodPath) ? fs.statSync(moodPath).size : 0;
  const savedPct = rawTotal > 0 ? Math.round(((rawTotal - minTotal) / rawTotal) * 100) : 0;
  console.log(
    `[build-assets] mood-chart.js ${(moodSize / 1024).toFixed(1)} KB | minified ${entries.length} assets: ${(rawTotal / 1024).toFixed(0)} KB -> ${(minTotal / 1024).toFixed(0)} KB (-${savedPct}%)`,
  );
}

main().catch((err) => {
  console.error('[build-assets] failed:', err);
  process.exit(1);
});
