import React, { useState, useCallback, useRef, useMemo } from 'react';
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
  BackgroundVariant,
  Panel,
  NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import { Button, Space, message, Dropdown, Tag, Tooltip, Alert } from 'antd';
import {
  PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined,
  ThunderboltOutlined, ExportOutlined, MergeOutlined, DownOutlined,
  DatabaseOutlined, FilterOutlined, BarChartOutlined, SwapOutlined,
  AppstoreOutlined, TableOutlined, ColumnWidthOutlined, EyeOutlined
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import './PipelineFlowEditor.css';
import { PipelineNode } from '../../services/pipelineService';
import {
  GraphNode, GraphEdge, detectCycle, topologicalSort,
  nodesToPipelineNodes, autoLayoutNodes
} from '../../utils/graphUtils';
import { NodeDetailPanel } from './NodeDetailPanel';
import { CompactNodePreview } from './CompactNodePreview';
import { getNodeTypeDef, NODE_TYPE_REGISTRY } from '../../utils/nodeTypeRegistry';

interface PipelineFlowEditorProps {
  nodes: PipelineNode[];
  pipelineDataSourceId?: number | null;
  onSave: (nodes: PipelineNode[], edges: GraphEdge[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
}

function generateId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Node Card (updated to show type + compact preview) ───────────────────────

function PipelineNodeCard({
  data,
  selected,
}: {
  data: Record<string, unknown>;
  selected: boolean;
}) {
  const pipelineNode = data.pipelineNode as PipelineNode;
  const def = getNodeTypeDef(pipelineNode.type);

  return (
    <div
      className={`pipeline-node-card type-${pipelineNode.type}`}
      style={{
        borderColor: selected ? def.color : def.borderColor,
        boxShadow: selected ? `0 0 0 2px ${def.color}40` : undefined,
      }}
    >
      <div className="pipeline-node-card-header">
        <span style={{ color: def.color, fontSize: 16, flexShrink: 0 }}>{def.icon}</span>
        <span className="pipeline-node-card-name" title={pipelineNode.name}>
          {pipelineNode.name}
        </span>
        <span
          className={`pipeline-node-card-type type-badge`}
          style={{ background: def.tagBg, color: def.tagColor }}
        >
          {def.labelShort}
        </span>
      </div>

      {/* Compact config summary */}
      <NodeConfigSummary node={pipelineNode} />

      {/* Mini preview (when available) */}
      <div className="pipeline-node-card-preview">
        <CompactNodePreview pipelineNode={pipelineNode} />
      </div>
    </div>
  );
}

function NodeConfigSummary({ node }: { node: PipelineNode }) {
  const config = (node.config || {}) as Record<string, unknown>;
  const def = getNodeTypeDef(node.type);

  if (node.type === 'source') {
    const tableName = config.tableName as string | undefined;
    if (tableName) {
      return (
        <div className="pipeline-node-card-summary">
          <Tag icon={<TableOutlined />} style={{ fontSize: 11 }}>
            {tableName}
          </Tag>
        </div>
      );
    }
  }

  if (node.type === 'filter') {
    const conditions = (config.conditions || []) as Array<{ column: string; operator: string; value: string }>;
    const logic = (config.logic as string) || 'AND';
    if (conditions.length > 0) {
      const preview = conditions
        .filter(c => c.column)
        .slice(0, 2)
        .map(c => `${c.column} ${c.operator} ${c.value || '…'}`)
        .join(` ${logic} `);
      return (
        <div className="pipeline-node-card-summary">
          <Tag style={{ fontSize: 10 }}>{conditions.length}个条件</Tag>
          <span style={{ fontSize: 10, color: '#8c8c8c' }}>{preview}</span>
        </div>
      );
    }
  }

  if (node.type === 'aggregate') {
    const groupBy = (config.groupBy as string[]) || [];
    const aggs = (config.aggregations || []) as Array<{ func: string; column: string; alias: string }>;
    if (aggs.length > 0 || groupBy.length > 0) {
      const summary = [
        groupBy.length > 0 && `按 ${groupBy.length} 维分组`,
        aggs.length > 0 && `${aggs.length} 个聚合`,
      ].filter(Boolean).join('，');
      return (
        <div className="pipeline-node-card-summary">
          <Tag color="green" style={{ fontSize: 10 }}>{summary}</Tag>
        </div>
      );
    }
  }

  if (node.type === 'join') {
    const jt = (config.joinType as string) || 'inner';
    const keys = (config.joinKeys || []) as Array<{ leftCol: string; rightCol: string }>;
    if (keys.length > 0) {
      return (
        <div className="pipeline-node-card-summary">
          <Tag color="purple" style={{ fontSize: 10 }}>{jt.toUpperCase()}</Tag>
          <span style={{ fontSize: 10, color: '#8c8c8c' }}>{keys[0]?.leftCol} = {keys[0]?.rightCol}</span>
        </div>
      );
    }
  }

  if (node.type === 'output') {
    const target = (config.targetTable as string) || config.targetSchema as string;
    const mode = (config.writeMode as string) || 'create';
    return (
      <div className="pipeline-node-card-summary">
        <Tag color="orange" style={{ fontSize: 10 }}>{mode === 'create' ? '新建' : mode === 'replace' ? '覆盖' : '追加'}</Tag>
        {target && <Tag style={{ fontSize: 10 }}>{target}</Tag>}
      </div>
    );
  }

  return null;
}

const nodeTypes: NodeTypes = {
  pipelineNode: PipelineNodeCard as unknown as NodeTypes[string],
};

// ─── Add Node Menu ────────────────────────────────────────────────────────────

function AddNodeMenu({ onAdd }: { onAdd: (type: string) => void }) {
  const items: MenuProps['items'] = [
    {
      key: 'header',
      type: 'group',
      label: '数据处理',
      children: [
        {
          key: 'filter',
          label: (
            <Space><FilterOutlined style={{ color: NODE_TYPE_REGISTRY.filter.color }} />过滤行</Space>
          ),
          onClick: () => onAdd('filter'),
        },
        {
          key: 'aggregate',
          label: (
            <Space><BarChartOutlined style={{ color: NODE_TYPE_REGISTRY.aggregate.color }} />聚合汇总</Space>
          ),
          onClick: () => onAdd('aggregate'),
        },
        {
          key: 'join',
          label: (
            <Space><SwapOutlined style={{ color: NODE_TYPE_REGISTRY.join.color }} />关联表</Space>
          ),
          onClick: () => onAdd('join'),
        },
        {
          key: 'column_select',
          label: (
            <Space><AppstoreOutlined style={{ color: NODE_TYPE_REGISTRY.column_select.color }} />选择列</Space>
          ),
          onClick: () => onAdd('column_select'),
        },
      ],
    },
    {
      key: 'header2',
      type: 'group',
      label: '数据输出',
      children: [
        {
          key: 'output',
          label: (
            <Space><ExportOutlined style={{ color: NODE_TYPE_REGISTRY.output.color }} />输出到表</Space>
          ),
          onClick: () => onAdd('output'),
        },
      ],
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft">
      <Button icon={<PlusOutlined />}>
        添加节点 <DownOutlined />
      </Button>
    </Dropdown>
  );
}

// ─── Flow Inner ──────────────────────────────────────────────────────────────

function FlowInner({
  initialNodes,
  readOnly,
  onSave,
  onCancel,
  pipelineDataSourceId,
}: PipelineFlowEditorProps & { initialNodes: Node[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);

  // Panel state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const { fitView } = useReactFlow();
  const nextIdRef = useRef(initialNodes.length + 1);

  const selectedNode = useMemo(
    () => (nodes as unknown as GraphNode[]).find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
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

      // Cycle detection
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

      // Update target node's upstream
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

      setEdges([...edges, newEdge] as Edge[]);
      setNodes(updatedNodes);
    },
    [nodes, edges, setNodes, setEdges]
  );

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (readOnly) return;
    setSelectedNodeId(node.id);
    setPanelOpen(true);
  }, [readOnly]);

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
      setEdges(filteredEdges as unknown as Edge[]);
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
    setEdges(filteredEdges as unknown as Edge[]);
    setPanelOpen(false);
    setSelectedNodeId(null);
  }, [nodes, edges, setNodes, setEdges]);

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
    // Auto-open panel for new node
    setSelectedNodeId(newId);
    setPanelOpen(true);
  }, [setNodes]);

  const handleAutoLayout = useCallback(() => {
    const layouted = autoLayoutNodes(nodes as unknown as GraphNode[], edges as unknown as GraphEdge[]);
    setNodes(layouted as unknown as Node[]);
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  const handleSave = useCallback(() => {
    if (nodes.length === 0) {
      message.warning('请至少添加一个节点');
      return;
    }
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n: Node) => { positions[n.id] = n.position; });

    const graphNodes = nodes as unknown as GraphNode[];
    const sortedIds = topologicalSort(graphNodes, edges as unknown as GraphEdge[]);
    const sortedNodes = sortedIds
      .map(id => graphNodes.find(n => n.id === id))
      .filter(Boolean) as GraphNode[];

    const pipelineNodes = nodesToPipelineNodes(sortedNodes, positions);
    const graphEdges = edges as unknown as GraphEdge[];

    const withUpstream = pipelineNodes.map((pn, i) => {
      const nodeId = sortedIds[i];
      const ups = graphEdges.filter(e => e.target === nodeId).map(e => e.source);
      return { ...pn, upstream: ups };
    });

    onSave(withUpstream as PipelineNode[], graphEdges);
  }, [nodes, edges, onSave]);

  return (
    <div className="pipeline-editor-container">
      {/* Toolbar */}
      {!readOnly && (
        <div className="pipeline-editor-toolbar">
          <Space wrap>
            <AddNodeMenu onAdd={addNode} />
          </Space>
          <Space style={{ marginLeft: 'auto' }}>
            <Button onClick={handleAutoLayout}>自动布局</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
            <Button icon={<CloseOutlined />} onClick={onCancel}>取消</Button>
          </Space>
        </div>
      )}

      {/* Main area: canvas + right panel */}
      <div className="pipeline-editor-body">
        <div className="pipeline-flow-wrapper">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : handleConnect}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={readOnly ? null : 'Delete'}
            disabled={readOnly}
            onNodeClick={handleNodeClick}
          >
            <Background variant="dots" gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const pn = n.data?.pipelineNode as PipelineNode | undefined;
                return getNodeTypeDef(pn?.type || '').color || '#1890ff';
              }}
            />
            {!readOnly && (
              <Panel position="top-right">
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={handleNodesDelete}
                >
                  删除选中
                </Button>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Right-side configuration panel */}
        {panelOpen && !readOnly && (
          <NodeDetailPanel
            selectedNode={selectedNode}
            allNodes={nodes as unknown as GraphNode[]}
            allEdges={edges as unknown as GraphEdge[]}
            pipelineDataSourceId={pipelineDataSourceId}
            onNodeUpdate={handlePanelNodeUpdate}
            onNodeDelete={handlePanelNodeDelete}
            onClose={() => { setPanelOpen(false); setSelectedNodeId(null); }}
            open={panelOpen}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

export function PipelineFlowEditor(props: PipelineFlowEditorProps) {
  const { nodes: pipelineNodes } = props;

  const graphNodes = useMemo<Node[]>(() => {
    return pipelineNodes.map((pn, i) => ({
      id: pn.id || `node_${i}`,
      type: 'pipelineNode',
      position: pn.position || { x: (i % 3) * 300, y: Math.floor(i / 3) * 150 },
      data: { pipelineNode: { ...pn, id: pn.id || `node_${i}` } },
    }));
  }, [pipelineNodes]);

  return (
    <ReactFlowProvider>
      <FlowInner {...props} initialNodes={graphNodes} />
    </ReactFlowProvider>
  );
}
