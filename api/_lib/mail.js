// '_'로 시작하는 폴더/파일은 Vercel에서 API 엔드포인트로 노출되지 않습니다.

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const json = (data, status = 200) => Response.json(data, { status });

export function table(rows) {
  return `<table cellpadding="8" style="border-collapse:collapse;font-size:14px">${rows
    .map(([k, v]) => `<tr><th align="left" style="background:#f3f4f6;border:1px solid #e5e7eb;white-space:nowrap">${esc(k)}</th><td style="border:1px solid #e5e7eb">${v}</td></tr>`)
    .join('')}</table>`;
}

/** Resend(https://resend.com) API로 메일 발송 (to 생략 시 NOTIFY_EMAIL로) */
export async function sendMail({ subject, html, replyTo, to: toOverride }) {
  const key = process.env.RESEND_API_KEY;
  const to = toOverride || process.env.NOTIFY_EMAIL;
  if (!key || !to) throw new Error('환경변수 RESEND_API_KEY / NOTIFY_EMAIL 이 설정되지 않았습니다.');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'BizRental <onboarding@resend.dev>',
      to: to.split(',').map(s => s.trim()).filter(Boolean),
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend 오류 ${res.status}: ${await res.text()}`);
}
