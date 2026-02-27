// frontend/bi-dashboard/src/pages/VisualizationBuilder.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Select, Input, Form, Table, Tabs, Switch, Divider } from 'antd';
import { PlusOutlined, SaveOutlined, DatabaseOutlined, PlayCircleOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined, DotChartOutlined, AreaChartOutlined, RadarChartOutlined, FundViewOutlined, ClusterOutlined, FallOutlined, FilterOutlined } from '@ant-design/icons';
import { ChartFactory } from '../components/charts/ChartFactory';
import { ChartConfigPanel } from '../components/charts/ChartConfigPanel';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import { DataSourceService } from '../services/dataSourceService';
import { AuthService } from '../services/authService';

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
  { value: 'stacked_bar', label: '堆积柱形图', icon: <ClusterOutlined /> },
  { value: 'waterfall', label: '瀑布图', icon: <FallOutlined /> },
  { value: 'funnel', label: '漏斗图', icon: <FilterOutlined /> },
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
      // 添加更多配置项
      show_legend: true,
      show_tooltip: true,
      grid_padding: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      // 排序配置
      sort_by: 'x', // 'x' 或 'y'
      sort_order: 'asc' // 'asc' 或 'desc'
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
            visualization_settings: chart.visualization_settings || {
              graph_dimensions: [],
              graph_metrics: [],
              x_axis_title: "X轴",
              y_axis_title: "Y轴",
              x_field: "",
              y_fields: [],
              show_legend: true,
              show_tooltip: true,
              grid_padding: { left: '3%', right: '4%', bottom: '15%', containLabel: true }
            },
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
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  const [availableFields, setAvailableFields] = useState<string[]>([]); // 确保始终是数组
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
          description: '需要1个分类字段和1个数值字段'
        };
      case 'scatter':
        return {
          xFieldRequired: true,
          yFieldsRequired: 2,
          yFieldsMax: 2,
          showColorField: true,
          showMultipleY: false,
          title: '散点图',
          description: '需要2个数值字段作为X和Y坐标'
        };
      case 'radar':
        return {
          xFieldRequired: false,
          yFieldsRequired: 2,
          yFieldsMax: 10,
          showColorField: false,
          showMultipleY: true,
          title: '雷达图',
          description: '需要多个数值字段作为维度'
        };
      case 'boxplot':
        return {
          xFieldRequired: false,
          yFieldsRequired: 1,
          yFieldsMax: 10,
          showColorField: false,
          showMultipleY: true,
          title: '箱线图',
          description: '需要数值字段用于箱体计算'
        };
      case 'funnel':
        return {
          xFieldRequired: true,
          yFieldsRequired: 1,
          yFieldsMax: 1,
          showColorField: false,
          showMultipleY: false,
          title: '漏斗图',
          description: '需要1个阶段字段和1个数值字段'
        };
      case 'waterfall':
        return {
          xFieldRequired: true,
          yFieldsRequired: 1,
          yFieldsMax: 1,
          showColorField: false,
          showMultipleY: false,
          title: '瀑布图',
          description: '需要1个阶段字段和1个增量数值字段'
        };
      case 'stacked_bar':
        return {
          xFieldRequired: true,
          yFieldsRequired: 1,
          yFieldsMax: 10,
          showColorField: true,
          showMultipleY: true,
          title: '堆积柱形图',
          description: '需要1个分类字段和多个数值字段进行堆积'
        };
      default:
        return {
          xFieldRequired: true,
          yFieldsRequired: 1,
          yFieldsMax: 10,
          showColorField: true,
          showMultipleY: true,
          title: '柱状图/折线图',
          description: '需要1个分类字段和1个或多个数值字段'
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

      const columns = Object.keys(queryResult[0]).map(key => ({
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
      setTableColumns(columns);
      
      // 更新可用字段列表
      const fieldNames = Object.keys(queryResult[0]);
      setAvailableFields(fieldNames);
      
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
    }
  }, [queryResult]);

  // 防止重复加载数据源的标志
  const dataSourcesLoadedRef = useRef(false);
  
  useEffect(() => {
    // 只在首次加载时调用，避免重复请求
    if (!dataSourcesLoadedRef.current) {
      loadDataSources();
      dataSourcesLoadedRef.current = true;
    }
  }, []);

  const loadDataSources = async () => {
    setLoading(true);
    try {
      const sources = await DataSourceService.getDataSources();
      setDataSources(sources);
      if (sources.length > 0) {
        setSelectedDataSource(sources[0].type);
        loadTables(sources[0].type);
      }
    } catch (error: any) {
      message.error(error.message || '获取数据源失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTables = async (dataSourceType: string) => {
    setLoading(true);
    try {
      const tableList = await DataSourceService.getTables(dataSourceType);
      setTables(tableList);
      
      if (tableList.length > 0) {
        setSelectedTable(tableList[0].name);
        loadPreviewData(tableList[0].name);
      }
    } catch (error: any) {
      message.error(error.message || '获取表列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDataSourceChange = (value: string) => {
    setSelectedDataSource(value);
    setTables([]);
    setSelectedTable('');
    setQueryResult([]);
    setPreviewData([]);
    setAvailableFields([]);
    loadTables(value);
  };

  const handleTableChange = (value: string) => {
    setSelectedTable(value);
    loadPreviewData(value);
  };

  const loadPreviewData = async (tableName: string) => {
    console.log('开始加载预览数据，表名:', tableName);
    console.log('当前数据源:', selectedDataSource);
    
    setLoading(true);
    try {
      const result = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT * FROM ${tableName}`
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
        data_source_id: selectedDataSource,
        query: `SELECT COUNT(*) as total FROM ${tableName}`
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

  const handleExecuteQuery = async () => {
    if (!selectedDataSource || !selectedTable) {
      message.warning('请选择数据源和表');
      return;
    }

    setLoading(true);
    try {
      const result = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT * FROM ${selectedTable}`
      });
      
      console.log('=== Execute Query Result ===');
      console.log('Raw result:', result);
      console.log('Row count:', result.row_count);
      console.log('Rows length:', result.rows.length);
      
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      console.log('=== Formatted Data ===');
      console.log('Formatted data length:', formattedData.length);
      console.log('Formatted data:', formattedData);
      
      setQueryResult(formattedData);
      setTotalRecords(result.row_count);
      setPreviewData(formattedData.slice(0, 10));
      message.success(`查询成功，返回 ${result.row_count} 条记录`);
    } catch (error: any) {
      message.error(error.message || '查询执行失败');
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
      chart_type: value
    }));
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
      if (['legend_position'].includes(fieldType)) {
        newSettings[fieldType] = value;
      }
      
      // 其他字段正常处理
      if (!['x_field', 'y_fields', 'sort_by', 'sort_order', 'color_field', 'show_legend', 'animation', 'rotate_labels', 'show_grid', 'legend_position'].includes(fieldType)) {
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
      // 构建完整的SQL查询
      let finalQuery = '';
      if (chartData.dataset_query?.native?.query) {
        // 使用自定义SQL查询
        finalQuery = chartData.dataset_query.native.query;
      } else {
        // 自动生成基于选中表的查询
        const selectFields = [
          chartData.visualization_settings.x_field,
          ...chartData.visualization_settings.y_fields
        ].filter(Boolean);
        
        finalQuery = `SELECT ${selectFields.join(', ')} FROM ${selectedTable}`;
        
        // 添加LIMIT防止数据过大
        finalQuery += ' LIMIT 1000';
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
          ...chartData.visualization_settings,
          // 确保必要的配置项存在
          x_axis_title: chartData.visualization_settings.x_axis_title || 'X轴',
          y_axis_title: chartData.visualization_settings.y_axis_title || 'Y轴',
          // 确保x_field和y_fields存在
          x_field: chartData.visualization_settings.x_field ?? (availableFields?.length > 0 ? availableFields[0] : ''),
          y_fields: chartData.visualization_settings.y_fields ?? (availableFields?.length > 1 ? availableFields.slice(1, Math.min(3, availableFields?.length || 0)) : [])
        },
        database_id: chartData.database_id,
        creator_id: user.id,
        is_public: false
      };
      
      console.log('准备保存的图表数据:', chartToSave);
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
              <Row gutter={24}>
                <Col span={8}>
                  <Card title="数据源配置" size="small">
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
                            <Option key={source.type} value={source.type}>
                              <DatabaseOutlined /> {source.name}
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

                <Col span={16}>
                  <Card title="字段映射配置" size="small">
                    <Row gutter={16}>
                      <Col span={8}>
                        <div>
                          <label>图表类型:</label>
                          <Select
                            value={chartData.chart_type}
                            onChange={handleChartTypeChange}
                            style={{ width: '100%' }}
                            placeholder="选择图表类型"
                          >
                            {CHART_TYPES.map(type => (
                              <Option key={type.value} value={type.value}>
                                {type.icon} {type.label}
                              </Option>
                            ))}
                          </Select>
                        </div>
                      </Col>
                      
                      {/* 动态字段配置 - 根据图表类型显示不同的表单元素 */}
                      <Col span={8}>
                        <div>
                          <label>X轴字段:</label>
                          {getChartFieldConfig(chartData.chart_type).xFieldRequired && (
                            <Select
                              value={chartData.visualization_settings.x_field}
                              onChange={(value) => handleFieldMappingChange('x_field', value)}
                              style={{ width: '100%' }}
                              placeholder="选择X轴字段"
                              disabled={availableFields.length === 0}
                            >
                              {availableFields.map(field => (
                                <Option key={field} value={field}>
                                  {field}
                                </Option>
                              ))}
                            </Select>
                          )}
                          {!getChartFieldConfig(chartData.chart_type).xFieldRequired && (
                            <div style={{ color: '#999', fontStyle: 'italic' }}>无需X轴字段</div>
                          )}
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>Y轴字段:</label>
                          {getChartFieldConfig(chartData.chart_type).showMultipleY ? (
                            <Select
                              mode="multiple"
                              value={chartData.visualization_settings.y_fields}
                              onChange={(values) => {
                                // 限制最大选择数量
                                const limitedValues = values.slice(0, getChartFieldConfig(chartData.chart_type).yFieldsMax);
                                handleFieldMappingChange('y_fields', limitedValues);
                              }}
                              style={{ width: '100%' }}
                              placeholder={`选择${getChartFieldConfig(chartData.chart_type).yFieldsRequired}个以上字段`}
                              disabled={availableFields.length === 0}
                              maxTagCount={3}
                            >
                              {availableFields.map(field => (
                                <Option key={field} value={field}>
                                  {field}
                                </Option>
                              ))}
                            </Select>
                          ) : (
                            <Select
                              value={chartData.visualization_settings.y_fields?.[0] || undefined}
                              onChange={(value) => handleFieldMappingChange('y_fields', value ? [value] : [])}
                              style={{ width: '100%' }}
                              placeholder={`选择1个字段`}
                              disabled={availableFields.length === 0}
                            >
                              {availableFields.map(field => (
                                <Option key={field} value={field}>
                                  {field}
                                </Option>
                              ))}
                            </Select>
                          )}
                          <div style={{ marginTop: '4px', fontSize: '12px', color: '#999' }}>
                            {getChartFieldConfig(chartData.chart_type).description}
                          </div>
                        </div>
                      </Col>
                    </Row>
                    
                    <Row gutter={16} style={{ marginTop: '16px' }}>
                      <Col span={8}>
                        <div>
                          <label>排序方式:</label>
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
                        <div>
                          <label>排序顺序:</label>
                          <Select
                            value={chartData.visualization_settings.sort_order}
                            onChange={(value) => handleFieldMappingChange('sort_order', value)}
                            style={{ width: '100%' }}
                            placeholder="选择排序顺序"
                          >
                            <Option value="asc">升序</Option>
                            <Option value="desc">降序</Option>
                          </Select>
                        </div>
                      </Col>
                      

                      
                      <Col span={8}>
                        <div>
                          <label>X轴标题:</label>
                          <Input
                            value={chartData.visualization_settings.x_axis_title}
                            onChange={(e) => handleFieldMappingChange('x_axis_title', e.target.value)}
                            placeholder="X轴标题"
                          />
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>Y轴标题:</label>
                          <Input
                            value={chartData.visualization_settings.y_axis_title}
                            onChange={(e) => handleFieldMappingChange('y_axis_title', e.target.value)}
                            placeholder="Y轴标题"
                          />
                        </div>
                      </Col>
                    </Row>
                    
                    {/* 图表样式设置 */}
                    <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>图表样式设置</div>
                    <Row gutter={16} style={{ marginTop: '8px' }}>
                      <Col span={8}>
                        <div>
                          <label>显示图例:</label>
                          <Switch 
                            checked={chartData.visualization_settings.show_legend !== false}
                            onChange={(checked) => handleFieldMappingChange('show_legend', checked)}
                            style={{ marginLeft: '8px' }}
                          />
                        </div>
                      </Col>
                      
                      {/* <Col span={8}>
                        <div>
                          <label>启用动画:</label>
                          <Switch 
                            checked={chartData.visualization_settings.animation !== false}
                            onChange={(checked) => handleFieldMappingChange('animation', checked)}
                            style={{ marginLeft: '8px' }}
                          />
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>图例位置:</label>
                          <Select
                            value={chartData.visualization_settings.legend_position || 'right'}
                            onChange={(value) => handleFieldMappingChange('legend_position', value)}
                            style={{ width: '100%' }}
                          >
                            <Option value="top">顶部</Option>
                            <Option value="bottom">底部</Option>
                            <Option value="left">左侧</Option>
                            <Option value="right">右侧</Option>
                          </Select>
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>旋转标签:</label>
                          <Switch 
                            checked={chartData.visualization_settings.rotate_labels !== false}
                            onChange={(checked) => handleFieldMappingChange('rotate_labels', checked)}
                            style={{ marginLeft: '8px' }}
                          />
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>显示网格线:</label>
                          <Switch 
                            checked={chartData.visualization_settings.show_grid !== false}
                            onChange={(checked) => handleFieldMappingChange('show_grid', checked)}
                            defaultChecked
                            style={{ marginLeft: '8px' }}
                          />
                        </div>
                      </Col> */}
                    </Row>
                    
                    {/* 添加刷新预览按钮 */}
                    <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                      <Button 
                        type="primary" 
                        onClick={() => {
                          // 强制触发状态更新以重新渲染图表
                          setPreviewData(prev => prev); // 触发重新渲染
                        }}
                        icon={<PlayCircleOutlined />}
                      >
                        刷新预览
                      </Button>
                    </div>
                    
                    {/* 图表预览区域 - 使用正确的变量名 */}
                    <div style={{ marginTop: '24px', border: '1px solid #d9d9d9', borderRadius: '8px', padding: '16px' }}>
                      <h3 style={{ marginBottom: '16px', color: '#1890ff' }}>图表预览</h3>
                      {previewData.length > 0 && 
                       chartData.visualization_settings.x_field && 
                       chartData.visualization_settings.y_fields?.length > 0 ? (
                        <div style={{ height: '400px' }}>
                          <ChartFactory
                            config={{
                              type: chartData.chart_type,
                              title: chartData.name,
                              xField: chartData.visualization_settings.x_field,
                              yFields: chartData.visualization_settings.y_fields || [],
                              sort_by: chartData.visualization_settings.sort_by,
                              sort_order: chartData.visualization_settings.sort_order,
                              
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
                              grid: {
                                left: '3%',
                                right: '4%',
                                bottom: '15%',
                                containLabel: true
                              }
                            }}
                            data={previewData}
                            style={{ height: '400px', width: '100%' }}
                          />
                        </div>
                      ) : (
                        <div style={{ 
                          height: '400px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: '#f5f5f5',
                          border: '2px dashed #d9d9d9',
                          borderRadius: '8px'
                        }}>
                          <div style={{ textAlign: 'center', padding: '20px' }}>
                            {previewData.length > 0 ? (
                              <p style={{ color: '#999' }}>配置完成后点击"刷新预览"按钮</p>
                            ) : (
                              <p style={{ color: '#999' }}>请先执行查询加载数据</p>
                            )}
                          </div>
                        </div>
                      )}
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