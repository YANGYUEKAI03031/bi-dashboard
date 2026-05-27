/**
 * Chart node configuration modal for Pipeline integration
 * Reuses core logic from VisualizationBuilder for chart configuration
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Form, Select, Switch, Input, Radio, Space, Divider, Typography, Alert, Tooltip, Empty } from 'antd';
import {
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  DotChartOutlined,
  AreaChartOutlined,
  RadarChartOutlined,
  FundViewOutlined,
  ClusterOutlined,
  FallOutlined,
  FilterOutlined,
  RiseOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { ChartFactory, ChartConfig } from '../../charts/ChartFactory';
import {
  ChartNodeConfig as ChartNodeConfigType,
  ChartType,
  DEFAULT_CHART_CONFIG,
  getChartTypeLabel,
} from '../../../types/chartNode';
import { inferMetricFieldTypesFromSampleRows, type MetricFieldKind } from '../../../utils/chartMetric';
import dayjs from 'dayjs';

const { Text } = Typography;

interface PreviewData {
  columns: string[];
  /** 完整列名（不受 outputColumnKeys 限制，供图表列选择器展示） */
  allColumns?: string[];
  rows: Record<string, unknown>[];
}

interface ChartNodeConfigModalProps {
  open: boolean;
  nodeConfig: ChartNodeConfigType | null;
  upstreamPreviewData: PreviewData | null;
  /** 列重命名映射：原始列名 -> 重命名后列名（图表配置弹窗显示用） */
  columnRenames?: Record<string, string>;
  onSave: (config: ChartNodeConfigType) => void;
  onCancel: () => void;
  readOnly?: boolean;
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
        result[key] = String(value);
        break;
      }

      case 'number': {
        if (typeof value === 'number') {
          result[key] = value;
        } else {
          const num = Number(String(value).trim());
          result[key] = Number.isNaN(num) ? value : num;
        }
        break;
      }

      case 'date': {
        if (typeof value === 'number') {
          result[key] = dayjs(value).format('YYYY-MM-DD');
        } else if (typeof value === 'string') {
          if (value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            result[key] = value.slice(0, 10);
          } else {
            const parsed = dayjs(value);
            result[key] = parsed.isValid() ? parsed.format('YYYY-MM-DD') : value;
          }
        } else if (value instanceof Date) {
          result[key] = dayjs(value).format('YYYY-MM-DD');
        }
        break;
      }

      case 'datetime': {
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
        const num = Number(value);
        if (!Number.isNaN(num)) {
          result[key] = num * 100;
        }
        break;
      }

      default:
        break;
    }
  });

  return result;
}

/** Chart type definitions with icons */
const CHART_TYPES_WITH_ICONS = [
  { value: 'bar', label: '柱状图', icon: <BarChartOutlined /> },
  { value: 'line', label: '折线图', icon: <LineChartOutlined /> },
  { value: 'area', label: '面积图', icon: <AreaChartOutlined /> },
  { value: 'pie', label: '饼图', icon: <PieChartOutlined /> },
  { value: 'scatter', label: '散点图', icon: <DotChartOutlined /> },
  { value: 'radar', label: '雷达图', icon: <RadarChartOutlined /> },
  { value: 'boxplot', label: '箱线图', icon: <FundViewOutlined /> },
  { value: 'bar_line', label: '柱线组合', icon: <LineChartOutlined /> },
  { value: 'stacked_bar', label: '堆积柱形图', icon: <ClusterOutlined /> },
  { value: 'waterfall', label: '瀑布图', icon: <FallOutlined /> },
  { value: 'funnel', label: '漏斗图', icon: <FilterOutlined /> },
  { value: 'metric', label: '指标卡', icon: <RiseOutlined /> },
];

/** Aggregation method options */
const AGG_METHOD_OPTIONS = [
  { value: 'sum', label: '求和 (SUM)' },
  { value: 'count', label: '计数 (COUNT)' },
  { value: 'avg', label: '平均值 (AVG)' },
  { value: 'mode', label: '众数 (MODE)' },
  { value: 'median', label: '中位数 (MEDIAN)' },
];

/** Sort order options */
const SORT_OPTIONS = [
  { value: 'x', label: '按 X 轴' },
  { value: 'y', label: '按 Y 轴' },
];

