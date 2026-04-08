import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart import as it's not available
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiverChart as ThemeRiver,
  CustomChart
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react';
import {
  applyMetricFilters,
  applyMetricFiltersExpr,
  computeMetricValue,
  formatMetricNumber,
  getEffectiveMetricFilterRules,
  parseMetricFilterExpr,
  type MetricFilterRule,
} from '../../utils/chartMetric';

// 注册必需的组件
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart registration
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiver,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  CanvasRenderer
]);

export interface ChartConfig {
  type: string;
  title?: string;
  xAxis?: any;
  yAxis?: any;
  series: any[];
  legend?: any;
  tooltip?: any;
  grid?: any;
  xField?: string; // X轴字段
  yFields?: string[]; // Y轴字段数组
  colorField?: string; // 颜色分组字段
  sort_by?: 'x' | 'y'; // 排序方式: 'x' 或 'y'
  sort_order?: 'asc' | 'desc'; // 排序顺序: 'asc' 或 'desc'
  // Y轴聚合方式：count / sum / avg / mode / median
  y_agg_method?: 'count' | 'sum' | 'avg' | 'mode' | 'median';
  /**
   * 是否按 X 轴字段做聚合（group by）。
   * - true: 在设置了 y_agg_method 且存在 xField/yFields 时，先按 X 聚合再绘图
   * - false: 不做按 X 聚合，直接用明细数据（即使配置了 y_agg_method）
   * - 未配置(undefined): 根据图表类型决定默认值：
   *    - 明细型图表（例如散点图）默认 false
   *    - 其他统计型图表默认 true
   */
  x_group_by_enabled?: boolean;
  minHeight?: number; // 图表容器最小高度（px）
  /** 柱线组合图：指定哪些 Y 指标用折线 + 右侧 Y 轴；未配置时默认最后 2 个为折线 */
  line_y_fields?: string[];
  /** 柱线组合图：右侧 Y 轴名称 */
  y_axis_right_title?: string;
  /** @deprecated 旧版 cell 模式，见 getEffectiveMetricFilterRules */
  metric_mode?: 'aggregate' | 'cell';
  metric_filter_field?: string;
  metric_filter_value?: string;
  /** 指标卡：构建器内固定筛选条件（AND），不随仪表盘筛选器变化 */
  metric_filters?: MetricFilterRule[];
  /** 指标卡：筛选布尔表达式树（优先于 metric_filters） */
  metric_filter_expr?: unknown;
  metric_unit?: string;
  metric_decimals?: number;
  metric_label?: string;
}

interface ChartFactoryProps {
  config: ChartConfig;
  data: any[];
  style?: React.CSSProperties;
  onEvents?: Record<string, Function>;
  minHeight?: number; // 优先级高于 config.minHeight
  /** 点击 X 轴标签时的回调，参数为选中的值、以及该值对应的字段名（用于按同名列联动筛选） */
  onXAxisClick?: (value: any, fieldName?: string) => void;
  /** 当前被选中的 X 轴值（用于高亮显示） */
  selectedXValue?: any;
}

// 根据 X 轴字段和聚合方式对原始数据做分组聚合，返回用于绘图的聚合结果
const aggregateDataByX = (
  data: any[],
  xField: string,
  yFields: string[],
  method: 'count' | 'sum' | 'avg' | 'mode' | 'median'
) => {
  if (!Array.isArray(data) || data.length === 0 || !xField || !yFields?.length) {
    return data || [];
  }

  const groups = new Map<string, { xValue: any; rows: any[] }>();

  data.forEach(row => {
    if (!row || typeof row !== 'object') return;
    const rawX = (row as any)[xField];
    const key = String(rawX);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { xValue: rawX, rows: [row] });
    }
  });

  const aggregateField = (rows: any[], field: string) => {
    const values = rows
      .map(r => (r as any)[field])
      .filter(v => v !== null && v !== undefined);

    if (values.length === 0) return null;

    switch (method) {
      case 'count':
        // 计数：使用行数，更符合直觉
        return rows.length;
      case 'sum': {
        const nums = values
          .map(v => (typeof v === 'number' ? v : Number(v)))
          .filter(v => !Number.isNaN(v));
        if (!nums.length) return null;
        return nums.reduce((acc, v) => acc + v, 0);
      }
      case 'avg': {
        const nums = values
          .map(v => (typeof v === 'number' ? v : Number(v)))
          .filter(v => !Number.isNaN(v));
        if (!nums.length) return null;
        return nums.reduce((acc, v) => acc + v, 0) / nums.length;
      }
      case 'mode': {
        const freq = new Map<string, { value: any; count: number }>();
        values.forEach(v => {
          const key = String(v);
          const rec = freq.get(key);
          if (rec) {
            rec.count += 1;
          } else {
            freq.set(key, { value: v, count: 1 });
          }
        });
        let best: { value: any; count: number } | null = null;
        freq.forEach(rec => {
          if (!best || rec.count > best.count) {
            best = rec;
          }
        });
        return best ? best.value : null;
      }
      case 'median': {
        const nums = values
          .map(v => (typeof v === 'number' ? v : Number(v)))
          .filter(v => !Number.isNaN(v))
          .sort((a, b) => a - b);
        if (!nums.length) return null;
        const mid = Math.floor(nums.length / 2);
        if (nums.length % 2 === 0) {
          return (nums[mid - 1] + nums[mid]) / 2;
        }
        return nums[mid];
      }
      default:
        return null;
    }
  };

  const result: any[] = [];
  groups.forEach(group => {
    const record: any = { [xField]: group.xValue };
    yFields.forEach(field => {
      record[field] = aggregateField(group.rows, field);
    });
    result.push(record);
  });

  return result;
};

