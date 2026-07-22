/** Credit eligibility shown by Starizzi for models billed through Izzi API. */
export type ModelCreditPolicy =
  | 'standard'
  | 'paid-balance-required'
  | 'may-route-paid-only';

export const MODEL_CREDIT_NOTICE_VI: Record<Exclude<ModelCreditPolicy, 'standard'>, string> = {
  'paid-balance-required':
    'Model này không dùng $5 credit miễn phí. Bạn cần có số dư nạp để sử dụng.',
  'may-route-paid-only':
    'Smart Router có thể chọn model chỉ dùng số dư nạp. Nếu được route tới model đó, $5 credit miễn phí không áp dụng và tài khoản cần có số dư đã nạp.',
};

const SMART_ROUTER_ALIASES = new Set(['izzi-smart', 'izzi/auto', 'izzi-auto', 'auto']);

function isGrok45(modelId: string): boolean {
  return /(?:^|\/)grok[-_.]?4[.-]5(?:$|[-_.:/])/.test(modelId);
}

function isGpt56PaidPersona(modelId: string): boolean {
  return /(?:^|\/)gpt-5\.6-(?:sol|terra|luna)(?:$|[-_.:/])/.test(modelId);
}

function claudeOpusVersion(modelId: string): [major: number, minor: number] | null {
  if (!modelId.includes('claude') || !modelId.includes('opus')) return null;

  const matches =
    /claude[-_.:/]*opus[-_.:/]*(\d+)(?:[.-](\d{1,2}))?(?:$|[-_.:/])/.exec(modelId) ??
    /claude[-_.:/]*(\d+)(?:[.-](\d{1,2}))?[-_.:/]*opus(?:$|[-_.:/])/.exec(modelId);
  if (!matches) return null;

  return [Number(matches[1]), Number(matches[2] ?? 0)];
}

function isClaudeOpus47OrNewer(modelId: string): boolean {
  const version = claudeOpusVersion(modelId);
  if (!version) return false;
  const [major, minor] = version;
  return major > 4 || (major === 4 && minor >= 7);
}

/**
 * Pure model-id policy. Callers should only present Izzi credit copy when the
 * selected route is billed through Izzi; local/provider-native billing differs.
 */
export function getModelCreditPolicy(rawModelId: string): ModelCreditPolicy {
  const modelId = (rawModelId ?? '').trim().toLowerCase();
  if (SMART_ROUTER_ALIASES.has(modelId)) return 'may-route-paid-only';
  if (isGrok45(modelId) || isGpt56PaidPersona(modelId) || isClaudeOpus47OrNewer(modelId)) {
    return 'paid-balance-required';
  }
  return 'standard';
}

export function isPaidCreditOnlyModel(modelId: string): boolean {
  return getModelCreditPolicy(modelId) === 'paid-balance-required';
}
