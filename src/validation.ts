export function validateLogin(id: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if ([...id].length < 1 || [...id].length > 100)
    errors.admin_id = 'IDは1〜100文字で入力してください。';
  if (!password || new TextEncoder().encode(password).length > 72)
    errors.password = 'パスワードは1〜72バイトで入力してください。';
  return errors;
}
export function normalizeCode(input: string): string {
  return input.trim().replace(/[a-z]/g, (c) => c.toUpperCase());
}
export function validateCode(code: string): string {
  return !code || [...code].length > 64 || /[\s\p{Cc}]/u.test(code)
    ? '銘柄コードは空白・制御文字を含まない1〜64文字で入力してください。'
    : '';
}
export function validateThreshold(raw: string, values: number[]): string {
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 99)
    return '1〜99の整数を入力してください。';
  if (values.includes(Number(raw))) return 'この通知率は追加済みです。';
  return '';
}
