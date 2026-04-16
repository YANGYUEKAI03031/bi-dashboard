import React, { useEffect, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Card, Spin, Empty, message, Typography, Button, Modal, Form, Input, Select, Dropdown, MenuProps, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { DashboardService } from '../services/dashboardService';
import { ChartService } from '../services/chartService';
import { ChartFactory } from '../components/charts/ChartFactory';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import './ReportsPage.css';
import { useNavigate, useParams } from 'react-router-dom';
import { EditOutlined, PlusOutlined, MoreOutlined, DeleteOutlined } from '@ant-design/icons';
import { ReportPageService, ReportPage, ReportPageDashboard } from '../services/reportPageService';

const { Title, Paragraph } = Typography;
const { Option } = Select;

interface Chart {
  id: number;
  name: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  data_source_id: number;
  created_by: number;
}

interface DashboardCard {
  id: number;
  chart_id: number;
  card_row: number;
  card_col: number;
  size_x: number;
  size_y: number;
  chart?: Chart;
}

interface Dashboard {
  id: number;
  name: string;
  description: string;
  cards?: DashboardCard[]; // 可选，因为新创建的仪表盘可能没有 cards
  settings?: any;
  tags?: string[] | string; // 支持数组或字符串格式
  filters?: DashboardFilter[];
}

interface DashboardFilter {
  id: number;
  dashboard_id: number;
  dashboard_tab_id?: number;
  name: string;
  filter_type: 'date_range' | 'date_relative' | 'select' | 'multi_select' | 'input';
  field_name: string;
  field_label?: string;
  data_source_id?: number;
  options_table?: string;
  options_field?: string;
  options_sql?: string;
  default_value?: any;
  position: number;
  bindings: DashboardFilterBinding[];
}

interface DashboardFilterBinding {
  id: number;
  filter_id: number;
  card_id: number;
  param_name: string;
}

type ChartResponse = Awaited<ReturnType<typeof ChartService.getUserCharts>>[0];

const convertChartResponseToChart = (chartResponse: ChartResponse): Chart => {
  return {
    id: chartResponse.id,
    name: chartResponse.name,
    chart_type: chartResponse.chart_type,
    dataset_query: chartResponse.dataset_query,
    visualization_settings: chartResponse.visualization_settings,
    data_source_id: chartResponse.database_id,
    created_by: chartResponse.creator_id,
  };
};

const hydrateDashboardCards = (d: Dashboard, latestCharts: Chart[]): Dashboard => {
  if (!d?.cards || d.cards.length === 0) return d;
  const chartMap = new Map<number, Chart>(latestCharts.map(c => [c.id, c]));

  const nextCards = d.cards.map(card => {
    if (card.chart) return card;
    const hydrated = chartMap.get(card.chart_id);
    return hydrated ? { ...card, chart: hydrated } : card;
  });

  const changed = nextCards.some((c, idx) => c !== d.cards[idx]);
  return changed ? { ...d, cards: nextCards } : d;
};

const AutoWidthGridLayout: React.FC<any> = (props) => {
  const { width, containerRef, mounted } = useContainerWidth();

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {mounted && width > 0 && (
        <ReactGridLayout width={width} {...props} />
      )}
    </div>
  );
};

