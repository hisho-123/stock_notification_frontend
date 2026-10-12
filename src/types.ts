// 正本: stock_notification_docs/api/openapi.yaml。ID・価格を数値へ変換しない。
export interface Session {
  admin_id: string;
  expires_at: string;
  csrf_token: string;
}

export type AssetErrorCode = 'PRICE_FETCH_FAILED' | 'NOTIFICATION_FAILED' | 'PRICE_DATA_STALE';
export interface Asset {
  id: string;
  code: string;
  name: string;
  highest_value: string;
  latest_value: string;
  decline_rate: string;
  latest_fetched_at: string;
  monitoring_enabled: boolean;
  last_notified_threshold: number | null;
  last_checked_at: string;
  last_error_code: AssetErrorCode | null;
  created_at: string;
  updated_at: string;
}
export interface AssetList {
  items: Asset[];
  total: number;
}
export interface NotificationSettings {
  thresholds: number[];
  updated_at: string;
}
export interface ErrorResponse {
  error: { code: string; message: string; fields: Record<string, string> };
}
export const sortOptions = [
  ['created_at', '登録順'],
  ['code', 'コード'],
  ['name', '名称'],
  ['highest_value', '最高値'],
  ['latest_value', '最終取得値'],
  ['decline_rate', '下落率'],
  ['latest_fetched_at', '取得日時'],
  ['monitoring_enabled', '監視状態'],
  ['last_notified_threshold', '通知済み率'],
] as const;
export type Sort = (typeof sortOptions)[number][0];
export interface ListOptions {
  q: string;
  sort: Sort;
  order: 'asc' | 'desc';
}
