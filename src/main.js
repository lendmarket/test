import { upload } from '@vercel/blob/client';
import './style.css';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

const DOCS = {
  corp: [
    { key: 'bizReg', title: '사업자등록증 사본', hint: '최근 발급분', required: true },
    { key: 'corpReg', title: '법인 등기사항전부증명서', hint: '발급일 3개월 이내', required: true },
    { key: 'seal', title: '법인 인감증명서', hint: '발급일 3개월 이내', required: true },
    { key: 'idCard', title: '대표자 신분증 사본', hint: '주민등록번호 뒷자리 가림 처리', required: true },
    { key: 'finance', title: '재무제표', hint: '최근 1년 (신설법인은 생략 가능)', required: false },
  ],
  indiv: [
    { key: 'bizReg', title: '사업자등록증 사본', hint: '최근 발급분', required: true },
    { key: 'idCard', title: '대표자 신분증 사본', hint: '주민등록번호 뒷자리 가림 처리', required: true },
    { key: 'seal', title: '대표자 인감증명서', hint: '발급일 3개월 이내', required: true },
    { key: 'income', title: '소득금액증명원 또는 부가세과세표준증명', hint: '최근 1년', required: false },
  ],
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ===== 헤더 / 모바일 메뉴 ===== */
const header = $('#header');
window.addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 10));
$('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
$$('#nav a').forEach(a => a.addEventListener('click', () => $('#nav').classList.remove('open')));

/* ===== 입력 자동 포맷 ===== */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-phone]')) {
    const d = t.value.replace(/\D/g, '').slice(0, 11);
    t.value = d.startsWith('02')
      ? d.replace(/^(02)(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'))
      : d.replace(/^(\d{0,3})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'));
  }
  if (t.matches('[data-bizno]')) {
    const d = t.value.replace(/\D/g, '').slice(0, 10);
    t.value = d.replace(/^(\d{0,3})(\d{0,2})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'));
  }
  if (t.classList.contains('invalid')) t.classList.remove('invalid');
});

/* ===== 공통 ===== */
function showModal(title, msg) {
  $('#modalTitle').textContent = title;
  $('#modalMsg').textContent = msg;
  $('#modal').hidden = false;
}
$('#modalClose').addEventListener('click', () => ($('#modal').hidden = true));
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') e.target.hidden = true; });

function validateRequired(form) {
  let ok = true;
  $$('[required]', form).forEach(el => {
    const bad = el.type === 'checkbox' ? !el.checked
      : el.type === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim())
      : !el.value.trim();
    el.classList.toggle('invalid', bad);
    if (bad) ok = false;
  });
  return ok;
}

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '전송 실패');
  return body;
}

/* ===== 상담 문의 ===== */
const contactForm = $('#contactForm');
contactForm.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#contactError');
  err.textContent = '';
  const okFields = validateRequired(contactForm);
  const items = $$('input[name=items]:checked', contactForm).map(i => i.value);
  if (!okFields) return (err.textContent = '필수 항목(*)을 올바르게 입력해 주세요.');
  if (!items.length) return (err.textContent = '관심 품목을 하나 이상 선택해 주세요.');

  const btn = $('button[type=submit]', contactForm);
  btn.disabled = true; btn.textContent = '전송 중...';
  try {
    const data = Object.fromEntries(new FormData(contactForm));
    data.items = items;
    data.agree = true;
    await postJSON('/api/contact', data);
    showModal('상담 신청 완료', `${data.name}님, 문의가 접수되었습니다.\n영업일 기준 24시간 이내에 연락드리겠습니다.`);
    contactForm.reset();
  } catch (ex) {
    err.textContent = `${ex.message} 잠시 후 다시 시도하거나 고객센터(1588-0000)로 연락해 주세요.`;
  } finally {
    btn.disabled = false; btn.textContent = '상담 신청하기';
  }
});

/* ===== 서류 접수 ===== */
const docForm = $('#docForm');
const docList = $('#docList');
const files = {}; // key -> File

