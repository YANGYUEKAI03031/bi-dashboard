/**
 * Chart node type definitions for Pipeline integration
 * Defines configuration interface for chart visualization nodes
 */

/** Supported chart types */
export type ChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'scatter'
  | 'radar'
  | 'boxplot'
  | 'bar_line'
  | 'stacked_bar'
  | 'waterfall'
  | 'funnel'
  | 'metric';

/** Aggregation methods for Y-axis metrics */
export type AggregationMethod = 'count' | 'sum' | 'avg' | 'mode' | 'median';

/** Sort options */
export type SortBy = 'x' | 'y';
export type SortOrder = 'asc' | 'desc';

/** Metric card mode */
export type MetricMode = 'aggregate' | 'cell';

/** Chart node configuration stored in pipeline node config */
export interface ChartNodeConfig {
  /** Chart visualization type */
  chartType: ChartType;

  /** X-axis field name */
  xField: string;

  /** Y-axis field names (multiple for multi-series charts) */
  yFields: string[];

  /** Dimension fields for grouping */
  graphDimensions: string[];

  /** Metric fields for aggregation */
  graphMetrics: string[];

  /** Aggregation method for Y-axis values */
  yAggMethod: AggregationMethod;

  /** Whether to group by X-axis field */
  xGroupByEnabled: boolean;

  /** X-axis display title */
  xAxisTitle: string;

  /** Y-axis display title */
  yAxisTitle: string;

  /** Right Y-axis title (for bar_line combined chart) */
  yAxisRightTitle: string;

  /** Sort field */
  sortBy: SortBy;

  /** Sort direction */
  sortOrder: SortOrder;

  /** Show chart legend */
  showLegend: boolean;

  /** Show tooltip on hover */
  showTooltip: boolean;

  /** Y-axis fields to render as line (for bar_line combined chart) */
  lineYFields: string[];

  /** Metric card specific: mode type */
  metricMode: MetricMode;

  /** Metric card specific: filter field */
  metricFilterField: string;

  /** Metric card specific: filter value */
  metricFilterValue: string;

  /** Metric card specific: filter expressions */
  metricFilters: MetricFilter[];

  /** Metric card specific: filter expression tree */
  metricFilterExpr: MetricFilterExprNode | undefined;

  /** Metric card specific: display unit */
  metricUnit: string;

  /** Metric card specific: decimal places */
  metricDecimals: number;

  /** Metric card specific: label text */
  metricLabel: string;

  /** 列格式化配置（字段名 -> 显示格式） */
  previewColumnFormats?: Record<string, string>;
}

/** Metric card filter definition */
export interface MetricFilter {
  id: string;
  field: string;
  op: MetricFilterOp;
  value: string;
}

/** Metric filter operators */
export type MetricFilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_null'
  | 'is_not_null'
  | 'date_before'
  | 'date_after'
  | 'date_between'
  | 'date_yesterday'
  | 'date_last_30_days'
  | 'date_this_month'
  | 'date_last_month';

/** Metric filter expression tree node */
export interface MetricFilterExprNode {
  type: 'rule' | 'group';
  id: string;
  field?: string;
  op?: MetricFilterOp;
  value?: string;
  logic?: 'and' | 'or';
  children?: MetricFilterExprNode[];
  betweenOps?: ('and' | 'or')[];
}

/** Chart type metadata for display */
export interface ChartTypeMeta {
  value: ChartType;
  label: string;
  icon: React.ReactNode;
}

/** Default chart node configuration */
export const DEFAULT_CHART_CONFIG: ChartNodeConfig = {
  chartType: 'bar',
  xField: '',
  yFields: [],
  graphDimensions: [],
  graphMetrics: [],
  yAggMethod: 'sum',
  xGroupByEnabled: true,
  xAxisTitle: '',
  yAxisTitle: '',
  yAxisRightTitle: '',
  sortBy: 'x',
  sortOrder: 'desc',
  showLegend: true,
  showTooltip: true,
  lineYFields: [],
  metricMode: 'aggregate',
  metricFilterField: '',
  metricFilterValue: '',
  metricFilters: [],
  metricFilterExpr: undefined,
  metricUnit: '',
  metricDecimals: 2,
  metricLabel: '',
  previewColumnFormats: undefined,
};

/** Chart type display labels */
export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: '柱状图',
  line: '折线图',
  area: '面积图',
  pie: '饼图',
  scatter: '散点图',
  radar: '雷达图',
  boxplot: '箱线图',
  bar_line: '柱线组合',
  stacked_bar: '堆积柱形图',
  waterfall: '瀑布图',
  funnel: '漏斗图',
  metric: '指标卡',
};

/** Aggregation method display labels */
export const AGG_METHOD_LABELS: Record<AggregationMethod, string> = {
  count: '计数',
  sum: '求和',
  avg: '平均值',
  mode: '众数',
  median: '中位数',
};

/** Get chart type label */
export function getChartTypeLabel(chartType: ChartType | string): string {
  return CHART_TYPE_LABELS[chartType as ChartType] || chartType;
}

/** Get aggregation method label */
export function getAggMethodLabel(method: AggregationMethod | string): string {
  return AGG_METHOD_LABELS[method as AggregationMethod] || method;
}

/**
 * 字段映射 UI 规则（与 VisualizationBuilder.getChartFieldConfig 对齐；散点图在管道弹窗用多选 2 列以满足校验）
 */
export interface ChartFieldMappingConfig {
  xFieldRequired: boolean;
  yFieldsRequired: number;
  yFieldsMax: number;
  showMultipleY: boolean;
  description: string;
}

export function getChartFieldMappingConfig(chartType: ChartType): ChartFieldMappingConfig {
  switch (chartType) {
    case 'pie':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showMultipleY: false,
        description: '需要 1 个分类字段和 1 个数值字段',
      };
    case 'scatter':
      return {
        xFieldRequired: true,
        yFieldsRequired: 2,
        yFieldsMax: 2,
        showMultipleY: true,
        description: '需要 2 个数值字段作为坐标',
      };
    case 'radar':
      return {
        xFieldRequired: false,
        yFieldsRequired: 2,
        yFieldsMax: 10,
        showMultipleY: true,
        description: '选择多个数值字段作为维度',
      };
    case 'boxplot':
      return {
        xFieldRequired: false,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showMultipleY: true,
        description: '选择数值字段用于箱体计算',
      };
    case 'bar_line':
      return {
        xFieldRequired: true,
        yFieldsRequired: 2,
        yFieldsMax: 10,
        showMultipleY: true,
        description: '分组柱 + 折线；可在下方指定折线指标',
      };
    case 'funnel':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showMultipleY: false,
        description: '需要 1 个阶段字段和 1 个数值字段',
      };
    case 'waterfall':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showMultipleY: false,
        description: '需要 1 个阶段字段和 1 个增量数值字段',
      };
    case 'stacked_bar':
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showMultipleY: true,
        description: '1 个分类字段与多个数值字段堆积',
      };
    case 'metric':
      return {
        xFieldRequired: false,
        yFieldsRequired: 1,
        yFieldsMax: 1,
        showMultipleY: false,
        description: '选择数值列与聚合方式',
      };
    default:
      return {
        xFieldRequired: true,
        yFieldsRequired: 1,
        yFieldsMax: 10,
        showMultipleY: true,
        description: '1 个分类字段与 1 个或多个数值字段',
      };
  }
}
