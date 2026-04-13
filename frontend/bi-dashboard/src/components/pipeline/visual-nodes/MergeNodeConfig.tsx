/**
 * MergeNodeConfig - 合并节点（concat）：UNION ALL / UNION 纵向拼接
 * 列映射 UI：垂直表格布局
 * - 第一行：输出列名（列头）
 * - 后续行：每个上游一行
 * - 单元格：下拉框选择该上游的列对应到哪个输出列
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Divider, Tag, Typography,
  Alert, Card, Spin, Radio,
  Select, Input, Button, Space,
  Table,
} from 'antd';
import { ColumnHeightOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';
import {
  buildMergePersistedSql,
  type UnionColumnPlanRow,
} from '../../../utils/pipelineMergeSql';

const { Text } = Typography;

export type ConcatMergeType = 'union_all' | 'union';

export const CONCAT_MERGE_OPTIONS = [
  {
    value: 'union_all' as ConcatMergeType,
    label: 'UNION ALL',
    desc: '纵向拼接所有行，保留重复（效率高）',
    color: '#6366F1',
  },
  {
    value: 'union' as ConcatMergeType,
    label: 'UNION',
    desc: '纵向拼接并自动去重',
    color: '#0EA5E9',
  },
];

function newRowId(): string {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function shortTableLabel(node: GraphNode): string {
  const pn = node.data.pipelineNode as PipelineNode;
  const cfg = (pn.config || {}) as Record<string, unknown>;
  const t = (cfg.tableName as string) || (cfg.table_name as string) || '';
  if (t) return t;
  const sql = typeof pn.sql === 'string' ? pn.sql : '';
  const m = sql.match(/FROM\s+[`"]?([a-zA-Z0-9_]+)[`"]?/i);
  return m ? m[1] : pn.name || '表';
}

interface MergeNodeConfigProps {
  node: GraphNode;
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

function useUpstreamPreviews(upstreamNodes: GraphNode[], pipelineDataSourceId: number | null, allNodes: GraphNode[]) {
  const MAX_PREVIEWS = 6;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h0 = useNodePreview();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h1 = useNodePreview();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h2 = useNodePreview();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h3 = useNodePreview();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h4 = useNodePreview();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const h5 = useNodePreview();
  const hooks = [h0, h1, h2, h3, h4, h5];

  useEffect(() => {
    upstreamNodes.slice(0, MAX_PREVIEWS).forEach((upNode, idx) => {
      const ds = resolvePreviewDataSourceId(
        upNode.data.pipelineNode as PipelineNode,
        pipelineDataSourceId ?? null
      );
      if (!upNode || !ds) return;
      hooks[idx].clearPreview();
      hooks[idx].loadPreview(
        { node: upNode, allNodes, pipelineDataSourceId: ds, limit: 30 },
        true
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNodes.map(n => n.id).join(','), pipelineDataSourceId]);

  return hooks;
}

export const MergeNodeConfig: React.FC<MergeNodeConfigProps> = ({
  node,
  allNodes,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;

  const savedMergeType = (config.merge_type as string) || 'union_all';
  const mergeType: ConcatMergeType = savedMergeType === 'union' ? 'union' : 'union_all';

  const [currentMergeType, setCurrentMergeType] = useState<ConcatMergeType>(
    mergeType === 'union' ? 'union' : 'union_all'
  );

  useEffect(() => {
    setCurrentMergeType(savedMergeType === 'union' ? 'union' : 'union_all');
  }, [savedMergeType, node.id]);

  const upstream = (pipelineNode.upstream as string[]) || [];
  const upstreamNodes = upstream
    .map(id => allNodes.find(n => n.id === id))
    .filter(Boolean) as GraphNode[];

  const previewHooks = useUpstreamPreviews(upstreamNodes, pipelineDataSourceId ?? null, allNodes);

  // colMatrix[upstreamIdx] = column names of that upstream
  const colMatrix = useMemo(
    () => upstreamNodes.map((_, idx) => previewHooks[idx]?.previewData?.columns ?? []),
    [upstreamNodes, previewHooks]
  );

  // max column count across all upstreams
  const maxColCount = useMemo(() => Math.max(0, ...colMatrix.map(c => c.length)), [colMatrix]);

  // output column names from plan
  const outputColumns = useMemo(() => {
    const savedPlan: UnionColumnPlanRow[] = Array.isArray(config.unionColumnPlan)
      ? (config.unionColumnPlan as UnionColumnPlanRow[])
      : [];
    if (savedPlan.length > 0) {
      return savedPlan.map(row => row.out);
    }
    // Default: col_1, col_2, ...
    return Array.from({ length: maxColCount }, (_, i) => `col_${i + 1}`);
  }, [config.unionColumnPlan, maxColCount]);

  const allPreviewsDone = upstreamNodes.every(
    (_, idx) => !previewHooks[idx]?.previewLoading
  );
  const hasColumnInfo = colMatrix.some(c => c.length > 0);

  // 当前 plan（从 node.config 读取）
  const savedPlan: UnionColumnPlanRow[] = Array.isArray(config.unionColumnPlan)
    ? (config.unionColumnPlan as UnionColumnPlanRow[])
    : [];

  /**
   * 生成默认 plan：按列位置生成 outputRowCount 行，
   * 每个上游的 cols[i] = 该上游的第 i 列（超出范围的为 ''）
   */
  const buildDefaultPlan = useCallback(
    (outputRowCount: number): UnionColumnPlanRow[] => {
      return Array.from({ length: outputRowCount }, (_, i) => ({
        id: newRowId(),
        out: `col_${i + 1}`,
        cols: colMatrix.map(cols => (cols[i] != null ? cols[i] : '')),
      }));
    },
    [colMatrix]
  );

  /**
   * 将当前 plan 的 cols 数量与上游个数对齐
   */
  const alignPlanToUpstreams = useCallback(
    (plan: UnionColumnPlanRow[]): UnionColumnPlanRow[] => {
      const n = upstreamNodes.length;
      if (n === 0) return [];
      let dirty = false;
      const next = plan.map(row => {
        const cols = [...(row.cols || [])];
        while (cols.length < n) { cols.push(''); dirty = true; }
        if (cols.length > n) { cols.length = n; dirty = true; }
        return { ...row, cols };
      });
      return dirty ? next : plan;
    },
    [upstreamNodes.length]
  );

  const persistMerge = useCallback(
    (plan: UnionColumnPlanRow[], mt: ConcatMergeType) => {
      if (readOnly || upstreamNodes.length < 2) return;
      const pn = node.data.pipelineNode as Record<string, unknown>;
      const prevCfg = { ...(pn.config as Record<string, unknown>) };
      const sql = buildMergePersistedSql(
        mt === 'union' ? 'union' : 'union_all',
        upstreamNodes.length,
        plan.length > 0 ? plan : undefined
      );
      // 同时更新顶层 merge_type（后端执行时读取）和 config.merge_type（持久化配置）
      node.data = {
        ...node.data,
        pipelineNode: {
          ...pn,
          merge_type: mt === 'union' ? 'union' : 'union all',
          sql,
          config: {
            ...prevCfg,
            merge_type: mt,
            unionColumnPlan: plan.length > 0 ? plan : undefined,
          },
        },
      };
      setCurrentMergeType(mt);
      onChange();
    },
    [readOnly, node, upstreamNodes.length, onChange]
  );

  // ── 初始化 plan：上游列就绪后，若无 plan 或列数变化，按最多列的上游生成默认映射 ──
  useEffect(() => {
    if (readOnly || upstreamNodes.length < 2 || !allPreviewsDone || !hasColumnInfo) return;
    const existing = (node.data.pipelineNode as PipelineNode).config?.unionColumnPlan as
      | UnionColumnPlanRow[]
      | undefined;

    if (Array.isArray(existing) && existing.length > 0) {
      const aligned = alignPlanToUpstreams(existing);
      if (aligned !== existing) persistMerge(aligned, currentMergeType);
      return;
    }

    const plan = buildDefaultPlan(maxColCount);
    persistMerge(plan, currentMergeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    readOnly,
    node.id,
    allPreviewsDone,
    hasColumnInfo,
    maxColCount,
    JSON.stringify(colMatrix),
  ]);

  // ── 上游个数变化时，补齐每行 cols ──
  useEffect(() => {
    if (readOnly || upstreamNodes.length < 2) return;
    const existing = (node.data.pipelineNode as PipelineNode).config?.unionColumnPlan as
      | UnionColumnPlanRow[]
      | undefined;
    if (!Array.isArray(existing) || existing.length === 0) return;
    const aligned = alignPlanToUpstreams(existing);
    if (aligned !== existing) persistMerge(aligned, currentMergeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNodes.length, readOnly, node.id]);

  const handleMergeTypeChange = (val: ConcatMergeType) => {
    const plan = ((node.data.pipelineNode as PipelineNode).config?.unionColumnPlan ||
      []) as UnionColumnPlanRow[];
    persistMerge(plan, val);
  };

  const planRows: UnionColumnPlanRow[] = savedPlan;

  // 从 plan 中获取当前输出列名
  const getOutputColumnName = (outIndex: number): string => {
    if (planRows.length > 0 && planRows[outIndex]) {
      return planRows[outIndex].out;
    }
    return `col_${outIndex + 1}`;
  };

  // 更新输出列名
  const updateOut = (index: number, out: string) => {
    persistMerge(
      planRows.map((r, i) => (i === index ? { ...r, out } : r)),
      currentMergeType
    );
  };

  // 更新单元格（下拉框选择）
  const updateCell = (rowIndex: number, upIdx: number, col: string) => {
    const row = planRows[rowIndex];
    if (!row) return;
    const cols = [...(row.cols || [])];
    while (cols.length < upstreamNodes.length) cols.push('');
    cols[upIdx] = col;
    persistMerge(planRows.map((r, i) => (i === rowIndex ? { ...r, cols } : r)), currentMergeType);
  };

  const addOutputColumn = () => {
    const n = upstreamNodes.length;
    persistMerge(
      [
        ...planRows,
        { id: newRowId(), out: `col_${planRows.length + 1}`, cols: Array(n).fill('') },
      ],
      currentMergeType
    );
  };

  const removeOutputColumn = (index: number) => {
    persistMerge(planRows.filter((_, i) => i !== index), currentMergeType);
  };

  const loadingCount = previewHooks.filter(h => h.previewLoading).length;
  const anyError = previewHooks.some(h => h.previewError);

  const displaySql = buildMergePersistedSql(
    currentMergeType === 'union' ? 'union' : 'union_all',
    upstreamNodes.length,
    planRows.length > 0 ? planRows : undefined
  );

  // ── Table 列定义 ──
  // 第一列是"上游表"名称，后续列是输出列名
  const tableColumns = [
    {
      title: '上游表',
      dataIndex: 'tableName',
      key: 'tableName',
      width: 140,
      fixed: 'left' as const,
      render: (_: unknown, __: unknown, index: number) => {
        // 第一行是"输出列"标题行，返回 null
        if (index === 0) return null;
        const upIdx = index - 1;
        const upNode = upstreamNodes[upIdx];
        if (!upNode) return null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tag color="orange">{upIdx + 1}</Tag>
            <Text style={{ fontSize: 12 }}>{shortTableLabel(upNode)}</Text>
          </div>
        );
      },
    },
    // 动态生成输出列
    ...outputColumns.map((outCol, outIdx) => ({
      title: readOnly ? (
        <Text strong style={{ fontSize: 12 }}>{outCol}</Text>
      ) : (
        <Input
          size="small"
          value={outCol}
          onChange={e => updateOut(outIdx, e.target.value)}
          placeholder="列名"
          style={{ fontWeight: 600, fontSize: 12 }}
        />
      ),
      dataIndex: `out_${outIdx}`,
      key: `out_${outIdx}`,
      width: 130,
      render: (_: unknown, __: unknown, rowIdx: number) => {
        // 第一行是"输出列"标题行，显示说明文字
        if (rowIdx === 0) {
          return <Text type="secondary" style={{ fontSize: 11 }}>选择该上游的列</Text>;
        }
        const upIdx = rowIdx - 1;
        const hook = previewHooks[upIdx];
        const opts = (hook?.previewData?.columns || []).map(c => ({ value: c, label: c }));
        // 从 plan 中获取当前选择
        const currentVal = planRows[outIdx]?.cols?.[upIdx] ?? '';
        return readOnly ? (
          <Text type={currentVal ? 'secondary' : undefined} style={{ fontSize: 12 }}>
            {currentVal || <span style={{ color: '#bbb' }}>NULL</span>}
          </Text>
        ) : (
          <Select
            size="small"
            style={{ width: '100%' }}
            allowClear
            placeholder="NULL"
            value={currentVal || undefined}
            options={opts}
            onChange={v => updateCell(outIdx, upIdx, v ?? '')}
          />
        );
      },
    })),
    // 操作列（删除输出列）
    ...(readOnly
      ? []
      : [
          {
            title: '',
            dataIndex: 'action',
            key: 'action',
            width: 50,
            render: (_: unknown, __: unknown, index: number) => {
              // 第一行是"输出列"标题行
              if (index === 0) return null;
              return (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeOutputColumn(index)}
                />
              );
            },
          } as const,
        ]),
  ];

  // Table data
  // 第一行：输出列标题
  // 后续行：每个上游一行
  const tableData = [
    { key: 'header-row', tableName: '输出列' },
    ...upstreamNodes.map((upNode, upIdx) => ({ key: upNode.id || upIdx, tableName: shortTableLabel(upNode) })),
  ];

  if (upstreamNodes.length < 2) {
    return (
      <Alert
        type="info"
        showIcon
        message="需要至少两个上游节点"
        description="合并节点将多个上游纵向拼接，请先连接至少两个节点。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <ColumnHeightOutlined style={{ marginRight: 6 }} />
          合并方式
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          纵向堆叠，无须关联键
        </Text>
      </div>

      <Radio.Group
        value={currentMergeType}
        onChange={e => handleMergeTypeChange(e.target.value as ConcatMergeType)}
        disabled={readOnly}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {CONCAT_MERGE_OPTIONS.map(opt => (
          <Card
            key={opt.value}
            size="small"
            bodyStyle={{ padding: '10px 12px' }}
            style={{
              borderColor: currentMergeType === opt.value ? opt.color : undefined,
              background: currentMergeType === opt.value ? `${opt.color}08` : undefined,
            }}
          >
            <Radio value={opt.value}>
              <Text strong style={{ color: opt.color }}>
                {opt.label}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                {opt.desc}
              </Text>
            </Radio>
          </Card>
        ))}
      </Radio.Group>

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>上游数据预览</Text>
        {loadingCount > 0 && <Spin size="small" />}
        <Text type="secondary" style={{ fontSize: 11 }}>
          {upstreamNodes.length} 个上游 · {loadingCount > 0 ? '加载中…' : '已就绪'}
        </Text>
      </div>

      {anyError && (
        <Alert
          type="warning"
          showIcon
          message="部分上游数据加载失败"
          description={previewHooks.find(h => h.previewError)?.previewError}
          style={{ marginBottom: 8, fontSize: 11 }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {upstreamNodes.map((upNode, idx) => {
          const hook = previewHooks[idx];
          const cols = hook.previewData?.columns || [];
          const previewing = hook.previewLoading;
          const label = shortTableLabel(upNode);
          return (
            <Card
              key={upNode.id}
              size="small"
              bodyStyle={{ padding: '6px 10px' }}
              title={
                <span style={{ fontSize: 12 }}>
                  <Tag style={{ marginRight: 4 }}>{idx + 1}</Tag>
                  {label}
                  <span style={{ color: '#999', marginLeft: 6, fontSize: 11 }}>
                    {cols.length} 列
                  </span>
                </span>
              }
            >
              {previewing ? (
                <div style={{ textAlign: 'center', padding: 8 }}>
                  <Spin size="small" />
                </div>
              ) : cols.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 11 }}>未获取到列信息</Text>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {cols.map(col => (
                    <Tag key={col} style={{ fontSize: 11, margin: 0 }}>
                      {col}
                    </Tag>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>列映射（纵向拼接）</Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          每列选择对应上游的字段，上下对齐
        </Text>
      </div>

      {planRows.length === 0 && allPreviewsDone && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          正在根据上游列生成映射…
        </Text>
      )}

      <Table
        size="small"
        bordered
        columns={tableColumns}
        dataSource={tableData}
        pagination={false}
        scroll={{ x: true }}
        style={{ marginBottom: 8 }}
      />

      {!readOnly && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={addOutputColumn}
        >
          添加输出列
        </Button>
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      <Text type="secondary" style={{ fontSize: 11 }}>生成的查询：</Text>
      <pre
        style={{
          marginTop: 4,
          padding: '6px 10px',
          background: '#f5f7fa',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#595959',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          marginBottom: 0,
        }}
      >
        {displaySql}
      </pre>

      {currentMergeType === 'union' && (
        <Alert
          type="info"
          showIcon
          message="UNION 会去重"
          description="请通过列映射保证各分支列数与顺序一致；未选的列将以 NULL 占位。"
          style={{ marginTop: 8, fontSize: 11 }}
        />
      )}
    </div>
  );
};
