import { sendMail, esc, clean, json, table } from './_lib/mail.js';

const REQUIRED = {
  corp: ['bizReg', 'corpReg', 'seal', 'idCard'],
  indiv: ['bizReg', 'idCard', 'seal'],
};

const isBlobUrl = u => {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && hostname.endsWith('.blob.vercel-storage.com');
  } catch { return false; }
};

export async function POST(request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }

  const f = {
    company: clean(d.company),
    quote: clean(d.quote, 50),
    name: clean(d.name, 50),
    phone: clean(d.phone, 20),
    type: d.type === 'indiv' ? 'indiv' : 'corp',
  };
  const files = (Array.isArray(d.files) ? d.files : [])
    .slice(0, 10)
    .map(x => ({ key: clean(x.key, 30), title: clean(x.title, 60), name: clean(x.name, 150), size: Number(x.size) || 0, url: String(x.url || '') }))
    .filter(x => isBlobUrl(x.url));

  if (!f.company || !f.name || !f.phone) return json({ error: '필수 항목이 누락되었습니다.' }, 400);
  if (d.agree !== true) return json({ error: '서류 이용에 동의해 주세요.' }, 400);
  const keys = new Set(files.map(x => x.key));
  const missing = REQUIRED[f.type].filter(k => !keys.has(k));
  if (missing.length) return json({ error: `필수 서류가 누락되었습니다. (${missing.length}건)` }, 400);

  const fileRows = files
    .map(x => `<li>${esc(x.title)} — <a href="${esc(x.url)}">${esc(x.name)}</a> (${(x.size / 1024 / 1024).toFixed(2)}MB)</li>`)
    .join('');

  try {
    await sendMail({
      subject: `[서류접수] ${f.company} - ${f.name}`,
      html: `<h2>계약 서류가 접수되었습니다</h2>${table([
        ['회사명', esc(f.company)],
        ['견적번호', esc(f.quote) || '-'],
        ['사업자 유형', f.type === 'corp' ? '법인사업자' : '개인사업자'],
        ['담당자', esc(f.name)],
        ['연락처', esc(f.phone)],
        ['접수 시각', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
      ])}<h3>제출 서류 (${files.length}건)</h3><ul>${fileRows}</ul>
      <p style="color:#6b7280;font-size:12px">※ 심사 완료 후 Vercel 대시보드 &gt; Storage &gt; Blob 에서 파일을 삭제해 주세요.</p>`,
    });
  } catch (e) {
    console.error('[documents]', e, f, files);
    return json({ error: '접수 처리 중 오류가 발생했습니다.' }, 500);
  }

  return json({ ok: true });
}
