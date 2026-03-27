/**
 * FilterNodeConfig - Visual WHERE condition builder for "Filter Rows" nodes.
 * Non-technical users build filter conditions by selecting column + operator + value.
 */
import React, { useState, useEffect } from 'react';
import {
  Form, Select, Input, Button, Space, Divider, Tag, Typography,
  Alert, Card, Tooltip,
} from 'antd';
import { PlusOutlined, DeleteOutlined, FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { DataSourceService } from '../../../services/dataSourceService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';

const { Text } = Typography;

export const FILTER_OPERATORS = [
  { label: '等于', value: 'eq', types: ['string', 'int', 'bigint', 'decimal', 'date', 'datetime', 'uuid'] },
  { label: '不等于', value: 'ne', types: ['string', 'int', 'bigint', 'decimal', 'date', 'datetime', 'uuid'] },
  { label: '大于', value: 'gt', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
  { label: '大于等于', value: 'ge', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
  { label: '小于', value: 'lt', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
  { label: '小于等于', value: 'le', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
  { label: '包含', value: 'contains', types: ['string'] },
  { label: '开头是', value: 'startsWith', types: ['string'] },
  { label: '结尾是', value: 'endsWith', types: ['string'] },
  { label: '为空', value: 'isNull', types: ['string', 'int', 'bigint', 'decimal', 'date', 'datetime', 'uuid', 'null'] },
  { label: '不为空', value: 'isNotNull', types: ['string', 'int', 'bigint', 'decimal', 'date', 'datetime', 'uuid', 'null'] },
  { label: '在列表中', value: 'in', types: ['string', 'int', 'bigint', 'decimal'] },
];

interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
}

interface FilterNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  onChange: () => void;
  readOnly?: boolean;
}

export const FilterNodeConfig: React.FC<FilterNodeConfigProps> = ({
  node,
  upstreamNodes,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedConditions = (config.conditions || []) as Condition[];
  const logic = (config.logic as string) || 'AND';

  const [conditions, setConditions] = useState<Condition[]>(
    savedConditions.length > 0 ? savedConditions : [{ id: `cond_${Date.now()}`, column: '', operator: '', value: '' }]
  );
  const [columns, setColumns] = useState<Array<{ name: string; type: string }>>([]);
  const [colsLoading, setColsLoading] = useState(false);

  // Load columns from first upstream source node
  useEffect(() => {
    if (upstreamNodes.length === 0) { setColumns([]); return; }
    // Find the first upstream source node to get columns from
    const firstUp = upstreamNodes[0];
    const upPn = firstUp?.data?.pipelineNode as PipelineNode | undefined;
    const upConfig = (upPn?.config || {}) as Record<string, unknown>;
    const tableName = upConfig.tableName as string | undefined;
    // We need the pipeline's data source ID to query columns
    // For now, we'll show an empty list if we don't have table info
    // This will be enhanced when upstream preview data is available
    setColumns([]);
  }, [upstreamNodes]);

  const updateConfig = (newConditions: Condition[], newLogic?: string) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...config,
          conditions: newConditions,
          logic: newLogic !== undefined ? newLogic : logic,
        },
      },
    };
    onChange();
  };

  const addCondition = () => {
    const newConditions = [
      ...conditions,
      { id: `cond_${Date.now()}`, column: '', operator: '', value: '' },
    ];
    setConditions(newConditions);
    updateConfig(newConditions);
  };

  const removeCondition = (id: string) => {
    const newConditions = conditions.filter(c => c.id !== id);
    if (newConditions.length === 0) {
      newConditions.push({ id: `cond_${Date.now()}`, column: '', operator: '', value: '' });
    }
    setConditions(newConditions);
    updateConfig(newConditions);
  };

  const updateCondition = (id: string, field: keyof Condition, fieldValue: string) => {
    const newConditions = conditions.map(c =>
      c.id === id ? { ...c, [field]: fieldValue } : c
    );
    setConditions(newConditions);
    updateConfig(newConditions);
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="过滤节点需要至少一个上游数据源。将鼠标悬停在节点上拖出连接线，连接到其他节点。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const getOperatorsForColumn = (colName: string) => {
    // If we had column types, filter operators by type
    // For now, show all operators
    return FILTER_OPERATORS;
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <FilterOutlined style={{ marginRight: 6 }} />
          筛选条件
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {conditions.filter(c => c.column && c.operator).length} 个条件
        </Text>
      </div>

      {/* Logic toggle: ALL / ANY */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>同时满足：</Text>
        <Space>
          {['AND', 'OR'].map(l => (
            <Tag
              key={l}
              style={{
                cursor: 'pointer',
                background: logic === l ? '#E0F2FE' : '#f5f5f5',
                color: logic === l ? '#0EA5E9' : '#8c8c8c',
                border: logic === l ? '1px solid #0EA5E9' : '1px solid #d9d9d9',
                fontWeight: logic === l ? 600 : 400,
              }}
              onClick={() => { updateConfig(conditions, l); }}
            >
              {l === 'AND' ? '全部 (AND)' : '任一 (OR)'}
            </Tag>
          ))}
        </Space>
        <Tooltip title={logic === 'AND' ? '所有条件都满足时才保留行' : '任意一个条件满足时就保留行'}>
          <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}>❓</Text>
        </Tooltip>
      </div>

      {conditions.map((cond, idx) => {
        const ops = getOperatorsForColumn(cond.column);
        const needsValue = !['isNull', 'isNotNull'].includes(cond.operator);
        const colType = columns.find(c => c.name === cond.column)?.type;

        return (
          <Card
            key={cond.id}
            size="small"
            style={{
              marginBottom: 8,
              borderColor: cond.column && cond.operator && needsValue && !cond.value ? '#faad14' : '#f0f0f0',
            }}
            bodyStyle={{ padding: '10px 12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              {/* Row number badge */}
              <div style={{
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                background: '#f0f0f0',
                color: '#595959',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 4,
                flexShrink: 0,
              }}>
                {idx + 1}
              </div>

              {/* Column selector */}
              <Select
                size="small"
                placeholder="选择字段"
                value={cond.column || undefined}
                onChange={(val) => updateCondition(cond.id, 'column', val)}
                style={{ minWidth: 100, flex: 1 }}
                showSearch
                optionFilterProp="label"
                disabled={readOnly}
                options={columns.map(c => ({
                  label: (() => {
                    const typeInfo = getDataTypeInfo(c.type);
                    return (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag style={{
                          background: typeInfo.bg, color: typeInfo.text,
                          border: 'none', fontSize: 9, padding: '0 3px', lineHeight: '14px',
                        }}>
                          {typeInfo.label}
                        </Tag>
                        {c.name}
                      </span>
                    );
                  })(),
                  value: c.name,
                }))}
              />
              {!readOnly && conditions.length > 1 && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeCondition(cond.id)}
                  style={{ flexShrink: 0 }}
                />
              )}
            </div>

            {/* Operator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: 26 }}>
              <Select
                size="small"
                placeholder="条件"
                value={cond.operator || undefined}
                onChange={(val) => updateCondition(cond.id, 'operator', val)}
                style={{ minWidth: 100, flex: 1 }}
                disabled={readOnly}
                options={ops.map(op => ({ label: op.label, value: op.value }))}
              />

              {/* Value input */}
              {needsValue && (
                <Input
                  size="small"
                  placeholder="值"
                  value={cond.value}
                  onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                  style={{ minWidth: 80, flex: 1 }}
                  disabled={readOnly}
                />
              )}

              {!needsValue && (
                <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                  {cond.operator === 'isNull' ? '为空（无需填写值）' : '不为空（无需填写值）'}
                </Text>
              )}
            </div>

            {/* Hint text for "in" operator */}
            {cond.operator === 'in' && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 26, display: 'block', marginTop: 2 }}>
                多个值用英文逗号分隔，如：BJ,SH,GZ
              </Text>
            )}
          </Card>
        );
      })}

      {!readOnly && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={addCondition}
          style={{ width: '100%', marginTop: 4 }}
        >
          添加筛选条件
        </Button>
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* SQL preview */}
      <Text type="secondary" style={{ fontSize: 11 }}>
        生成的查询条件：
      </Text>
      <div style={{
        marginTop: 4,
        padding: '6px 10px',
        background: '#f5f7fa',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#595959',
        minHeight: 28,
      }}>
        {(() => {
          const validConds = conditions.filter(c => c.column && c.operator);
          if (validConds.length === 0) return <span style={{ color: '#bfbfbf' }}>（请添加筛选条件）</span>;
          const clauses = validConds.map(c => {
            const col = `\`${c.column}\``;
            const val = c.value;
            switch (c.operator) {
              case 'eq': return `${col} = ${val}`;
              case 'ne': return `${col} != ${val}`;
              case 'gt': return `${col} > ${val}`;
              case 'ge': return `${col} >= ${val}`;
              case 'lt': return `${col} < ${val}`;
              case 'le': return `${col} <= ${val}`;
              case 'contains': return `${col} LIKE '%${val}%'`;
              case 'startsWith': return `${col} LIKE '${val}%'`;
              case 'endsWith': return `${col} LIKE '%${val}'`;
              case 'isNull': return `${col} IS NULL`;
              case 'isNotNull': return `${col} IS NOT NULL`;
              case 'in': return `${col} IN (${val})`;
              default: return `${col} = ${val}`;
            }
          });
          return clauses.join(` ${logic} `);
        })()}
      </div>
    </div>
  );
};
