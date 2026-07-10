/**
 * electron-builder `beforePack` hook.
 *
 * Packs EVERY first-party extension under `extensions/<name>/` (that has a
 * manifest.json + dist) into `<name>-<version>.ocx` in
 * `apps/desktop/resources/bundled-extensions/`, so the packaged app can install
 * them offline in ONE click (the marketplace "install" reads the bundled file
 * first). Because `*.ocx` is gitignored, packages are generated fresh at build
 * time from the committed source — never a stale committed binary.
 *
 * FAIL-SAFE: any error logs a warning and continues, so a packaging problem here
 * can never break the release — the app falls back to the marketplace download.
 *
 * @param {import('electron-builder').BeforePackContext} _context
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function beforePack(_context) {
  const appDir = path.resolve(__dirname, '..'); // apps/desktop
  const extRoot = path.resolve(appDir, '../../extensions');
  const outDir = path.join(appDir, 'resources', 'bundled-extensions');
  try {
    // Ensure the extraResources `from` dir always exists so packaging never fails
    // on a missing directory, even if no extension is packed below.
    fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(extRoot)) return;

    const dirs = fs.readdirSync(extRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const srcDir = path.join(extRoot, d.name);
      const manifestPath = path.join(srcDir, 'manifest.json');
      // Require manifest + dist (the entry point); skip loose dirs.
      if (!fs.existsSync(manifestPath) || !fs.existsSync(path.join(srcDir, 'dist'))) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const version = manifest.version || '0.0.0';
        // manifest + dist required; README + service (managed backend) optional.
        const entries = ['manifest.json', 'dist'];
        if (fs.existsSync(path.join(srcDir, 'README.md'))) entries.splice(1, 0, 'README.md');
        if (fs.existsSync(path.join(srcDir, 'service'))) entries.push('service');
        const outFile = path.join(outDir, `${d.name}-${version}.ocx`);
        // `tar` is available on windows-latest, macos-latest and linux CI runners.
        execFileSync('tar', ['-czf', outFile, '-C', srcDir, ...entries], { stdio: 'pipe' });
        console.log('[before-pack] packed bundled extension \u2192', outFile);
      } catch (e) {
        console.warn(`[before-pack] skip ${d.name}:`, e && e.message);
      }
    }
  } catch (err) {
    console.warn(
      '[before-pack] could not pack bundled extensions (falling back to marketplace download):',
      err && err.message,
    );
  }
};
