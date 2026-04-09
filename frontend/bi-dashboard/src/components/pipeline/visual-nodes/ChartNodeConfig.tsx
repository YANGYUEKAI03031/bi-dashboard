/**
 * Chart node configuration component for NodeDetailPanel
 * Provides quick access to chart configuration modal
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  Button, Space, Typography, Alert, Empty, Tag,
  Card, Descriptions, Divider, Spin, message,
} from 'antd';
import {
  SettingOutlined, BarChartOutlined, LineChartOutlined,
  PieChartOutlined, DotChartOutlined, AreaChartOutlined,
  RadarChartOutlined, FundViewOutlined, ClusterOutlined,
  FallOutlined, FilterOutlined, RiseOutlined,
  InfoCircleOutlined, SyncOutlined,
} from '@ant-design/icons';
import { GraphNode } from '../../../utils/graphUtils';
import { PipelineNode } from '../../../services/pipelineService';
import { useNodePreview, type PreviewData } from '../../../hooks/useNodePreview';
import { resolvePreviewDataSourceId } from '../../../utils/pipelineDataSourceUtils';
import { ChartNodeConfigModal } from './ChartNodeConfigModal';
import {
  ChartNodeConfig as ChartNodeConfigType,
  ChartType,
  DEFAULT_CHART_CONFIG,
  getChartTypeLabel,
  CHART_TYPE_LABELS,
} from '../../../types/chartNode';

const { Text, Paragraph } = Typography;

interface ChartNodeConfigProps {
  node: GraphNode;
  upstreamNodes: GraphNode[];
  allNodes: GraphNode[];
  pipelineDataSourceId?: number | null;
  onChange: () => void;
  /** 图表弹窗保存时必须走此回调写回画布 nodes，否则仅改内存 + onChange 时 Form/闭包可能覆盖 config，导致「预览已变但保存/运行后 DB 仍是旧 chartType」 */
  onNodeUpdate: (updatedNode: GraphNode) => void;
  readOnly?: boolean;
}

/** Chart type icon mapping */
const CHART_TYPE_ICONS: Record<ChartType, React.ReactNode> = {
  bar: <BarChartOutlined />,
  line: <LineChartOutlined />,
  area: <AreaChartOutlined />,
  pie: <PieChartOutlined />,
  scatter: <DotChartOutlined />,
  radar: <RadarChartOutlined />,
  boxplot: <FundViewOutlined />,
  bar_line: <LineChartOutlined />,
  stacked_bar: <ClusterOutlined />,
  waterfall: <FallOutlined />,
  funnel: <FilterOutlined />,
  metric: <RiseOutlined />,
};

