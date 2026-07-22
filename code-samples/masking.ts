/**
 * [발췌: src/utils/masking.ts — 원본 그대로]
 *
 * 이 코드가 보여주는 것: 클라이언트 사이드 PII 마스킹.
 * 주민번호·전화·이메일은 패턴 마스킹으로, 한글 이름은 패턴만으로 잡을 수 없어
 * "임대인/임차인/성명" 같은 문맥 키워드 뒤의 2~4자 한글을 이름으로 간주하는
 * 문맥 기반 접근을 썼다. AI 분석 결과 텍스트에 적용되어 화면 노출 전 마스킹한다.
 */

// 주민등록번호 패턴 (900101-1234567)
const RRN_REGEX = /\b(?:\d{6}-\d{7})\b/g;

// 전화번호 패턴 (010-1234-5678, 02-123-4567 등)
const PHONE_REGEX = /\b(?:\d{2,3}-\d{3,4}-\d{4})\b/g;

// 이메일 패턴
const EMAIL_REGEX = /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g;

// 이름 마스킹을 위한 키워드 (이 키워드들 뒤에 오는 단어를 이름으로 간주)
const NAME_KEYWORDS = ['임대인', '임차인', '성명', '대표자', '이름', '소유자', '중개사'];
const NAME_CONTEXT_REGEX = new RegExp(`(${NAME_KEYWORDS.join('|')})\\s*[:)]?\\s*([가-힣]{2,4})`, 'g');

/**
 * 텍스트 내의 개인정보를 마스킹 처리합니다.
 */
export const maskPII = (text: string): string => {
    let maskedText = text;

    // 주민번호 마스킹
    maskedText = maskedText.replace(RRN_REGEX, (match) => {
        return match.substring(0, 8) + "*******";
    });

    // 전화번호 마스킹
    maskedText = maskedText.replace(PHONE_REGEX, (match) => {
        const parts = match.split("-");
        if (parts.length === 3) {
            return `${parts[0]}-****-${parts[2]}`;
        }
        return match;
    });

    // 이메일 마스킹 (id의 앞 3글자만 노출)
    maskedText = maskedText.replace(EMAIL_REGEX, (match) => {
        const [id, domain] = match.split("@");
        return id.substring(0, 3) + "***@" + domain;
    });

    // 문맥 기반 이름 마스킹 (성만 노출)
    // 예: "임차인 홍길동" -> "임차인 홍**"
    maskedText = maskedText.replace(NAME_CONTEXT_REGEX, (match, _keyword, name) => {
        if (name.length >= 2) {
            const maskedName = name[0] + "*".repeat(name.length - 1);
            return match.replace(name, maskedName);
        }
        return match;
    });

    return maskedText;
};
