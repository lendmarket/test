import { defineConfig } from 'vite';

// 여러 HTML 페이지 빌드 (메인 + 관리자)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
      },
    },
  },
});
