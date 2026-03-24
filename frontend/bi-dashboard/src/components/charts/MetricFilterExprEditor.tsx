import React from 'react';
import { Row, Col, Button, Select, Input } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
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

interface MetricFilterExprEditorProps {
  root: MetricFilterExprNode;
  onChange: (next: MetricFilterExprNode) => void;
  availableFields: string[];
  disabled?: boolean;
}

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

  return (
    <div
      style={{
        position: 'relative',
        marginLeft: depth > 0 ? 10 : 0,
        paddingLeft: depth > 0 ? 14 : 0,
        borderLeft: depth > 0 ? '2px solid #91caff' : 'none',
        marginTop: depth > 0 ? 10 : 0,
      }}
    >
      {depth > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 10,
            height: 18,
            borderBottom: '2px solid #91caff',
            borderLeft: '2px solid #91caff',
            borderBottomLeftRadius: 6,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>
          {isRoot ? '根分组' : '子分组'}
        </span>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>组内</span>
        <Select
          size="small"
          style={{ width: 72 }}
          value={node.logic}
          disabled={disabled}
          onChange={(v) =>
            onChange(
              updateMetricExprNode(root, node.id, (n) =>
                n.type === 'group' ? { ...n, logic: v as 'and' | 'or' } : n,
              ),
            )
          }
        >
          <Option value="and">且</Option>
          <Option value="or">或</Option>
        </Select>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          disabled={disabled}
          onClick={() => onChange(addRuleToMetricExprGroup(root, node.id))}
        >
          条件
        </Button>
        {canNest ? (
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            disabled={disabled}
            onClick={() => onChange(addSubgroupToMetricExprGroup(root, node.id))}
          >
            子分组
          </Button>
        ) : null}
        {!isRoot ? (
          <Button
            type="link"
            size="small"
            danger
            disabled={disabled}
            onClick={() => onChange(removeMetricExprNode(root, node.id))}
          >
            删除分组
          </Button>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {node.children.map((child, idx) => (
          <div key={child.id}>
            {idx > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: '#91caff',
                  fontWeight: 600,
                  margin: '4px 0 8px',
                  paddingLeft: 4,
                  letterSpacing: 2,
                }}
              >
                {node.logic === 'and' ? '—— 且 ——' : '—— 或 ——'}
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
              <Row gutter={8} wrap={false} align="middle">
                <Col flex="140px">
                  <Select
                    value={child.field || undefined}
                    placeholder="字段"
                    allowClear
                    style={{ width: '100%' }}
                    disabled={disabled || availableFields.length === 0}
                    onChange={(v) =>
                      onChange(
                        updateMetricExprNode(root, child.id, (n) =>
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
                </Col>
                <Col flex="120px">
                  <Select
                    value={child.op}
                    style={{ width: '100%' }}
                    disabled={disabled}
                    onChange={(v) =>
                      onChange(
                        updateMetricExprNode(root, child.id, (n) =>
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
                </Col>
                <Col flex="auto">
                  {child.op === 'is_null' || child.op === 'is_not_null' ? (
                    <Input disabled placeholder="无需填写" />
                  ) : (
                    <Input
                      value={child.value}
                      placeholder="比较值（与数据一致）"
                      disabled={disabled}
                      onChange={(e) =>
                        onChange(
                          updateMetricExprNode(root, child.id, (n) =>
                            n.type === 'rule' ? { ...n, value: e.target.value } : n,
                          ),
                        )
                      }
                    />
                  )}
                </Col>
                <Col flex="none">
                  <Button
                    type="text"
                    danger
                    disabled={disabled}
                    icon={<MinusCircleOutlined />}
                    aria-label="删除"
                    onClick={() => onChange(removeMetricExprNode(root, child.id))}
                  />
                </Col>
              </Row>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const MetricFilterExprEditor: React.FC<MetricFilterExprEditorProps> = ({
  root,
  onChange,
  availableFields,
  disabled,
}) => {
  if (root.type !== 'group') {
    return null;
  }
  return (
    <div style={{ padding: '4px 0' }}>
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
