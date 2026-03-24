import React from 'react';
import { Button, Select, Input, Tag } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import {
  METRIC_FILTER_OP_OPTIONS,
  type MetricFilterExprNode,
  type MetricFilterOp,
  updateMetricExprNode,
  removeMetricExprNode,
  addRuleToMetricExprGroup,
  addSubgroupToMetricExprGroup,
} from '../../utils/chartMetric';

const { Option } = Select;

const MAX_DEPTH = 10;

// 紧凑的单个条件行
const RuleRow: React.FC<{
  root: MetricFilterExprNode;
  childId: string;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  disabled?: boolean;
}> = ({ root, childId, onChange, availableFields, disabled }) => {
  const child = (root.type === 'group' ? root.children : []).find(
    (c) => c.id === childId,
  );
  if (!child || child.type !== 'rule') return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'nowrap',
        minWidth: 0,
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
    </div>
  );
};

// 分组卡片：支持嵌套
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

  // 内层：子分组有左侧连接线 + 浅色卡片包裹
  const isNested = depth > 0;
  const children = node.children;

  return (
    <div
      style={{
        position: 'relative',
        marginLeft: isNested ? 18 : 0,
        marginTop: isNested ? 8 : 0,
      }}
    >
      {/* 左侧连接线（仅非根分组显示） */}
      {isNested && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: -12,
            top: 0,
            bottom: 0,
            width: 10,
            borderLeft: '2px solid #adc6ff',
            borderBottom: '2px solid #adc6ff',
            borderBottomLeftRadius: 4,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        style={{
          border: isNested ? '1px solid #adc6ff' : '1px solid #f0f0f0',
          borderRadius: 6,
          background: isNested ? '#f0f6ff' : 'transparent',
          padding: '8px 10px 10px',
        }}
      >
        {/* 分组头部：组内关系切换 + 操作按钮 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
          }}
        >
          {/* 组内逻辑切换：AND / OR 小标签 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {node.logic === 'and' ? (
              <>
                <Tag
                  color="blue"
                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px', cursor: disabled ? 'default' : 'pointer', borderRadius: '3px' }}
                  onClick={disabled ? undefined : () =>
                    onChange(
                      updateMetricExprNode(root, node.id, (n) =>
                        n.type === 'group' ? { ...n, logic: 'or' } : n,
                      ),
                    )
                  }
                >
                  且 AND
                </Tag>
                <span
                  style={{ fontSize: 11, color: '#8c8c8c', cursor: disabled ? 'default' : 'pointer' }}
                  onClick={disabled ? undefined : () =>
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
                  style={{ fontSize: 11, color: '#8c8c8c', cursor: disabled ? 'default' : 'pointer' }}
                  onClick={disabled ? undefined : () =>
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
                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px', cursor: disabled ? 'default' : 'pointer', borderRadius: '3px' }}
                  onClick={disabled ? undefined : () =>
                    onChange(
                      updateMetricExprNode(root, node.id, (n) =>
                        n.type === 'group' ? { ...n, logic: 'and' } : n,
                      ),
                    )
                  }
                >
                  或 OR
                </Tag>
              </>
            )}
          </div>

          {/* 右侧操作按钮 */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            {canNest && (
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                disabled={disabled}
                onClick={() => onChange(addSubgroupToMetricExprGroup(root, node.id))}
                style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                title="添加子分组"
              />
            )}
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => onChange(addRuleToMetricExprGroup(root, node.id))}
              style={{ fontSize: 12, padding: '0 4px', height: 22 }}
              title="添加条件"
            />
            {!isRoot && (
              <Button
                type="text"
                size="small"
                danger
                icon={<CloseOutlined />}
                disabled={disabled}
                onClick={() => onChange(removeMetricExprNode(root, node.id))}
                style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                title="删除分组"
              />
            )}
          </div>
        </div>

        {/* 子项列表 */}
        {children.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {children.map((child, idx) => (
              <div key={child.id}>
                {idx > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: node.logic === 'and' ? '#1677ff' : '#fa8c16',
                      fontWeight: 600,
                      margin: '2px 0',
                      textAlign: 'center',
                      letterSpacing: 1,
                    }}
                  >
                    {node.logic === 'and' ? '且 AND' : '或 OR'}
                  </div>
                )}
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
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: '#bfbfbf',
              textAlign: 'center',
              padding: '4px 0',
            }}
          >
            暂无条件，点击 + 添加
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