export const ChartFactory: React.FC<ChartFactoryProps> = ({
  config,
  data,
  style = { height: '400px' },
  onEvents,
  minHeight,
  onXAxisClick,
  selectedXValue
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReactECharts>(null);
  const [isReady, setIsReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  // 用 ref 存当前选中值，避免 globalout 时闭包拿到旧值导致清除后又被重新高亮
  const selectedXValueRef = useRef<any>(selectedXValue);
  selectedXValueRef.current = selectedXValue;

  const isMetricChart = (config.type || '').toLowerCase() === 'metric';

  const normalizeLinkValue = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    // 兼容 ISO datetime：2025-12-22T00:00:00 -> 2025-12-22
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) return s.slice(0, 10);
    return s;
  };

  // 当容器尺寸发生变化（特别是从 0 变为实际宽高，或 Tab 切换后重新可见）时，
  // 通过变更 key 强制重新挂载 ECharts 实例，避免 ECharts 在“隐藏/尺寸不正确”的状态下初始化
  // 带来的坐标系偏移等问题。
  const chartKey = `${containerSize.width}x${containerSize.height}`;
  
  // 监听容器大小变化
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
        setContainerSize(prev =>
          prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }
        );
        // Only mark ready once we have a real size; after that, just resize the chart.
        if (!isReady && rect.width > 0 && rect.height > 0) {
          setIsReady(true);
        }
        const instance = chartRef.current?.getEchartsInstance?.();
        if (instance && rect.width > 0 && rect.height > 0) {
          instance.resize();
        }
      }
    };

    const scheduleUpdate = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSize);
    };
    
    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const containerEl = containerRef.current;
    if (containerEl) {
      resizeObserver.observe(containerEl);
    }
    
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (containerEl) {
        resizeObserver.unobserve(containerEl);
      }
    };
  }, [isReady]);
  
  const option = useMemo(() => {
    const containerHeight = containerSize.height;
    const containerWidth = containerSize.width;
    const compact = containerHeight > 0 && containerHeight < 220;
    const veryCompact = containerHeight > 0 && containerHeight < 160;
    const titleText = (config.title ?? '').toString().trim();
    const showTitle = titleText.length > 0;

    // 处理xAxis数据 - 使用配置的xField
    const sourceData = Array.isArray(data) ? data : [];
    const xField = config.xField || (Object.keys(sourceData[0] || {})[0]) || '';

    // 按图表类型判断是否“明细型图表”（默认不按 X 聚合）
    const chartType = (config.type || '').toLowerCase();
    if (chartType === 'metric') {
      return { animation: false };
    }
    const isDetailChartType = chartType === 'scatter';

    // 统一确定本次是否启用按 X 聚合：
    // - 优先使用调用方显式传入的 x_group_by_enabled
    // - 否则：明细型图表默认 false，其它图表默认 true
    const xGroupByEnabled =
      typeof config.x_group_by_enabled === 'boolean'
        ? config.x_group_by_enabled
        : !isDetailChartType;

    // 先确定“用于绘图的 Y 字段列表”（优先使用传入的 yFields，其次用 series.field，最后自动识别数值列）
    let effectiveYFields = (config.yFields || config.series.map(s => s.field) || []).filter(Boolean);
    if (effectiveYFields.length === 0 && sourceData.length > 0 && sourceData[0] && typeof sourceData[0] === 'object') {
      const firstItem = sourceData[0];
      const numericFields = Object.keys(firstItem).filter(key => {
        const value = (firstItem as any)[key];
        return (
          typeof value === 'number' ||
          (typeof value === 'string' && /^-?\d+\.?\d*$/.test(value))
        );
      });
      if (numericFields.length > 0) {
        effectiveYFields = numericFields;
      }
    }

    // 如果配置了聚合方式且启用了按 X 聚合，则先按 X 聚合，再参与后续排序和绘图
    const baseData =
      config.y_agg_method && xField && effectiveYFields.length > 0 && xGroupByEnabled
        ? aggregateDataByX(sourceData, xField, effectiveYFields, config.y_agg_method)
        : sourceData;

    // 排序处理
    let sortedData = [...baseData];
    if (config.sort_by && config.sort_order) {
      if (config.sort_by === 'x') {
        // 按X轴字段排序
        sortedData.sort((a, b) => {
          const valA = a[xField];
          const valB = b[xField];

          if (typeof valA === 'number' && typeof valB === 'number') {
            return config.sort_order === 'asc' ? valA - valB : valB - valA;
          }

          return config.sort_order === 'asc'
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        });
      } else if (config.sort_by === 'y' && effectiveYFields.length > 0) {
        // 按第一个Y轴字段排序
        const yField = effectiveYFields[0];
        sortedData.sort((a, b) => {
          const valA = a[yField];
          const valB = b[yField];

          if (typeof valA === 'number' && typeof valB === 'number') {
            return config.sort_order === 'asc' ? valA - valB : valB - valA;
          }

          return config.sort_order === 'asc'
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        });
      }
    }
    
    const xAxisData = sortedData.map(item => {
      if (!item) return '';
      
      // 支持多种数据格式
      if (typeof item === 'object' && item !== null) {
        // 对象格式：直接访问字段
        if (xField in item) {
          const value = item[xField];
          // 如果是日期格式，保持原样；否则转为字符串
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            return value;
          }
          return String(value);
        }
        // 嵌套对象：尝试访问子属性
        if (xField.includes('.')) {
          const keys = xField.split('.');
          let value = item;
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              break;
            }
          }
          if (value !== undefined) {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              return value;
            }
            return String(value);
          }
        }
        // 数组格式：取第一个元素
        if (Array.isArray(item) && item.length > 0) {
          const firstValue = item[0];
          if (typeof firstValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(firstValue)) {
            return firstValue;
          }
          return String(firstValue);
        }
      }
      
      // 基本类型
      return String(item);
    });

    // 处理系列数据 - 使用“最终确定”的 yFields（与聚合一致）
    const yFields = effectiveYFields;
    // 联动选中值归一化，用于在 option 里按项设置透明度（取消筛选时 selectedXValue 为 null，全部恢复不透明）
    // 若本图 x 轴与选中值无任何匹配（xlabel 不一样），则所有项 isSelected 均为 false，整图会统一变暗为 0.35
    const selectedNormalized = selectedXValue != null ? normalizeLinkValue(selectedXValue) : '';

    // 默认颜色调色板
    const colorPalette = [
      '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
      '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
    ];

    const axisLabelFromConfig = config.xAxis?.axisLabel || {};
    const axisLabelFontSize = axisLabelFromConfig.fontSize ?? 11;
    const axisLabelMargin = axisLabelFromConfig.margin ?? 15;
    const xAxisNameGap = config.xAxis?.nameGap ?? 32;

    const effectiveAxisLabelFontSize = compact ? Math.max(9, Math.round(axisLabelFontSize * 0.9)) : axisLabelFontSize;
    const effectiveAxisLabelMargin = compact ? Math.min(axisLabelMargin, 10) : axisLabelMargin;
    const effectiveXAxisNameGap = compact ? Math.min(xAxisNameGap, 22) : xAxisNameGap;

    // 估算 Y 轴刻度文字大致占用的宽度，用于在 grid.left / grid.right 上做平衡，
    // 让「真正的绘图区」而不是整张画布的左上角更接近卡片视觉中心。
    const estimateYAxisLabelWidth = () => {
      if (!yFields.length || !sortedData.length) return 40; // 增加默认值

      const sampleCount = Math.min(sortedData.length, 50);
      let maxChars = 0;
      let maxValue = 0;

      for (let i = 0; i < sampleCount; i++) {
        const row = sortedData[i];
        if (!row || typeof row !== 'object') continue;

        for (const field of yFields) {
          const v = (row as any)[field];
          if (v == null) continue;
          const s = typeof v === 'number' ? v.toString() : String(v);
          maxChars = Math.max(maxChars, s.length);
          // 对于数字，也考虑数值大小（大数字可能需要更多空间）
          if (typeof v === 'number') {
            maxValue = Math.max(maxValue, Math.abs(v));
          }
        }
      }

      if (maxChars === 0) maxChars = 3;
      const charWidth = 7; // 稍微增加字符宽度估算（考虑字体和间距）
      // 对于大数字，可能需要更多空间（考虑千分位、科学计数法等）
      const valueBasedPadding = maxValue > 1000 ? 8 : 0;
      const padding = 12 + valueBasedPadding; // 增加基础 padding
      return maxChars * charWidth + padding;
    };

    const yAxisLabelWidthEstimate = estimateYAxisLabelWidth();

    // 判断是否需要显示图例
    const legendShowExplicit =
      !!config.legend && Object.prototype.hasOwnProperty.call(config.legend, 'show');
    const defaultLegendShow = legendShowExplicit
      ? config.legend?.show !== false
      : (yFields.length > 1 && (config.legend?.show !== false));

    // 图例配置：移动到顶部，避免占用底部空间，让图表在卡片内更居中
    // 计算图例的 top 位置：如果有标题，图例应该在标题下方
    const titleHeightForLegend = showTitle ? (compact ? 32 : 40) : 0;
    const legendTopOffset = titleHeightForLegend > 0 
      ? titleHeightForLegend + (compact ? 8 : 12) // 标题下方留出间距
      : (compact ? 12 : 16); // 没有标题时，从顶部开始
    
    const defaultLegendOption: any = {
      data: yFields.map(field => field),
      show: defaultLegendShow,
      textStyle: {
        fontSize: compact ? 10 : 12,
        color: '#4a5568'
      },
      itemGap: compact ? 12 : 18,
      itemWidth: 14,
      itemHeight: 14,
      left: 'center',
      top: legendTopOffset,
      orient: 'horizontal'
    };
    const legendOption: any = {
      ...defaultLegendOption,
      ...(config.legend ?? {})
    };

    // 为底部只保留最小必要间距，不再额外预留大块空白，避免图表区域整体被“顶”到上方
    const defaultGridBottom = compact ? 28 : 32;

    /**
     * 说明：
     * - ECharts 的 grid.left 是「绘图区」到容器左侧的距离，Y 轴的刻度文字会再额外占用一段宽度在 grid 左侧。
     * - 我们根据数据大致估算了 Y 轴刻度文字的宽度，然后让「左侧总宽度（grid.left + 刻度文字）」尽量
     *   接近右侧的 grid.right，使得整张图在卡片里更接近视觉居中。
     * - 当画布特别窄时，适当收紧左右留白，避免图表被挤得太小。
     */
    const isVeryNarrowCanvas = containerWidth > 0 && containerWidth < 480;
    const baseSidePadding = isVeryNarrowCanvas ? (compact ? 10 : 12) : (compact ? 14 : 18);

    /**
     * 这里的关键点：
     * - ECharts 的 grid.left / grid.right 是「整个坐标系」到容器边缘的距离，
     *   Y 轴刻度文字大部分会落在 grid.left 这一块区域里。
     * - 为了让 grid 区域（绘图区）在容器中居中，我们需要考虑 Y 轴标签的宽度。
     * - 策略：让 grid 区域本身居中，Y 轴标签占用 grid.left 的空间。
     *   这样 X 轴标签（nameLocation: 'middle'）就能和 grid 区域对齐。
     */
    // 计算 Y 轴标签占用的实际宽度（包括一些边距）
    // 注意：ECharts 的 Y 轴标签会占用 grid.left 区域内的空间
    // 我们需要更准确地估算这个宽度，以确保 grid 区域居中
    // 增加额外的安全边距，确保 Y 轴标签不会被裁剪
    const yAxisLabelSpace = Math.max(
      Math.round(yAxisLabelWidthEstimate * 1.2), // 增加 20% 的安全边距
      isVeryNarrowCanvas ? 35 : 50 // 增加最小空间要求
    );
    
    // 关键修复：将 containLabel 默认设置为 false
    // 因为 containLabel: true 会让 ECharts 自动调整 grid.left，导致我们的居中设置失效
    // 通过手动预留足够的空间（yAxisLabelSpace），我们可以更好地控制布局
    const useContainLabel = config.grid?.containLabel !== undefined ? config.grid.containLabel : false;
    
    // 为了让整个图表（包括 Y 轴标签）在容器中视觉居中：
    // - 左侧总宽度（包括 Y 轴标签）= baseSidePadding + yAxisLabelSpace
    // - 右侧宽度 = gridRight
    // - 要让整体视觉居中，需要：左侧总宽度 = 右侧宽度
    // - 所以 gridRight = baseSidePadding + yAxisLabelSpace
    // - 这样 grid 区域会稍微偏右，但加上左侧的 Y 轴标签后，整体视觉上居中
    // 注意：grid 区域的中心 = (gridLeft + containerWidth - gridRight) / 2
    // 如果 gridLeft = gridRight，那么 grid 区域中心 = containerWidth / 2（容器中心）
    // 但视觉上，整个图表（包括 Y 轴标签）的中心会偏右，因为 Y 轴标签在左侧
    // 所以我们需要让 grid 区域稍微偏左，这样加上 Y 轴标签后，整体视觉上居中
    // 策略：让 gridRight 稍大一些，使 grid 区域稍微偏左
    // 但考虑到 Y 轴标签的实际占用可能小于 yAxisLabelSpace（因为我们增加了 20% 的安全边距），
    // 我们让 gridRight 稍微小一些，使 grid 区域稍微偏左，这样整体视觉上更居中
    const gridLeft = baseSidePadding + yAxisLabelSpace;
    // 为了让整体视觉居中，右侧应该等于左侧总宽度
    // 但考虑到 Y 轴标签的实际占用可能小于 yAxisLabelSpace，我们稍微调整
    // 尝试让 gridRight = baseSidePadding + yAxisLabelSpace，看看效果
    const gridRight = baseSidePadding + yAxisLabelSpace; // 让左右对称，使整体视觉居中

    // 估算标题和图例在顶部占用的空间，避免"标题/图例压进绘图区"
    // 增加预留空间，确保标题和图例有足够空间显示，不会与绘图区重叠
    const estimatedTitleHeight = showTitle ? (compact ? 32 : 40) : 0; // 增加标题高度估算（包含 padding）
    const legendIsVisible = !!legendOption.show;
    const estimatedLegendHeight = legendIsVisible ? (compact ? 28 : 32) : 0; // 增加图例高度估算
    const baseTopPadding = compact ? 12 : 16; // 增加基础顶部间距
    const gridTop =
      baseTopPadding +
      estimatedTitleHeight +
      (estimatedLegendHeight > 0 ? estimatedLegendHeight + 8 : 0); // 增加图例与标题之间的间距

    const defaultGridOption: any = {
      left: gridLeft,
      right: gridRight,
      bottom: defaultGridBottom,
      // 为标题和顶部图例预留足够空间，避免文字进入绘图区
      top: gridTop,
      // 默认设置为 false，避免 ECharts 自动调整 grid 区域导致居中失效
      containLabel: useContainLabel
    };
    // 确保用户传入的 config.grid 不会覆盖我们的 left/right 设置（除非用户明确指定）
    const gridOption: any = {
      ...defaultGridOption,
      ...(config.grid ?? {}),
      // 如果用户没有明确指定 left/right，使用我们的居中设置
      ...(config.grid?.left === undefined ? { left: gridLeft } : {}),
      ...(config.grid?.right === undefined ? { right: gridRight } : {})
    };

    const baseOption: any = {
      backgroundColor: 'transparent',
      color: colorPalette,
      title: showTitle
        ? {
            text: titleText,
            left: 'center', // 标题居中显示
            top: compact ? 12 : 16, // 显式设置标题顶部位置
            textStyle: {
              fontSize: 18,
              fontWeight: 'bold',
              color: '#1a202c'
            },
            padding: [10, 0]
          }
        : { show: false },
      tooltip: config.tooltip || {
        trigger: 'axis',
        backgroundColor: 'rgba(50, 50, 50, 0.95)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: {
          color: '#fff',
          fontSize: 12
        },
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: '#718096'
          },
          lineStyle: {
            type: 'dashed',
            width: 1
          }
        },
        padding: [8, 12]
      },
      legend: legendOption,
      grid: gridOption,
      xAxis: {
        ...config.xAxis,
        type: 'category',
        data: xAxisData,
        name: config.xAxis?.name || (compact ? '' : 'X轴'),
        // 默认放中间，与标题居中对齐
        // nameLocation: 'middle' 是相对于 grid 区域的中间，与标题的 gridCenterPosition 对齐
        nameLocation: config.xAxis?.nameLocation ?? 'middle',
        nameGap: config.xAxis?.nameGap ?? effectiveXAxisNameGap,
        nameTextStyle: {
          fontSize: 12,
          color: '#4a5568',
          padding: [8, 0, 0, 0],
          align: 'center', // 确保文本居中对齐，而不是左对齐
          ...(config.xAxis?.nameTextStyle || {})
        },
        axisLine: {
          lineStyle: {
            color: '#e2e8f0',
            width: 1
          }
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: '#e2e8f0'
          }
        },
        splitLine: {
          show: false
        },
        // 对于日期数据保持原样；对长文本默认“换行展示全量”，避免总是显示不全
        axisLabel: (() => {
          const axisLabelFromConfig = config.xAxis?.axisLabel || {};
          const defaultFormatter = (value: unknown) => {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value;
            if (typeof value === 'string' && value.length > 10) {
              // 面板太矮时优先省略号，避免多行换行把图“压扁”
              if (compact) return value.slice(0, 10) + '…';
              const chunks = value.match(/.{1,6}/g);
              return chunks ? chunks.join('\n') : value;
            }
            return value as any;
          };

          return {
            show: axisLabelFromConfig.show ?? !veryCompact,
            margin: effectiveAxisLabelMargin,
            fontSize: effectiveAxisLabelFontSize,
            color: '#4a5568',
            // 富文本样式必须挂在 axisLabel.rich 上，否则会把 `{highlight|...}` 当普通文本显示出来
            rich: {
              highlight: {
                color: '#1890ff',
                fontWeight: 'bold',
                fontSize: effectiveAxisLabelFontSize + 1
              }
            },
            ...axisLabelFromConfig,
            // 用户自定义 formatter 优先
            formatter: (value: unknown) => {
              const formatted = defaultFormatter(value);
              // 高亮选中的 X 轴标签
              if (selectedXValue !== undefined && selectedXValue !== null) {
                if (normalizeLinkValue(value) === normalizeLinkValue(selectedXValue)) {
                  return `{highlight|${formatted}}`;
                }
              }
              return formatted;
            },
            rotate: axisLabelFromConfig.rotate ?? 0,
            // 始终启用点击事件
            triggerEvent: true
          };
        })()
      },
      yAxis: {
        ...config.yAxis,
        type: 'value',
        name: config.yAxis?.name || (compact ? '' : 'Y轴'),
        nameTextStyle: {
          fontSize: 12,
          color: '#4a5568',
          padding: [0, 0, 8, 0]
        },
        axisLine: {
          show: true,
          lineStyle: {
            color: '#e2e8f0',
            width: 1
          }
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: '#e2e8f0'
          }
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#f1f5f9',
            type: 'dashed',
            width: 1
          }
        },
        axisLabel: {
          fontSize: 11,
          color: '#4a5568'
        }
      },
      animation: true,
      animationDuration: 750,
      animationEasing: 'cubicOut'
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar': {
        const isMultiBarSeries = yFields.length > 1;
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          data: sortedData.map((item, i) => {
            const val = item[field] || 0;
            const name = item[xField];
            const isSelected = selectedNormalized && normalizeLinkValue(String(name ?? '')) === selectedNormalized;
            const opacity = selectedNormalized ? (isSelected ? 1 : 0.35) : undefined;
            if (process.env.NODE_ENV === 'development' && selectedNormalized) {
              console.log(`[ChartFactory] BAR #${i} name=${name} isSelected=${isSelected} opacity=${opacity}`);
            }
            return typeof val === 'object' && val !== null && !Array.isArray(val)
              ? { ...(val as any), itemStyle: opacity != null ? { opacity } : undefined }
              : opacity != null ? { value: val, itemStyle: { opacity } } : val;
          }),
          // 当有多个 Y 轴字段（多系列）时，不固定百分比宽度，只限制最大像素宽度并设置合理的间距，
          // 避免一组类目下柱子总宽度超过可用带宽而出现“折叠/重叠”。
          ...(isMultiBarSeries
            ? {
                barMaxWidth: 24,
                barGap: '30%',
                barCategoryGap: '45%'
              }
            : {
                barWidth: '60%',
                barMaxWidth: 40
              }),
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
              ]
            }
          },
          emphasis: {
            focus: 'self',
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
              borderColor: '#fff',
              borderWidth: 2,
              opacity: 1
            }
          },
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
      }
        
      case 'line':
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: colorPalette[index % colorPalette.length]
          },
          emphasis: { focus: 'self' },
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'area':
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: colorPalette[index % colorPalette.length]
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] + 'CC' },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '20' }
              ]
            }
          },
          emphasis: {
            focus: 'series'
          },
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'pie':
        baseOption.tooltip = {
          trigger: 'item'
        };
        baseOption.legend = {
          top: 'bottom'
        };
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        
        if (yFields.length > 0) {
          const fieldValue = yFields[0]; // 饼图通常只需要一个数值字段
          baseOption.series = [{
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['50%', '50%'],
            data: sortedData.map((item, index) => {
              const name = item[xField] || `数据${index + 1}`;
              const isSelected = selectedNormalized && (normalizeLinkValue(String(name)) === selectedNormalized || normalizeLinkValue(String(String(name).split(':')[0]?.trim() || '')) === selectedNormalized);
              const opacity = selectedNormalized ? (isSelected ? 1 : 0.35) : undefined;
              if (process.env.NODE_ENV === 'development' && selectedNormalized) {
                console.log(`[ChartFactory] PIE #${index} name=${name} isSelected=${isSelected} opacity=${opacity}`);
              }
              return {
                name,
                value: item[fieldValue] || 0,
                itemStyle: {
                  borderRadius: 6,
                  borderColor: '#fff',
                  borderWidth: 2,
                  ...(opacity != null ? { opacity } : {})
                }
              };
            }),
            label: {
              show: true,
              formatter: '{b}: {c} ({d}%)',
              fontSize: 11,
              color: '#666'
            },
            labelLine: {
              show: true,
              lineStyle: {
                color: '#999'
              }
            },
            emphasis: {
              focus: 'self',
              itemStyle: {
                shadowBlur: 15,
                shadowOffsetX: 0,
                shadowOffsetY: 0,
                shadowColor: 'rgba(0, 0, 0, 0.4)'
              },
              label: {
                fontSize: 13,
                fontWeight: 'bold'
              }
            },
            animationType: 'scale',
            animationEasing: 'elasticOut',
            animationDelay: function (idx: number) {
              return idx * 50;
            }
          }];
        }
        break;
        
      case 'scatter':
        baseOption.xAxis.type = 'value';
        baseOption.yAxis.type = 'value';
        if (yFields.length >= 2) {
          baseOption.series = [{
            name: '散点图',
            type: 'scatter',
            data: sortedData.map(item => [item[yFields[0]] || 0, item[yFields[1]] || 0]),
            symbolSize: function(data: number[]) {
              return Math.sqrt(data[0] + data[1]) * 2 + 8;
            },
            itemStyle: {
              color: colorPalette[0],
              opacity: 0.7,
              borderColor: '#fff',
              borderWidth: 1
            },
            emphasis: {
              itemStyle: {
                opacity: 1,
                shadowBlur: 10,
                shadowColor: 'rgba(0, 0, 0, 0.3)'
              }
            }
          }];
          // 移除不必要的轴配置
          delete baseOption.xAxis.data;
          delete baseOption.xAxis.name;
          delete baseOption.yAxis.name;
        }
        break;
        
      case 'radar':
        // 雷达图配置
        const indicator = yFields.map(field => ({
          name: field,
          max: Math.max(...data.map(item => item[field] || 0)) * 1.1
        }));
        
        baseOption.radar = {
          indicator: indicator,
          shape: 'polygon',
          splitNumber: 5,
          radius: '70%',
          axisName: {
            color: '#666',
            fontSize: 12,
            fontWeight: 'normal'
          },
          splitArea: {
            show: true,
            areaStyle: {
              color: ['rgba(84, 112, 198, 0.05)', 'rgba(84, 112, 198, 0.1)']
            }
          },
          splitLine: {
            lineStyle: {
              color: '#e0e0e0',
              width: 1
            }
          },
          axisLine: {
            lineStyle: {
              color: '#e0e0e0',
              width: 1
            }
          }
        };
        
        baseOption.series = [{
          type: 'radar',
          data: [{
            value: yFields.map(field => data[0]?.[field] || 0),
            name: '数据',
            areaStyle: {
              color: colorPalette[0] + '40'
            },
            lineStyle: {
              width: 2.5,
              color: colorPalette[0]
            },
            itemStyle: {
              color: colorPalette[0],
              borderWidth: 2,
              borderColor: '#fff'
            },
            emphasis: {
              areaStyle: {
                color: colorPalette[0] + '60'
              }
            }
          }]
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'boxplot':
        // 箱线图需要特殊的数据格式
        baseOption.series = [{
          name: '箱线图',
          type: 'boxplot',
          data: sortedData.map((item, index) => {
            // 箱线图需要5个值：[min, Q1, median, Q3, max]
            const values = yFields.map(field => item[field] || 0).sort((a, b) => a - b);
            if (values.length >= 5) {
              return values.slice(0, 5);
            } else {
              // 如果数据不足5个，补充数据
              const median = values[Math.floor(values.length / 2)] || 0;
              const q1 = values[Math.floor(values.length / 4)] || median;
              const q3 = values[Math.floor(values.length * 3 / 4)] || median;
              const min = Math.min(...values) || 0;
              const max = Math.max(...values) || 0;
              return [min, q1, median, q3, max];
            }
          })
        }];
        
        baseOption.xAxis = {
          type: 'category',
          data: data.map((_, index) => `组${index + 1}`)
        };
        
        baseOption.yAxis = {
          type: 'value'
        };
        break;
        
      case 'stacked_bar':
        // 堆积柱形图
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          stack: '总量',
          data: sortedData.map(item => item[field] || 0),
          // For stacked bars, all series share the same category bar width.
          // Avoid barGap/barCategoryGap here (they are for grouped bars) to prevent visual artifacts.
          barWidth: '60%',
          barMaxWidth: 40,
          itemStyle: {
            opacity: 1,
            borderRadius: index === yFields.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0],
            // Add a subtle separator so stacked segments don't visually blend and look overlapped.
            borderColor: '#ffffff',
            borderWidth: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                // Keep stacked bars opaque so lower stacks don't "show through" and look overlapped.
                { offset: 1, color: colorPalette[index % colorPalette.length] }
              ]
            }
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }));
        break;

      case 'bar_line': {
        // 分组柱 + 折线 + 双 Y 轴（与常见 BI「柱线组合」一致，非统计箱须图）
        const yList = yFields || [];
        const configuredLines = (config.line_y_fields || []).filter(f => yList.includes(f));
        let lineFieldSet: Set<string>;
        if (configuredLines.length > 0) {
          lineFieldSet = new Set(configuredLines);
        } else if (yList.length >= 3) {
          lineFieldSet = new Set(yList.slice(-2));
        } else if (yList.length === 2) {
          lineFieldSet = new Set([yList[1]]);
        } else {
          lineFieldSet = new Set();
        }
        const barFields = yList.filter(f => !lineFieldSet.has(f));
        const lineFields = yList.filter(f => lineFieldSet.has(f));
        const effectiveBarFields = barFields.length > 0 ? barFields : yList.length ? [yList[0]] : [];
        const lineCandidates = lineFields.length > 0 ? lineFields : yList.slice(effectiveBarFields.length);
        const effectiveLineFields = lineCandidates.filter(f => !effectiveBarFields.includes(f));

        const isMultiBarSeries = effectiveBarFields.length > 1;
        baseOption.yAxis = [
          {
            type: 'value',
            name: config.yAxis?.name || (compact ? '' : 'Y轴(左)'),
            position: 'left',
            nameTextStyle: { fontSize: 12, color: '#4a5568', padding: [0, 0, 8, 0] },
            axisLine: { show: true, lineStyle: { color: '#e2e8f0', width: 1 } },
            axisTick: { show: true, lineStyle: { color: '#e2e8f0' } },
            splitLine: { show: true, lineStyle: { color: '#f1f5f9', type: 'dashed', width: 1 } },
            axisLabel: { fontSize: 11, color: '#4a5568' }
          },
          {
            type: 'value',
            name: config.y_axis_right_title || (compact ? '' : 'Y轴(右)'),
            position: 'right',
            nameTextStyle: { fontSize: 12, color: '#4a5568', padding: [0, 0, 8, 0] },
            axisLine: { show: true, lineStyle: { color: '#e2e8f0', width: 1 } },
            axisTick: { show: true, lineStyle: { color: '#e2e8f0' } },
            splitLine: { show: false },
            axisLabel: { fontSize: 11, color: '#4a5568' }
          }
        ];
        baseOption.grid = {
          ...gridOption,
          right:
            (typeof gridOption.right === 'number' ? gridOption.right : 0) +
            (effectiveLineFields.length > 0 ? 48 : 0)
        };

        const barSeries = effectiveBarFields.map((field, index) => ({
          name: field,
          type: 'bar' as const,
          yAxisIndex: 0,
          data: sortedData.map((item, i) => {
            const val = item[field] || 0;
            const name = item[xField];
            const isSelected = selectedNormalized && normalizeLinkValue(String(name ?? '')) === selectedNormalized;
            const opacity = selectedNormalized ? (isSelected ? 1 : 0.35) : undefined;
            return typeof val === 'object' && val !== null && !Array.isArray(val)
              ? { ...(val as any), itemStyle: opacity != null ? { opacity } : undefined }
              : opacity != null ? { value: val, itemStyle: { opacity } } : val;
          }),
          ...(isMultiBarSeries
            ? { barMaxWidth: 24, barGap: '30%', barCategoryGap: '45%' }
            : { barWidth: '60%', barMaxWidth: 40 }),
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
              ]
            }
          },
          emphasis: { focus: 'self' as const }
        }));

        const lineSeries = effectiveLineFields.map((field, index) => ({
          name: field,
          type: 'line' as const,
          yAxisIndex: 1,
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: true,
          lineStyle: {
            width: 2.5,
            color: colorPalette[(effectiveBarFields.length + index) % colorPalette.length]
          },
          emphasis: { focus: 'self' as const }
        }));

        baseOption.series = [...barSeries, ...lineSeries];
        break;
      }
        
      case 'waterfall':
        // 瀑布图 - 需要计算累积值
        let cumulative = 0;
        const waterfallData = sortedData.map((item, index) => {
          const value = item[yFields[0]] || 0;
          const result = cumulative + value;
          cumulative = result;
          return {
            name: item[xField] || `项目${index + 1}`,
            value: value,
            cumulative: result
          };
        });
        
        baseOption.series = [{
          name: '瀑布图',
          type: 'bar',
          data: waterfallData.map(item => ({
            value: item.value,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: item.value >= 0 ? '#5470c6' : '#ee6666' },
                  { offset: 1, color: (item.value >= 0 ? '#5470c6' : '#ee6666') + 'CC' }
                ]
              }
            }
          })),
          barWidth: '60%',
          barMaxWidth: 40,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }];
        
        // 添加辅助线显示累计值
        baseOption.series.push({
          name: '累计值',
          type: 'line',
          data: waterfallData.map(item => item.cumulative),
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            type: 'dashed',
            width: 2,
            color: '#999'
          },
          itemStyle: { color: '#999' }
        });
        break;
        
      case 'funnel':
        // 漏斗图
        const maxFunnelValue = Math.max(...sortedData.map(item => item[yFields[0]] || 0));
        baseOption.series = [{
          name: '漏斗图',
          type: 'funnel',
          left: '10%',
          top: 60,
          bottom: 60,
          width: '80%',
          min: 0,
          max: maxFunnelValue,
          minSize: '0%',
          maxSize: '100%',
          sort: 'descending',
          gap: 3,
          label: {
            show: true,
            position: 'inside',
            fontSize: 12,
            color: '#fff',
            fontWeight: 'bold',
            formatter: '{b}\n{c} ({d}%)'
          },
          labelLine: {
            show: true,
            length: 15,
            lineStyle: {
              width: 1,
              type: 'solid',
              color: '#999'
            }
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2,
            borderRadius: 4
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            },
            label: {
              fontSize: 14
            }
          },
          data: sortedData.map((item, index) => ({
            name: item[xField] || `阶段${index + 1}`,
            value: item[yFields[0]] || 0,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: colorPalette[index % colorPalette.length] },
                  { offset: 1, color: colorPalette[index % colorPalette.length] + 'CC' }
                ]
              }
            }
          }))
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'heatmap':
        // 热力图需要特殊的二维数据格式
        const maxValue = Math.max(...data.map(item => Math.max(...yFields.map(field => item[field] || 0))));
        baseOption.visualMap = {
          min: 0,
          max: maxValue,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '15%',
          inRange: {
            color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffcc', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
          },
          textStyle: {
            color: '#666',
            fontSize: 11
          },
          itemWidth: 15,
          itemHeight: 150
        };
        baseOption.series = [{
          name: '热力图',
          type: 'heatmap',
          data: sortedData.map((item, rowIndex) => 
            yFields.map((field, colIndex) => [colIndex, rowIndex, item[field] || 0])
          ).flat(),
          label: {
            show: true,
            fontSize: 10,
            color: '#333'
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 1
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
              borderWidth: 2
            }
          }
        }];
        baseOption.xAxis = {
          type: 'category',
          data: yFields,
          splitArea: {
            show: true
          },
          axisLabel: {
            fontSize: 11,
            color: '#666'
          }
        };
        baseOption.yAxis = {
          type: 'category',
          data: xAxisData,
          splitArea: {
            show: true
          },
          axisLabel: {
            fontSize: 11,
            color: '#666'
          }
        };
        break;
        
      default:
        // 默认使用柱状图
        const isMultiDefaultBarSeries = yFields.length > 1;
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          data: sortedData.map(item => item[field] || 0),
          ...(isMultiDefaultBarSeries
            ? {
                barMaxWidth: 24,
                barGap: '30%',
                barCategoryGap: '45%'
              }
            : {
                barWidth: '60%',
                barMaxWidth: 40
              }),
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
              ]
            }
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }));
    }

    // 如果有颜色分组字段，添加颜色映射
    if (config.colorField && config.colorField !== '') {
      baseOption.visualMap = {
        show: false,
        dimension: 2,
        pieces: [
          { gt: 0, color: colorPalette[0] },
          { gt: 100, color: colorPalette[1] },
          { gt: 200, color: colorPalette[2] },
          { gt: 300, color: colorPalette[3] },
          { gt: 400, color: colorPalette[4] }
        ]
      };
    }

    return baseOption;
  }, [config, data, containerSize.height, containerSize.width, selectedXValue]);

  // 用 ref 保存最新 option，取消筛选时强制 setOption 用
  const optionRef = useRef<any>(null);
  optionRef.current = option;

  const applySelection = useCallback((value: any) => {
    if ((config.type || '').toLowerCase() === 'metric') return;
    const instance = chartRef.current?.getEchartsInstance?.();
    if (!instance) return;

    const normalized = value == null ? '' : normalizeLinkValue(value);

    try {
      const opt: any = instance.getOption?.() || {};
      const chartType = (config.type || '').toLowerCase();

      // 取消筛选：清除所有高亮/变暗
      if (!normalized) {
        try {
          instance.dispatchAction({ type: 'hideTip' } as any);
        } catch {
          // ignore
        }
        // 清除所有高亮/变暗
        instance.dispatchAction({ type: 'downplay' } as any);
        // 用最新 option 强制同步 setOption，立即恢复所有项的不透明度
        // 先 clear 再 setOption，彻底清除旧的 opacity 状态
        const newOption = optionRef.current;
        if (newOption) {
          instance.clear();
          instance.setOption(newOption, { notMerge: true, lazyUpdate: false });
        }
        return;
      }

      if (chartType === 'pie') {
        const series0 = opt.series?.[0];
        const arr = (series0?.data || []) as any[];
        const idx = arr.findIndex((d: any) => {
          const name = d?.name;
          if (name == null) return false;
          const s = String(name).trim();
          if (normalizeLinkValue(s) === normalized) return true;
          // 饼图 label 可能是 "邓玉梅: 125324 (7%)"，用冒号前一段或前缀匹配
          const beforeColon = s.split(':')[0].trim();
          return normalizeLinkValue(beforeColon) === normalized || s.startsWith(normalized);
        });
        if (idx >= 0) {
          // 先downplay全部，再highlight选中的
          instance.dispatchAction({ type: 'downplay', seriesIndex: 0 } as any);
          instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx } as any);
        }
        return;
      }

      // category charts (bar/line/area/stacked_bar etc.)
      const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
      const xAxisData = (xAxis?.data || []) as any[];
      if (process.env.NODE_ENV === 'development') {
        console.log('[ChartFactory] applySelection - xAxisData:', xAxisData, 'searching normalized:', normalized);
      }
      const selectedDataIndex = xAxisData.findIndex((x: any) => {
        const v = normalizeLinkValue(x);
        if (v === normalized) return true;
        const sx = String(x ?? '').trim();
        return sx === normalized || sx.startsWith(normalized) || normalized.startsWith(sx);
      });
      if (process.env.NODE_ENV === 'development') {
        console.log('[ChartFactory] applySelection - matched index:', selectedDataIndex);
      }
      if (selectedDataIndex < 0) return;

      const seriesArr = (opt.series || []) as any[];
      const dataLen = xAxisData.length;
      // 先对所有数据项 downplay（柱子变暗），再只对选中的 highlight（柱子高亮）
      seriesArr.forEach((_: any, seriesIndex: number) => {
        for (let i = 0; i < dataLen; i++) {
          instance.dispatchAction({ type: 'downplay', seriesIndex, dataIndex: i } as any);
        }
      });
      seriesArr.forEach((_: any, seriesIndex: number) => {
        instance.dispatchAction({ type: 'highlight', seriesIndex, dataIndex: selectedDataIndex } as any);
      });
    } catch {
      // ignore highlight failures
    }
  }, [config.type]);

  // 外部联动选中值变化时，更新高亮/变暗状态
  useEffect(() => {
    if (!isReady) return;
    // 取消筛选时同步执行并刷新，避免“要移入图表才更新”的延迟感
    if (selectedXValue == null) {
      applySelection(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      applySelection(selectedXValue);
    });
    return () => cancelAnimationFrame(id);
  }, [applySelection, isReady, selectedXValue]);

  // When parent controls height via percentages (e.g. dashboard cards), a large default minHeight
  // can cause ECharts to be clipped (overflow hidden) instead of adapting to the smaller container.
  const styleHeight = style?.height;
  const defaultMinHeight =
    typeof styleHeight === 'string' && styleHeight.trim().endsWith('%') ? 0 : 280;
  const resolvedMinHeight =
    (minHeight ??
      config.minHeight ??
      (typeof style.minHeight === 'number' ? style.minHeight : undefined) ??
      defaultMinHeight);

  // 记录 mousedown 时的位置（使用 ZRender 坐标系，更适合 canvas 内事件）
  const mouseDownZrPos = useRef<{ x: number; y: number } | null>(null);
  const ZR_MOVE_THRESHOLD_PX = 8;
  // 去重：避免一次操作触发两次 click（柱状图更容易出现）
  const lastClickRef = useRef<{ at: number; value: string } | null>(null);
  const CLICK_DEDUP_WINDOW_MS = 120;

  // 处理点击：X 轴标签 或 柱子/饼图扇区 都触发联动
  const handleChartClick = (params: any, e: any) => {
    if ((config.type || '').toLowerCase() === 'metric') return;
    if (!onXAxisClick) return;

    // 只有“按下与抬起位置接近”才视为有效点击，避免移动中划过其他柱子时误触
    if (mouseDownZrPos.current && e?.event) {
      const ex = e.event.offsetX ?? e.event.zrX;
      const ey = e.event.offsetY ?? e.event.zrY;
      if (typeof ex === 'number' && typeof ey === 'number') {
        const dx = Math.abs(ex - mouseDownZrPos.current.x);
        const dy = Math.abs(ey - mouseDownZrPos.current.y);
        if (dx > ZR_MOVE_THRESHOLD_PX || dy > ZR_MOVE_THRESHOLD_PX) {
          return;
        }
      }
    }

    let value: any = null;
    let clickSource = '';
    if (params.componentType === 'axisLabel') {
      value = params.value;
      clickSource = 'axisLabel';
    } else if (params.componentType === 'series') {
      const chartType = (config.type || '').toLowerCase();
      clickSource = `series:${chartType}`;
      // 折线图/面积图：series.name 是 Y 字段名（如「星级」），需用 dataIndex 从 x 轴取类目作为联动值
      if (
        (chartType === 'line' || chartType === 'area' || (chartType === 'bar_line' && params.seriesType === 'line')) &&
        typeof params.dataIndex === 'number'
      ) {
        const opt = optionRef.current;
        const xAxis = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : opt?.xAxis;
        const xAxisData = (xAxis?.data || []) as any[];
        if (params.dataIndex >= 0 && params.dataIndex < xAxisData.length) {
          value = xAxisData[params.dataIndex];
          clickSource += ` -> xAxis[dataIndex=${params.dataIndex}]`;
        }
      }
      if (value == null) {
        value = params.name; // 柱状图、饼图等：name 即为类目/扇区名
        clickSource += ` -> name`;
      }
    }
    // 打印点击信息
    if (process.env.NODE_ENV === 'development' && value != null) {
      console.log('[ChartFactory] 点击事件:', {
        chartType: config.type,
        chartName: config.title,
        clickSource,
        rawValue: value,
        normalized: normalizeLinkValue(value),
        paramsDataIndex: params.dataIndex,
        paramsName: params.name,
      });
    }
    if (value != null) {
      const normalized = normalizeLinkValue(value);
      const currentNormalized = selectedXValue != null ? normalizeLinkValue(selectedXValue) : '';

      // 点击相同 value 时取消筛选（切换）
      if (normalized && currentNormalized && normalized === currentNormalized) {
        applySelection(null);
        onXAxisClick(null, undefined);
        return;
      }

      // 去重：同一值在极短时间内重复触发，忽略第二次
      const now = Date.now();
      const last = lastClickRef.current;
      if (last && normalized && last.value === normalized && now - last.at < CLICK_DEDUP_WINDOW_MS) {
        return;
      }
      lastClickRef.current = { at: now, value: normalized };

      // 先在当前图上做“高亮/变暗”，再通知外部做联动（带上 xField，便于按同名列筛选）
      applySelection(value);
      onXAxisClick(value, config.xField);
    }
  };

  // 鼠标移出图表时 ECharts 会触发 globalout 并清除高亮；若有选中值则下一帧重新应用高亮（用 ref 避免清除后又被旧闭包重新高亮）
  const handleGlobalOut = useCallback(() => {
    const current = selectedXValueRef.current;
    if (current == null) return;
    requestAnimationFrame(() => {
      if (selectedXValueRef.current == null) return;
      applySelection(selectedXValueRef.current);
    });
  }, [applySelection]);

  const mergedEvents = {
    ...(onEvents || {}),
    click: handleChartClick,
    globalout: handleGlobalOut
  };

  // 绑定 ZRender mousedown/mouseup：记录并清理按下位置（同一坐标系）
  useEffect(() => {
    if (!isReady) return;
    const instance = chartRef.current?.getEchartsInstance?.();
    const zr = instance?.getZr?.();
    if (!zr) return;

    const onDown = (ev: any) => {
      const x = ev?.offsetX ?? ev?.zrX;
      const y = ev?.offsetY ?? ev?.zrY;
      if (typeof x === 'number' && typeof y === 'number') {
        mouseDownZrPos.current = { x, y };
      } else {
        mouseDownZrPos.current = null;
      }
    };
    const onUp = () => {
      mouseDownZrPos.current = null;
    };

    zr.on('mousedown', onDown);
    zr.on('mouseup', onUp);
    zr.on('globalout', onUp);
    return () => {
      try {
        zr.off('mousedown', onDown);
        zr.off('mouseup', onUp);
        zr.off('globalout', onUp);
      } catch {
        // ignore
      }
    };
  }, [isReady, chartKey]);

  const metricDisplay = useMemo(() => {
    if (!isMetricChart) return null;
    const rows = Array.isArray(data) ? data : [];
    const valueField = (config.yFields && config.yFields[0]) || '';
    const decimals =
      typeof config.metric_decimals === 'number' ? config.metric_decimals : 2;
    const expr = parseMetricFilterExpr(config.metric_filter_expr);
    const rules = getEffectiveMetricFilterRules({
      metric_filters: config.metric_filters,
      metric_mode: config.metric_mode,
      metric_filter_field: config.metric_filter_field,
      metric_filter_value: config.metric_filter_value,
    });
    const filtered = expr
      ? applyMetricFiltersExpr(rows as Record<string, unknown>[], expr)
      : rules.length > 0
        ? applyMetricFilters(rows as Record<string, unknown>[], rules)
        : rows;
    const raw = computeMetricValue(filtered, valueField, (config.y_agg_method as string) || 'sum');
    return {
      text: formatMetricNumber(raw, decimals),
      unit: (config.metric_unit || '').trim(),
      label: (config.metric_label || '').trim() || (config.title || '').trim(),
    };
  }, [
    isMetricChart,
    data,
    config.yFields,
    config.y_agg_method,
    config.metric_filters,
    config.metric_filter_expr,
    config.metric_mode,
    config.metric_filter_field,
    config.metric_filter_value,
    config.metric_unit,
    config.metric_decimals,
    config.metric_label,
    config.title,
  ]);

  if (isMetricChart) {
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: resolvedMinHeight,
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
        data-chart-container="true"
      >
        <div
          style={{
            width: '100%',
            maxWidth: '100%',
            border: '1px solid #e8e8e8',
            borderRadius: 8,
            background: '#fff',
            padding: 'clamp(12px, 4%, 24px)',
            boxSizing: 'border-box',
          }}
        >
          {metricDisplay ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 'clamp(22px, 5vw, 32px)',
                    fontWeight: 700,
                    color: '#2f54eb',
                    lineHeight: 1.2,
                  }}
                >
                  {metricDisplay.text}
                </span>
                {metricDisplay.unit ? (
                  <span style={{ fontSize: 14, color: '#2f54eb', fontWeight: 500 }}>
                    {metricDisplay.unit}
                  </span>
                ) : null}
              </div>
              {metricDisplay.label ? (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 13,
                    color: '#597ef7',
                    textAlign: 'center',
                    lineHeight: 1.4,
                  }}
                >
                  {metricDisplay.label}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: resolvedMinHeight, ...style }}
      data-chart-container="true"
    >
      {isReady && containerSize.width > 0 && containerSize.height > 0 ? (
        <ReactECharts
          key={chartKey}
          ref={chartRef}
          option={option}
          // Ensure stale series are not kept when series count shrinks (e.g. changing selected yFields).
          // With `notMerge=false`, ECharts may retain old series beyond the new series array length.
          notMerge={true}
          lazyUpdate={false}
          style={{ height: '100%', width: '100%' }}
          onEvents={mergedEvents}
        />
      ) : null}
    </div>
  );
};