// 图表卡片组件（只读模式）—— 与 DashboardEditorPage 保持一致
const ChartCardComponent: React.FC<{ 
  card: DashboardCard; 
  filterValues?: Record<string, any>; 
  allFilters?: DashboardFilter[];
  chartData?: any[];      // 外部传入的数据（批量查询时使用）
  dataLoading?: boolean;   // 外部传入的加载状态
  error?: string | null;  // 外部传入的错误信息
  /** 全局图表联动筛选值 */
  chartLinkValue?: any;
  /** 联动筛选字段（按同名列筛选时仅来源图高亮，其他图不按 x 轴变暗） */
  chartLinkField?: string | null;
  /** 当前联动值来自哪个图表（该图表本身不做数据过滤，只做高亮） */
  chartLinkSourceChartId?: number | null;
  /** 点击 X 轴时回调（value, fieldName 用于按同名列联动） */
  onChartXAxisClick?: (value: any, fieldName?: string) => void;
}> = ({ card, filterValues = {}, allFilters = [], chartData: externalData, dataLoading: externalLoading, error: externalError, chartLinkValue, chartLinkField, chartLinkSourceChartId, onChartXAxisClick }) => {
  const [internalChartData, setChartData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 如果外部传入了数据，直接使用（批量查询模式）
  useEffect(() => {
    if (externalData !== undefined) {
      setChartData(externalData);
      setError(externalError || null);
      setDataLoading(externalLoading || false);
      return;
    }
    // 否则自己加载（兼容模式）
    if (!card.chart?.id) {
      setError('图表数据缺失');
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setDataLoading(true);
      setError(null);
      try {
        const isMetricChart = (card.chart?.chart_type || '').toLowerCase() === 'metric';
        const filteredFilterValues: Record<string, any> = {};

        if (!isMetricChart) {
          allFilters.forEach(filter => {
            const filterValue = filterValues[filter.id];
            if (filterValue === undefined || filterValue === null) return;
            if (filterValue === '') return;
            if (Array.isArray(filterValue) && filterValue.length === 0) return;

            const paramKey = `${filter.id}_${filter.field_name}`;
            filteredFilterValues[paramKey] = filterValue;
          });
        }

        const data = await ChartService.executeChartQuery(card.chart!.id, filteredFilterValues);

        if (cancelled) return;

        if (!Array.isArray(data)) {
          throw new Error('返回的数据格式不正确');
        }

        if (data.length === 0) {
          setError('没有查询到数据');
          setChartData([]);
          return;
        }

        const xField = card.chart!.visualization_settings?.x_field || '';
        if (xField && data.length > 0 && !Object.keys(data[0] || {}).includes(xField)) {
          console.warn(`X轴字段 '${xField}' 在数据中不存在`);
        }

        setChartData(data);
      } catch (err: any) {
        if (cancelled) return;
        console.error(`加载图表数据失败:`, err);
        setError(err.message || '数据加载失败');
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- card.chart 用于条件判断
  }, [card.chart?.id, filterValues, allFilters, externalData, externalLoading, externalError]);

  // 使用外部或内部数据
  const displayData = externalData !== undefined ? externalData : internalChartData;
  
  const displayLoading = externalData !== undefined ? (externalLoading || false) : dataLoading;
  const displayError = externalData !== undefined ? externalError : error;

  if (!card.chart) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ff4d4f',
          fontSize: 12,
        }}
      >
        图表数据缺失
      </div>
    );
  }

  let viz: any = card.chart.visualization_settings || {};
  if (typeof viz === 'string') {
    try {
      viz = JSON.parse(viz);
    } catch (e) {
      viz = {};
    }
  }

  const sortBy = viz.sort_by ?? viz['graph.sort_by'] ?? undefined;
  const sortOrder = viz.sort_order ?? viz['graph.sort_order'] ?? undefined;
  const xField = viz.x_field ?? (Array.isArray(viz.graph_dimensions) ? viz.graph_dimensions[0] : undefined);
  const yFields = viz.y_fields ?? (Array.isArray(viz.graph_metrics) ? viz.graph_metrics : undefined);

  // 联动改为"仅高亮、不变更数据"：所有图表始终用全量数据，由 ChartFactory 根据 selectedXValue 做高亮/变暗
  const chartDataForDisplay = displayData;

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {displayLoading ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Spin tip="加载数据中..." />
        </div>
      ) : displayError ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#ff4d4f',
          }}
        >
          <div style={{ marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 12, textAlign: 'center' }}>{displayError}</div>
        </div>
      ) : displayData.length === 0 ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#888',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>📊</div>
            <div>暂无数据</div>
          </div>
        </div>
      ) : (
        <ChartFactory
          config={{
            type: card.chart.chart_type,
            title: '',
            xAxis: {
              name: viz.x_axis_title || 'X轴',
            },
            yAxis: {
              name: viz.y_axis_title || 'Y轴',
            },
            series:
              (yFields || []).map((field: string) => ({
                name: field,
                field: field,
              })) || [],
            xField,
            yFields,
            colorField: viz.color_field,
            // 报表视图中同样支持 Y 轴聚合方式
            y_agg_method:
              viz.y_agg_method ??
              viz['graph.y_agg_method'] ??
              undefined,
            // X 轴聚合开关：明细型图表（散点图）默认不聚合，其它默认聚合
            x_group_by_enabled:
              typeof (viz as any).x_group_by_enabled === 'boolean'
                ? (viz as any).x_group_by_enabled
                : (card.chart!.chart_type || '').toLowerCase() !== 'scatter',
            sort_by: sortBy,
            sort_order: sortOrder,
            line_y_fields: viz.line_y_fields,
            y_axis_right_title: viz.y_axis_right_title,
            metric_mode: viz.metric_mode === 'cell' ? 'cell' : 'aggregate',
            metric_filter_field:
              viz.metric_filter_field != null ? String(viz.metric_filter_field) : '',
            metric_filter_value:
              viz.metric_filter_value != null ? String(viz.metric_filter_value) : '',
            metric_unit: viz.metric_unit != null ? String(viz.metric_unit) : '',
            metric_decimals:
              typeof viz.metric_decimals === 'number' ? viz.metric_decimals : 2,
            metric_label: viz.metric_label != null ? String(viz.metric_label) : '',
            metric_filters: Array.isArray(viz.metric_filters) ? viz.metric_filters : [],
            metric_filter_expr: viz.metric_filter_expr,
            legend: {
              show: viz.show_legend !== false,
              bottom: 10,
            },
            tooltip: {
              show: viz.show_tooltip !== false,
              trigger: 'axis',
            },
            // 报表页同样不再透传 grid_padding，保持与 ChartFactory 的统一居中布局。
          }}
          data={chartDataForDisplay}
          style={{ height: '100%', width: '100%' }}
          onXAxisClick={onChartXAxisClick}
          selectedXValue={chartLinkSourceChartId === card.chart?.id ? chartLinkValue : (chartLinkField == null ? chartLinkValue : undefined)}
        />
      )}
    </div>
  );
};

