import React, {
  useState, useCallback, useRef, useMemo, useEffect, forwardRef, useImperativeHandle,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Connection,
  ReactFlowProvider,
  Panel,
  NodeTypes,
  useReactFlow,
  Handle,
  useViewport,
  Position,
  BackgroundVariant,
} from '@xyflow/react';
import { Button, Space, message, Dropdown, Modal, Table, Alert, Checkbox } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import {
  PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined,
  ImportOutlined, FilterOutlined, BarChartOutlined, SwapOutlined,
  AppstoreOutlined, ExportOutlined, DownOutlined,
  DatabaseOutlined, ArrowRightOutlined, HolderOutlined,
  ColumnWidthOutlined,
} from '@ant-design/icons';
import './PipelineFlowEditor.css';
import { PipelineNode, PipelineService } from '../../services/pipelineService';
import {
  GraphNode, GraphEdge, detectCycle, topologicalSort,
  nodesToPipelineNodes, autoLayoutNodes, buildEdgesFromUpstream
} from '../../utils/graphUtils';
import { NodeDetailPanel } from './NodeDetailPanel';
import { PipelineCanvasPreviewPanel } from './PipelineCanvasPreviewPanel';
import { CompactNodePreview } from './CompactNodePreview';
import { getNodeTypeDef, NODE_TYPE_REGISTRY } from '../../utils/nodeTypeRegistry';