/** Sort direction options */
const ORDER_OPTIONS = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
];

/** Get chart field mapping config based on chart type */
const getChartFieldConfig = (chartType: string) => {
  switch (chartType.toLowerCase()) {
    case 'pie':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showColorField: false,
        showMultipleY: false,
        title: '饼图',
        description: '需要1个分类字段和1个数值字段',
        defaultXGroupBy: true,
      };
    case 'scatter':
      return {
        xFieldRequired: true,
        yFieldsRequired: 2,
        yFieldsMax: 2,
        showColorField: true,
        showMultipleY: false,
        title: '散点图',
        description: '需要2个数值字段作为X和Y坐标',
        defaultXGroupBy: false,
      };
    case 'radar':
      return {
        xFieldRequired: false,
        yFieldsRequired: 2,
        yFieldsMax: 10,
        showColorField: false,
        showMultipleY: true,
        title: '雷达图',
        description: '需要多个数值字段作为维度',
        defaultXGroupBy: true,
      };
    case 'boxplot':
      return {
        xFieldRequired: false,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showColorField: false,
        showMultipleY: true,
        title: '箱线图',
        description: '需要数值字段用于箱体计算',
        defaultXGroupBy: true,
      };
    case 'bar_line':
      return {
        xFieldRequired: true,
        yFieldsRequired: 2,
        yFieldsMax: 10,
        showColorField: false,
        showMultipleY: true,
        title: '柱线组合图',
        description: '分组柱状 + 折线 + 双Y轴；默认最后2个指标为折线，可在下方指定',
        defaultXGroupBy: true,
      };
    case 'funnel':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showColorField: false,
        showMultipleY: false,
        title: '漏斗图',
        description: '需要1个阶段字段和1个数值字段',
        defaultXGroupBy: true,
      };
    case 'waterfall':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showColorField: false,
        showMultipleY: false,
        title: '瀑布图',
        description: '需要1个阶段字段和1个增量数值字段',
        defaultXGroupBy: true,
      };
    case 'stacked_bar':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showColorField: true,
        showMultipleY: true,
        title: '堆积柱形图',
        description: '需要1个分类字段和多个数值字段进行堆积',
        defaultXGroupBy: true,
      };
    case 'metric':
      return {
        xFieldRequired: false,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showColorField: false,
        showMultipleY: false,
        title: '指标卡',
        description:
          '图表构建器 · 指标图：选择数值列与聚合方式。下方「数据筛选」仅作用于本指标的计算结果，可嵌套组内「且 / 或」；与仪表盘筛选器无关，保存后仍不随全局筛选变化。',
        defaultXGroupBy: false,
      };
    default:
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showColorField: true,
        showMultipleY: true,
        title: '柱状图/折线图',
        description: '需要1个分类字段和1个或多个数值字段',
        defaultXGroupBy: true,
      };
  }
};

