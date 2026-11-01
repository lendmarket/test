# BizRental — 기업렌탈 소개 · 상담문의 · 서류접수 사이트

Vercel 배포용 프로젝트입니다. (Vite 정적 사이트 + Vercel Serverless Functions)

## 구조

```
├─ index.html          # 메인 페이지
├─ src/
│  ├─ main.js          # 폼 처리, 파일 업로드
│  └─ style.css
├─ api/                # Vercel 서버리스 함수
│  ├─ contact.js       # POST /api/contact   상담 문의 → 메일 발송
│  ├─ upload.js        # POST /api/upload    Blob 업로드 토큰 발급
│  ├─ documents.js     # POST /api/documents 서류 접수 → 메일 발송(파일 링크 포함)
│  ├─ admin.js         # GET/POST /api/admin 관리자 로그인·메일인증·비밀번호 변경
│  └─ _lib/            # 공통 유틸 mail.js, admin.js (엔드포인트 아님)
├─ admin.html          # 관리자 페이지 (/admin)  — src/admin.js, src/admin.css
├─ package.json
└─ .env.example
```

## 동작 방식

- **상담 문의**: 폼 → `/api/contact` → 관리자에게 이메일(Resend)
- **서류 접수**: 브라우저가 파일을 **Vercel Blob**에 직접 업로드 → `/api/documents`로 접수 정보와 파일 링크 전송 → 관리자에게 이메일
  - 서버리스 함수의 요청 크기 제한(4.5MB)을 피하려고 직접 업로드 방식을 사용합니다.

## 배포 방법

1. **GitHub에 올리기**: 이 폴더를 새 GitHub 저장소에 push
2. **Vercel에서 Import**: [vercel.com/new](https://vercel.com/new) → 저장소 선택 → Framework는 자동으로 *Vite*로 잡힘 → Deploy
3. **Blob 저장소 연결**: 프로젝트 → **Storage** → **Create** → **Blob** → 프로젝트에 연결
   (`BLOB_READ_WRITE_TOKEN` 환경변수가 자동 추가됨)
4. **메일 설정**
   - [resend.com](https://resend.com) 가입 → API Key 발급
   - Vercel 프로젝트 → **Settings → Environment Variables** 에 추가
     - `RESEND_API_KEY` = 발급받은 키
     - `NOTIFY_EMAIL` = 알림 받을 이메일
     - `FROM_EMAIL` = (선택) 도메인 인증 후 보내는 주소
5. **Redeploy** (환경변수는 재배포 후 적용됩니다)

> ⚠️ `FROM_EMAIL` 없이 기본 발신 주소(`onboarding@resend.dev`)를 쓰면 **Resend 가입 이메일로만** 메일이 발송됩니다. 다른 주소로 받으려면 Resend에서 도메인을 인증하세요.

## 관리자 페이지 (`/admin`)

- 초기 계정: 아이디 `admin` / 비밀번호 `123456` → **첫 로그인 후 바로 변경하세요.**
- 로그인 절차: 아이디·비밀번호 확인 → `ADMIN_EMAIL`(없으면 `NOTIFY_EMAIL` 첫 주소)로 **6자리 인증번호** 발송 → 5분 안에 입력하면 관리자 인증
- 관리자 페이지에서 비밀번호 변경 가능 (8자 이상, 영문+숫자). 변경 시 다른 기기 로그인은 해제되고 알림 메일 발송
- 보안 장치: 비밀번호 5회 오류 시 10분 잠금 / 인증번호 5회 오류 시 무효 / 세션 8시간 / HttpOnly 쿠키
- 관리자 정보는 Vercel Blob의 `admin/` 경로에 **암호화**되어 저장됩니다.
- **비밀번호를 잊었을 때**: Vercel 대시보드 → Storage → Blob 에서 `admin/state...` 파일을 삭제하면 `admin` / `123456`로 초기화됩니다.

## 로컬 실행

```bash
npm install
npm i -g vercel
vercel link        # Vercel 프로젝트와 연결
vercel env pull    # 환경변수 내려받기 (.env.local)
npm run dev        # http://localhost:3000
```

## 보안 참고

- 업로드된 파일 URL은 무작위 문자열이 붙어 추측할 수 없지만, **링크를 아는 사람은 열람 가능**합니다. 알림 메일을 외부로 전달하지 말고, 심사가 끝나면 Vercel 대시보드 → Storage → Blob 에서 파일을 삭제하세요.
- 회사 정보(상호, 대표자, 사업자번호, 연락처)는 `index.html` 하단에서 실제 정보로 바꾸세요.
