# CLAUDE.md — 네이버 플레이스 크롤러 (crawler-app)

## 무엇을 하는 앱인가

네이버 플레이스에서 **업종별 매장 정보**(빨래방/헤어/네일/속눈썹/왁싱/피부/타투 등)를 크롤링한다.

- **Electron 데스크톱 앱** (`src/main`, `src/renderer`, `src/preload`) — **현재 주 운영 방식**(사무실 노트북).
- **서버 버전** (`server/`) — Express + 웹 대시보드(`web/`). Railway 배포 가능하나 차단 위험으로 **비권장**.

> ⚠️ `server/`와 `src/main/`에 크롤러 코드(`crawler/**`)가 **거의 동일하게 중복**되어 있다. 한쪽을 고치면 **반드시 양쪽을 동기화**할 것. (대부분 파일은 byte-identical이라 `cp`로 미러 가능, `runner.ts`/`core/browser.ts`만 환경차 있음)

---

## 배경 / 의도 (왜 지금 구조인가)

2026-05, 빨래방 크롤링이 정답 ~3,000건 대비 **1,400건만 수집되고 나머지가 조용히 누락**된 사고가 있었다.
원인: 네이버 **soft block**(검색은 성공시키되 결과를 0건으로 반환)을 크롤러가 **"빈 동"으로 오인** → 위음성 누락. DB에 최근 데이터가 들어오는 것만 보고 한동안 못 알아챘다.

이를 근본적으로 막기 위해 개발 팀장님 조언을 반영해 **data lake 방식**으로 재설계했다.

### 개발팀장님 조언 = 설계 원칙

1. **데이터센터 IP(Railway/AWS/Azure) 비권장** — 네이버가 IP 대역을 알아 즉시 차단. residential(가정용=노트북) IP가 유리 → **프록시 없이 사무실 노트북 운영**으로 결정.
2. **assert를 촘촘하게** — 예상 페이지 구조(클래스/계층)를 엄밀히 검사하고 불만족 시 **실패 처리**. 자동 스크래핑에선 위양성보다 **위음성(데이터 있는데 0건)이 치명적**. 단 정상인데 일부 필드(전화번호 등)가 없는 케이스는 옵셔널 허용.
3. **메모리 버퍼 Logger** — 페이지 이동마다 로그/스크린샷을 메모리에 모으고, **run 실패 시에만 dump**.
4. **Data Lake** — raw를 append-only 원장으로 쌓고(정규화 X), canonical(중복제거+정규화)은 **나중에 추출**. 실패 run의 raw는 추출에서 제외.
5. **비용/속도 최적화** — 이미지 로딩 차단(URL만 긁으면 되므로 렌더 불필요).

---

## 데이터 저장 구조 (Supabase 프로젝트: `sku_and_place` / `xsjyvxbnmwwsdvyofjfy`)

**핵심: 크롤러는 `raw_places` 한 테이블에만 저장한다. 업종 구분은 `category` 컬럼.**

| 테이블           | 역할                                                                                                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`raw_places`** | 크롤링 원본 원장. **append-only**(UPDATE/DELETE 금지 트리거 `trg_raw_places_no_mutation`). 모든 업종이 한 테이블, `category` 컬럼으로 구분. `payload`(jsonb)에 추출 원본 통째(shop_name/phone/address/...). `place_id` nullable, `partial` 플래그. 같은 가게를 또 긁으면 **새 row로 중복 누적**(추출 시 정리). |
| **`crawl_runs`** | 크롤링 실행 단위 = **동(dong) 1개 = 1 run**. `status`(running/completed/blocked/assert_failed/error/aborted), `host`(어느 노트북), `category`, `saved_count` 등.                                                                                                                                               |

**canonical은 테이블이 아니라 함수다** — 필요할 때 추출:

```sql
SELECT * FROM extract_latest_places('coin_laundry');  -- 빨래방: completed run의 raw만, place_id별 최신 1건, 중복제거+정규화
SELECT * FROM extract_latest_places();                 -- 전체
```

→ Supabase SQL Editor에서 실행 후 CSV export. **실패/차단 run의 raw는 자동 제외**(빨래방 누락 재발 방지 핵심).

- 기존 v2 테이블(`coin_laundry_v2`, `hair_shops_v2` 등)은 **보존만** 하고 신규 저장은 안 함.
- 운영 관측: `GET /api/runs`(server) 또는 `crawl_runs` 직접 조회 — 어느 동이 blocked/assert_failed인지.

---

## category 규칙

- 환경설정 `SUPABASE_TABLE` / task.table 값에서 `_v\d+`를 제거해 category를 만든다.
  - `coin_laundry_v3` → `coin_laundry`, `coin_laundry` → `coin_laundry` (동일 결과)
