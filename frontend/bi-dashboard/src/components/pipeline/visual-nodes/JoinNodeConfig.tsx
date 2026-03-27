/**
 * JoinNodeConfig - Visual JOIN configuration for "Combine Tables" nodes.
 * Non-technical users configure the join type and key columns via dropdowns.
 */
import React, { useState } from 'react';
import {
  Form, Select, Button, Divider, Tag, Typography,
  Alert, Card, Radio, Tooltip, message,
} from 'antd';
import { SwapOutlined, DeleteOutlined, WarningOutlined, PlusOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';

const { Text } = Typography;

interface JoinKey {
  id: string;
  leftCol: string;
  rightCol: string;
}

interface JoinNodeConfigProps {
  node: GraphNode;
  allNodes: GraphNode[];
  onChange: () => void;
  readOnly?: boolean;
}

export const JOIN_TYPES = [
  { value: 'inner', label: 'Inner Join', description: '只保留两边匹配的行', color: '#6366F1' },
  { value: 'left', label: 'Left Join', description: '保留左表全部，右表无匹配则填 NULL', color: '#0EA5E9' },
  { value: 'right', label: 'Right Join', description: '保留右表全部，左表无匹配则填 NULL', color: '#22C55E' },
  { value: 'full', label: 'Full Join', description: '保留两边全部行，无匹配则填 NULL', color: '#8B5CF6' },
];

export const JoinNodeConfig: React.FC<JoinNodeConfigProps> = ({
  node,
  allNodes,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedJoinType = (config.joinType as string) || 'inner';
  const savedJoinKeys = (config.joinKeys as JoinKey[]) || [];

  const [joinType, setJoinType] = useState(savedJoinType);
  const [joinKeys, setJoinKeys] = useState<JoinKey[]>(
    savedJoinKeys.length > 0 ? savedJoinKeys : [{ id: `key_${Date.now()}`, leftCol: '', rightCol: '' }]
  );

  // Placeholder columns for left/right inputs
  const leftColumns: Array<{ name: string; type: string }> = [];
  const rightColumns: Array<{ name: string; type: string }> = [];

  const upstream = (pipelineNode.upstream as string[]) || [];
  const upstreamNodes = upstream.map(id => allNodes.find(n => n.id === id)).filter(Boolean) as GraphNode[];

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

  const handleJoinTypeChange = (type: string) => {
    setJoinType(type);
    updateConfig({ joinType: type });
  };

  const addJoinKey = () => {
    const newKeys = [...joinKeys, { id: `key_${Date.now()}`, leftCol: '', rightCol: '' }];
    setJoinKeys(newKeys);
    updateConfig({ joinKeys: newKeys });
  };

  const removeJoinKey = (id: string) => {
    const newKeys = joinKeys.filter(k => k.id !== id);
    if (newKeys.length === 0) {
      newKeys.push({ id: `key_${Date.now()}`, leftCol: '', rightCol: '' });
    }
    setJoinKeys(newKeys);
    updateConfig({ joinKeys: newKeys });
  };

  const updateJoinKey = (id: string, field: 'leftCol' | 'rightCol', value: string) => {
    const newKeys = joinKeys.map(k => k.id === id ? { ...k, [field]: value } : k);
    setJoinKeys(newKeys);
    updateConfig({ joinKeys: newKeys });
  };

  if (upstreamNodes.length < 2) {
    return (
      <Alert
        type="info"
        showIcon
        message="需要两个上游节点"
        description={
          <div>
            关联节点需要至少两个上游数据源。
            当前已连接：{upstreamNodes.length} 个。
            请先添加更多节点并连接到本节点。
          </div>
        }
        style={{ marginBottom: 12 }}
      />
    );
  }

  const validKeys = joinKeys.filter(k => k.leftCol && k.rightCol);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <SwapOutlined style={{ marginRight: 6 }} />
          关联方式
        </Text>
      </div>

      {/* Join type selector */}
      <Radio.Group
        value={joinType}
        onChange={(e) => handleJoinTypeChange(e.target.value)}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
      >
        {JOIN_TYPES.map(jt => (
          <Radio.Button
            key={jt.value}
            value={jt.value}
            style={{
              height: 'auto',
              padding: '6px 12px',
              borderRadius: 6,
              lineHeight: 1.4,
              border: `1px solid ${joinType === jt.value ? jt.color : '#d9d9d9'}`,
              background: joinType === jt.value ? `${jt.color}15` : '#fff',
              color: joinType === jt.value ? jt.color : '#595959',
              fontWeight: joinType === jt.value ? 600 : 400,
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <div>{jt.label}</div>
            <Text style={{ fontSize: 11, color: joinType === jt.value ? jt.color : '#8c8c8c', fontWeight: 400 }}>
              {jt.description}
            </Text>
          </Radio.Button>
        ))}
      </Radio.Group>

      <Divider style={{ margin: '8px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>匹配键（ON 条件）</Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {validKeys.length} 个匹配条件
        </Text>
      </div>

      {/* Column pairs */}
      {joinKeys.map((key, idx) => (
        <Card
          key={key.id}
          size="small"
          style={{ marginBottom: 8 }}
          bodyStyle={{ padding: '8px 10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag style={{ background: '#BAE6FD', color: '#0EA5E9', border: 'none', fontSize: 11 }}>
              左表
            </Tag>
            <Select
              size="small"
              placeholder="左表字段"
              value={key.leftCol || undefined}
              onChange={(val) => updateJoinKey(key.id, 'leftCol', val)}
              style={{ flex: 1 }}
              showSearch
              disabled={readOnly}
              options={leftColumns.map(c => ({ label: c.name, value: c.name }))}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Tag style={{ background: '#DDD6FE', color: '#8B5CF6', border: 'none', fontSize: 11 }}>
              右表
            </Tag>
            <Select
              size="small"
              placeholder="右表字段"
              value={key.rightCol || undefined}
              onChange={(val) => updateJoinKey(key.id, 'rightCol', val)}
              style={{ flex: 1 }}
              showSearch
              disabled={readOnly}
              options={rightColumns.map(c => ({ label: c.name, value: c.name }))}
            />
            {!readOnly && joinKeys.length > 1 && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeJoinKey(key.id)}
              />
            )}
          </div>
        </Card>
      ))}

      {!readOnly && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={addJoinKey}
          style={{ width: '100%', marginTop: 4 }}
        >
          添加匹配条件（多键关联）
        </Button>
      )}

      {joinType !== 'inner' && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="非等值关联可能导致行数增加"
          description={
            joinType === 'left' ? 'Left Join 会保留左表所有行，右表无匹配时对应字段填充 NULL。' :
            joinType === 'right' ? 'Right Join 会保留右表所有行，左表无匹配时对应字段填充 NULL。' :
            'Full Join 会产生左右表的笛卡尔补集，请注意结果行数。'
          }
          style={{ marginTop: 12, fontSize: 11 }}
        />
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* SQL preview */}
      <Text type="secondary" style={{ fontSize: 11 }}>生成的查询：</Text>
      <div style={{
        marginTop: 4,
        padding: '6px 10px',
        background: '#f5f7fa',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#595959',
        minHeight: 28,
      }}>
        {validKeys.length === 0 ? (
          <span style={{ color: '#bfbfbf' }}>（请添加匹配键）</span>
        ) : (
          <span>
            SELECT * FROM left_table a<br />
            &nbsp;&nbsp;{joinType.toUpperCase().replace('_', ' ')} JOIN right_table b<br />
            &nbsp;&nbsp;ON {validKeys.map(k => `a.\`${k.leftCol}\` = b.\`${k.rightCol}\``).join(' AND ')}
          </span>
        )}
      </div>
    </div>
  );
};
