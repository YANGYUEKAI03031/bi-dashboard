import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Input, DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import './MetricFilterExprEditor.css';
import {
  METRIC_FILTER_OP_OPTIONS,
  METRIC_FILTER_DATE_OP_OPTIONS,
  type MetricFilterExprNode,
  type MetricFilterOp,
  type MetricFieldKind,
  updateMetricExprNode,
  removeMetricExprNode,
  addRuleToMetricExprGroup,
  insertMetricExprChildAfter,
  wrapRuleInNewSubgroup,
  getNormalizedBetweenOps,
  toggleMetricGroupBetweenOp,
  emptyMetricFilterRuleNode,
  metricDateOpNeedsValue,
  isDateMetricFilterOp,
} from '../../utils/chartMetric';

const { Option } = Select;

const EMPTY_FIELD_TYPES: Record<string, MetricFieldKind> = {};

const MAX_DEPTH = 10;

/** 相邻两行之间竖向弧：向左鼓出（数值越小弧线越贴近竖直） */
const SPINE_BULGE_MIN = 26;
const SPINE_BULGE_MAX = 62;
/**
 * 弧线最左缘与轨道列左边缘的留白（不要紧贴在分组边框内侧，略留 1～2mm 隙）
 * 二次贝塞尔在 t=0.5 附近最靠左，x ≈ LINE_X - bulge/2；取 LINE_X = INSET + maxBulge/2 可在最大弧深时仍保留约 INSET。
 */
const SPINE_EDGE_INSET = 12;
/** 端点圆点所在 x；「且/或」贴在弧线几何最左点 (LINE_X + midX) / 2 */
const SPINE_LINE_X = SPINE_EDGE_INSET + Math.ceil(SPINE_BULGE_MAX / 2);
/** 轨道列宽（弧线向左鼓出依赖 svg overflow:visible，列宽只需盖住圆点与右侧微隙） */
const CONNECTOR_LAYER_W = SPINE_LINE_X + 14;

/** 嵌套分组框：边框与阴影用浅蓝，避免主色 #1677ff 过艳 */
const NESTED_GROUP_BORDER = '#c5d9f0';
const NESTED_GROUP_SHADOW =
  '0 2px 8px rgba(90, 130, 180, 0.08), 0 1px 2px rgba(90, 130, 180, 0.05)';

/** 根分组外框（略浅于纯灰边） */
const ROOT_GROUP_BORDER = '#e3e6eb';
const ROOT_GROUP_SHADOW = '0 2px 8px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.04)';

const strokeForOp = (op: 'and' | 'or') => (op === 'and' ? '#1677ff' : '#fa8c16');

