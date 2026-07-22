/**
 * [발췌: server/index.ts + server/db.ts — 핵심 운영 로직만 재구성]
 *
 * 이 코드가 보여주는 것:
 * 1) 이중 프록시(Nginx + Cloudflare) 뒤에서 사용자별 rate limit이 동작하게 만든
 *    keyGenerator 해법 — trust proxy 없이 신뢰 범위를 키 계산에만 한정
 * 2) 전역/사용자별(IP + Device ID) 일일 한도의 3중 비용 방어와
 *    동시 요청에도 안전한 원자적 UPSERT 카운팅
 * 3) 성공 시에만 한도를 차감하는 순서, 에러 원문 비노출 원칙
 *
 * // [비공개] 구체 한도 수치·윈도우 값은 운영 정책상 비공개 (별도 모듈로 분리했다고 가정)
 * // [비공개] 계약 분석 프롬프트(SYSTEM_PROMPT) 본문
 */
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import requestIp from 'request-ip';
import { rateLimit } from 'express-rate-limit';
import { extractJson } from './extractJson.js';
// [비공개: 실제 한도 수치] — RATE_WINDOW_MS, RATE_MAX, GLOBAL_DAILY_LIMIT, USER_DAILY_LIMIT
import { RATE_WINDOW_MS, RATE_MAX, GLOBAL_DAILY_LIMIT, USER_DAILY_LIMIT } from './limits.js';

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),           // 디스크 미기록 — 개인정보 무저장 원칙
    limits: { fileSize: 10 * 1024 * 1024 }     // 10MB 제한 (프론트·Nginx와 3중)
});

// 1. IP 감지 미들웨어 (X-Forwarded-For 파싱 → req.clientIp)
app.use(requestIp.mw());

// 2. 분당 요청 제한 — keyGenerator가 이 코드의 핵심.
// nginx/Cloudflare 뒤에서는 req.ip가 프록시 IP 하나로 잡혀 "전체 사용자가
// 한 버킷을 공유"하는 버그가 있었다. trust proxy는 이중 프록시에서 hop 설정이
// 어긋나면 IP 위조 여지가 생기므로, XFF를 파싱한 clientIp를 rate limit
// 키 계산에만 사용해 신뢰 범위를 최소화했다.
const limiter = rateLimit({
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX,
    message: { error: "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해 주세요." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => req.clientIp || req.ip,
    validate: {
        xForwardedForHeader: false,     // 커스텀 keyGenerator 사용으로 불필요한 경고 억제
        keyGeneratorIpFallback: false
    }
});

// 3. CORS: 운영 도메인 + 개발 오리진만 화이트리스트 (기본 전면 개방 방지)
const allowedOrigins = (process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : [
        'https://clause-guard.smko.cloud',
        'http://localhost:3000',
        'http://localhost:5173',
    ]).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // origin이 없는 요청(same-origin, 헬스체크, curl 등)은 허용
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS 정책에 의해 차단되었습니다.'));
    }
}));

const todayStr = () => new Date().toISOString().split('T')[0];
const getClientIp = (req: any): string => req.clientIp || req.ip || 'unknown_ip';

app.post('/api/analyze', limiter, upload.single('file'), async (req, res) => {
    const clientIp = getClientIp(req);
    // Device ID: 프론트가 localStorage UUID를 헤더로 전달.
    // IP(VPN으로 우회 가능)와 Device ID(시크릿 창으로 우회 가능)를 "각각" 추적해
    // 어느 한쪽만 한도를 넘어도 차단 — 우회 비용을 크게 올린다.
    const deviceId = req.headers['x-device-id'] as string || 'unknown_device';
    const date = todayStr();

    try {
        // --- 비용 방어 관문 ---
        // 관문 1: 전역 일일 한도 — 어떤 상황에서도 하루 API 지출 총량을 보장
        const globalUsage = await getGlobalUsage(date);
        if (globalUsage && globalUsage.count >= GLOBAL_DAILY_LIMIT) {
            return res.status(429).json({ error: "서비스의 하루 이용량이 모두 소진되었습니다. 내일 다시 이용해 주세요." });
        }

        // 관문 2: 사용자별 일일 한도 — IP와 Device ID 중 하나라도 초과 시 차단
        const ipUsage = await getUsage(clientIp, 'IP', date);
        const deviceUsage = await getUsage(deviceId, 'DEVICE', date);
        if ((ipUsage && ipUsage.count >= USER_DAILY_LIMIT) || (deviceUsage && deviceUsage.count >= USER_DAILY_LIMIT)) {
            return res.status(429).json({ error: "일일 무료 이용 한도를 초과했습니다. 내일 다시 시도해 주세요." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "파일이 업로드되지 않았습니다." });
        }

        // [비공개: SYSTEM_PROMPT 본문 + Gemini 멀티모달 호출부]
        // 유형 판별 → 조항 추출 → 3단계 위험도 분류 → JSON 스키마 강제 구조의
        // 프롬프트와 파일(base64)을 함께 전달하고, responseMimeType=json으로 응답을 받는다.
        const rawText: string = await callGeminiWithContractFile(req.file);

        // LLM 응답은 외부 입력 — 방어적으로 JSON만 추출 (extractJson.ts 참고)
        const analysisData = extractJson(rawText);

        // 카운트는 "성공 후에만" 증가 — 실패한 요청이 사용자 한도를 소모하지 않도록.
        // 증가 자체는 원자적 UPSERT라 동시 요청에도 카운트가 유실되지 않는다.
        await incrementGlobalUsage(date);
        await incrementUsage(clientIp, 'IP', date);
        if (deviceId !== 'unknown_device') {
            await incrementUsage(deviceId, 'DEVICE', date);
        }

        res.json(analysisData);

    } catch (error: any) {
        // 상세 원문은 서버 로그로만 남기고, 클라이언트에는 일반화된 메시지만 노출
        console.error("Server Error Detail:", error);
        const msg = error.message || "";
        if (msg.includes("429") || msg.includes("Quota")) {
            res.status(429).json({ error: "서비스 트래픽이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주세요." });
        } else {
            res.status(500).json({ error: "서버에서 분석을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
        }
    }
});

// ---------------------------------------------------------------------------
// [발췌: server/db.ts] 원자적 UPSERT 카운팅
// 처음엔 SELECT 후 UPDATE(read-modify-write)였는데, 동시 요청이 겹치면
// 카운트가 유실되는 경쟁 조건이 있어 DB 레벨의 단일 문장 UPSERT로 교체했다.
// ---------------------------------------------------------------------------
export async function incrementUsage(identifier: string, type: 'IP' | 'DEVICE', date: string) {
    const database = await initDb();
    await database.run(
        `INSERT INTO daily_usage_logs (identifier, type, date, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(identifier, type, date) DO UPDATE SET count = count + 1`,
        [identifier, type, date]
    );
}

export async function incrementGlobalUsage(date: string) {
    const database = await initDb();
    await database.run(
        `INSERT INTO global_usage_logs (date, count) VALUES (?, 1)
         ON CONFLICT(date) DO UPDATE SET count = count + 1`,
        [date]
    );
}
