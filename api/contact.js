import { sendMail, esc, clean, isEmail, json, table } from './_lib/mail.js';

export async function POST(request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }

  // 스팸봇 차단(숨김 필드에 값이 있으면 조용히 무시)
  if (d.website) return json({ ok: true });

  const f = {
    company: clean(d.company),
    bizno: clean(d.bizno, 20),
    name: clean(d.name, 50),
    phone: clean(d.phone, 20),
    email: clean(d.email, 100),
    period: clean(d.period, 50),
    items: Array.isArray(d.items) ? d.items.map(i => clean(i, 20)).slice(0, 10) : [],
    message: clean(d.message, 3000),
  };

  if (!f.company || !f.name || !f.phone || !f.email) return json({ error: '필수 항목이 누락되었습니다.' }, 400);
  if (!isEmail(f.email)) return json({ error: '이메일 형식이 올바르지 않습니다.' }, 400);
  if (!f.items.length) return json({ error: '관심 품목을 선택해 주세요.' }, 400);
  if (d.agree !== true) return json({ error: '개인정보 수집에 동의해 주세요.' }, 400);

  try {
    await sendMail({
      subject: `[상담문의] ${f.company} - ${f.name}`,
      replyTo: f.email,
      html: `<h2>새 상담 문의가 접수되었습니다</h2>${table([
        ['회사명', esc(f.company)],
        ['사업자번호', esc(f.bizno) || '-'],
        ['담당자', esc(f.name)],
        ['연락처', esc(f.phone)],
        ['이메일', esc(f.email)],
        ['렌탈 기간', esc(f.period) || '-'],
        ['관심 품목', esc(f.items.join(', '))],
        ['문의 내용', esc(f.message).replace(/\n/g, '<br>') || '-'],
        ['접수 시각', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
      ])}`,
    });
  } catch (e) {
    console.error('[contact]', e, f);
    return json({ error: '접수 처리 중 오류가 발생했습니다.' }, 500);
  }

  return json({ ok: true });
}
