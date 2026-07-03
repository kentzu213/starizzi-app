/**
 * Affiliate IPC registration — wires the renderer-facing channels to the
 * main-process `AffiliateClient`. Lives in the Electron MAIN process.
 *
 * Security: every handler delegates straight to the client and returns ONLY
 * plain DTOs / results. The JWT lives only inside AffiliateClient and NEVER
 * crosses the IPC boundary.
 */

import { ipcMain, shell } from 'electron';
import type { AffiliateClient, WithdrawInput } from './affiliate-client';

export function registerAffiliateIpc(client: AffiliateClient): void {
  ipcMain.handle('affiliate:stats', () => client.getStats());
  ipcMain.handle('affiliate:commissions', () => client.listCommissions());
  ipcMain.handle('affiliate:withdrawals', () => client.listWithdrawals());
  ipcMain.handle('affiliate:withdraw', (_e, input: WithdrawInput) => client.withdraw(input));
  ipcMain.handle('affiliate:convertCredit', (_e, amount: number) => client.convertCredit(amount));

  ipcMain.handle('affiliate:openWeb', async () => {
    const url = client.affiliateWebUrl();
    await shell.openExternal(url);
    return { ok: true, url };
  });
}
