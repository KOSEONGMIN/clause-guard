# Code Samples

전체 소스는 비공개입니다. 여기에는 **비밀 없이 실력이 드러나는 코드**만 골라 담았습니다.
원본에서 비공개 부분(분석 프롬프트 본문, 운영 제한 숫자 등)을 들어낸 자리는 `// [비공개: …]` 주석으로 표시해 흐름이 끊기지 않게 했습니다.

| 파일 | 이 코드를 고른 이유 |
| :--- | :--- |
| [`extractJson.ts`](extractJson.ts) | LLM 출력을 외부 입력처럼 의심하고 다루는 파서 — 코드펜스·꼬리 텍스트·겹친 객체를 괄호 짝 추적으로 처리 |
| [`extractJson.test.ts`](extractJson.test.ts) | 실제 장애 유형을 그대로 테스트 케이스로 못박은 사례 |
| [`masking.ts`](masking.ts) | 패턴 가리기를 넘어 "임차인/성명" 같은 **문맥 키워드 기반** 한글 이름 가리기까지 구현한 개인정보 처리 |
| [`rate-limit-usage-guard.ts`](rate-limit-usage-guard.ts) | 이 프로젝트의 핵심 운영 로직 — 이중 프록시 뒤에서 사용자 알아내기(`keyGenerator`), 3중 사용량 방어, 원자적 UPSERT, 에러 감추기 |
| [`nginx.conf`](nginx.conf) | 배포해도 옛 버전이 보이던 PWA 캐시 사고를 해결한 캐시 전략 (입구는 매번 다시 확인, 해시 붙은 파일은 오래 캐시) |
| [`Dockerfile.frontend`](Dockerfile.frontend) | 멀티스테이지 빌드로 빌드 도구가 최종 이미지에 남지 않는 배포 이미지 구성 |
