# Code Samples

전체 소스는 프라이빗입니다. 여기에는 **비밀 없이 실력이 드러나는 코드**만 골라 발췌했습니다.
원본에서 비공개 부분(분석 프롬프트 본문, 운영 한도 수치 등)을 도려낸 자리는 `// [비공개: …]` 주석으로 명시해 흐름이 끊기지 않게 했습니다.

| 파일 | 이 코드를 고른 이유 |
| :--- | :--- |
| [`extractJson.ts`](extractJson.ts) | LLM 출력을 외부 입력처럼 방어적으로 다루는 파서 — 코드펜스·후행 텍스트·중첩 객체를 괄호 깊이 추적으로 처리 |
| [`extractJson.test.ts`](extractJson.test.ts) | 실제 장애 유형을 그대로 회귀 테스트로 고정한 사례 |
| [`masking.ts`](masking.ts) | 패턴 마스킹을 넘어 "임차인/성명" 같은 **문맥 키워드 기반** 한글 이름 마스킹까지 구현한 PII 처리 |
| [`rate-limit-usage-guard.ts`](rate-limit-usage-guard.ts) | 이 프로젝트의 핵심 운영 로직 — 이중 프록시 뒤 사용자 식별(`keyGenerator`), 3중 사용량 방어, 원자적 UPSERT, 에러 비노출 |
| [`nginx.conf`](nginx.conf) | PWA 캐시 고착 사고를 해결한 캐시 계층 전략 (진입점 재검증 vs 해시 자산 장기 캐시) |
| [`Dockerfile.frontend`](Dockerfile.frontend) | 멀티스테이지 빌드로 빌드 도구가 최종 이미지에 남지 않는 배포 이미지 구성 |
