/**
 * TransposeNodeConfig - 转置节点配置
 *
 * 用户手动指定透视表参数，生成类似 SQL 的 PIVOT / CASE WHEN + GROUP BY SQL：
 *   索引列  → GROUP BY 条件
 *   透视列  → 取唯一值生成列头
 *   透视值  → 手动选择要生成哪些列
 *   值列    → 每个值列 + 聚合方式生成一组 CASE WHEN 列
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Select, Divider, Tag, Typography, Alert, Checkbox, Space, Spin } from 'antd';
import { SwapOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';
import { useNodePreview, type PreviewData } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';

const { Text } = Typography;

interface ValueColumnConfig {
  column: string;
  aggMethod: 'MAX' | 'SUM' | 'COUNT' | 'AVG';
}

interface TransposeNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  onChange: () => void;
  readOnly?: boolean;
  pipelineDataSourceId?: number | null;
}

const AGG_OPTIONS = [
  { value: 'MAX', label: 'MAX（最大值）' },
  { value: 'SUM', label: 'SUM（求和）' },
  { value: 'COUNT', label: 'COUNT（计数）' },
  { value: 'AVG', label: 'AVG（平均值）' },
];

export const TransposeNodeConfig: React.FC<TransposeNodeConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  onChange,
  readOnly = false,
  pipelineDataSourceId,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;

  // ── 解析数据源 ID ───────────────────────────────────────────────
  const resolvedDsId = useMemo(
    () => resolvePreviewDataSourceId(pipelineNode, pipelineDataSourceId ?? undefined),
    [pipelineNode, pipelineDataSourceId],
  );

  // ── 拉取上游预览数据 ─────────────────────────────────────────────
  const upstreamPreview = useNodePreview();
  const [loading, setLoading] = useState(false);

  // ── 状态（必须在 useMemo 之前声明）─────────────────────────────────
  const savedIndexColumns = (config.indexColumns as string[]) || [];
  const savedPivotColumn = (config.pivotColumn as string) || '';
  const savedPivotValues = (config.pivotValues as string[]) || [];
  const savedValueColumns = (config.valueColumns as ValueColumnConfig[]) || [];

  const [indexColumns, setIndexColumns] = useState<string[]>(savedIndexColumns);
  const [pivotColumn, setPivotColumn] = useState<string>(savedPivotColumn);
  const [pivotValues, setPivotValues] = useState<string[]>(savedPivotValues);
  const [valueColumns, setValueColumns] = useState<ValueColumnConfig[]>(
    savedValueColumns.length > 0 ? savedValueColumns : [],
  );

  // 从 previewData 提取列信息
  const upstreamColumns = useMemo<Array<{ name: string; type: string }>>(() => {
    const cols: Array<{ name: string; type: string }> = [];
    const previewData = upstreamPreview.previewData as PreviewData | null;
    if (previewData?.columns && previewData?.columnTypes) {
      previewData.columns.forEach((name, i) => {
        cols.push({ name, type: previewData.columnTypes?.[i] || 'string' });
      });
    }
    return cols;
  }, [upstreamPreview.previewData]);

  // 从 previewData rows 提取透视列的唯一值列表
  const pivotValueOptions = useMemo<string[]>(() => {
    const previewData = upstreamPreview.previewData as PreviewData | null;
    const pivotCol = pivotColumn;
    if (!pivotCol || !previewData?.rows?.length) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of previewData.rows) {
      const val = String(row[pivotCol] ?? '');
      if (val && !seen.has(val)) {
        seen.add(val);
        result.push(val);
      }
    }
    return result;
  }, [upstreamPreview.previewData, pivotColumn]);

  // ── 上游预览数据签名（配置变化时重置缓存）───────────────────────
  const upstreamConfigKey = useMemo(
    () => JSON.stringify({ indexColumns, pivotColumn, pivotValues, valueColumns }),
    [indexColumns, pivotColumn, pivotValues, valueColumns],
  );

  // 组件挂载时及配置变化时重新加载上游预览
  useEffect(() => {
    if (!resolvedDsId) return;
    setLoading(true);
    upstreamPreview.clearPreview();
    upstreamPreview
      .loadPreview({
        node,
        allNodes,
        pipelineDataSourceId: resolvedDsId,
        limit: 500, // 需要足够行数才能取到透视列的唯一值
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDsId, upstreamNodes, upstreamConfigKey]);

  // ── 保存配置到节点 ───────────────────────────────────────────────
  const updateConfig = (
    newIndex: string[],
    newPivotCol: string,
    newPivotVals: string[],
    newValue: ValueColumnConfig[],
  ) => {
    if (readOnly) return;
    const sqlPersisted = buildTransposeSql(newIndex, newPivotCol, newPivotVals, newValue);
    const pn = node.data.pipelineNode as Record<string, unknown>;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        sql: sqlPersisted,
        config: {
          ...config,
          indexColumns: newIndex,
          pivotColumn: newPivotCol,
          pivotValues: newPivotVals,
          valueColumns: newValue,
        },
      },
    };
    onChange();
  };

  const handleIndexChange = (vals: string[]) => {
    setIndexColumns(vals);
    updateConfig(vals, pivotColumn, pivotValues, valueColumns);
  };

  const handlePivotColumnChange = (col: string) => {
    // 透视列变化时，清空已选的透视值和值列
    setPivotColumn(col);
    setPivotValues([]);
    setValueColumns([]);
    updateConfig(indexColumns, col, [], []);
  };

  const handlePivotValuesChange = (vals: string[]) => {
    setPivotValues(vals);
    updateConfig(indexColumns, pivotColumn, vals, valueColumns);
  };

  const handleValueSelectChange = (vals: string[]) => {
    const newValue: ValueColumnConfig[] = vals.map((v) => {
      const existing = valueColumns.find((c) => c.column === v);
      return existing || { column: v, aggMethod: 'MAX' };
    });
    setValueColumns(newValue);
    updateConfig(indexColumns, pivotColumn, pivotValues, newValue);
  };

  const handleAggChange = (col: string, method: string) => {
    const newValue = valueColumns.map((c) =>
      c.column === col ? { ...c, aggMethod: method as ValueColumnConfig['aggMethod'] } : c,
    );
    setValueColumns(newValue);
    updateConfig(indexColumns, pivotColumn, pivotValues, newValue);
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="转置节点需要至少一个上游数据源以获取字段信息。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const currentValueCols = valueColumns.map((c) => c.column);

  // ── 过滤掉已选为索引/透视的列后剩余可选列 ──────────────────────
  const selectableForValue = upstreamColumns.filter((c) => c.name !== pivotColumn && !indexColumns.includes(c.name));

  return (
    <div>
      {/* 说明 */}
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="数据透视表说明"
        description={
          <span>
            将纵向明细数据转为横向报表。<b>索引列</b>作为行分组（GROUP BY），<b>透视列</b>取其唯一值作为列头，
            <b>透视值</b>由用户手动选择要生成哪些列，<b>值列</b>通过 CASE WHEN + 聚合函数填入。
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: 8 }}>
          <Spin size="small" />{' '}
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            加载上游数据中…
          </Text>
        </div>
      )}

      {/* 第一行：索引列 + 透视列 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {/* 索引列 */}
        <div style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 13 }}>
            <SwapOutlined style={{ marginRight: 6 }} />
            索引列
          </Text>
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
            （GROUP BY）
          </Text>
          <Select
            mode="multiple"
            placeholder="选择索引列"
            value={indexColumns}
            onChange={handleIndexChange}
            style={{ width: '100%', marginTop: 4 }}
            disabled={readOnly}
            allowClear
            options={upstreamColumns.map((c) => ({
              value: c.name,
              label: (
                <Space size={4}>
                  <Tag
                    style={{
                      background: getDataTypeInfo(c.type).bg,
                      color: getDataTypeInfo(c.type).text,
                      border: 'none',
                      fontSize: 9,
                      padding: '0 3px',
                    }}
                  >
                    {getDataTypeInfo(c.type).label}
                  </Tag>
                  <span>{c.name}</span>
                </Space>
              ),
            }))}
          />
        </div>

        {/* 透视列 */}
        <div style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 13 }}>
            <SwapOutlined style={{ marginRight: 6 }} />
            透视列
          </Text>
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
            （取唯一值）
          </Text>
          <Select
            placeholder="选择透视列"
            value={pivotColumn || undefined}
            onChange={handlePivotColumnChange}
            style={{ width: '100%', marginTop: 4 }}
            disabled={readOnly}
            allowClear
            options={upstreamColumns
              .filter((c) => !indexColumns.includes(c.name))
              .map((c) => ({
                value: c.name,
                label: (
                  <Space size={4}>
                    <Tag
                      style={{
                        background: getDataTypeInfo(c.type).bg,
                        color: getDataTypeInfo(c.type).text,
                        border: 'none',
                        fontSize: 9,
                        padding: '0 3px',
                      }}
                    >
                      {getDataTypeInfo(c.type).label}
                    </Tag>
                    <span>{c.name}</span>
                  </Space>
                ),
              }))}
          />
        </div>
      </div>

      <Divider style={{ margin: '4px 0 12px' }} />

      {/* 透视值（从上游自动提取，用户手动勾选） */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <SwapOutlined style={{ marginRight: 6 }} />
          透视值
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
          （从透视列 "{pivotColumn || '—'}" 自动提取，请手动勾选要生成的列）
        </Text>
        {pivotColumn ? (
          pivotValueOptions.length > 0 ? (
            <div
              style={{
                marginTop: 6,
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                maxHeight: 160,
                overflowY: 'auto',
                background: '#fafafa',
                padding: '4px 8px',
              }}
            >
              {pivotValueOptions.map((val) => (
                <Checkbox
                  key={val}
                  checked={pivotValues.includes(val)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...pivotValues, val] : pivotValues.filter((v) => v !== val);
                    handlePivotValuesChange(next);
                  }}
                  style={{ marginRight: 12, marginBottom: 4 }}
                >
                  <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{val}</Text>
                </Checkbox>
              ))}
            </div>
          ) : (
            <Alert
              type="warning"
              showIcon
              message="该列无数据或唯一值过多"
              description="请确保上游数据已加载，或透视列唯一值数量适中。"
              style={{ marginTop: 4 }}
            />
          )
        ) : (
          <Alert type="info" message="请先选择透视列" style={{ marginTop: 4 }} />
        )}
        {pivotValues.length === 0 && pivotColumn && !loading && (
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            未选择任何透视值，将不会生成转置列
          </Text>
        )}
      </div>

      <Divider style={{ margin: '4px 0 12px' }} />

      {/* 值列 */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <SwapOutlined style={{ marginRight: 6 }} />
          值列
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
          （聚合到各透视列下）
        </Text>
        {selectableForValue.length > 0 ? (
          <Select
            mode="multiple"
            placeholder="选择值列"
            value={currentValueCols}
            onChange={handleValueSelectChange}
            style={{ width: '100%', marginTop: 4 }}
            disabled={readOnly}
            allowClear
            options={selectableForValue.map((c) => ({
              value: c.name,
              label: (
                <Space size={4}>
                  <Tag
                    style={{
                      background: getDataTypeInfo(c.type).bg,
                      color: getDataTypeInfo(c.type).text,
                      border: 'none',
                      fontSize: 9,
                      padding: '0 3px',
                    }}
                  >
                    {getDataTypeInfo(c.type).label}
                  </Tag>
                  <span>{c.name}</span>
                </Space>
              ),
            }))}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            {upstreamColumns.length === 0 && !loading ? '（上游无字段信息）' : '（无可选列）'}
          </Text>
        )}

        {/* 每个值列的聚合方式 */}
        {valueColumns.length > 0 && (
          <div style={{ marginTop: 8, border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
            {valueColumns.map((vc) => (
              <div
                key={vc.column}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderBottom: '1px solid #f0f0f0',
                  background: '#fafafa',
                }}
              >
                <Checkbox checked disabled style={{ pointerEvents: 'none' }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}>{vc.column}</Text>
                <Select
                  size="small"
                  value={vc.aggMethod}
                  onChange={(val) => handleAggChange(vc.column, val)}
                  options={AGG_OPTIONS}
                  style={{ width: 120 }}
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 实时 SQL 预览 */}
      <Divider style={{ margin: '4px 0 12px' }} />
      <Text type="secondary" style={{ fontSize: 11 }}>
        生成的查询：
      </Text>
      <div
        style={{
          marginTop: 4,
          padding: '8px 10px',
          background: '#f5f7fa',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#595959',
          minHeight: 40,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {buildSqlPreview(indexColumns, pivotColumn, pivotValues, valueColumns)}
      </div>
    </div>
  );
};

/** 生成转置节点 SQL（与后端 engine.py build_node_sql 逻辑一致） */
function buildTransposeSql(
  indexCols: string[],
  pivotCol: string,
  pivotVals: string[],
  valueCols: ValueColumnConfig[],
): string {
  if (indexCols.length === 0 || !pivotCol || pivotVals.length === 0 || valueCols.length === 0) {
    return '';
  }

  const indexPart = indexCols.map((c) => `\`${c}\``).join(', ');

  const caseParts: string[] = [];
  for (const vc of valueCols) {
    for (const pv of pivotVals) {
      const safeVal = pv.replace(/'/g, "''");
      const col = `\`${vc.column}\``;
      const alias = `${vc.aggMethod.toLowerCase()}_${vc.column}_${safeVal.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      caseParts.push(`${vc.aggMethod}(CASE WHEN \`${pivotCol}\` = '${safeVal}' THEN ${col} END) AS \`${alias}\``);
    }
  }

  return `SELECT ${indexPart}, ${caseParts.join(', ')} FROM {prev_table} GROUP BY ${indexPart}`;
}

/** 前端实时 SQL 预览 */
function buildSqlPreview(
  indexCols: string[],
  pivotCol: string,
  pivotVals: string[],
  valueCols: ValueColumnConfig[],
): React.ReactNode {
  if (indexCols.length === 0) {
    return <span style={{ color: '#bfbfbf' }}>（请选择索引列）</span>;
  }
  if (!pivotCol) {
    return <span style={{ color: '#bfbfbf' }}>（请选择透视列）</span>;
  }
  if (pivotVals.length === 0 || valueCols.length === 0) {
    return <span style={{ color: '#bfbfbf' }}>（请选择透视值和值列）</span>;
  }

  const indexPart = indexCols.map((c) => `\`${c}\``).join(', ');

  const caseParts: string[] = [];
  for (const vc of valueCols) {
    for (const pv of pivotVals) {
      const safeVal = pv.replace(/'/g, "''");
      const col = `\`${vc.column}\``;
      const alias = `${vc.aggMethod.toLowerCase()}_${vc.column}_${safeVal.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      caseParts.push(`${vc.aggMethod}(CASE WHEN \`${pivotCol}\` = '${safeVal}' THEN ${col} END) AS \`${alias}\``);
    }
  }

  return (
    <>
      SELECT {indexPart},<br />
      &nbsp;&nbsp;{caseParts.join(',\n      ')}
      <br />
      FROM upstream
      <br />
      GROUP BY {indexPart}
    </>
  );
}