export const ChartNodeConfigModal: React.FC<ChartNodeConfigModalProps> = ({
  open,
  nodeConfig,
  upstreamPreviewData,
  columnRenames,
  onSave,
  onCancel,
  readOnly = false,
}) => {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<ChartNodeConfigType>(DEFAULT_CHART_CONFIG);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);
  // 转换后的图表数据（应用了列格式）
  const [formattedChartData, setFormattedChartData] = useState<Record<string, unknown>[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [fieldTypes, setFieldTypes] = useState<Record<string, MetricFieldKind>>({});
  const [availableFields, setAvailableFields] = useState<string[]>([]);

  // Initialize config from nodeConfig or defaults
  useEffect(() => {
    if (open) {
      if (nodeConfig) {
        setConfig(nodeConfig);
        form.setFieldsValue({
          chartType: nodeConfig.chartType,
          xField: nodeConfig.xField,
          yFields: nodeConfig.yFields,
          yAggMethod: nodeConfig.yAggMethod,
          xGroupByEnabled: nodeConfig.xGroupByEnabled,
          xAxisTitle: nodeConfig.xAxisTitle,
          yAxisTitle: nodeConfig.yAxisTitle,
          sortBy: nodeConfig.sortBy,
          sortOrder: nodeConfig.sortOrder,
          showLegend: nodeConfig.showLegend,
          showTooltip: nodeConfig.showTooltip,
        });
      } else {
        setConfig(DEFAULT_CHART_CONFIG);
        form.resetFields();
      }
    }
  }, [open, nodeConfig, form]);

  /** 与 VisualizationBuilder 一致的智能默认字段 */
  const applySmartDefaults = useCallback(
    (
      prev: ChartNodeConfigType,
      rows: Record<string, unknown>[],
      columns: string[],
      renamedToOriginal: Record<string, string> = {},
    ): ChartNodeConfigType => {
      if (prev.xField || (prev.yFields && prev.yFields.length > 0)) return prev;
      if (!rows.length || !columns.length) return prev;
      const sample = rows[0];

      // 根据列名获取样本值：优先查找原始列名（rows 的 key），其次查找重命名后列名
      const getSampleValue = (col: string): unknown => {
        // 先尝试原始列名（renamedToOriginal[col] 给出原始列名）
        const originalCol = renamedToOriginal[col] || col;
        if (originalCol in sample) return sample[originalCol];
        // 兼容：如果直接使用 col 也能获取到值（某些情况下可能没有 rename）
        return sample[col];
      };

      if (prev.chartType === 'metric') {
        const numericFirst = columns.find((col) => {
          const v = getSampleValue(col);
          return typeof v === 'number' || (typeof v === 'string' && isNumericString(v));
        });
        const y0 = numericFirst || columns[0];
        return {
          ...prev,
          yFields: y0 ? [y0] : [],
          yAxisTitle: y0 || 'Y轴',
        };
      }

      if (prev.chartType === 'scatter') {
        const nums = columns.filter((col) => {
          const v = getSampleValue(col);
          return typeof v === 'number' || (typeof v === 'string' && isNumericString(v));
        });
        const yPair =
          nums.length >= 2
            ? nums.slice(0, 2)
            : columns.filter((c) => c !== columns[0]).slice(0, 2).length >= 2
              ? columns.slice(0, 2)
              : nums.length === 1
                ? [nums[0], columns.find((c) => c !== nums[0]) || columns[0]].filter(Boolean)
                : columns.slice(0, 2);
        return {
          ...prev,
          xField: columns[0] || '',
          yFields: yPair.slice(0, 2),
          xAxisTitle: columns[0] || 'X轴',
          yAxisTitle: yPair.length > 1 ? 'Y' : yPair[0] || 'Y轴',
        };
      }

      const suitableXFields = columns.filter((field) => {
        const sampleValue = getSampleValue(field);
        return (
          typeof sampleValue === 'string' ||
          sampleValue instanceof Date ||
          (typeof sampleValue === 'object' && sampleValue !== null)
        );
      });
      const xField = suitableXFields.length > 0 ? suitableXFields[0] : columns[0] || '';

      let suitableYFields = columns
        .filter((field) => {
          const sampleValue = getSampleValue(field);
          return typeof sampleValue === 'number' || (typeof sampleValue === 'string' && isNumericString(sampleValue));
        })
        .filter((field) => field !== xField);

      let defaultYFields = suitableYFields.slice(0, Math.min(3, suitableYFields.length));
      if (defaultYFields.length === 0) {
        const remainingFields = columns.filter((f) => f !== xField);
        defaultYFields = remainingFields.slice(0, Math.min(3, remainingFields.length));
      }

      const fc = getChartFieldConfig(prev.chartType);
      defaultYFields = defaultYFields.slice(0, fc.yFieldsMax);

      return {
        ...prev,
        xField,
        yFields: defaultYFields,
        xAxisTitle: xField || 'X轴',
        yAxisTitle: defaultYFields.length > 1 ? '汇总' : defaultYFields[0] || 'Y轴',
      };
    },
    [],
  );

  const isNumericString = (val: unknown): boolean => {
    if (typeof val !== 'string') return false;
    const num = Number(val);
    return !isNaN(num) && val.toString().trim() !== '';
  };

  // 应用列重命名映射：将原始列名转换为重命名后的列名
  const getRenamedField = (originalCol: string): string => {
    if (!columnRenames) return originalCol;
    return columnRenames[originalCol] || originalCol;
  };

  // 创建反向映射：重命名后列名 -> 原始列名（用于从 rows 中获取值）
  const renamedToOriginal = useMemo((): Record<string, string> => {
    if (!columnRenames) return {};
    const map: Record<string, string> = {};
    for (const [original, renamed] of Object.entries(columnRenames)) {
      map[renamed] = original;
    }
    return map;
  }, [columnRenames]);

  // Process preview sample rows（与图表构建器相同：X/Y 下拉共用全部列）
  useEffect(() => {
    if (!open) return;
    if (!upstreamPreviewData?.rows?.length) {
      setPreviewData([]);
      setFormattedChartData([]);
      setAvailableFields([]);
      setFieldTypes({});
      return;
    }
    const rows = upstreamPreviewData.rows;
    // 图表列选择器：优先使用 allColumns（完整列名），并应用 columnRenames 重命名
    // columns 用于表格预览列展示（受 outputColumnKeys 影响）
    const rawColumns =
      upstreamPreviewData.allColumns?.length > 0
        ? upstreamPreviewData.allColumns
        : upstreamPreviewData.columns?.length > 0
          ? upstreamPreviewData.columns
          : Object.keys(rows[0] || {});
    // 应用列重命名映射
    const columns = rawColumns.map((col) => getRenamedField(col));

    // 字段类型推断使用原始列名（因为 rows 的 key 是原始列名）
    const rawColsForTypes =
      upstreamPreviewData.allColumns?.length > 0
        ? upstreamPreviewData.allColumns
        : upstreamPreviewData.columns?.length > 0
          ? upstreamPreviewData.columns
          : Object.keys(rows[0] || {});
    setFieldTypes(inferMetricFieldTypesFromSampleRows(rows, rawColsForTypes));

    // 应用列格式转换
    const formats = config.previewColumnFormats || {};
    const formatted = rows.map((row) => transformRowByFormats(row, formats));

    // 如果有列重命名，需要创建包含重命名后列名的图表数据
    // 因为 config.xField/yFields 使用的是重命名后的列名
    let chartData = formatted;
    if (renamedToOriginal && Object.keys(renamedToOriginal).length > 0) {
      chartData = formatted.map((row) => {
        const newRow: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          const renamedKey = getRenamedField(key);
          newRow[renamedKey] = value;
        }
        return newRow;
      });
    }

    setPreviewData(rows);
    setAvailableFields(columns);
    setFormattedChartData(chartData);

    setConfig((prev) => {
      if (prev.xField || (prev.yFields && prev.yFields.length > 0)) return prev;
      // 传入反向映射，用于智能默认配置时从 rows 中正确获取值
      const next = applySmartDefaults(prev, rows, columns, renamedToOriginal);
      queueMicrotask(() => {
        form.setFieldsValue({
          chartType: next.chartType,
          xField: next.xField,
          yFields: next.yFields,
          yAggMethod: next.yAggMethod,
          xGroupByEnabled: next.xGroupByEnabled,
          xAxisTitle: next.xAxisTitle,
          yAxisTitle: next.yAxisTitle,
          sortBy: next.sortBy,
          sortOrder: next.sortOrder,
          showLegend: next.showLegend,
          showTooltip: next.showTooltip,
        });
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, upstreamPreviewData, applySmartDefaults, form, columnRenames]);

  // 监听列格式变化，重新计算图表数据
  useEffect(() => {
    if (!open || !upstreamPreviewData?.rows?.length) return;
    const formats = config.previewColumnFormats || {};
    const formatted = upstreamPreviewData.rows.map((row) => transformRowByFormats(row, formats));

    // 如果有列重命名，需要创建包含重命名后列名的图表数据
    let chartData = formatted;
    if (renamedToOriginal && Object.keys(renamedToOriginal).length > 0) {
      chartData = formatted.map((row) => {
        const newRow: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          const renamedKey = getRenamedField(key);
          newRow[renamedKey] = value;
        }
        return newRow;
      });
    }

    setFormattedChartData(chartData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.previewColumnFormats, open, upstreamPreviewData, renamedToOriginal]);

  // 监听外部 nodeConfig.previewColumnFormats 变化，同步内部 config
  useEffect(() => {
    if (!open || !nodeConfig) return;
    const externalFormats = nodeConfig.previewColumnFormats;
    if (externalFormats !== config.previewColumnFormats) {
      setConfig((prev) => ({
        ...prev,
        previewColumnFormats: externalFormats,
      }));
      // 同时更新格式化后的图表数据（应用列重命名）
      if (upstreamPreviewData?.rows?.length) {
        const formatted = upstreamPreviewData.rows.map((row) => transformRowByFormats(row, externalFormats || {}));

        let chartData = formatted;
        if (renamedToOriginal && Object.keys(renamedToOriginal).length > 0) {
          chartData = formatted.map((row) => {
            const newRow: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
              const renamedKey = getRenamedField(key);
              newRow[renamedKey] = value;
            }
            return newRow;
          });
        }

        setFormattedChartData(chartData);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeConfig?.previewColumnFormats, open, renamedToOriginal]);

  // Handle form value changes
  const handleFormChange = (changedValues: any) => {
    const newConfig = { ...config, ...changedValues };

    // Auto-update axis titles
    if (changedValues.xField !== undefined) {
      newConfig.xAxisTitle = changedValues.xField;
    }
    if (changedValues.yFields !== undefined) {
      newConfig.yAxisTitle = changedValues.yFields.length > 1 ? '汇总' : changedValues.yFields[0] || 'Y轴';
    }

    setConfig(newConfig);
  };

  // Handle chart type change
  const handleChartTypeChange = (chartType: ChartType) => {
    const newConfig = {
      ...config,
      chartType,
      xGroupByEnabled: chartType === 'metric' || chartType === 'scatter' ? false : config.xGroupByEnabled,
    };
    setConfig(newConfig);
  };

  // Handle save
  const handleSave = () => {
    const finalConfig: ChartNodeConfigType = {
      ...config,
      graphDimensions: config.xField ? [config.xField] : [],
      graphMetrics: config.yFields,
      xAxisTitle: config.xAxisTitle || config.xField || 'X轴',
      yAxisTitle: config.yAxisTitle || config.yFields[0] || 'Y轴',
      // columnFormats 已经在 config 中，会自动包含
    };
    onSave(finalConfig);
  };

  // Build chart config for ChartFactory
  const buildChartConfig = (): ChartConfig => {
    const chartType = config.chartType;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isMetric = chartType === 'metric';

    return {
      type: chartType,
      series: [],
      xField: config.xField,
      yFields: config.yFields,
      sort_by: config.sortBy,
      sort_order: config.sortOrder,
      y_agg_method: config.yAggMethod,
      x_group_by_enabled: config.xGroupByEnabled,
      line_y_fields: config.lineYFields,
      y_axis_right_title: config.yAxisRightTitle,
      // Metric specific
      metric_mode: config.metricMode,
      metric_filter_expr: config.metricFilterExpr,
      metric_unit: config.metricUnit,
      metric_decimals: config.metricDecimals,
      metric_label: config.metricLabel,
    };
  };

  // Check if configuration is valid for current chart type
  const isConfigValid = (): boolean => {
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
  };

  // Get validation message
  const getValidationMessage = (): string | null => {
    const chartType = config.chartType;

    if (chartType === 'metric') {
      if (!config.yFields.length) {
        return '请选择至少一个数值字段';
      }
    }

    if (chartType === 'pie' || chartType === 'funnel' || chartType === 'waterfall') {
      if (!config.xField) {
        return '请选择 X 轴分类字段';
      }
      if (!config.yFields.length) {
        return '请选择至少一个数值字段';
      }
    }

    if (chartType === 'scatter') {
      if (config.yFields.length < 2) {
        return '散点图需要至少2个数值字段';
      }
    }

    if (chartType === 'radar' || chartType === 'boxplot') {
      if (!config.yFields.length) {
        return '请选择至少一个数值字段';
      }
    }

    return null;
  };

  // All available fields for X/Y selects (same as VisualizationBuilder)
  const fieldOptions = availableFields.map((f) => ({ label: f, value: f }));
  const fieldMappingConfig = getChartFieldConfig(config.chartType);

  return (
    <Modal
      title={
        <Space>
          <PieChartOutlined style={{ color: '#722ed1' }} />
          <span>图表配置</span>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      onOk={handleSave}
      okText="保存配置"
      cancelText="取消"
      width={900}
      destroyOnClose
      maskClosable={false}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      <div className="chart-node-config-modal">
        {/* Chart Type Selection */}
        <Form.Item label="图表类型" required>
          <div className="chart-type-grid">
            {CHART_TYPES_WITH_ICONS.map((ct) => (
              <Tooltip key={ct.value} title={ct.label}>
                <div
                  className={`chart-type-item ${config.chartType === ct.value ? 'selected' : ''}`}
                  onClick={() => !readOnly && handleChartTypeChange(ct.value as ChartType)}
                >
                  <span className="chart-type-icon">{ct.icon}</span>
                  <span className="chart-type-label">{ct.label}</span>
                </div>
              </Tooltip>
            ))}
          </div>
        </Form.Item>

        <Divider />

        {/* Field Mapping Section */}
        <div className="field-mapping-section">
          <Text strong style={{ marginBottom: 12, display: 'block' }}>
            字段映射
          </Text>

          <Form form={form} layout="vertical" onValuesChange={handleFormChange}>
            {/* X Axis Field */}
            {fieldMappingConfig.xFieldRequired ? (
              <Form.Item
                name="xField"
                label={`${getChartTypeLabel(config.chartType)} 分类字段 (X轴)`}
                extra={!availableFields.length && '暂无可用字段，请先连接上游节点'}
              >
                <Select
                  allowClear
                  showSearch
                  placeholder="选择分类字段"
                  options={fieldOptions}
                  disabled={readOnly}
                  onChange={(val) => handleFormChange({ xField: val })}
                />
              </Form.Item>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                此图表类型无需 X 轴字段
              </Text>
            )}

            {/* Y Axis Fields */}
            {fieldMappingConfig.showMultipleY ? (
              <>
                <Form.Item
                  name="yFields"
                  label={
                    <span>
                      数值字段 (Y轴)
                      <Text type="secondary" style={{ fontWeight: 400, marginLeft: 8 }}>
                        至少 {fieldMappingConfig.yFieldsRequired} 个
                      </Text>
                    </span>
                  }
                  extra={availableFields.length === 0 ? '暂无可用字段' : fieldMappingConfig.description}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    placeholder={`选择 ${fieldMappingConfig.yFieldsRequired} 个以上数值字段`}
                    options={fieldOptions}
                    disabled={readOnly}
                    onChange={(val) => handleFormChange({ yFields: val })}
                    maxTagCount={3}
                  />
                </Form.Item>
              </>
            ) : (
              <Form.Item
                name="yFields"
                label="数值字段 (Y轴)"
                extra={availableFields.length === 0 ? '暂无可用字段' : fieldMappingConfig.description}
              >
                <Select
                  allowClear
                  showSearch
                  placeholder="选择 1 个字段"
                  options={fieldOptions}
                  disabled={readOnly}
                  onChange={(val) => handleFormChange({ yFields: val ? [val] : [] })}
                />
              </Form.Item>
            )}

            {/* Aggregation Method */}
            <Form.Item name="yAggMethod" label="Y轴聚合方式">
              <Radio.Group options={AGG_METHOD_OPTIONS} />
            </Form.Item>

            {/* X Group By Toggle */}
            <Form.Item name="xGroupByEnabled" label="按 X 轴聚合 (GROUP BY)" valuePropName="checked">
              <Switch disabled={readOnly} />
            </Form.Item>
          </Form>
        </div>

        <Divider />

        {/* Chart Settings Section */}
        <div className="chart-settings-section">
          <Text strong style={{ marginBottom: 12, display: 'block' }}>
            图表设置
          </Text>

          <Form layout="vertical">
            {/* Axis Titles */}
            <Space size={16} style={{ width: '100%' }}>
              <Form.Item label="X轴标题" style={{ flex: 1 }}>
                <Input
                  value={config.xAxisTitle}
                  onChange={(e) => setConfig((prev) => ({ ...prev, xAxisTitle: e.target.value }))}
                  placeholder={config.xField || 'X轴'}
                  disabled={readOnly}
                />
              </Form.Item>
              <Form.Item label="Y轴标题" style={{ flex: 1 }}>
                <Input
                  value={config.yAxisTitle}
                  onChange={(e) => setConfig((prev) => ({ ...prev, yAxisTitle: e.target.value }))}
                  placeholder={config.yFields[0] || 'Y轴'}
                  disabled={readOnly}
                />
              </Form.Item>
            </Space>

            {/* Sort Settings */}
            <Space size={16} style={{ width: '100%' }}>
              <Form.Item label="排序依据" style={{ flex: 1 }}>
                <Select
                  value={config.sortBy}
                  onChange={(val) => setConfig((prev) => ({ ...prev, sortBy: val }))}
                  options={SORT_OPTIONS}
                  disabled={readOnly}
                />
              </Form.Item>
              <Form.Item label="排序方向" style={{ flex: 1 }}>
                <Select
                  value={config.sortOrder}
                  onChange={(val) => setConfig((prev) => ({ ...prev, sortOrder: val }))}
                  options={ORDER_OPTIONS}
                  disabled={readOnly}
                />
              </Form.Item>
            </Space>

            {/* Display Options */}
            <Space size={16}>
              <Form.Item label="显示图例" valuePropName="checked">
                <Switch
                  checked={config.showLegend}
                  onChange={(val) => setConfig((prev) => ({ ...prev, showLegend: val }))}
                  disabled={readOnly}
                />
              </Form.Item>
              <Form.Item label="显示提示" valuePropName="checked">
                <Switch
                  checked={config.showTooltip}
                  onChange={(val) => setConfig((prev) => ({ ...prev, showTooltip: val }))}
                  disabled={readOnly}
                />
              </Form.Item>
            </Space>

            {/* Bar-Line specific settings */}
            {config.chartType === 'bar_line' && (
              <Form.Item label="折线 Y 轴字段">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  placeholder="选择折线指标"
                  options={config.yFields.map((f) => ({ label: f, value: f }))}
                  value={config.lineYFields}
                  onChange={(val) => setConfig((prev) => ({ ...prev, lineYFields: val }))}
                  disabled={readOnly}
                />
              </Form.Item>
            )}
          </Form>
        </div>

        {/* Chart Preview */}
        <div className="chart-preview-section">
          <Text strong style={{ marginBottom: 12, display: 'block' }}>
            图表预览
          </Text>

          {!upstreamPreviewData || upstreamPreviewData.rows.length === 0 ? (
            <Empty description="暂无上游数据，请先配置上游节点" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : !isConfigValid() ? (
            <Alert type="warning" message={getValidationMessage()} showIcon icon={<InfoCircleOutlined />} />
          ) : (
            <div className="chart-preview-container">
              <ChartFactory
                data={formattedChartData.length > 0 ? formattedChartData : previewData}
                config={buildChartConfig()}
                style={{ height: 300 }}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        .chart-node-config-modal .chart-type-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 8px;
        }

        .chart-node-config-modal .chart-type-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 12px 8px;
          border: 1px solid #d9d9d9;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .chart-node-config-modal .chart-type-item:hover {
          border-color: #722ed1;
          background: #f9f0ff;
        }

        .chart-node-config-modal .chart-type-item.selected {
          border-color: #722ed1;
          background: #722ed1;
          color: #fff;
        }

        .chart-node-config-modal .chart-type-item.selected .chart-type-icon {
          color: #fff;
        }

        .chart-node-config-modal .chart-type-icon {
          font-size: 20px;
          color: #722ed1;
          margin-bottom: 4px;
        }

        .chart-node-config-modal .chart-type-label {
          font-size: 11px;
          text-align: center;
        }

        .chart-node-config-modal .field-mapping-section,
        .chart-node-config-modal .chart-settings-section,
        .chart-node-config-modal .chart-preview-section {
          margin-bottom: 16px;
        }

        .chart-node-config-modal .column-format-table {
          border: 1px solid #e8e8e8;
          border-radius: 6px;
          overflow: hidden;
        }

        .chart-node-config-modal .chart-preview-container {
          border: 1px solid #f0f0f0;
          border-radius: 8px;
          padding: 8px;
          background: #fafafa;
        }
      `}</style>
    </Modal>
  );
};

export default ChartNodeConfigModal;
