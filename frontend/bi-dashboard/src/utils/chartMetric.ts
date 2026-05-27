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
  | 'is_not_null'
  /** 时间/日期字段：早于指定日（当日 0 点之前） */
  | 'date_before'
  /** 晚于指定日（当日结束后） */
  | 'date_after'
  /** 介于两日期之间（含起止日，value: YYYY-MM-DD|YYYY-MM-DD） */
  | 'date_between'
  | 'date_yesterday'
  | 'date_last_30_days'
  | 'date_this_month'
  | 'date_last_month';

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
  'date_before',
  'date_after',
  'date_between',
  'date_yesterday',
  'date_last_30_days',
  'date_this_month',
  'date_last_month',
]);

/** 指标筛选里字段的大类（由预览数据抽样推断） */
export type MetricFieldKind = 'string' | 'number' | 'date';

const DATE_METRIC_OPS = new Set<MetricFilterOp>([
  'date_before',
  'date_after',
  'date_between',
  'date_yesterday',
  'date_last_30_days',
  'date_this_month',
  'date_last_month',
]);

export function isDateMetricFilterOp(op: string): boolean {
  return DATE_METRIC_OPS.has(op as MetricFilterOp);
}

/** 早于/晚于/介于 需要填值；快捷区间不需要 */
export function metricDateOpNeedsValue(op: MetricFilterOp): boolean {
  return op === 'date_before' || op === 'date_after' || op === 'date_between';
}

