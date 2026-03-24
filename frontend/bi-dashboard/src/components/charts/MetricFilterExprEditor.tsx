import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Input, Tag } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import {
  METRIC_FILTER_OP_OPTIONS,
  type MetricFilterExprNode,
  type MetricFilterOp,
  updateMetricExprNode,
  removeMetricExprNode,
  addRuleToMetricExprGroup,
  insertMetricExprChildAfter,
  newEmptyMetricSubgroup,
} from '../../utils/chartMetric';

const { Option } = Select;

const MAX_DEPTH = 10;

const HUB_X = 9;
const RAIL_W = 28;
const LINE_TO_X = 26;

/** 左侧连线：各条件 / 子分组的中心汇聚到一点（hub） */
const GroupConnectorSvg: React.FC<{
  containerRef: React.RefObject<HTMLDivElement | null>;
  childIds: string[];
  rowElMap: React.MutableRefObject<Map<string, HTMLDivElement>>;
  logic: 'and' | 'or';
}> = ({ containerRef, childIds, rowElMap, logic }) => {
  const [svgPaths, setSvgPaths] = useState<{
    h: number;
    hubY: number;
    strokes: { d: string; key: string }[];
    stroke: string;
  } | null>(null);

  const measure = useMemo(
    () => () => {
      const box = containerRef.current;
      if (!box || childIds.length === 0) {
        setSvgPaths(null);
        return;
      }
      const boxRect = box.getBoundingClientRect();
      const lineStroke = logic === 'and' ? '#1677ff' : '#fa8c16';
      const centers: number[] = [];
      for (const id of childIds) {
        const el = rowElMap.current.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        centers.push(r.top + r.height / 2 - boxRect.top);
      }
      if (centers.length === 0) {
        setSvgPaths(null);
        return;
      }
      const hubY = centers.reduce((a, b) => a + b, 0) / centers.length;
      const strokes = centers.map((cy, i) => ({
        key: `${childIds[i]}_${cy}`,
        d: `M ${HUB_X} ${hubY} Q ${HUB_X} ${cy} ${LINE_TO_X} ${cy}`,
      }));
      setSvgPaths({
        h: Math.max(boxRect.height, 1),
        hubY,
        strokes,
        stroke: lineStroke,
      });
    },
    [childIds, containerRef, rowElMap, logic],
  );

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, containerRef, childIds.join('|')]);

  if (!svgPaths || svgPaths.strokes.length === 0) return null;

  return (
    <svg
      width={RAIL_W}
      height={svgPaths.h}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden
    >
      {svgPaths.strokes.map((s) => (
        <path
          key={s.key}
          d={s.d}
          fill="none"
          stroke={svgPaths.stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <circle cx={HUB_X} cy={svgPaths.hubY} r={3.5} fill={svgPaths.stroke} />
    </svg>
  );
};

const RuleRow: React.FC<{
  root: MetricFilterExprNode;
  childId: string;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  disabled?: boolean;
  parentGroupId: string;
  canNest: boolean;
}> = ({ root, childId, onChange, availableFields, disabled, parentGroupId, canNest }) => {
  const child = (root.type === 'group' ? root.children : []).find((c) => c.id === childId);
  if (!child || child.type !== 'rule') return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'nowrap',
        minWidth: 0,
        flex: 1,
      }}
    >
      <Select
        size="small"
        value={child.field || undefined}
        placeholder="字段"
        allowClear
        showSearch
        style={{ width: 110, flexShrink: 0 }}
        disabled={disabled || availableFields.length === 0}
        onChange={(v) =>
          onChange(
            updateMetricExprNode(root, childId, (n) =>
              n.type === 'rule' ? { ...n, field: v || '' } : n,
            ),
          )
        }
      >
        {availableFields.map((f) => (
          <Option key={f} value={f}>
            {f}
          </Option>
        ))}
      </Select>

      <Select
        size="small"
        value={child.op}
        style={{ width: 90, flexShrink: 0 }}
        disabled={disabled}
        onChange={(v) =>
          onChange(
            updateMetricExprNode(root, childId, (n) =>
              n.type === 'rule' ? { ...n, op: v as MetricFilterOp } : n,
            ),
          )
        }
      >
        {METRIC_FILTER_OP_OPTIONS.map((o) => (
          <Option key={o.value} value={o.value}>
            {o.label}
          </Option>
        ))}
      </Select>

      {child.op !== 'is_null' && child.op !== 'is_not_null' ? (
        <Input
          size="small"
          value={child.value}
          placeholder="值"
          style={{ flex: 1, minWidth: 60 }}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              updateMetricExprNode(root, childId, (n) =>
                n.type === 'rule' ? { ...n, value: e.target.value } : n,
              ),
            )
          }
        />
      ) : (
        <span style={{ color: '#bfbfbf', fontSize: 12, flex: 1, minWidth: 60 }}>—</span>
      )}

      <Button
        type="text"
        size="small"
        danger
        disabled={disabled}
        icon={<CloseOutlined />}
        onClick={() => onChange(removeMetricExprNode(root, childId))}
        style={{ padding: '0 4px', flexShrink: 0 }}
      />

      {canNest ? (
        <Button
          type="default"
          size="small"
          shape="circle"
          icon={<PlusOutlined style={{ fontSize: 12 }} />}
          disabled={disabled}
          title="在此条件后添加子分组"
            onClick={() =>
            onChange(
              insertMetricExprChildAfter(root, parentGroupId, childId, newEmptyMetricSubgroup()),
            )
          }
          style={{ width: 26, height: 26, minWidth: 26, flexShrink: 0, padding: 0 }}
        />
      ) : null}
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
  disabled?: boolean;
}> = ({ root, node, depth, isRoot, onChange, availableFields, disabled }) => {
  const canNest = depth < MAX_DEPTH;
  const isNested = depth > 0;
  const children = node.children;

  const containerRef = useRef<HTMLDivElement>(null);
  const rowElMap = useRef<Map<string, HTMLDivElement>>(new Map());

  const setRowRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) rowElMap.current.set(id, el);
    else rowElMap.current.delete(id);
  };

  const childIds = children.map((c) => c.id);

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
          border: isNested ? '1px solid #adc6ff' : '1px solid #f0f0f0',
          borderRadius: 8,
          background: isNested ? '#f0f6ff' : '#fafafa',
          padding: '8px 10px 10px',
          position: 'relative',
          ...(isNested
            ? {
                paddingLeft: 6,
                boxShadow: 'inset 0 0 0 1px rgba(22,119,255,0.06)',
              }
            : {}),
        }}
      >
        {/* 子分组左侧接线点（与父组曲线对齐的视觉上锚点） */}
        {isNested && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: -5,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#adc6ff',
              border: '2px solid #fff',
              boxShadow: '0 0 0 1px #91caff',
              zIndex: 1,
            }}
          />
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            paddingLeft: isNested ? 8 : 0,
          }}
        >
          <span style={{ fontSize: 11, color: '#8c8c8c', flexShrink: 0 }}>组内</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {node.logic === 'and' ? (
              <>
                <Tag
                  color="blue"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: '18px',
                    padding: '0 6px',
                    cursor: disabled ? 'default' : 'pointer',
                    borderRadius: 3,
                  }}
                  onClick={
                    disabled
                      ? undefined
                      : () =>
                          onChange(
                            updateMetricExprNode(root, node.id, (n) =>
                              n.type === 'group' ? { ...n, logic: 'or' } : n,
                            ),
                          )
                  }
                >
                  且
                </Tag>
                <span
                  style={{ fontSize: 11, color: '#bfbfbf', cursor: disabled ? 'default' : 'pointer' }}
                  onClick={
                    disabled
                      ? undefined
                      : () =>
                          onChange(
                            updateMetricExprNode(root, node.id, (n) =>
                              n.type === 'group' ? { ...n, logic: 'or' } : n,
                            ),
                          )
                  }
                >
                  或
                </span>
              </>
            ) : (
              <>
                <span
                  style={{ fontSize: 11, color: '#bfbfbf', cursor: disabled ? 'default' : 'pointer' }}
                  onClick={
                    disabled
                      ? undefined
                      : () =>
                          onChange(
                            updateMetricExprNode(root, node.id, (n) =>
                              n.type === 'group' ? { ...n, logic: 'and' } : n,
                            ),
                          )
                  }
                >
                  且
                </span>
                <Tag
                  color="orange"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: '18px',
                    padding: '0 6px',
                    cursor: disabled ? 'default' : 'pointer',
                    borderRadius: 3,
                  }}
                  onClick={
                    disabled
                      ? undefined
                      : () =>
                          onChange(
                            updateMetricExprNode(root, node.id, (n) =>
                              n.type === 'group' ? { ...n, logic: 'and' } : n,
                            ),
                          )
                  }
                >
                  或
                </Tag>
              </>
            )}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <Button
              type="default"
              size="small"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => onChange(addRuleToMetricExprGroup(root, node.id))}
              style={{ fontSize: 12 }}
            >
              条件
            </Button>
            {!isRoot && (
              <Button
                type="text"
                size="small"
                danger
                icon={<CloseOutlined />}
                disabled={disabled}
                onClick={() => onChange(removeMetricExprNode(root, node.id))}
                style={{ fontSize: 12 }}
                title="删除分组"
              />
            )}
          </div>
        </div>

        {children.length > 0 ? (
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'stretch',
              minHeight: 24,
              paddingLeft: isNested ? 8 : 0,
            }}
          >
            <div
              style={{
                width: RAIL_W,
                flexShrink: 0,
                position: 'relative',
                minHeight: 20,
              }}
            >
              <GroupConnectorSvg
                containerRef={containerRef}
                childIds={childIds}
                rowElMap={rowElMap}
                logic={node.logic}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {children.map((child) => (
                <div
                  key={child.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
                >
                  <div ref={setRowRef(child.id)} style={{ minWidth: 0 }}>
                    {child.type === 'group' ? (
                      <GroupBlock
                        root={root}
                        node={child}
                        depth={depth + 1}
                        isRoot={false}
                        onChange={onChange}
                        availableFields={availableFields}
                        disabled={disabled}
                      />
                    ) : (
                      <RuleRow
                        root={root}
                        childId={child.id}
                        onChange={onChange}
                        availableFields={availableFields}
                        disabled={disabled}
                        parentGroupId={node.id}
                        canNest={canNest}
                      />
                    )}
                  </div>
                  {child.type === 'group' && canNest ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        type="default"
                        size="small"
                        shape="circle"
                        icon={<PlusOutlined style={{ fontSize: 12 }} />}
                        disabled={disabled}
                        title="在此分组后添加子分组"
                        onClick={() =>
                          onChange(
                            insertMetricExprChildAfter(
                              root,
                              node.id,
                              child.id,
                              newEmptyMetricSubgroup(),
                            ),
                          )
                        }
                        style={{ width: 28, height: 28, minWidth: 28, padding: 0 }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: '#bfbfbf',
              textAlign: 'center',
              padding: '8px 0',
            }}
          >
            暂无条件，点击「条件」添加
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
  disabled?: boolean;
}> = ({ root, onChange, availableFields, disabled }) => {
  if (root.type !== 'group') return null;

  return (
    <div style={{ fontSize: 12 }}>
      <GroupBlock
        root={root}
        node={root}
        depth={0}
        isRoot
        onChange={onChange}
        availableFields={availableFields}
        disabled={disabled}
      />
    </div>
  );
};
