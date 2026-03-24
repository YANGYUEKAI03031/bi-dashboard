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

export interface MetricFilterRule {
  field: string;
  op: MetricFilterOp;
  /** 除 is_null / is_not_null 外使用 */
  value: string;
}

/** 指标筛选布尔表达式树（方案 A）：组内用 logic 连接子节点，可任意嵌套 */
export type MetricFilterExprNode =
  | { type: 'rule'; id: string; field: string; op: MetricFilterOp; value: string }
  | { type: 'group'; id: string; logic: 'and' | 'or'; children: MetricFilterExprNode[] };

function newMetricExprId(): string {
  return `mf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyMetricFilterRuleNode(): MetricFilterExprNode {
  return { type: 'rule', id: newMetricExprId(), field: '', op: 'eq', value: '' };
}

export function defaultMetricFilterExprRoot(): MetricFilterExprNode {
  return {
    type: 'group',
    id: newMetricExprId(),
    logic: 'and',
    children: [emptyMetricFilterRuleNode()],
  };
}

/** 为整棵树补齐 id（兼容服务端/旧数据无 id） */
export function ensureMetricFilterExprIds(node: MetricFilterExprNode): MetricFilterExprNode {
  if (node.type === 'rule') {
    return { ...node, id: node.id || newMetricExprId() };
  }
  return {
    ...node,
    id: node.id || newMetricExprId(),
    children: node.children.map(ensureMetricFilterExprIds),
  };
}

function parseExprNode(raw: unknown): MetricFilterExprNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const t = String(o.type || '').toLowerCase();
  if (t === 'rule') {
    const opRaw = String(o.op || 'eq').toLowerCase();
    const op = (ALLOWED_OPS.has(opRaw) ? opRaw : 'eq') as MetricFilterOp;
    return {
      type: 'rule',
      id: typeof o.id === 'string' && o.id ? o.id : newMetricExprId(),
      field: String(o.field ?? '').trim(),
      op,
      value: o.value != null ? String(o.value) : '',
    };
  }
  if (t === 'group' && Array.isArray(o.children)) {
    const children = (o.children as unknown[])
      .map(parseExprNode)
      .filter((c): c is MetricFilterExprNode => c != null);
    if (children.length === 0) return null;
    return {
      type: 'group',
      id: typeof o.id === 'string' && o.id ? o.id : newMetricExprId(),
      logic: String(o.logic || 'and').toLowerCase() === 'or' ? 'or' : 'and',
      children,
    };
  }
  return null;
}

/**
 * 解析 visualization_settings.metric_filter_expr；
 * 无效时返回 null（由调用方再尝试 legacy metric_filters）
 */
export function parseMetricFilterExpr(raw: unknown): MetricFilterExprNode | null {
  const n = parseExprNode(raw);
  if (!n || n.type !== 'group') return null;
  return ensureMetricFilterExprIds(n);
}

/** 由旧版平铺 metric_filters 生成一棵「根为且、子节点全为条件」的树 */
export function metricFilterExprFromLegacyRules(rules: MetricFilterRule[]): MetricFilterExprNode {
  const active = rules.filter((r) => (r.field || '').trim());
  if (active.length === 0) {
    return defaultMetricFilterExprRoot();
  }
  return ensureMetricFilterExprIds({
    type: 'group',
    id: newMetricExprId(),
    logic: 'and',
    children: active.map((r) => ({
      type: 'rule' as const,
      id: newMetricExprId(),
      field: r.field.trim(),
      op: r.op,
      value: r.value ?? '',
    })),
  });
}

/** 从表达式树收集所有条件行中出现的字段名（用于 SELECT 列） */
export function collectFieldsFromMetricFilterExpr(node: MetricFilterExprNode): string[] {
  const out: string[] = [];
  const walk = (n: MetricFilterExprNode) => {
    if (n.type === 'rule') {
      const f = (n.field || '').trim();
      if (f) out.push(f);
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

function ruleIsActiveForMatch(rule: MetricFilterRule): boolean {
  const f = (rule.field || '').trim();
  if (!f) return false;
  if (rule.op === 'is_null' || rule.op === 'is_not_null') return true;
  return true;
}

/** 单行是否满足表达式树 */
export function rowMatchesMetricFilterExpr(row: Record<string, unknown>, node: MetricFilterExprNode): boolean {
  if (node.type === 'rule') {
    if (!(node.field || '').trim()) return true;
    return metricRowMatchesRule(row, {
      field: node.field,
      op: node.op,
      value: node.value,
    });
  }
  const activeChildren = node.children.filter((c) => {
    if (c.type === 'rule') return ruleIsActiveForMatch({ field: c.field, op: c.op, value: c.value });
    return c.children.length > 0;
  });
  if (activeChildren.length === 0) return true;
  if (node.logic === 'or') {
    return activeChildren.some((c) => rowMatchesMetricFilterExpr(row, c));
  }
  return activeChildren.every((c) => rowMatchesMetricFilterExpr(row, c));
}

export function applyMetricFiltersExpr<T extends Record<string, unknown>>(
  rows: T[],
  root: MetricFilterExprNode | null | undefined,
): T[] {
  if (!Array.isArray(rows) || rows.length === 0 || !root) return rows || [];
  return rows.filter((row) => rowMatchesMetricFilterExpr(row as Record<string, unknown>, root));
}

export function updateMetricExprNode(
  root: MetricFilterExprNode,
  targetId: string,
  fn: (n: MetricFilterExprNode) => MetricFilterExprNode,
): MetricFilterExprNode {
  if (root.id === targetId) return fn(root);
  if (root.type === 'group') {
    return {
      ...root,
      children: root.children.map((c) => updateMetricExprNode(c, targetId, fn)),
    };
  }
  return root;
}

export function removeMetricExprNode(root: MetricFilterExprNode, targetId: string): MetricFilterExprNode {
  if (root.type === 'rule') return root;
  if (root.id === targetId) return root;

  const filtered = root.children
    .filter((c) => c.id !== targetId)
    .map((c) => (c.type === 'group' ? removeMetricExprNode(c, targetId) : c));

  let children = filtered;
  if (children.length === 0) {
    children = [emptyMetricFilterRuleNode()];
  }
  return { ...root, children };
}

export function addRuleToMetricExprGroup(root: MetricFilterExprNode, groupId: string): MetricFilterExprNode {
  if (root.type !== 'group') return root;
  if (root.id === groupId) {
    return { ...root, children: [...root.children, emptyMetricFilterRuleNode()] };
  }
  return {
    ...root,
    children: root.children.map((c) =>
      c.type === 'group' ? addRuleToMetricExprGroup(c, groupId) : c,
    ),
  };
}

export function addSubgroupToMetricExprGroup(root: MetricFilterExprNode, groupId: string): MetricFilterExprNode {
  const subgroup: MetricFilterExprNode = {
    type: 'group',
    id: newMetricExprId(),
    logic: 'or',
    children: [emptyMetricFilterRuleNode(), emptyMetricFilterRuleNode()],
  };
  if (root.type !== 'group') return root;
  if (root.id === groupId) {
    return { ...root, children: [...root.children, subgroup] };
  }
  return {
    ...root,
    children: root.children.map((c) =>
      c.type === 'group' ? addSubgroupToMetricExprGroup(c, groupId) : c,
    ),
  };
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
