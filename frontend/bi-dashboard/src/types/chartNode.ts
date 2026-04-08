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
