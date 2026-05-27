/**
 * AggregateNodeConfig - 按列配置分组与汇总的聚合节点设置面板。
 * 内部请求上游预览仅用于列名/类型，不在侧栏展示样本表（用户可在画布底部预览）。
 * 按列配置：每行一个上游字段——是否分组 / 汇总方式 / 输出别名；底部为生成 SQL 只读预览。
 * 配置写回 config.groupBy 与 config.aggregations，与后端引擎协议一致。
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Table, Select, Input, Switch, Typography, Alert, Spin, Divider, Tag } from 'antd';
import { BarChartOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';
import type { PipelineNode as PNode } from '../../../services/pipelineService';

const { Text } = Typography;

const AGGREGATE_FUNCTIONS = [
  { label: '不汇总', value: '' },
  { label: '求和 SUM', value: 'sum' },
  { label: '计数 COUNT', value: 'count' },
  { label: '去重计数 COUNT DISTINCT', value: 'count_distinct' },
  { label: '平均值 AVG', value: 'avg' },
  { label: '最大值 MAX', value: 'max' },
  { label: '最小值 MIN', value: 'min' },
];

interface Aggregation {
  id: string;
  column: string;
  func: string;
  alias: string;
}

interface ColState {
  name: string;
  type: string;
  isGrouped: boolean;
  func: string;
  alias: string;
}

/** 与后端 PipelineEngine._build_step_sql 配合：持久化用 FROM {prev_table}，预览用 FROM upstream */
function formatAggregateSql(cols: ColState[], fromLine: string): string | null {
  const gbCols = cols.filter((c) => c.isGrouped).map((c) => `\`${c.name}\``);
  const aggCols = cols
    .filter((c) => c.func && !c.isGrouped)
    .map((c) => {
      const fn = c.func.toUpperCase();
      const alias = c.alias || `${c.func}_${c.name}`;
      if (c.func === 'count_distinct') return `COUNT(DISTINCT \`${c.name}\`) AS \`${alias}\``;
      return `${fn}(\`${c.name}\`) AS \`${alias}\``;
    });
  const selectParts = [...gbCols, ...aggCols];
  if (selectParts.length === 0) return null;
  const gbStr = gbCols.length > 0 ? ` GROUP BY ${gbCols.join(', ')}` : '';
  return `SELECT ${selectParts.join(', ')}\n${fromLine}${gbStr}`;
}

interface AggregateNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

