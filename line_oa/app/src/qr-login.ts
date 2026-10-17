import { diagnosticText, networkDetails } from './diagnostics.js';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { SessionCredentials } from './types.js';
import { SessionManager } from './session.js';

const ALLOWED_HOSTS = new Set(['chat.line.biz', 'account.line.biz', 'access.line.me']);
const START_URL = 'https://chat.line.biz/';
const ACCESS_ORIGIN = 'https://access.line.me';
const QR_LIFETIME_MS = 4 * 60_000;
const TERMINAL_STATE_MS = 60_000;
// LINE Business ID serves a reduced non-interactive page to generic HTTP clients.
// This identifies the protocol client as a desktop Chromium-class web client; no browser process is started.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export type QrLoginStatus = 'idle' | 'starting' | 'qr' | 'pin' | 'finalizing' | 'selecting' | 'ok' | 'error';
export interface PublicLoginChoice { id: string; label: string }
export interface PublicQrLoginState {
  status: QrLoginStatus;
  hasQr: boolean;
  pin?: string;
  message?: string;
  choices?: PublicLoginChoice[];
  expiresAt?: string;
  error_name?: string;
  details?: string;
}

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt?: number;
};

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/';
  const end = pathname.lastIndexOf('/');
  return end <= 0 ? '/' : pathname.slice(0, end);
}

function domainMatches(host: string, domain: string, hostOnly: boolean): boolean {
  return hostOnly ? host === domain : host === domain || host.endsWith(`.${domain}`);
}

export class MemoryCookieJar {
  private cookies = new Map<string, StoredCookie>();

  setFromHeaders(url: URL, headers: Headers): void {
    const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const value of values) this.set(url, value);
  }

  set(url: URL, header: string): void {
    const parts = header.split(';').map(part => part.trim());
    const pair = parts.shift();
    if (!pair) return;
    const equals = pair.indexOf('=');
    if (equals <= 0) return;
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n;]/.test(value)) return;
    let domain = url.hostname.toLowerCase();
    let hostOnly = true;
    let path = defaultCookiePath(url.pathname);
    let secure = false;
    let expiresAt: number | undefined;
    for (const raw of parts) {
      const split = raw.indexOf('=');
      const key = (split < 0 ? raw : raw.slice(0, split)).trim().toLowerCase();
      const attr = split < 0 ? '' : raw.slice(split + 1).trim();
      if (key === 'domain') {
        const candidate = attr.replace(/^\./, '').toLowerCase();
        if (!candidate || isIP(candidate) || !domainMatches(url.hostname.toLowerCase(), candidate, false)) return;
        domain = candidate;
        hostOnly = false;
      } else if (key === 'path' && attr.startsWith('/')) path = attr;
      else if (key === 'secure') secure = true;
      else if (key === 'max-age' && /^-?\d+$/.test(attr)) expiresAt = Date.now() + Number(attr) * 1000;
      else if (key === 'expires' && !expiresAt) {
        const parsed = Date.parse(attr);
        if (Number.isFinite(parsed)) expiresAt = parsed;
      }
    }
    if (name.startsWith('__Host-') && (!secure || !hostOnly || path !== '/')) return;
    const key = `${domain}\n${path}\n${name}`;
    if (expiresAt !== undefined && expiresAt <= Date.now()) this.cookies.delete(key);
    else this.cookies.set(key, { name, value, domain, hostOnly, path, secure, expiresAt });
  }

  header(url: URL): string {
    const now = Date.now();
    const matches: StoredCookie[] = [];
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) { this.cookies.delete(key); continue; }
      if (cookie.secure && url.protocol !== 'https:') continue;
      if (!domainMatches(url.hostname.toLowerCase(), cookie.domain, cookie.hostOnly)) continue;
      if (!(url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))) continue;
      matches.push(cookie);
    }
    matches.sort((a, b) => b.path.length - a.path.length);
    return matches.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  value(name: string, url: URL): string | undefined {
    const header = this.header(url);
    for (const pair of header.split('; ')) if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
    return undefined;
  }

  clear(): void { this.cookies.clear(); }
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, decimal: string) => String.fromCodePoint(Number(decimal)));
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1]!.toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

