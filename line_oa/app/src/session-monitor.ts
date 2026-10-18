import { LineClient, LineError } from './line-client.js';
import { SessionManager } from './session.js';
import { MemoryLogger } from './logger.js';

export const SESSION_CHECK_INTERVAL_MS = 5 * 60_000;

/** Read-only LINE probes. Never sends messages, starts QR, or renews login. */
export class SessionMonitor {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(private readonly sessions: SessionManager, private readonly client: LineClient,
    private readonly logger: MemoryLogger, private readonly busy: () => boolean,
    private readonly intervalMs = SESSION_CHECK_INTERVAL_MS) {}

  start(): void {
    void this.cycle();
  }

  private async cycle(): Promise<void> {
    await this.check();
    if (!this.stopped) {
      this.timer = setTimeout(() => { void this.cycle(); }, this.intervalMs);
      this.timer.unref();
    }
  }

  async check(): Promise<void> {
    if (this.stopped) return;
    if (this.active) return this.active;
    const credentials = this.sessions.getCredentials();
    // Do not repeatedly call LINE after a confirmed expiry; wait for human login.
    if (!credentials || this.sessions.getStatus().state === 'EXPIRED' || this.busy()) return;
    this.active = (async () => {
      let state: 'CONNECTED' | 'EXPIRED' | 'DISCONNECTED' | 'ERROR' = 'CONNECTED';
      let code: string | undefined;
      try { await this.client.validate(); }
      catch (error) {
        const kind = error instanceof LineError ? error.kind : 'NETWORK';
        state = kind === 'AUTH' ? 'EXPIRED' : kind === 'NETWORK' ? 'DISCONNECTED' : 'ERROR';
        code = error instanceof LineError ? error.code : 'SESSION_VALIDATION_FAILED';
      }
      // A pending result must not overwrite logout, a new login, or shutdown.
      if (this.stopped || this.sessions.getCredentials() !== credentials) return;
      const changed = this.sessions.getStatus().state !== state;
      this.sessions.mark(state, state === 'CONNECTED' ? '背景 Session 驗證成功' : `背景驗證失敗：${code}`);
      if (changed) this.logger.add('SESSION_BACKGROUND_VALIDATE', state === 'CONNECTED' ? 'SUCCESS' : 'FAILED', undefined, code);
    })();
    try { await this.active; } finally { this.active = undefined; }
  }

  stop(): void { this.stopped = true; clearTimeout(this.timer); }
}
