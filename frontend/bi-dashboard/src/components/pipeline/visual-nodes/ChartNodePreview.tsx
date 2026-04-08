/**
 * Chart preview component for Pipeline preview panel
 * Renders chart using ChartFactory component
 */
import React, { useMemo } from 'react';
import { Spin, Empty, Alert, Typography } from 'antd';
import { BarChartOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { ChartFactory, ChartConfig } from '../../charts/ChartFactory';
import {
  ChartNodeConfig as ChartNodeConfigType,
  getChartTypeLabel,
  DEFAULT_CHART_CONFIG,
} from '../../../types/chartNode';

const { Text } = Typography;

interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface ChartNodePreviewProps {
  nodeConfig: ChartNodeConfigType | null;
  previewData: PreviewData | null;
  loading?: boolean;
  height?: number;
}

/** Build chart config from node config */
function buildChartConfig(nodeConfig: ChartNodeConfigType): ChartConfig {
  return {
    type: nodeConfig.chartType,
    series: [],
    title: nodeConfig.chartType,
    xField: nodeConfig.xField,
    yFields: nodeConfig.yFields,
    sort_by: nodeConfig.sortBy,
    sort_order: nodeConfig.sortOrder,
    y_agg_method: nodeConfig.yAggMethod,
    x_group_by_enabled: nodeConfig.xGroupByEnabled,
    line_y_fields: nodeConfig.lineYFields,
    y_axis_right_title: nodeConfig.yAxisRightTitle,
    // Metric specific
    metric_mode: nodeConfig.metricMode,
    metric_filter_expr: nodeConfig.metricFilterExpr,
    metric_unit: nodeConfig.metricUnit,
    metric_decimals: nodeConfig.metricDecimals,
    metric_label: nodeConfig.metricLabel,
  };
}

/** Check if config is valid for rendering */
function isConfigValid(config: ChartNodeConfigType): boolean {
  const chartType = config.chartType;

  if (chartType === 'metric') {
    return config.yFields.length > 0;
  }

  if (chartType === 'pie' || chartType === 'funnel' || chartType === 'waterfall') {
    return !!config.xField && config.yFields.length > 0;
  }

  if (chartType === 'scatter') {
    return config.yFields.length >= 2;
  }

  if (chartType === 'radar' || chartType === 'boxplot') {
    return config.yFields.length > 0;
  }

  // Bar, line, area, stacked_bar, bar_line
  return !!config.xField && config.yFields.length > 0;
}

/** Get validation error message */
function getValidationError(config: ChartNodeConfigType): string | null {
  const chartType = config.chartType;

  if (chartType === 'metric') {
    if (!config.yFields.length) {
      return '请配置指标字段';
    }
    return null;
  }

  if (chartType === 'pie' || chartType === 'funnel' || chartType === 'waterfall') {
    if (!config.xField) {
      return '请配置分类字段 (X轴)';
    }
    if (!config.yFields.length) {
      return '请配置数值字段 (Y轴)';
    }
    return null;
  }

  if (chartType === 'scatter') {
    if (config.yFields.length < 2) {
      return '散点图需要至少2个数值字段';
    }
    return null;
  }

  if (chartType === 'radar' || chartType === 'boxplot') {
    if (!config.yFields.length) {
      return '请配置数值字段';
    }
    return null;
  }

  // Bar, line, area, stacked_bar, bar_line
  if (!config.xField) {
    return '请配置分类字段 (X轴)';
  }
  if (!config.yFields.length) {
    return '请配置数值字段 (Y轴)';
  }

  return null;
}

export const ChartNodePreview: React.FC<ChartNodePreviewProps> = ({
  nodeConfig,
  previewData,
  loading = false,
  height = 350,
}) => {
  // Normalize node config
  const config = useMemo<ChartNodeConfigType>(() => {
    if (!nodeConfig) {
      return { ...DEFAULT_CHART_CONFIG };
    }
    return {
      ...DEFAULT_CHART_CONFIG,
      ...nodeConfig,
    };
  }, [nodeConfig]);

  // Transform preview data to array format for ChartFactory
  const chartData = useMemo<Record<string, unknown>[]>(() => {
    if (!previewData || !previewData.rows.length) {
      return [];
    }
    return previewData.rows;
  }, [previewData]);

  // Build chart config
  const chartConfig = useMemo<ChartConfig>(() => {
    return buildChartConfig(config);
  }, [config]);

  // Validation
  const isValid = useMemo<boolean>(() => {
    return isConfigValid(config);
  }, [config]);

  const validationError = useMemo<string | null>(() => {
    if (isValid) return null;
    return getValidationError(config);
  }, [config]);

  // Loading state
  if (loading) {
    return (
      <div
        className="chart-node-preview"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: 8,
        }}
      >
        <Spin size="large" tip="加载图表数据..." />
      </div>
    );
  }

  // No config state
  if (!nodeConfig) {
    return (
      <div
        className="chart-node-preview"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: 8,
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              尚未配置图表
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                请在右侧面板配置图表类型和字段
              </Text>
            </span>
          }
        />
      </div>
    );
  }

  // No data state
  if (!previewData || !previewData.rows.length) {
    return (
      <div
        className="chart-node-preview"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: 8,
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              暂无数据
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                请确保上游节点已正确配置并返回数据
              </Text>
            </span>
          }
        />
      </div>
    );
  }

  // Invalid config state
  if (!isValid) {
    return (
      <div
        className="chart-node-preview"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: 8,
        }}
      >
        <Alert
          type="warning"
          message="图表配置不完整"
          description={validationError}
          showIcon
          icon={<InfoCircleOutlined />}
        />
      </div>
    );
  }

  // Chart title
  const chartTitle = `${getChartTypeLabel(config.chartType)}${
    config.xAxisTitle ? ` - ${config.xAxisTitle}` : ''
  }${
    config.yAxisTitle ? ` / ${config.yAxisTitle}` : ''
  }`;

  return (
    <div
      className="chart-node-preview"
      style={{
        height,
        background: '#fafafa',
        borderRadius: 8,
        padding: 8,
        border: '1px solid #f0f0f0',
      }}
    >
      <div className="chart-preview-header" style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          <BarChartOutlined style={{ marginRight: 6, color: '#722ed1' }} />
          {chartTitle}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {previewData.rows.length} 条数据
        </Text>
      </div>

      <div className="chart-preview-body" style={{ height: height - 40 }}>
        <ChartFactory
          data={chartData}
          config={chartConfig}
          style={{ height: '100%', width: '100%' }}
        />
      </div>
    </div>
  );
};

export default ChartNodePreview;