export const AggregateNodeConfig: React.FC<AggregateNodeConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;

  // ── 上游预览 ────────────────────────────────────────────────
  const upstreamNode = upstreamNodes[0] ?? null;
  const upstreamPn = upstreamNode?.data.pipelineNode as PipelineNode | undefined;
  const upstreamDsId = upstreamPn ? resolvePreviewDataSourceId(upstreamPn, pipelineDataSourceId ?? null) : undefined;

  const { previewData, previewLoading, previewError, loadPreview, clearPreview } = useNodePreview();

  const nodesSignature = useMemo(
    () =>
      JSON.stringify(
        allNodes.map((n) => ({
          id: n.id,
          pn: n.data.pipelineNode as PNode,
        })),
      ),
    [allNodes],
  );

  // 请求上游预览（仅首次加载或上游 id / nodes 签名变化时）
  const loadKeyRef = useRef<string>('');
  useEffect(() => {
    if (!upstreamNode || !upstreamDsId) return;
    const key = `${upstreamNode.id}-${nodesSignature}-${upstreamDsId}`;
    if (key === loadKeyRef.current) return;
    loadKeyRef.current = key;
    clearPreview();
    loadPreview(
      {
        node: upstreamNode,
        allNodes,
        pipelineDataSourceId: upstreamDsId,
        limit: 50,
      },
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNode?.id, nodesSignature, upstreamDsId]);

  // 稳定序列化，避免「每次渲染新 []」导致 useEffect 死循环
  const groupBySig = useMemo(() => JSON.stringify((config.groupBy as string[]) ?? []), [config.groupBy]);
  const aggregationsSig = useMemo(
    () => JSON.stringify((config.aggregations as Aggregation[]) ?? []),
    [config.aggregations],
  );
  const previewColumnsSig = previewData?.columns?.join('\0') ?? '';

  const [cols, setCols] = useState<ColState[]>([]);

  // ── 写回 groupBy / aggregations + sql（后端校验与执行均要求 node.sql 非空） ──
  const flushToConfig = useCallback(
    (newCols: ColState[]) => {
      if (readOnly) return;
      const newGroupBy = newCols.filter((c) => c.isGrouped).map((c) => c.name);
      const newAggs: Aggregation[] = newCols
        .filter((c) => c.func && !c.isGrouped)
        .map((c) => ({
          id: `${c.name}_${c.func}`,
          column: c.name,
          func: c.func,
          alias: c.alias || `${c.func}_${c.name}`,
        }));

      const sqlPersisted = formatAggregateSql(newCols, 'FROM {prev_table}') ?? '';

      const pn = node.data.pipelineNode as Record<string, unknown>;
      const currentCfg = (pn.config || {}) as Record<string, unknown>;
      node.data = {
        ...node.data,
        pipelineNode: {
          ...pn,
          sql: sqlPersisted,
          config: { ...currentCfg, groupBy: newGroupBy, aggregations: newAggs },
        },
      };
      onChange();
    },
    [readOnly, node, onChange],
  );

  const lastMergedSigRef = useRef<string>('');
  useEffect(() => {
    if (!previewData?.columns?.length) return;
    const sig = `${node.id}|${previewColumnsSig}|${groupBySig}|${aggregationsSig}`;
    if (sig === lastMergedSigRef.current) return;
    lastMergedSigRef.current = sig;
    const gbList = JSON.parse(groupBySig) as string[];
    const aggList = JSON.parse(aggregationsSig) as Aggregation[];
    const gbSet = new Set(gbList);
    const aggByCol = new Map<string, Aggregation>();
    for (const a of aggList) {
      if (a.column) aggByCol.set(a.column, a);
    }
    const next: ColState[] = previewData.columns.map((col, idx) => {
      const type = previewData.columnTypes?.[idx] ?? 'string';
      const savedAgg = aggByCol.get(col);
      return {
        name: col,
        type,
        isGrouped: gbSet.has(col),
        func: savedAgg?.func ?? '',
        alias: savedAgg?.alias ?? '',
      };
    });
    setCols(next);
    if (!readOnly) {
      flushToConfig(next);
    }
  }, [node.id, previewColumnsSig, groupBySig, aggregationsSig, previewData, readOnly, flushToConfig]);

  // ── 列状态变更 ───────────────────────────────────────────────
  const toggleGroup = (name: string, checked: boolean) => {
    const next = cols.map((c) =>
      c.name === name ? { ...c, isGrouped: checked, func: checked ? '' : c.func, alias: '' } : c,
    );
    setCols(next);
    flushToConfig(next);
  };

  const setFunc = (name: string, func: string) => {
    const next = cols.map((c) =>
      c.name === name ? { ...c, func, isGrouped: false, alias: func ? `${func}_${c.name}` : '' } : c,
    );
    setCols(next);
    flushToConfig(next);
  };

  const setAlias = (name: string, alias: string) => {
    const next = cols.map((c) => (c.name === name ? { ...c, alias } : c));
    setCols(next);
    flushToConfig(next);
  };

  // ── 校验：存在分组列时，未选分组的列必须汇总 ────────────────────
  const hasGroup = cols.some((c) => c.isGrouped);
  const ungroupedWithNoAgg = cols.filter((c) => !c.isGrouped && !c.func);
  const validationError =
    hasGroup && ungroupedWithNoAgg.length > 0
      ? `以下 ${ungroupedWithNoAgg.length} 个非分组列未选汇总方式：${ungroupedWithNoAgg.map((c) => c.name).join('、')}。SQL 将仅输出分组列，结果可能为空。`
      : null;

  // ── SQL 预览（展示用 upstream；落库用 {prev_table}，见 flushToConfig） ──
  const sqlPreview = useMemo(() => formatAggregateSql(cols, 'FROM upstream'), [cols]);

  // ── 渲染 ─────────────────────────────────────────────────────
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

  if (!upstreamDsId) {
    return (
      <Alert
        type="warning"
        showIcon
        message="无法确定数据源"
        description="请检查上游数据源节点的数据库配置。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  return (
    <div>
      {previewError ? (
        <Alert
          type="error"
          message="加载上游列信息失败"
          description={previewError}
          style={{ fontSize: 11, marginBottom: 12 }}
        />
      ) : null}
      {previewLoading && !previewData?.columns?.length ? (
        <div style={{ padding: '12px 0', textAlign: 'center', marginBottom: 12 }}>
          <Spin size="small" />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
            正在加载上游列结构…
          </Text>
        </div>
      ) : null}

      {/* 按列配置 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
          <Text strong style={{ fontSize: 13 }}>
            <BarChartOutlined style={{ marginRight: 6 }} />
            按列配置
          </Text>
          <Tag style={{ fontSize: 10, background: '#F0FDF4', color: '#22C55E', border: 'none' }}>GROUP BY</Tag>
          <Tag style={{ fontSize: 10, background: '#EDE9FE', color: '#8B5CF6', border: 'none' }}>汇总</Tag>
          <Tag style={{ fontSize: 10, background: '#FEF3C7', color: '#D97706', border: 'none' }}>别名</Tag>
        </div>

        {/* 列配置 Table */}
        <Table
          size="small"
          dataSource={cols}
          rowKey="name"
          pagination={false}
          scroll={{ x: 500, y: 300 }}
          columns={[
            {
              title: '字段名',
              dataIndex: 'name',
              key: 'name',
              width: 130,
              fixed: 'left' as const,
              render: (name: string, record: ColState) => {
                const info = getDataTypeInfo(record.type);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Tag
                      style={{
                        background: info.bg,
                        color: info.text,
                        border: 'none',
                        fontSize: 9,
                        padding: '0 3px',
                        flexShrink: 0,
                      }}
                    >
                      {info.label}
                    </Tag>
                    <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{name}</span>
                  </div>
                );
              },
            },
            {
              title: '分组 (GROUP BY)',
              dataIndex: 'isGrouped',
              key: 'isGrouped',
              width: 100,
              align: 'center' as const,
              render: (isGrouped: boolean, record: ColState) => (
                <Switch
                  size="small"
                  checked={isGrouped}
                  disabled={readOnly || !!record.func}
                  onChange={(checked) => toggleGroup(record.name, checked)}
                  checkedChildren="分组"
                  unCheckedChildren="—"
                  style={{ fontSize: 10 }}
                />
              ),
            },
            {
              title: '汇总方式',
              dataIndex: 'func',
              key: 'func',
              width: 150,
              render: (func: string, record: ColState) => (
                <Select
                  size="small"
                  value={func || undefined}
                  onChange={(val) => setFunc(record.name, val ?? '')}
                  disabled={readOnly || record.isGrouped}
                  style={{ width: '100%' }}
                  showSearch
                  options={AGGREGATE_FUNCTIONS.map((fn) => ({
                    label: fn.label,
                    value: fn.value,
                  }))}
                />
              ),
            },
            {
              title: '输出别名',
              dataIndex: 'alias',
              key: 'alias',
              width: 130,
              render: (alias: string, record: ColState) => (
                <Input
                  size="small"
                  value={alias}
                  onChange={(e) => setAlias(record.name, e.target.value)}
                  disabled={readOnly || !record.func}
                  placeholder={record.func ? `${record.func}_${record.name}` : '—'}
                  style={{ fontSize: 11, fontFamily: 'monospace' }}
                />
              ),
            },
          ]}
        />
      </div>

      {/* 校验警告 */}
      {validationError && (
        <Alert
          type="warning"
          showIcon
          icon={<InfoCircleOutlined />}
          message={validationError}
          style={{ marginBottom: 10, fontSize: 11 }}
        />
      )}

      <Divider style={{ margin: '0 0 10px' }} />

      {/* 区块 C：SQL 预览 */}
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
        生成的查询：
      </Text>
      <div
        style={{
          padding: '6px 10px',
          background: '#f5f7fa',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#595959',
          minHeight: 28,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {sqlPreview ? (
          <span>{sqlPreview}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>（请先在「按列配置」中选择分组列或汇总方式）</span>
        )}
      </div>
    </div>
  );
};
