/**
 * OutputNodeConfig - Visual output/destination configuration for "Export Data" nodes.
 * Lets user pick the target table and write mode.
 */
import React, { useState } from 'react';
import {
  Select, Input, Divider, Tag, Typography,
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
  { value: 'replace', label: '覆盖', description: '删除旧数据，插入新数据', color: '#F97316' },
  { value: 'append',  label: '追加', description: '在现有数据后追加新行', color: '#0EA5E9' },
  { value: 'upsert',  label: 'Upsert（插入或更新）', description: '按唯一键，冲突时更新已有行', color: '#22C55E' },
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
  const savedWriteMode = (config.writeMode as string) || 'upsert';
  const savedSchema = (config.targetSchema as string) || '';

  const savedUniqueKey = (config.uniqueKey as string) || '';
  const [targetTable, setTargetTable] = useState(savedTargetTable);
  const [writeMode, setWriteMode] = useState(savedWriteMode);
  const [targetSchema, setTargetSchema] = useState(savedSchema);
  const [uniqueKey, setUniqueKey] = useState(savedUniqueKey);

  /**
   * 输出节点必须带 sql 占位串，满足后端 PipelineNodeCreate.sql 必填校验。
   * 每次 updateConfig 时同步更新 sql，内容与预览引擎一致。
   */
  const syncSql = (updates: Record<string, unknown>) => {
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const mergedConfig = { ...config, ...updates };
    // 读取上游表名（供预览/执行时替换 {prev_table} 占位符）
    const upstreamNodeId = (pn.upstream as string[])?.[0] ?? '';
    // 始终写一个合法的占位 SELECT；实际执行时引擎会替换 {prev_table}
    const sql = upstreamNodeId
      ? `SELECT * FROM {prev_table}`
      : `SELECT * FROM {prev_table}`;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        sql,
        config: mergedConfig,
      },
    };
  };

  const updateConfig = (updates: Record<string, unknown>) => {
    if (readOnly) return;
    syncSql(updates);
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

      {/* 避免与 NodeDetailPanel 外层 Form 嵌套（非法 HTML） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 4, fontSize: 12 }}>目标数据库</div>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={targetSchema}
            onChange={(val) => { setTargetSchema(val); updateConfig({ targetSchema: val }); }}
            placeholder="选择目标数据库"
            disabled={readOnly}
            options={[
              { label: '同管道数据源', value: 'same' },
            ]}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: 12 }}>
            <TableOutlined style={{ marginRight: 4 }} />
            目标表名
            <Text type="danger" style={{ marginLeft: 4 }}>*</Text>
          </div>
          <Input
            size="small"
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
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            建议以分析用途命名，如 analytics_daily_orders、rpt_user_stats
          </Text>
        </div>
      </div>

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

      {writeMode === 'upsert' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12 }}>
            唯一键列
            <Text type="danger" style={{ marginLeft: 4 }}>*</Text>
          </div>
          <Input
            size="small"
            placeholder="例如：id 或 order_id"
            value={uniqueKey}
            onChange={(e) => {
              const val = e.target.value;
              setUniqueKey(val);
              updateConfig({ uniqueKey: val });
            }}
            disabled={readOnly}
            suffix={
              <Tooltip title="MySQL 唯一键：冲突时 ON DUPLICATE KEY UPDATE 更新该行">
                <span style={{ cursor: 'help', color: '#8c8c8c' }}>?</span>
              </Tooltip>
            }
          />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            填写表中的唯一键/主键列名，如 <code>id</code>、<code>order_id</code> 等。
            冲突行会更新所有列，非冲突行会插入新行。
          </Text>
        </div>
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
          {writeMode === 'upsert' && uniqueKey && (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>唯一键：</Text>
              <Text code style={{ fontSize: 11 }}>{uniqueKey}</Text>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
