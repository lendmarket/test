// 관리자 API
//   GET  /api/admin                         → 로그인 상태 확인
//   POST /api/admin {action:'login', id, password}   → 1단계: 아이디/비밀번호 확인 후 메일로 6자리 인증번호 발송
//   POST /api/admin {action:'verify', code}          → 2단계: 인증번호 확인 후 관리자 세션 발급
//   POST /api/admin {action:'password', current, next} → 비밀번호 변경 (로그인 필요)
//   POST /api/admin {action:'logout'}
import { sendMail, clean } from './_lib/mail.js';
import {
  loadState, saveState, checkPassword, hashPassword,
  newOtpCode, otpHash, newNonce, sign, unsign, safeEqual,
  getCookie, cookie, clearCookie, adminEmail, maskEmail, reply, hasStore,
  SESSION_COOKIE, PENDING_COOKIE, SESSION_TTL, OTP_TTL, OTP_MAX_TRIES, LOGIN_MAX_FAILS, LOCK_TIME,
} from './_lib/admin.js';

/** 유효한 세션이면 state 반환, 아니면 null */
async function currentSession(request) {
  const s = unsign(getCookie(request, SESSION_COOKIE));
  if (!s || s.t !== 'session') return null;
  const state = await loadState();
  // 비밀번호가 바뀌면 기존 세션은 모두 무효
  return s.pv === state.pwVer ? state : null;
}

const sessionCookie = state => cookie(SESSION_COOKIE, sign({ t: 'session', pv: state.pwVer, exp: Date.now() + SESSION_TTL }), SESSION_TTL);

export async function GET(request) {
  try {
    const state = await currentSession(request);
    if (!state) return reply({ ok: false }, 401);
    return reply({ ok: true, id: state.id, email: maskEmail(adminEmail()), isDefault: !state.pwHash, canChangePassword: hasStore() });
  } catch (e) {
    console.error('[admin:get]', e);
    return reply({ error: '서버 오류가 발생했습니다.' }, 500);
  }
}