export function extractLineLoginForm(html: string, baseUrl: URL): { action: URL; csrf: string } {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].sort((a, b) => {
    const aAction = attributes(a[1] ?? '').action ?? '';
    const bAction = attributes(b[1] ?? '').action ?? '';
    return Number(bAction.includes('disableLineAutoLogin=false')) - Number(aAction.includes('disableLineAutoLogin=false'));
  });
  if (!forms.length) throw new Error('LOGIN_BUSINESS_FORM_MISSING');
  let lineActionFound = false;
  for (const form of forms) {
    const attrs = attributes(form[1] ?? '');
    if (!attrs.action?.includes('/login/line') || (attrs.method ?? 'get').toLowerCase() !== 'post') continue;
    lineActionFound = true;
    for (const input of (form[2] ?? '').matchAll(/<input\b[^>]*>/gi)) {
      const inputAttrs = attributes(input[0]);
      if (inputAttrs.name === '_csrf' && inputAttrs.value && !/[\r\n]/.test(inputAttrs.value)) {
        return { action: new URL(attrs.action, baseUrl), csrf: inputAttrs.value };
      }
    }
  }
  throw new Error(lineActionFound ? 'LOGIN_BUSINESS_CSRF_MISSING' : 'LOGIN_BUSINESS_ACTION_MISSING');
}

function normalizedLoginHtml(html: string): string {
  return decodeHtml(html).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
}

