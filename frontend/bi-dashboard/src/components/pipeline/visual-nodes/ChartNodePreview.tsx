/**
 * Chart preview component for Pipeline preview panel
 * Renders chart using ChartFactory component
 */
import React, { useMemo } from 'react';
import { Spin, Empty, Alert, Typography } from 'antd';
import { BarChartOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
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
  /** 列格式化配置（从节点 config.previewColumnFormats 传入） */
  columnFormats?: Record<string, string>;
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

/** 根据列格式转换单行数据 */
function transformRowByFormats(row: Record<string, unknown>, formats: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };

  Object.keys(result).forEach((key) => {
    const format = formats[key];
    if (!format || format === 'auto') return;

    const value = result[key];
    if (value === null || value === undefined) return;

    switch (format) {
      case 'string': {
        // 文本：任何值都转成字符串
        result[key] = String(value);
        break;
      }

      case 'number': {
        // 数字：确保是数值类型
        if (typeof value === 'number') {
          result[key] = value;
        } else {
          const num = Number(String(value).trim());
          result[key] = Number.isNaN(num) ? value : num;
        }
        break;
      }

      case 'date': {
        // 日期：统一为 YYYY-MM-DD 格式
        if (typeof value === 'number') {
          // 时间戳
          result[key] = dayjs(value).format('YYYY-MM-DD');
        } else if (typeof value === 'string') {
          // 如果是完整日期时间，截取日期部分
          if (value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            result[key] = value.slice(0, 10);
          } else {
            // 其他格式，尝试 dayjs 解析
            const parsed = dayjs(value);
            result[key] = parsed.isValid() ? parsed.format('YYYY-MM-DD') : value;
          }
        } else if (value instanceof Date) {
          result[key] = dayjs(value).format('YYYY-MM-DD');
        }
        break;
      }

      case 'datetime': {
        // 日期时间：统一为 YYYY-MM-DD HH:mm:ss 格式
        if (typeof value === 'number') {
          result[key] = dayjs(value).format('YYYY-MM-DD HH:mm:ss');
        } else if (typeof value === 'string') {
          const parsed = dayjs(value);
          result[key] = parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : value;
        } else if (value instanceof Date) {
          result[key] = dayjs(value).format('YYYY-MM-DD HH:mm:ss');
        }
        break;
      }

      case 'percent': {
        // 百分比：将小数（0-1 范围）乘以 100
        const num = Number(value);
        if (!Number.isNaN(num)) {
          result[key] = num * 100;
        }
        break;
      }

      default:
        // 未知格式（如 auto），保持原值
        break;
    }
  });

  return result;
}

export const ChartNodePreview: React.FC<ChartNodePreviewProps> = ({
  nodeConfig,
  previewData,
  loading = false,
  height = 350,
  columnFormats,
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

    // 应用列格式化转换
    const formats = columnFormats || {};
    return previewData.rows.map((row) => transformRowByFormats(row, formats));
  }, [previewData, columnFormats]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const chartTitle = `${getChartTypeLabel(config.chartType)}${config.xAxisTitle ? ` - ${config.xAxisTitle}` : ''}${
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
        <ChartFactory data={chartData} config={chartConfig} style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  );
};

export default ChartNodePreview;
