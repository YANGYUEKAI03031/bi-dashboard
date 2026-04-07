/**
 * NodeDetailPanel - 右侧节点配置面板（数据预览在画布底部，见 PipelineCanvasPreviewPanel）。
 * 双击节点打开；单击仅更新底部预览。
 */
import React, { useState, useCallback } from 'react';
import {
  Form, Input, Select, Button, Space, Divider,
  Tag, Empty, Typography, Alert, message, Tooltip,
} from 'antd';
import {
  CloseOutlined, DeleteOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { GraphNode } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';
import { getNodeTypeDef, getEditorSelectableNodeTypeDefs } from '../../utils/nodeTypeRegistry';
import { SourceNodeConfig } from './visual-nodes/SourceNodeConfig';
import { FilterNodeConfig } from './visual-nodes/FilterNodeConfig';
import { AggregateNodeConfig } from './visual-nodes/AggregateNodeConfig';
import { JoinNodeConfig } from './visual-nodes/JoinNodeConfig';
import { ColumnSelectConfig } from './visual-nodes/ColumnSelectConfig';
import { OutputNodeConfig } from './visual-nodes/OutputNodeConfig';
import { MergeNodeConfig } from './visual-nodes/MergeNodeConfig';

const { Text } = Typography;

interface NodeDetailPanelProps {
  selectedNode: GraphNode | null;
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onNodeUpdate: (updatedNode: GraphNode) => void;
  onNodeDelete: (nodeId: string) => void;
  onClose: () => void;
  open: boolean;
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
  pipelineDataSourceId,
  onNodeUpdate,
  onNodeDelete,
  onClose,
  open,
  readOnly = false,
}) => {
  const [form] = Form.useForm();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const handleFormChange = useCallback(() => {
    if (!selectedNode || readOnly) return;
    const values = form.getFieldsValue();
    const pn = selectedNode.data.pipelineNode as Record<string, unknown>;
    const prevCfg = (pn.config as Record<string, unknown>) || {};
    const formCfg = (values.config as Record<string, unknown>) || {};
    onNodeUpdate({
      ...selectedNode,
      data: {
        ...selectedNode.data,
        pipelineNode: {
          ...pn,
          name: values.name,
          type: (values.type ?? pn.type) as string,
          config: { ...formCfg, ...prevCfg },
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
      <div className="node-detail-panel node-detail-panel--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="双击画布中的节点打开配置"
        />
      </div>
    );
  }

  return (
    <div className="node-detail-panel">
      <div className="node-detail-panel-header">
        <div className="node-detail-panel-header-title">
          {nodeDef && (
            <span style={{ color: nodeDef.color, fontSize: 18 }}>
              {nodeDef.icon}
            </span>
          )}
          <Text strong style={{ fontSize: 14 }}>
            {pipelineNode?.name || '未命名节点'}
          </Text>
        </div>
        <div className="node-detail-panel-header-actions">
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
      </div>
      <div className="node-detail-panel-body">
        <div className="node-detail-panel-content">
          <div className="node-detail-panel-intro">
            {nodeDef && (
              <Tag
                icon={nodeDef.icon as React.ReactElement}
                style={{ background: nodeDef.tagBg, color: nodeDef.tagColor, border: 'none' }}
              >
                {nodeDef.label}
              </Tag>
            )}
            <Text type="secondary" className="node-detail-panel-intro-desc">
              {nodeDef?.description}
            </Text>
          </div>

          {upstreams.length > 0 && (
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              className="node-detail-panel-alert"
              message={
                <div className="node-detail-panel-alert-inner">
                  <Text style={{ fontSize: 12 }}>
                    上游节点（{upstreams.length}个）：
                  </Text>
                  <div className="node-detail-panel-upstream-tags">
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
            className="node-detail-form"
          >
            <Form.Item
              name="name"
              label="节点名称"
              rules={[{ required: true, message: '请输入节点名称' }]}
            >
              <Input placeholder="给节点起个名字" />
            </Form.Item>

            {!readOnly && (
              <Form.Item
                name="type"
                label="节点类型"
              >
                <Select size="small">
                  {getEditorSelectableNodeTypeDefs(pipelineNode?.type).map(def => (
                    <Select.Option key={def.type} value={def.type}>
                      {def.icon} {def.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Divider style={{ margin: '12px 0' }} />

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
                pipelineDataSourceId={pipelineDataSourceId}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'join' && (
              <JoinNodeConfig
                node={selectedNode}
                allNodes={allNodes}
                pipelineDataSourceId={pipelineDataSourceId}
                onChange={handleFormChange}
                readOnly={readOnly}
              />
            )}
            {pipelineNode?.type === 'merge' && (
              <MergeNodeConfig
                node={selectedNode}
                allNodes={allNodes}
                pipelineDataSourceId={pipelineDataSourceId}
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

          <div className="node-detail-panel-nodeid">
            <Text type="secondary" style={{ fontSize: 11 }}>
              节点ID: <code style={{ fontSize: 11 }}>{selectedNode.id}</code>
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};