// 仪表盘视图组件 —— 筛选逻辑与 DashboardEditorPage 完全对齐
const DashboardView: React.FC<{
  dashboard: Dashboard;
  filterValues?: Record<number, any>;
  onFilterChange?: (values: Record<number, any>) => void;
  batchChartData?: Map<number, { data: any[]; loading: boolean; error: string | null }>;
  /** 全局图表联动筛选值 */
  chartLinkValue?: any;
  /** 联动筛选字段（按数据表同名列筛选） */
  chartLinkField?: string | null;
  /** 图表 X 轴点击回调 */
  onChartXAxisClick?: (chartId: number | null, value: any, fieldName?: string) => void;
  /** 当前联动值来自哪个图表（该图表本身不做数据过滤，只做高亮） */
  chartLinkSourceChartId?: number | null;
  /** 清除图表联动筛选回调 */
  onClearChartLink?: () => void;
}> = ({ dashboard, filterValues = {}, onFilterChange, batchChartData, chartLinkValue, chartLinkField, onChartXAxisClick, chartLinkSourceChartId, onClearChartLink }) => {
  const widgets = (dashboard?.settings as any)?.widgets || [];
  const cards = dashboard.cards || [];
  const filters = dashboard.filters || [];

  const normalizeLinkValue = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) return s.slice(0, 10);
    return s;
  };

  const [filterSelectOptions, setFilterSelectOptions] = useState<Record<number, { label: string; value: string }[]>>({});
  const [filterOptionsLoading, setFilterOptionsLoading] = useState<Record<number, boolean>>({});
  const [filterOptionsCache, setFilterOptionsCache] = useState<Record<number, string[]>>({});

  // 初始加载：筛选器列表变化时，加载 select/multi_select 的选项
  useEffect(() => {
    filters.forEach(filter => {
      if (filter.filter_type === 'select' || filter.filter_type === 'multi_select') {
        if (!filterSelectOptions[filter.id]) {
          loadFilterOptions(filter, undefined);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // 级联联动：任一筛选器值变化时，重新加载其他 select/multi_select 的选项
  const prevFilterValuesRef = useRef<Record<number, any>>({});
  useEffect(() => {
    const prev = prevFilterValuesRef.current;
    const allKeys = Array.from(new Set([...Object.keys(prev), ...Object.keys(filterValues)]));
    const hasChanged = allKeys.some(k => (prev as any)[k] !== (filterValues as any)[k]);
    if (!hasChanged) return;
    prevFilterValuesRef.current = filterValues;

    filters.forEach(filter => {
      if (filter.filter_type !== 'select' && filter.filter_type !== 'multi_select') return;
      const cascadeConditions: Record<string, any> = {};
      filters.forEach(f => {
        if (f.id === filter.id) return;
        const val = filterValues[f.id];
        if (val === undefined || val === null || val === '') return;
        if (Array.isArray(val) && val.length === 0) return;
        cascadeConditions[`${f.id}_${f.field_name}`] = val;
      });
      loadFilterOptions(filter, Object.keys(cascadeConditions).length > 0 ? cascadeConditions : undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterValues]);

  /**
   * 加载筛选器下拉选项，支持级联条件
   * ① 显式配置数据源/表/字段 → 直接查询
   * ② 有绑定图表 → 从绑定图表推断
   * ③ 无绑定 → 遍历所有仪表盘图表找第一个能返回选项的
   */
  const loadFilterOptions = async (
    filter: DashboardFilter,
    filterConditions: Record<string, any> | undefined,
  ) => {
    const hasCascade = filterConditions && Object.keys(filterConditions).length > 0;

    // 命中缓存时仍需刷新 UI（防止级联缩小的选项残留）
    if (!hasCascade && filterOptionsCache[filter.id]) {
      const cached = filterOptionsCache[filter.id];
      setFilterSelectOptions(prev => ({
        ...prev,
        [filter.id]: cached.map((opt: string) => ({ label: String(opt), value: String(opt) })),
      }));
      return cached;
    }

    setFilterOptionsLoading(prev => ({ ...prev, [filter.id]: true }));

    try {
      let options: string[] = [];

      if (filter.data_source_id && filter.options_table && (filter.options_field || filter.field_name)) {
        // ① 显式配置
        const optField = filter.options_field || filter.field_name;
        options = await ChartService.getFilterOptions(
          filter.data_source_id,
          filter.options_table,
          optField,
          undefined,
          filterConditions,
        );
      } else {
        // ② 从绑定图表推断
        const firstBinding = filter.bindings?.[0];
        const boundCard = firstBinding ? cards.find(c => c.id === firstBinding.card_id) : undefined;
        let chartId = boundCard?.chart?.id ?? boundCard?.chart_id;

        // ③ 无绑定 → 遍历所有图表
        if (!chartId && filter.field_name && cards.length > 0) {
          for (const dashCard of cards) {
            const candidateId = dashCard.chart?.id ?? dashCard.chart_id;
            if (!candidateId) continue;
            try {
              const result = await ChartService.getFilterOptionsFromChart(
                candidateId, filter.field_name, undefined, filterConditions,
              );
              if (result.options && result.options.length > 0) {
                options = result.options;
                break;
              }
            } catch { continue; }
          }
        } else if (chartId && filter.field_name) {
          try {
            const result = await ChartService.getFilterOptionsFromChart(
              chartId, filter.field_name, undefined, filterConditions,
            );
            options = result.options || [];
          } catch (e) {
            console.error('[Report] 获取筛选器选项失败:', e);
          }
        }
      }

      if (!hasCascade) {
        setFilterOptionsCache(prev => ({ ...prev, [filter.id]: options }));
      }
      setFilterSelectOptions(prev => ({
        ...prev,
        [filter.id]: options.map((opt: string) => ({ label: String(opt), value: String(opt) })),
      }));
      return options;
    } catch (error) {
      console.error('[Report] 加载筛选器选项失败:', error);
      return [];
    } finally {
      setFilterOptionsLoading(prev => ({ ...prev, [filter.id]: false }));
    }
  };

  // 构建 mergedLayout：widgets 的标题 + cards 的图表，使用 card 位置信息
  const mergedLayout = [
    ...cards.map(card => ({
      i: card.id.toString(),
      x: Number.isFinite(card.card_col) ? (card.card_col as number) : 0,
      y: Number.isFinite(card.card_row) ? (card.card_row as number) : 0,
      w: Number.isFinite(card.size_x) ? card.size_x : 6,
      h: Number.isFinite(card.size_y) ? card.size_y : 4,
      static: true,
    })),
    ...widgets
      .filter((w: any) => w && w.type === 'title')
      .map(w => ({
        i: w.id,
        x: Number.isFinite(w.card_col) ? (w.card_col as number) : 0,
        y: Number.isFinite(w.card_row) ? (w.card_row as number) : 0,
        w: Number.isFinite(w.size_x) ? w.size_x : 12,
        h: Number.isFinite(w.size_y) ? w.size_y : 2,
        static: true,
      })),
  ];

  return (
    <div className="reports-dashboard-view">
      {/* 筛选器渲染区域 */}
      {filters.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            {filters.map(filter => {
              // 统一用 filter.id 作 key，与 DashboardEditorPage 一致
              const handleFilterChange = (value: any) => {
                onFilterChange?.({ ...filterValues, [filter.id]: value });
              };
              const currentVal = filterValues[filter.id];

              return (
                <div key={filter.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#666' }}>
                    {filter.field_label || filter.name}
                  </label>
                  {filter.filter_type === 'date_range' && (
                    <DatePicker.RangePicker
                      style={{ width: 240 }}
                      value={currentVal ? [
                        currentVal.start ? dayjs(currentVal.start) : null,
                        currentVal.end ? dayjs(currentVal.end) : null,
                      ] : null}
                      onChange={(dates) => {
                        if (dates) {
                          handleFilterChange({
                            start: dates[0]?.format('YYYY-MM-DD'),
                            end: dates[1]?.format('YYYY-MM-DD'),
                          });
                        } else {
                          handleFilterChange(null);
                        }
                      }}
                      presets={[
                        { label: '今日', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
                        { label: '昨日', value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] },
                        { label: '近7天', value: [dayjs().subtract(6, 'day'), dayjs()] },
                        { label: '近30天', value: [dayjs().subtract(29, 'day'), dayjs()] },
                        { label: '本月', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                        { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
                        { label: '本年', value: [dayjs().startOf('year'), dayjs().endOf('year')] },
                        { label: '去年', value: [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')] },
                      ]}
                    />
                  )}
                  {filter.filter_type === 'date_relative' && (
                    <Select
                      style={{ width: 150 }}
                      placeholder="选择时间范围"
                      allowClear
                      value={currentVal}
                      options={[
                        { label: '今天', value: 'today' },
                        { label: '昨天', value: 'yesterday' },
                        { label: '最近7天', value: 'last_7_days' },
                        { label: '最近30天', value: 'last_30_days' },
                        { label: '本月', value: 'this_month' },
                        { label: '上月', value: 'last_month' },
                      ]}
                      onChange={handleFilterChange}
                    />
                  )}
                  {filter.filter_type === 'select' && (
                    <Select
                      style={{ width: 150 }}
                      placeholder="请选择"
                      allowClear
                      options={filterSelectOptions[filter.id] || []}
                      loading={filterOptionsLoading[filter.id]}
                      value={currentVal}
                      onChange={handleFilterChange}
                    />
                  )}
                  {filter.filter_type === 'multi_select' && (
                    <Select
                      style={{ width: 150 }}
                      mode="multiple"
                      placeholder="请选择"
                      allowClear
                      options={filterSelectOptions[filter.id] || []}
                      loading={filterOptionsLoading[filter.id]}
                      value={currentVal}
                      onChange={handleFilterChange}
                    />
                  )}
                  {filter.filter_type === 'input' && (
                    <Input
                      style={{ width: 150 }}
                      placeholder="请输入"
                      value={currentVal}
                      onChange={(e) => handleFilterChange(e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 标题组件和图表网格布局 - 与 DashboardEditorPage 保持一致 */}
      {widgets.length > 0 || cards.length > 0 ? (
        <AutoWidthGridLayout
          cols={12}
          rowHeight={80}
          margin={[16, 16]}
          isDraggable={false}
          isResizable={false}
          compactType={null}
          preventCollision={true}
          layout={mergedLayout}
        >
          {widgets
            .filter((w: any) => w && w.type === 'title')
            .map((w: any) => (
              <div key={w.id}>
                <Card
                  size="small"
                  style={{ height: '100%' }}
                  bodyStyle={{ height: '100%' }}
                >
                  <div style={{ textAlign: w.align }}>
                    <Title level={w.level || 1} style={{ margin: 0 }}>
                      {w.title}
                    </Title>
                    {w.subtitle && (
                      <Paragraph style={{ marginTop: 8, marginBottom: 0, color: '#666' }}>
                        {w.subtitle}
                      </Paragraph>
                    )}
                  </div>
                </Card>
              </div>
            ))}
          {cards.map(card => (
            <div key={card.id.toString()}>
              <Card
                size="small"
                title={
                  <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <span>{card.chart?.name || `图表 #${card.chart_id}`}</span>
                  </div>
                }
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                bodyStyle={{
                  flex: 1,
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'stretch',
                }}
              >
                <ChartCardComponent 
                  card={card} 
                  filterValues={filterValues} 
                  allFilters={filters}
                  chartData={card.chart?.id ? (() => {
                    const rawData = batchChartData?.get(card.chart!.id)?.data || [];
                    if (!chartLinkField || chartLinkValue == null || rawData.length === 0) return rawData;
                    const first = rawData[0];
                    if (!first || typeof first !== 'object' || !Object.prototype.hasOwnProperty.call(first, chartLinkField)) return rawData;
                    return rawData.filter((row: any) => normalizeLinkValue(row[chartLinkField]) === chartLinkValue);
                  })() : undefined}
                  dataLoading={card.chart?.id ? batchChartData?.get(card.chart.id)?.loading : false}
                  error={card.chart?.id ? batchChartData?.get(card.chart.id)?.error : null}
                  chartLinkValue={chartLinkValue}
                  chartLinkField={chartLinkField}
                  chartLinkSourceChartId={chartLinkSourceChartId}
                  onChartXAxisClick={(value, fieldName) => onChartXAxisClick?.(card.chart?.id ?? null, value, fieldName)}
                />
              </Card>
            </div>
          ))}
        </AutoWidthGridLayout>
      ) : (
        <Empty
          description="该仪表盘暂无图表"
          style={{ marginTop: 40 }}
        />
      )}
    </div>
  );
};

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pageId } = useParams<{ pageId?: string }>();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [dashboardDetails, setDashboardDetails] = useState<Map<number, Dashboard>>(new Map());
  const [loadingDashboard, setLoadingDashboard] = useState<Set<number>>(new Set());
  const [charts, setCharts] = useState<Chart[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [reportPage, setReportPage] = useState<ReportPage | null>(null);
  const [reportPageDashboards, setReportPageDashboards] = useState<ReportPageDashboard[]>([]);
  const [loadingReportPage, setLoadingReportPage] = useState(false);
  const [addDashboardModalVisible, setAddDashboardModalVisible] = useState(false);
  const [addDashboardForm] = Form.useForm();
  const [availableDashboardsForAdd, setAvailableDashboardsForAdd] = useState<Dashboard[]>([]);
  const [addingDashboard, setAddingDashboard] = useState(false);
// 当前仪表盘的筛选器值（key 为 filter.id）
  const [filterValues, setFilterValues] = useState<Record<number, any>>({});
  // 图表联动筛选值（全局选中的值）
  const [chartLinkValue, setChartLinkValue] = useState<any>(null);
  // 图表联动筛选字段（与筛选器一致：按数据表同名列筛选）
  const [chartLinkField, setChartLinkField] = useState<string | null>(null);
  // 图表联动来源（哪个图触发的点击）
  const [chartLinkSourceChartId, setChartLinkSourceChartId] = useState<number | null>(null);
  // 批量图表数据（chartId -> 数据）
  const [batchChartData, setBatchChartData] = useState<Map<number, { data: any[]; loading: boolean; error: string | null }>>(new Map());

  // 处理筛选器变化
  const handleFilterChange = (newValues: Record<number, any>) => {
    setFilterValues(newValues);
    const currentDashboard = activeDashboardId ? dashboardDetails.get(activeDashboardId) : null;
    if (currentDashboard && currentDashboard.cards && currentDashboard.cards.length > 0) {
      const linkFilter = chartLinkField && chartLinkValue != null && chartLinkValue !== ''
        ? { field: chartLinkField, value: String(chartLinkValue) }
        : null;
      loadBatchChartData(currentDashboard.cards, currentDashboard.filters || [], newValues, linkFilter, activeDashboardId ?? null);
    }
  };

  const normalizeLinkValue = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) return s.slice(0, 10);
    return s;
  };

  // 图表联动（像筛选器一样）：点击只会"设置/更新筛选值"，不会因为同值再次触发而自动取消
  // 取消筛选通过：点击页面空白处 / 点击清除按钮
  const handleChartLinkClick = (chartId: number | null, value: any, fieldName?: string) => {
    const nextVal = value == null ? null : normalizeLinkValue(value);
    if (nextVal == null) {
      if (process.env.NODE_ENV === 'development') console.log('[ReportsPage] clear chartLink (click same or null)');
      flushSync(() => {
        setChartLinkValue(null);
        setChartLinkField(null);
        setChartLinkSourceChartId(null);
      });
      return;
    }
    if (process.env.NODE_ENV === 'development') {
      const currentDashboard = activeDashboardId ? dashboardDetails.get(activeDashboardId) : null;
      console.log('[ReportsPage] ========== 图表联动触发 ==========');
      console.log('[ReportsPage] 来源图表ID:', chartId, '选中的值:', nextVal, '字段名:', fieldName);
      console.log('[ReportsPage] 当前仪表盘所有图表ID:', currentDashboard?.cards?.map(c => ({ cardId: c.id, chartId: c.chart?.id, chartName: c.chart?.name })));
    }
    setChartLinkValue(nextVal);
    setChartLinkField(fieldName ?? null);
    setChartLinkSourceChartId(chartId ?? null);
  };

  // 点击页面"非图表区域"时清除联动筛选（符合"点其它地方取消"，避免 hover/误触取消）
  useEffect(() => {
    if (chartLinkValue == null) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const inChart = !!target?.closest?.('[data-chart-container="true"]');
      if (!inChart) {
        if (process.env.NODE_ENV === 'development') console.log('[ReportsPage] clear chartLink (click outside)');
        flushSync(() => {
          setChartLinkValue(null);
          setChartLinkField(null);
          setChartLinkSourceChartId(null);
        });
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [chartLinkValue]);

  // 批量加载所有图表数据（linkFilter 与筛选器一致：按同名字段在 SQL 中加 WHERE 条件）
  const loadBatchChartData = useCallback(async (
    cards: DashboardCard[],
    filters: DashboardFilter[],
    currentFilterValues: Record<number, any>,
    linkFilter?: { field: string; value: string } | null,
    dashboardId?: number | null,
  ) => {
    if (!cards || cards.length === 0) return;

    const requestKey = JSON.stringify({
      dashboardId: dashboardId ?? null,
      cardIds: cards.map(c => c.chart?.id).filter(Boolean).sort(),
      filterValues: currentFilterValues,
      linkFilter: linkFilter ?? null,
    });

    if ((loadBatchChartData as any).lastRequestKey === requestKey) {
      return;
    }
    (loadBatchChartData as any).lastRequestKey = requestKey;

    const requests: { chartId: number; filterParams: Record<string, any> }[] = [];

    cards.forEach(card => {
      if (!card.chart?.id) return;

      const isMetricChart = (card.chart?.chart_type || '').toLowerCase() === 'metric';
      const filteredFilterValues: Record<string, any> = {};
      if (!isMetricChart) {
        filters.forEach(filter => {
          const filterValue = currentFilterValues[filter.id];
          if (filterValue === undefined || filterValue === null) return;
          if (filterValue === '') return;
          if (Array.isArray(filterValue) && filterValue.length === 0) return;
          const paramKey = `${filter.id}_${filter.field_name}`;
          filteredFilterValues[paramKey] = filterValue;
        });
        // 图表联动：按同名列在 SQL 中筛选（指标图不参与）
        if (linkFilter?.field && linkFilter?.value != null && linkFilter.value !== '') {
          filteredFilterValues[linkFilter.field] = linkFilter.value;
        }
      }

      requests.push({ chartId: card.chart.id, filterParams: filteredFilterValues });
    });
    
    if (requests.length === 0) return;
    
    // 设置所有图表为 loading 状态
    const loadingMap = new Map(batchChartData);
    requests.forEach(req => {
      loadingMap.set(req.chartId, { data: [], loading: true, error: null });
    });
    setBatchChartData(loadingMap);
    
    try {
      // 批量查询
      const results = await ChartService.executeBatchChartQuery(requests);
      
      // 更新数据
      const newDataMap = new Map(batchChartData);
      results.forEach(result => {
        newDataMap.set(result.chartId, {
          data: result.data || [],
          loading: false,
          error: result.error || null,
        });
      });
      setBatchChartData(newDataMap);
    } catch (err: any) {
      console.error('批量加载图表数据失败:', err);
      // 设置错误状态
      const errorMap = new Map(batchChartData);
      requests.forEach(req => {
        errorMap.set(req.chartId, { data: [], loading: false, error: err.message || '加载失败' });
      });
      setBatchChartData(errorMap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 内部使用 ref 和稳定的回调
  }, []);

  // 图表联动变化时按「同名列」重新请求后端数据（与筛选器一致，在 SQL 中加 WHERE）
  const currentDashboardForLink = activeDashboardId ? dashboardDetails.get(activeDashboardId) : null;
  useEffect(() => {
    if (!currentDashboardForLink?.cards?.length) return;
    const linkFilter = chartLinkField && chartLinkValue != null && chartLinkValue !== ''
      ? { field: chartLinkField, value: String(chartLinkValue) }
      : null;
    loadBatchChartData(
      currentDashboardForLink.cards,
      currentDashboardForLink.filters || [],
      filterValues,
      linkFilter,
      activeDashboardId ?? null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartLinkValue, chartLinkField]);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // 如果 URL 中有 pageId，加载对应的报表页
        if (pageId) {
          setLoadingReportPage(true);
          // 切换报表页时清空图表数据与仪表盘缓存，避免沿用上一报表的数据导致「暂无数据」
          setBatchChartData(new Map());
          setDashboardDetails(new Map());
          // 清除批量请求去重 key，否则同一仪表盘在不同报表下会被误判为重复请求而不拉数
          (loadBatchChartData as any).lastRequestKey = undefined;

          try {
            const page = await ReportPageService.getReportPage(Number(pageId));
            setReportPage(page);
            
            // 保存报表页仪表盘关联信息（包含 rpdId）
            const sortedRpd = page.dashboards.sort((a, b) => a.order_index - b.order_index);
            setReportPageDashboards(sortedRpd);
            
            // 加载报表页关联的仪表盘
            const pageDashboards = sortedRpd
              .map(rpd => rpd.dashboard)
              .filter((d): d is Dashboard => d !== null && d !== undefined);
            
            setDashboards(pageDashboards);
            
            // 加载可用图表列表
            const userCharts = await ChartService.getUserCharts();
            const convertedCharts = userCharts.map(convertChartResponseToChart);
            setCharts(convertedCharts);
            
            // 如果有仪表盘，默认选中第一个并强制拉取其图表数据（切换报表页后必须重新拉数）
            if (pageDashboards.length > 0) {
              const firstDashboardId = pageDashboards[0].id;
              setActiveDashboardId(firstDashboardId);
              await loadDashboardDetails(firstDashboardId, convertedCharts, true);
            }
          } catch (error: any) {
            message.error(error?.message || '加载报表页失败');
            // 如果加载失败，回退到默认行为
            await loadDefaultDashboards();
          } finally {
            setLoadingReportPage(false);
          }
        } else {
          // 没有 pageId，加载所有仪表盘（原有逻辑）
          await loadDefaultDashboards();
        }
      } catch (error: any) {
        message.error(error?.message || '加载数据失败');
      } finally {
        setLoading(false);
      }
    };

    const loadDefaultDashboards = async () => {
      // 加载仪表盘列表
      const userDashboards = await DashboardService.getUserDashboards();
      setDashboards(userDashboards);

      // 加载可用图表列表
      const userCharts = await ChartService.getUserCharts();
      const convertedCharts = userCharts.map(convertChartResponseToChart);
      setCharts(convertedCharts);

      // 如果有仪表盘，默认选中第一个
      if (userDashboards.length > 0) {
        const firstDashboardId = userDashboards[0].id;
        setActiveDashboardId(firstDashboardId);
        await loadDashboardDetails(firstDashboardId, convertedCharts);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadBatchChartData 和 loadDashboardDetails 内部使用稳定的回调
  }, [user, pageId]);

  const loadDashboardDetails = async (dashboardId: number, availableCharts: Chart[], forceRefreshCharts?: boolean) => {
    // 若已加载过且非强制刷新图表，直接返回（切换报表页时上层会先清空缓存再调用，此处 forceRefreshCharts 可不用传）
    if (dashboardDetails.has(dashboardId) && !forceRefreshCharts) {
      return;
    }

    setLoadingDashboard(prev => new Set(prev).add(dashboardId));

    try {
      const dashboard = await DashboardService.getDashboard(dashboardId);
      const hydratedDashboard = hydrateDashboardCards(dashboard, availableCharts);
      const filters = await DashboardService.getDashboardFilters(dashboardId);
      hydratedDashboard.filters = filters;
      setDashboardDetails(prev => new Map(prev).set(dashboardId, hydratedDashboard));

      if (hydratedDashboard.cards && hydratedDashboard.cards.length > 0) {
        const linkFilter = chartLinkField && chartLinkValue != null && chartLinkValue !== ''
          ? { field: chartLinkField, value: String(chartLinkValue) }
          : null;
        loadBatchChartData(hydratedDashboard.cards, hydratedDashboard.filters || [], filterValues, linkFilter, dashboardId);
      }
    } catch (error: any) {
      message.error(`加载仪表盘详情失败: ${error?.message || '未知错误'}`);
    } finally {
      setLoadingDashboard(prev => {
        const next = new Set(prev);
        next.delete(dashboardId);
        return next;
      });
    }
  };

  const handleTabChange = async (dashboardId: string) => {
    const id = Number(dashboardId);
    setActiveDashboardId(id);
    setFilterValues({}); // 切换仪表盘时重置筛选状态
    setBatchChartData(new Map()); // 防止不同 tab 的 batch 数据互相覆盖导致"暂无数据"

    (loadBatchChartData as any).lastRequestKey = undefined;
    const dash = dashboardDetails.get(id);
    // 无论是否已加载，每次切换 tab 都重新拉图表数据（避免沿用旧数据）
    if (dash?.cards?.length) {
      const linkFilter = chartLinkField && chartLinkValue != null && chartLinkValue !== ''
        ? { field: chartLinkField, value: String(chartLinkValue) }
        : null;
      loadBatchChartData(dash.cards, dash.filters || [], {}, linkFilter, id);
    } else {
      // 该仪表盘详情尚未加载，先加载再拉图表数据
      await loadDashboardDetails(id, charts);
    }
  };

  const currentDashboard = activeDashboardId ? dashboardDetails.get(activeDashboardId) : null;

  const handleEditCurrentDashboard = () => {
    if (!activeDashboardId) return;
    navigate(`/dashboard/edit/${activeDashboardId}`);
  };

  const handleDashboardCreate = async (newDashboard: Dashboard) => {
    // 刷新仪表盘列表
    try {
      const userDashboards = await DashboardService.getUserDashboards();
      setDashboards(userDashboards);
      
      // 选中新创建的仪表盘
      setActiveDashboardId(newDashboard.id);
      await loadDashboardDetails(newDashboard.id, charts);
    } catch (error: any) {
      message.error(error?.message || '刷新仪表盘列表失败');
    }
  };

  const openAddDashboardModalForReportPage = async () => {
    if (!pageId) return;

    try {
      // 加载所有用户仪表盘，并过滤掉已经在当前报表页中的
      const userDashboards = await DashboardService.getUserDashboards();
      const existingIds = new Set(dashboards.map(d => d.id));
      const candidates = userDashboards.filter(d => !existingIds.has(d.id));

      if (candidates.length === 0) {
        message.info('暂无可添加的仪表盘，请先在仪表盘页面创建。');
        return;
      }

      setAvailableDashboardsForAdd(candidates);
      setAddDashboardModalVisible(true);
    } catch (error: any) {
      console.error('加载可添加的仪表盘失败:', error);
      message.error(error?.message || '加载可添加的仪表盘失败');
    }
  };

  const handleCreateFromTab = () => {
    // 在具体报表页中，+ 号用于"添加仪表盘到当前报表页"
    if (pageId) {
      openAddDashboardModalForReportPage();
    } else {
      // 在 /reports 总览页中，仍然保留"创建新仪表盘"的能力
      setCreateModalVisible(true);
    }
  };

  const handleCreateDashboard = async (values: any) => {
    try {
      if (!values.name || !values.name.trim()) {
        message.error('请输入仪表盘名称');
        return;
      }

      const dashboardData: any = {
        name: values.name.trim(),
        description: values.description ? values.description.trim() : '',
      };


      const newDashboard = await DashboardService.createDashboard(dashboardData);
      message.success('仪表盘创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      await handleDashboardCreate(newDashboard);
    } catch (error: any) {
      console.error('创建仪表盘失败:', error);
      message.error(error.message || '创建仪表盘失败，请检查网络连接和权限');
    }
  };

  const handleAddDashboardToReportPage = async (values: any) => {
    if (!pageId) {
      message.error('当前不在具体报表页中，无法添加仪表盘。');
      return;
    }

    const dashboardId = values.dashboardId;
    if (!dashboardId) {
      message.error('请选择要添加的仪表盘');
      return;
    }

    try {
      setAddingDashboard(true);

      // 计算排序序号：当前已关联仪表盘数量 + 1
      const orderIndex = dashboards.length + 1;

      await ReportPageService.addDashboardToReportPage(Number(pageId), {
        dashboard_id: dashboardId,
        order_index: orderIndex,
      });

      // 在前端状态中追加该仪表盘
      const addedDashboard =
        availableDashboardsForAdd.find(d => d.id === dashboardId) ||
        dashboards.find(d => d.id === dashboardId);

      if (addedDashboard) {
        setDashboards(prev => [...prev, addedDashboard]);
      }

      // 选中新添加的仪表盘，并确保其详情被加载
      setActiveDashboardId(dashboardId);
      if (!dashboardDetails.has(dashboardId)) {
        await loadDashboardDetails(dashboardId, charts);
      }

      // 重新加载报表页以获取最新数据
      const page = await ReportPageService.getReportPage(Number(pageId));
      setReportPage(page);
      
      const sortedRpd = page.dashboards.sort((a, b) => a.order_index - b.order_index);
      setReportPageDashboards(sortedRpd);
      
      const pageDashboards = sortedRpd
        .map(rpd => rpd.dashboard)
        .filter((d): d is Dashboard => d !== null && d !== undefined);
      
      setDashboards(pageDashboards);

      // 选中新添加的仪表盘，并确保其详情被加载
      setActiveDashboardId(dashboardId);
      if (!dashboardDetails.has(dashboardId)) {
        await loadDashboardDetails(dashboardId, charts);
      }

      message.success('已将仪表盘添加到当前报表页');
      setAddDashboardModalVisible(false);
      addDashboardForm.resetFields();
    } catch (error: any) {
      console.error('添加仪表盘到报表页失败:', error);
      message.error(error?.message || '添加仪表盘失败，请稍后重试');
    } finally {
      setAddingDashboard(false);
    }
  };

  const handleRemoveDashboardFromReportPage = async (rpdId: number, dashboardName: string) => {
    if (!pageId) {
      message.error('当前不在具体报表页中，无法移除仪表盘。');
      return;
    }

    Modal.confirm({
      title: '确认移除',
      content: `确定要从当前报表页移除仪表盘"${dashboardName}"吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await ReportPageService.removeDashboardFromReportPage(rpdId);
          
          // 重新加载报表页
          const page = await ReportPageService.getReportPage(Number(pageId));
          setReportPage(page);
          
          const sortedRpd = page.dashboards.sort((a, b) => a.order_index - b.order_index);
          setReportPageDashboards(sortedRpd);
          
          const pageDashboards = sortedRpd
            .map(rpd => rpd.dashboard)
            .filter((d): d is Dashboard => d !== null && d !== undefined);
          
          setDashboards(pageDashboards);
          
          // 如果移除的是当前选中的仪表盘，切换到第一个（如果还有的话）
          if (pageDashboards.length > 0) {
            const firstDashboardId = pageDashboards[0].id;
            setActiveDashboardId(firstDashboardId);
            if (!dashboardDetails.has(firstDashboardId)) {
              await loadDashboardDetails(firstDashboardId, charts);
            }
          } else {
            setActiveDashboardId(null);
          }
          
          message.success('已从报表页移除仪表盘');
        } catch (error: any) {
          console.error('移除仪表盘失败:', error);
          message.error(error?.message || '移除仪表盘失败，请稍后重试');
        }
      },
    });
  };

  return (
    <div className="reports-page-wrapper">
      <div className="reports-page">
        {/* 第一个白色卡片：页面头部 */}
        <Card className="reports-header-card">
          <div className="reports-header-content">
            <div className="reports-header-left">
              <Title level={2} style={{ margin: 0, fontWeight: 600 }}>
                {reportPage ? reportPage.name : '报表中心'}
              </Title>
              <Paragraph style={{ margin: '8px 0 0 0', color: '#666', fontSize: '14px' }}>
                {reportPage ? reportPage.description || '查看报表页中的仪表盘' : '查看和管理您的仪表盘报表'}
              </Paragraph>
            </div>
            <div className="reports-header-right">
              <Button
                type="primary"
                icon={<EditOutlined />}
                disabled={!activeDashboardId}
                onClick={handleEditCurrentDashboard}
              >
                编辑当前仪表盘
              </Button>
            </div>
          </div>
        </Card>

        {/* 第二个白色卡片：仪表盘导航区域 */}
        {!loading && !loadingReportPage && (
          <Card className="reports-dashboard-nav-card">
            <div className="reports-dashboard-nav">
              {dashboards.length > 0 ? (
                <>
                  {dashboards.map((dashboard, index) => {
                    // 找到对应的 ReportPageDashboard 以获取 rpdId
                    const rpd = reportPageDashboards.find(rpd => rpd.dashboard_id === dashboard.id);
                    
                    const menuItems: MenuProps['items'] = pageId ? [
                      {
                        key: 'remove',
                        label: '从报表页移除',
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => {
                          if (rpd) {
                            handleRemoveDashboardFromReportPage(rpd.id, dashboard.name);
                          }
                        },
                      },
                    ] : [];
                    
                    return (
                      <div key={dashboard.id} className="dashboard-nav-tag-wrapper">
                        <button
                          type="button"
                          className={`dashboard-nav-tag ${activeDashboardId === dashboard.id ? 'active' : ''}`}
                          onClick={() => {
                            if (activeDashboardId === dashboard.id) return;
                            handleTabChange(dashboard.id.toString());
                          }}
                          disabled={activeDashboardId === dashboard.id}
                        >
                          {dashboard.name}
                        </button>
                        {pageId && rpd && (
                          <Dropdown
                            menu={{ items: menuItems }}
                            trigger={['click']}
                            placement="bottomRight"
                          >
                            <button
                              className="dashboard-nav-tag-more-btn"
                              onClick={(e) => e.stopPropagation()}
                              title="更多操作"
                            >
                              <MoreOutlined />
                            </button>
                          </Dropdown>
                        )}
                      </div>
                    );
                  })}
                  <button
                    className="dashboard-nav-add-icon-btn"
                    onClick={handleCreateFromTab}
                    title="添加仪表盘"
                  >
                    <PlusOutlined />
                  </button>
                </>
              ) : (
                <>
                  <span className="dashboard-nav-empty-text">暂无仪表盘</span>
                  <button
                    className="dashboard-nav-add-icon-btn"
                    onClick={handleCreateFromTab}
                    title="添加仪表盘"
                  >
                    <PlusOutlined />
                  </button>
                </>
              )}
            </div>
          </Card>
        )}

        {/* 内容区域：仪表盘视图 */}
        {loading || loadingReportPage ? (
          <Card className="reports-content-card">
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size="large" tip="加载中..." />
            </div>
          </Card>
        ) : dashboards.length === 0 ? (
          <Card className="reports-content-card">
            <Empty
              description={reportPage ? "该报表页暂无仪表盘" : "暂无仪表盘，请先在仪表盘页面创建"}
              style={{ padding: '40px 0' }}
            />
          </Card>
        ) : (
          <div className="reports-content-area">
            {currentDashboard ? (
              <Card className="reports-content-card">
                <DashboardView
                  dashboard={currentDashboard}
                  filterValues={filterValues}
                  onFilterChange={handleFilterChange}
                  batchChartData={batchChartData}
                  chartLinkValue={chartLinkValue}
                  chartLinkField={chartLinkField}
                  onChartXAxisClick={handleChartLinkClick}
                  chartLinkSourceChartId={chartLinkSourceChartId}
                  onClearChartLink={() => {
                    if (process.env.NODE_ENV === 'development') console.log('[ReportsPage] clear chartLink (onClearChartLink)');
                    flushSync(() => {
                      setChartLinkValue(null);
                      setChartLinkField(null);
                      setChartLinkSourceChartId(null);
                    });
                  }}
                />
              </Card>
            ) : activeDashboardId && loadingDashboard.has(activeDashboardId) ? (
              <Card className="reports-content-card">
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <Spin tip="加载仪表盘内容..." />
                </div>
              </Card>
            ) : (
              <Card className="reports-content-card">
                <Empty description="加载失败，请刷新重试" />
              </Card>
            )}
          </div>
        )}
      </div>

      {/* 创建仪表盘模态框 */}
      <Modal
        title="创建新仪表盘"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
        }}
        footer={null}
      >
        <Form form={createForm} onFinish={handleCreateDashboard} layout="vertical">
          <Form.Item
            name="name"
            label="仪表盘名称"
            rules={[{ required: true, message: '请输入仪表盘名称' }]}
          >
            <Input placeholder="输入仪表盘名称" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="输入仪表盘描述" rows={3} />
          </Form.Item>

          <Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => {
                setCreateModalVisible(false);
                createForm.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* 向报表页中添加已有仪表盘的模态框（仅在具体报表页中使用） */}
      <Modal
        title="添加仪表盘到当前报表页"
        open={addDashboardModalVisible}
        onCancel={() => {
          setAddDashboardModalVisible(false);
          addDashboardForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={addDashboardForm} onFinish={handleAddDashboardToReportPage} layout="vertical">
          <Form.Item
            name="dashboardId"
            label="选择要添加的仪表盘"
            rules={[{ required: true, message: '请选择要添加的仪表盘' }]}
          >
            <Select
              placeholder="请选择一个仪表盘"
              showSearch
              optionFilterProp="children"
            >
              {availableDashboardsForAdd.map(d => (
                <Option key={d.id} value={d.id}>
                  {d.name}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                onClick={() => {
                  setAddDashboardModalVisible(false);
                  addDashboardForm.resetFields();
                }}
              >
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={addingDashboard}>
                确认添加
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
