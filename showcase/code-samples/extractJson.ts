/**
 * [발췌: server/extractJson.ts — 원본 그대로]
 *
 * 이 코드가 보여주는 것: LLM 출력을 "외부 입력"처럼 방어적으로 다루는 파싱.
 * 프롬프트로 JSON을 강제해도 모델은 코드펜스로 감싸거나 뒤에 설명을 붙인다.
 * 정규식만으로는 후행 텍스트 케이스가 깨져서, 괄호 깊이를 추적해 짝이 맞는
 * 지점까지만 잘라 파싱한다. (테스트: extractJson.test.ts)
 */

/**
 * Gemini 응답에서 JSON 객체만 안전하게 추출합니다.
 * - 마크다운 코드펜스(```json ... ```) 제거
 * - 첫 '{' 부터 짝이 맞는 '}' 까지만 파싱 (모델이 JSON 뒤에 설명을 붙이는 경우 대응)
 */
export function extractJson(raw: string): unknown {
    // 1) 마크다운 코드펜스 제거
    const text = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();

    // 2) 첫 번째 '{' 부터 매칭되는 '}' 까지만 추출
    const start = text.indexOf('{');
    if (start === -1) throw new SyntaxError('JSON 객체를 찾을 수 없습니다.');

    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }

    if (end === -1) throw new SyntaxError('JSON 객체가 닫히지 않았습니다.');

    return JSON.parse(text.slice(start, end + 1));
}
