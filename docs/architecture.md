# Clause Guard — 상세 아키텍처

> 이 문서는 [README](../README.md)의 아키텍처 섹션을 확장한 상세 설계 문서입니다.
> 코드 전체는 프라이빗이며, 여기서는 설계 의도와 구조를 다룹니다. 핵심 코드 발췌는 [`code-samples/`](../code-samples/) 참고.

## 목차

1. [전체 구성](#1-전체-구성)
2. [분석 요청의 생애주기](#2-분석-요청의-생애주기)
3. [비용 방어 계층](#3-비용-방어-계층)
4. [개인정보 설계](#4-개인정보-설계)
5. [프론트엔드 캐시 전략](#5-프론트엔드-캐시-전략)
6. [CI/CD 파이프라인](#6-cicd-파이프라인)
7. [의도적 트레이드오프](#7-의도적-트레이드오프)

---

## 1. 전체 구성

```mermaid
flowchart TB
    subgraph Internet["🌐 인터넷"]
        U["사용자 (모바일/PWA)"]
        CF["Cloudflare Tunnel<br/>(원 서버 비노출)"]
    end

    subgraph Host["🖥️ 홈서버 — Docker Compose"]
        subgraph FE["frontend 컨테이너"]
            NG["Nginx<br/>· 정적 파일 서빙<br/>· /api → backend 프록시<br/>· client_max_body_size 10M<br/>· 캐시 헤더 계층화"]
        end
        subgraph BE["backend 컨테이너"]
            EX["Express 5<br/>· rate limiter (clientIp 키)<br/>· 사용량 한도 검사<br/>· multer 메모리 업로드 (10MB)<br/>· CORS 화이트리스트"]
        end
        SQ[("SQLite (볼륨)<br/>사용량 카운트만")]
        LG["logs/ (볼륨)<br/>일자별 요청 로그"]
    end

    GM["Google Gemini API<br/>(멀티모달)"]

    U --> CF --> NG
    NG -->|"/api/*<br/>X-Forwarded-For 전달"| EX
    EX --> SQ
    EX --> LG
    EX -->|"프롬프트 + 파일(base64)"| GM
```

핵심 결정 세 가지:

- **프론트는 Gemini를 모른다.** API 키는 백엔드 환경변수에만 존재하고, 프론트는 `/api/analyze`만 호출한다. 키가 번들·네트워크 탭 어디에도 나타나지 않는다.
- **컨테이너 2개로 분리.** 프론트(Nginx)와 백엔드(Express)를 독립 이미지로 빌드해 각자 배포·재시작 가능. compose의 `depends_on: condition: service_healthy`로 백엔드 헬스체크(`/api/health`) 통과 후에만 프론트가 뜬다.
- **상태는 볼륨으로.** SQLite 파일과 로그는 호스트 볼륨에 마운트되어 컨테이너 재배포와 무관하게 유지된다. 이미지에는 `.dockerignore`로 `.env`·`data`·`logs`가 절대 들어가지 않는다.

---

## 2. 분석 요청의 생애주기

```mermaid
sequenceDiagram
    participant B as 브라우저
    participant N as Nginx
    participant E as Express
    participant D as SQLite
    participant G as Gemini

    B->>B: 파일 선택 (프론트 10MB 1차 검증)
    B->>N: POST /api/analyze (파일 + X-Device-Id)
    N->>E: 프록시 (XFF에 실제 IP 추가, 10MB 2차 제한)
    E->>E: 분당 rate limit 검사 (clientIp 기준)
    E->>D: 전역 일일 한도 조회
    E->>D: IP · Device ID 각각 일일 한도 조회
    alt 한도 초과
        E-->>B: 429 + 안내 메시지
    end
    E->>E: multer 메모리 저장 (10MB 3차 제한, 디스크 미기록)
    E->>G: 분석 프롬프트 + 파일(base64), responseMimeType=json
    G-->>E: 분석 결과 (JSON… 이길 바라는 텍스트)
    E->>E: extractJson() — 코드펜스/후행 텍스트 제거 후 파싱
    E->>D: 성공 시에만 사용량 카운트 증가 (원자적 UPSERT)
    E-->>B: 분석 JSON
    B->>B: maskPII() — 결과 텍스트 개인정보 마스킹 후 렌더링
```

설계 포인트:

- **카운트는 성공 후에만 증가.** 파싱 실패·API 오류로 결과를 못 받은 사용자의 한도를 소모시키지 않기 위한 의도적 순서다. 체크와 증가 사이에 미세한 TOCTOU 여지가 있지만, 개인 서비스 규모에서 "실패에도 한도 차감"보다 사용자 경험 손해가 작다고 판단했다 ([§7](#7-의도적-트레이드오프)).
- **증가 자체는 원자적.** `INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1` UPSERT라 동시 요청이 겹쳐도 카운트가 유실되지 않는다. (read-modify-write를 앱 레벨에서 하다가 경쟁 조건을 발견하고 교체한 부분)
- **에러는 두 갈래로.** 클라이언트에는 일반화된 메시지만 반환하고, 스택·원문은 서버 로그에만 남긴다. 내부 구현이 에러 메시지로 새는 것을 막는다.

### AI 응답 스키마

프롬프트가 강제하는 응답 구조 (프롬프트 본문은 비공개, 구조만 공개):

```ts
{
  contractType: string;                       // 자동 판별된 계약 유형
  summary: string;                            // 전체 요약
  overallRisk: "Low" | "Medium" | "High";
  clauses: Array<{
    originalText: string;                     // 계약서상 원문 조항
    status: "Safe" | "Ambiguous" | "Dangerous";
    explanation: string;                      // 비유를 포함한 쉬운 설명
    recommendation: string;                   // 수정 제안 / 추가할 특약
  }>;
}
```

프롬프트는 **① 계약 유형 판별 → ② 유형별 관점으로 조항 추출 → ③ 3단계 위험도 분류 → ④ 위 JSON 스키마 강제**의 단계적 구조로 설계되어 있고, 계약 유형별(부동산/근로/용역)로 집중 분석할 법적 관점을 다르게 지정한다.

---

## 3. 비용 방어 계층

무료 공개 + 종량제 LLM API 조합은 방어 없이는 성립하지 않는다. 요청 하나가 통과해야 하는 관문을 겹겹이 쌓았다:

```mermaid
flowchart LR
    R["요청"] --> L1["1️⃣ 분당 rate limit<br/>(버스트/스크립트 차단)"]
    L1 --> L2["2️⃣ 전역 일일 한도<br/>(예산 총량 방어)"]
    L2 --> L3["3️⃣ 사용자별 일일 한도<br/>IP 기준 + Device ID 기준<br/>(둘 중 하나만 초과해도 차단)"]
    L3 --> OK["Gemini 호출"]
```

| 계층 | 막는 것 | 구현 |
| :--- | :--- | :--- |
| 분당 rate limit | 스크립트성 연타, 단순 DoS | `express-rate-limit` + `keyGenerator: req.clientIp` |
| 전역 일일 한도 | 예산 자체의 소진 — 어떤 상황에서도 하루 지출 상한 보장 | SQLite `global_usage_logs` |
| 사용자별 일일 한도 | 한 사용자의 독점 | SQLite `daily_usage_logs`, IP와 Device ID **각각** 기록 |

- **왜 이중 식별인가**: IP만 쓰면 VPN·테더링 재접속으로 우회되고, Device ID(localStorage UUID)만 쓰면 시크릿 창으로 우회된다. 둘을 모두 추적하고 **OR 조건으로 차단**하면 우회 비용이 크게 올라간다.
- **왜 `trust proxy`가 아니라 `keyGenerator`인가**: Nginx + Cloudflare 이중 프록시에서 `trust proxy` hop 설정이 어긋나면 클라이언트가 헤더로 IP를 위조할 수 있다. 신뢰 범위를 "rate limit 키 계산"에만 한정하는 쪽이 실수 여지가 작았다. → [`code-samples/rate-limit-usage-guard.ts`](../code-samples/rate-limit-usage-guard.ts)
- 구체 한도 수치는 운영 정책상 비공개.

---

## 4. 개인정보 설계

계약서는 이름·주민번호·주소·금액이 모두 담긴 민감 문서다. 원칙은 **"저장하지 않으면 유출도 없다"**:

| 단계 | 처리 |
| :--- | :--- |
| 업로드 | multer **메모리 스토리지** — 파일이 디스크에 기록되지 않음 |
| 분석 | 파일은 base64로 Gemini에 전달 후 응답 즉시 버퍼 폐기 |
| 저장 | 계약서 원본·분석 결과 모두 **DB에 저장하지 않음** (사용량 카운트만 저장) |
| 표시 | 분석 결과 텍스트를 클라이언트에서 `maskPII()`로 마스킹 — 주민번호·전화번호·이메일은 패턴 마스킹, 이름은 "임차인/성명" 등 **문맥 키워드 뒤 한글 이름**을 잡아 성만 남김 → [`code-samples/masking.ts`](../code-samples/masking.ts) |
| 로그 | 요청 메타데이터(IP, GeoIP 국가, 기기/브라우저)만 기록, 문서 내용은 로그에 남기지 않음 |

정직하게 문서화한 한계: **원본 파일 자체는 마스킹 없이 Gemini로 전송된다** (이미지/PDF는 클라이언트에서 텍스트 마스킹이 불가능). 그래서 서비스 문구도 "원본 미저장 + 결과 마스킹"으로 정확히 표기한다 — 할 수 있는 것 이상을 약속하지 않는 것도 설계의 일부라고 생각한다.

---

## 5. 프론트엔드 캐시 전략

PWA + Cloudflare + 브라우저 캐시가 겹치면 "배포했는데 사용자는 옛 버전" 문제가 생긴다. 해법은 **갱신 진입점과 불변 자산을 분리**하는 것:

```
[매번 재검증 — no-cache, must-revalidate]
  /index.html          ← 새 버전을 알게 되는 유일한 진입점
  /sw.js               ← 서비스워커 갱신 트리거
  /registerSW.js
  /manifest.webmanifest

[1년 캐시 — public, max-age=31536000, immutable]
  /assets/*            ← 파일명에 콘텐츠 해시 포함 → 내용이 바뀌면 URL이 바뀜
```

- 진입점이 항상 재검증되므로 배포 즉시 새 해시의 자산 URL이 전파되고, 자산 자체는 장기 캐시로 재방문 로딩이 빠르다.
- 서비스워커는 `/api` 경로를 캐시·navigation fallback에서 제외 — API 요청이 캐시된 HTML로 응답되는 사고를 막는다 (실제로 겪은 버그).
- 전체 설정: [`code-samples/nginx.conf`](../code-samples/nginx.conf)

---

## 6. CI/CD 파이프라인

```mermaid
flowchart LR
    P["git push (main)"] --> A["GitHub Actions"]
    A --> B1["backend 이미지 빌드<br/>Dockerfile.backend"]
    A --> B2["frontend 이미지 빌드<br/>멀티스테이지: Vite build → Nginx"]
    B1 --> R["GHCR<br/>ghcr.io/…-backend<br/>ghcr.io/…-frontend"]
    B2 --> R
    R --> D["서버: docker compose pull && up -d"]
    D --> H["healthcheck 통과 후<br/>frontend 기동"]
```

- 프론트 이미지는 **멀티스테이지 빌드**: 빌드 스테이지(node)에서 `vite build` 후, 산출물만 `nginx:alpine`으로 복사 — 최종 이미지에 소스·node_modules·빌드 도구가 남지 않는다. → [`code-samples/Dockerfile.frontend`](../code-samples/Dockerfile.frontend)
- 인증은 워크플로의 기본 `GITHUB_TOKEN`만 사용 — 별도 시크릿 발급·관리가 없다.
- 백엔드는 sqlite3 네이티브 모듈 빌드를 위해 python3/make/g++를 이미지 빌드 시점에 설치.

<!-- 📸 IMAGE-04 -->
> 🖼️ **[여기에 이미지 삽입: GitHub Actions 빌드 화면]**
> - 권장: 프론트/백엔드 두 job이 나란히 성공(초록 체크)한 워크플로 실행 화면 스크린샷
> - 주의: 레포 이름 외 개인 정보가 화면에 없는지 확인
> - 파일 위치: `images/04-ci.png` → 삽입 후 이 블록 전체를 `![CI 파이프라인](images/04-ci.png)` 으로 교체

---

## 7. 의도적 트레이드오프

완벽함보다 규모에 맞는 선택을 했고, 한계를 알고 있다는 것을 기록해 둔다:

| 선택 | 트레이드오프 | 판단 근거 |
| :--- | :--- | :--- |
| 사용량 검사: check-then-act | 체크~증가 사이 미세한 경쟁 조건 (한도 근처에서 1~2회 초과 가능) | 증가 자체는 원자적 UPSERT라 카운트 유실은 없음. "성공 시에만 차감"이 주는 UX 이득이 더 큼 |
| SQLite 단일 파일 | 수평 확장 불가 | 저장 대상이 카운트뿐인 개인 서비스 — 운영 복잡도 최소화가 우선 |
| 백엔드 tsx 런타임 실행 (트랜스파일 없이) | 프로덕션에서 빌드 산출물이 아닌 소스 실행 | 배포 단순화. 타입 검증은 테스트·개발 시점에 수행 |
| 원본 파일 마스킹 없이 AI 전송 | 이미지 내 PII가 모델에 노출 | 클라이언트에서 이미지 마스킹은 비현실적 — 대신 무저장 원칙 + 사용자에게 정확히 고지 |