function renderDocs() {
  const type = $('#bizType').value;
  Object.keys(files).forEach(k => delete files[k]);
  docList.innerHTML = '';
  DOCS[type].forEach(d => {
    const box = document.createElement('div');
    box.className = 'doc';
    box.dataset.key = d.key;
    box.dataset.title = d.title;
    box.dataset.required = d.required;
    box.innerHTML = `
      <div class="doc__title">${d.title}${d.required ? ' <em>*</em>' : '<small>(선택)</small>'}</div>
      <div class="doc__hint">${d.hint} · 파일을 끌어다 놓거나 선택하세요</div>
      <button type="button" class="doc__btn">파일 선택</button>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" />
      <div class="doc__file" hidden></div>`;
    const input = $('input', box);
    $('.doc__btn', box).addEventListener('click', () => input.click());
    input.addEventListener('change', () => input.files[0] && setFile(box, input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove('drag'); }));
    box.addEventListener('drop', e => e.dataTransfer.files[0] && setFile(box, e.dataTransfer.files[0]));
    docList.appendChild(box);
  });
}

function setFile(box, file) {
  const err = $('#docError');
  err.textContent = '';
  if (!ALLOWED.includes(file.type)) return (err.textContent = `"${file.name}" — PDF, JPG, PNG 파일만 업로드할 수 있습니다.`);
  if (file.size > MAX_SIZE) return (err.textContent = `"${file.name}" — 파일 크기는 10MB 이하여야 합니다.`);
  files[box.dataset.key] = file;
  box.classList.add('done');
  box.classList.remove('invalid');
  const info = $('.doc__file', box);
  info.hidden = false;
  info.innerHTML = `✔ <span></span> (${(file.size / 1024 / 1024).toFixed(2)}MB) <button type="button">삭제</button>`;
  $('span', info).textContent = file.name;
  $('button', info).addEventListener('click', () => {
    delete files[box.dataset.key];
    box.classList.remove('done');
    info.hidden = true;
    $('input', box).value = '';
  });
}

$('#bizType').addEventListener('change', renderDocs);
renderDocs();

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

docForm.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#docError');
  err.textContent = '';
  const okFields = validateRequired(docForm);
  const boxes = $$('.doc', docList);
  const missing = boxes.filter(b => b.dataset.required === 'true' && !files[b.dataset.key]);
  missing.forEach(b => b.classList.add('invalid'));
  if (!okFields) return (err.textContent = '필수 항목(*)을 입력하고 동의에 체크해 주세요.');
  if (missing.length) return (err.textContent = `필수 서류 ${missing.length}건이 누락되었습니다.`);

  const btn = $('button[type=submit]', docForm);
  btn.disabled = true;
  try {
    // 1) 파일을 Vercel Blob에 직접 업로드 (서버 함수 용량 제한 우회)
    const date = new Date().toISOString().slice(0, 10);
    const targets = boxes.filter(b => files[b.dataset.key]);
    const uploaded = [];
    for (const [i, b] of targets.entries()) {
      const file = files[b.dataset.key];
      btn.textContent = `업로드 중... (${i + 1}/${targets.length})`;
      const blob = await upload(`documents/${date}/${b.dataset.key}.${EXT[file.type]}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        contentType: file.type,
      });
      uploaded.push({ key: b.dataset.key, title: b.dataset.title, name: file.name, size: file.size, url: blob.url });
    }

    // 2) 접수 정보 + 파일 링크를 서버로 전송
    btn.textContent = '접수 중...';
    const data = Object.fromEntries(new FormData(docForm));
    await postJSON('/api/documents', { ...data, agree: true, files: uploaded });

    showModal('서류 접수 완료', `총 ${uploaded.length}건의 서류가 접수되었습니다.\n심사 결과는 1~2 영업일 내에 안내드립니다.`);
    docForm.reset();
    renderDocs();
  } catch (ex) {
    console.error(ex);
    err.textContent = `업로드 중 오류가 발생했습니다. (${ex.message}) 잠시 후 다시 시도해 주세요.`;
  } finally {
    btn.disabled = false; btn.textContent = '서류 제출하기';
  }
});
