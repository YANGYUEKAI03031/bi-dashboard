/**
 * 画布底部数据浏览区：单击节点在此预览表格（与右侧配置分离）。
 * 固定内部表格容器高度，避免渲染/加载时高度变化触发 ReactFlow ResizeObserver 循环。
 *
 * 工具栏提供列选（写入节点 config.outputColumnKeys）和行筛选（写入
 * config.rowFilterConditions / config.rowFilterLogic），均由后端折叠 SQL 时应用。
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Empty, Select, Spin, Typography, Button, Popover, Space, Tag,
  Input, Tooltip, Alert, Checkbox, Divider, Modal, Radio, message,
  DatePicker } from 'antd';
import { CalendarOutlined, ReloadOutlined, FilterOutlined, DeleteOutlined, PlusOutlined, TableOutlined, BarChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { GraphNode, GraphEdge } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';
import { getNodeTypeDef } from '../../utils/nodeTypeRegistry';
import { resolvePreviewDataSourceId } from '../../utils/pipelineDataSourceUtils';
import { NodePreviewTable } from './NodePreviewTable';
import { InsertColumnModal, InsertedColumnConfig } from './InsertColumnModal';
import { ChartNodePreview } from './visual-nodes/ChartNodePreview';
import { useNodePreview } from '../../hooks/useNodePreview';
import { PREVIEW_COLUMN_DISPLAY_AUTO } from '../../constants/previewColumnDisplay';
import {
  ChartNodeConfig,
  DEFAULT_CHART_CONFIG,
  ChartType,
} from '../../types/chartNode';
import { DATE_PRESETS } from './visual-nodes/FilterNodeConfig';

const { Text } = Typography;

export interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
  preset?: string;  // 日期快捷选项
  rangeStart?: string;
  rangeEnd?: string;
}

// 日期类型专用的相对日期操作符
const DATE_FILTER_OPERATORS = [
  { label: '早于', value: 'before' },
  { label: '晚于', value: 'after' },
  { label: '介于', value: 'between' },
  { label: '快捷日期', value: 'preset' },
];

export const FILTER_OPERATORS = [
  { label: '等于', value: 'eq' },
  { label: '不等于', value: 'ne' },
  { label: '大于', value: 'gt' },
  { label: '大于等于', value: 'ge' },
  { label: '小于', value: 'lt' },
  { label: '小于等于', value: 'le' },
  { label: '包含', value: 'contains' },
  { label: '开头是', value: 'startsWith' },
  { label: '结尾是', value: 'endsWith' },
  { label: '为空', value: 'isNull' },
  { label: '不为空', value: 'isNotNull' },
  { label: '在列表中', value: 'in' },
];

interface PipelineCanvasPreviewPanelProps {
  previewNode: GraphNode | null;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  pipelineDataSourceId?: number | null;
  refreshTick?: number;
  onNodeUpdate?: (updatedNode: GraphNode) => void;
}

/** 渲染单条筛选条件行 */
function ConditionRow({
  cond,
  columns,
  columnTypes,
  readOnly,
  onChange,
  onRemove,
}: {
  cond: Condition;
  columns: string[];
  columnTypes?: Record<string, string>;
  readOnly: boolean;
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}) {
  const colType = columnTypes?.[cond.column];
  const isDateType = colType === 'date' || colType === 'datetime';

  // 日期类型：使用日期专用操作符 + 标准操作符
  const availableOps = isDateType
    ? [...DATE_FILTER_OPERATORS, ...FILTER_OPERATORS.filter(op => !['isNull', 'isNotNull'].includes(op.value))]
    : FILTER_OPERATORS;

  const needsValue = !['isNull', 'isNotNull'].includes(cond.operator);
  const isDateComparison = isDateType && needsValue;
  const isPresetOp = cond.operator === 'preset';
  const isBetweenOp = cond.operator === 'between';
  const needsQuickDate = isPresetOp;
  const needsRangePicker = isBetweenOp;
  const needsDatePicker = isDateComparison && !needsQuickDate && !needsRangePicker;
  const showNormalInput = needsValue && !isDateComparison;

  return (
    <Space size={4} style={{ marginBottom: 6 }} wrap>
      <Select
        size="small"
        placeholder="字段"
        style={{ width: 110 }}
        value={cond.column || undefined}
        onChange={(v) => onChange({ ...cond, column: v, operator: '', value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined })}
        options={columns.map((c) => ({ label: c, value: c }))}
        showSearch
        allowClear
        disabled={readOnly}
      />
      <Select
        size="small"
        placeholder="条件"
        style={{ width: 90 }}
        value={cond.operator || undefined}
        onChange={(v) => onChange({ ...cond, operator: v, value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined })}
        options={availableOps.map(op => ({ label: op.label, value: op.value }))}
        disabled={readOnly}
      />
      {showNormalInput && (
        <Input
          size="small"
          placeholder="值"
          style={{ width: 100 }}
          value={cond.value}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          disabled={readOnly}
        />
      )}
      {/* 日期比较操作符对应的值输入 */}
      {needsDatePicker && (
        <DatePicker
          size="small"
          style={{ width: 130 }}
          value={dayjs(cond.value || cond.rangeStart)}
          onChange={(date) => onChange({ ...cond, value: date?.format('YYYY-MM-DD') || '', rangeStart: undefined, rangeEnd: undefined, preset: undefined })}
          format="YYYY-MM-DD"
          placeholder="选择日期"
          disabled={readOnly}
        />
      )}
      {/* 快捷日期（preset）下拉选择 */}
      {needsQuickDate && (
        <Select
          size="small"
          placeholder="快捷日期"
          style={{ width: 140 }}
          value={cond.preset || undefined}
          onChange={(v) => onChange({ ...cond, preset: v, value: '', rangeStart: '', rangeEnd: '' })}
          options={DATE_PRESETS.map(p => ({ label: p.label, value: p.value }))}
          suffixIcon={<CalendarOutlined />}
          disabled={readOnly}
        />
      )}
      {/* 介于（between）- 两个日期选择器 */}
      {needsRangePicker && (
        <Space size={4}>
          <DatePicker
            size="small"
            style={{ width: 110 }}
            value={cond.rangeStart ? dayjs(cond.rangeStart) : null}
            onChange={(date) => onChange({ ...cond, rangeStart: date?.format('YYYY-MM-DD') || '' })}
            format="YYYY-MM-DD"
            placeholder="开始"
            disabled={readOnly}
          />
          <span style={{ color: '#999', fontSize: 11 }}>至</span>
          <DatePicker
            size="small"
            style={{ width: 110 }}
            value={cond.rangeEnd ? dayjs(cond.rangeEnd) : null}
            onChange={(date) => onChange({ ...cond, rangeEnd: date?.format('YYYY-MM-DD') || '' })}
            format="YYYY-MM-DD"
            placeholder="结束"
            disabled={readOnly}
          />
        </Space>
      )}
      {!readOnly && (
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={onRemove}
          danger
        />
      )}
    </Space>
  );
}

