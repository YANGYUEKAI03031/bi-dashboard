/**
 * 指标卡：在构建器内配置的固定筛选条件上，对数值列做聚合（不依赖仪表盘筛选器）
 */

export type MetricFilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_null'
  | 'is_not_null';

export interface MetricFilterRule {
  field: string;
  op: MetricFilterOp;
  /** 除 is_null / is_not_null 外使用 */
  value: string;
}

export const METRIC_FILTER_OP_OPTIONS: { value: MetricFilterOp; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'starts_with', label: '开头是' },
  { value: 'ends_with', label: '结尾是' },
  { value: 'is_null', label: '为空' },
  { value: 'is_not_null', label: '不为空' },
];

export function parseNumericCell(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowCellString(row: Record<string, unknown>, field: string): string {
  const v = row[field];
  if (v == null) return '';
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim();
}

function compareAsNumberOrString(a: string, b: string): number {
  const na = Number(a.replace(/,/g, ''));
  const nb = Number(b.replace(/,/g, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== '' && b.trim() !== '') {
    return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

/** 单行是否满足一条规则 */
export function metricRowMatchesRule(row: Record<string, unknown>, rule: MetricFilterRule): boolean {
  const field = (rule.field || '').trim();
  if (!field) return true;
  const op = rule.op || 'eq';
  const raw = row[field];
  const cell = rowCellString(row, field);

  if (op === 'is_null') {
    return raw === null || raw === undefined || cell === '';
  }
  if (op === 'is_not_null') {
    return !(raw === null || raw === undefined || cell === '');
  }

  const expected = String(rule.value ?? '').trim();
  switch (op) {
    case 'eq':
      return cell === expected;
    case 'neq':
      return cell !== expected;
    case 'gt':
      return compareAsNumberOrString(cell, expected) > 0;
    case 'gte':
      return compareAsNumberOrString(cell, expected) >= 0;
    case 'lt':
      return compareAsNumberOrString(cell, expected) < 0;
    case 'lte':
      return compareAsNumberOrString(cell, expected) <= 0;
    case 'contains':
      return cell.includes(expected);
    case 'not_contains':
      return !cell.includes(expected);
    case 'starts_with':
      return cell.startsWith(expected);
    case 'ends_with':
      return cell.endsWith(expected);
    default:
      return true;
  }
}

/** 应用全部指标筛选规则（AND） */
export function applyMetricFilters<T extends Record<string, unknown>>(
  rows: T[],
  rules: MetricFilterRule[] | undefined | null,
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const list = Array.isArray(rules) ? rules : [];
  const active = list.filter((r) => {
    const f = (r?.field || '').trim();
    if (!f) return false;
    if (r.op === 'is_null' || r.op === 'is_not_null') return true;
    return true;
  });
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((rule) => metricRowMatchesRule(row as Record<string, unknown>, rule)));
}

/**
 * 对已筛选的行集，对 valueField 做聚合
 */
export function computeMetricValue(rows: any[], valueField: string, agg: string): number | null {
  if (!valueField || !Array.isArray(rows) || rows.length === 0) return null;

  const nums = rows
    .map((r) => parseNumericCell((r as any)[valueField]))
    .filter((n): n is number => n !== null);

  switch ((agg || 'sum').toLowerCase()) {
    case 'count':
      return rows.length;
    case 'sum':
      return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'first':
      return parseNumericCell((rows[0] as any)[valueField]);
    default:
      return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
}

export function formatMetricNumber(value: number | null, decimals: number): string {
  if (value === null || Number.isNaN(value)) return '—';
  const d = Math.max(0, Math.min(10, Math.floor(decimals)));
  return Number(value).toFixed(d);
}

const ALLOWED_OPS = new Set<string>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_null',
  'is_not_null',
]);

export function normalizeMetricFilterRules(raw: unknown): MetricFilterRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any) => {
    const opRaw = String(x?.op || 'eq').toLowerCase();
    const op = (ALLOWED_OPS.has(opRaw) ? opRaw : 'eq') as MetricFilterOp;
    return {
      field: String(x?.field ?? '').trim(),
      op,
      value: x?.value != null ? String(x.value) : '',
    };
  });
}

/** 兼容旧版 metric_mode=cell + 单列筛选 */
export function getEffectiveMetricFilterRules(viz: {
  metric_filters?: unknown;
  metric_mode?: string;
  metric_filter_field?: string;
  metric_filter_value?: string;
}): MetricFilterRule[] {
  const normalized = normalizeMetricFilterRules(viz?.metric_filters).filter((r) => r.field);
  if (normalized.length > 0) return normalized;
  if (viz?.metric_mode === 'cell' && String(viz.metric_filter_field || '').trim()) {
    return [
      {
        field: String(viz.metric_filter_field).trim(),
        op: 'eq',
        value: viz.metric_filter_value != null ? String(viz.metric_filter_value) : '',
      },
    ];
  }
  return [];
}
