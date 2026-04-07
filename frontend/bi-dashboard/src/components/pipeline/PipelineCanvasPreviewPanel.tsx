/**
 * 画布底部数据浏览区：单击节点在此预览表格（与右侧配置分离）。
 * 固定内部表格容器高度，避免渲染/加载时高度变化触发 ReactFlow ResizeObserver 循环。
 *
 * 工具栏提供列选（写入节点 config.outputColumnKeys）和行筛选（写入
 * config.rowFilterConditions / config.rowFilterLogic），均由后端折叠 SQL 时应用。
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Empty, Select, Spin, Typography, Button, Popover, Space, Tag,
  Input, Tooltip, Alert, Checkbox, Divider, Modal,
} from 'antd';
import {
  ReloadOutlined, FilterOutlined, DeleteOutlined, PlusOutlined,
} from '@ant-design/icons';
import { GraphNode, GraphEdge } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';
import { getNodeTypeDef } from '../../utils/nodeTypeRegistry';
import { resolvePreviewDataSourceId } from '../../utils/pipelineDataSourceUtils';
import { NodePreviewTable } from './NodePreviewTable';
import { InsertColumnModal, InsertedColumnConfig } from './InsertColumnModal';
import { useNodePreview } from '../../hooks/useNodePreview';
import { PREVIEW_COLUMN_DISPLAY_AUTO } from '../../constants/previewColumnDisplay';
import { getPreviewColumnFormatsFromConfig } from '../../utils/previewDisplayUtils';

const { Text } = Typography;

export interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
}

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
  /** 画布侧关闭面板 / 连线 / 拖拽后递增，强制预览刷新 */
  refreshTick?: number;
  /** 节点配置变更时写回画布状态，触发预览重载 */
  onNodeUpdate?: (updatedNode: GraphNode) => void;
}

/** 渲染单条筛选条件行 */
function ConditionRow({
  cond,
  columns,
  readOnly,
  onChange,
  onRemove,
}: {
  cond: Condition;
  columns: string[];
  readOnly: boolean;
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}) {
  const needsValue = cond.operator !== 'isNull' && cond.operator !== 'isNotNull';
  return (
    <Space size={4} style={{ marginBottom: 6 }} wrap>
      <Select
        size="small"
        placeholder="字段"
        style={{ width: 110 }}
        value={cond.column || undefined}
        onChange={(v) => onChange({ ...cond, column: v })}
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
        onChange={(v) => onChange({ ...cond, operator: v })}
        options={FILTER_OPERATORS}
        disabled={readOnly}
      />
      {needsValue && (
        <Input
          size="small"
          placeholder="值"
          style={{ width: 100 }}
          value={cond.value}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          disabled={readOnly}
        />
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
  conditions,
  logic,
  readOnly,
  onConditionsChange,
  onLogicChange,
  onConfirm,
  onCancel,
}: {
  columns: string[];
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
      { id: `cond_${Date.now()}`, column: '', operator: '', value: '' },
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
                  : [{ id: cond.id, column: '', operator: '', value: '' }]
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

  const pipelineNode = previewNode?.data?.pipelineNode as PipelineNode | undefined;
  const nodeDef = pipelineNode ? getNodeTypeDef(pipelineNode.type) : null;
  const resolvedDsId = useMemo(
    () => resolvePreviewDataSourceId(pipelineNode, pipelineDataSourceId),
    [pipelineNode, pipelineDataSourceId]
  );

  const previewConfigKey = useMemo(() => {
    if (!previewNode) return '';
    return JSON.stringify((previewNode.data.pipelineNode as PipelineNode)?.config ?? {}) + `:tick:${refreshTick}`;
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

  useEffect(() => {
    if (!previewNode || !nodeDef?.hasPreview) {
      clearPreview();
      setVisibleColumnKeys([]);
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
    [previewConfigKey]
  );

  const [localConditions, setLocalConditions] = useState<Condition[]>([
    { id: 'cond_0', column: '', operator: '', value: '' },
  ]);
  const [localLogic, setLocalLogic] = useState<string>('AND');

  useEffect(() => {
    if (!previewNode) return;
    const conds = [...savedRowConditions];
    setLocalConditions(conds.length > 0 ? conds : [{ id: 'cond_0', column: '', operator: '', value: '' }]);
    setLocalLogic(savedRowLogic || 'AND');
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

  /** 列选变更：同步写入节点 config.outputColumnKeys 并触发 onNodeUpdate */
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

  const previewColumnFormats = pipelineNode?.config
    ? getPreviewColumnFormatsFromConfig(pipelineNode.config)
    : undefined;

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

  /** 筛选条件变更 */
  const handleConditionsChange = (cs: Condition[]) => {
    setLocalConditions(cs);
  };

  const handleLogicChange = (l: string) => {
    setLocalLogic(l);
  };

  /** 确认筛选：写入 config.rowFilterConditions / rowFilterLogic 并关闭浮层 */
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

  /** 打开插入列弹窗 */
  const handleOpenInsertColumn = (sourceColumn?: string) => {
    setInsertColumnSourceColumn(sourceColumn);
    setInsertColumnEditConfig(undefined);
    setInsertColumnModalOpen(true);
  };

  /** 双击插入列标签 → 重新打开编辑 */
  const handleEditInsertColumn = (config: InsertedColumnConfig) => {
    setInsertColumnEditConfig(config);
    setInsertColumnModalOpen(true);
  };

  /** 插入新列回调 */
  const handleInsertColumn = (config: InsertedColumnConfig) => {
    if (!previewNode || !onNodeUpdate) return;
    const pn = previewNode.data.pipelineNode as Record<string, unknown>;
    const cfg = { ...(pn.config as Record<string, unknown> || {}) };
    const existingCols = (cfg.insertedColumns as InsertedColumnConfig[]) || [];

    // 生成唯一 id
    const configWithId = { ...config, id: config.id || `ic_${Date.now()}_${Math.random().toString(36).slice(2)}` };

    let newCols: InsertedColumnConfig[];
    if (insertColumnEditConfig?.id) {
      // 编辑模式：替换
      newCols = existingCols.map((c) => (c.id === insertColumnEditConfig.id ? configWithId : c));
    } else {
      // 新增模式
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

  /** 删除插入列 */
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

  /** 表格右键插入列回调 */
  const handleTableInsertColumn = (config: InsertedColumnConfig) => {
    handleOpenInsertColumn(config.sourceColumn);
  };

  /** 删除列回调 */
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
        const newCfg = {
          ...cfg,
          outputColumnKeys: newOutputKeys,
        };
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

          {/* 行筛选入口 */}
          <Popover
            trigger="click"
            open={filterOpen}
            onOpenChange={setFilterOpen}
            title={null}
            content={
              <FilterEditor
                columns={columnCatalog}
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

          {/* 插入新列按钮 */}
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

      {showTable && (
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
            insertedColumns={(pipelineNode?.config as Record<string, unknown>)?.insertedColumns as InsertedColumnConfig[] | undefined}
            onEditInsertColumn={onNodeUpdate ? handleEditInsertColumn : undefined}
          />
        </div>
      )}

      {showNoData && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}

      {/* 插入列弹窗 */}
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
