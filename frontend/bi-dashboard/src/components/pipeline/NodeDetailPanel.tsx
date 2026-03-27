/**
 * NodeDetailPanel - Right-side configuration panel for pipeline nodes.
 * Replaces the old edit modal. Shows Config / Preview tabs.
 * Click a node on the canvas to open this panel.
 */
import React, { useState, useCallback } from 'react';
import {
  Tabs, Form, Input, Select, Button, Space, Divider,
  Tag, Empty, Typography, Alert, Spin, message, Tooltip,
} from 'antd';
import {
  CloseOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import type { TabsProps } from 'antd';
import { GraphNode, GraphEdge } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';
import { getNodeTypeDef, NODE_TYPE_REGISTRY } from '../../utils/nodeTypeRegistry';
import { SourceNodeConfig } from './visual-nodes/SourceNodeConfig';
import { FilterNodeConfig } from './visual-nodes/FilterNodeConfig';
import { AggregateNodeConfig } from './visual-nodes/AggregateNodeConfig';
import { JoinNodeConfig } from './visual-nodes/JoinNodeConfig';
import { ColumnSelectConfig } from './visual-nodes/ColumnSelectConfig';
import { OutputNodeConfig } from './visual-nodes/OutputNodeConfig';
import { NodePreviewTable } from './NodePreviewTable';
import { useNodePreview } from '../../hooks/useNodePreview';

const { Text } = Typography;

interface NodeDetailPanelProps {
  /** The node currently selected on the canvas */
  selectedNode: GraphNode | null;
  /** All nodes in the graph (for upstream resolution) */
  allNodes: GraphNode[];
  /** All edges in the graph */
  allEdges: GraphEdge[];
  /** Pipeline-level data source ID (for source nodes) */
  pipelineDataSourceId?: number | null;
  /** Callback when node config is updated */
  onNodeUpdate: (updatedNode: GraphNode) => void;
  /** Callback when node is deleted */
  onNodeDelete: (nodeId: string) => void;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Whether panel is visible */
  open: boolean;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

function getUpstreamNodes(node: GraphNode, allNodes: GraphNode[]): GraphNode[] {
  const upstream = (node.data.pipelineNode as Record<string, unknown>)?.upstream as string[] | undefined;
  if (!upstream) return [];
  return upstream.map(id => allNodes.find(n => n.id === id)).filter(Boolean) as GraphNode[];
}

export const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({
  selectedNode,
  allNodes,
  allEdges,
  pipelineDataSourceId,
  onNodeUpdate,
  onNodeDelete,
  onClose,
  open,
  readOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState('config');
  const [form] = Form.useForm();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form when selected node changes
  React.useEffect(() => {
    if (selectedNode && open) {
      const pn = selectedNode.data.pipelineNode as PipelineNode;
      form.setFieldsValue({
        name: pn.name,
        type: pn.type,
        config: pn.config || {},
      });
      setConfirmDelete(false);
    }
  }, [selectedNode, open, form]);

  const pipelineNode = selectedNode?.data?.pipelineNode as PipelineNode | undefined;
  const nodeDef = pipelineNode ? getNodeTypeDef(pipelineNode.type) : null;
  const upstreams = selectedNode ? getUpstreamNodes(selectedNode, allNodes) : [];

  const { previewData, previewLoading, previewError, loadPreview } = useNodePreview();

  // Auto-load preview when node changes
  React.useEffect(() => {
    if (selectedNode && open && nodeDef?.hasPreview) {
      loadPreview({
        node: selectedNode,
        allNodes,
        allEdges,
        pipelineDataSourceId: pipelineDataSourceId ?? undefined,
      });
    }
  }, [selectedNode?.id, open, allEdges, allNodes, loadPreview, nodeDef?.hasPreview, pipelineDataSourceId, selectedNode]);

  const handleFormChange = useCallback(() => {
    if (!selectedNode || readOnly) return;
    const values = form.getFieldsValue();
    const pn = selectedNode.data.pipelineNode as Record<string, unknown>;
    onNodeUpdate({
      ...selectedNode,
      data: {
        ...selectedNode.data,
        pipelineNode: {
          ...pn,
          name: values.name,
          type: values.type,
          config: values.config || {},
        },
      },
    });
  }, [selectedNode, form, readOnly, onNodeUpdate]);

  const handleDelete = () => {
    if (!selectedNode) return;
    onNodeDelete(selectedNode.id);
    onClose();
  };

  if (!selectedNode) {
    return (
      <div
        style={{
          width: 360,
          flexShrink: 0,
          borderLeft: '1px solid #e8e8e8',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="点击画布中的节点进行配置"
        />
      </div>
    );
  }

  const tabItems: TabsProps['items'] = [
    {
      key: 'config',
      label: '配置',
      children: (
        <div style={{ padding: '0 0 16px' }}>
          {/** Node type badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            {nodeDef && (
              <Tag
                icon={nodeDef.icon as React.ReactElement}
                style={{ background: nodeDef.tagBg, color: nodeDef.tagColor, border: 'none' }}
              >
                {nodeDef.label}
              </Tag>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {nodeDef?.description}
            </Text>
          </div>

          {/** Upstream info */}
          {upstreams.length > 0 && (
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message={
                <div>
                  <Text style={{ fontSize: 12 }}>
                    上游节点（{upstreams.length}个）：
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    {upstreams.map(up => {
                      const upPn = up.data.pipelineNode as PipelineNode;
                      const upDef = getNodeTypeDef(upPn.type);
                      return (
                        <Tag key={up.id} style={{ marginBottom: 2 }}>
                          {upDef?.icon} {upPn.name}
                        </Tag>
                      );
                    })}
                  </div>
                </div>
              }
              style={{ marginBottom: 16, fontSize: 12 }}
            />
          )}

          <Form
            form={form}
            layout="vertical"
            onValuesChange={handleFormChange}
            size="small"
          >
            <Form.Item
              name="name"
              label="节点名称"
              rules={[{ required: true, message: '请输入节点名称' }]}
            >
              <Input placeholder="给节点起个名字" />
            </Form.Item>

            {/** Type selector */}
            {!readOnly && (
              <Form.Item
                name={['config', 'nodeType']}
                label="节点类型"
              >
                <Select size="small">
                  {Object.values(NODE_TYPE_REGISTRY).map(def => (
                    <Select.Option key={def.type} value={def.type}>
                      {def.icon} {def.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/** Render type-specific config */}
            {pipelineNode?.type === 'source' && (
              <SourceNodeConfig
                node={selectedNode}
                pipelineDataSourceId={pipelineDataSourceId}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'filter' && (
              <FilterNodeConfig
                node={selectedNode}
                upstreamNodes={upstreams}
                allNodes={allNodes}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'aggregate' && (
              <AggregateNodeConfig
                node={selectedNode}
                upstreamNodes={upstreams}
                allNodes={allNodes}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'join' && (
              <JoinNodeConfig
                node={selectedNode}
                allNodes={allNodes}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'column_select' && (
              <ColumnSelectConfig
                node={selectedNode}
                upstreamNodes={upstreams}
                allNodes={allNodes}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'output' && (
              <OutputNodeConfig
                node={selectedNode}
                upstreamNodes={upstreams}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'transform' && (
              <FilterNodeConfig
                node={selectedNode}
                upstreamNodes={upstreams}
                allNodes={allNodes}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
          </Form>

          {/** Node ID */}
          <div style={{ marginTop: 16, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              节点ID: <code style={{ fontSize: 11 }}>{selectedNode.id}</code>
            </Text>
          </div>
        </div>
      ),
    },
    {
      key: 'preview',
      label: (
        <span>
          <EyeOutlined /> 预览
          {previewData && (
            <Tag style={{ marginLeft: 4, fontSize: 10 }}>{previewData.rows.length}</Tag>
          )}
        </span>
      ),
      children: (
        <div style={{ padding: '0 0 16px' }}>
          {nodeDef?.hasPreview ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={previewLoading}
                  onClick={() => loadPreview({
                    node: selectedNode,
                    allNodes,
                    allEdges,
                    pipelineDataSourceId: pipelineDataSourceId ?? undefined,
                  })}
                >
                  刷新预览
                </Button>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {previewData ? `共 ${previewData.rows.length} 行` : ''}
                </Text>
              </div>
              {previewError && (
                <Alert
                  type="error"
                  message="预览失败"
                  description={previewError}
                  style={{ marginBottom: 12 }}
                />
              )}
              {previewLoading && (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <Spin /> <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>正在加载预览数据…</Text>
                </div>
              )}
              {!previewLoading && !previewError && previewData && (
                <NodePreviewTable data={previewData} compact={false} />
              )}
              {!previewLoading && !previewError && !previewData && (
                <Empty description="配置节点后可预览数据" />
              )}
            </>
          ) : (
            <Empty description="此节点类型不支持预览" />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="node-detail-panel">
      <div className="node-detail-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {nodeDef && (
            <span style={{ color: nodeDef.color, fontSize: 18 }}>
              {nodeDef.icon}
            </span>
          )}
          <Text strong style={{ fontSize: 14 }}>
            {pipelineNode?.name || '未命名节点'}
          </Text>
        </div>
        <Space size={4}>
          {!readOnly && (
            <Tooltip title="删除节点">
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    message.warning('再点一次确认删除');
                  } else {
                    handleDelete();
                  }
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="关闭面板">
            <Button size="small" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </Space>
      </div>
      <div className="node-detail-panel-tabs">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="small"
        />
      </div>
    </div>
  );
};
