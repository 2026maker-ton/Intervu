// 핸들러 공통: 에러 객체·시각. 핸들러 반환은 { status, body } 또는 { error, status }.
export const now = () => new Date().toISOString();
export const err = (code, message, status, extra = {}) => ({ error: { code, message, retryable: !!extra.retryable, request_id: extra.requestId || null, details: extra.details || null }, status });
