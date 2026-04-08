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
import { useNodePreview } from '../../../hooks/useNodePreview';
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
  readOnly = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Get node config
  const pipelineNode = node.data.pipelineNode as PipelineNode;
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

  // Load upstream preview data
  const upstreamPreview = useNodePreview();

  // Load preview when modal opens
  const loadUpstreamPreview = useCallback(async () => {
    if (upstreamNodes.length === 0) {
      return null;
    }

    setModalLoading(true);
    try {
      // Use first upstream node for preview data
      const upstreamNode = upstreamNodes[0];
      const upstreamPipelineNode = upstreamNode.data.pipelineNode as PipelineNode;

      // Load preview for upstream node
      await upstreamPreview.loadPreview({
        node: upstreamNode,
        allNodes,
        pipelineDataSourceId,
      });

      return upstreamPreview.previewData;
    } catch (error) {
      console.error('Failed to load upstream preview:', error);
      message.error('加载上游数据预览失败');
      return null;
    } finally {
      setModalLoading(false);
    }
  }, [upstreamNodes, allNodes, pipelineDataSourceId, upstreamPreview]);

  // Handle modal open
  const handleModalOpen = async () => {
    setModalOpen(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setModalOpen(false);
  };

  // Handle config save
  const handleSaveConfig = (newConfig: ChartNodeConfigType) => {
    const pn = node.data.pipelineNode as Record<string, unknown>;
    const currentConfig = (pn.config as Record<string, unknown>) || {};
    node.data = {
      ...node.data,
      pipelineNode: {
        ...pn,
        config: {
          ...currentConfig,
          ...newConfig,
        },
      },
    };
    onChange();
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
            onClick={() => {
              if (upstreamPreview.previewData) {
                setModalOpen(true);
              }
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
        upstreamPreviewData={upstreamPreview.previewData}
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