- 같은 업종은 **항상 같은 값** 사용. 영문 권장. **별도 테이블을 만들 필요 없다**(저장은 `raw_places`).
- ⚠️ `SUPABASE_TABLE`에 `raw_places`/`canonical` 같은 **시스템 테이블명을 넣지 말 것** — category가 `raw_places`가 되어 업종 구분이 깨진다.

---

## 카테고리 매칭 (어느 가게를 저장할지) — `crawler/utils/category-match.ts`

`matchesCategory(keyword, category, extraKeywords)` — **검색어 + extraCategoryKeywords 로만** 매칭 (자동 별칭 alias 맵은 **제거됨**).

- 가게 카테고리에 검색어가 포함 → 통과 / extraKeywords 중 하나 포함 → 통과 / 카테고리가 비어있으면 통과.
- 빨래방처럼 **검색어 ≠ 가게 카테고리 표기**(예: "코인세탁소")인 업종은 `extraCategoryKeywords` 필수: 예) `["코인세탁","세탁","셀프"]`.

---

## 안정성 / 위음성 방지

- **`crawler/asserts.ts` `StructureAssertError`** — `collectListItems`가 search iframe을 못 찾거나, 0건인데 "검색결과 없음" 마커도 없으면 **조용히 `[]` 반환하지 않고 throw**. runner가 차단판정 → 재검색(`recoverList`) → 그래도 실패면 run을 `assert_failed`로 기록.
- **`crawler/logging/run-recorder.ts` `RunRecorder`** — 동 단위로 로그/스크린샷을 메모리에 모으다 run 실패 시 `dataDir|userData/run-dumps/<runId>`로 dump(`FileDumpSink`). 성공 run은 버림.
- **전화번호 추출**(`naver/map.detail.ts`): ① 바로 보이는 `.xlx7Q` → ② "전화번호 보기"(`a.BfF3H`, svg를 감싼 a) 클릭 후 `.J7eF_ em`(휴대전화번호) 펼치기 → ③ 없으면 빈값. (무인/안심번호 매장 대응)

---

## 운영 (노트북, 프록시 없음)

- **`MAX_SLOTS`** env (기본 1) — 같은 공유기 IP 과부하 방지. 노트북 대수에 **반비례**로 설정.
- IP 차단 시 **점증 백오프** (`IP_BLOCK_BACKOFF_MIN`, 기본 `30,120,240`분) 후 멈추고 구글챗 보고.
- 이미지/미디어/폰트 요청 차단(`core/browser.ts`) — 속도↑·대역폭↓·차단위험↓.
- **진행 상태(progress)는 각 PC 로컬 파일**(`userData/progress.json`) — **컴퓨터 간 공유 안 됨**. 재시작 시 화면에서 "이어서 계속하기"를 체크해야 이어간다. 여러 대로 나눌 땐 지역/업종을 분할(겹치면 같은 동 중복 크롤).
- 알림: Google Chat webhook(`notifier.ts`) — `blocked_backoff`, `structure_broken`, `save_failures`, `empty_dongs` 등.

---

## 빌드 / 실행

- **Electron 앱**: `npm run dev`(개발) · `npm run build`(electron-vite) · `npm run typecheck`(node+web) · `npm run dist:mac` / `dist:win`(배포)
- **서버**: `cd server && npm run dev`(tsx) · `npm run build` · `npm start`
- **웹 대시보드**: `web/` (Vite+React). 분석 조회 UI는 제거됨 — 추출은 `extract_latest_places()` SQL로.

---

## 주요 파일

- 크롤 흐름: `crawler/runner.ts`(CrawlSession) · `naver/map.search.ts` · `map.list.ts` · `map.detail.ts`
- 브라우저: `crawler/core/browser.ts` (Playwright, 스텔스 init script, 이미지 차단)
- 저장: `storage/supabase.raw-repo.ts`(`RawCrawlRepo`) · `crawler/extractors/raw-repository.ts`(타입)
- 주입: server는 `server/src/queue-manager.ts`(3슬롯) / `manager.ts`(WORKERS), Electron은 `src/main/ipc/crawler.ts`
- 알림: `notifier.ts` · 진행상태: `storage/progress.repo.ts`
- DB 작업: Supabase MCP 또는 SQL Editor. 마이그레이션 이력은 Supabase에 기록됨.

> 참고: `src/main/storage/schema.ts`(테이블 자동생성, `exec_sql` RPC 의존)는 v3에서 import 0건인 **죽은 코드**. 테이블은 마이그레이션으로 사전 생성하므로 런타임 DDL 불필요.
