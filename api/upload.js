import { handleUpload } from '@vercel/blob/client';

// 브라우저가 Vercel Blob에 직접 업로드할 수 있도록 일회용 토큰을 발급합니다.
// (서버리스 함수 요청 본문 4.5MB 제한을 피하기 위한 방식)
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async pathname => {
        if (!/^documents\/\d{4}-\d{2}-\d{2}\/[a-zA-Z]+\.(pdf|jpg|png)$/.test(pathname)) {
          throw new Error('허용되지 않은 파일 경로입니다.');
        }
        return {
          allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true, // 추측 불가능한 URL 생성
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[upload] 완료:', blob.pathname);
      },
    });
    return Response.json(result);
  } catch (e) {
    console.error('[upload]', e);
    return Response.json({ error: e.message }, { status: 400 });
  }
}