function onePath(html: string, prefix: string): string {
  const pattern = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Za-z0-9_-]+`, 'g');
  const values = [...new Set(html.match(pattern) ?? [])];
  if (values.length !== 1) throw new Error('LOGIN_QR_OPTIONS_CHANGED');
  return values[0]!;
}

export function extractQrOptions(html: string, pageUrl: URL): { channelId: string; returnUri: string; waitQrPath: string; waitPinPath: string } {
  const source = normalizedLoginHtml(html);
  const channelId = pageUrl.searchParams.get('loginChannelId') ?? '';
  if (!/^\d{5,20}$/.test(channelId)) throw new Error('LOGIN_QR_OPTIONS_CHANGED');
  return {
    channelId,
    returnUri: onePath(source, '/qrlogin/oauth2/v2.1/'),
    waitQrPath: onePath(source, '/qrlogin/v1/qr/'),
    waitPinPath: onePath(source, '/qrlogin/v1/pin/')
  };
}

type ParsedInteractionChoice = { label: string; action: URL; method: 'GET' | 'POST'; body?: string };

function visibleText(html: string): string {
  return decodeHtml(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

function choiceLabel(body: string, attrs: Record<string, string>, fallback = ''): string {
  const direct = attrs['aria-label'] || attrs['data-account-name'] || attrs.title;
  if (direct) return direct.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (attrs.id) {
    for (const match of body.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
      if (attributes(match[1] ?? '').for === attrs.id) {
        const label = visibleText(match[2] ?? '');
        if (label) return label.slice(0, 100);
      }
    }
  }
  return fallback.replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function extractInteractionChoices(html: string, pageUrl: URL): ParsedInteractionChoice[] {
  const choices: ParsedInteractionChoice[] = [];
  const add = (choice: ParsedInteractionChoice) => {
    if (!choice.label || choice.label.length > 100 || !ALLOWED_HOSTS.has(choice.action.hostname) || choice.action.protocol !== 'https:') return;
    if (choices.some(item => item.label === choice.label && item.action.toString() === choice.action.toString() && item.body === choice.body)) return;
    if (choices.length < 20) choices.push(choice);
  };
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAttrs = attributes(form[1] ?? '');
    const method = (formAttrs.method ?? 'get').toUpperCase();
    if (method !== 'GET' && method !== 'POST') continue;
    const action = new URL(formAttrs.action || pageUrl.toString(), pageUrl);
    const content = form[2] ?? '';
    const fields: Record<string, string> = {};
    let unsafe = false;
    const radios: Array<{ attrs: Record<string, string>; label: string }> = [];
    const submits: Array<{ attrs: Record<string, string>; label: string }> = [];
    for (const input of content.matchAll(/<input\b[^>]*>/gi)) {
      const item = attributes(input[0]);
      const type = (item.type ?? 'text').toLowerCase();
      if (type === 'hidden' && item.name) fields[item.name] = item.value ?? '';
      else if (type === 'radio' && item.name && item.value) radios.push({ attrs: item, label: choiceLabel(content, item, item.value) });
      else if (type === 'submit') submits.push({ attrs: item, label: choiceLabel(content, item, item.value || '繼續') });
      else if (!['button', 'image'].includes(type)) unsafe = true;
    }
    if (unsafe) continue;
    const selectChoices: Array<{ name: string; value: string; label: string }> = [];
    for (const select of content.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const selectAttrs = attributes(select[1] ?? '');
      if (!selectAttrs.name) { unsafe = true; break; }
      for (const option of (select[2] ?? '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
        const optionAttrs = attributes(option[1] ?? '');
        if (optionAttrs.value) selectChoices.push({ name: selectAttrs.name, value: optionAttrs.value, label: visibleText(option[2] ?? '') || optionAttrs.value });
      }
    }
    if (unsafe) continue;
    for (const button of content.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const item = attributes(button[1] ?? '');
      if ((item.type ?? 'submit').toLowerCase() === 'submit') submits.push({ attrs: item, label: choiceLabel(content, item, visibleText(button[2] ?? '') || item.value || '繼續') });
    }
    const build = (extra: Record<string, string>, label: string) => {
      const params = new URLSearchParams({ ...fields, ...extra });
      if (method === 'GET') {
        const url = new URL(action);
        for (const [key, value] of params) url.searchParams.set(key, value);
        add({ label, action: url, method: 'GET' });
      } else add({ label, action, method: 'POST', body: params.toString() });
    };
    if (radios.length) for (const radio of radios) build({ [radio.attrs.name!]: radio.attrs.value! }, radio.label);
    else if (selectChoices.length) for (const option of selectChoices) build({ [option.name]: option.value }, option.label);
    else for (const submit of submits) build(submit.attrs.name ? { [submit.attrs.name]: submit.attrs.value ?? '' } : {}, submit.label);
  }
  for (const link of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = attributes(link[1] ?? '');
    if (!attrs.href) continue;
    const label = choiceLabel(html, attrs, visibleText(link[2] ?? ''));
    const action = new URL(attrs.href, pageUrl);
    if (!/(account|select|switch|bot|official|oauth|login)|U[0-9a-f]{32}/i.test(action.pathname + action.search)) continue;
    if (/(logout|privacy|terms|help|register)/i.test(action.pathname + action.search)) continue;
    add({ label, action, method: 'GET' });
  }
  return choices;
}

type PendingChoice =
  | (ParsedInteractionChoice & { id: string; kind: 'navigation'; referer: string; botId?: string })
  | { id: string; kind: 'bot'; label: string; botId: string };

type Flow = {
  owner: string;
  status: QrLoginStatus;
  jar: MemoryCookieJar;
  controller: AbortController;
  createdAt: number;
  expiresAt: number;
  qrImage?: Buffer;
  pin?: string;
  message?: string;
  channelId?: string;
  loginState?: string;
  oauthReturnUri?: string;
  accessReferer?: string;
  waitQrPath?: string;
  waitPinPath?: string;
  choices?: Map<string, PendingChoice>;
  selectedBotId?: string;
  selectedAccountName?: string;
  chatReferer?: string;
  finishSteps: number;
  terminalAt?: number;
  botCandidates: Set<string>;
  diagnostics?: string;
};

type HttpResult = { url: URL; status: number; headers: Headers; body: Buffer };
type LoginTrace = (operation: string, result: string, target?: string, error?: string, details?: string) => void;

export class BusinessQrLogin {
  private flow?: Flow;
  constructor(private readonly sessions: SessionManager, private readonly trace?: LoginTrace) {}

  state(owner: string): PublicQrLoginState {
    this.prune();
    const flow = this.flow;
    if (!flow || flow.owner !== owner) return { status: 'idle', hasQr: false };
    return {
      status: flow.status,
      hasQr: !!flow.qrImage,
      ...(flow.pin ? { pin: flow.pin } : {}),
      ...(flow.message ? { message: flow.message } : {}),
      ...(flow.status === 'error' ? { error_name: flow.message, details: flow.diagnostics } : {}),
      ...(flow.choices?.size ? { choices: [...flow.choices.values()].map(({ id, label }) => ({ id, label })) } : {}),
      ...(!flow.terminalAt ? { expiresAt: new Date(flow.expiresAt).toISOString() } : {})
    };
  }

  image(owner: string): Buffer | undefined {
    this.prune();
    return this.flow?.owner === owner ? this.flow.qrImage : undefined;
  }

  async start(owner: string): Promise<PublicQrLoginState> {
    this.prune();
    if (this.flow && this.flow.owner !== owner && !this.flow.terminalAt) throw new Error('LOGIN_BUSY');
    if (this.flow) this.destroy(this.flow);
    const flow: Flow = {
      owner,
      status: 'starting',
      jar: new MemoryCookieJar(),
      controller: new AbortController(),
      createdAt: Date.now(),
      expiresAt: Date.now() + QR_LIFETIME_MS,
      finishSteps: 0,
      botCandidates: new Set()
    };
    this.flow = flow;
    try {
      await this.createQr(flow);
      void this.monitor(flow);
      return this.state(owner);
    } catch (error) {
      this.fail(flow, this.safeError(error));
      return this.state(owner);
    }
  }

  async select(owner: string, choiceId: string): Promise<PublicQrLoginState> {
    this.prune();
    const flow = this.flow;
    if (!flow || flow.owner !== owner || flow.status !== 'selecting' || !flow.choices) throw new Error('LOGIN_SELECTION_NOT_AVAILABLE');
    const choice = flow.choices.get(choiceId);
    if (!choice) throw new Error('LOGIN_SELECTION_INVALID');
    flow.choices.clear();
    flow.choices = undefined;
    flow.chatReferer = undefined;
    flow.status = 'finalizing';
    flow.message = '正在切換至選定的官方帳號';
    if (choice.kind === 'bot') {
      flow.selectedBotId = choice.botId;
      flow.selectedAccountName = choice.label;
      try { await this.persist(flow, new URL(flow.chatReferer ?? START_URL)); }
      catch (error) { this.fail(flow, this.safeError(error)); }
      return this.state(owner);
    }
    if (choice.botId) flow.selectedBotId = choice.botId;
    try {
      const response = await this.follow(flow, choice.action, choice.method === 'POST'
        ? { method: 'POST', body: choice.body ?? '', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: choice.action.origin, Referer: choice.referer } }
        : { headers: { Referer: choice.referer } });
      await this.complete(flow, response);
    } catch (error) {
      this.fail(flow, this.safeError(error));
    }
    return this.state(owner);
  }

  cancel(owner: string): void {
    if (this.flow?.owner !== owner) return;
    this.destroy(this.flow);
    this.flow = undefined;
  }

  close(): void {
    if (this.flow) this.destroy(this.flow);
    this.flow = undefined;
  }

  private prune(): void {
    const flow = this.flow;
    if (!flow) return;
    if ((!flow.terminalAt && Date.now() > flow.expiresAt) || (flow.terminalAt && Date.now() - flow.terminalAt > TERMINAL_STATE_MS)) {
      this.destroy(flow);
      this.flow = undefined;
    }
  }

  private destroy(flow: Flow): void {
    if (!flow.controller.signal.aborted) flow.controller.abort();
    flow.jar.clear();
    flow.qrImage = undefined;
    flow.pin = undefined;
    flow.accessReferer = undefined;
    flow.loginState = undefined;
    flow.oauthReturnUri = undefined;
    flow.choices?.clear();
    flow.choices = undefined;
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && /^LOGIN_[A-Z0-9_]+$/.test(error.message)) return error.message;
    if (error instanceof Error && error.name === 'AbortError') return 'LOGIN_CANCELLED_OR_TIMEOUT';
    return 'LOGIN_NETWORK_ERROR';
  }

  private fail(flow: Flow, message: string): void {
    if (this.flow !== flow) return;
    this.trace?.('QR_LOGIN_FLOW', 'FAILED', undefined, message, flow.diagnostics);
    flow.status = 'error';
    flow.message = message;
    flow.terminalAt = Date.now();
    this.destroy(flow);
  }

  private assertActive(flow: Flow): void {
    if (this.flow !== flow || flow.controller.signal.aborted) throw new Error('LOGIN_CANCELLED_OR_TIMEOUT');
    if (Date.now() > flow.expiresAt) throw new Error('LOGIN_QR_EXPIRED');
  }

  private validateUrl(url: URL): void {
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port) throw new Error('LOGIN_REDIRECT_REJECTED');
  }

  private routeCategory(url: URL): string {
    if (url.hostname === 'access.line.me') {
      if (url.pathname.startsWith('/qrlogin/oauth2/')) return 'ACCESS_QR_CALLBACK';
      if (url.pathname.startsWith('/oauth2/')) return 'ACCESS_OAUTH';
      if (url.pathname.startsWith('/qrlogin/')) return 'ACCESS_QR';
      return 'ACCESS_OTHER';
    }
    if (url.hostname === 'account.line.biz') {
      if (url.pathname.startsWith('/login/line/callback')) return 'ACCOUNT_LINE_CALLBACK';
      if (url.pathname.startsWith('/login/line')) return 'ACCOUNT_LINE_LOGIN';
      if (url.pathname.startsWith('/oauth2/')) return 'ACCOUNT_OAUTH';
      if (url.pathname.startsWith('/login')) return 'ACCOUNT_LOGIN';
      return 'ACCOUNT_OTHER';
    }
    if (url.pathname.startsWith('/api/oauth2/callback')) return 'CHAT_OAUTH_CALLBACK';
    if (url.pathname.startsWith('/login')) return 'CHAT_LOGIN';
    return 'CHAT_OTHER';
  }

  private async request(flow: Flow, url: URL, init: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<HttpResult> {
    this.assertActive(flow);
    this.validateUrl(url);
    const cookie = flow.jar.header(url);
    const headers: Record<string, string> = { Accept: '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7', 'User-Agent': USER_AGENT, ...(init.headers ?? {}) };
    if (cookie) headers.Cookie = cookie;
    const requestController = new AbortController();
    const cancelRequest = () => requestController.abort();
    flow.controller.signal.addEventListener('abort', cancelRequest, { once: true });
    const timer = setTimeout(() => requestController.abort(), init.timeoutMs ?? 25_000);
    try {
      const response = await fetch(url, { method: init.method ?? 'GET', headers, body: init.body, redirect: 'manual', signal: requestController.signal });
      this.assertActive(flow);
      flow.jar.setFromHeaders(url, response.headers);
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > 2 * 1024 * 1024) throw new Error('LOGIN_RESPONSE_TOO_LARGE');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 2 * 1024 * 1024) throw new Error('LOGIN_RESPONSE_TOO_LARGE');
      this.assertActive(flow);
      const secrets = [flow.pin ?? '', flow.loginState ?? '', flow.oauthReturnUri ?? ''];
      for (const origin of ['https://chat.line.biz/', 'https://account.line.biz/', 'https://access.line.me/']) {
        for (const pair of flow.jar.header(new URL(origin)).split('; ')) { const index = pair.indexOf('='); if (index >= 0) secrets.push(pair.slice(index + 1)); }
      }
      for (const value of url.searchParams.values()) secrets.push(value);
      if (init.body) for (const value of new URLSearchParams(init.body).values()) secrets.push(value);
      const contentType = response.headers.get('content-type') ?? '';
      flow.diagnostics = diagnosticText({ method: init.method ?? 'GET', endpoint: url.toString(), httpStatus: response.status,
        contentType, responseHeaders: Object.fromEntries(response.headers),
        response: /image\//i.test(contentType) ? `二進位影像（${body.length} bytes）` : body.toString('utf8') }, secrets);
      this.collectBotCandidates(flow, url.toString());
      return { url, status: response.status, headers: response.headers, body };
    } catch (error) {
      if (!(error instanceof Error) || !/^LOGIN_/.test(error.message)) flow.diagnostics = diagnosticText({ endpoint: this.routeCategory(url), networkError: networkDetails(error) });
      throw error;
    } finally {
      clearTimeout(timer);
      flow.controller.signal.removeEventListener('abort', cancelRequest);
    }
  }

  private async follow(flow: Flow, start: URL, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<HttpResult> {
    let url = start;
    let method = init.method ?? 'GET';
    let body = init.body;
    let extraHeaders = init.headers ?? {};
    let referer: string | undefined;
    for (let redirects = 0; redirects <= 15; redirects++) {
      const headers = { ...extraHeaders, ...(referer ? { Referer: referer } : {}) };
      const response = await this.request(flow, url, { method, body, headers });
      this.trace?.('QR_LOGIN_HTTP', `HTTP_${response.status}`, this.routeCategory(url));
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
      const next = new URL(location, url);
      this.validateUrl(next);
      referer = url.toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'; body = undefined; extraHeaders = {};
      }
      url = next;
    }
    throw new Error('LOGIN_TOO_MANY_REDIRECTS');
  }

  private asText(response: HttpResult): string {
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('application/json')) throw new Error('LOGIN_INVALID_RESPONSE');
    return response.body.toString('utf8');
  }

  private json(response: HttpResult, invalidCode = 'LOGIN_INVALID_RESPONSE', httpCode = 'LOGIN_UPSTREAM'): Record<string, unknown> {
    if (response.status !== 200) throw new Error(response.status === 429 ? 'LOGIN_RATE_LIMITED' : `${httpCode}_HTTP_${response.status}`);
    try {
      const value: unknown = JSON.parse(response.body.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch { throw new Error(invalidCode); }
  }

  private async createQr(flow: Flow): Promise<void> {
    const businessLogin = await this.follow(flow, new URL(START_URL));
    if (businessLogin.status !== 200 || businessLogin.url.hostname !== 'account.line.biz') throw new Error('LOGIN_UPSTREAM_REJECTED');
    let form: { action: URL; csrf: string };
    try {
      form = extractLineLoginForm(this.asText(businessLogin), businessLogin.url);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'LOGIN_BUSINESS_ACTION_MISSING') throw error;
      const redirectUri = businessLogin.url.searchParams.get('redirectUri');
      const csrf = flow.jar.value('XSRF-TOKEN', businessLogin.url);
      if (!redirectUri || !csrf) throw error;
      const callback = new URL(redirectUri);
      if (callback.protocol !== 'https:' || callback.hostname !== 'account.line.biz' || !callback.pathname.startsWith('/oauth2/')) throw new Error('LOGIN_REDIRECT_REJECTED');
      const action = new URL('/login/line', businessLogin.url);
      action.search = new URLSearchParams({ type: 'login', redirectUri, disableLineAutoLogin: 'false' }).toString();
      form = { action, csrf };
    }
    const postBody = new URLSearchParams({ _csrf: form.csrf }).toString();
    const lineLogin = await this.follow(flow, form.action, {
      method: 'POST', body: postBody,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://account.line.biz', Referer: businessLogin.url.toString() }
    });
    if (lineLogin.status !== 200 || lineLogin.url.hostname !== 'access.line.me') throw new Error('LOGIN_UPSTREAM_REJECTED');
    const options = extractQrOptions(this.asText(lineLogin), lineLogin.url);
    const loginState = lineLogin.url.searchParams.get('loginState') ?? '';
    const oauthReturnUri = lineLogin.url.searchParams.get('returnUri') ?? '';
    if (!/^[A-Za-z0-9._~-]{8,512}$/.test(loginState) || !oauthReturnUri.startsWith('/oauth2/v2.1/authorize/consent?')) throw new Error('LOGIN_QR_OPTIONS_CHANGED');
    const consentUrl = new URL(oauthReturnUri, ACCESS_ORIGIN);
    if (consentUrl.origin !== ACCESS_ORIGIN || consentUrl.pathname !== '/oauth2/v2.1/authorize/consent') throw new Error('LOGIN_REDIRECT_REJECTED');
    flow.channelId = options.channelId;
    flow.loginState = loginState;
    flow.oauthReturnUri = oauthReturnUri;
    flow.accessReferer = lineLogin.url.toString();
    flow.waitQrPath = options.waitQrPath;
    flow.waitPinPath = options.waitPinPath;
    const params = new URLSearchParams({ _: String(Date.now()), channelId: options.channelId, returnUri: options.returnUri });
    const session = await this.request(flow, new URL(`/qrlogin/v1/session?${params}`, ACCESS_ORIGIN), { headers: { Accept: 'application/json', Referer: lineLogin.url.toString() } });
    const data = this.json(session, 'LOGIN_QR_SESSION_INVALID', 'LOGIN_QR_SESSION');
    if (typeof data.qrCodePath !== 'string' || !/^\/qrlogin\/v1\/qr\/[A-Za-z0-9_-]{16,256}$/.test(data.qrCodePath)) throw new Error('LOGIN_QR_PATH_MISMATCH');
    const qr = await this.request(flow, new URL(data.qrCodePath, ACCESS_ORIGIN), { headers: { Accept: 'image/png,image/*', Referer: lineLogin.url.toString() } });
    if (qr.status !== 200 || !String(qr.headers.get('content-type')).startsWith('image/') || qr.body.length < 100 || qr.body.length > 512 * 1024) throw new Error('LOGIN_INVALID_QR');
    flow.qrImage = qr.body;
    flow.status = 'qr';
    flow.message = '請使用手機 LINE 掃描行動條碼';
  }

  private async monitor(flow: Flow): Promise<void> {
    try {
      this.assertActive(flow);
      const qrData = await this.waitJson(flow, flow.waitQrPath!, 'QR');
      if (qrData.errorCode === 408) throw new Error('LOGIN_QR_EXPIRED');
      const redirect = typeof qrData.redirectPath === 'string' ? qrData.redirectPath : undefined;
      const pin = typeof qrData.pinCode === 'string' ? qrData.pinCode : undefined;
      if (pin) {
        if (!/^\d{4,10}$/.test(pin)) throw new Error('LOGIN_INVALID_RESPONSE');
        flow.status = 'pin';
        flow.pin = pin;
        flow.qrImage = undefined;
        flow.message = '請依手機 LINE 畫面確認登入，並核對此 PIN';
        const pinData = await this.waitJson(flow, flow.waitPinPath!, 'PIN');
        if (pinData.errorCode === 408) throw new Error('LOGIN_PIN_EXPIRED');
        await this.finish(flow, this.qrAuthnUrl(flow).toString());
      } else {
        if (!redirect) throw new Error('LOGIN_INVALID_RESPONSE');
        await this.finish(flow, redirect);
      }
    } catch (error) {
      if (this.flow === flow && !flow.controller.signal.aborted) this.fail(flow, this.safeError(error));
    }
  }

  private async waitJson(flow: Flow, path: string, stage: 'QR' | 'PIN'): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ _: String(Date.now()), channelId: flow.channelId! });
    const response = await this.request(flow, new URL(`${path}?${params}`, ACCESS_ORIGIN), {
      headers: { Accept: 'application/json, text/plain, */*', Referer: flow.accessReferer ?? 'https://access.line.me/' }, timeoutMs: 205_000
    });
    return this.json(response, `LOGIN_${stage}_POLL_INVALID`, `LOGIN_${stage}_POLL`);
  }

  private qrAuthnUrl(flow: Flow): URL {
    const url = new URL('/oauth2/v2.1/qr/authn', ACCESS_ORIGIN);
    const csrf = flow.jar.value('X-SCGW-CSRF-Token', url);
    if (!flow.loginState || !flow.channelId || !flow.oauthReturnUri || !csrf || csrf.length > 1024 || /[\r\n]/.test(csrf)) throw new Error('LOGIN_QR_AUTHN_STATE_MISSING');
    url.search = new URLSearchParams({ loginState: flow.loginState, loginChannelId: flow.channelId, returnUri: flow.oauthReturnUri, __csrf: csrf }).toString();
    return url;
  }

  private collectBotCandidates(flow: Flow, value: string): void {
    for (const match of value.matchAll(/U[0-9a-f]{32}/g)) flow.botCandidates.add(match[0]);
  }

  private oneBotId(value: string): string | undefined {
    const matches = [...new Set(value.match(/U[0-9a-f]{32}/g) ?? [])];
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async finish(flow: Flow, redirectPath: string): Promise<void> {
    flow.status = 'finalizing';
    flow.pin = undefined;
    flow.qrImage = undefined;
    flow.message = 'LINE 已確認，正在建立 OA Session';
    const response = await this.follow(flow, new URL(redirectPath, ACCESS_ORIGIN), { headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      Referer: flow.accessReferer ?? 'https://access.line.me/',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1'
    } });
    await this.complete(flow, response);
  }

  private async complete(flow: Flow, initialResponse: HttpResult): Promise<void> {
    let response = initialResponse;
    while (flow.finishSteps < 12) {
      this.assertActive(flow);
      flow.finishSteps++;
      if (response.status !== 200) throw new Error(`LOGIN_FINALIZE_${this.routeCategory(response.url)}_HTTP_${response.status}`);
      const text = response.body.toString('utf8');
      this.collectBotCandidates(flow, response.url.toString());
      if (response.url.hostname === 'chat.line.biz' && flow.jar.value('__Host-chat-ses', response.url)) {
        this.collectBotCandidates(flow, text);
        break;
      }
      const form = this.hiddenOnlyForm(text, response.url);
      if (!form) {
        this.offerInteraction(flow, response, text);
        return;
      }
      this.collectBotCandidates(flow, text);
      const body = new URLSearchParams(form.fields).toString();
      response = await this.follow(flow, form.action, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: response.url.origin, Referer: response.url.toString() } });
    }
    if (!flow.jar.value('__Host-chat-ses', new URL(START_URL))) throw new Error('LOGIN_SESSION_MISSING');
    if (response.url.hostname !== 'chat.line.biz') response = await this.follow(flow, new URL(START_URL));
    flow.chatReferer = response.url.toString();
    await this.prepareBotSelection(flow, response.url);
  }

  private async prepareBotSelection(flow: Flow, referer: URL): Promise<void> {
    if (flow.selectedBotId) { await this.persist(flow, referer); return; }
    const botsResponse = await this.request(flow, new URL('/api/v1/bots?noFilter=true&limit=1000', START_URL), {
      headers: { Accept: 'application/json', Referer: referer.toString() }
    });
    const data = this.json(botsResponse, 'LOGIN_BOT_LIST_INVALID', 'LOGIN_BOT_LIST');
    if (!Array.isArray(data.list)) throw new Error('LOGIN_BOT_LIST_INVALID');
    const bots = new Map<string, string>();
    for (const value of data.list.slice(0, 1000)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.botId !== 'string' || !/^U[0-9a-f]{32}$/.test(item.botId) || typeof item.name !== 'string') continue;
      const name = item.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
      if (name) bots.set(item.botId, name);
    }
    if (!bots.size) throw new Error('LOGIN_BOT_SELECTION_REQUIRED');
    if (bots.size === 1) {
      const [botId, name] = [...bots][0]!;
      flow.selectedBotId = botId;
      flow.selectedAccountName = name;
      await this.persist(flow, referer);
      return;
    }
    const choices = new Map<string, PendingChoice>();
    for (const [botId, label] of bots) {
      const id = randomBytes(12).toString('base64url');
      choices.set(id, { id, kind: 'bot', label, botId });
    }
    flow.choices = choices;
    flow.status = 'selecting';
    flow.message = '請選擇要使用的 LINE 官方帳號';
    flow.expiresAt = Date.now() + 3 * 60_000;
    this.trace?.('QR_LOGIN_CHOICE', 'WAITING', `OA_OPTIONS_${choices.size}`);
  }

  private async persist(flow: Flow, referer: URL): Promise<void> {
    const botId = flow.selectedBotId;
    if (!botId || !/^U[0-9a-f]{32}$/.test(botId)) throw new Error('LOGIN_BOT_SELECTION_REQUIRED');
    const csrfResponse = await this.request(flow, new URL('/api/v1/csrfToken', START_URL), { headers: { Accept: 'application/json', Origin: 'https://chat.line.biz', Referer: referer.toString() } });
    const csrfData = this.json(csrfResponse, 'LOGIN_CSRF_RESPONSE_INVALID', 'LOGIN_CSRF');
    const csrfToken = typeof csrfData.token === 'string' && csrfData.token && !/[\r\n;]/.test(csrfData.token) ? csrfData.token : undefined;
    if (!csrfToken) throw new Error('LOGIN_CSRF_MISSING');
    const chatUrl = new URL(START_URL);
    const cookies: SessionCredentials['cookies'] = [];
    for (const name of ['ses', '__Host-chat-ses', 'XSRF-TOKEN'] as const) {
      const value = flow.jar.value(name, chatUrl);
      if (value) cookies.push({ name, value });
    }
    const credentials: SessionCredentials = { version: 1, botId, ...(flow.selectedAccountName ? { accountName: flow.selectedAccountName } : {}), csrfToken, cookies, importedAt: new Date().toISOString() };
    this.assertActive(flow);
    await this.sessions.importCredentials(credentials);
    this.assertActive(flow);
    flow.diagnostics = undefined;
    flow.status = 'ok';
    flow.message = 'QR 登入完成，Session 已安全保存';
    flow.terminalAt = Date.now();
    flow.jar.clear();
  }

  private offerInteraction(flow: Flow, response: HttpResult, html: string): void {
    const parsed = extractInteractionChoices(html, response.url);
    if (!parsed.length) throw new Error('LOGIN_INTERACTION_REQUIRED');
    const choices = new Map<string, PendingChoice>();
    for (const item of parsed) {
      this.validateUrl(item.action);
      const id = randomBytes(12).toString('base64url');
      const botId = this.oneBotId(`${item.action.toString()}\n${item.body ?? ''}`);
      choices.set(id, { ...item, id, kind: 'navigation', referer: response.url.toString(), ...(botId ? { botId } : {}) });
    }
    flow.choices = choices;
    this.trace?.('QR_LOGIN_CHOICE', 'WAITING', `OPTIONS_${choices.size}`);
    flow.status = 'selecting';
    flow.message = choices.size > 1 ? '請選擇要使用的 LINE 官方帳號' : 'LINE 需要你確認下一步';
    flow.expiresAt = Date.now() + 3 * 60_000;
  }

  private hiddenOnlyForm(html: string, base: URL): { action: URL; fields: Record<string, string> } | undefined {
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
    for (const form of forms) {
      const attrs = attributes(form[1] ?? '');
      if ((attrs.method ?? 'get').toLowerCase() !== 'post' || !attrs.action) continue;
      const fields: Record<string, string> = {};
      let unsafe = false;
      for (const input of (form[2] ?? '').matchAll(/<input\b[^>]*>/gi)) {
        const item = attributes(input[0]);
        if ((item.type ?? 'text').toLowerCase() !== 'hidden') { unsafe = true; break; }
        if (item.name) fields[item.name] = item.value ?? '';
      }
      if (unsafe || !Object.keys(fields).length || /<(button|textarea|select)\b/i.test(form[2] ?? '')) continue;
      const action = new URL(attrs.action, base);
      this.validateUrl(action);
      return { action, fields };
    }
    return undefined;
  }
}
