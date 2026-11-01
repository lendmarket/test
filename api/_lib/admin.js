// 관리자 인증 공통 로직 (엔드포인트 아님)
// - 관리자 정보(아이디, 비밀번호 해시, 인증번호 상태)는 Vercel Blob에 AES-256-GCM으로 암호화해 저장합니다.
// - 세션은 서버 비밀키로 서명한 HttpOnly 쿠키입니다.
import crypto from 'node:crypto';
import { list, put, del } from '@vercel/blob';

const STATE_PREFIX = 'admin/state';
export const DEFAULT_ID = 'admin';
const DEFAULT_PASSWORD = '1234';

export const SESSION_COOKIE = 'admin_session';
export const PENDING_COOKIE = 'admin_pending';
export const SESSION_TTL = 8 * 60 * 60 * 1000; // 8시간
export const OTP_TTL = 5 * 60 * 1000; // 5분
export const OTP_MAX_TRIES = 5;
export const LOGIN_MAX_FAILS = 5;
export const LOCK_TIME = 10 * 60 * 1000; // 10분

// ───────── 비밀키 ─────────
function baseSecret() {
  const s = process.env.ADMIN_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!s) throw new Error('ADMIN_SECRET 또는 BLOB_READ_WRITE_TOKEN 환경변수가 필요합니다.');
  return s;
}
const subKey = purpose => crypto.createHash('sha256').update(`bizrental-admin:${purpose}:${baseSecret()}`).digest();
const hmac = (purpose, data) => crypto.createHmac('sha256', subKey(purpose)).update(data).digest('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ───────── 상태 저장소 (암호화된 Blob) ─────────
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subKey('enc'), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(text) {
  const { iv, tag, data } = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', subKey('enc'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}

async function stateBlobs() {
  const { blobs } = await list({ prefix: STATE_PREFIX });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function loadState() {
  const [latest] = await stateBlobs();
  if (!latest) return { id: DEFAULT_ID, pwHash: null, pwVer: 0, fails: 0, lockUntil: 0, otp: null };
  const res = await fetch(latest.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`관리자 정보 읽기 실패 (${res.status})`);
  // 복호화 실패 시 기본값으로 되돌리지 않고 오류를 냅니다(기본 비밀번호로 초기화되는 것 방지).
  return decrypt(await res.text());
}

export async function saveState(state) {
  const old = await stateBlobs();
  // 매번 새 URL로 저장 → CDN 캐시 문제 없음. 이후 이전 버전 삭제.
  await put(`${STATE_PREFIX}.json`, encrypt(state), {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'application/json',
  });
  if (old.length) await del(old.map(b => b.url));
}

// ───────── 비밀번호 ─────────
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function checkPassword(state, pw) {
  pw = String(pw ?? '');
  if (!state.pwHash) return safeEqual(pw, DEFAULT_PASSWORD);
  const [, salt, hash] = state.pwHash.split('$');
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'base64'));
}

// ───────── 인증번호 ─────────
export const newOtpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const otpHash = (code, nonce) => hmac('otp', `${nonce}:${code}`);
export const newNonce = () => crypto.randomBytes(16).toString('base64url');

// ───────── 서명 토큰 / 쿠키 ─────────
export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac('sig', body)}`;
}
export function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!safeEqual(sig, hmac('sig', body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export const cookie = (name, value, maxAgeMs) =>
  `${name}=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
export const clearCookie = name => `${name}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// ───────── 기타 ─────────
export function adminEmail() {
  const e = (process.env.ADMIN_EMAIL || process.env.NOTIFY_EMAIL || '').split(',')[0].trim();
  if (!e) throw new Error('환경변수 ADMIN_EMAIL(또는 NOTIFY_EMAIL)이 설정되지 않았습니다.');
  return e;
}
export function maskEmail(e) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

export function reply(data, status = 200, cookies = []) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  cookies.forEach(c => h.append('Set-Cookie', c));
  return new Response(JSON.stringify(data), { status, headers: h });
}
