/**
 * electron-builder `beforePack` hook.
 *
 * Generates the first-party bundled extension package (a .ocx = tar.gz of
 * `extensions/social-auto-poster/`) into `apps/desktop/resources/bundled-extensions/`
 * so the packaged app can install it offline in ONE click (the marketplace
 * "install" for `ext-social-auto-poster` reads this bundled file first). Because
 * `*.ocx` is gitignored, the package is generated fresh at build time from the
 * committed, repointed (Auto-Post) source — never a stale committed binary.
 *
 * FAIL-SAFE: on ANY error this logs a warning and returns without throwing, so a
 * packaging problem here can never break the release — the app simply falls back
 * to the marketplace download path (existing behavior).
 *
 * @param {import('electron-builder').BeforePackContext} _context
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OCX_NAME = 'social-auto-poster-0.3.0.ocx';

exports.default = async function beforePack(_context) {
  const appDir = path.resolve(__dirname, '..'); // apps/desktop
  const srcDir = path.resolve(appDir, '../../extensions/social-auto-poster');
  const outDir = path.join(appDir, 'resources', 'bundled-extensions');
  try {
    // Always ensure the extraResources `from` dir exists so packaging never fails
    // on a missing directory, even if the tar step below is skipped.
    fs.mkdirSync(outDir, { recursive: true });

    if (!fs.existsSync(path.join(srcDir, 'manifest.json'))) {
      console.warn('[before-pack] extension source missing, skipping bundled .ocx:', srcDir);
      return;
    }
    // Only pack files that exist; manifest + dist are required, README optional.
    // `service/` (the managed local backend profile: docker-compose.izzi.yml) is
    // packed when present so the host can boot the backend on the user's machine.
    const entries = ['manifest.json', 'dist'];
    if (fs.existsSync(path.join(srcDir, 'README.md'))) entries.splice(1, 0, 'README.md');
    if (fs.existsSync(path.join(srcDir, 'service'))) entries.push('service');

    const outFile = path.join(outDir, OCX_NAME);
    // `tar` is available on windows-latest, macos-latest and linux CI runners.
    execFileSync('tar', ['-czf', outFile, '-C', srcDir, ...entries], { stdio: 'pipe' });
    console.log('[before-pack] packed bundled extension \u2192', outFile);
  } catch (err) {
    console.warn(
      '[before-pack] could not pack bundled extension (falling back to marketplace download):',
      err && err.message,
    );
  }
};
