// frontend/bi-dashboard/src/pages/VisualizationBuilder.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Select, Input, Table, Tabs, Switch, Divider, InputNumber } from 'antd';
import { SaveOutlined, DatabaseOutlined, PlayCircleOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined, DotChartOutlined, AreaChartOutlined, RadarChartOutlined, FundViewOutlined, ClusterOutlined, FallOutlined, FilterOutlined, RiseOutlined } from '@ant-design/icons';
import { ChartFactory } from '../components/charts/ChartFactory';
import { ChartConfigPanel } from '../components/charts/ChartConfigPanel';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import { DataSourceService } from '../services/dataSourceService';
import { AuthService } from '../services/authService';
import {
  normalizeMetricFilterRules,
  type MetricFilterRule,
  parseMetricFilterExpr,
  metricFilterExprFromLegacyRules,
  defaultMetricFilterExprRoot,
  ensureMetricFilterExprIds,
  collectFieldsFromMetricFilterExpr,
  type MetricFilterExprNode,
  inferMetricFieldTypesFromSampleRows,
  type MetricFieldKind,
} from '../utils/chartMetric';
import { MetricFilterExprEditor } from '../components/charts/MetricFilterExprEditor';

const { Option } = Select;
const { TabPane } = Tabs;

interface ChartData {
  id?: number;
  name: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  table_name?: string;  // 新增：表名字段
  creator_id?: number;
}

interface DataSource {
  id: string;
  name: string;
  type: string;
}

interface TableInfo {
  name: string;
  columns: any[];
}

// 图表类型定义
const CHART_TYPES = [
  { value: 'bar', label: '柱状图', icon: <BarChartOutlined /> },
  { value: 'line', label: '折线图', icon: <LineChartOutlined /> },
  { value: 'area', label: '面积图', icon: <AreaChartOutlined /> },
  { value: 'pie', label: '饼图', icon: <PieChartOutlined /> },
  { value: 'scatter', label: '散点图', icon: <DotChartOutlined /> },
  { value: 'radar', label: '雷达图', icon: <RadarChartOutlined /> },
  { value: 'boxplot', label: '箱线图', icon: <FundViewOutlined /> },
  { value: 'bar_line', label: '柱线组合（双Y轴）', icon: <LineChartOutlined /> },
  { value: 'stacked_bar', label: '堆积柱形图', icon: <ClusterOutlined /> },
  { value: 'waterfall', label: '瀑布图', icon: <FallOutlined /> },
  { value: 'funnel', label: '漏斗图', icon: <FilterOutlined /> },
  { value: 'metric', label: '指标卡', icon: <RiseOutlined /> },
];

