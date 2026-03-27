/**
 * OutputNodeConfig - Visual output/destination configuration for "Export Data" nodes.
 * Lets user pick the target table and write mode.
 */
import React, { useState } from 'react';
import {
  Form, Select, Input, Divider, Tag, Typography,
  Alert, Card, Radio, Tooltip,
} from 'antd';
import { ExportOutlined, TableOutlined, WarningOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';

const { Text } = Typography;

interface OutputNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  onChange: () => void;
  readOnly?: boolean;
}

export const WRITE_MODES = [
  { value: 'create', label: '创建新表', description: '如果表已存在会报错', color: '#22C55E' },
  { value: 'replace', label: '覆盖已有表', description: '删除旧数据，插入新数据', color: '#F97316' },
  { value: 'append', label: '追加到已有表', description: '在现有数据后追加新行', color: '#0EA5E9' },
];

export const OutputNodeConfig: React.FC<OutputNodeConfigProps> = ({
  node,
  upstreamNodes,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedTargetTable = (config.targetTable as string) || '';
  const savedWriteMode = (config.writeMode as string) || 'create';
  const savedSchema = (config.targetSchema as string) || '';

  const [targetTable, setTargetTable] = useState(savedTargetTable);
  const [writeMode, setWriteMode] = useState(savedWriteMode);
  const [targetSchema, setTargetSchema] = useState(savedSchema);

  const updateConfig = (updates: Record<string, unknown>) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...config,
          ...updates,
        },
      },
    };
    onChange();
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="输出节点需要至少一个上游数据源。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const writeModeDef = WRITE_MODES.find(w => w.value === writeMode);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <ExportOutlined style={{ marginRight: 6 }} />
          输出目标
        </Text>
      </div>

      <Form layout="vertical" size="small">
        <Form.Item label="目标数据库" style={{ marginBottom: 12 }}>
          <Select
            value={targetSchema}
            onChange={(val) => { setTargetSchema(val); updateConfig({ targetSchema: val }); }}
            placeholder="选择目标数据库"
            disabled={readOnly}
            options={[
              { label: '同管道数据源', value: 'same' },
            ]}
          />
        </Form.Item>

        <Form.Item
          label={<span><TableOutlined style={{ marginRight: 4 }} />目标表名</span>}
          required
          style={{ marginBottom: 12 }}
        >
          <Input
            placeholder="例如：analytics_monthly_sales"
            value={targetTable}
            onChange={(e) => {
              const val = e.target.value;
              setTargetTable(val);
              updateConfig({ targetTable: val });
            }}
            disabled={readOnly}
            suffix={
              <Tooltip title="目标表名只允许字母、数字、下划线，长度 1-64">
                <span style={{ cursor: 'help', color: '#8c8c8c' }}>?</span>
              </Tooltip>
            }
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            建议以分析用途命名，如 analytics_daily_orders、rpt_user_stats
          </Text>
        </Form.Item>
      </Form>

      <Divider style={{ margin: '8px 0' }} />

      <div style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>写入模式</Text>
      </div>

      <Radio.Group
        value={writeMode}
        onChange={(e) => {
          setWriteMode(e.target.value);
          updateConfig({ writeMode: e.target.value });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {WRITE_MODES.map(wm => (
          <Radio.Button
            key={wm.value}
            value={wm.value}
            style={{
              height: 'auto',
              padding: '6px 12px',
              borderRadius: 6,
              lineHeight: 1.4,
              border: `1px solid ${writeMode === wm.value ? wm.color : '#d9d9d9'}`,
              background: writeMode === wm.value ? `${wm.color}15` : '#fff',
              color: writeMode === wm.value ? wm.color : '#595959',
              fontWeight: writeMode === wm.value ? 600 : 400,
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <div>{wm.label}</div>
            <Text style={{ fontSize: 11, color: writeMode === wm.value ? wm.color : '#8c8c8c', fontWeight: 400 }}>
              {wm.description}
            </Text>
          </Radio.Button>
        ))}
      </Radio.Group>

      {writeMode === 'replace' && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="覆盖写入警告"
          description={`将删除 "${targetTable || '目标表'}" 中的所有旧数据，请确认后再执行。`}
          style={{ marginTop: 12, fontSize: 11 }}
        />
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* Summary */}
      <Card size="small" style={{ background: '#f5f7fa', border: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>写入位置：</Text>
            <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {targetSchema === 'same' ? '（同管道数据源）' : targetSchema || '（未选择）'}
              {targetTable ? `.${targetTable}` : '（未指定表名）'}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>写入模式：</Text>
            <Tag style={{
              background: writeModeDef?.color + '20',
              color: writeModeDef?.color,
              border: 'none',
              fontSize: 11,
            }}>
              {writeModeDef?.label}
            </Tag>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>数据来源：</Text>
            <Text style={{ fontSize: 11 }}>
              {upstreamNodes.length} 个上游节点
            </Text>
          </div>
        </div>
      </Card>
    </div>
  );
};
