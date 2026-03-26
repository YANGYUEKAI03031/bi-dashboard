import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
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
import { Button, Space, message, Modal, Form, Input, Select, Divider, Tag, Alert } from 'antd';
import {
  PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined,
  ThunderboltOutlined, ExportOutlined, MergeOutlined
} from '@ant-design/icons';
import './PipelineFlowEditor.css';
import { PipelineNode } from '../../services/pipelineService';
import {
  GraphNode, GraphEdge, detectCycle, topologicalSort,
  nodesToPipelineNodes, autoLayoutNodes
} from '../../utils/graphUtils';
import { MergeNodeDrawer } from './MergeNodeDrawer';
import { DataSourceService } from '../../services/dataSourceService';

interface PipelineFlowEditorProps {
  nodes: PipelineNode[];
  /** 管道级业务数据源：源节点从此库拉取表列表并生成 SELECT */
  pipelineDataSourceId?: number | null;
  onSave: (nodes: PipelineNode[], edges: GraphEdge[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
}

function quoteMysqlIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

const { TextArea } = Input;

const nodeTypeColors: Record<string, string> = {
  source: '#1890ff',
  transform: '#52c41a',
  output: '#722ed1',
  merge: '#fa8c16',
};

const typeLabels: Record<string, string> = {
  source: '源',
  transform: '转换',
  output: '输出',
  merge: '合并',
};

function generateId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function PipelineNodeCard({
  data,
  selected,
}: {
  data: Record<string, unknown>;
  selected: boolean;
}) {
  const pipelineNode = data.pipelineNode as PipelineNode;
  return (
    <div
      className={`pipeline-node-card type-${pipelineNode.type}`}
      style={{ borderColor: nodeTypeColors[pipelineNode.type] || '#1890ff' }}
    >
      <div className="pipeline-node-card-header">
        <span className="pipeline-node-card-name" title={pipelineNode.name}>
          {pipelineNode.name}
        </span>
        <span className={`pipeline-node-card-type type-${pipelineNode.type}`}>
          {typeLabels[pipelineNode.type] || pipelineNode.type}
        </span>
      </div>
      {pipelineNode.merge_type && (
        <Tag color="orange" style={{ marginBottom: 6, fontSize: 11 }}>
          {pipelineNode.merge_type.replace('_', ' ')}
        </Tag>
      )}
      {pipelineNode.upstream && pipelineNode.upstream.length > 0 && (
        <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>
          上游: {pipelineNode.upstream.join(', ')}
        </div>
      )}
      <div className="pipeline-node-card-sql" title={pipelineNode.sql}>
        {pipelineNode.sql}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  pipelineNode: PipelineNodeCard as unknown as NodeTypes[string],
};

function FlowInner({
  initialNodes,
  readOnly,
  onSave,
  onCancel,
  pipelineDataSourceId,
}: PipelineFlowEditorProps & { initialNodes: Node[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [mergeDrawerVisible, setMergeDrawerVisible] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [sourceTables, setSourceTables] = useState<{ name: string }[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [form] = Form.useForm();
  const watchedNodeType = Form.useWatch('type', form);
  const { fitView } = useReactFlow();
  const nextIdRef = useRef(initialNodes.length + 1);

  const getPipelineNode = useCallback((node: Node): PipelineNode => {
    return node.data.pipelineNode as PipelineNode;
  }, []);

  useEffect(() => {
    if (!editModalVisible || !pipelineDataSourceId || watchedNodeType !== 'source') {
      setSourceTables([]);
      return;
    }
    let cancelled = false;
    setTablesLoading(true);
    DataSourceService.getTables(String(pipelineDataSourceId))
      .then((list) => {
        if (!cancelled) setSourceTables(list);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceTables([]);
          message.error('加载表列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setTablesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editModalVisible, pipelineDataSourceId, watchedNodeType]);

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

      // 环检测
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

      // 更新目标节点 upstream
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

  const openEditModal = (nodeId: string) => {
    setEditingNodeId(nodeId);
    const node = (nodes as unknown as GraphNode[]).find(n => n.id === nodeId);
    if (!node) return;
    const pn = node.data.pipelineNode as PipelineNode;
    form.setFieldsValue({
      name: pn.name,
      type: pn.type,
      sql: pn.sql,
      merge_type: pn.merge_type,
    });
    setEditModalVisible(true);
  };

  const handleEditSave = () => {
    const values = form.getFieldsValue();
    if (!editingNodeId) return;

    const updatedNodes = (nodes as unknown as GraphNode[]).map(n => {
      if (n.id === editingNodeId) {
        const pn = n.data.pipelineNode as Record<string, unknown>;
        return {
          ...n,
          data: {
            ...n.data,
            pipelineNode: {
              ...pn,
              name: values.name,
              type: values.type,
              sql: values.sql,
              merge_type: values.merge_type,
            },
          },
        } as unknown as Node;
      }
      return n;
    });

    setNodes(updatedNodes);
    setEditModalVisible(false);
    setEditingNodeId(null);
    form.resetFields();
  };

  const handleDeleteNode = (nodeId: string) => {
    const filteredNodes = (nodes as unknown as GraphNode[]).filter(n => n.id !== nodeId);
    const filteredEdges = (edges as unknown as GraphEdge[]).filter(e => e.source !== nodeId && e.target !== nodeId);

    // 清理其他节点 upstream 引用
    const cleaned = filteredNodes.map(n => {
      const pn = n.data.pipelineNode as Record<string, unknown>;
      const upstream = (pn.upstream as string[]) || [];
      if (upstream.includes(nodeId)) {
        return {
          ...n,
          data: {
            ...n.data,
            pipelineNode: { ...pn, upstream: upstream.filter((id: string) => id !== nodeId) },
          },
        } as unknown as Node;
      }
      return n;
    });

    setNodes(cleaned);
    setEdges(filteredEdges as unknown as Edge[]);
  };

  const addNode = (type: string) => {
    const newId = generateId();
    const newNode: Node = {
      id: newId,
      type: 'pipelineNode',
      position: { x: 100 + nextIdRef.current * 50, y: 100 + nextIdRef.current * 60 },
      data: {
        pipelineNode: {
          id: newId,
          name: `新建${typeLabels[type] || type}节点`,
          type,
          sql: '',
          order: nextIdRef.current,
          upstream: [],
          merge_type: type === 'merge' ? 'union' : undefined,
        },
      },
    };
    nextIdRef.current += 1;
    setNodes([...nodes, newNode]);
  };

  const handleAutoLayout = () => {
    const layouted = autoLayoutNodes(nodes as unknown as GraphNode[], edges as unknown as GraphEdge[]);
    setNodes(layouted as unknown as Node[]);
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  };

  const handleSave = () => {
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

    // 从边推导 upstream
    const withUpstream = pipelineNodes.map((pn, i) => {
      const nodeId = sortedIds[i];
      const ups = graphEdges.filter(e => e.target === nodeId).map(e => e.source);
      return { ...pn, upstream: ups };
    });

    onSave(withUpstream as PipelineNode[], graphEdges);
  };

  return (
    <div className="pipeline-editor-container">
      {!readOnly && (
        <div className="pipeline-editor-toolbar">
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => addNode('source')}>添加源节点</Button>
            <Button icon={<ThunderboltOutlined />} onClick={() => addNode('transform')}>添加转换节点</Button>
            <Button icon={<MergeOutlined />} onClick={() => setMergeDrawerVisible(true)}>添加合并节点</Button>
            <Button icon={<ExportOutlined />} onClick={() => addNode('output')}>添加输出节点</Button>
          </Space>
          <Divider type="vertical" style={{ height: 24, margin: '0 8px' }} />
          <Button onClick={handleAutoLayout}>自动布局</Button>
          <Divider type="vertical" style={{ height: 24, margin: '0 8px' }} />
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
          <Button icon={<CloseOutlined />} onClick={onCancel}>取消</Button>
        </div>
      )}

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
          onNodeClick={(_, node) => !readOnly && openEditModal(node.id)}
        >
          <Background variant="dots" gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const pn = n.data?.pipelineNode as PipelineNode | undefined;
              return nodeTypeColors[pn?.type || ''] || '#1890ff';
            }}
          />
          {!readOnly && (
            <Panel position="top-right">
              <Space direction="vertical">
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => {
                    const selected = (nodes as unknown as GraphNode[]).filter(n => n.data?.selected);
                    if (selected.length > 0) {
                      selected.forEach(n => handleDeleteNode(n.id));
                    }
                  }}
                >
                  删除选中
                </Button>
              </Space>
            </Panel>
          )}
        </ReactFlow>
      </div>

      <Modal
        title="编辑节点"
        open={editModalVisible}
        onOk={handleEditSave}
        onCancel={() => { setEditModalVisible(false); setEditingNodeId(null); form.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]}>
            <Input placeholder="请输入节点名称" />
          </Form.Item>
          <Form.Item name="type" label="节点类型" rules={[{ required: true, message: '请选择节点类型' }]}>
            <Select>
              <Select.Option value="source">源 (Source)</Select.Option>
              <Select.Option value="transform">转换 (Transform)</Select.Option>
              <Select.Option value="output">输出 (Output)</Select.Option>
              <Select.Option value="merge">合并 (Merge)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="merge_type" label="合并类型" extra="仅在节点类型为「合并」时生效">
            <Select allowClear placeholder="选择合并类型（可选）">
              <Select.Option value="union">UNION</Select.Option>
              <Select.Option value="left_join">LEFT JOIN</Select.Option>
              <Select.Option value="right_join">RIGHT JOIN</Select.Option>
              <Select.Option value="full_join">FULL JOIN</Select.Option>
            </Select>
          </Form.Item>
          {watchedNodeType === 'source' && (
            <div style={{ marginBottom: 16 }}>
              {!pipelineDataSourceId ? (
                <Alert type="warning" showIcon message="请先在表单中选择管道数据源（业务库），再为源节点选表。" />
              ) : (
                <Form.Item label="从库中选择表">
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={tablesLoading}
                    allowClear
                    placeholder="选择表后将生成 SELECT * FROM …（可再在下方修改 SQL）"
                    options={sourceTables.map((t) => ({ label: t.name, value: t.name }))}
                    onChange={(tableName: string | null) => {
                      if (!tableName) return;
                      form.setFieldsValue({ sql: `SELECT * FROM ${quoteMysqlIdentifier(tableName)}` });
                    }}
                  />
                </Form.Item>
              )}
            </div>
          )}
          <Form.Item
            name="sql"
            label="SQL 语句"
            rules={[{ required: true, message: '请输入 SQL 语句' }]}
            extra={
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                占位符说明：<br />
                - <code>{'{prev_table}'}</code> — 第一个上游节点的结果表<br />
                - <code>{'{upstream_table_0}'}</code>, <code>{'{upstream_table_1}'}</code> — 按索引引用<br />
                - <code>{'{upstream_table_<node_id>'}</code> — 按节点 ID 引用
              </div>
            }
          >
            <TextArea rows={6} placeholder="SELECT * FROM {prev_table} WHERE ..." style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          {editingNodeId && (
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
              节点 ID: <code>{editingNodeId}</code>
              {(() => {
                const node = (nodes as unknown as GraphNode[]).find(n => n.id === editingNodeId);
                const pn = node?.data?.pipelineNode as PipelineNode | undefined;
                if (pn?.upstream?.length) {
                  return <><br />上游节点: <Tag>{pn.upstream.join(', ')}</Tag></>;
                }
                return null;
              })()}
            </div>
          )}
        </Form>
      </Modal>

      <MergeNodeDrawer
        visible={mergeDrawerVisible}
        sourceNodes={nodes as unknown as GraphNode[]}
        onConfirm={(config) => {
          const newId = generateId();
          const newNode: Node = {
            id: newId,
            type: 'pipelineNode',
            position: { x: 300 + nextIdRef.current * 50, y: 200 },
            data: {
              pipelineNode: {
                id: newId,
                name: config.output_name || '合并节点',
                type: 'merge',
                sql: '',
                order: nextIdRef.current,
                upstream: config.upstream_ids,
                merge_type: config.merge_type,
              },
            },
          };
          nextIdRef.current += 1;
          setNodes([...nodes, newNode]);

          const newEdges: Edge[] = config.upstream_ids.map(uid => ({
            id: `${uid}-${newId}`,
            source: uid,
            target: newId,
          }));
          setEdges([...edges, ...newEdges] as Edge[]);
          setMergeDrawerVisible(false);
        }}
        onCancel={() => setMergeDrawerVisible(false)}
      />
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