export const VisualizationBuilder: React.FC<{ chartId?: string }> = ({ chartId }) => {
  const { user, isAuthenticated, checkAuthStatus } = useAuth();
  const [chartData, setChartData] = useState<ChartData>({
    name: '新图表',
    chart_type: 'bar',
    dataset_query: {
      type: 'native',
      native: {
        query: ''
      }
    },
    visualization_settings: {
      graph_dimensions: [],
      graph_metrics: [],
      x_axis_title: "X轴",
      y_axis_title: "Y轴",
      x_field: "",
      y_fields: [],
      // Y轴聚合方式：count / sum / avg / mode / median
      y_agg_method: 'sum',
      // 是否按 X 聚合（group by），统计型图表默认开启，明细型图表（如散点图）默认关闭
      x_group_by_enabled: true,
      // 添加更多配置项
      show_legend: true,
      show_tooltip: true,
      // grid_padding 交给 ChartFactory 统一处理，不再在配置里写死 3% / 4% 等老的默认值
      // 排序配置
      sort_by: 'x', // 'x' 或 'y'
      sort_order: 'asc', // 'asc' 或 'desc'
      line_y_fields: [] as string[],
      y_axis_right_title: '',
      // 指标卡：构建器内固定筛选（表达式树：可嵌套 且/或），不随仪表盘筛选器变化
      metric_mode: 'aggregate' as 'aggregate' | 'cell',
      metric_filter_field: '',
      metric_filter_value: '',
      metric_filters: [] as MetricFilterRule[],
      metric_filter_expr: undefined as MetricFilterExprNode | undefined,
      metric_unit: '',
      metric_decimals: 2,
      metric_label: '',
    },
    database_id: 1
  });

  // 如果有chartId参数，加载现有图表数据
  useEffect(() => {
    if (chartId) {
      const loadChart = async () => {
        try {
          setLoading(true);
          const chart = await ChartService.getChart(parseInt(chartId, 10));
          
          // 转换数据格式以匹配state结构
          const convertedChartData: ChartData = {
            id: chart.id,
            name: chart.name || '新图表',
            chart_type: chart.chart_type || 'bar',
            dataset_query: chart.dataset_query || {
              type: 'native',
              native: { query: '' }
            },
            visualization_settings: (() => {
              const vs = chart.visualization_settings || {};
              // 为老图表补充缺失的默认聚合配置
              return {
                graph_dimensions: vs.graph_dimensions || [],
                graph_metrics: vs.graph_metrics || [],
                x_axis_title: vs.x_axis_title || "X轴",
                y_axis_title: vs.y_axis_title || "Y轴",
                x_field: vs.x_field || "",
                y_fields: vs.y_fields || [],
                show_legend: vs.show_legend !== false,
                show_tooltip: vs.show_tooltip !== false,
                // 老图表默认开启 Y 轴聚合（sum）
                y_agg_method: vs.y_agg_method || 'sum',
                // 老图表默认开启 X 轴聚合，根据图表类型决定
                x_group_by_enabled: vs.x_group_by_enabled ?? (chart.chart_type || '').toLowerCase() !== 'scatter',
                // 排序配置
                sort_by: vs.sort_by || 'x',
                sort_order: vs.sort_order || 'asc',
                line_y_fields: Array.isArray(vs.line_y_fields) ? vs.line_y_fields : [],
                y_axis_right_title: vs.y_axis_right_title || '',
                metric_mode: vs.metric_mode === 'cell' ? 'cell' : 'aggregate',
                metric_filter_field: vs.metric_filter_field != null ? String(vs.metric_filter_field) : '',
                metric_filter_value: vs.metric_filter_value != null ? String(vs.metric_filter_value) : '',
                metric_filters: (() => {
                  const parsed = normalizeMetricFilterRules(vs.metric_filters);
                  if (parsed.some((r) => r.field)) return parsed;
                  if (vs.metric_mode === 'cell' && String(vs.metric_filter_field || '').trim()) {
                    return [
                      {
                        field: String(vs.metric_filter_field).trim(),
                        op: 'eq' as const,
                        value: vs.metric_filter_value != null ? String(vs.metric_filter_value) : '',
                      },
                    ];
                  }
                  return [];
                })(),
                metric_filter_expr: (() => {
                  const fromExpr = parseMetricFilterExpr(vs.metric_filter_expr);
                  if (fromExpr) return fromExpr;
                  const legacy = normalizeMetricFilterRules(vs.metric_filters);
                  if (legacy.some((r) => r.field) || legacy.length > 0) {
                    return metricFilterExprFromLegacyRules(legacy);
                  }
                  if (vs.metric_mode === 'cell' && String(vs.metric_filter_field || '').trim()) {
                    return metricFilterExprFromLegacyRules([
                      {
                        field: String(vs.metric_filter_field).trim(),
                        op: 'eq' as const,
                        value: vs.metric_filter_value != null ? String(vs.metric_filter_value) : '',
                      },
                    ]);
                  }
                  return defaultMetricFilterExprRoot();
                })(),
                metric_unit: vs.metric_unit != null ? String(vs.metric_unit) : '',
                metric_decimals: typeof vs.metric_decimals === 'number' ? vs.metric_decimals : 2,
                metric_label: vs.metric_label != null ? String(vs.metric_label) : '',
              };
            })(),
            database_id: chart.database_id || 1,
            creator_id: chart.creator_id
          };
          
          setChartData(convertedChartData);
          
          // 加载数据源信息
          if (convertedChartData.database_id) {
            try {
              const dataSourcesList = await DataSourceService.getDataSources();
              const dataSource = dataSourcesList.find(ds => parseInt(ds.id, 10) === convertedChartData.database_id);
              if (dataSource) {
                setSelectedDataSource(dataSource.id.toString());
              }
            } catch (error) {
              console.warn('获取数据源信息失败:', error);
            }
          }
          
          message.success('图表加载成功');
        } catch (error) {
          console.error('加载图表失败:', error);
          message.error('加载图表失败，请重试');
        } finally {
          setLoading(false);
        }
      };
      
      loadChart();
    }
  }, [chartId]);
  
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [availableFields, setAvailableFields] = useState<string[]>([]); // 确保始终是数组
  const [fieldTypes, setFieldTypes] = useState<Record<string, MetricFieldKind>>({});
  const [authChecked, setAuthChecked] = useState(false);

  // 新增：图表类型动态配置函数
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
          defaultXGroupBy: true
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
          // 明细型图表：默认不按 X 聚合
          defaultXGroupBy: false
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
          defaultXGroupBy: true
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
          defaultXGroupBy: true
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
          defaultXGroupBy: true
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
          defaultXGroupBy: true
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
          defaultXGroupBy: true
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
          defaultXGroupBy: true
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
          defaultXGroupBy: false
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
          defaultXGroupBy: true
        };
    }
  };

  // 监听认证状态变化
  useEffect(() => {
    const verifyAuth = async () => {
      console.log('=== 验证认证状态 ===');
      console.log('Context状态:', { user, isAuthenticated });
      
      // 检查本地存储的token
      const token = AuthService.getAuthToken();
      console.log('LocalStorage token:', token ? '存在' : '不存在');
      
      // 如果Context和localStorage状态不一致，重新检查
      if (token && !isAuthenticated) {
        console.log('检测到token但Context显示未认证，重新检查认证状态');
        const isActuallyAuthenticated = await checkAuthStatus();
        console.log('重新检查结果:', isActuallyAuthenticated);
      }
      
      setAuthChecked(true);
    };
    
    verifyAuth();
  }, [user, isAuthenticated, checkAuthStatus]);

  // 当组件挂载或路由变化时重新检查认证状态
  useEffect(() => {
    const handleRouteChange = () => {
      console.log('=== 路由变化，重新检查认证 ===');
      setAuthChecked(false);
      setTimeout(() => {
        checkAuthStatus().then(() => {
          setAuthChecked(true);
        });
      }, 100);
    };

    // 监听路由变化
    handleRouteChange();
    
    // 添加路由变化监听器
    const originalPushState = window.history.pushState;
    window.history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleRouteChange();
    };

    return () => {
      window.history.pushState = originalPushState;
    };
  }, [checkAuthStatus]);

  // 监听排序配置变化，强制重新渲染图表
  useEffect(() => {
    // 当排序配置发生变化时，强制更新previewData以触发重新渲染
    if (previewData.length > 0) {
      setPreviewData(prev => [...prev]);
    }
  }, [chartData.visualization_settings.sort_by, chartData.visualization_settings.sort_order, previewData.length]);
  useEffect(() => {
    if (queryResult.length > 0) {
      console.log('=== Query Result Data ===');
      console.log('Total records:', queryResult.length);
      console.log('First 5 records:', queryResult.slice(0, 5));
      console.log('Last 5 records:', queryResult.slice(-5));
      console.log('All records:', queryResult);

      const columns = Object.keys(queryResult[0]).map(key => ({ // eslint-disable-line @typescript-eslint/no-unused-vars
        title: key,
        dataIndex: key,
        key: key,
        sorter: (a: any, b: any) => {
          if (typeof a[key] === 'number' && typeof b[key] === 'number') {
            return a[key] - b[key];
          }
          return String(a[key]).localeCompare(String(b[key]));
        }
      }));
      
      // 更新可用字段列表
      const fieldNames = Object.keys(queryResult[0]);
      setAvailableFields(fieldNames);
      setFieldTypes(inferMetricFieldTypesFromSampleRows(queryResult as Record<string, unknown>[], fieldNames));

      // 智能自动设置字段映射
      setChartData(prev => {
        const currentSettings = prev.visualization_settings;
        const hasXField = currentSettings.x_field;
        const hasYFields = currentSettings.y_fields && currentSettings.y_fields.length > 0;
        
        // 如果还没有设置字段或者字段已清空，则自动设置默认值
        if ((!hasXField && !hasYFields) || (hasXField && !availableFields.includes(hasXField))) {
          const newSettings = { ...currentSettings };
          
          // 智能选择X轴字段：优先选择文本类型的字段
          if (!hasXField && fieldNames.length > 0) {
            // 查找适合做X轴的字段（文本或日期类型）
            const suitableXFields = fieldNames.filter(field => {
              const sampleValue = queryResult[0][field];
              return typeof sampleValue === 'string' || 
                     sampleValue instanceof Date ||
                     (typeof sampleValue === 'object' && sampleValue !== null);
            });
            
            const xField = suitableXFields.length > 0 ? suitableXFields[0] : fieldNames[0];
            newSettings.x_field = xField;
            newSettings.x_axis_title = xField || 'X轴';
          }
          
          // 智能选择Y轴字段：选择数值类型的字段
          if (!hasYFields && fieldNames.length > 1) {
            // 查找适合做Y轴的字段（数值类型）
            const suitableYFields = fieldNames.filter(field => {
              const sampleValue = queryResult[0][field];
              return typeof sampleValue === 'number' || 
                     (typeof sampleValue === 'string' && !isNaN(Number(sampleValue)));
            }).filter(field => field !== newSettings.x_field); // 排除已选的X轴字段
            
            const defaultYFields = suitableYFields.slice(0, Math.min(3, suitableYFields.length));
            if (defaultYFields.length === 0) {
              // 如果没有找到合适的数值字段，则选择剩余字段
              const remainingFields = fieldNames.filter(f => f !== newSettings.x_field);
              defaultYFields.push(...remainingFields.slice(0, Math.min(3, remainingFields.length)));
            }
            
            newSettings.y_fields = defaultYFields;
            newSettings.y_axis_title = defaultYFields.length > 1 ? '汇总' : (defaultYFields[0] || 'Y轴');
          }
          
          return {
            ...prev,
            visualization_settings: newSettings
          };
        }
        
        return prev;
      });
    } else {
      setFieldTypes({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- availableFields 仅用于条件判断
  }, [queryResult]);

  // 防止重复加载数据源的标志
  const dataSourcesLoadedRef = useRef(false);
  
  useEffect(() => {
    // 只在首次加载时调用，避免重复请求
    if (!dataSourcesLoadedRef.current) {
      loadDataSources();
      dataSourcesLoadedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 首次加载，仅执行一次
  }, []);

  const loadDataSources = async () => {
    setLoading(true);
    try {
      const sources = await DataSourceService.getDataSources();

      // 过滤掉默认数据源：约定后端返回列表中的第一个为默认数据源
      const filteredSources =
        sources.length > 1
          ? sources.slice(1)
          : []; // 如果只有一个（默认）数据源，则在图表构建器中不展示

      setDataSources(filteredSources);

      if (filteredSources.length > 0) {
        // 使用具体的数据源ID，而不是类型
        const firstId = filteredSources[0].id.toString();
        setSelectedDataSource(firstId);
        // 同步更新当前图表所绑定的 database_id
        setChartData(prev => ({
          ...prev,
          database_id: parseInt(firstId, 10) || prev.database_id,
        }));
        loadTables(firstId);
      }
    } catch (error: any) {
      message.error(error.message || '获取数据源失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTables = async (dataSourceId: string) => {
    setLoading(true);
    try {
      const tableList = await DataSourceService.getTables(dataSourceId);
      setTables(tableList);
      
      if (tableList.length > 0) {
        const firstTableName = tableList[0].name;
        setSelectedTable(firstTableName);
        // 显式使用当前数据源ID进行预览查询，避免误用默认数据源
        loadPreviewData(dataSourceId, firstTableName);
      }
    } catch (error: any) {
      message.error(error.message || '获取表列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDataSourceChange = (value: string) => {
    // value 为后端的 Database.id（字符串形式）
    setSelectedDataSource(value);
    setChartData(prev => ({
      ...prev,
      database_id: parseInt(value, 10) || prev.database_id,
    }));
    setTables([]);
    setSelectedTable('');
    setQueryResult([]);
    setPreviewData([]);
    setAvailableFields([]);
    setFieldTypes({});
    loadTables(value);
  };

  const handleTableChange = (value: string) => {
    setSelectedTable(value);
    // 此处使用当前选中的数据源ID
    if (selectedDataSource) {
      loadPreviewData(selectedDataSource, value);
    }
  };

  const loadPreviewData = async (dataSourceId: string, tableName: string) => {
    console.log('开始加载预览数据，表名:', tableName);
    console.log('当前数据源:', selectedDataSource);
    
    setLoading(true);
    try {
      const result = await DataSourceService.executeQuery({
        data_source_id: dataSourceId,
        query: `SELECT * FROM ${tableName}`,
      });
      
      console.log('查询结果:', result);
      
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      console.log('格式化后的数据:', formattedData);
      setQueryResult(formattedData);
      setPreviewData(formattedData.slice(0, 10));
      
      const countResult = await DataSourceService.executeQuery({
        data_source_id: dataSourceId,
        query: `SELECT COUNT(*) as total FROM ${tableName}`,
      });
      
      console.log('计数结果:', countResult);
      setTotalRecords(countResult.rows[0].total);
      
    } catch (error: any) {
      console.error('加载数据预览失败:', error);
      message.error(error.message || '加载数据预览失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (newSettings: any) => {
    setChartData(prev => ({
      ...prev,
      visualization_settings: newSettings
    }));
    setShowConfig(false);
    message.success('配置已更新');
  };

  const handleChartTypeChange = (value: string) => {
    setChartData(prev => ({
      ...prev,
      chart_type: value,
      visualization_settings:
        value === 'metric'
          ? {
              ...prev.visualization_settings,
              x_group_by_enabled: false,
              metric_mode: 'aggregate',
              metric_filters: [],
              metric_filter_expr: defaultMetricFilterExprRoot(),
            }
          : prev.visualization_settings,
    }));
  };

  const getMetricFilterExprForUi = (): MetricFilterExprNode => {
    const vs = chartData.visualization_settings;
    const parsed = parseMetricFilterExpr(vs.metric_filter_expr);
    if (parsed) return parsed;
    return metricFilterExprFromLegacyRules(normalizeMetricFilterRules(vs.metric_filters));
  };

  const commitMetricFilterExpr = (root: MetricFilterExprNode) => {
    handleFieldMappingChange('metric_filter_expr', ensureMetricFilterExprIds(root));
  };

  const handleFieldMappingChange = (fieldType: string, value: any) => {
    setChartData(prev => {
      let newSettings = { ...prev.visualization_settings };
      
      // 处理X轴字段选择：自动设置X轴标题
      if (fieldType === 'x_field') {
        newSettings.x_field = value;
        newSettings.x_axis_title = value || 'X轴';
      }
      
      // 处理Y轴字段选择：智能设置Y轴标题
      if (fieldType === 'y_fields') {
        newSettings.y_fields = value;
        if (Array.isArray(value) && value.length > 0) {
          // 多选时设置为"汇总"
          newSettings.y_axis_title = value.length > 1 ? '汇总' : value[0] || 'Y轴';
        } else {
          newSettings.y_axis_title = 'Y轴';
        }
      }
      
      // 处理排序配置
      if (fieldType === 'sort_by' || fieldType === 'sort_order') {
        newSettings[fieldType] = value;
      }
      
      // 处理样式配置字段
      if (['show_legend', 'animation', 'rotate_labels', 'show_grid'].includes(fieldType)) {
        newSettings[fieldType] = value;
      }
      
      // 处理字符串类型字段
      if (['legend_position', 'y_agg_method'].includes(fieldType)) {
        newSettings[fieldType] = value;
      }

      // 处理按 X 轴聚合开关
      if (fieldType === 'x_group_by_enabled') {
        newSettings.x_group_by_enabled = value;
      }
      
      // 其他字段正常处理
      if (!['x_field', 'y_fields', 'sort_by', 'sort_order', 'color_field', 'show_legend', 'animation', 'rotate_labels', 'show_grid', 'legend_position', 'x_group_by_enabled'].includes(fieldType)) {
        newSettings[fieldType] = value;
      }
      
      return {
        ...prev,
        visualization_settings: newSettings
      };
    });
  };

  const handleSaveChart = async () => {
    console.log('=== 保存图表开始 ===');
    console.log('当前认证状态:', { user, isAuthenticated, authChecked });
    
    const token = AuthService.getAuthToken();
    console.log('Token存在:', !!token);
    
    if (!authChecked) {
      message.warning('正在检查认证状态，请稍后再试');
      return;
    }
    
    if (!isAuthenticated || !user || !token) {
      console.log('认证失败详情:', { 
        isAuthenticated, 
        user: !!user, 
        token: !!token,
        contextUser: user
      });
      
      message.error('请先登录');
      
      const refreshed = await checkAuthStatus();
      if (refreshed) {
        message.success('认证状态已恢复，请重试');
      } else {
        window.location.href = '/login';
      }
      return;
    }
    
    if (queryResult.length === 0) {
      message.error('请先执行查询获取数据');
      return;
    }

    // 验证必要字段 - 根据图表类型进行特定验证
    if (!chartData.name.trim()) {
      message.error('请输入图表名称');
      return;
    }
    
    const config = getChartFieldConfig(chartData.chart_type);
    
    // X轴字段验证
    if (config.xFieldRequired && !chartData.visualization_settings.x_field) {
      message.error(`请选择X轴字段`);
      return;
    }
    
    // Y轴字段验证
    if (chartData.visualization_settings.y_fields?.length < config.yFieldsRequired) {
      message.error(`请至少选择${config.yFieldsRequired}个Y轴字段`);
      return;
    }
    
    // Y轴字段最大数量验证
    if (chartData.visualization_settings.y_fields?.length > config.yFieldsMax) {
      message.error(`最多只能选择${config.yFieldsMax}个Y轴字段`);
      return;
    }

    setLoading(true);
    try {
      // 确保聚合配置存在（容错处理）
      const currentSettings = chartData.visualization_settings || {};
      const yAggMethod = currentSettings.y_agg_method || 'sum';
      const xGroupByEnabled =
        chartData.chart_type === 'metric'
          ? false
          : typeof currentSettings.x_group_by_enabled === 'boolean'
            ? currentSettings.x_group_by_enabled
            : getChartFieldConfig(chartData.chart_type).defaultXGroupBy !== false;

      console.log('=== 保存图表调试信息 ===');
      console.log('当前 y_agg_method:', yAggMethod);
      console.log('当前 x_group_by_enabled:', xGroupByEnabled);
      console.log('图表类型:', chartData.chart_type);
      console.log('getChartFieldConfig:', getChartFieldConfig(chartData.chart_type));

      // 构建完整的SQL查询
      let finalQuery = '';
      if (chartData.dataset_query?.native?.query) {
        // 使用自定义SQL查询
        finalQuery = chartData.dataset_query.native.query;
      } else {
        // 自动生成基于选中表的查询
        let selectFields: string[];
        if (chartData.chart_type === 'metric') {
          const vs = chartData.visualization_settings;
          const yf = vs.y_fields?.[0];
          const exprRoot =
            parseMetricFilterExpr(vs.metric_filter_expr) ??
            metricFilterExprFromLegacyRules(normalizeMetricFilterRules(vs.metric_filters));
          const fromExpr = collectFieldsFromMetricFilterExpr(exprRoot);
          const set = new Set<string>();
          if (yf) set.add(yf);
          fromExpr.forEach((f) => set.add(f));
          selectFields = [...set];
          if (selectFields.length === 0) {
            message.error('请选择指标数值字段');
            setLoading(false);
            return;
          }
        } else {
          selectFields = [
            chartData.visualization_settings.x_field,
            ...chartData.visualization_settings.y_fields
          ].filter(Boolean);
        }

        finalQuery = `SELECT ${selectFields.join(', ')} FROM ${selectedTable}`;
        
        // 注意：不添加LIMIT，让用户自己决定是否需要限制
      }
      
      const chartToSave = {
        name: chartData.name,
        description: chartData.name, // 使用名称作为描述
        chart_type: chartData.chart_type,
        dataset_query: {
          type: 'native',
          native: {
            query: finalQuery
          }
        },
        visualization_settings: {
          // 使用后端期望的原始字段名
          graph_dimensions: chartData.visualization_settings.x_field ? [chartData.visualization_settings.x_field] : [],
          graph_metrics: chartData.visualization_settings.y_fields || [],
          x_axis_title: chartData.visualization_settings.x_axis_title || 'X轴',
          y_axis_title: chartData.visualization_settings.y_axis_title || 'Y轴',
          show_legend: chartData.visualization_settings.show_legend !== false,
          tooltip_enabled: chartData.visualization_settings.show_tooltip !== false,
          // Y轴聚合方式（使用前面确保的默认值）
          y_agg_method: yAggMethod,
          // 是否按 X 轴聚合（group by），持久化保存（使用前面确保的默认值）
          x_group_by_enabled: xGroupByEnabled,
          // 排序配置
          sort_by: chartData.visualization_settings.sort_by || 'x',
          sort_order: chartData.visualization_settings.sort_order || 'asc',
          // 保留原有的前端字段以便本地使用
          x_field: chartData.visualization_settings.x_field,
          y_fields: chartData.visualization_settings.y_fields,
          // 指标卡
          metric_mode: chartData.visualization_settings.metric_mode || 'aggregate',
          metric_filter_field: chartData.visualization_settings.metric_filter_field || '',
          metric_filter_value: chartData.visualization_settings.metric_filter_value || '',
          metric_filter_expr: ensureMetricFilterExprIds(
            parseMetricFilterExpr(chartData.visualization_settings.metric_filter_expr) ??
              metricFilterExprFromLegacyRules(
                normalizeMetricFilterRules(chartData.visualization_settings.metric_filters),
              ),
          ),
          metric_filters: [],
          metric_unit: chartData.visualization_settings.metric_unit || '',
          metric_decimals:
            typeof chartData.visualization_settings.metric_decimals === 'number'
              ? chartData.visualization_settings.metric_decimals
              : 2,
          metric_label: chartData.visualization_settings.metric_label || '',
        },
        database_id: chartData.database_id,
        creator_id: user.id,
        is_public: false
      };

      console.log('最终准备保存的 visualization_settings:', chartToSave.visualization_settings);
      const savedChart = await ChartService.createChart(chartToSave);
      console.log('保存成功的图表:', savedChart);
      
      // 更新本地状态，确保配置同步（安全版本）
      setChartData(prev => {
        const newSettings = savedChart.visualization_settings || 
          prev.visualization_settings || 
          { x_field: '', y_fields: [], x_axis_title: 'X轴', y_axis_title: 'Y轴' };
        
        return {
          ...prev,
          id: savedChart.id,
          name: savedChart.name,
          visualization_settings: newSettings
        };
      });
      
      message.success(`图表"${chartData.name}"保存成功`);
      
      // 保存成功后重置表单或跳转
      // 可以选择重置或者让用户继续编辑
      
    } catch (error: any) {
      console.error('保存图表失败:', error);
      message.error(error.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  // 如果认证检查还未完成，显示加载状态
  if (!authChecked) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Spin size="large" tip="正在检查认证状态..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card 
        title="图表构建器" 
        extra={
          <Space>
            <Button 
              type="primary" 
              icon={<SaveOutlined />} 
              onClick={handleSaveChart}
              loading={loading}
              disabled={!isAuthenticated || !user}
            >
              保存图表
            </Button>
          </Space>
        }
      >
        {!isAuthenticated || !user ? (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            backgroundColor: '#fffbe6', 
            border: '1px solid #ffe58f',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <p style={{ color: '#faad14', fontWeight: 'bold' }}>
              ⚠️ 请先登录以保存图表
            </p>
            <Button 
              type="primary" 
              onClick={() => window.location.href = '/login'}
            >
              前往登录
            </Button>
          </div>
        ) : null}
        
        <Spin spinning={loading}>
          {/* 图表名称输入区域 */}
          <div style={{ marginBottom: '16px', padding: '0 24px' }}>
            <label>图表名称:</label>
            <Input
              value={chartData.name}
              onChange={(e) => setChartData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="请输入图表名称"
              style={{ width: '100%', marginTop: '8px' }}
            />
          </div>
          <Tabs defaultActiveKey="1">
            <TabPane tab="数据配置" key="1">
              <Row gutter={24} align="stretch">
                {/* 左侧：数据源 + 数据预览（与右侧并排，避免上方留空） */}
                <Col xs={24} xl={11}>
                  <Card
                    title="数据源配置"
                    size="small"
                    style={{ height: '100%' }}
                    bodyStyle={{
                      maxHeight: 'calc(100vh - 220px)',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                    }}
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <div>
                        <label>数据源:</label>
                        <Select
                          value={selectedDataSource}
                          onChange={handleDataSourceChange}
                          style={{ width: '100%' }}
                          placeholder="选择数据源"
                        >
                          {dataSources.map(source => (
                            <Option key={source.id} value={source.id}>
                              <DatabaseOutlined /> {source.name} ({source.type})
                            </Option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <label>数据表:</label>
                        <Select
                          value={selectedTable}
                          onChange={handleTableChange}
                          style={{ width: '100%' }}
                          placeholder="选择数据表"
                          disabled={!selectedDataSource}
                        >
                          {tables.map(table => (
                            <Option key={table.name} value={table.name}>
                              {table.name}
                            </Option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <p><strong>数据统计:</strong></p>
                        <p>总记录数: {totalRecords} 条</p>
                        <p>预览记录: {previewData.length} 条</p>
                      </div>
                    </Space>
                    
                    {/* 添加数据预览区域到这里 */}
                    <div style={{ marginTop: '24px', border: '1px solid #d9d9d9', borderRadius: '8px', padding: '16px' }}>
                      <h3 style={{ marginBottom: '16px', color: '#1890ff' }}>数据预览</h3>
                      {previewData.length > 0 ? (
                        <Table 
                          dataSource={previewData} 
                          columns={[
                            ...Object.keys(previewData[0] || {}).map(key => ({
                              title: key,
                              dataIndex: key,
                              key: key
                            }))
                          ]} 
                          pagination={{ pageSize: 10 }}
                          size="small"
                          scroll={{ x: 'max-content' }}
                        />
                      ) : (
                        <div style={{ 
                          height: '200px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: '#f5f5f5',
                          border: '2px dashed #d9d9d9',
                          borderRadius: '8px'
                        }}>
                          <p style={{ color: '#999' }}>请先执行查询加载数据</p>
                        </div>
                      )}
                    </div>
                  </Card>
                </Col>

                {/* 右侧：字段映射 + 图表预览 */}
                <Col xs={24} xl={13}>
                  <Card
                    title="图表配置"
                    size="small"
                    style={{ height: '100%' }}
                    bodyStyle={{
                      maxHeight: 'calc(100vh - 220px)',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                    }}
                  >
                    {/* ── 一、图表类型（横向按钮组）────────────────────── */}
                    <div style={{ marginBottom: 20 }}>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        padding: 12,
                        background: '#f8f9fb',
                        borderRadius: 8
                      }}>
                        {CHART_TYPES.map(type => (
                          <button
                            key={type.value}
                            onClick={() => handleChartTypeChange(type.value)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 4,
                              padding: '10px 14px',
                              minWidth: 72,
                              border: chartData.chart_type === type.value ? '2px solid #1890ff' : '1px solid #d9d9d9',
                              borderRadius: 8,
                              background: chartData.chart_type === type.value ? '#e6f7ff' : '#fff',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              fontSize: 12
                            }}
                            onMouseEnter={(e) => {
                              if (chartData.chart_type !== type.value) {
                                e.currentTarget.style.borderColor = '#1890ff';
                                e.currentTarget.style.background = '#f0f5ff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (chartData.chart_type !== type.value) {
                                e.currentTarget.style.borderColor = '#d9d9d9';
                                e.currentTarget.style.background = '#fff';
                              }
                            }}
                          >
                            <span style={{ fontSize: 20 }}>{type.icon}</span>
                            <span style={{ color: chartData.chart_type === type.value ? '#1890ff' : '#333' }}>{type.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <Divider style={{ margin: '16px 0' }} />

                    {/* ── 二、字段映射 / 指标配置 ───────────────────── */}
                    <div style={{ marginBottom: 20 }}>
                      <p style={{ fontWeight: 600, marginBottom: 12, color: '#333' }}>
                        {chartData.chart_type === 'metric' ? '指标配置' : '字段映射'}
                      </p>

                      {chartData.chart_type === 'metric' ? (
                        <>
                          <Row gutter={12}>
                            <Col span={12}>
                              <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>数值字段</label>
                              <Select
                                value={chartData.visualization_settings.y_fields?.[0] || undefined}
                                onChange={(value) => handleFieldMappingChange('y_fields', value ? [value] : [])}
                                style={{ width: '100%' }}
                                placeholder="选择要聚合的数值列"
                                disabled={availableFields.length === 0}
                              >
                                {availableFields.map(field => (
                                  <Option key={field} value={field}>{field}</Option>
                                ))}
                              </Select>
                            </Col>
                            <Col span={12}>
                              <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>聚合方式</label>
                              <Select
                                value={chartData.visualization_settings.y_agg_method || 'sum'}
                                onChange={(value) => handleFieldMappingChange('y_agg_method', value)}
                                style={{ width: '100%' }}
                              >
                                <Option value="count">计数（行数）</Option>
                                <Option value="sum">求和</Option>
                                <Option value="avg">平均</Option>
                                <Option value="max">最大</Option>
                                <Option value="min">最小</Option>
                                <Option value="first">首行取值</Option>
                              </Select>
                            </Col>
                          </Row>

                          <div style={{ margin: '16px 0 8px', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>数据筛选（固定条件）</span>
                            <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>保存后指标值不随仪表盘筛选器变化</span>
                          </div>
                          <MetricFilterExprEditor
                            root={getMetricFilterExprForUi()}
                            onChange={commitMetricFilterExpr}
                            availableFields={availableFields}
                            fieldTypes={fieldTypes}
                          />

                          <Row gutter={12} style={{ marginTop: 16 }}>
                            <Col span={8}>
                              <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>单位（可选）</label>
                              <Input
                                value={chartData.visualization_settings.metric_unit || ''}
                                onChange={(e) => handleFieldMappingChange('metric_unit', e.target.value)}
                                placeholder="如：万、元"
                              />
                            </Col>
                            <Col span={8}>
                              <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>小数位数</label>
                              <InputNumber
                                min={0}
                                max={10}
                                style={{ width: '100%' }}
                                value={chartData.visualization_settings.metric_decimals ?? 2}
                                onChange={(v) => handleFieldMappingChange('metric_decimals', typeof v === 'number' ? v : 2)}
                              />
                            </Col>
                            <Col span={8}>
                              <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>指标说明</label>
                              <Input
                                value={chartData.visualization_settings.metric_label || ''}
                                onChange={(e) => handleFieldMappingChange('metric_label', e.target.value)}
                                placeholder="显示在数字下方"
                              />
                            </Col>
                          </Row>
                          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: '#999', lineHeight: 1.5 }}>
                            说明：此处为「指标图专用」固定筛选（图表构建器内配置，非仪表盘筛选器）。未填字段的条件在聚合时视为不限制。
                          </p>
                        </>
                      ) : (
                        <>
                          <Row gutter={12}>
                            <Col span={12}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>X轴字段</label>
                                {getChartFieldConfig(chartData.chart_type).xFieldRequired ? (
                                  <Select
                                    value={chartData.visualization_settings.x_field}
                                    onChange={(value) => handleFieldMappingChange('x_field', value)}
                                    style={{ width: '100%' }}
                                    placeholder="选择X轴字段"
                                    disabled={availableFields.length === 0}
                                  >
                                    {availableFields.map(field => (
                                      <Option key={field} value={field}>{field}</Option>
                                    ))}
                                  </Select>
                                ) : (
                                  <div style={{ color: '#999', fontStyle: 'italic', fontSize: 13 }}>无需X轴字段</div>
                                )}
                              </div>
                            </Col>
                            <Col span={12}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>Y轴字段</label>
                                {getChartFieldConfig(chartData.chart_type).showMultipleY ? (
                                  <Select
                                    mode="multiple"
                                    value={chartData.visualization_settings.y_fields}
                                    onChange={(values) => {
                                      const limitedValues = values.slice(0, getChartFieldConfig(chartData.chart_type).yFieldsMax);
                                      handleFieldMappingChange('y_fields', limitedValues);
                                    }}
                                    style={{ width: '100%' }}
                                    placeholder={`选择${getChartFieldConfig(chartData.chart_type).yFieldsRequired}个以上字段`}
                                    disabled={availableFields.length === 0}
                                    maxTagCount={3}
                                  >
                                    {availableFields.map(field => (
                                      <Option key={field} value={field}>{field}</Option>
                                    ))}
                                  </Select>
                                ) : (
                                  <Select
                                    value={chartData.visualization_settings.y_fields?.[0] || undefined}
                                    onChange={(value) => handleFieldMappingChange('y_fields', value ? [value] : [])}
                                    style={{ width: '100%' }}
                                    placeholder="选择1个字段"
                                    disabled={availableFields.length === 0}
                                  >
                                    {availableFields.map(field => (
                                      <Option key={field} value={field}>{field}</Option>
                                    ))}
                                  </Select>
                                )}
                                <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
                                  {getChartFieldConfig(chartData.chart_type).description}
                                </div>
                              </div>
                            </Col>
                          </Row>

                          {chartData.chart_type === 'bar_line' && (
                            <Row gutter={12} style={{ marginTop: 12 }}>
                              <Col span={12}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>
                                  折线指标（走右侧Y轴）
                                </label>
                                <Select
                                  mode="multiple"
                                  allowClear
                                  value={chartData.visualization_settings.line_y_fields || []}
                                  onChange={(vals) => {
                                    const yf = chartData.visualization_settings.y_fields || [];
                                    const ok = (vals || []).filter((v: string) => yf.includes(v));
                                    handleFieldMappingChange('line_y_fields', ok);
                                  }}
                                  style={{ width: '100%' }}
                                  placeholder="不选则默认最后2个Y字段为折线"
                                  disabled={(chartData.visualization_settings.y_fields || []).length === 0}
                                >
                                  {(chartData.visualization_settings.y_fields || []).map((field: string) => (
                                    <Option key={field} value={field}>{field}</Option>
                                  ))}
                                </Select>
                              </Col>
                              <Col span={12}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>右侧Y轴名称</label>
                                <Input
                                  value={chartData.visualization_settings.y_axis_right_title || ''}
                                  onChange={(e) => handleFieldMappingChange('y_axis_right_title', e.target.value)}
                                  placeholder="例如：转化率、占比"
                                />
                              </Col>
                            </Row>
                          )}
                        </>
                      )}
                    </div>

                    <Divider style={{ margin: '16px 0' }} />

                    {chartData.chart_type !== 'metric' ? (
                      <>
                        {/* ── 三、数据处理 ────────────────────────── */}
                        <div style={{ marginBottom: 20 }}>
                          <p style={{ fontWeight: 600, marginBottom: 12, color: '#333' }}>数据处理</p>
                          <Row gutter={12}>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>Y轴统计方式</label>
                                <Select
                                  value={chartData.visualization_settings.y_agg_method || 'sum'}
                                  onChange={(value) => handleFieldMappingChange('y_agg_method', value)}
                                  disabled={
                                    (() => {
                                      const vs = chartData.visualization_settings || {};
                                      return typeof vs.x_group_by_enabled === 'boolean'
                                        ? !vs.x_group_by_enabled
                                        : getChartFieldConfig(chartData.chart_type).defaultXGroupBy === false;
                                    })()
                                  }
                                  style={{ width: '100%' }}
                                >
                                  <Option value="count">计数</Option>
                                  <Option value="sum">求和</Option>
                                  <Option value="avg">平均数</Option>
                                  <Option value="mode">众数</Option>
                                  <Option value="median">中位数</Option>
                                </Select>
                              </div>
                            </Col>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>排序方式</label>
                                <Select
                                  value={chartData.visualization_settings.sort_by}
                                  onChange={(value) => handleFieldMappingChange('sort_by', value)}
                                  style={{ width: '100%' }}
                                  placeholder="选择排序方式"
                                >
                                  <Option value="x">按X轴排序</Option>
                                  <Option value="y">按Y轴排序</Option>
                                </Select>
                              </div>
                            </Col>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>排序顺序</label>
                                <Select
                                  value={chartData.visualization_settings.sort_order}
                                  onChange={(value) => handleFieldMappingChange('sort_order', value)}
                                  style={{ width: '100%' }}
                                >
                                  <Option value="asc">升序</Option>
                                  <Option value="desc">降序</Option>
                                </Select>
                              </div>
                            </Col>
                          </Row>
                          <Row gutter={12} style={{ marginTop: 8 }}>
                            <Col span={8}>
                              <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                                <span style={{ color: '#666', fontSize: 13 }}>按X轴聚合</span>
                                <Switch
                                  checked={
                                    typeof chartData.visualization_settings.x_group_by_enabled === 'boolean'
                                      ? chartData.visualization_settings.x_group_by_enabled
                                      : getChartFieldConfig(chartData.chart_type).defaultXGroupBy !== false
                                  }
                                  onChange={(checked) => handleFieldMappingChange('x_group_by_enabled', checked)}
                                  style={{ marginLeft: 8 }}
                                />
                              </div>
                            </Col>
                          </Row>
                        </div>

                        <Divider style={{ margin: '16px 0' }} />

                        {/* ── 四、轴标题 & 图例 ─────────────────────────── */}
                        <div style={{ marginBottom: 20 }}>
                          <p style={{ fontWeight: 600, marginBottom: 12, color: '#333' }}>显示样式</p>
                          <Row gutter={12}>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>X轴标题</label>
                                <Input
                                  value={chartData.visualization_settings.x_axis_title}
                                  onChange={(e) => handleFieldMappingChange('x_axis_title', e.target.value)}
                                  placeholder="X轴标题"
                                />
                              </div>
                            </Col>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>Y轴标题</label>
                                <Input
                                  value={chartData.visualization_settings.y_axis_title}
                                  onChange={(e) => handleFieldMappingChange('y_axis_title', e.target.value)}
                                  placeholder="Y轴标题"
                                />
                              </div>
                            </Col>
                            <Col span={8}>
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 13 }}>显示图例</label>
                                <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                                  <Switch
                                    checked={chartData.visualization_settings.show_legend !== false}
                                    onChange={(checked) => handleFieldMappingChange('show_legend', checked)}
                                  />
                                </div>
                              </div>
                            </Col>
                          </Row>
                        </div>

                        <Divider style={{ margin: '16px 0' }} />
                      </>
                    ) : null}

                    {/* ── 五、图表预览 ──────────────────────────────── */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <p style={{ fontWeight: 600, margin: 0, color: '#333' }}>图表预览</p>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => setPreviewData(prev => [...prev])}
                          icon={<PlayCircleOutlined />}
                        >
                          刷新预览
                        </Button>
                      </div>
                      <div style={{
                        border: '1px solid #e8e8e8',
                        borderRadius: 8,
                        padding: 16,
                        background: '#fff'
                      }}>
                        {(chartData.chart_type === 'metric'
                          ? queryResult.length > 0
                          : previewData.length > 0) &&
                         chartData.visualization_settings.y_fields?.length > 0 &&
                         (chartData.chart_type === 'metric' ||
                          !!chartData.visualization_settings.x_field) ? (
                          <div style={{ height: 380 }}>
                            <ChartFactory
                              config={{
                                type: chartData.chart_type,
                                title: '',
                                xField: chartData.visualization_settings.x_field,
                                yFields: chartData.visualization_settings.y_fields || [],
                                line_y_fields: chartData.visualization_settings.line_y_fields,
                                y_axis_right_title: chartData.visualization_settings.y_axis_right_title,
                                y_agg_method: chartData.visualization_settings.y_agg_method,
                                x_group_by_enabled:
                                  typeof chartData.visualization_settings.x_group_by_enabled === 'boolean'
                                    ? chartData.visualization_settings.x_group_by_enabled
                                    : getChartFieldConfig(chartData.chart_type).defaultXGroupBy !== false,
                                sort_by: chartData.visualization_settings.sort_by,
                                sort_order: chartData.visualization_settings.sort_order,
                                metric_mode: chartData.visualization_settings.metric_mode,
                                metric_filter_field: chartData.visualization_settings.metric_filter_field,
                                metric_filter_value: chartData.visualization_settings.metric_filter_value,
                                metric_filters: [],
                                metric_filter_expr:
                                  parseMetricFilterExpr(chartData.visualization_settings.metric_filter_expr) ??
                                  metricFilterExprFromLegacyRules(
                                    normalizeMetricFilterRules(chartData.visualization_settings.metric_filters),
                                  ),
                                metric_unit: chartData.visualization_settings.metric_unit,
                                metric_decimals: chartData.visualization_settings.metric_decimals,
                                metric_label: chartData.visualization_settings.metric_label,
                                series: [],
                                xAxis: {
                                  name: chartData.visualization_settings.x_axis_title || 'X轴'
                                },
                                yAxis: {
                                  name: chartData.visualization_settings.y_axis_title || 'Y轴'
                                },
                                legend: {
                                  show: chartData.visualization_settings.show_legend !== false,
                                  bottom: 10
                                },
                                tooltip: {
                                  trigger: 'axis',
                                  axisPointer: { type: 'cross' }
                                },
                              }}
                              data={chartData.chart_type === 'metric' ? queryResult : previewData}
                              style={{ height: '380px', width: '100%' }}
                            />
                          </div>
                        ) : (
                          <div style={{
                            height: 380,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#fafafa',
                            border: '2px dashed #d9d9d9',
                            borderRadius: 8
                          }}>
                            <div style={{ textAlign: 'center' }}>
                              <p style={{ color: '#bbb', fontSize: 14 }}>
                                {(chartData.chart_type === 'metric' ? queryResult.length > 0 : previewData.length > 0)
                                  ? '配置完成后点击「刷新预览」'
                                  : '请先加载表数据（左侧选择表后自动加载）'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>


            </TabPane>
            
            {/* 移除原来的图表预览TabPane */}
          </Tabs>


        </Spin>
      </Card>

      {showConfig && (
        <ChartConfigPanel
          initialSettings={chartData.visualization_settings}
          availableFields={availableFields}
          onSave={handleConfigChange}
          onCancel={() => setShowConfig(false)}
        />
      )}
    </div>
  );
};