/**
 * FilterNodeConfig - Visual WHERE condition builder for "Filter Rows" nodes.
 * Non-technical users build filter conditions by selecting column + operator + value.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Select, Divider, Tag, Typography,
  Alert, Card, DatePicker, Button, Input, Space, Tooltip,
} from 'antd';
import { PlusOutlined, DeleteOutlined, FilterOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';
import type { PipelineNode as PNode } from '../../../services/pipelineService';

const { Text } = Typography;
const { RangePicker } = DatePicker;

// 日期类型快捷选项
export const DATE_PRESETS = [
  // 今日基准
  { label: '今日', value: 'today' },
  { label: '昨日', value: 'yesterday' },
  { label: '近7天', value: 'last_7_days' },
  { label: '近30天', value: 'last_30_days' },
  { label: '本月', value: 'this_month' },
  { label: '上月', value: 'last_month' },
  { label: '本年', value: 'this_year' },
  { label: '去年', value: 'last_year' },
  // 昨日基准（用于时间类型的早于/晚于筛选）
  { label: '昨日基准·近7天', value: 'yesterday_last_7_days' },
  { label: '昨日基准·近30天', value: 'yesterday_last_30_days' },
  { label: '昨日基准·近90天', value: 'yesterday_last_90_days' },
  { label: '昨日基准·上月', value: 'yesterday_last_month' },
];

// 获取相对日期的 SQL 表达式
export const getDatePresetExpression = (preset: string): { start: string; end: string } | null => {
  const today = dayjs();
  const yesterday = today.subtract(1, 'day');
  const fmt = 'YYYY-MM-DD';

  switch (preset) {
    case 'today':
      return { start: today.format(fmt), end: today.format(fmt) };
    case 'yesterday':
      return { start: yesterday.format(fmt), end: yesterday.format(fmt) };
    case 'last_7_days':
      return { start: today.subtract(6, 'day').format(fmt), end: today.format(fmt) };
    case 'last_30_days':
      return { start: today.subtract(29, 'day').format(fmt), end: today.format(fmt) };
    case 'this_month':
      return { start: today.startOf('month').format(fmt), end: today.endOf('month').format(fmt) };
    case 'last_month': {
      const lastMonth = today.subtract(1, 'month');
      return { start: lastMonth.startOf('month').format(fmt), end: lastMonth.endOf('month').format(fmt) };
    }
    case 'this_year':
      return { start: today.startOf('year').format(fmt), end: today.endOf('year').format(fmt) };
    case 'last_year': {
      const lastYear = today.subtract(1, 'year');
      return { start: lastYear.startOf('year').format(fmt), end: lastYear.endOf('year').format(fmt) };
    }
    // 昨日基准的快捷选项
    case 'yesterday_last_7_days':
      // 从昨日往前推6天，即近7天
      return { start: yesterday.subtract(6, 'day').format(fmt), end: yesterday.format(fmt) };
    case 'yesterday_last_30_days':
      // 从昨日往前推29天，即近30天
      return { start: yesterday.subtract(29, 'day').format(fmt), end: yesterday.format(fmt) };
    case 'yesterday_last_90_days':
      // 从昨日往前推89天，即近90天
      return { start: yesterday.subtract(89, 'day').format(fmt), end: yesterday.format(fmt) };
    case 'yesterday_last_month':
      // 上个月的昨日前一天到昨日（即上月整月）
      const lastMonth = yesterday.subtract(1, 'month');
      return { start: lastMonth.startOf('month').format(fmt), end: lastMonth.endOf('month').format(fmt) };
    default:
      return null;
  }
};

// 标准操作符（适用于所有类型）
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

// 日期类型专用的相对日期操作符
export const DATE_FILTER_OPERATORS = [
  { label: '早于', value: 'before', types: ['date', 'datetime'] },
  { label: '晚于', value: 'after', types: ['date', 'datetime'] },
  { label: '介于', value: 'between', types: ['date', 'datetime'] },
  { label: '快捷日期', value: 'preset', types: ['date', 'datetime'] },
];

interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
  valueType?: 'input' | 'preset' | 'range';  // 值类型：输入值、快捷日期、日期范围
  preset?: string;  // 快捷日期选项，如 'today', 'yesterday', 'last_30_days'
  rangeStart?: string;  // 范围开始日期
  rangeEnd?: string;  // 范围结束日期
}

interface FilterNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

export const FilterNodeConfig: React.FC<FilterNodeConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  pipelineDataSourceId,
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

  // ── 上游预览：获取列信息 ────────────────────────────────────────
  const upstreamNode = upstreamNodes[0] ?? null;
  const upstreamPn = upstreamNode?.data.pipelineNode as PipelineNode | undefined;
  const upstreamDsId = upstreamPn
    ? resolvePreviewDataSourceId(upstreamPn, pipelineDataSourceId ?? null)
    : undefined;

  const { previewData, loadPreview, clearPreview } = useNodePreview();

  const nodesSignature = useMemo(
    () => JSON.stringify(allNodes.map(n => ({
      id: n.id,
      pn: (n.data.pipelineNode as PNode),
    }))),
    [allNodes]
  );

  // 请求上游预览（仅首次加载或上游 id / nodes 签名变化时）
  const loadKeyRef = useRef<string>('');
  useEffect(() => {
    if (!upstreamNode || !upstreamDsId) {
      setColumns([]);
      return;
    }
    const key = `${upstreamNode.id}-${nodesSignature}-${upstreamDsId}`;
    if (key === loadKeyRef.current) return;
    loadKeyRef.current = key;
    clearPreview();
    loadPreview({
      node: upstreamNode,
      allNodes,
      pipelineDataSourceId: upstreamDsId,
      limit: 50,
    }, true);
  }, [upstreamNode?.id, nodesSignature, upstreamDsId, loadPreview, clearPreview]);

  // 处理预览数据中的列信息
  useEffect(() => {
    if (!previewData?.columns?.length) {
      setColumns([]);
      return;
    }
    const cols = previewData.columns.map((col, idx) => ({
      name: col,
      type: previewData.columnTypes?.[idx] ?? 'string',
    }));
    setColumns(cols);
  }, [previewData]);

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

  const updateCondition = (id: string, field: keyof Condition, fieldValue: any) => {
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
    // 根据列类型过滤操作符
    const col = columns.find(c => c.name === colName);
    const colType = col?.type;

    if (colType === 'date' || colType === 'datetime') {
      // 日期类型：使用标准操作符 + 日期专用操作符
      return [
        ...FILTER_OPERATORS.filter(op => op.types.includes(colType)),
        ...DATE_FILTER_OPERATORS,
      ];
    }

    // 其他类型：使用标准操作符
    return FILTER_OPERATORS;
  };

  // 判断是否需要显示快捷日期选择
  const needsPresetSelect = (cond: Condition) => cond.operator === 'preset';

  // 判断是否需要日期范围选择
  const needsDateRange = (cond: Condition) => cond.operator === 'between';

  // 判断是否为早于/晚于操作（需要快捷日期选择）
  const needsBeforeAfterSelect = (cond: Condition) => ['before', 'after'].includes(cond.operator);

  // 获取列类型
  const getColumnType = (colName: string) => {
    const col = columns.find(c => c.name === colName);
    return col?.type;
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
        const colType = getColumnType(cond.column);
        const isDateType = colType === 'date' || colType === 'datetime';

        // 检查是否需要特殊日期输入
        const showPresetSelect = isDateType && needsValue && needsBeforeAfterSelect(cond);
        const showRangePicker = isDateType && needsValue && needsDateRange(cond);
        const showPresetPicker = isDateType && needsValue && needsPresetSelect(cond);
        const showNormalInput = needsValue && !showPresetSelect && !showRangePicker && !showPresetPicker;

        return (
          <Card
            key={cond.id}
            size="small"
            style={{
              marginBottom: 8,
              borderColor: cond.column && cond.operator && needsValue &&
                !cond.value && !cond.preset && !cond.rangeStart ? '#faad14' : '#f0f0f0',
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
                onChange={(val) => {
                  // 重置相关字段
                  updateCondition(cond.id, 'column', val);
                  updateCondition(cond.id, 'value', '');
                  updateCondition(cond.id, 'preset', undefined);
                  updateCondition(cond.id, 'rangeStart', undefined);
                  updateCondition(cond.id, 'rangeEnd', undefined);
                }}
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
                onChange={(val) => {
                  // 切换操作符时重置值
                  updateCondition(cond.id, 'operator', val);
                  updateCondition(cond.id, 'value', '');
                  updateCondition(cond.id, 'preset', undefined);
                  updateCondition(cond.id, 'rangeStart', undefined);
                  updateCondition(cond.id, 'rangeEnd', undefined);
                }}
                style={{ minWidth: 100, flex: 1 }}
                disabled={readOnly}
                options={ops.map(op => ({ label: op.label, value: op.value }))}
              />

              {/* 普通输入框 */}
              {showNormalInput && (
                <Input
                  size="small"
                  placeholder="值"
                  value={cond.value}
                  onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                  style={{ minWidth: 80, flex: 1 }}
                  disabled={readOnly}
                />
              )}

              {/* 早于/晚于 - 快捷日期选择 */}
              {showPresetSelect && (
                <Select
                  size="small"
                  placeholder="选择快捷日期"
                  value={cond.preset || undefined}
                  onChange={(val) => updateCondition(cond.id, 'preset', val)}
                  style={{ minWidth: 120, flex: 1 }}
                  disabled={readOnly}
                  options={DATE_PRESETS.map(p => ({ label: p.label, value: p.value }))}
                  suffixIcon={<CalendarOutlined />}
                />
              )}

              {/* 介于 - 日期范围选择 */}
              {showRangePicker && (
                <RangePicker
                  size="small"
                  value={[
                    cond.rangeStart ? dayjs(cond.rangeStart) : null,
                    cond.rangeEnd ? dayjs(cond.rangeEnd) : null,
                  ]}
                  onChange={(dates) => {
                    updateCondition(cond.id, 'rangeStart', dates?.[0]?.format('YYYY-MM-DD') || '');
                    updateCondition(cond.id, 'rangeEnd', dates?.[1]?.format('YYYY-MM-DD') || '');
                  }}
                  style={{ flex: 1 }}
                  disabled={readOnly}
                  format="YYYY-MM-DD"
                  placeholder={['开始日期', '结束日期']}
                />
              )}

              {/* 快捷日期 - 选择预设 */}
              {showPresetPicker && (
                <Select
                  size="small"
                  placeholder="选择快捷日期"
                  value={cond.preset || undefined}
                  onChange={(val) => updateCondition(cond.id, 'preset', val)}
                  style={{ minWidth: 120, flex: 1 }}
                  disabled={readOnly}
                  options={DATE_PRESETS.map(p => ({ label: p.label, value: p.value }))}
                  suffixIcon={<CalendarOutlined />}
                />
              )}

              {/* 为空/不为空提示 */}
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

            // 处理日期快捷操作符
            if (c.operator === 'preset' && c.preset) {
              const expr = getDatePresetExpression(c.preset);
              if (expr) {
                return `${col} BETWEEN '${expr.start}' AND '${expr.end}'`;
              }
            }

            if (c.operator === 'before' && c.preset) {
              const expr = getDatePresetExpression(c.preset);
              if (expr) {
                return `${col} < '${expr.start}'`;
              }
            }

            if (c.operator === 'after' && c.preset) {
              const expr = getDatePresetExpression(c.preset);
              if (expr) {
                return `${col} > '${expr.end}'`;
              }
            }

            if (c.operator === 'between' && c.rangeStart && c.rangeEnd) {
              return `${col} BETWEEN '${c.rangeStart}' AND '${c.rangeEnd}'`;
            }

            switch (c.operator) {
              case 'eq': return `${col} = '${val}'`;
              case 'ne': return `${col} != '${val}'`;
              case 'gt': return `${col} > '${val}'`;
              case 'ge': return `${col} >= '${val}'`;
              case 'lt': return `${col} < '${val}'`;
              case 'le': return `${col} <= '${val}'`;
              case 'contains': return `${col} LIKE '%${val}%'`;
              case 'startsWith': return `${col} LIKE '${val}%'`;
              case 'endsWith': return `${col} LIKE '%${val}'`;
              case 'isNull': return `${col} IS NULL`;
              case 'isNotNull': return `${col} IS NOT NULL`;
              case 'in': return `${col} IN (${val})`;
              default: return `${col} = '${val}'`;
            }
          });
          return clauses.join(` ${logic} `);
        })()}
      </div>
    </div>
  );
};