export async function POST(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return reply({ error: '잘못된 요청입니다.' }, 400);
  let d;
  try { d = await request.json(); } catch { return reply({ error: '잘못된 요청입니다.' }, 400); }

  try {
    switch (d.action) {
      case 'login': return await login(d);
      case 'verify': return await verify(request, d);
      case 'password': return await changePassword(request, d);
      case 'logout': return reply({ ok: true }, 200, [clearCookie(SESSION_COOKIE), clearCookie(PENDING_COOKIE)]);
      default: return reply({ error: '잘못된 요청입니다.' }, 400);
    }
  } catch (e) {
    console.error(`[admin:${d.action}]`, e);
    return reply({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
}

// ── 1단계: 아이디/비밀번호 ──
async function login(d) {
  const id = clean(d.id, 50);
  const password = String(d.password ?? '').slice(0, 200);
  const state = await loadState();
  const now = Date.now();

  if (state.lockUntil > now) {
    const min = Math.ceil((state.lockUntil - now) / 60000);
    return reply({ error: `로그인 시도가 너무 많습니다. ${min}분 후 다시 시도해 주세요.` }, 429);
  }

  if (!safeEqual(id, state.id) || !checkPassword(state, password)) {
    state.fails = (state.fails || 0) + 1;
    if (state.fails >= LOGIN_MAX_FAILS) { state.lockUntil = now + LOCK_TIME; state.fails = 0; }
    await saveState(state);
    return reply({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  const email = adminEmail();
  const code = newOtpCode();
  const nonce = newNonce();
  state.fails = 0;
  state.lockUntil = 0;
  const hash = otpHash(code, nonce);
  state.otp = { nonce, exp: now + OTP_TTL, tries: 0 };
  await saveState(state);

  await sendMail({
    to: email,
    subject: `[BizRental 관리자] 인증번호 ${code}`,
    html: `<div style="font-family:sans-serif;font-size:15px">
      <p>관리자 로그인 인증번호입니다.</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#1f4fd8;margin:16px 0">${code}</p>
      <p style="color:#6b7280">5분 안에 입력해 주세요. 본인이 요청하지 않았다면 즉시 관리자 비밀번호를 변경하세요.</p>
      <p style="color:#6b7280;font-size:12px">요청 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
    </div>`,
  });

  return reply({ ok: true, email: maskEmail(email) }, 200, [
    // 인증번호 해시는 서명된 쿠키에 담음 → 서버리스 인스턴스가 달라도 검증 가능 (해시는 서버 비밀키로만 계산 가능)
    cookie(PENDING_COOKIE, sign({ t: 'pending', n: nonce, h: hash, exp: now + OTP_TTL }), OTP_TTL),
  ]);
}

// ── 2단계: 인증번호 ──
async function verify(request, d) {
  const code = String(d.code ?? '').replace(/\D/g, '');
  const p = unsign(getCookie(request, PENDING_COOKIE));
  const state = await loadState();
  const otp = state.otp;
  const restart = { error: '인증 시간이 만료되었습니다. 처음부터 다시 로그인해 주세요.', restart: true };

  if (!p || p.t !== 'pending' || !p.h) return reply(restart, 401, [clearCookie(PENDING_COOKIE)]);
  const tracked = otp && otp.nonce === p.n; // 저장소에 기록된 인증 요청인지
  // 저장소가 있으면 1회용·시도횟수 제한을 엄격히 적용 (성공/5회 실패 시 otp 삭제됨)
  if (hasStore() && !tracked) return reply(restart, 401, [clearCookie(PENDING_COOKIE)]);

  if (code.length !== 6 || !safeEqual(otpHash(code, p.n), p.h)) {
    if (!tracked) return reply({ error: '인증번호가 올바르지 않습니다.' }, 401);
    otp.tries += 1;
    if (otp.tries >= OTP_MAX_TRIES) {
      state.otp = null;
      await saveState(state);
      return reply({ error: '인증번호를 5회 잘못 입력했습니다. 처음부터 다시 로그인해 주세요.', restart: true }, 401, [clearCookie(PENDING_COOKIE)]);
    }
    await saveState(state);
    return reply({ error: `인증번호가 올바르지 않습니다. (남은 횟수 ${OTP_MAX_TRIES - otp.tries}회)` }, 401);
  }

  state.otp = null;
  await saveState(state);
  return reply({ ok: true }, 200, [sessionCookie(state), clearCookie(PENDING_COOKIE)]);
}

// ── 비밀번호 변경 ──
async function changePassword(request, d) {
  const state = await currentSession(request);
  if (!state) return reply({ error: '로그인이 필요합니다.', restart: true }, 401);
  if (!hasStore()) return reply({ error: '비밀번호를 저장할 Blob 저장소가 연결되지 않아 변경할 수 없습니다. Vercel에서 Blob을 연결한 뒤 이용해 주세요.' }, 400);

  const current = String(d.current ?? '');
  const next = String(d.next ?? '');
  if (!checkPassword(state, current)) return reply({ error: '현재 비밀번호가 올바르지 않습니다.' }, 400);
  if (next.length < 8 || next.length > 100) return reply({ error: '새 비밀번호는 8자 이상 100자 이하로 입력해 주세요.' }, 400);
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return reply({ error: '새 비밀번호에 영문과 숫자를 모두 포함해 주세요.' }, 400);
  if (next === current) return reply({ error: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.' }, 400);

  state.pwHash = hashPassword(next);
  state.pwVer = (state.pwVer || 0) + 1;
  await saveState(state);

  try {
    await sendMail({
      to: adminEmail(),
      subject: '[BizRental 관리자] 비밀번호가 변경되었습니다',
      html: `<p>관리자 비밀번호가 변경되었습니다. (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})</p><p>본인이 변경하지 않았다면 즉시 확인해 주세요.</p>`,
    });
  } catch (e) { console.error('[admin:password-mail]', e); } // 알림 실패는 변경 결과에 영향 없음

  // 현재 브라우저만 새 세션으로 유지, 다른 기기 세션은 무효화
  return reply({ ok: true }, 200, [sessionCookie(state)]);
}
