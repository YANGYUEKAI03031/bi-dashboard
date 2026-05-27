import React, { useState } from 'react';
import { Drawer, Form, Select, Input, Button, Space, Collapse, Tag, Divider } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { GraphNode, MergeConfig } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';

interface MergeNodeDrawerProps {
  visible: boolean;
  sourceNodes: GraphNode[];
  onConfirm: (config: MergeConfig) => void;
  onCancel: () => void;
}

const { Panel } = Collapse;
const { Option } = Select;

const mergeTypeOptions = [
  { value: 'union_all', label: 'UNION ALL', desc: '纵向拼接所有行，保留重复（效率高）' },
  { value: 'union', label: 'UNION', desc: '纵向拼接并自动去重' },
];

export function MergeNodeDrawer({ visible, sourceNodes, onConfirm, onCancel }: MergeNodeDrawerProps) {
  const [selectedUpstream, setSelectedUpstream] = useState<string[]>([]);
  const [mergeType, setMergeType] = useState<string>('union');
  const [outputName, setOutputName] = useState('');

  const handleConfirm = () => {
    if (selectedUpstream.length < 2) return;
    onConfirm({
      upstream_ids: selectedUpstream,
      merge_type: mergeType as MergeConfig['merge_type'],
      output_name: outputName || undefined,
    });
    // Reset
    setSelectedUpstream([]);
    setMergeType('union');
    setOutputName('');
  };

  const handleClose = () => {
    setSelectedUpstream([]);
    setMergeType('union');
    setOutputName('');
    onCancel();
  };

  const renderSqlTemplate = () => {
    if (selectedUpstream.length < 2) return null;

    const op = mergeType === 'union_all' ? 'UNION ALL' : 'UNION';
    return (
      <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
        {selectedUpstream.map((id, i) => (
          <span key={id}>
            {'  '}SELECT * FROM &#123;upstream_table_{i}&#125;
            {i < selectedUpstream.length - 1 && (
              <>
                {'\n'}
                {op.includes('ALL') ? (
                  <span style={{ color: '#6366F1' }}> UNION ALL</span>
                ) : (
                  <span style={{ color: '#0EA5E9' }}> UNION</span>
                )}
              </>
            )}
          </span>
        ))}
      </pre>
    );
  };

  const selectedNodeDetails = sourceNodes
    .filter((n) => selectedUpstream.includes(n.id))
    .map((n) => n.data.pipelineNode as PipelineNode);

  return (
    <Drawer
      title="添加合并节点"
      placement="right"
      width={640}
      open={visible}
      onClose={handleClose}
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={handleClose}>取消</Button>
            <Button type="primary" disabled={selectedUpstream.length < 2} onClick={handleConfirm}>
              确认添加
            </Button>
          </Space>
        </div>
      }
    >
      <Form layout="vertical">
        {/* 上游节点多选 */}
        <Form.Item label="选择上游节点" required extra="请选择至少两个节点作为合并数据源">
          <Select
            mode="multiple"
            placeholder="点击选择上游节点"
            value={selectedUpstream}
            onChange={setSelectedUpstream}
            style={{ width: '100%' }}
          >
            {sourceNodes.map((node) => (
              <Option key={node.id} value={node.id}>
                <span>
                  <Tag
                    color={
                      (node.data.pipelineNode as Record<string, unknown>).type === 'source'
                        ? 'blue'
                        : (node.data.pipelineNode as Record<string, unknown>).type === 'output'
                          ? 'purple'
                          : 'orange'
                    }
                    style={{ marginRight: 6 }}
                  >
                    {(node.data.pipelineNode as Record<string, unknown>).type as string}
                  </Tag>
                  {(node.data.pipelineNode as Record<string, unknown>).name as string}
                  <span style={{ color: '#999', marginLeft: 6, fontSize: 12 }}>({node.id})</span>
                </span>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 选中节点详情 */}
        {selectedUpstream.length >= 2 && (
          <div style={{ marginBottom: 16 }}>
            <Divider style={{ margin: '12px 0' }}>已选节点</Divider>
            {selectedNodeDetails.map((node, i) => (
              <div key={node.id} style={{ marginBottom: 8 }}>
                <Tag>{i + 1}</Tag>
                <strong>{node.name}</strong>
                <span style={{ color: '#8c8c8c', marginLeft: 8, fontSize: 12 }}>{node.type}</span>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2, marginLeft: 32, fontFamily: 'monospace' }}>
                  {node.sql || '(空)'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 合并类型 */}
        <Form.Item label="合并方式" required>
          <Select value={mergeType} onChange={setMergeType} style={{ width: '100%' }}>
            {mergeTypeOptions.map((opt) => (
              <Option key={opt.value} value={opt.value}>
                <div>
                  <strong>{opt.label}</strong>
                  <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>— {opt.desc}</span>
                </div>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 输出表名 */}
        <Form.Item label="输出节点名称" extra="可选，用于标识合并后的结果">
          <Input placeholder="例如：合并结果" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
        </Form.Item>

        {/* SQL 模板预览 */}
        {selectedUpstream.length >= 2 && (
          <div style={{ marginTop: 8 }}>
            <Divider style={{ margin: '12px 0' }} />
            <Collapse defaultActiveKey={[]} ghost>
              <Panel
                header={
                  <span>
                    <InfoCircleOutlined style={{ marginRight: 6 }} />
                    SQL 模板预览
                  </span>
                }
                key="sql-template"
              >
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>占位符说明：</div>
                  <ul style={{ fontSize: 12, color: '#666', paddingLeft: 20 }}>
                    <li>
                      <code>{'{upstream_table_0}'}</code> — 第一个上游节点的结果表
                    </li>
                    <li>
                      <code>{'{upstream_table_1}'}</code> — 第二个上游节点的结果表
                    </li>
                    <li>
                      <code>{'{upstream_table_<node_id>'}</code> — 按节点 ID 引用
                    </li>
                    <li>
                      <code>{'{prev_table}'}</code> — 等同于第一个上游引用
                    </li>
                  </ul>
                </div>
                {renderSqlTemplate()}
              </Panel>
            </Collapse>
          </div>
        )}
      </Form>
    </Drawer>
  );
}
