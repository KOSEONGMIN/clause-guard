/**
 * [발췌: server/extractJson.test.ts — 원본 그대로]
 *
 * 이 코드가 보여주는 것: 실제로 겪은 LLM 응답 변형(코드펜스, 후행 설명,
 * 중첩 객체, 미닫힘)을 케이스별 회귀 테스트로 고정한 사례.
 */
import { describe, it, expect } from 'vitest';
import { extractJson } from './extractJson';

describe('extractJson', () => {
    it('순수 JSON 문자열을 파싱한다', () => {
        expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
    });

    it('```json 코드펜스로 감싼 JSON을 파싱한다', () => {
        const raw = '```json\n{"contractType":"근로계약서"}\n```';
        expect(extractJson(raw)).toEqual({ contractType: '근로계약서' });
    });

    it('JSON 뒤에 붙은 설명 텍스트를 무시한다', () => {
        const raw = '{"overallRisk":"High"} 위 내용은 분석 결과입니다.';
        expect(extractJson(raw)).toEqual({ overallRisk: 'High' });
    });

    it('중첩 객체에서 짝이 맞는 닫는 괄호까지 추출한다', () => {
        const raw = 'noise {"clauses":[{"status":"Safe"}],"summary":"ok"} tail';
        expect(extractJson(raw)).toEqual({ clauses: [{ status: 'Safe' }], summary: 'ok' });
    });

    it('JSON 객체가 없으면 예외를 던진다', () => {
        expect(() => extractJson('설명만 있고 객체가 없음')).toThrow(SyntaxError);
    });

    it('객체가 닫히지 않으면 예외를 던진다', () => {
        expect(() => extractJson('{"a": 1')).toThrow(SyntaxError);
    });
});