/** 筛选条件编辑器浮层 */
function FilterEditor({
  columns,
  columnTypes,
  conditions,
  logic,
  readOnly,
  onConditionsChange,
  onLogicChange,
  onConfirm,
  onCancel,
}: {
  columns: string[];
  columnTypes?: Record<string, string>;
  conditions: Condition[];
  logic: string;
  readOnly: boolean;
  onConditionsChange: (cs: Condition[]) => void;
  onLogicChange: (l: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const activeCount = conditions.filter((c) => c.column && c.operator).length;
  const addCondition = () =>
    onConditionsChange([
      ...conditions,
      { id: `cond_${Date.now()}`, column: '', operator: '', value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined },
    ]);
  return (
    <div style={{ width: 380 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text strong style={{ fontSize: 12 }}>行筛选</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {activeCount} 个条件
        </Text>
        <Space size={4}>
          <Tag
            style={{ cursor: 'pointer', fontSize: 11 }}
            color={logic === 'AND' ? 'blue' : 'default'}
            onClick={() => !readOnly && onLogicChange('AND')}
          >
            且 AND
          </Tag>
          <Tag
            style={{ cursor: 'pointer', fontSize: 11 }}
            color={logic === 'OR' ? 'blue' : 'default'}
            onClick={() => !readOnly && onLogicChange('OR')}
          >
            或 OR
          </Tag>
        </Space>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {conditions.map((cond) => (
          <ConditionRow
            key={cond.id}
            cond={cond}
            columns={columns}
            columnTypes={columnTypes}
            readOnly={readOnly}
            onChange={(updated) =>
              onConditionsChange(
                conditions.map((c) => (c.id === updated.id ? updated : c))
              )
            }
            onRemove={() =>
              onConditionsChange(
                conditions.length > 1
                  ? conditions.filter((c) => c.id !== cond.id)
                  : [{ id: cond.id, column: '', operator: '', value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined }]
              )
            }
          />
        ))}
      </div>
      {!readOnly && (
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined />}
          onClick={addCondition}
          style={{ padding: '2px 0', marginTop: 4 }}
        >
          添加条件
        </Button>
      )}
      {(onConfirm || onCancel) && (
        <div style={{ textAlign: 'right', marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
          {onCancel && (
            <Button size="small" onClick={onCancel}>
              取消
            </Button>
          )}
          {onConfirm && (
            <Button type="primary" size="small" style={{ marginLeft: 6 }} onClick={onConfirm}>
              应用
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function previewDatasetTitle(node: GraphNode): string {
  const pn = node.data.pipelineNode as PipelineNode;
  const cfg = (pn.config || {}) as Record<string, unknown>;
  if (pn.type === 'source' && typeof cfg.tableName === 'string' && cfg.tableName) {
    return cfg.tableName;
  }
  return pn.name || '数据预览';
}

export const PipelineCanvasPreviewPanel: React.FC<PipelineCanvasPreviewPanelProps> = ({
  previewNode,
  allNodes,
  allEdges,
  pipelineDataSourceId,
  refreshTick = 0,
  onNodeUpdate,
}) => {
  const { previewData, previewLoading, previewError, loadPreview, clearPreview } = useNodePreview();
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [insertColumnModalOpen, setInsertColumnModalOpen] = useState(false);
  const [insertColumnSourceColumn, setInsertColumnSourceColumn] = useState<string | undefined>();
  const [insertColumnEditConfig, setInsertColumnEditConfig] = useState<InsertedColumnConfig | undefined>();

  /** 图表预览模式：table | chart */
  const [previewMode, setPreviewMode] = useState<'table' | 'chart'>('table');

  const pipelineNode = previewNode?.data?.pipelineNode as PipelineNode | undefined;
  const nodeDef = pipelineNode ? getNodeTypeDef(pipelineNode.type) : null;
  const resolvedDsId = useMemo(
    () => resolvePreviewDataSourceId(pipelineNode, pipelineDataSourceId),
    [pipelineNode, pipelineDataSourceId]
  );

  const previewConfigKey = useMemo(() => {
    if (!previewNode) return '';
    const pn = previewNode.data.pipelineNode as PipelineNode | undefined;
    const config = pn?.config || {};
    return JSON.stringify({
      xField: config.xField,
      yFields: config.yFields,
      chartType: config.chartType,
      previewColumnFormats: config.previewColumnFormats,
      outputColumnKeys: config.outputColumnKeys,
      rowFilterConditions: config.rowFilterConditions,
      rowFilterLogic: config.rowFilterLogic,
      insertedColumns: config.insertedColumns,
    }) + `:tick:${refreshTick}`;
  }, [previewNode, refreshTick]);

  const graphTopologySig = useMemo(() => {
    const ids = allNodes.map((x) => x.id).sort().join(',');
    const es = allEdges.map((x) => `${x.source}-${x.target}`).sort().join('|');
    return `${ids}|${es}`;
  }, [allNodes, allEdges]);

  const allNodesDataSig = useMemo(
    () =>
      allNodes
        .map((n) => {
          const pn = n.data.pipelineNode as PipelineNode;
          let upstreamSig = '';
          if (pn.upstream && pn.upstream.length) {
            upstreamSig = [...pn.upstream].sort().join(',');
          }
          return `${n.id}:${pn.type}:${JSON.stringify(pn.config ?? {})}:${pn.sql ?? ''}:up=${upstreamSig}`;
        })
        .sort()
        .join('\n'),
    [allNodes]
  );

  const columnTypesMap = useMemo((): Record<string, string> => {
    if (!previewData?.columns || !previewData.columnTypes) {
      return {};
    }
    const map: Record<string, string> = {};
    previewData.columns.forEach((col, idx) => {
      map[col] = previewData.columnTypes?.[idx] || 'string';
    });
    return map;
  }, [previewData?.columns, previewData?.columnTypes]);

  useEffect(() => {
    if (!previewNode || !nodeDef?.hasPreview) {
      clearPreview();
      setVisibleColumnKeys([]);
      setPreviewMode('table');
      return;
    }
    loadPreview(
      {
        node: previewNode,
        allNodes,
        pipelineDataSourceId: resolvedDsId,
        limit: 100,
      },
      true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewNode?.id,
    previewConfigKey,
    pipelineNode?.type,
    graphTopologySig,
    allNodesDataSig,
    resolvedDsId,
    nodeDef?.hasPreview,
    loadPreview,
    clearPreview,
  ]);

  /** 节点 config 中的筛选/列选配置（由本组件写入，供后端折叠 SQL 时使用） */
  const savedRowConditions = ((pipelineNode?.config as Record<string, unknown>)?.rowFilterConditions as Condition[]) || [];
  const savedRowLogic = ((pipelineNode?.config as Record<string, unknown>)?.rowFilterLogic as string) || 'AND';
  const savedOutputKeys = useMemo(
    () => ((pipelineNode?.config as Record<string, unknown>)?.outputColumnKeys as string[]) || [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewConfigKey]
  );

  const [localConditions, setLocalConditions] = useState<Condition[]>([
    { id: 'cond_0', column: '', operator: '', value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined },
  ]);
  const [localLogic, setLocalLogic] = useState<string>('AND');

  useEffect(() => {
    if (!previewNode) return;
    const conds = [...savedRowConditions];
    setLocalConditions(conds.length > 0 ? conds : [{ id: 'cond_0', column: '', operator: '', value: '', preset: undefined, rangeStart: undefined, rangeEnd: undefined }]);
    setLocalLogic(savedRowLogic || 'AND');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewNode?.id, previewConfigKey]);

  useEffect(() => {
    setFilterOpen(false);
  }, [previewNode?.id]);

  useEffect(() => {
    setColumnPickerOpen(false);
  }, [previewNode?.id]);

  const dataCols = previewData?.columns ?? [];
  const columnCatalog =
    previewData?.allColumns && previewData.allColumns.length > 0
      ? previewData.allColumns
      : dataCols;

  // 合并所有上游节点的 previewColumnFormats
  const mergedPreviewFormats = useMemo((): Record<string, string> | undefined => {
    if (!previewNode || !allNodes) return undefined;

    // 首先收集当前节点的 formats
    const currentFormats = ((pipelineNode?.config as Record<string, unknown>)?.previewColumnFormats) as Record<string, string> | undefined;
    const result: Record<string, string> = {};

    // 如果当前节点有格式设置，优先使用
    if (currentFormats && typeof currentFormats === 'object') {
      Object.assign(result, currentFormats);
    }

    // 如果结果已满（当前节点设置了所有列的格式），直接返回
    const colsSet = new Set(columnCatalog);
    const formattedCols = new Set(Object.keys(result));
    if (formattedCols.size >= colsSet.size && [...colsSet].every(c => formattedCols.has(c))) {
      return Object.keys(result).length > 0 ? result : undefined;
    }

    // 否则，从上游节点继承格式（按拓扑顺序）
    const getUpstreamIds = (nodeId: string, visited: Set<string> = new Set()): string[] => {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);
      const node = allNodes.find(n => n.id === nodeId);
      if (!node) return [];
      const pn = node.data.pipelineNode as PipelineNode | undefined;
      const upstream = pn?.upstream || [];
      let ids: string[] = [];
      for (const upId of upstream) {
        ids.push(upId);
        ids = ids.concat(getUpstreamIds(upId, visited));
      }
      return ids;
    };

    const upstreamIds = getUpstreamIds(previewNode.id);
    for (const upId of upstreamIds) {
      const upNode = allNodes.find(n => n.id === upId);
      if (!upNode) continue;
      const upPn = upNode.data.pipelineNode as PipelineNode | undefined;
      const upFormats = (upPn?.config as Record<string, unknown>)?.previewColumnFormats as Record<string, string> | undefined;
      if (upFormats && typeof upFormats === 'object') {
        for (const [col, fmt] of Object.entries(upFormats)) {
          if (colsSet.has(col) && !(col in result)) {
            result[col] = fmt;
          }
        }
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewNode, allNodes, pipelineNode?.config, previewConfigKey, columnCatalog]);

  const columnRenames = useMemo((): Record<string, string> | undefined => {
    if (!previewNode || !allNodes) return undefined;

    const result: Record<string, string> = {};

    if (pipelineNode?.config) {
      const cfg = pipelineNode.config as Record<string, unknown>;
      const currentRenames = cfg.columnRenames as Record<string, string> | undefined;
      if (currentRenames && typeof currentRenames === 'object') {
        Object.assign(result, currentRenames);
      }
    }

    const colsSet = new Set(columnCatalog);
    if (colsSet.size > 0 && Object.keys(result).length >= colsSet.size) {
      return Object.keys(result).length > 0 ? result : undefined;
    }

    const getUpstreamIds = (nodeId: string, visited: Set<string> = new Set()): string[] => {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);
      const node = allNodes.find(n => n.id === nodeId);
      if (!node) return [];
      const pn = node.data.pipelineNode as PipelineNode | undefined;
      const upstream = pn?.upstream || [];
      let ids: string[] = [];
      for (const upId of upstream) {
        ids.push(upId);
        ids = ids.concat(getUpstreamIds(upId, visited));
      }
      return ids;
    };

    const upstreamIds = getUpstreamIds(previewNode.id);
    for (const upId of upstreamIds) {
      const upNode = allNodes.find(n => n.id === upId);
      if (!upNode) continue;
      const upPn = upNode.data.pipelineNode as PipelineNode | undefined;
      const upRenames = (upPn?.config as Record<string, unknown>)?.columnRenames as Record<string, string> | undefined;
      if (upRenames && typeof upRenames === 'object') {
        for (const [original, renamed] of Object.entries(upRenames)) {
          if (colsSet.has(original) && !(original in result)) {
            result[original] = renamed;
          }
        }
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }, [previewNode, allNodes, pipelineNode?.config, columnCatalog]);

  useEffect(() => {
    if (!previewNode) return;
    const cat =
      previewData?.allColumns && previewData.allColumns.length > 0
        ? previewData.allColumns
        : (previewData?.columns ?? []);
    if (!cat.length) {
      setVisibleColumnKeys([]);
      return;
    }
    if (savedOutputKeys.length > 0) {
      const filtered = savedOutputKeys.filter((k) => cat.includes(k));
      setVisibleColumnKeys(filtered.length ? filtered : [...cat]);
      return;
    }
    setVisibleColumnKeys([...cat]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewNode?.id,
    previewConfigKey,
    previewData?.columns?.join('\0'),
    previewData?.allColumns?.join('\0'),
    savedOutputKeys,
  ]);

  const catalogAllSelected =
    columnCatalog.length > 0 &&
    visibleColumnKeys.length === columnCatalog.length &&
    columnCatalog.every((c) => visibleColumnKeys.includes(c));
  const catalogIndeterminate =
    visibleColumnKeys.length > 0 &&
    visibleColumnKeys.length < columnCatalog.length &&
    !catalogAllSelected;

  const handleColumnSelect = (keys: string[]) => {
    if (!previewNode) return;
    const catalog = columnCatalog;
    if (!catalog.length) return;
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const isAll =
      keys.length === 0 ||
      (keys.length === catalog.length && catalog.every((c) => keys.includes(c)));
    const persisted: string[] = isAll ? [] : [...keys];
    const nextVisible = isAll ? [...catalog] : [...keys];
    setVisibleColumnKeys(nextVisible);
    if (onNodeUpdate) {
      const newCfg = {
        ...(pn.config as Record<string, unknown> || {}),
        outputColumnKeys: persisted,
      };
      onNodeUpdate({
        ...previewNode,
        data: {
          ...previewNode.data,
          pipelineNode: { ...pn, config: newCfg },
        },
      });
    }
  };

  const previewColumnFormats = mergedPreviewFormats;

  const handlePreviewColumnFormatChange = (columnKey: string, format: string) => {
    if (!previewNode || !onNodeUpdate) {
      return;
    }
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const cfg = { ...(pn.config as Record<string, unknown> || {}) };
    const prevRaw = cfg.previewColumnFormats;
    const nextFormats: Record<string, string> = {};
    if (prevRaw && Object.prototype.toString.call(prevRaw) === '[object Object]') {
      Object.assign(nextFormats, prevRaw as Record<string, string>);
    }
    if (format === PREVIEW_COLUMN_DISPLAY_AUTO) {
      delete nextFormats[columnKey];
    } else {
      nextFormats[columnKey] = format;
    }
    const newCfg = { ...cfg };
    if (Object.keys(nextFormats).length === 0) {
      delete newCfg.previewColumnFormats;
    } else {
      newCfg.previewColumnFormats = nextFormats;
    }
    onNodeUpdate({
      ...previewNode,
      data: {
        ...previewNode.data,
        pipelineNode: { ...pn, config: newCfg },
      },
    });
  };

  const handleConditionsChange = (cs: Condition[]) => {
    setLocalConditions(cs);
  };

  const handleLogicChange = (l: string) => {
    setLocalLogic(l);
  };

  const handleFilterConfirm = () => {
    if (!previewNode || !onNodeUpdate) return;
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const newCfg = {
      ...(pn.config as Record<string, unknown> || {}),
      rowFilterConditions: localConditions,
      rowFilterLogic: localLogic,
    };
    onNodeUpdate({
      ...previewNode,
      data: {
        ...previewNode.data,
        pipelineNode: { ...pn, config: newCfg },
      },
    });
    setFilterOpen(false);
  };

  const handleOpenInsertColumn = (sourceColumn?: string) => {
    if (previewLoading || !previewData) {
      loadPreview(
        {
          node: previewNode,
          allNodes,
          pipelineDataSourceId: resolvedDsId,
          limit: 100,
        },
        true
      ).then((result) => {
        const cols =
          result?.allColumns && result.allColumns.length > 0
            ? result.allColumns
            : (result?.columns ?? []);
        setInsertColumnSourceColumn(sourceColumn ?? cols[0]);
        setInsertColumnEditConfig(undefined);
        setInsertColumnModalOpen(true);
      });
    } else {
      setInsertColumnSourceColumn(sourceColumn ?? columnCatalog[0]);
      setInsertColumnEditConfig(undefined);
      setInsertColumnModalOpen(true);
    }
  };

  const handleEditInsertColumn = (config: InsertedColumnConfig) => {
    if (previewLoading || !previewData) {
      loadPreview(
        { node: previewNode, allNodes, pipelineDataSourceId: resolvedDsId, limit: 100 },
        true
      ).then(() => {
        setInsertColumnEditConfig(config);
        setInsertColumnModalOpen(true);
      });
    } else {
      setInsertColumnEditConfig(config);
      setInsertColumnModalOpen(true);
    }
  };

  const handleInsertColumn = (config: InsertedColumnConfig) => {
    if (!previewNode || !onNodeUpdate) return;
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const cfg = { ...(pn.config as Record<string, unknown> || {}) };
    const existingCols = (cfg.insertedColumns as InsertedColumnConfig[]) || [];

    const configWithId = { ...config, id: config.id || `ic_${Date.now()}_${Math.random().toString(36).slice(2)}` };

    let newCols: InsertedColumnConfig[];
    if (insertColumnEditConfig?.id) {
      newCols = existingCols.map((c) => (c.id === insertColumnEditConfig.id ? configWithId : c));
    } else {
      newCols = [...existingCols, configWithId];
    }

    const newCfg = { ...cfg, insertedColumns: newCols };
    onNodeUpdate({
      ...previewNode,
      data: {
        ...previewNode.data,
        pipelineNode: { ...pn, config: newCfg },
      },
    });
    setInsertColumnModalOpen(false);
  };

  const handleDeleteInsertColumn = (configId: string) => {
    if (!previewNode || !onNodeUpdate) return;
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const cfg = { ...(pn.config as Record<string, unknown> || {}) };
    const existingCols = (cfg.insertedColumns as InsertedColumnConfig[]) || [];
    const newCols = existingCols.filter((c) => c.id !== configId);
    const newCfg = { ...cfg, insertedColumns: newCols };
    onNodeUpdate({
      ...previewNode,
      data: {
        ...previewNode.data,
        pipelineNode: { ...pn, config: newCfg },
      },
    });
  };

  const handleTableInsertColumn = (config: InsertedColumnConfig) => {
    handleOpenInsertColumn(config.sourceColumn);
  };

  const handleRenameColumn = (oldName: string, newName: string) => {
    if (!previewNode || !onNodeUpdate) return;
    if (oldName === newName) return;

    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const cfg = { ...(pn.config as Record<string, unknown> || {}) };
    const prevRenames = (cfg.columnRenames as Record<string, string>) || {};

    const conflictColumn = previewData?.columns.find(
      col => col !== oldName && col === newName
    );
    if (conflictColumn) {
      message.error(`列名 "${newName}" 已存在，请使用其他名称`);
      return;
    }

    const newRenames = { ...prevRenames, [oldName]: newName };
    const newCfg = {
      ...cfg,
      columnRenames: newRenames,
    };

    onNodeUpdate({
      ...previewNode,
      data: {
        ...previewNode.data,
        pipelineNode: { ...pn, config: newCfg },
      },
    });

    message.success(`列 "${oldName}" 已重命名为 "${newName}"`);
  };

  const handleDeleteColumn = (columnKey: string) => {
    if (!previewNode || !onNodeUpdate) return;
    Modal.confirm({
      title: '删除列',
      content: `确定要删除列 "${columnKey}" 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        const pn = previewNode.data.pipelineNode as Record<string, unknown>;
        const cfg = { ...(pn.config as Record<string, unknown> || {}) };
        const outputKeys = (cfg.outputColumnKeys as string[]) || [];
        const newOutputKeys = outputKeys.filter((k) => k !== columnKey);
        const newCfg = { ...cfg, outputColumnKeys: newOutputKeys };
        onNodeUpdate({
          ...previewNode,
          data: {
            ...previewNode.data,
            pipelineNode: { ...pn, config: newCfg },
          },
        });
      },
    });
  };

  const showTable = !previewLoading && previewData && previewData.columns.length > 0;
  const showNoData = !previewLoading && !previewData && !previewError;
  const showLoading = previewLoading && !previewData;
  const isChartNode = pipelineNode?.type === 'chart';

  const chartNodeConfig = useMemo<ChartNodeConfig | null>(() => {
    if (!isChartNode || !pipelineNode?.config) return null;
    const cfg = pipelineNode.config as Record<string, unknown>;
    return {
      chartType: (cfg.chartType as ChartType) || DEFAULT_CHART_CONFIG.chartType,
      xField: (cfg.xField as string) || '',
      yFields: (cfg.yFields as string[]) || [],
      graphDimensions: (cfg.graphDimensions as string[]) || [],
      graphMetrics: (cfg.graphMetrics as string[]) || [],
      yAggMethod: (cfg.yAggMethod as any) || 'sum',
      xGroupByEnabled: cfg.xGroupByEnabled !== false,
      xAxisTitle: (cfg.xAxisTitle as string) || '',
      yAxisTitle: (cfg.yAxisTitle as string) || '',
      yAxisRightTitle: (cfg.yAxisRightTitle as string) || '',
      sortBy: (cfg.sortBy as 'x' | 'y') || 'x',
      sortOrder: (cfg.sortOrder as 'asc' | 'desc') || 'desc',
      showLegend: cfg.showLegend !== false,
      showTooltip: cfg.showTooltip !== false,
      lineYFields: (cfg.lineYFields as string[]) || [],
      metricMode: (cfg.metricMode as any) || 'aggregate',
      metricFilterField: (cfg.metricFilterField as string) || '',
      metricFilterValue: (cfg.metricFilterValue as string) || '',
      metricFilters: (cfg.metricFilters as any[]) || [],
      metricFilterExpr: cfg.metricFilterExpr as any,
      metricUnit: (cfg.metricUnit as string) || '',
      metricDecimals: (cfg.metricDecimals as number) || 2,
      metricLabel: (cfg.metricLabel as string) || '',
      previewColumnFormats: (cfg.previewColumnFormats as Record<string, string>) || undefined,
    };
  }, [isChartNode, pipelineNode?.config]);

  if (!previewNode) {
    return (
      <div className="pipeline-canvas-preview pipeline-canvas-preview--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="单击节点查看数据预览；双击节点打开配置"
        />
      </div>
    );
  }

  if (!nodeDef?.hasPreview) {
    return (
      <div className="pipeline-canvas-preview pipeline-canvas-preview--empty">
        <Empty description="此节点类型不支持数据预览" />
      </div>
    );
  }

  const title = previewDatasetTitle(previewNode);
  const activeFilterCount = localConditions.filter((c) => c.column && c.operator).length;

  return (
    <div className="pipeline-canvas-preview">
      <div className="pipeline-canvas-preview-toolbar">
        <Text strong className="pipeline-canvas-preview-title">
          {title}
        </Text>
        <div className="pipeline-canvas-preview-toolbar-right">
          {isChartNode && (
            <Radio.Group
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value)}
              size="small"
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="table">
                <TableOutlined /> 表格
              </Radio.Button>
              <Radio.Button value="chart">
                <BarChartOutlined /> 图表
              </Radio.Button>
            </Radio.Group>
          )}

          {columnCatalog.length > 0 && (
            <Popover
              trigger="click"
              open={columnPickerOpen}
              onOpenChange={setColumnPickerOpen}
              title={null}
              content={
                <div style={{ width: 220 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Checkbox
                      indeterminate={catalogIndeterminate}
                      checked={catalogAllSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const next = checked ? [...columnCatalog] : [];
                        handleColumnSelect(next);
                      }}
                    >
                      全选 ({columnCatalog.length})
                    </Checkbox>
                  </div>
                  <Divider style={{ margin: '6px 0' }} />
                  <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {columnCatalog.map((col) => (
                      <Checkbox
                        key={col}
                        checked={visibleColumnKeys.includes(col)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...visibleColumnKeys, col]
                            : visibleColumnKeys.filter((c) => c !== col);
                          handleColumnSelect(next);
                        }}
                        style={{ display: 'flex', margin: '4px 0' }}
                      >
                        {col}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              }
            >
              <Button size="small" style={{ minWidth: 120 }}>
                {catalogAllSelected
                  ? `列 (${columnCatalog.length})`
                  : `已选 ${visibleColumnKeys.length} / ${columnCatalog.length}`}
              </Button>
            </Popover>
          )}

          <Popover
            trigger="click"
            open={filterOpen}
            onOpenChange={setFilterOpen}
            title={null}
            content={
              <FilterEditor
                columns={columnCatalog}
                columnTypes={columnTypesMap}
                conditions={localConditions}
                logic={localLogic}
                readOnly={!onNodeUpdate}
                onConditionsChange={handleConditionsChange}
                onLogicChange={handleLogicChange}
                onConfirm={onNodeUpdate ? handleFilterConfirm : undefined}
                onCancel={onNodeUpdate ? () => setFilterOpen(false) : undefined}
              />
            }
          >
            <Tooltip title="行筛选">
              <Button
                size="small"
                icon={<FilterOutlined />}
                type={activeFilterCount > 0 ? 'primary' : 'default'}
                style={activeFilterCount > 0 ? { background: '#0EA5E9', borderColor: '#0EA5E9' } : {}}
              >
                筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Button>
            </Tooltip>
          </Popover>

          {columnCatalog.length > 0 && (
            <Tooltip title="插入新列">
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => handleOpenInsertColumn(columnCatalog[0])}
              >
                插入列
              </Button>
            </Tooltip>
          )}

          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={previewLoading}
            onClick={() =>
              loadPreview(
                {
                  node: previewNode,
                  allNodes,
                  pipelineDataSourceId: resolvedDsId,
                  limit: 100,
                },
                true
              )
            }
          >
            刷新
          </Button>
        </div>
      </div>

      {previewError && (
        <Alert type="error" message={previewError} showIcon style={{ margin: '8px 12px' }} />
      )}

      {showLoading && (
        <div className="pipeline-canvas-preview-loading">
          <Spin tip="加载数据中…" />
        </div>
      )}

      {!previewLoading && previewData && previewData.columns.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}

      {isChartNode && previewMode === 'chart' && (
        <div className="pipeline-canvas-preview-chart-wrap">
          <ChartNodePreview
            nodeConfig={chartNodeConfig}
            previewData={previewData}
            loading={previewLoading}
            height={350}
            columnFormats={previewColumnFormats}
          />
        </div>
      )}

      {showTable && previewMode === 'table' && (
        <div className="pipeline-canvas-preview-table-wrap" ref={tableWrapRef}>
          <NodePreviewTable
            data={previewData}
            compact={false}
            striped
            displayColumnKeys={
              visibleColumnKeys.length
                ? visibleColumnKeys.filter((c) => dataCols.includes(c))
                : undefined
            }
            columnFormatOverrides={previewColumnFormats}
            onColumnFormatChange={onNodeUpdate ? handlePreviewColumnFormatChange : undefined}
            onInsertColumn={onNodeUpdate ? handleTableInsertColumn : undefined}
            onDeleteColumn={onNodeUpdate ? handleDeleteColumn : undefined}
            onRenameColumn={onNodeUpdate ? handleRenameColumn : undefined}
            columnRenames={columnRenames}
            insertedColumns={(pipelineNode?.config as Record<string, unknown>)?.insertedColumns as InsertedColumnConfig[] | undefined}
            onEditInsertColumn={onNodeUpdate ? handleEditInsertColumn : undefined}
          />
        </div>
      )}

      {showNoData && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}

      <InsertColumnModal
        visible={insertColumnModalOpen}
        columns={columnCatalog}
        editConfig={insertColumnEditConfig}
        onCancel={() => { setInsertColumnModalOpen(false); setInsertColumnEditConfig(undefined); }}
        onConfirm={handleInsertColumn}
        onDelete={handleDeleteInsertColumn}
      />
    </div>
  );
};
