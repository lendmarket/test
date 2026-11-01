// 관리자 API
//   GET  /api/admin                                   → 로그인 상태 확인
//   POST /api/admin {action:'login', id, password}    → 아이디/비밀번호 확인 후 관리자 세션 발급
//   POST /api/admin {action:'password', current, next} → 비밀번호 변경 (로그인 필요, Blob 저장소 필요)
//   POST /api/admin {action:'logout'}
import { sendMail, clean } from './_lib/mail.js';
import {
  loadState, saveState, checkPassword, hashPassword, sign, unsign, safeEqual,
  getCookie, cookie, clearCookie, adminEmail, reply, hasStore,
  SESSION_COOKIE, SESSION_TTL, LOGIN_MAX_FAILS, LOCK_TIME,
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
    return reply({ ok: true, id: state.id, isDefault: !state.pwHash, canChangePassword: hasStore() });
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
      case 'password': return await changePassword(request, d);
      case 'logout': return reply({ ok: true }, 200, [clearCookie(SESSION_COOKIE)]);
      default: return reply({ error: '잘못된 요청입니다.' }, 400);
    }
  } catch (e) {
    console.error(`[admin:${d.action}]`, e);
    return reply({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
}

// ── 로그인 ──
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

  if (state.fails || state.lockUntil) {
    state.fails = 0;
    state.lockUntil = 0;
    await saveState(state);
  }
  return reply({ ok: true }, 200, [sessionCookie(state)]);
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

  // 메일 설정이 되어 있으면 변경 알림 (없거나 실패해도 변경은 완료)
  try {
    await sendMail({
      to: adminEmail(),
      subject: '[BizRental 관리자] 비밀번호가 변경되었습니다',
      html: `<p>관리자 비밀번호가 변경되었습니다. (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})</p><p>본인이 변경하지 않았다면 즉시 확인해 주세요.</p>`,
    });
  } catch (e) { console.error('[admin:password-mail]', e); }

  // 현재 브라우저만 새 세션으로 유지, 다른 기기 세션은 무효화
  return reply({ ok: true }, 200, [sessionCookie(state)]);
}