export function inferMetricFieldTypesFromSampleRows(
  rows: Record<string, unknown>[],
  fieldNames: string[],
): Record<string, MetricFieldKind> {
  const out: Record<string, MetricFieldKind> = {};
  const sample = rows.slice(0, Math.min(80, rows.length));
  for (const f of fieldNames) {
    let dateLike = 0;
    let numLike = 0;
    let total = 0;
    for (const row of sample) {
      const v = row[f];
      if (v == null || v === '') continue;
      total++;
      if (typeof v === 'number' && Number.isFinite(v)) {
        numLike++;
        continue;
      }
      if (v instanceof Date && !Number.isNaN(v.getTime())) {
        dateLike++;
        continue;
      }
      if (typeof v === 'string') {
        const s = v.trim();
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
          const t = Date.parse(s.replace(/\//g, '-'));
          if (!Number.isNaN(t)) dateLike++;
        }
      }
    }
    if (total === 0) out[f] = 'string';
    else if (dateLike >= total * 0.65 && numLike < total * 0.35) out[f] = 'date';
    else if (numLike >= total * 0.85) out[f] = 'number';
    else out[f] = 'string';
  }
  return out;
}

export interface MetricFilterRule {
  field: string;
  op: MetricFilterOp;
  /** 除 is_null / is_not_null 外使用 */
  value: string;
}

/** 指标筛选布尔表达式树：组内相邻子节点之间各有一条运算符（betweenOps[i] 连接 children[i] 与 children[i+1]）；logic 保留作兼容与默认填充 */
export type MetricFilterExprNode =
  | { type: 'rule'; id: string; field: string; op: MetricFilterOp; value: string }
  | {
      type: 'group';
      id: string;
      logic: 'and' | 'or';
      children: MetricFilterExprNode[];
      betweenOps?: ('and' | 'or')[];
    };

/** 与 children 对齐的组内运算符数组，长度 = max(0, n-1) */
export function getNormalizedBetweenOps(group: Extract<MetricFilterExprNode, { type: 'group' }>): ('and' | 'or')[] {
  const n = group.children.length;
  const need = Math.max(0, n - 1);
  if (need === 0) return [];
  const fallback = group.logic === 'or' ? 'or' : 'and';
  const raw = Array.isArray(group.betweenOps) ? group.betweenOps : [];
  const out: ('and' | 'or')[] = [];
  for (let i = 0; i < need; i++) {
    out.push(raw[i] === 'or' ? 'or' : raw[i] === 'and' ? 'and' : fallback);
  }
  return out;
}

function withSyncedGroupLogic<T extends Extract<MetricFilterExprNode, { type: 'group' }>>(g: T): T {
  const ops = getNormalizedBetweenOps(g);
  const logic = (ops[0] ?? g.logic) === 'or' ? 'or' : 'and';
  return { ...g, betweenOps: ops, logic };
}

/** 子节点数量变化后，根据前后 id 序列调整 betweenOps */
export function adjustBetweenOpsAfterChildrenChange(
  prevChildren: { id: string }[],
  nextChildren: { id: string }[],
  prevBetween: ('and' | 'or')[] | undefined,
  logic: 'and' | 'or',
): ('and' | 'or')[] {
  const pn = prevChildren.length;
  const nn = nextChildren.length;
  const po = getNormalizedBetweenOps({
    type: 'group',
    id: '_',
    logic,
    children: prevChildren as MetricFilterExprNode[],
    betweenOps: prevBetween,
  });

  if (nn <= 1) return [];
  if (nn === pn) {
    return getNormalizedBetweenOps({
      type: 'group',
      id: '_',
      logic,
      children: nextChildren as MetricFilterExprNode[],
      betweenOps: po,
    });
  }

  if (nn === pn + 1) {
    const ins = findInsertIndexInNext(prevChildren, nextChildren);
    return rebuildOpsAfterInsert(po, ins, pn);
  }

  if (nn === pn - 1) {
    const rem = findRemovedChildIndex(prevChildren, nextChildren);
    return rebuildOpsAfterRemove(po, rem, pn);
  }

  return Array(nn - 1)
    .fill(null)
    .map(() => (logic === 'or' ? 'or' : 'and'));
}

function rebuildOpsAfterInsert(
  oldOps: ('and' | 'or')[],
  insertAt: number,
  oldLen: number,
  defaultOp: 'and' | 'or' = 'and',
): ('and' | 'or')[] {
  const newLen = oldLen + 1;
  const out: ('and' | 'or')[] = [];
  for (let k = 0; k < newLen - 1; k++) {
    if (insertAt === 0) {
      out.push(k === 0 ? defaultOp : oldOps[k - 1]);
    } else if (insertAt === oldLen) {
      out.push(k < oldLen - 1 ? oldOps[k] : defaultOp);
    } else {
      if (k < insertAt - 1) out.push(oldOps[k]);
      else if (k === insertAt - 1) out.push(defaultOp);
      else if (k === insertAt) out.push(oldOps[insertAt - 1]);
      else out.push(oldOps[k - 1]);
    }
  }
  return out;
}

function findInsertIndexInNext(prevChildren: { id: string }[], nextChildren: { id: string }[]): number {
  let j = 0;
  for (let i = 0; i < nextChildren.length; i++) {
    if (j >= prevChildren.length || nextChildren[i].id !== prevChildren[j].id) {
      return i;
    }
    j++;
  }
  return Math.max(0, nextChildren.length - 1);
}

function findRemovedChildIndex(prevChildren: { id: string }[], nextChildren: { id: string }[]): number {
  let j = 0;
  for (let i = 0; i < prevChildren.length; i++) {
    if (j < nextChildren.length && prevChildren[i].id === nextChildren[j].id) {
      j++;
    } else {
      return i;
    }
  }
  return prevChildren.length - 1;
}

function rebuildOpsAfterRemove(oldOps: ('and' | 'or')[], removeIdx: number, oldLen: number): ('and' | 'or')[] {
  const newLen = oldLen - 1;
  if (newLen <= 1) return [];
  const out: ('and' | 'or')[] = [];
  for (let k = 0; k < newLen - 1; k++) {
    if (removeIdx === 0) {
      out.push(oldOps[k + 1]);
    } else if (removeIdx === oldLen - 1) {
      out.push(oldOps[k]);
    } else {
      if (k < removeIdx - 1) out.push(oldOps[k]);
      else if (k === removeIdx - 1) out.push('and');
      else out.push(oldOps[k + 1]);
    }
  }
  return out;
}

function newMetricExprId(): string {
  return `mf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyMetricFilterRuleNode(): MetricFilterExprNode {
  return { type: 'rule', id: newMetricExprId(), field: '', op: 'eq', value: '' };
}

export function defaultMetricFilterExprRoot(): MetricFilterExprNode {
  return withSyncedGroupLogic({
    type: 'group',
    id: newMetricExprId(),
    logic: 'and',
    children: [emptyMetricFilterRuleNode()],
  });
}

/** 为整棵树补齐 id（兼容服务端/旧数据无 id） */
export function ensureMetricFilterExprIds(node: MetricFilterExprNode): MetricFilterExprNode {
  if (node.type === 'rule') {
    return { ...node, id: node.id || newMetricExprId() };
  }
  const mapped: Extract<MetricFilterExprNode, { type: 'group' }> = {
    ...node,
    id: node.id || newMetricExprId(),
    children: node.children.map(ensureMetricFilterExprIds),
  };
  return withSyncedGroupLogic(mapped);
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
    const children = (o.children as unknown[]).map(parseExprNode).filter((c): c is MetricFilterExprNode => c != null);
    if (children.length === 0) return null;
    let betweenOps: ('and' | 'or')[] | undefined;
    if (Array.isArray(o.betweenOps)) {
      betweenOps = (o.betweenOps as unknown[]).map((x) => (String(x).toLowerCase() === 'or' ? 'or' : 'and'));
    }
    return {
      type: 'group',
      id: typeof o.id === 'string' && o.id ? o.id : newMetricExprId(),
      logic: String(o.logic || 'and').toLowerCase() === 'or' ? 'or' : 'and',
      children,
      betweenOps,
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
  return ensureMetricFilterExprIds(
    withSyncedGroupLogic({
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
    }),
  );
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

function metricExprChildMatches(row: Record<string, unknown>, c: MetricFilterExprNode): boolean {
  if (c.type === 'rule') {
    if (!(c.field || '').trim()) return true;
    return metricRowMatchesRule(row, {
      field: c.field,
      op: c.op,
      value: c.value,
    });
  }
  if (c.children.length === 0) return true;
  return rowMatchesMetricFilterExpr(row, c);
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
  const ch = node.children;
  if (ch.length === 0) return true;
  const ops = getNormalizedBetweenOps(node);
  let acc = metricExprChildMatches(row, ch[0]);
  for (let i = 1; i < ch.length; i++) {
    const next = metricExprChildMatches(row, ch[i]);
    const op = ops[i - 1] ?? 'and';
    acc = op === 'and' ? acc && next : acc || next;
  }
  return acc;
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

function removeMetricExprNodeRec(
  node: MetricFilterExprNode,
  targetId: string,
  isDocumentRoot: boolean,
): MetricFilterExprNode {
  if (node.type === 'rule') return node;
  if (node.id === targetId) return node;

  const prevChildren = node.children;
  let children: MetricFilterExprNode[] = prevChildren
    .filter((c) => c.id !== targetId)
    .map((c) => (c.type === 'group' ? removeMetricExprNodeRec(c, targetId, false) : c))
    .filter((c) => (c.type === 'group' ? c.children.length > 0 : true));

  let betweenOps = adjustBetweenOpsAfterChildrenChange(prevChildren, children, node.betweenOps, node.logic);

  if (children.length === 0) {
    if (isDocumentRoot) {
      children = [emptyMetricFilterRuleNode()];
      betweenOps = [];
    } else {
      return { ...node, children: [], betweenOps: [] };
    }
  }

  return withSyncedGroupLogic({ ...node, children, betweenOps });
}

/** 删除节点；嵌套分组若删至无子节点会从父级自动移除（根分组始终保留至少一条空条件） */
export function removeMetricExprNode(root: MetricFilterExprNode, targetId: string): MetricFilterExprNode {
  return removeMetricExprNodeRec(root, targetId, true);
}

/** 将指定条件替换为子分组：原条件作为子分组首条，并追加一条空条件（与行末「+」添加分组一致） */
export function wrapRuleInNewSubgroup(
  root: MetricFilterExprNode,
  parentGroupId: string,
  ruleId: string,
): MetricFilterExprNode {
  if (root.type !== 'group') return root;
  if (root.id === parentGroupId) {
    const idx = root.children.findIndex((c) => c.id === ruleId);
    if (idx < 0) return root;
    const rule = root.children[idx];
    if (!rule || rule.type !== 'rule') return root;
    const subgroup = withSyncedGroupLogic({
      type: 'group',
      id: newMetricExprId(),
      logic: 'or',
      betweenOps: ['or'],
      children: [rule, emptyMetricFilterRuleNode()],
    });
    const next = [...root.children];
    next.splice(idx, 1, subgroup);
    return withSyncedGroupLogic({ ...root, children: next });
  }
  return {
    ...root,
    children: root.children.map((c) => (c.type === 'group' ? wrapRuleInNewSubgroup(c, parentGroupId, ruleId) : c)),
  };
}

export function addRuleToMetricExprGroup(root: MetricFilterExprNode, groupId: string): MetricFilterExprNode {
  if (root.type !== 'group') return root;
  if (root.id === groupId) {
    const prev = root.children;
    const next = [...prev, emptyMetricFilterRuleNode()];
    const betweenOps = adjustBetweenOpsAfterChildrenChange(prev, next, root.betweenOps, root.logic);
    return withSyncedGroupLogic({ ...root, children: next, betweenOps });
  }
  return {
    ...root,
    children: root.children.map((c) => (c.type === 'group' ? addRuleToMetricExprGroup(c, groupId) : c)),
  };
}

export function addSubgroupToMetricExprGroup(root: MetricFilterExprNode, groupId: string): MetricFilterExprNode {
  const subgroup = withSyncedGroupLogic({
    type: 'group',
    id: newMetricExprId(),
    logic: 'or',
    betweenOps: ['or'],
    children: [emptyMetricFilterRuleNode(), emptyMetricFilterRuleNode()],
  });
  if (root.type !== 'group') return root;
  if (root.id === groupId) {
    const prev = root.children;
    const next = [...prev, subgroup];
    const betweenOps = adjustBetweenOpsAfterChildrenChange(prev, next, root.betweenOps, root.logic);
    return withSyncedGroupLogic({ ...root, children: next, betweenOps });
  }
  return {
    ...root,
    children: root.children.map((c) => (c.type === 'group' ? addSubgroupToMetricExprGroup(c, groupId) : c)),
  };
}

/** 在指定父分组中，将新节点插到某子节点之后（用于「条件后添加分组」等） */
export function insertMetricExprChildAfter(
  root: MetricFilterExprNode,
  parentGroupId: string,
  afterChildId: string,
  newChild: MetricFilterExprNode,
): MetricFilterExprNode {
  if (root.type !== 'group') return root;
  if (root.id === parentGroupId) {
    const idx = root.children.findIndex((c) => c.id === afterChildId);
    if (idx < 0) return root;
    const prev = root.children;
    const next = [...prev.slice(0, idx + 1), newChild, ...prev.slice(idx + 1)];
    const betweenOps = adjustBetweenOpsAfterChildrenChange(prev, next, root.betweenOps, root.logic);
    return withSyncedGroupLogic({ ...root, children: next, betweenOps });
  }
  return {
    ...root,
    children: root.children.map((c) =>
      c.type === 'group' ? insertMetricExprChildAfter(c, parentGroupId, afterChildId, newChild) : c,
    ),
  };
}

/** 新建空子分组（组内默认「或」，内含一条空条件） */
export function newEmptyMetricSubgroup(): MetricFilterExprNode {
  return withSyncedGroupLogic({
    type: 'group',
    id: newMetricExprId(),
    logic: 'or',
    children: [emptyMetricFilterRuleNode()],
  });
}

/** 切换某组内第 gapIndex 条连接（children[gapIndex] 与 children[gapIndex+1] 之间）的 且/或 */
export function toggleMetricGroupBetweenOp(
  root: MetricFilterExprNode,
  groupId: string,
  gapIndex: number,
): MetricFilterExprNode {
  return updateMetricExprNode(root, groupId, (n) => {
    if (n.type !== 'group') return n;
    const ops = [...getNormalizedBetweenOps(n)];
    if (gapIndex < 0 || gapIndex >= ops.length) return n;
    ops[gapIndex] = ops[gapIndex] === 'and' ? 'or' : 'and';
    return withSyncedGroupLogic({ ...n, betweenOps: ops });
  });
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

/** 识别为日期/时间列时使用的操作符（预览与聚合前筛选） */
export const METRIC_FILTER_DATE_OP_OPTIONS: { value: MetricFilterOp; label: string }[] = [
  { value: 'date_before', label: '早于' },
  { value: 'date_after', label: '晚于' },
  { value: 'date_between', label: '介于' },
  { value: 'date_yesterday', label: '昨日' },
  { value: 'date_last_30_days', label: '近30天' },
  { value: 'date_this_month', label: '本月' },
  { value: 'date_last_month', label: '上月' },
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

/** 单元格解析为时间戳（毫秒），用于日期类筛选 */
function cellToTimeMs(raw: unknown, cellStr: string): number | null {
  if (raw === null || raw === undefined || cellStr === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const t = Date.parse(String(cellStr).trim().replace(/\//g, '-'));
  return Number.isNaN(t) ? null : t;
}

/** 取某日 local 起点；end=true 为当日 23:59:59.999 */
function parseDayBoundaryMs(s: string, end: boolean): number | null {
  const head = String(s).trim().split(/[T\s]/)[0];
  const m = head.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const da = Number(m[3]);
    const d = new Date(y, mo, da, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    return d.getTime();
  }
  const t = Date.parse(String(s).trim().replace(/\//g, '-'));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  if (end) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.getTime();
}

function presetLocalRangeMs(kind: 'yesterday' | 'last_30' | 'this_month' | 'last_month'): [number, number] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (kind === 'yesterday') {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return [start.getTime(), end.getTime()];
  }
  if (kind === 'last_30') {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 29);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return [start.getTime(), end.getTime()];
  }
  if (kind === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return [start.getTime(), end.getTime()];
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return [start.getTime(), end.getTime()];
}

function inTimeRange(ts: number, lo: number, hi: number): boolean {
  return ts >= lo && ts <= hi;
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

  if (DATE_METRIC_OPS.has(op)) {
    const ts = cellToTimeMs(raw, cell);
    if (ts === null) return false;
    switch (op) {
      case 'date_before': {
        const b = parseDayBoundaryMs(expected, false);
        if (b === null) return false;
        return ts < b;
      }
      case 'date_after': {
        const b = parseDayBoundaryMs(expected, true);
        if (b === null) return false;
        return ts > b;
      }
      case 'date_between': {
        const parts = expected
          .split(/[|,]/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (parts.length < 2) return false;
        const lo = parseDayBoundaryMs(parts[0], false);
        const hi = parseDayBoundaryMs(parts[1], true);
        if (lo === null || hi === null) return false;
        return inTimeRange(ts, lo, hi);
      }
      case 'date_yesterday': {
        const [lo, hi] = presetLocalRangeMs('yesterday');
        return inTimeRange(ts, lo, hi);
      }
      case 'date_last_30_days': {
        const [lo, hi] = presetLocalRangeMs('last_30');
        return inTimeRange(ts, lo, hi);
      }
      case 'date_this_month': {
        const [lo, hi] = presetLocalRangeMs('this_month');
        return inTimeRange(ts, lo, hi);
      }
      case 'date_last_month': {
        const [lo, hi] = presetLocalRangeMs('last_month');
        return inTimeRange(ts, lo, hi);
      }
      default:
        return true;
    }
  }

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

  const nums = rows.map((r) => parseNumericCell((r as any)[valueField])).filter((n): n is number => n !== null);

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
