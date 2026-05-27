/**
 * DeduplicateNodeConfig - Visual deduplication configuration for "Deduplicate" nodes.
 * Removes duplicate rows based on selected columns (similar to pandas drop_duplicates).
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Checkbox, Button, Divider, Typography, Alert, Space, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';

const { Text } = Typography;

interface DeduplicateNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

type KeepMode = 'first' | 'last';

export const DeduplicateNodeConfig: React.FC<DeduplicateNodeConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedColumns = (config.dedupColumns as string[]) || [];
  const savedKeepMode = (config.keepMode as KeepMode) || 'first';
  const savedKeepAll = (config.keepAllColumns as boolean) ?? false;

  const [selectedColumns, setSelectedColumns] = useState<string[]>(savedColumns);
  const [keepMode, setKeepMode] = useState<KeepMode>(savedKeepMode);
  const [keepAllColumns, setKeepAllColumns] = useState<boolean>(savedKeepAll);

  // 获取上游节点和数据源 ID
  const upstreamNode = upstreamNodes[0];
  const upstreamPn = upstreamNode?.data.pipelineNode as PipelineNode | undefined;
  const upstreamDsId = upstreamPn ? resolvePreviewDataSourceId(upstreamPn, pipelineDataSourceId ?? null) : undefined;

  const { previewData, previewLoading, loadPreview, clearPreview } = useNodePreview();

  // 签名用于检测上游变化
  const nodesSignature = useMemo(
    () =>
      JSON.stringify(
        allNodes.map((n) => ({
          id: n.id,
          pn: n.data.pipelineNode as PipelineNode,
        })),
      ),
    [allNodes],
  );

  // 加载上游预览
  const loadKeyRef = useRef<string>('');
  useEffect(() => {
    if (!upstreamNode || !upstreamDsId) {
      return;
    }
    const key = `${upstreamNode.id}-${nodesSignature}-${upstreamDsId}`;
    if (key === loadKeyRef.current) return;
    loadKeyRef.current = key;
    clearPreview();
    loadPreview(
      {
        node: upstreamNode,
        allNodes,
        pipelineDataSourceId: upstreamDsId,
        limit: 50,
      },
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNode?.id, nodesSignature, upstreamDsId, loadPreview, clearPreview]);

  // 从预览数据获取所有列
  const allColumns = useMemo(() => {
    if (previewData?.columns) {
      return previewData.columns.map((col, idx) => ({
        name: col,
        type: previewData.columnTypes?.[idx] || 'string',
      }));
    }
    return [];
  }, [previewData]);

  const updateConfig = (updates: Record<string, unknown>) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const mergedConfig = { ...config, ...updates };
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: mergedConfig,
      },
    };
    onChange();
  };

  const handleColumnToggle = (colName: string, checked: boolean) => {
    let newColumns: string[];
    if (checked) {
      newColumns = [...selectedColumns, colName];
    } else {
      newColumns = selectedColumns.filter((c) => c !== colName);
    }
    setSelectedColumns(newColumns);
    updateConfig({ dedupColumns: newColumns });
  };

  const handleSelectAll = () => {
    const allColNames = allColumns.map((c) => c.name);
    setSelectedColumns(allColNames);
    updateConfig({ dedupColumns: allColNames });
  };

  const handleDeselectAll = () => {
    setSelectedColumns([]);
    updateConfig({ dedupColumns: [] });
  };

  const handleKeepModeChange = (mode: KeepMode) => {
    setKeepMode(mode);
    updateConfig({ keepMode: mode });
  };

  const handleKeepAllChange = (checked: boolean) => {
    setKeepAllColumns(checked);
    updateConfig({ keepAllColumns: checked });
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="去重节点需要至少一个上游数据源。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  if (previewLoading) {
    return <Alert type="info" message="正在加载上游字段信息..." style={{ marginBottom: 12 }} />;
  }

  if (allColumns.length === 0 && !previewLoading) {
    return (
      <Alert
        type="warning"
        showIcon
        message="无法获取上游字段"
        description="请确保上游节点已正确配置并可以预览数据。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <DeleteOutlined style={{ marginRight: 6 }} />
          去重方式
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {selectedColumns.length > 0 ? `基于 ${selectedColumns.length} 个字段` : '请选择去重依据字段'}
        </Text>
      </div>

      {/* 去重模式选择 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: '#595959' }}>保留策略</Text>
        </div>
        <Space>
          <Button
            size="small"
            type={keepMode === 'first' ? 'primary' : 'default'}
            onClick={() => handleKeepModeChange('first')}
            disabled={readOnly}
          >
            保留首条
          </Button>
          <Button
            size="small"
            type={keepMode === 'last' ? 'primary' : 'default'}
            onClick={() => handleKeepModeChange('last')}
            disabled={readOnly}
          >
            保留末条
          </Button>
        </Space>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {keepMode === 'first' ? '对于重复的行，只保留第一次出现的记录' : '对于重复的行，只保留最后一次出现的记录'}
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* 字段选择 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: '#595959' }}>选择去重依据字段</Text>
          <Space size={4}>
            <Button size="small" onClick={handleSelectAll} disabled={readOnly}>
              全选
            </Button>
            <Button size="small" onClick={handleDeselectAll} disabled={readOnly}>
              清空
            </Button>
          </Space>
        </div>
      </div>

      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          maxHeight: 280,
          overflowY: 'auto',
          background: '#fafafa',
        }}
      >
        {allColumns.map((col) => {
          const isSelected = selectedColumns.includes(col.name);
          const typeInfo = getDataTypeInfo(col.type);
          return (
            <div
              key={col.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid #f0f0f0',
                background: isSelected ? '#fff' : '#fafafa',
              }}
            >
              <Checkbox
                checked={isSelected}
                onChange={(e) => handleColumnToggle(col.name, e.target.checked)}
                disabled={readOnly}
              />
              <Tag
                style={{
                  background: typeInfo.bg,
                  color: typeInfo.text,
                  border: 'none',
                  fontSize: 9,
                  padding: '0 3px',
                  lineHeight: '14px',
                  minWidth: 24,
                  textAlign: 'center',
                }}
              >
                {typeInfo.label}
              </Tag>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  flex: 1,
                  opacity: isSelected ? 1 : 0.5,
                }}
              >
                {col.name}
              </Text>
            </div>
          );
        })}
      </div>

      {selectedColumns.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="请至少选择一个字段"
          description="不选择字段将对所有列进行完全去重（整行完全相同才去重）。"
          style={{ marginTop: 8, fontSize: 11 }}
        />
      )}

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* 保留所有列选项 */}
      <div
        style={{
          padding: '8px 12px',
          background: '#f5f7fa',
          borderRadius: 6,
        }}
      >
        <Checkbox checked={keepAllColumns} onChange={(e) => handleKeepAllChange(e.target.checked)} disabled={readOnly}>
          <div>
            <Text style={{ fontSize: 12 }}>保留所有列</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                勾选后保留选中字段所在行的所有原始数据
              </Text>
            </div>
          </div>
        </Checkbox>
      </div>

      <Divider style={{ margin: '12px 0 8px' }} />

      {/* SQL 预览 */}
      <Text type="secondary" style={{ fontSize: 11 }}>
        生成的查询：
      </Text>
      <div
        style={{
          marginTop: 4,
          padding: '6px 10px',
          background: '#f5f7fa',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#595959',
          minHeight: 28,
        }}
      >
        {selectedColumns.length === 0 ? (
          <span style={{ color: '#bfbfbf' }}>SELECT DISTINCT * FROM upstream</span>
        ) : (
          <span>
            SELECT *
            <br />
            FROM (
            <br /> SELECT *, ROW_NUMBER() OVER (PARTITION BY {selectedColumns.map((c) => `\`${c}\``).join(', ')} ORDER
            BY 1) AS _rn
            <br /> FROM upstream
            <br />) AS t
            <br />
            WHERE _rn = 1
          </span>
        )}
      </div>
    </div>
  );
};
