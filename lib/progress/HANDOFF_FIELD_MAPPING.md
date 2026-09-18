# HANDOFF.md ↔ 실제 스키마 필드 대응표

`클로드 디자인_HANDOFF.md`(프로토타입 분석 리포트) §3의 필드명은 ZIP
프로토타입 기준 표기다. 실제 구현 기준은 `prisma/schema.prisma`이고, 이름과
저장 형태가 다른 것은 전부 의도된 설계다 — 이름만 보고 "누락"으로 오인하지
않도록 대응 관계를 여기 남긴다. 필드가 없어진 경우는 없다.

## 정규 프로젝트 (`ProgressRegularProject`)

| HANDOFF 필드 | 실제 컬럼 | 형태 |
|---|---|---|
| `stageState`(8칸 배열, run/skip/빈값) | `stageRunIndexes Int[]` + `stageSkipIndexes Int[]` | **구조 변경.** 8칸 문자열 배열이 아니라 "run인 index들"/"skip인 index들" 두 정수 배열로 압축. 의미 있는 정보가 "어느 index가 run/skip인가"뿐이라서(schema.prisma의 해당 필드 주석 참고). 어느 쪽에도 없는 index는 자동으로 미진행. |
| `rounds` | `improvementRounds Int` | 개명만 |
| `kickoff` / `target` / `actual` | `kickoffDate` / `targetReleaseDate` / `actualReleaseDate` (`DateTime?`) | 개명만 |
| `artifact` | `artifactUrl String?` | 개명만 |
| 샘플 2개(sample2/sample3) | `samplePw3Date` / `samplePw4Date` (`DateTime?`) | 개명(HANDOFF §3의 rename 권고를 그대로 반영) |
| `log` | `ProgressUpdateLog` 관계 테이블(`updateLogs`) | **정규화 테이블.** 배열/JSON이 아니라 별도 테이블 + FK. author는 ZIP처럼 이름 문자열이 아니라 실제 로그인한 `User`. |

## 서브 프로젝트 (`ProgressSubProject` / `ProgressSubProjectItem`)

| HANDOFF 필드 | 실제 컬럼 | 형태 |
|---|---|---|
| `quarterStart` / `quarterEnd` | `quarterStartYear`+`quarterStartQ` / `quarterEndYear`+`quarterEndQ` (모두 `Int`) | **분해.** "2026 Q3" 문자열이 아니라 (year, q) 정수 쌍 — 정렬/범위 비교가 문자열 파싱 없이 가능. `lib/progress/date.ts`의 회계분기 헬퍼로 오간다. |
| `sheetUrl` | `sheetUrl String?` | 그대로 |
| `items[].quarter` | `quarterYear`+`quarterNum` (`Int`) | 분해(위와 동일한 이유) |

## 공통 업무 (`ProgressCommonTask` / `ProgressCommonTaskItem`)

| HANDOFF 필드 | 실제 컬럼 | 형태 |
|---|---|---|
| `monthStart` / `monthEnd` | `monthStartYear`+`monthStartNum` / `monthEndYear`+`monthEndNum` (모두 `Int`) | 분해 |
| `repeat` / `repeatDay` | `repeat Boolean` / `repeatDay String?` | 그대로("1"~"31" 또는 "last") |
| `items[].month` | `monthYear`+`monthNum` (`Int`) | 분해 |
| `items[].carriedFrom` | `carriedFromYear`+`carriedFromMonth` (`Int?`, nullable) | 분해. 최초 이월 시 1회만 채워지고 이후 다시 이월돼도 덮어쓰지 않는다(`carryForwardCommonTaskItemAction`이 `?? item.monthYear` 형태로 보장 — `app/(shell)/progress/actions.ts`). |

## 공통 원칙

- "연-분기"/"연-월" 성격의 값은 전부 문자열이 아니라 `{Year}`+`{Q|Num}` 정수 쌍으로 저장한다(Postgres+Prisma 관례, 정렬/인덱스에 유리).
- 읽기 전용이 아니라 실제 쓰기가 필요한 이력(`log`)은 배열/JSON 컬럼이 아니라 정규화된 관계 테이블로 둔다.
- 이 표는 2026-09-18 기준 스키마와 대조해 작성했다. 스키마가 바뀌면 이 표도 같이 갱신한다.
