/**
 * AggregateNodeConfig - Visual GROUP BY + aggregation builder for "Summarize Data" nodes.
 * Non-technical users pick columns and aggregate functions via dropdowns.
 */
import React, { useState } from 'react';
import {
  Form, Select, Input, Button, Space, Divider, Tag, Typography,
  Alert, Card, message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';

const { Text } = Typography;

export const AGGREGATE_FUNCTIONS = [
  { label: '求和 (SUM)', value: 'sum', desc: '将数值相加', types: ['int', 'bigint', 'decimal', 'float', 'double'] },
  { label: '计数 (COUNT)', value: 'count', desc: '计算行数', types: ['string', 'int', 'bigint', 'decimal', 'float', 'date', 'uuid'] },
  { label: '去重计数 (COUNT DISTINCT)', value: 'count_distinct', desc: '计算不重复的行数', types: ['string', 'int', 'bigint', 'decimal', 'uuid'] },
  { label: '平均值 (AVG)', value: 'avg', desc: '计算平均值', types: ['int', 'bigint', 'decimal', 'float', 'double'] },
  { label: '最大值 (MAX)', value: 'max', desc: '取最大值', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
  { label: '最小值 (MIN)', value: 'min', desc: '取最小值', types: ['int', 'bigint', 'decimal', 'float', 'date', 'datetime'] },
];

interface Aggregation {
  id: string;
  column: string;
  func: string;
  alias: string;
}

interface AggregateNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  onChange: () => void;
  readOnly?: boolean;
}

export const AggregateNodeConfig: React.FC<AggregateNodeConfigProps> = ({
  node,
  upstreamNodes,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedGroupBy = (config.groupBy as string[]) || [];
  const savedAggregations = (config.aggregations as Aggregation[]) || [];

  const [groupBy, setGroupBy] = useState<string[]>(savedGroupBy);
  const [aggregations, setAggregations] = useState<Aggregation[]>(
    savedAggregations.length > 0 ? savedAggregations : [{ id: `agg_${Date.now()}`, column: '', func: 'sum', alias: '' }]
  );

  // Placeholder columns (would be loaded from upstream preview in real impl)
  const columns: Array<{ name: string; type: string }> = [];

  const updateConfig = (newGroupBy: string[], newAggs: Aggregation[]) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...config,
          groupBy: newGroupBy,
          aggregations: newAggs,
        },
      },
    };
    onChange();
  };

  const addAggregation = () => {
    const newAggs = [
      ...aggregations,
      { id: `agg_${Date.now()}`, column: '', func: 'sum', alias: '' },
    ];
    setAggregations(newAggs);
    updateConfig(groupBy, newAggs);
  };

  const removeAggregation = (id: string) => {
    const newAggs = aggregations.filter(a => a.id !== id);
    if (newAggs.length === 0) {
      newAggs.push({ id: `agg_${Date.now()}`, column: '', func: 'sum', alias: '' });
    }
    setAggregations(newAggs);
    updateConfig(groupBy, newAggs);
  };

  const updateAggregation = (id: string, field: keyof Aggregation, value: string) => {
    const newAggs = aggregations.map(a => {
      if (a.id !== id) return a;
      const updated = { ...a, [field]: value };
      if (field === 'func' && !updated.alias) {
        updated.alias = `${value}_${updated.column || 'col'}`;
      }
      if (field === 'column' && !updated.alias) {
        updated.alias = `${updated.func}_${value}`;
      }
      return updated;
    });
    setAggregations(newAggs);
    updateConfig(groupBy, newAggs);
  };

  const addGroupBy = (col: string) => {
    if (!col || groupBy.includes(col)) return;
    const newGroupBy = [...groupBy, col];
    setGroupBy(newGroupBy);
    updateConfig(newGroupBy, aggregations);
  };

  const removeGroupBy = (col: string) => {
    const newGroupBy = groupBy.filter(c => c !== col);
    setGroupBy(newGroupBy);
    updateConfig(newGroupBy, aggregations);
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="聚合节点需要至少一个上游数据源。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const validAggs = aggregations.filter(a => a.column && a.func);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <BarChartOutlined style={{ marginRight: 6 }} />
          分组维度（GROUP BY）
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          按哪些字段进行分组
        </Text>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Select
          size="small"
          placeholder="选择分组字段…"
          style={{ width: '100%' }}
          onChange={addGroupBy}
          disabled={readOnly}
          value={undefined}
          allowClear
          showSearch
          options={columns
            .filter(c => !groupBy.includes(c.name))
            .map(c => {
              const typeInfo = getDataTypeInfo(c.type);
              return {
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Tag style={{ background: typeInfo.bg, color: typeInfo.text, border: 'none', fontSize: 9, padding: '0 3px' }}>
                      {typeInfo.label}
                    </Tag>
                    {c.name}
                  </span>
                ),
                value: c.name,
              };
            })}
        />
        {groupBy.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {groupBy.map(col => (
              <Tag
                key={col}
                closable={!readOnly}
                onClose={() => removeGroupBy(col)}
                style={{ background: '#E0F2FE', color: '#0EA5E9', border: 'none' }}
              >
                {col}
              </Tag>
            ))}
          </div>
        )}
        {groupBy.length === 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            不选分组维度 = 对所有数据做汇总（单行结果）
          </Text>
        )}
      </div>

      <Divider style={{ margin: '8px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          汇总指标（聚合函数）
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {validAggs.length} 个指标
        </Text>
      </div>

      {aggregations.map((agg, idx) => (
        <Card
          key={agg.id}
          size="small"
          style={{ marginBottom: 8 }}
          bodyStyle={{ padding: '8px 10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 11, color: '#8c8c8c', minWidth: 16 }}>#{idx + 1}</Text>

            {/* Column */}
            <Select
              size="small"
              placeholder="选择字段"
              value={agg.column || undefined}
              onChange={(val) => updateAggregation(agg.id, 'column', val)}
              style={{ flex: 1 }}
              showSearch
              disabled={readOnly}
              options={columns.map(c => {
                const typeInfo = getDataTypeInfo(c.type);
                return {
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Tag style={{ background: typeInfo.bg, color: typeInfo.text, border: 'none', fontSize: 9, padding: '0 3px' }}>
                        {typeInfo.label}
                      </Tag>
                      {c.name}
                    </span>
                  ),
                  value: c.name,
                };
              })}
            />

            {/* Function */}
            <Select
              size="small"
              value={agg.func}
              onChange={(val) => updateAggregation(agg.id, 'func', val)}
              style={{ width: 130 }}
              disabled={readOnly}
              options={AGGREGATE_FUNCTIONS.map(fn => ({
                label: fn.label,
                value: fn.value,
              }))}
            />

            {!readOnly && aggregations.length > 1 && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeAggregation(agg.id)}
              />
            )}
          </div>

          {/* Alias */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text type="secondary" style={{ fontSize: 11, minWidth: 16 }}>&nbsp;</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>输出为：</Text>
            <Input
              size="small"
              placeholder={`结果列名（默认：${agg.func}_${agg.column || 'col'}）`}
              value={agg.alias}
              onChange={(e) => updateAggregation(agg.id, 'alias', e.target.value)}
              style={{ flex: 1, fontFamily: 'monospace' }}
              disabled={readOnly}
            />
          </div>
        </Card>
      ))}

      {!readOnly && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={addAggregation}
          style={{ width: '100%', marginTop: 4 }}
        >
          添加汇总指标
        </Button>
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* SQL preview */}
      <Text type="secondary" style={{ fontSize: 11 }}>生成的查询：</Text>
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
          if (validAggs.length === 0) return <span style={{ color: '#bfbfbf' }}>（请添加汇总指标）</span>;
          const selectParts = [
            ...groupBy.map(c => `\`${c}\``),
            ...validAggs.map(a => {
              const fn = a.func.toUpperCase();
              const col = a.column ? `\`${a.column}\`` : '*';
              const alias = a.alias || `${a.func}_${a.column}`;
              if (a.func === 'count_distinct') {
                return `COUNT(DISTINCT \`${a.column}\`) AS \`${alias}\``;
              }
              return `${fn}(\`${a.column}\`) AS \`${alias}\``;
            }),
          ];
          const groupStr = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(c => `\`${c}\``).join(', ')}` : '';
          return `SELECT ${selectParts.join(', ')}\nFROM upstream ${groupStr}`;
        })()}
      </div>
    </div>
  );
};