interface PipelineFlowEditorProps {
  nodes: PipelineNode[];
  pipelineDataSourceId?: number | null;
  onSave: (nodes: PipelineNode[], edges: GraphEdge[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
}

/** 供父组件在「保存管道」等操作时拉取画布当前状态（无需先点工具栏保存） */
export type PipelineFlowEditorHandle = {
  getPipelineSnapshot: () => { nodes: PipelineNode[]; edges: GraphEdge[] } | null;
};

function generateId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Node Card — Coze-style ────────────────────────────────────────────────

interface PipelineNodeCardProps {
  data: Record<string, unknown>;
  selected: boolean;
}

function PipelineNodeCard({ data, selected }: PipelineNodeCardProps) {
  const pipelineNode = data.pipelineNode as PipelineNode;
  const def = getNodeTypeDef(pipelineNode.type);
  const allNodes = data.allNodes as GraphNode[] | undefined;
  const validationError = data.validationError as string | undefined;

  // Resolve upstream names into chips
  const upstreamNames = useMemo(() => {
    if (!allNodes || !pipelineNode.upstream?.length) return [];
    return pipelineNode.upstream
      .map(uid => {
        const found = allNodes.find(n => n.id === uid);
        return found
          ? (found.data.pipelineNode as PipelineNode)?.name || uid
          : uid;
      })
      .slice(0, 4);
  }, [allNodes, pipelineNode.upstream]);

  const cardClass = [
    'pipeline-node-card',
    selected ? 'selected' : '',
    validationError ? 'pipeline-node-card--error' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Left — target handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="react-flow__handle-left"
      />

      <div className={cardClass}>
        {/* Header */}
        <div className="pipeline-node-card-header">
          <div
            className="pipeline-node-card-icon"
            style={{ background: def.bgColor }}
          >
            <span style={{ color: def.color, fontSize: 14, lineHeight: 1 }}>{def.icon}</span>
          </div>
          <span className="pipeline-node-card-name" title={pipelineNode.name}>
            {pipelineNode.name}
          </span>
          <span
            className="pipeline-node-card-type"
            style={{ background: def.tagBg, color: def.tagColor }}
          >
            {def.labelShort}
          </span>
        </div>

        {/* Body */}
        <div className="pipeline-node-card-body">

          {/* 输入 chips */}
          <div className="pipeline-node-section">输入</div>
          <div className="pipeline-node-card-upstreams">
            {upstreamNames.length > 0 ? (
              upstreamNames.map((name, i) => (
                <span key={i} className="pipeline-chip pipeline-chip--upstream">
                  <ArrowRightOutlined className="pipeline-chip-icon" />
                  {name}
                </span>
              ))
            ) : (
              <span className="pipeline-chip pipeline-chip--placeholder">
                无上游节点
              </span>
            )}
          </div>

          {/* Config summary — Coze plain chips */}
          <NodeConfigSummary node={pipelineNode} />

          {/* Data preview */}
          <div className="pipeline-node-card-preview">
            <CompactNodePreview pipelineNode={pipelineNode} />
          </div>
        </div>
      </div>

      {/* Right — source handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="react-flow__handle-right"
      />
    </>
  );
}

// ─── NodeConfigSummary — Coze-style plain chips ───────────────────────────

function NodeConfigSummary({ node }: { node: PipelineNode }) {
  const config = (node.config || {}) as Record<string, unknown>;

  const renderChip = (label: string, sub?: string, muted = false) => (
    <span className={`pipeline-chip-plain${muted ? ' pipeline-chip-plain--muted' : ''}`}>
      {label}
      {sub && <span style={{ opacity: 0.65, marginLeft: 2 }}>{sub}</span>}
    </span>
  );

  if (node.type === 'source') {
    const tableName = config.tableName as string | undefined;
    if (!tableName) return null;
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(tableName)}
      </div>
    );
  }

  if (node.type === 'filter') {
    const conditions = (config.conditions || []) as Array<{ column: string; operator: string; value: string }>;
    const logic = (config.logic as string) || 'AND';
    if (conditions.length === 0) return null;
    const preview = conditions
      .filter(c => c.column)
      .slice(0, 2)
      .map(c => `${c.column} ${c.operator} ${c.value || '…'}`)
      .join(` ${logic} `);
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(`${conditions.length} 个条件`, preview ? `— ${preview}` : undefined)}
      </div>
    );
  }

  if (node.type === 'aggregate') {
    const groupBy = (config.groupBy as string[]) || [];
    const aggs = (config.aggregations || []) as Array<{ func: string; column: string; alias: string }>;
    if (aggs.length === 0 && groupBy.length === 0) return null;
    const parts: string[] = [];
    if (groupBy.length > 0) parts.push(`${groupBy.length} 维分组`);
    if (aggs.length > 0) parts.push(`${aggs.length} 个聚合`);
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(parts.join(' · '))}
      </div>
    );
  }

  if (node.type === 'join') {
    const jt = (config.joinType as string) || 'inner';
    const keys = (config.joinKeys || []) as Array<{ leftCol: string; rightCol: string }>;
    if (keys.length === 0) return null;
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(jt.toUpperCase(), 'JOIN')}
        <span className="pipeline-chip-plain pipeline-chip-plain--muted">
          {keys[0]?.leftCol} = {keys[0]?.rightCol}
        </span>
      </div>
    );
  }

  if (node.type === 'column_select') {
    const cols = (config.selectedColumns as string[]) || [];
    if (cols.length === 0) return null;
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(`${cols.length} 列`)}
        {cols.slice(0, 2).map(c => renderChip(c, undefined, true))}
        {cols.length > 2 && renderChip(`+${cols.length - 2}`, undefined, true)}
      </div>
    );
  }

  if (node.type === 'output') {
    const target = (config.targetTable as string) || config.targetSchema as string;
    const mode = (config.writeMode as string) || 'create';
    const modeLabel = mode === 'create' ? '新建' : mode === 'replace' ? '覆盖' : '追加';
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(modeLabel, '写入')}
        {target && renderChip(target)}
      </div>
    );
  }

  if (node.type === 'transform') {
    const exprs = (config.transforms as Array<{ column: string; expr: string }>) || [];
    if (exprs.length === 0) return null;
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(`${exprs.length} 个表达式`)}
      </div>
    );
  }

  if (node.type === 'merge') {
    const ups = (config.upstream_ids as string[]) || [];
    return (
      <div className="pipeline-node-card-summary">
        {renderChip(`${ups.length} 路合并`)}
      </div>
    );
  }

  return null;
}

// ─── Node type registry ────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  pipelineNode: PipelineNodeCard as unknown as NodeTypes[string],
};

// ─── Add Node Palette (Coze-style floating palette) ───────────────────────

function AddNodePalette({ onAdd }: { onAdd: (type: string) => void }) {
  const items: MenuProps['items'] = [
    {
      key: 'header-source',
      type: 'group',
      label: <span className="pipeline-node-palette-section">数据输入</span>,
      children: [
        {
          key: 'source',
          label: (
            <Space style={{ fontSize: 12 }}>
              <DatabaseOutlined style={{ color: NODE_TYPE_REGISTRY.source.color }} />
              数据源 / 选表
            </Space>
          ),
          onClick: () => onAdd('source'),
        },
      ],
    },
    {
      key: 'header-proc',
      type: 'group',
      label: <span className="pipeline-node-palette-section">数据处理</span>,
      children: [
        {
          key: 'filter',
          label: (
            <Space style={{ fontSize: 12 }}>
              <FilterOutlined style={{ color: NODE_TYPE_REGISTRY.filter.color }} />
              过滤行
            </Space>
          ),
          onClick: () => onAdd('filter'),
        },
        {
          key: 'aggregate',
          label: (
            <Space style={{ fontSize: 12 }}>
              <BarChartOutlined style={{ color: NODE_TYPE_REGISTRY.aggregate.color }} />
              聚合汇总
            </Space>
          ),
          onClick: () => onAdd('aggregate'),
        },
        {
          key: 'join',
          label: (
            <Space style={{ fontSize: 12 }}>
              <SwapOutlined style={{ color: NODE_TYPE_REGISTRY.join.color }} />
              关联表
            </Space>
          ),
          onClick: () => onAdd('join'),
        },
        {
          key: 'column_select',
          label: (
            <Space style={{ fontSize: 12 }}>
              <ColumnWidthOutlined style={{ color: NODE_TYPE_REGISTRY.column_select.color }} />
              选择列
            </Space>
          ),
          onClick: () => onAdd('column_select'),
        },
        {
          key: 'transform',
          label: (
            <Space style={{ fontSize: 12 }}>
              <HolderOutlined style={{ color: NODE_TYPE_REGISTRY.transform?.color ?? '#52c41a' }} />
              数据转换
            </Space>
          ),
          onClick: () => onAdd('transform'),
        },
        {
          key: 'merge',
          label: (
            <Space style={{ fontSize: 12 }}>
              <SwapOutlined style={{ color: NODE_TYPE_REGISTRY.merge?.color ?? '#fa8c16' }} />
              合并节点
            </Space>
          ),
          onClick: () => onAdd('merge'),
        },
      ],
    },
    {
      key: 'header-out',
      type: 'group',
      label: <span className="pipeline-node-palette-section">数据输出</span>,
      children: [
        {
          key: 'output',
          label: (
            <Space style={{ fontSize: 12 }}>
              <ExportOutlined style={{ color: NODE_TYPE_REGISTRY.output.color }} />
              输出到表
            </Space>
          ),
          onClick: () => onAdd('output'),
        },
      ],
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="topCenter">
      <Button icon={<PlusOutlined />} className="ant-btn--primary">
        添加节点 <DownOutlined />
      </Button>
    </Dropdown>
  );
}

// ─── Bottom Pill Toolbar ──────────────────────────────────────────────────

interface BottomPillProps {
  readOnly: boolean;
  selectedCount: number;
  onAutoLayout: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDeleteSelected: () => void;
  onImport: () => void;
  onAddNode: (type: string) => void;
}

function BottomPillToolbar({
  readOnly,
  selectedCount,
  onAutoLayout,
  onSave,
  onCancel,
  onDeleteSelected,
  onImport,
  onAddNode,
}: BottomPillProps) {
  if (readOnly) return null;

  return (
    <Panel position="bottom-center">
      <div className="pipeline-bottom-pill">
        {/* Zoom controls — icon-only */}
        <div className="pipeline-bottom-pill-section">
          <ZoomControls />
        </div>

        <div className="pipeline-bottom-pill-divider" />

        {/* Add node */}
        <div className="pipeline-bottom-pill-section">
          <AddNodePalette onAdd={onAddNode} />
        </div>

        <div className="pipeline-bottom-pill-divider" />

        {/* Canvas tools */}
        <div className="pipeline-bottom-pill-section">
          <Button icon={<ImportOutlined />} onClick={onImport} title="从管道导入">
            导入
          </Button>
          <Button icon={<HolderOutlined />} onClick={onAutoLayout} title="自动布局">
            布局
          </Button>
        </div>

        <div className="pipeline-bottom-pill-divider" />

        {/* Destructive */}
        <div className="pipeline-bottom-pill-section">
          <Button
            icon={<DeleteOutlined />}
            className="ant-btn--danger"
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="删除选中节点"
          >
            删除 {selectedCount > 0 ? `(${selectedCount})` : ''}
          </Button>
        </div>

        <div className="pipeline-bottom-pill-divider" />

        {/* Primary actions */}
        <div className="pipeline-bottom-pill-section">
          <Button icon={<CloseOutlined />} onClick={onCancel}>
            取消
          </Button>
          <Button icon={<SaveOutlined />} className="ant-btn--success" onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ─── Zoom controls ────────────────────────────────────────────────────────

function ZoomControls() {
  const rf = useReactFlow();
  const viewport = useViewport();

  const zoomBy = (delta: number) => {
    rf.setViewport({ ...viewport, zoom: viewport.zoom * delta }, { duration: 200 });
  };

  return (
    <>
      <Button
        icon={<span style={{ fontSize: 12, fontWeight: 700 }}>+</span>}
        className="ant-btn--icon"
        onClick={() => zoomBy(1.2)}
        title="放大"
      />
      <Button
        icon={<span style={{ fontSize: 12, fontWeight: 700 }}>−</span>}
        className="ant-btn--icon"
        onClick={() => zoomBy(1 / 1.2)}
        title="缩小"
      />
      <Button
        icon={<HolderOutlined />}
        className="ant-btn--icon"
        onClick={() => rf.fitView({ duration: 300, padding: 0.2 })}
        title="适应画布"
      />
    </>
  );
}

// ─── Import Nodes from Another Pipeline ───────────────────────────────────────

interface ImportPipelineModalProps {
  visible: boolean;
  currentPipelineDsId: number | null | undefined;
  onClose: () => void;
  onImport: (newNodes: GraphNode[], newEdges: GraphEdge[]) => void;
}

interface SelectablePipelineNode {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  upstream: string[];
}

interface PipelineListItem {
  id: number;
  name: string;
  description?: string;
  nodeCount: number;
  sourceDataSourceId: number;
}

function ImportPipelineModal({
  visible,
  currentPipelineDsId,
  onClose,
  onImport,
}: ImportPipelineModalProps) {
  const [step, setStep] = useState<'select-pipeline' | 'select-nodes'>('select-pipeline');
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(null);
  const [selectedPipelineNodes, setSelectedPipelineNodes] = useState<SelectablePipelineNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [includeSourceNodes, setIncludeSourceNodes] = useState(false);
  const [dsMismatchWarning, setDsMismatchWarning] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPipelinesLoading(true);
    PipelineService.getPipelines(0, 200)
      .then(res => {
        setPipelines(
          res.items.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            nodeCount: p.nodes?.length ?? 0,
            sourceDataSourceId: p.source_data_source_id,
          }))
        );
      })
      .catch(() => message.error('加载管道列表失败'))
      .finally(() => setPipelinesLoading(false));
  }, [visible]);

  const handlePipelineSelect = (pipelineId: number) => {
    setSelectedPipelineId(pipelineId);
    setNodesLoading(true);
    PipelineService.getPipeline(pipelineId)
      .then(pipeline => {
        setSelectedPipelineNodes(pipeline.nodes as SelectablePipelineNode[]);
        const isMismatch = currentPipelineDsId != null &&
          pipeline.source_data_source_id !== currentPipelineDsId;
        setDsMismatchWarning(isMismatch);
        setDsMismatchWarning(isMismatch);
      })
      .catch(() => message.error('加载管道节点失败'))
      .finally(() => setNodesLoading(false));
  };

  const handleBack = () => {
    setStep('select-pipeline');
    setSelectedPipelineId(null);
    setSelectedPipelineNodes([]);
    setSelectedNodeIds(new Set());
    setDsMismatchWarning(false);
    setIncludeSourceNodes(false);
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setStep('select-pipeline');
      setSelectedPipelineId(null);
      setSelectedPipelineNodes([]);
      setSelectedNodeIds(new Set());
      setDsMismatchWarning(false);
      setIncludeSourceNodes(false);
    }, 300);
  };

  const handleImport = () => {
    const toImport = selectedPipelineNodes.filter(n => {
      if (n.type === 'source') return includeSourceNodes;
      return selectedNodeIds.has(n.id);
    });
    if (toImport.length === 0) {
      message.warning('请至少选择一个节点');
      return;
    }
    const graphNodes: GraphNode[] = toImport.map((n, i) => ({
      id: n.id,
      type: 'pipelineNode',
      position: { x: (i % 3) * 300, y: Math.floor(i / 3) * 160 },
      data: {
        pipelineNode: { ...n, upstream: n.upstream.filter(u =>
          toImport.some(tn => tn.id === u) ||
          (n.type === 'source' && includeSourceNodes)
        )},
      },
    }));
    const graphEdges: GraphEdge[] = [];
    graphNodes.forEach(n => {
      const pn = n.data.pipelineNode as Record<string, unknown>;
      (pn.upstream as string[] || []).forEach((uId: string) => {
        if (toImport.some(tn => tn.id === uId) || (pn.type === 'source' && includeSourceNodes)) {
          graphEdges.push({ id: `${uId}-${n.id}`, source: uId, target: n.id });
        }
      });
    });
    onImport(graphNodes, graphEdges);
    handleClose();
  };

  const pipelineColumns: ColumnsType<PipelineListItem> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    { title: '节点数', dataIndex: 'nodeCount', width: 80 },
    {
      title: '操作',
      width: 80,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => { handlePipelineSelect(record.id); setStep('select-nodes'); }}
        >
          选择
        </Button>
      ),
    },
  ];

  const nodeColumns: ColumnsType<SelectablePipelineNode> = [
    {
      title: '',
      key: 'checkbox',
      width: 40,
      render: (_, record) =>
        record.type === 'source' ? null : (
          <Checkbox
            checked={selectedNodeIds.has(record.id)}
            onChange={e => {
              setSelectedNodeIds(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(record.id); else next.delete(record.id);
                return next;
              });
            }}
          />
        ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (name, record) => {
        const def = getNodeTypeDef(record.type);
        return (
          <Space>
            <span style={{ color: def.color }}>{def.icon}</span>
            {name}
          </Space>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: type => {
        const def = getNodeTypeDef(type);
        return (
          <span
            style={{
              background: def.tagBg,
              color: def.tagColor,
              borderRadius: 20,
              padding: '1px 8px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {def.labelShort}
          </span>
        );
      },
    },
    { title: 'ID', dataIndex: 'id', width: 80, ellipsis: true },
  ];

  return (
    <Modal
      title={step === 'select-pipeline' ? '从管道导入节点' : `选择节点 — ${pipelines.find(p => p.id === selectedPipelineId)?.name ?? ''}`}
      open={visible}
      onCancel={handleClose}
      width={600}
      footer={null}
      destroyOnClose
    >
      {step === 'select-pipeline' && (
        <>
          <Table
            columns={pipelineColumns}
            dataSource={pipelines}
            rowKey="id"
            loading={pipelinesLoading}
            pagination={false}
            size="small"
            scroll={{ y: 360 }}
            style={{ marginBottom: 8 }}
          />
        </>
      )}

      {step === 'select-nodes' && (
        <div>
          {dsMismatchWarning && (
            <div style={{ padding: '12px 0 0' }}>
              <Alert
                type="warning"
                message={`数据源不一致：源管道使用数据源 #${selectedPipelineId}，当前管道使用 #${currentPipelineDsId}`}
                description={
                  <Space direction="vertical" size={4}>
                    <span>「数据源 / 选表」类型节点导入后将使用当前数据源；其他节点类型（过滤、聚合等）不受影响。</span>
                    <Checkbox
                      checked={includeSourceNodes}
                      onChange={e => {
                        setIncludeSourceNodes(e.target.checked);
                        if (!e.target.checked) {
                          setSelectedNodeIds(prev => {
                            const next = new Set(prev);
                            selectedPipelineNodes.filter(n => n.type === 'source').forEach(n => next.delete(n.id));
                            return next;
                          });
                        }
                      }}
                    >
                      同时导入数据源节点（表配置需重新选择）
                    </Checkbox>
                  </Space>
                }
                showIcon
                style={{ marginBottom: 12 }}
              />
            </div>
          )}

          <Table
            columns={nodeColumns}
            dataSource={selectedPipelineNodes}
            rowKey="id"
            loading={nodesLoading}
            pagination={false}
            size="small"
            scroll={{ y: 360 }}
            style={{ padding: '0 0 8px' }}
          />

          <div
            style={{
              padding: '12px 0',
              borderTop: '1px solid #f0f0f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Button onClick={handleBack}>← 返回选择管道</Button>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button
                type="primary"
                icon={<ImportOutlined />}
                onClick={handleImport}
                disabled={
                  selectedNodeIds.size === 0 && !includeSourceNodes
                }
              >
                导入{' '}
                {selectedNodeIds.size > 0 || includeSourceNodes
                  ? `(${selectedNodeIds.size + (includeSourceNodes ? 1 : 0)})`
                  : ''}
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Arrow marker SVG injected into the DOM via a hidden SVG element
const ARROW_MARKER_ID = 'pipeline-arrow';

// ─── Default edge options (blue arrows via SVG marker) ────────────────────

const defaultEdgeOptions = {
  type: 'default',
  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
  markerEnd: `url(#${ARROW_MARKER_ID})`,
} as const;

/** 与工具栏「保存」相同：从 React Flow 状态导出 PipelineNode[] + 边 */
function buildPipelineExport(
  flowNodes: Node[],
  flowEdges: Edge[]
): { pipelineNodes: PipelineNode[]; graphEdges: GraphEdge[] } | null {
  if (flowNodes.length === 0) return null;
  const positions: Record<string, { x: number; y: number }> = {};
  flowNodes.forEach((n: Node) => { positions[n.id] = n.position; });
  const graphNodes = flowNodes as unknown as GraphNode[];
  const graphEdges = flowEdges as unknown as GraphEdge[];
  const sortedIds = topologicalSort(graphNodes, graphEdges);
  const sortedNodes = sortedIds
    .map(id => graphNodes.find(n => n.id === id))
    .filter(Boolean) as GraphNode[];
  const pipelineNodes = nodesToPipelineNodes(sortedNodes, positions);
  const withUpstream = pipelineNodes.map((pn, i) => {
    const nodeId = sortedIds[i];
    const ups = graphEdges.filter(e => e.target === nodeId).map(e => e.source);
    return { ...pn, upstream: ups };
  });
  return { pipelineNodes: withUpstream as PipelineNode[], graphEdges };
}

// ─── Flow Inner ──────────────────────────────────────────────────────────────

interface FlowInnerProps extends PipelineFlowEditorProps {
  initialNodes: Node[];
}

const FlowInner = forwardRef<PipelineFlowEditorHandle, FlowInnerProps>(function FlowInner(
  {
    initialNodes,
    readOnly,
    onSave,
    onCancel,
    pipelineDataSourceId,
  },
  ref
) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Panel state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Import from pipeline state
  const [importModalVisible, setImportModalVisible] = useState(false);

  const { fitView } = useReactFlow();
  const nextIdRef = useRef(initialNodes.length + 1);

  // Sync edges from upstream whenever initialNodes (from props) changes
  useEffect(() => {
    const graphNodes = nodes as unknown as GraphNode[];
    if (graphNodes.length === 0) return;
    const upstreamEdges = buildEdgesFromUpstream(graphNodes);
    if (upstreamEdges.length > 0) {
      setEdges(upstreamEdges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inject allNodes into each node's data so cards can resolve upstream names
  const enrichedNodes = useMemo(() => {
    return (nodes as unknown as GraphNode[]).map(n => ({
      ...n,
      data: { ...n.data, allNodes: nodes },
    }));
  }, [nodes]);

  const selectedNode = useMemo(
    () => (nodes as unknown as GraphNode[]).find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedCount = useMemo(
    () => (nodes as unknown as GraphNode[]).filter(n => n.data?.selected).length,
    [nodes]
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      if (params.source === params.target) {
        message.warning('不能连接到自己');
        return;
      }

      const newEdge: Edge = {
        id: `${params.source}-${params.target}`,
        source: params.source,
        target: params.target,
      };

      const testEdges: GraphEdge[] = [...(edges as unknown as GraphEdge[]), {
        id: newEdge.id,
        source: newEdge.source,
        target: newEdge.target,
      }];
      const testNodes: GraphNode[] = [...(nodes as unknown as GraphNode[]), {
        id: '__temp__',
        position: { x: 0, y: 0 },
        data: { pipelineNode: {} },
      }];
      if (detectCycle(testNodes, testEdges)) {
        message.error('不能创建循环依赖');
        return;
      }

      const updatedNodes = (nodes as unknown as GraphNode[]).map(n => {
        if (n.id === params.target) {
          const pn = n.data.pipelineNode as Record<string, unknown>;
          const upstream = (pn.upstream as string[]) || [];
          if (!upstream.includes(params.source!)) {
            return {
              ...n,
              data: {
                ...n.data,
                pipelineNode: { ...pn, upstream: [...upstream, params.source] },
              },
            } as unknown as Node;
          }
        }
        return n;
      });

      setEdges([...edges, newEdge]);
      setNodes(updatedNodes);
    },
    [nodes, edges, setNodes, setEdges]
  );

  /** 单击：选中节点并在画布底部加载数据预览；不打开右侧配置 */
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    if (!readOnly) setPanelOpen(false);
  }, [readOnly]);

  /** 双击：打开右侧配置面板 */
  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (readOnly) return;
    setSelectedNodeId(node.id);
    setPanelOpen(true);
  }, [readOnly]);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setPanelOpen(false);
  }, []);

  const handleNodesDelete = useCallback(() => {
    const toDelete = (nodes as unknown as GraphNode[])
      .filter(n => n.data?.selected)
      .map(n => n.id);
    if (toDelete.length === 0) {
      message.warning('请先选中要删除的节点');
      return;
    }
    toDelete.forEach(id => {
      const filteredNodes = (nodes as unknown as GraphNode[]).filter(n => n.id !== id);
      const filteredEdges = (edges as unknown as GraphEdge[]).filter(e => e.source !== id && e.target !== id);
      const cleaned = filteredNodes.map(n => {
        const pn = n.data.pipelineNode as Record<string, unknown>;
        const upstream = (pn.upstream as string[]) || [];
        if (upstream.includes(id)) {
          return {
            ...n,
            data: {
              ...n.data,
              pipelineNode: { ...pn, upstream: upstream.filter((u: string) => u !== id) },
            },
          } as unknown as Node;
        }
        return n;
      });
      setNodes(cleaned);
      setEdges(filteredEdges as Edge[]);
    });
    if (selectedNodeId && toDelete.includes(selectedNodeId)) {
      setPanelOpen(false);
      setSelectedNodeId(null);
    }
    message.success(`已删除 ${toDelete.length} 个节点`);
  }, [nodes, edges, selectedNodeId, setNodes, setEdges]);

  const handlePanelNodeUpdate = useCallback((updatedNode: GraphNode) => {
    setNodes(prev => prev.map(n =>
      n.id === updatedNode.id
        ? { ...n, data: { ...updatedNode.data } }
        : n
    ));
  }, [setNodes]);

  const handlePanelNodeDelete = useCallback((nodeId: string) => {
    const filteredNodes = (nodes as unknown as GraphNode[]).filter(n => n.id !== nodeId);
    const filteredEdges = (edges as unknown as GraphEdge[]).filter(e => e.source !== nodeId && e.target !== nodeId);
    const cleaned = filteredNodes.map(n => {
      const pn = n.data.pipelineNode as Record<string, unknown>;
      const upstream = (pn.upstream as string[]) || [];
      if (upstream.includes(nodeId)) {
        return {
          ...n,
          data: {
            ...n.data,
            pipelineNode: { ...pn, upstream: upstream.filter((u: string) => u !== nodeId) },
          },
        } as unknown as Node;
      }
      return n;
    });
    setNodes(cleaned);
    setEdges(filteredEdges as Edge[]);
    setPanelOpen(false);
    setSelectedNodeId(null);
  }, [nodes, edges, setNodes, setEdges]);

  const handleImportFromPipeline = useCallback(
    (importedNodes: GraphNode[], importedEdges: GraphEdge[]) => {
      const existingIds = new Set((nodes as unknown as GraphNode[]).map(n => n.id));
      const maxX = Math.max(...(nodes as unknown as GraphNode[]).map(n => n.position.x), 0);
      const maxY = Math.max(...(nodes as unknown as GraphNode[]).map(n => n.position.y), 0);
      const offsetX = maxX + 120;
      const offsetY = Math.max(maxY - 100, 0);

      const remapped = importedNodes.map(n => ({
        ...n,
        position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
      }));

      const mergedNodes = [...(nodes as unknown as GraphNode[]), ...remapped] as unknown as Node[];
      const allEdges: Edge[] = [
        ...(edges as unknown as GraphEdge[]),
        ...importedEdges,
      ] as Edge[];

      const layouted = autoLayoutNodes(
        mergedNodes as unknown as GraphNode[],
        allEdges as unknown as GraphEdge[]
      );

      setNodes(layouted as unknown as Node[]);
      setEdges(allEdges);
      setTimeout(() => fitView({ padding: 0.2 }), 50);
      message.success(`已导入 ${importedNodes.length} 个节点`);
    },
    [nodes, edges, setNodes, setEdges, fitView]
  );

  const addNode = useCallback((type: string) => {
    const def = getNodeTypeDef(type);
    const newId = generateId();
    const newNode: Node = {
      id: newId,
      type: 'pipelineNode',
      position: { x: 100 + nextIdRef.current * 50, y: 100 + nextIdRef.current * 60 },
      data: {
        pipelineNode: {
          id: newId,
          name: `新建${def.label}节点`,
          type,
          config: {},
          order: nextIdRef.current,
          upstream: [],
        },
      },
    };
    nextIdRef.current += 1;
    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(newId);
    setPanelOpen(true);
  }, [setNodes]);

  const handleAutoLayout = useCallback(() => {
    const layouted = autoLayoutNodes(nodes as unknown as GraphNode[], edges as unknown as GraphEdge[]);
    setNodes(layouted as unknown as Node[]);
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  useImperativeHandle(ref, () => ({
    getPipelineSnapshot: () => {
      const built = buildPipelineExport(nodes as Node[], edges);
      if (!built) return null;
      return { nodes: built.pipelineNodes, edges: built.graphEdges };
    },
  }), [nodes, edges]);

  const handleSave = useCallback(() => {
    const built = buildPipelineExport(nodes as Node[], edges);
    if (!built) {
      message.warning('请至少添加一个节点');
      return;
    }
    onSave(built.pipelineNodes, built.graphEdges);
  }, [nodes, edges, onSave]);

  return (
    <div className="pipeline-editor-container">
      {/* Read-only bar (tiny, no main actions) */}
      {readOnly && (
        <div className="pipeline-readonly-bar">
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            管道编辑器（只读）
          </span>
        </div>
      )}

      {/* Main area: canvas + bottom preview + optional right panel */}
      <div className="pipeline-editor-body">
        <div className="pipeline-flow-column">
          <div className="pipeline-flow-main">
            <ReactFlow
            nodes={enrichedNodes}
            edges={edges}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : handleConnect}
            nodeTypes={nodeTypes}
            edgeTypes={undefined}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            deleteKeyCode={readOnly ? null : 'Delete'}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onPaneClick={handlePaneClick}
            zoomOnDoubleClick={false}
            connectionLineStyle={{ stroke: 'var(--pipeline-conn-color)', strokeWidth: 1.5 }}
          >
            {/* SVG defs: arrow marker */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
              <defs>
                <marker
                  id={ARROW_MARKER_ID}
                  viewBox="0 0 12 12"
                  refX={10}
                  refY={6}
                  markerWidth={10}
                  markerHeight={10}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" fill="#94a3b8" />
                </marker>
              </defs>
            </svg>

            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d0d5dd" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={n => {
                const pn = n.data?.pipelineNode as PipelineNode | undefined;
                return getNodeTypeDef(pn?.type || '').color || '#6366F1';
              }}
              maskColor="rgba(79,70,229,0.08)"
            />
            <BottomPillToolbar
              readOnly={readOnly}
              selectedCount={selectedCount}
              onAutoLayout={handleAutoLayout}
              onSave={handleSave}
              onCancel={onCancel}
              onDeleteSelected={handleNodesDelete}
              onImport={() => setImportModalVisible(true)}
              onAddNode={addNode}
            />
          </ReactFlow>
          </div>

          <PipelineCanvasPreviewPanel
            previewNode={selectedNode}
            allNodes={nodes as unknown as GraphNode[]}
            allEdges={edges as unknown as GraphEdge[]}
            pipelineDataSourceId={pipelineDataSourceId}
          />
        </div>

        {/* Right-side configuration panel（双击节点打开） */}
        {panelOpen && !readOnly && (
          <NodeDetailPanel
            selectedNode={selectedNode}
            allNodes={nodes as unknown as GraphNode[]}
            pipelineDataSourceId={pipelineDataSourceId}
            onNodeUpdate={handlePanelNodeUpdate}
            onNodeDelete={handlePanelNodeDelete}
            onClose={() => { setPanelOpen(false); }}
            open={panelOpen}
            readOnly={readOnly}
          />
        )}
      </div>

      {/* Import nodes modal */}
      {!readOnly && (
        <ImportPipelineModal
          visible={importModalVisible}
          currentPipelineDsId={pipelineDataSourceId}
          onClose={() => setImportModalVisible(false)}
          onImport={handleImportFromPipeline}
        />
      )}
    </div>
  );
});

// ─── Root export ──────────────────────────────────────────────────────────────

export const PipelineFlowEditor = forwardRef<PipelineFlowEditorHandle, PipelineFlowEditorProps>(
  function PipelineFlowEditor(props, ref) {
    const { nodes: pipelineNodes } = props;

    const graphNodes = useMemo<Node[]>(() => {
      return pipelineNodes.map((pn, i) => ({
        id: pn.id || `node_${i}`,
        type: 'pipelineNode',
        position: pn.position || { x: (i % 3) * 300, y: Math.floor(i / 3) * 160 },
        data: {
          pipelineNode: { ...pn, id: pn.id || `node_${i}` },
        },
      }));
    }, [pipelineNodes]);

    return (
      <ReactFlowProvider>
        <FlowInner ref={ref} {...props} initialNodes={graphNodes} />
      </ReactFlowProvider>
    );
  }
);
