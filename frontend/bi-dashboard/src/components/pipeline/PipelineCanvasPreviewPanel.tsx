/**
 * 画布底部数据浏览区：单击节点在此预览表格（与右侧配置分离）。
 * 固定内部表格容器高度，避免渲染/加载时高度变化触发 ReactFlow ResizeObserver 循环。
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Empty, Select, Spin, Typography, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { GraphNode, GraphEdge } from '../../utils/graphUtils';
import { PipelineNode } from '../../services/pipelineService';
import { getNodeTypeDef } from '../../utils/nodeTypeRegistry';
import { resolvePreviewDataSourceId } from '../../utils/pipelineDataSourceUtils';
import { NodePreviewTable } from './NodePreviewTable';
import { useNodePreview } from '../../hooks/useNodePreview';

const { Text } = Typography;

interface PipelineCanvasPreviewPanelProps {
  previewNode: GraphNode | null;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  pipelineDataSourceId?: number | null;
}

function previewDatasetTitle(node: GraphNode): string {
  const pn = node.data.pipelineNode as PipelineNode;
  const cfg = (pn.config || {}) as Record<string, unknown>;
  if (pn.type === 'source' && typeof cfg.tableName === 'string' && cfg.tableName) {
    return cfg.tableName;
  }
  return pn.name || '数据预览';
}

export const PipelineCanvasPreviewPanel: React.FC<PipelineCanvasPreviewPanelProps> = ({
  previewNode,
  allNodes,
  allEdges,
  pipelineDataSourceId,
}) => {
  const { previewData, previewLoading, loadPreview, clearPreview } = useNodePreview();
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  /** 表格容器 ref（CSS 已固定高度，无需 JS 测量） */
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const pipelineNode = previewNode?.data?.pipelineNode as PipelineNode | undefined;
  const nodeDef = pipelineNode ? getNodeTypeDef(pipelineNode.type) : null;
  const resolvedDsId = useMemo(
    () => resolvePreviewDataSourceId(pipelineNode, pipelineDataSourceId),
    [pipelineNode, pipelineDataSourceId]
  );

  const previewConfigKey = useMemo(() => {
    if (!previewNode) return '';
    return JSON.stringify((previewNode.data.pipelineNode as PipelineNode)?.config ?? {});
  }, [previewNode]);

  /** 仅拓扑变化时重拉预览，避免拖拽节点时反复请求 */
  const graphTopologySig = useMemo(() => {
    const ids = allNodes.map((x) => x.id).sort().join(',');
    const es = allEdges.map((x) => `${x.source}-${x.target}`).sort().join('|');
    return `${ids}|${es}`;
  }, [allNodes, allEdges]);

  useEffect(() => {
    if (!previewNode || !nodeDef?.hasPreview) {
      clearPreview();
      setVisibleColumnKeys([]);
      return;
    }
    loadPreview(
      {
        node: previewNode,
        allNodes,
        allEdges,
        pipelineDataSourceId: resolvedDsId,
        limit: 100,
      },
      true
    );
  }, [
    previewNode?.id,
    previewConfigKey,
    pipelineNode?.type,
    graphTopologySig,
    resolvedDsId,
    nodeDef?.hasPreview,
    loadPreview,
    clearPreview,
  ]);

  const columnsSig = previewData?.columns?.join('\0') ?? '';

  useEffect(() => {
    if (!previewData?.columns?.length) return;
    setVisibleColumnKeys([...previewData.columns]);
  }, [previewNode?.id, columnsSig]);

  /** 等到有真实行数据才显示表格，避免加载前后容器高度跳变 */
  const showTable = !previewLoading && previewData && previewData.columns.length > 0;
  /** 无数据源或预览失败，统一显示「暂无数据」 */
  const showNoData = !previewLoading && !previewData;
  const showLoading = previewLoading && !previewData;

  if (!previewNode) {
    return (
      <div className="pipeline-canvas-preview pipeline-canvas-preview--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="单击节点查看数据预览；双击节点打开配置"
        />
      </div>
    );
  }

  if (!nodeDef?.hasPreview) {
    return (
      <div className="pipeline-canvas-preview pipeline-canvas-preview--empty">
        <Empty description="此节点类型不支持数据预览" />
      </div>
    );
  }

  const title = previewDatasetTitle(previewNode);
  const allCols = previewData?.columns ?? [];

  return (
    <div className="pipeline-canvas-preview">
      <div className="pipeline-canvas-preview-toolbar">
        <Text strong className="pipeline-canvas-preview-title">
          {title}
        </Text>
        <div className="pipeline-canvas-preview-toolbar-right">
          {allCols.length > 0 && (
            <Select
              mode="multiple"
              allowClear
              maxTagCount={0}
              placeholder={`显示字段(${visibleColumnKeys.length || allCols.length})`}
              value={visibleColumnKeys.length ? visibleColumnKeys : allCols}
              onChange={(keys) => setVisibleColumnKeys(keys.length ? keys : allCols)}
              options={allCols.map((c) => ({ label: c, value: c }))}
              style={{ minWidth: 160 }}
              size="small"
              showSearch
              optionFilterProp="label"
            />
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={previewLoading}
            onClick={() =>
              loadPreview(
                {
                  node: previewNode,
                  allNodes,
                  allEdges,
                  pipelineDataSourceId: resolvedDsId,
                  limit: 100,
                },
                true
              )
            }
          >
            刷新
          </Button>
        </div>
      </div>


      {showLoading && (
        <div className="pipeline-canvas-preview-loading">
          <Spin tip="加载数据中…" />
        </div>
      )}

      {!previewLoading && previewData && previewData.columns.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}

      {showTable && (
        <div className="pipeline-canvas-preview-table-wrap" ref={tableWrapRef}>
          <NodePreviewTable
            data={previewData}
            compact={false}
            striped
            displayColumnKeys={
              visibleColumnKeys.length ? visibleColumnKeys.filter((c) => allCols.includes(c)) : undefined
            }
          />
        </div>
      )}

      {showNoData && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}
    </div>
  );
};