/** 左侧轨道：相邻条件之间弧线 + 端点圆点，弧向左鼓出，「且/或」贴在弧顶点附近 */
const GroupConnectorSvg: React.FC<{
  containerRef: React.RefObject<HTMLDivElement | null>;
  childIds: string[];
  rowElMap: React.MutableRefObject<Map<string, HTMLDivElement>>;
  betweenOps: ('and' | 'or')[];
  disabled?: boolean;
  onToggleBetween: (gapIndex: number) => void;
}> = ({ containerRef, childIds, rowElMap, betweenOps, disabled, onToggleBetween }) => {
  const childIdsKey = childIds.join('|');
  const [layout, setLayout] = useState<{ h: number; ys: number[] } | null>(null);

  const measure = useMemo(
    () => () => {
      const box = containerRef.current;
      if (!box || childIds.length === 0) {
        setLayout(null);
        return;
      }
      const boxRect = box.getBoundingClientRect();
      const ys: number[] = [];
      for (const id of childIds) {
        const el = rowElMap.current.get(id);
        if (!el) {
          setLayout(null);
          return;
        }
        const r = el.getBoundingClientRect();
        ys.push(r.top + r.height / 2 - boxRect.top);
      }
      if (ys.length !== childIds.length) {
        setLayout(null);
        return;
      }
      setLayout({ h: Math.max(boxRect.height, 1), ys });
    },
    [childIds, containerRef, rowElMap],
  );

  useLayoutEffect(() => {
    measure();
    const id = requestAnimationFrame(() => measure());
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(id);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [measure, containerRef, childIdsKey]);

  if (!layout || layout.ys.length === 0) return null;

  const { h, ys } = layout;
  const n = ys.length;

  const LINE_X = SPINE_LINE_X;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: CONNECTOR_LAYER_W,
        height: h,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        width={CONNECTOR_LAYER_W}
        height={h}
        style={{ display: 'block', overflow: 'visible' }}
        aria-hidden
      >
        {/* 相邻条件：单段二次贝塞尔，左凸平滑圆弧（无中间拐点）；颜色随且/或 */}
        {n >= 2
          ? Array.from({ length: n - 1 }, (_, k) => {
              const y0 = ys[k];
              const y1 = ys[k + 1];
              const dy = y1 - y0;
              const op = betweenOps[k] ?? 'and';
              const stroke = strokeForOp(op);
              const bulge = Math.min(
                SPINE_BULGE_MAX,
                Math.max(SPINE_BULGE_MIN, Math.abs(dy) * 0.26 + 5),
              );
              // 控制点向左鼓出
              const midX = LINE_X - bulge;
              const midY = (y0 + y1) / 2;
              const dArc = `M ${LINE_X} ${y0} Q ${midX} ${midY} ${LINE_X} ${y1}`;
              return (
                <g key={`spine_${childIds[k]}_${childIds[k + 1]}`}>
                  <path
                    d={dArc}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={LINE_X} cy={y0} r={3.5} fill={stroke} />
                  <circle cx={LINE_X} cy={y1} r={3.5} fill={stroke} />
                </g>
              );
            })
          : null}
        {/* 仅一条条件时无竖弧，仍保留与行对齐的端点圆点 */}
        {n === 1 && ys[0] !== undefined ? (
          <circle cx={LINE_X} cy={ys[0]} r={3.5} fill="#1677ff" />
        ) : null}
      </svg>
      {n >= 2
        ? Array.from({ length: n - 1 }, (_, k) => {
            const op = betweenOps[k] ?? 'and';
            const y0 = ys[k];
            const y1 = ys[k + 1];
            const dy = y1 - y0;
            const midY = (y0 + y1) / 2;
            const bg = strokeForOp(op);
            const bulge = Math.min(
              SPINE_BULGE_MAX,
              Math.max(SPINE_BULGE_MIN, Math.abs(dy) * 0.26 + 5),
            );
            const midX = LINE_X - bulge;
            const badgeX = (LINE_X + midX) / 2;
            return (
              <button
                key={`op_${childIds[k]}_${k}`}
                type="button"
                className="metric-filter-op-toggle"
                disabled={disabled}
                aria-label={op === 'and' ? '当前为且，点击切换为或' : '当前为或，点击切换为且'}
                title={op === 'and' ? '点击切换为「或」' : '点击切换为「且」'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!disabled) onToggleBetween(k);
                }}
                style={{
                  position: 'absolute',
                  left: badgeX,
                  top: midY,
                  transform: 'translate(-50%, -50%)',
                  margin: 0,
                  background: bg,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  pointerEvents: 'auto',
                  opacity: disabled ? 0.55 : 1,
                  zIndex: 2,
                }}
              >
                {op === 'and' ? '且' : '或'}
              </button>
            );
          })
        : null}
    </div>
  );
};

