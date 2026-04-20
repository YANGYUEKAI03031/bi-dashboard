/**
 * ColumnSelectConfig - Visual column selection + rename for "Select Columns" nodes.
 * Drag-and-drop style two-panel column selector.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Form, Input, Button, Divider, Tag, Typography,
  Alert, Transfer, Checkbox, Card, Spin,
} from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { getDataTypeInfo } from '../../../utils/nodeTypeRegistry';
import { useNodePreview } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';

const { Text } = Typography;

interface ColumnMapping {
  from: string;
  to: string;
  checked: boolean;
  type?: string; // column data type from upstream schema
}

interface ColumnSelectConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  readOnly?: boolean;
}

export const ColumnSelectConfig: React.FC<ColumnSelectConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  pipelineDataSourceId,
  onChange,
  readOnly = false,
}) => {
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const config = (pipelineNode.config || {}) as Record<string, unknown>;
  const savedMappings = (config.selectedColumns as ColumnMapping[]) || [];

  // 获取上游节点和数据源 ID
  const upstreamNode = upstreamNodes[0];
  const upstreamPn = upstreamNode?.data.pipelineNode as PipelineNode | undefined;
  const upstreamDsId = upstreamPn
    ? resolvePreviewDataSourceId(upstreamPn, pipelineDataSourceId ?? null)
    : undefined;

  const { previewData, previewLoading, loadPreview, clearPreview } = useNodePreview();

  // 签名用于检测上游变化
  const nodesSignature = useMemo(
    () => JSON.stringify(allNodes.map(n => ({
      id: n.id,
      pn: (n.data.pipelineNode as PipelineNode),
    }))),
    [allNodes]
  );

  // 加载上游预览（获取全列信息，用于列选择器）
  const loadKeyRef = useRef<string>('');
  useEffect(() => {
    if (!upstreamNode || !upstreamDsId) {
      return;
    }
    const key = `${upstreamNode.id}-${nodesSignature}-${upstreamDsId}`;
    if (key === loadKeyRef.current) return;
    loadKeyRef.current = key;
    clearPreview();
    loadPreview({
      node: upstreamNode,
      allNodes,
      pipelineDataSourceId: upstreamDsId,
      limit: 50,
    }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNode?.id, nodesSignature, upstreamDsId, loadPreview, clearPreview]);

  // 从预览数据获取所有列（用于选择器）
  const allColumns = useMemo((): Array<{ name: string; type: string }> => {
    // 优先使用 allColumns（全列），如果没有则使用 columns（投影后列）
    const cols = previewData?.allColumns || previewData?.columns || [];
    const types = previewData?.columnTypes || [];
    return cols.map((col, idx) => ({
      name: col,
      type: types[idx] || 'string',
    }));
  }, [previewData]);

  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [initialized, setInitialized] = useState(false);

  // 初始化 mappings：当 allColumns 加载完成后
  useEffect(() => {
    if (allColumns.length === 0) return;
    setInitialized(true);

    if (savedMappings.length > 0) {
      // 使用已保存的映射，但要与最新的 allColumns 合并（可能有新列或删除了旧列）
      const savedFromSet = new Set(savedMappings.map(m => m.from));
      const newCols = allColumns.filter(c => !savedFromSet.has(c.name));
      setMappings([...savedMappings, ...newCols.map(c => ({
        from: c.name,
        to: c.name,
        checked: false,
        type: c.type,
      }))]);
    } else {
      // 没有保存的映射，初始化为全选
      setMappings(allColumns.map(c => ({
        from: c.name,
        to: c.name,
        checked: true,
        type: c.type,
      })));
    }
  }, [allColumns, savedMappings]);

  const [showRename, setShowRename] = useState(false);

  const updateConfig = (newMappings: ColumnMapping[]) => {
    if (readOnly) return;
    const pn = node.data.pipelineNode as Record<string, unknown>;
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...config,
          selectedColumns: newMappings.filter(m => m.checked),
        },
      },
    };
    onChange();
  };

  const toggleColumn = (colName: string, checked: boolean) => {
    const newMappings = mappings.map(m =>
      m.from === colName ? { ...m, checked } : m
    );
    setMappings(newMappings);
    updateConfig(newMappings);
  };

  const renameColumn = (from: string, to: string) => {
    const newMappings = mappings.map(m =>
      m.from === from ? { ...m, to } : m
    );
    setMappings(newMappings);
    updateConfig(newMappings);
  };

  const selectAll = () => {
    const newMappings = mappings.map(m => ({ ...m, checked: true }));
    setMappings(newMappings);
    updateConfig(newMappings);
  };

  const deselectAll = () => {
    const newMappings = mappings.map(m => ({ ...m, checked: false }));
    setMappings(newMappings);
    updateConfig(newMappings);
  };

  if (upstreamNodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="请先连接上游节点"
        description="选择列节点需要至少一个上游数据源。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const selectedCount = mappings.filter(m => m.checked).length;
  const checkedMappings = mappings.filter(m => m.checked);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          <AppstoreOutlined style={{ marginRight: 6 }} />
          选择输出列
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {selectedCount} / {mappings.length} 个已选
        </Text>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button size="small" onClick={selectAll} disabled={readOnly}>全选</Button>
        <Button size="small" onClick={deselectAll} disabled={readOnly}>全不选</Button>
        <Button
          size="small"
          type={showRename ? 'primary' : 'default'}
          onClick={() => setShowRename(!showRename)}
        >
          {showRename ? '隐藏重命名' : '显示重命名'}
        </Button>
      </div>

      {/* Column list */}
      <div style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        maxHeight: 300,
        overflowY: 'auto',
        background: '#fafafa',
      }}>
        {mappings.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              正在加载上游字段信息…
            </Text>
          </div>
        )}
        {mappings.map(col => {
          const typeInfo = getDataTypeInfo(col.type);
          return (
            <div
              key={col.from}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid #f0f0f0',
                background: col.checked ? '#fff' : '#fafafa',
                opacity: col.checked ? 1 : 0.5,
              }}
            >
              <Checkbox
                checked={col.checked}
                onChange={(e) => toggleColumn(col.from, e.target.checked)}
                disabled={readOnly}
              />

              {/* Type chip */}
              <Tag style={{
                background: typeInfo.bg,
                color: typeInfo.text,
                border: 'none',
                fontSize: 9,
                padding: '0 3px',
                lineHeight: '14px',
                minWidth: 24,
                textAlign: 'center',
              }}>
                {typeInfo.label}
              </Tag>

              {/* Original name */}
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  flex: 1,
                  textDecoration: col.checked ? 'none' : 'line-through',
                  color: col.checked ? '#262626' : '#bfbfbf',
                }}
              >
                {col.from}
              </Text>

              {/* Rename arrow */}
              {showRename && col.checked && (
                <>
                  <Text type="secondary" style={{ fontSize: 11 }}>→</Text>
                  <Input
                    size="small"
                    value={col.to}
                    onChange={(e) => renameColumn(col.from, e.target.value)}
                    style={{ width: 80, fontFamily: 'monospace' }}
                    disabled={readOnly}
                    placeholder="新名称"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {mappings.length > 0 && (
        <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
          提示：取消勾选可排除该列；勾选后可重命名输出列名
        </Text>
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
        {checkedMappings.length === 0 ? (
          <span style={{ color: '#bfbfbf' }}>（请选择至少一列）</span>
        ) : (
          <span>
            SELECT {checkedMappings.map(m =>
              m.from === m.to
                ? `\`${m.from}\``
                : `\`${m.from}\` AS \`${m.to}\``
            ).join(', ')}
            <br />FROM upstream
          </span>
        )}
      </div>
    </div>
  );
};
