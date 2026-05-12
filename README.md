# NaverPlace Crawler (Electron 데스크톱 앱)

네이버 플레이스를 **검색어 + 지역(시/구/동)** 단위로 크롤링하여 Supabase에 저장하는 데스크톱 앱입니다.
**macOS / Windows / Linux** 모두 지원합니다.

## 핵심 기능

- **로그인 기반 접근 제어** — 앱 진입 시 Supabase Auth(이메일/비밀번호) 로그인 필요. 세션은 OS 보안 저장소에 암호화되어 자동 복원됨
- **눈으로 보이는 크롤링** — "시작"을 누르면 Playwright Chromium 창이 별도로 떠서 실제 페이지를 탐색하는 과정을 그대로 볼 수 있음
- **다중 세션 동시 실행** — 검색조건이 다른 작업을 여러 개 동시에 돌릴 수 있고, 상단 "활동로그" 탭의 뱃지로 활성 세션 수가 표시됨
- **재시작 시 이어하기** — 진행 상황을 검색조건별로 저장 → 중지 후 동일 조건으로 다시 시작하면 "이어하기" 토글이 자동 표시됨
- **자격증명 안전 저장** — Supabase URL/anon key/(선택) service role key/테이블명은 Electron `safeStorage`로 암호화 저장 (macOS Keychain / Windows DPAPI / Linux libsecret). 평문 .env 파일 없음
- **테이블 자동 감지/생성** — 지정한 테이블이 없으면 감지 → Supabase 프로젝트에 `exec_sql(sql text)` RPC가 정의되어 있고 Service Role Key가 입력돼 있으면 자동 생성, 없으면 SQL 스니펫을 화면에 표시
- **수면 방지** — 크롤링 중 `powerSaveBlocker`로 디스플레이가 잠들지 않음

## 화면 구성

로그인 후 상단에 세 개의 탭이 나타납니다.

| 탭           | 설명                                              |
| ------------ | ------------------------------------------------- |
| **크롤링**   | 검색어/지역 폼 입력 → 시작/중지                   |
| **활동로그** | 실행 중인 모든 세션 목록과 진행률, 최근 로그 확인 |
| **환경설정** | Supabase 자격증명, 저장 테이블명 관리             |

## 개발 실행

```bash
pnpm install         # 또는 npm install
pnpm dev             # Electron + Vite HMR
```

처음 설치 시 `postinstall` 훅으로 Playwright Chromium(~150MB)이 자동 다운로드됩니다.

## 빌드 (배포용)

```bash
pnpm dist:mac        # → dist/*.dmg, dist/*.zip (arm64 + x64)
pnpm dist:win        # → dist/*.exe (nsis + portable, x64)
pnpm dist:linux      # → dist/*.AppImage, dist/*.deb (x64)
```

배포 빌드에는 Playwright 브라우저가 `extraResources`로 함께 패키징됩니다.

## Supabase 준비

### 1) 인증 백엔드

앱 사용자는 미리 발급된 Supabase Auth 계정으로 로그인합니다. 신규 사용자는 관리자가 Supabase 대시보드에서 추가해야 합니다.

### 2) 크롤링 결과 저장 테이블

환경설정에서 입력한 테이블이 없을 때 앱이 표시하는 SQL을 그대로 Supabase SQL Editor에 붙여넣어 실행하세요.

```sql
CREATE TABLE IF NOT EXISTS public.<your_table_name> (
  id bigserial PRIMARY KEY,
  shop_name text,
  place_id text UNIQUE,
  phone text,
  address text,
  business_hours text,
  links text,
  district text,
  dong text,
  city text,
  image text,
  category_main text,
  category_sub text,
  main_menu text,
  tags text,
  naver_place_url text,
  naver_search text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.<your_table_name> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "<your_table_name>_anon_all" ON public.<your_table_name>
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

### 3) (선택) 자동 테이블 생성용 RPC

앱에서 Service Role Key를 입력하면 테이블을 자동 생성할 수 있는데, 이를 위해 Supabase 프로젝트에 아래 RPC를 한 번 정의해 두어야 합니다.

```sql
CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE sql;
END;
$$;
```

> RPC를 정의하지 않은 경우 자동 생성은 실패하고, 앱은 위 CREATE TABLE 스니펫을 안내합니다.

## 트러블슈팅

### macOS — "확인되지 않은 개발자" 차단

미서명 빌드라 처음 실행할 때 Gatekeeper가 차단합니다.

```bash
xattr -cr "/Applications/NaverPlace Crawler.app"
```

또는 우클릭 → 열기 → 확인.

### Windows — SmartScreen 차단

"추가 정보" → "실행", 또는 우클릭 → 속성 → "차단 해제".

### Linux — AppImage 실행 권한

```bash
chmod +x "NaverPlace Crawler-*.AppImage"
./NaverPlace*.AppImage
```

libsecret이 설치되지 않은 환경에서는 자격증명이 평문으로 저장됩니다. (앱이 환경설정 페이지에서 경고 표시)

### "이어하기" 토글이 안 보일 때

이전 진행 상황이 검색어/도시/구/동 조합으로 키가 매겨지므로, 폼의 어느 한 값이라도 다르면 새로운 세션으로 인식됩니다. 정확히 동일한 조건으로 다시 입력해야 토글이 나타납니다.

## 파일/디렉토리 위치

진행 상황(`progress.json`)·자격증명(`secrets.json`)·세션(`session.json`)은 모두 OS별 userData 디렉토리에 저장됩니다.

| OS      | 경로                                         |
| ------- | -------------------------------------------- |
| macOS   | `~/Library/Application Support/crawler-app/` |
| Windows | `%APPDATA%\crawler-app\`                     |
| Linux   | `~/.config/crawler-app/`                     |

## 스택

- **셸**: Electron 32 + electron-vite + electron-builder
- **UI**: React 18 + React Router 6 + Tailwind CSS 3
- **크롤러**: Playwright 1.46 (headful Chromium)
- **데이터/인증**: @supabase/supabase-js 2
- **유틸**: pino (로깅), zod (IPC 페이로드 검증), ws (Auth realtime transport)

## 디렉토리 구조

```
src/
├── main/                  Electron main 프로세스
│   ├── index.ts           앱 진입점 (윈도우/생명주기/IPC 등록)
│   ├── auth.ts            Supabase Auth 로그인/세션 복원
│   ├── secrets.ts         safeStorage 기반 자격증명 암호화 저장
│   ├── ipc/               렌더러 ↔ 메인 IPC 채널
│   ├── crawler/           Playwright 크롤러 본체 (검색/리스트/상세/추출)
│   └── storage/           Supabase 클라이언트·스키마·진행상황 repo
├── preload/index.ts       contextBridge로 화이트리스트된 채널만 노출
└── renderer/              React UI
    ├── App.tsx            로그인 가드 + 라우터
    └── pages/             로그인·시작·진행상황·활동로그·환경설정
```