export const ChartNodeConfig: React.FC<ChartNodeConfigProps> = ({
  node,
  upstreamNodes,
  allNodes,
  pipelineDataSourceId,
  onChange,
  onNodeUpdate,
  readOnly = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Get node config
  const pipelineNode = node.data.pipelineNode as PipelineNode;
  const resolvedDsId = useMemo(
    () => resolvePreviewDataSourceId(pipelineNode, pipelineDataSourceId ?? undefined),
    [pipelineNode, pipelineDataSourceId]
  );

  const nodeConfig = useMemo<ChartNodeConfigType | null>(() => {
    const config = pipelineNode?.config as Record<string, unknown> | undefined;
    if (!config) return null;
    return {
      chartType: (config.chartType as ChartType) || DEFAULT_CHART_CONFIG.chartType,
      xField: (config.xField as string) || '',
      yFields: (config.yFields as string[]) || [],
      graphDimensions: (config.graphDimensions as string[]) || [],
      graphMetrics: (config.graphMetrics as string[]) || [],
      yAggMethod: (config.yAggMethod as any) || 'sum',
      xGroupByEnabled: config.xGroupByEnabled !== false,
      xAxisTitle: (config.xAxisTitle as string) || '',
      yAxisTitle: (config.yAxisTitle as string) || '',
      yAxisRightTitle: (config.yAxisRightTitle as string) || '',
      sortBy: (config.sortBy as 'x' | 'y') || 'x',
      sortOrder: (config.sortOrder as 'asc' | 'desc') || 'desc',
      showLegend: config.showLegend !== false,
      showTooltip: config.showTooltip !== false,
      lineYFields: (config.lineYFields as string[]) || [],
      metricMode: (config.metricMode as any) || 'aggregate',
      metricFilterField: (config.metricFilterField as string) || '',
      metricFilterValue: (config.metricFilterValue as string) || '',
      metricFilters: (config.metricFilters as any[]) || [],
      metricFilterExpr: config.metricFilterExpr as any,
      metricUnit: (config.metricUnit as string) || '',
      metricDecimals: (config.metricDecimals as number) || 2,
      metricLabel: (config.metricLabel as string) || '',
    };
  }, [pipelineNode?.config]);

  /** 与画布预览一致：预览当前图表节点（后端折叠为上游结果集） */
  const upstreamPreview = useNodePreview();
  const [modalPreviewData, setModalPreviewData] = useState<PreviewData | null>(null);

  const loadChartPreviewForModal = useCallback(async () => {
    if (!resolvedDsId) {
      message.warning('请先为管道配置业务数据源');
      return null;
    }
    setModalLoading(true);
    try {
      const data = await upstreamPreview.loadPreview(
        {
          node,
          allNodes,
          pipelineDataSourceId: resolvedDsId,
          limit: 100,
        },
        true
      );
      setModalPreviewData(data);
      return data;
    } catch (error) {
      console.error('Failed to load chart preview:', error);
      message.error('加载预览数据失败');
      setModalPreviewData(null);
      return null;
    } finally {
      setModalLoading(false);
    }
  }, [resolvedDsId, upstreamPreview, node, allNodes]);

  // Handle modal open：先拉取与底部表格相同的数据，再展示弹窗
  const handleModalOpen = async () => {
    await loadChartPreviewForModal();
    setModalOpen(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setModalOpen(false);
    setModalPreviewData(null);
  };

  // Handle config save
  const handleSaveConfig = (newConfig: ChartNodeConfigType) => {
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const currentConfig = (pn.config as Record<string, unknown>) || {};
    const mergedConfig = { ...currentConfig, ...newConfig };
    onNodeUpdate({
      ...node,
      data: {
        ...node.data,
        pipelineNode: {
          ...pn,
          config: mergedConfig,
        },
      },
    });
    setModalOpen(false);
    message.success('图表配置已保存');
  };

  // Render config summary
  const renderConfigSummary = () => {
    if (!nodeConfig) {
      return (
        <Alert
          type="info"
          message="尚未配置图表"
          description="点击下方按钮配置图表类型和字段映射"
          showIcon
          icon={<InfoCircleOutlined />}
        />
      );
    }

    const chartType = nodeConfig.chartType;
    const chartIcon = CHART_TYPE_ICONS[chartType] || <BarChartOutlined />;

    return (
      <div className="chart-node-config-summary">
        <Card size="small" bordered={false} style={{ background: '#f9f0ff' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div className="chart-type-badge">
              <Tag
                icon={chartIcon}
                color="purple"
                style={{ fontSize: 13, padding: '4px 12px' }}
              >
                {getChartTypeLabel(chartType)}
              </Tag>
            </div>

            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              {nodeConfig.xField && (
                <Descriptions.Item label="X轴字段">
                  <Text code>{nodeConfig.xField}</Text>
                </Descriptions.Item>
              )}
              {nodeConfig.yFields.length > 0 && (
                <Descriptions.Item label="Y轴字段">
                  <Space wrap size={4}>
                    {nodeConfig.yFields.map((field, idx) => (
                      <Tag key={idx} color="blue">{field}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="聚合方式">
                <Text>{nodeConfig.yAggMethod}</Text>
              </Descriptions.Item>
              {nodeConfig.xAxisTitle && (
                <Descriptions.Item label="X轴标题">
                  <Text>{nodeConfig.xAxisTitle}</Text>
                </Descriptions.Item>
              )}
              {nodeConfig.yAxisTitle && (
                <Descriptions.Item label="Y轴标题">
                  <Text>{nodeConfig.yAxisTitle}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Space>
        </Card>
      </div>
    );
  };

  // Check if has upstream nodes
  const hasUpstream = upstreamNodes.length > 0;

  return (
    <div className="chart-node-config">
      {/* Upstream warning */}
      {!hasUpstream && (
        <Alert
          type="warning"
          message="缺少上游数据源"
          description="图表节点需要连接上游节点以获取数据"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Current config summary */}
      {renderConfigSummary()}

      <Divider style={{ margin: '16px 0' }} />

      {/* Quick stats */}
      <div className="chart-node-stats">
        <Text type="secondary" style={{ fontSize: 12 }}>
          {upstreamNodes.length === 0
            ? '等待连接上游节点...'
            : upstreamNodes.length === 1
            ? `数据来源：${(upstreamNodes[0].data.pipelineNode as PipelineNode)?.name || '上游节点'}`
            : `数据来源：${upstreamNodes.length} 个上游节点`}
        </Text>
      </div>

      {/* Action buttons */}
      <div className="chart-node-actions" style={{ marginTop: 16 }}>
        <Button
          type="primary"
          icon={<SettingOutlined />}
          onClick={handleModalOpen}
          disabled={readOnly}
          loading={modalLoading}
        >
          {nodeConfig ? '修改图表配置' : '配置图表'}
        </Button>

        {nodeConfig && (
          <Button
            icon={<SyncOutlined spin={modalLoading} />}
            onClick={async () => {
              await loadChartPreviewForModal();
              setModalOpen(true);
            }}
            disabled={!hasUpstream || modalLoading}
            style={{ marginLeft: 8 }}
          >
            刷新预览
          </Button>
        )}
      </div>

      {/* Configuration modal */}
      <ChartNodeConfigModal
        open={modalOpen}
        nodeConfig={nodeConfig || DEFAULT_CHART_CONFIG}
        upstreamPreviewData={modalPreviewData ?? upstreamPreview.previewData}
        onSave={handleSaveConfig}
        onCancel={handleModalClose}
        readOnly={readOnly}
      />

      <style>{`
        .chart-node-config {
          padding: 8px 0;
        }

        .chart-node-config .chart-type-badge {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .chart-node-config .ant-descriptions-item-label {
          color: #8c8c8c;
          font-size: 12px;
        }

        .chart-node-config .ant-descriptions-item-content {
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

export default ChartNodeConfig;
