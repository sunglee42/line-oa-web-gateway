import { join } from 'node:path';
import type { SessionCredentials, SessionState } from './types.js';
import { atomicWriteJson, readJsonSafe } from './storage.js';

export function validSession(value: unknown): value is SessionCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SessionCredentials>;
  const allowed = new Set(['ses', '__Host-chat-ses', 'XSRF-TOKEN']);
  const cookiesValid = Array.isArray(v.cookies) && v.cookies.some(c => c.name === '__Host-chat-ses') &&
    v.cookies.every(c => allowed.has(c.name) && typeof c.value === 'string' && !!c.value && !/[\r\n;]/.test(c.value)) &&
    new Set(v.cookies.map(c => c.name)).size === v.cookies.length;
  return v.version === 1 && /^U[0-9a-f]{32}$/.test(v.botId ?? '') && cookiesValid &&
    typeof v.importedAt === 'string' && Number.isFinite(Date.parse(v.importedAt)) &&
    (v.csrfToken === undefined || (typeof v.csrfToken === 'string' && !!v.csrfToken && !/[\r\n;]/.test(v.csrfToken))) &&
    (v.clientVersion === undefined || (typeof v.clientVersion === 'string' && v.clientVersion.length <= 100 && !/[\r\n]/.test(v.clientVersion)));
}

export class SessionManager {
  private credentials?: SessionCredentials;
  private generation = 0;
  private state: SessionState = 'AUTH_REQUIRED';
  private reason = '尚未登入 LINE，請先登入';
  private lastValidatedAt?: string;
  private readonly path: string;

  constructor(dataDir: string) { this.path = join(dataDir, 'secrets', 'line-session.json'); }

  async load(): Promise<void> {
    const loaded = await readJsonSafe<SessionCredentials | null>(this.path, null, (v): v is SessionCredentials | null => v === null || validSession(v));
    if (loaded.value) {
      this.credentials = loaded.value;
      this.state = 'VALIDATING';
      this.reason = 'Session 已載入，正在驗證';
    } else if (loaded.warning) {
      this.state = 'ERROR';
      this.reason = 'Session 檔案格式無效，請重新登入';
    }
  }

  getCredentials(): SessionCredentials | undefined { return this.credentials; }
  getStatus(): { state: SessionState; reason: string; lastValidatedAt?: string; lastLoginAt?: string; loginAgeDays?: number; accountName?: string; botIdConfigured: boolean } {
    const lastLoginAt = this.credentials?.importedAt;
    const loginAgeDays = lastLoginAt ? Math.max(0, Math.floor((Date.now() - Date.parse(lastLoginAt)) / 86_400_000)) : undefined;
    return { state: this.state, reason: this.reason, lastValidatedAt: this.lastValidatedAt, lastLoginAt, loginAgeDays, accountName: this.credentials?.accountName, botIdConfigured: !!this.credentials };
  }

  mark(state: SessionState, reason: string): void {
    if (!this.credentials) return;
    this.state = state;
    this.reason = reason;
    if (state === 'CONNECTED') this.lastValidatedAt = new Date().toISOString();
  }

  async logout(): Promise<void> {
    ++this.generation;
    this.credentials = undefined;
    this.state = 'AUTH_REQUIRED';
    this.reason = '已登出 LINE，請重新登入';
    this.lastValidatedAt = undefined;
    // Queue a tombstone after pending writes so no older import/refresh can restore credentials.
    await atomicWriteJson(this.path, null, 0o600);
  }

  async updateCsrf(token: string, expected?: SessionCredentials): Promise<void> {
    if (!this.credentials || (expected && expected !== this.credentials)) throw new Error('SESSION_CHANGED');
    this.credentials.csrfToken = token;
    const cookie = this.credentials.cookies.find(c => c.name === 'XSRF-TOKEN');
    if (cookie) cookie.value = token;
    else this.credentials.cookies.push({ name: 'XSRF-TOKEN', value: token });
    await atomicWriteJson(this.path, this.credentials, 0o600);
  }

  async importCredentials(credentials: SessionCredentials): Promise<void> {
    if (!validSession(credentials)) throw new Error('INVALID_SESSION');
    const generation = ++this.generation;
    await atomicWriteJson(this.path, credentials, 0o600);
    if (generation !== this.generation) throw new Error('SESSION_CHANGED');
    this.credentials = structuredClone(credentials);
    this.state = 'VALIDATING';
    this.reason = 'QR 登入完成，正在驗證 Session';
    this.lastValidatedAt = undefined;
  }
}
