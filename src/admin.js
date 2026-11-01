import './style.css';
import './admin.css';

const $ = s => document.querySelector(s);
const views = ['#loading', '#loginForm', '#dashboard'];

function show(sel) {
  views.forEach(v => { $(v).hidden = v !== sel; });
  $('#logoutBtn').hidden = sel !== '#dashboard';
  const first = $(sel).querySelector('input');
  if (first) first.focus();
}

async function api(body) {
  const res = await fetch('/api/admin', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, ...data };
}

function setMsg(form, err = '', ok = '') {
  form.querySelector('.form__error').textContent = err;
  const okEl = form.querySelector('.form__ok');
  if (okEl) okEl.textContent = ok;
}

async function busy(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try { await fn(); } catch { setMsg(form, '네트워크 오류가 발생했습니다. 다시 시도해 주세요.'); } finally { btn.disabled = false; }
}

// ── 로그인 상태 확인 ──
async function loadDashboard() {
  const r = await api();
  if (!r.ok) return show('#loginForm');
  $('#infoId').textContent = r.id;
  $('#defaultWarn').hidden = !r.isDefault;
  setMsg($('#pwForm'), r.canChangePassword ? '' : '※ Vercel에 Blob 저장소가 연결되지 않아 지금은 비밀번호를 변경할 수 없습니다. (로그인은 기본 비밀번호로 가능)');
  show('#dashboard');
}

// ── 로그인 ──
$('#loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.namedItem('id').value.trim(); // f.id는 form의 id 속성이므로 elements로 접근
  const password = f.elements.namedItem('password').value;
  if (!id || !password) return setMsg(f, '아이디와 비밀번호를 입력해 주세요.');
  setMsg(f);
  busy(f, async () => {
    const r = await api({ action: 'login', id, password });
    if (!r.ok) return setMsg(f, r.error || '로그인에 실패했습니다.');
    f.elements.namedItem('password').value = '';
    await loadDashboard();
  });
});

// ── 비밀번호 변경 ──
$('#pwForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.currentTarget;
  const current = f.current.value;
  const next = f.next.value;
  setMsg(f);
  if (!current || !next) return setMsg(f, '모든 항목을 입력해 주세요.');
  if (next !== f.confirm.value) return setMsg(f, '새 비밀번호가 서로 일치하지 않습니다.');
  if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) return setMsg(f, '새 비밀번호는 8자 이상, 영문과 숫자를 모두 포함해야 합니다.');
  busy(f, async () => {
    const r = await api({ action: 'password', current, next });
    if (!r.ok) {
      if (r.restart) return show('#loginForm');
      return setMsg(f, r.error || '변경에 실패했습니다.');
    }
    f.reset();
    $('#defaultWarn').hidden = true;
    setMsg(f, '', '비밀번호가 변경되었습니다.');
  });
});

// ── 로그아웃 ──
$('#logoutBtn').addEventListener('click', async () => {
  await api({ action: 'logout' }).catch(() => {});
  $('#loginForm').reset();
  show('#loginForm');
});

loadDashboard().catch(() => show('#loginForm'));
