import type { components } from '../../../../contracts/generated/demo-api';
export type Schema = components['schemas'];
export type Model = Schema['NerRequest']['models'][number];
export type Source = Schema['NerRequest']['source'];
export const nerModels = [
  'logreg',
  'linear-svm',
  'crf',
  'xlmr',
  'phobert',
  'vihealthbert-ner-seed2024',
] as const satisfies readonly Model[];
export const modelName: Record<Model, string> = {
  logreg: 'Logistic Regression',
  'linear-svm': 'Linear SVM',
  crf: 'CRF',
  xlmr: 'XLM-R',
  phobert: 'PhoBERT',
  'vihealthbert-ner-seed2024': 'ViHealthBERT NER',
};
export const modelOption: Record<Model, string> = {
  logreg: 'Bậc 1 · Logistic Regression',
  'linear-svm': 'Bậc 2 · Linear SVM',
  crf: 'Bậc 3 · CRF',
  xlmr: 'Bậc 4 · XLM-R',
  phobert: 'Bậc 5 · PhoBERT',
  'vihealthbert-ner-seed2024': 'Bậc 6 · ViHealthBERT NER',
};
export const modelRole: Record<Model, string> = {
  logreg: 'Bậc 1 · phân loại từng âm tiết',
  'linear-svm': 'Bậc 2 · phân loại lề cực đại',
  crf: 'Bậc 3 · mô hình chuỗi',
  xlmr: 'Bậc 4 · Transformer đa ngôn ngữ',
  phobert: 'Bậc 5 · Transformer tiếng Việt',
  'vihealthbert-ner-seed2024': 'Bậc 6 · Transformer y tế',
};
export class HttpError extends Error {
  constructor(public status: number, public detail: Schema['ApiError'], public retryAfter: string | null = null) { super(detail.message); }
}
export async function request<T>(path: string, options: RequestInit = {}, timeout = 10000): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as Schema['ErrorResponse'] | null;
    throw new HttpError(response.status, body?.error ?? { code: 'GATEWAY_ERROR', message: `Không kết nối được dịch vụ (HTTP ${response.status}).`, stage: 'connection', retryable: true }, response.headers.get('Retry-After'));
  }
  return response.json() as Promise<T>;
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function capability(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function errorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.detail.code === 'JOB_UNAVAILABLE') return 'Không còn truy cập được lượt xử lý. Dịch vụ có thể đã khởi động lại hoặc kết quả đã hết hạn. Audio và bản sửa vẫn được giữ; bạn có thể thử một lượt mới.';
    if (error.status === 429) return `Dịch vụ đang bận. Hãy thử lại${error.retryAfter ? ` sau ${error.retryAfter} giây` : ' sau ít phút'}.`;
    return `${error.detail.message} (${error.detail.code})`;
  }
  return 'Mất kết nối hoặc hết thời gian chờ. Nội dung vẫn được giữ. Tiếp tục kiểm tra lượt hiện tại trước khi thử một lượt mới.';
}
export const terminal = (job: Schema['Job']) => ['succeeded', 'partial', 'failed'].includes(job.status);
