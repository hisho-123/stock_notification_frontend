import { describe, expect, it } from 'vitest';
import { normalizeCode, validateCode, validateLogin, validateThreshold } from './validation';
import { formatDate, formatPrice } from './format';

describe('入力・表示仕様', () => {
  it('ID・パスワードの空白を保持し、文字数とUTF-8バイト数を検証する', () => {
    expect(validateLogin(' owner ', ' password ')).toEqual({});
    expect(validateLogin('😀'.repeat(100), 'あ'.repeat(24))).toEqual({});
    expect(validateLogin('😀'.repeat(101), 'あ'.repeat(25))).toHaveProperty('password');
    expect(validateLogin('', '')).toEqual(
      expect.objectContaining({ login_id: expect.any(String), password: expect.any(String) }),
    );
    expect(validateLogin('owner', 'x'.repeat(73))).toHaveProperty('password');
  });
  it('ASCII英字だけ大文字にし、内部空白・制御文字・64文字超を拒否する', () => {
    expect(normalizeCode(' aapl ')).toBe('AAPL');
    expect(normalizeCode(' ^Gspc ')).toBe('^GSPC');
    expect(normalizeCode('ß')).toBe('ß');
    for (const code of ['', 'A A', 'A\tB', 'A\u0085B', 'A'.repeat(65)])
      expect(validateCode(code)).not.toBe('');
    expect(validateCode('A'.repeat(64))).toBe('');
  });
  it('通知率は重複のない1〜99の整数とする', () => {
    for (const raw of ['', '0', '100', '1.5', '1e1', '-1', ' 10 ', 'NaN'])
      expect(validateThreshold(raw, [])).not.toBe('');
    expect(validateThreshold('10', [10])).toContain('追加済み');
    expect(validateThreshold('99', [])).toBe('');
    expect(validateThreshold('1', [])).toBe('');
  });
  it('価格を数値化せず有効桁を保持する', () => {
    expect(formatPrice('12345678901234567890.1234567890123456789')).toBe(
      '12,345,678,901,234,567,890.1234567890123456789',
    );
    expect(formatPrice('0.000000000000000001')).toBe('0.000000000000000001');
    expect(formatPrice('6000')).toBe('6,000');
  });
  it('UTCを日本時間に変換し、日付繰り上がりと0時を正しく表示する', () => {
    expect(formatDate('2026-10-07T22:00:00Z')).toBe('2026/10/08 07:00 JST');
    expect(formatDate('2026-10-07T15:00:00Z')).toBe('2026/10/08 00:00 JST');
  });
});