const RuleRow: React.FC<{
  root: MetricFilterExprNode;
  /** 包含该条件的直接父分组（嵌套时不能用 root.children 查找） */
  parentGroup: Extract<MetricFilterExprNode, { type: 'group' }>;
  childId: string;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  fieldTypes: Record<string, MetricFieldKind>;
  disabled?: boolean;
  canNest: boolean;
}> = ({ root, parentGroup, childId, onChange, availableFields, fieldTypes, disabled, canNest }) => {
  const child = parentGroup.children.find((c) => c.id === childId);

  // 先获取 child 引用（不返回），在 hooks 之后统一判断
  const childExists = child && child.type === 'rule';

  const [actionsVisible, setActionsVisible] = useState(false);
  const hideActionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showActions = () => {
    if (hideActionsTimeoutRef.current) {
      clearTimeout(hideActionsTimeoutRef.current);
      hideActionsTimeoutRef.current = null;
    }
    setActionsVisible(true);
  };

  const hideActionsDelayed = () => {
    hideActionsTimeoutRef.current = setTimeout(() => {
      setActionsVisible(false);
    }, 150);
  };

  const cancelHideActions = () => {
    if (hideActionsTimeoutRef.current) {
      clearTimeout(hideActionsTimeoutRef.current);
      hideActionsTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (hideActionsTimeoutRef.current) {
        clearTimeout(hideActionsTimeoutRef.current);
      }
    };
  }, []);

  // 预览数据加载后若字段被识别为日期列，把旧的通用操作符纠成日期语义（避免下拉无选中项）
  useEffect(() => {
    if (!child || child.type !== 'rule') return;
    const rule = child; // TypeScript now knows this is a MetricFilterRuleNode
    const field = rule.field;
    const op = rule.op;
    const fk = field ? fieldTypes[field] ?? 'string' : 'string';
    if (fk === 'date' && !isDateMetricFilterOp(op)) {
      onChange(
        updateMetricExprNode(root, childId, (n) =>
          n.type === 'rule' ? { ...n, op: 'date_last_30_days', value: '' } : n,
        ),
      );
      return;
    }
    if (fk !== 'date' && field && isDateMetricFilterOp(op)) {
      onChange(
        updateMetricExprNode(root, childId, (n) =>
          n.type === 'rule' ? { ...n, op: 'eq', value: n.value } : n,
        ),
      );
    }
    // 用 id/field/op 表征规则语义，避免 child 引用抖动
  }, [child?.id, (child as any)?.field, (child as any)?.op, fieldTypes, root, childId, onChange]);

  if (!childExists) return null;

  const fieldKind: MetricFieldKind = child.field
    ? fieldTypes[child.field] ?? 'string'
    : 'string';
  const isDateField = fieldKind === 'date';
  const opOptions = isDateField ? METRIC_FILTER_DATE_OP_OPTIONS : METRIC_FILTER_OP_OPTIONS;
  const opSelectWidth = isDateField ? 148 : 122;

  const renderValueControl = () => {
    if (child.op === 'is_null' || child.op === 'is_not_null') {
      return (
        <span
          className="metric-rule-null-row"
          style={{
            color: '#bfbfbf',
            fontSize: 13,
            flex: '1.25 1 180px',
            minWidth: 140,
            minHeight: 42,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 4,
          }}
        >
          —
        </span>
      );
    }

    if (isDateField && !metricDateOpNeedsValue(child.op)) {
      return (
        <span
          className="metric-rule-null-row"
          style={{
            color: '#bfbfbf',
            fontSize: 13,
            flex: '1.25 1 180px',
            minWidth: 140,
            minHeight: 42,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 4,
          }}
        >
          按当前时间自动计算区间
        </span>
      );
    }

    if (isDateField && child.op === 'date_between') {
      const parts = child.value
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const rangeVal: [Dayjs, Dayjs] | null =
        parts.length >= 2 && dayjs(parts[0]).isValid() && dayjs(parts[1]).isValid()
          ? [dayjs(parts[0]), dayjs(parts[1])]
          : null;
      return (
        <DatePicker.RangePicker
          size="large"
          allowClear
          className="metric-filter-rule-input"
          style={{ flex: '1.25 1 220px', minWidth: 200, width: '100%' }}
          disabled={disabled}
          value={rangeVal}
          onChange={(dates) => {
            if (!dates || !dates[0] || !dates[1]) {
              onChange(
                updateMetricExprNode(root, childId, (n) =>
                  n.type === 'rule' ? { ...n, value: '' } : n,
                ),
              );
            } else {
              onChange(
                updateMetricExprNode(root, childId, (n) =>
                  n.type === 'rule'
                    ? {
                        ...n,
                        value: `${dates[0]!.format('YYYY-MM-DD')}|${dates[1]!.format('YYYY-MM-DD')}`,
                      }
                    : n,
                ),
              );
            }
          }}
        />
      );
    }

    if (isDateField && (child.op === 'date_before' || child.op === 'date_after')) {
      const d = child.value.trim() ? dayjs(child.value.trim().split(/[|,]/)[0]) : null;
      return (
        <DatePicker
          size="large"
          allowClear
          className="metric-filter-rule-input"
          style={{ flex: '1.25 1 180px', minWidth: 140, width: '100%' }}
          disabled={disabled}
          value={d && d.isValid() ? d : null}
          onChange={(d2: Dayjs | null) =>
            onChange(
              updateMetricExprNode(root, childId, (n) =>
                n.type === 'rule' ? { ...n, value: d2 ? d2.format('YYYY-MM-DD') : '' } : n,
              ),
            )
          }
        />
      );
    }

    return (
      <div className="metric-value-wrapper">
        <Input
          size="large"
          value={child.value}
          placeholder="值"
          className="metric-filter-rule-input"
          style={{ flex: '1.25 1 180px', minWidth: 140, width: '100%' }}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              updateMetricExprNode(root, childId, (n) =>
                n.type === 'rule' ? { ...n, value: e.target.value } : n,
              ),
            )
          }
        />
      </div>
    );
  };

  return (
    <div
      className="metric-rule-hover-row"
      onMouseEnter={showActions}
      onMouseLeave={hideActionsDelayed}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
      }}
    >
      <div
        className="metric-rule-inputs"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          flex: 1,
          minWidth: 0,
          width: '100%',
        }}
      >
        <Select
          size="large"
          value={child.field || undefined}
          placeholder="字段"
          allowClear
          showSearch
          className="metric-filter-rule-select"
          style={{ flex: '1 1 160px', minWidth: 120, maxWidth: '100%' }}
          disabled={disabled || availableFields.length === 0}
          onChange={(v) => {
            const nextField = v || '';
            const nextKind: MetricFieldKind = nextField
              ? fieldTypes[nextField] ?? 'string'
              : 'string';
            onChange(
              updateMetricExprNode(root, childId, (n) => {
                if (n.type !== 'rule') return n;
                let op = n.op;
                let value = n.value;
                if (nextKind === 'date') {
                  if (!isDateMetricFilterOp(op)) {
                    op = 'date_last_30_days';
                    value = '';
                  }
                } else if (isDateMetricFilterOp(op)) {
                  op = 'eq';
                  value = '';
                }
                return { ...n, field: nextField, op, value };
              }),
            );
          }}
        >
          {availableFields.map((f) => (
            <Option key={f} value={f}>
              {f}
            </Option>
          ))}
        </Select>

        <Select
          size="large"
          value={child.op}
          className="metric-filter-rule-select metric-filter-rule-select-op"
          style={{ flex: '0 0 auto', width: opSelectWidth, minWidth: opSelectWidth - 10 }}
          disabled={disabled}
          onChange={(v) => {
            const nextOp = v as MetricFilterOp;
            onChange(
              updateMetricExprNode(root, childId, (n) => {
                if (n.type !== 'rule') return n;
                let value = n.value;
                if (isDateField && metricDateOpNeedsValue(nextOp) !== metricDateOpNeedsValue(n.op)) {
                  value = '';
                }
                if (isDateField && nextOp === 'date_between' && !value.includes('|') && !value.includes(',')) {
                  value = '';
                }
                return { ...n, op: nextOp, value };
              }),
            );
          }}
        >
          {opOptions.map((o) => (
            <Option key={o.value} value={o.value}>
              {o.label}
            </Option>
          ))}
        </Select>

        {renderValueControl()}

        <div
          className={`metric-rule-actions-right ${actionsVisible ? 'visible' : ''}`}
          onMouseEnter={cancelHideActions}
          onMouseLeave={hideActionsDelayed}
        >
          <Button
            type="text"
            size="middle"
            danger
            disabled={disabled}
            icon={<CloseOutlined />}
            onClick={() => onChange(removeMetricExprNode(root, childId))}
            style={{ padding: '0 6px', flexShrink: 0, height: 36 }}
          />
          {canNest ? (
            <Button
              type="default"
              size="middle"
              shape="circle"
              icon={<PlusOutlined style={{ fontSize: 14 }} />}
              disabled={disabled}
              title="添加子分组（当前条件并入组内）"
              onClick={() => onChange(wrapRuleInNewSubgroup(root, parentGroup.id, childId))}
              style={{ width: 36, height: 36, minWidth: 36, padding: 0 }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

const GroupBlock: React.FC<{
  root: MetricFilterExprNode;
  node: Extract<MetricFilterExprNode, { type: 'group' }>;
  depth: number;
  isRoot: boolean;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  fieldTypes: Record<string, MetricFieldKind>;
  disabled?: boolean;
}> = ({ root, node, depth, isRoot, onChange, availableFields, fieldTypes, disabled }) => {
  const canNest = depth < MAX_DEPTH;
  const isNested = depth > 0;
  const children = node.children;

  const containerRef = useRef<HTMLDivElement>(null);
  const rowElMap = useRef<Map<string, HTMLDivElement>>(new Map());

  const [hoveredChildId, setHoveredChildId] = useState<string | null>(null);
  const lastMouseTime = useRef(0);
  const showAddTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideAddTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChildMouseEnter = (childId: string) => {
    const now = Date.now();
    const timeSinceLastMove = now - lastMouseTime.current;
    if (timeSinceLastMove < 100) {
      return;
    }
    if (hideAddTimeoutRef.current) {
      clearTimeout(hideAddTimeoutRef.current);
      hideAddTimeoutRef.current = null;
    }
    setHoveredChildId(childId);
  };

  const handleChildMouseLeave = () => {
    if (showAddTimeoutRef.current) {
      clearTimeout(showAddTimeoutRef.current);
      showAddTimeoutRef.current = null;
    }
    hideAddTimeoutRef.current = setTimeout(() => {
      setHoveredChildId(null);
    }, 200);
  };

  const handleChildMouseMove = (e: React.MouseEvent, childId: string) => {
    lastMouseTime.current = Date.now();
    if (showAddTimeoutRef.current) {
      clearTimeout(showAddTimeoutRef.current);
      showAddTimeoutRef.current = null;
    }
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    // 只在左侧40%以内时才显示添加按钮
    const showThreshold = rect.width * 0.4;
    if (relativeX < showThreshold) {
      if (hoveredChildId !== childId) {
        showAddTimeoutRef.current = setTimeout(() => {
          setHoveredChildId(childId);
        }, 80);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (showAddTimeoutRef.current) clearTimeout(showAddTimeoutRef.current);
      if (hideAddTimeoutRef.current) clearTimeout(hideAddTimeoutRef.current);
    };
  }, []);

  const setRowRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) rowElMap.current.set(id, el);
    else rowElMap.current.delete(id);
  };

  const childIds = children.map((c) => c.id);
  const betweenOps = getNormalizedBetweenOps(node);

  return (
    <div
      style={{
        position: 'relative',
        marginLeft: isNested ? 0 : 0,
        marginTop: isNested ? 0 : 0,
      }}
    >
      <div
        style={{
          border: isNested ? `2px solid ${NESTED_GROUP_BORDER}` : `2px solid ${ROOT_GROUP_BORDER}`,
          borderRadius: 8,
          background: isNested ? 'transparent' : '#fafafa',
          padding: isNested ? '12px 14px 14px 4px' : '12px 14px 14px 10px',
          minHeight: 48,
          position: 'relative',
          boxShadow: isNested ? NESTED_GROUP_SHADOW : ROOT_GROUP_SHADOW,
        }}
      >
        {/* 子分组左侧接线点（与父组曲线对齐的视觉上锚点） */}
        {isNested && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: -4,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: NESTED_GROUP_BORDER,
              zIndex: 1,
            }}
          />
        )}

        {children.length > 0 ? (
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'stretch',
              minHeight: 24,
              paddingLeft: isNested ? 2 : 0,
              overflow: 'visible',
            }}
          >
            <div
              style={{
                width: CONNECTOR_LAYER_W,
                flexShrink: 0,
                position: 'relative',
                minHeight: 20,
                overflow: 'visible',
              }}
            >
              <GroupConnectorSvg
                containerRef={containerRef}
                childIds={childIds}
                rowElMap={rowElMap}
                betweenOps={betweenOps}
                disabled={disabled}
                onToggleBetween={(gap) =>
                  onChange(toggleMetricGroupBetweenOp(root, node.id, gap))
                }
              />
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
              {children.map((child) => (
                <div
                  key={child.id}
                  className="metric-filter-child-block"
                  style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
                  onMouseEnter={() => handleChildMouseEnter(child.id)}
                  onMouseLeave={handleChildMouseLeave}
                  onMouseMove={(e) => handleChildMouseMove(e, child.id)}
                >
                  <div
                    ref={setRowRef(child.id)}
                    className="metric-filter-row-anchor"
                    style={{ width: '100%', minWidth: 0 }}
                  >
                    {child.type === 'group' ? (
                      <GroupBlock
                        root={root}
                        node={child}
                        depth={depth + 1}
                        isRoot={false}
                        onChange={onChange}
                        availableFields={availableFields}
                        fieldTypes={fieldTypes}
                        disabled={disabled}
                      />
                    ) : (
                      <RuleRow
                        root={root}
                        parentGroup={node}
                        childId={child.id}
                        onChange={onChange}
                        availableFields={availableFields}
                        fieldTypes={fieldTypes}
                        disabled={disabled}
                        canNest={canNest}
                      />
                    )}
                  </div>
                  <div
                    className={`metric-filter-insert-gap ${hoveredChildId === child.id ? 'gap-visible' : ''}`}
                    onMouseEnter={() => {
                      if (hideAddTimeoutRef.current) {
                        clearTimeout(hideAddTimeoutRef.current);
                        hideAddTimeoutRef.current = null;
                      }
                      setHoveredChildId(child.id);
                    }}
                    onMouseLeave={handleChildMouseLeave}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined style={{ fontSize: 13 }} />}
                      disabled={disabled}
                      title="在此条件下方添加同级条件"
                      aria-label="在此条件下方添加同级条件"
                      onClick={() =>
                        onChange(
                          insertMetricExprChildAfter(
                            root,
                            node.id,
                            child.id,
                            emptyMetricFilterRuleNode(),
                          ),
                        )
                      }
                      style={{
                        color: '#1677ff',
                        height: 28,
                        padding: '0 12px',
                        borderRadius: 8,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 0',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 13, color: '#bfbfbf' }}>暂无条件</span>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => onChange(addRuleToMetricExprGroup(root, node.id))}
              style={{ fontSize: 14, borderRadius: 14 }}
            >
              添加条件
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const MetricFilterExprEditor: React.FC<{
  root: MetricFilterExprNode;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  /** 由预览数据抽样推断；日期列展示「早于/晚于/介于/昨日…」等操作符 */
  fieldTypes?: Record<string, MetricFieldKind>;
  disabled?: boolean;
}> = ({ root, onChange, availableFields, fieldTypes: fieldTypesProp, disabled }) => {
  const fieldTypes = fieldTypesProp ?? EMPTY_FIELD_TYPES;
  if (root.type !== 'group') return null;

  return (
    <>
      <div className="metric-filter-expr-wrap" style={{ fontSize: 12, width: '100%' }}>
        <GroupBlock
          root={root}
          node={root}
          depth={0}
          isRoot
          onChange={onChange}
          availableFields={availableFields}
          fieldTypes={fieldTypes}
          disabled={disabled}
        />
      </div>
    </>
  );
};
