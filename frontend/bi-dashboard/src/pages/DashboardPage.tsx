// frontend/bi-dashboard/src/pages/DashboardPage.tsx
// frontend/bi-dashboard/src/pages/DashboardPage.tsx
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Modal, Form, Input, Select, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, DragOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { AuthService } from '../services/authService';
import { ChartService } from '../services/chartService';
import { DashboardService } from '../services/dashboardService';
import { ChartFactory } from '../components/charts/ChartFactory';
import './DashboardPage.css';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// 添加拖拽相关的CSS类
const gridStyles = `
.dashboard-grid {
  padding: 16px;
  min-height: 600px;
  width: 100%;
  display: block;
}

.dashboard-card-wrapper {
  position: relative;
  border-radius: 8px;
  transition: all 0.3s ease;
  height: 100%;
}

.dashboard-card-wrapper:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.drag-handle {
  position: absolute;
  top: 8px;
  right: 8px;
  cursor: move;
  z-index: 10;
  background: rgba(255,255,255,0.9);
  border-radius: 4px;
  padding: 4px;
}

.chart-container {
  height: 100%;
  overflow: hidden;
}

.dashboard-card-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.dashboard-card-inner .ant-card-body {
  flex: 1 1 auto;
  height: auto !important;
  overflow: hidden;
}

.dashboard-grid .react-grid-layout {
  min-height: 600px;
  height: auto !important;
}

.dashboard-grid .react-grid-item {
  transition: all 0.2s ease;
  overflow: hidden;
}

.dashboard-grid .react-grid-item > * {
  height: 100%;
  overflow: hidden;
}

.dashboard-grid .react-grid-item.react-grid-placeholder {
  background: rgba(24, 144, 255, 0.15);
  border: 1px dashed #1890ff;
}

.dashboard-grid .react-resizable-handle {
  z-index: 20;
}
`;

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

// 在组件顶部添加样式
const styleSheet = document.createElement("style");
styleSheet.innerText = gridStyles;
document.head.appendChild(styleSheet);

// 从ChartService导入ChartResponse类型
type ChartResponse = Awaited<ReturnType<typeof ChartService.getUserCharts>>[0];

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
  cards: DashboardCard[];
}

interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// 类型转换函数：将ChartResponse转换为Chart
const convertChartResponseToChart = (chartResponse: ChartResponse): Chart => {
  return {
    id: chartResponse.id,
    name: chartResponse.name,
    chart_type: chartResponse.chart_type,
    dataset_query: chartResponse.dataset_query,
    visualization_settings: chartResponse.visualization_settings,
    data_source_id: chartResponse.database_id,  // 字段名映射
    created_by: chartResponse.creator_id        // 字段名映射
  };
};

// 添加请求监控
const requestMonitor = {
  requestCount: 0,
  startTime: Date.now(),
  logRequest: (chartId: number, type: 'cache' | 'network') => {
    requestMonitor.requestCount++;
    const elapsed = Date.now() - requestMonitor.startTime;
    console.log(`[${elapsed}ms] 第${requestMonitor.requestCount}个请求 - 图表${chartId} (${type})`);
  }
};

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [charts, setCharts] = useState<Chart[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<Dashboard | null>(null);
  // 用 ref 持有最新 selectedDashboard，避免 onLayoutChange 的闭包拿到旧值导致重复更新/重复提示
  const selectedDashboardRef = useRef<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [chartDataCache, setChartDataCache] = useState<Record<number, any[]>>({});
  const [chartSearchText, setChartSearchText] = useState('');
  const [chartDropdownOpen, setChartDropdownOpen] = useState(false);
  
  // 全局请求状态管理
  const globalRequestStatus = useRef<Record<number, 'pending' | 'completed'>>({});

  // 请求去重Map，用于防止同一时间的重复请求
  const requestPendingMap = useRef<Record<number, Promise<any[]>>>({});

  // 布局更新去抖：react-grid-layout 在拖拽/缩放过程中会频繁触发 onLayoutChange，
  // 这里把多次变化合并成一次后端更新，避免出现“卡片更新成功”弹两次/多次
  const layoutUpdateTimerRef = useRef<number | null>(null);
  const pendingLayoutRef = useRef<GridLayoutItem[] | null>(null);

  // 页面卸载时清理定时器，避免卸载后 setState
  useEffect(() => {
    return () => {
      if (layoutUpdateTimerRef.current) {
        window.clearTimeout(layoutUpdateTimerRef.current);
      }
    };
  }, []);

  // 加载图表数据的函数 - 增加请求去重机制
  const loadChartData = useCallback(async (chartId: number) => {
    // 首先检查内存缓存
    if (chartDataCache[chartId]) {
      requestMonitor.logRequest(chartId, 'cache');
      console.log(`从缓存获取图表数据: ${chartId}`);
      return chartDataCache[chartId];
    }
    
    // 检查全局请求状态
    if (globalRequestStatus.current[chartId] === 'pending') {
      console.log(`图表${chartId}请求已在进行中，等待完成...`);
      // 等待正在进行的请求完成
      if (requestPendingMap.current[chartId]) {
        return requestPendingMap.current[chartId];
      }
    }
    
    // 检查是否有正在进行的相同请求
    if (requestPendingMap.current[chartId]) {
      console.log(`发现重复请求，等待已有请求完成: ${chartId}`);
      return requestPendingMap.current[chartId];
    }
    
    try {
      requestMonitor.logRequest(chartId, 'network');
      console.log(`开始加载图表数据: ${chartId}`);
      
      // 设置全局请求状态
      globalRequestStatus.current[chartId] = 'pending';
      
      // 创建新的请求Promise并存储到pending map
      const requestPromise = ChartService.executeChartQuery(chartId);
      requestPendingMap.current[chartId] = requestPromise;
      
      const data = await requestPromise;
      console.log(`图表${chartId}数据加载完成:`, data);
      
      // 更新缓存
      setChartDataCache(prev => ({ ...prev, [chartId]: data }));
      
      // 更新全局请求状态
      globalRequestStatus.current[chartId] = 'completed';
      
      // 清除pending状态
      delete requestPendingMap.current[chartId];
      
      return data;
    } catch (error: any) {
      console.error('加载图表数据失败:', error);
      message.error(`加载图表数据失败: ${error.message || '未知错误'}`);
      
      // 清除状态
      globalRequestStatus.current[chartId] = 'completed';
      delete requestPendingMap.current[chartId];
      
      return [];
    }
  }, [chartDataCache]);

  // 加载图表列表
  const loadCharts = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const userCharts = await ChartService.getUserCharts();
      // 使用转换函数将ChartResponse数组转换为Chart数组
      const convertedCharts = userCharts.map(convertChartResponseToChart);
      setCharts(convertedCharts);
    } catch (error: any) {
      message.error(error.message || '获取图表列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载仪表盘列表
  const loadDashboards = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const userDashboards = await DashboardService.getUserDashboards();
      setDashboards(userDashboards);
      
      // 默认选择第一个仪表盘
      if (userDashboards.length > 0 && !selectedDashboard) {
        setSelectedDashboard(userDashboards[0]);
      }
    } catch (error: any) {
      message.error(error.message || '获取仪表盘列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 创建新仪表盘
  const handleCreateDashboard = async (values: any) => {
    try {
      console.log('创建仪表盘请求:', values);
      
      if (!values.name || !values.name.trim()) {
        message.error('请输入仪表盘名称');
        return;
      }
      
      const newDashboard = await DashboardService.createDashboard({
        name: values.name.trim(),
        description: values.description ? values.description.trim() : ''
      });
      
      console.log('创建成功:', newDashboard);
      
      setDashboards([...dashboards, newDashboard]);
      setSelectedDashboard(newDashboard);
      setCreateModalVisible(false);
      createForm.resetFields();
      message.success('仪表盘创建成功');
      
      // 刷新仪表盘列表
      await loadDashboards();
    } catch (error: any) {
      console.error('创建仪表盘失败:', error);
      message.error(error.message || '创建仪表盘失败，请检查网络连接和权限');
    }
  };

  // 向仪表盘添加图表
  const handleAddChartToDashboard = async (chartId: number) => {
    if (!selectedDashboard) {
      message.warning('请先选择一个仪表盘');
      return;
    }

    try {
      const newCard = await DashboardService.addChartToDashboard(selectedDashboard.id, {
        chart_id: chartId,
        card_row: 0,
        card_col: 0,
        size_x: 6,
        size_y: 5
      });
      
      // 手动关联chart数据
      const chartData = charts.find(c => c.id === chartId);
      const cardWithChart = {
        ...newCard,
        chart: chartData
      };
      
      // 更新本地状态
      const updatedDashboard = {
        ...selectedDashboard,
        cards: [...selectedDashboard.cards, cardWithChart]
      };
      
      setSelectedDashboard(updatedDashboard);
      
      // 更新仪表盘列表
      setDashboards(dashboards.map(d => 
        d.id === selectedDashboard.id ? updatedDashboard : d
      ));
      
      message.success('图表已添加到仪表盘');
    } catch (error: any) {
      message.error(error.message || '添加图表失败');
    }
  };

  // 向仪表盘添加图表（可指定落点网格坐标）
  const handleAddChartToDashboardAt = async (
    chartId: number,
    pos: { x: number; y: number; w?: number; h?: number }
  ) => {
    if (!selectedDashboard) {
      message.warning('请先选择一个仪表盘');
      return;
    }

    const sizeX = pos.w ?? 6;
    const sizeY = pos.h ?? 5;

    try {
      const newCard = await DashboardService.addChartToDashboard(selectedDashboard.id, {
        chart_id: chartId,
        card_row: pos.y ?? 0,
        card_col: pos.x ?? 0,
        size_x: sizeX,
        size_y: sizeY
      });

      // 手动关联 chart 数据
      const chartData = charts.find(c => c.id === chartId);
      const cardWithChart = {
        ...newCard,
        chart: chartData
      };

      // 更新本地状态
      const updatedDashboard = {
        ...selectedDashboard,
        cards: [...selectedDashboard.cards, cardWithChart]
      };

      setSelectedDashboard(updatedDashboard);
      setDashboards(dashboards.map(d => (d.id === selectedDashboard.id ? updatedDashboard : d)));
      message.success('图表已添加到仪表盘');
    } catch (error: any) {
      message.error(error.message || '添加图表失败');
    }
  };

  // 从仪表盘移除图表
  const handleRemoveChartFromDashboard = async (cardId: number) => {
    try {
      await DashboardService.removeChartFromDashboard(cardId);
      
      // 更新本地状态
      if (selectedDashboard) {
        const updatedDashboard = {
          ...selectedDashboard,
          cards: selectedDashboard.cards.filter(card => card.id !== cardId)
        };
        
        setSelectedDashboard(updatedDashboard);
        
        // 更新仪表盘列表
        setDashboards(dashboards.map(d => 
          d.id === selectedDashboard.id ? updatedDashboard : d
        ));
      }
      
      message.success('图表已从仪表盘移除');
    } catch (error: any) {
      message.error(error.message || '移除图表失败');
    }
  };

  // 更新卡片位置和大小
  const handleCardResizeOrMove = async (cardId: number, updates: any) => {
    try {
      await DashboardService.updateDashboardCard(cardId, updates);
      
      // 更新本地状态
      if (selectedDashboard) {
        const updatedCards = selectedDashboard.cards.map(card => 
          card.id === cardId ? { ...card, ...updates } : card
        );
        
        const updatedDashboard = {
          ...selectedDashboard,
          cards: updatedCards
        };
        
        setSelectedDashboard(updatedDashboard);
        
        // 更新仪表盘列表
        setDashboards(dashboards.map(d => 
          d.id === selectedDashboard.id ? updatedDashboard : d
        ));
      }
    } catch (error: any) {
      message.error(error.message || '更新卡片失败');
    }
  };

  // 保持 selectedDashboardRef 始终为最新，供布局更新逻辑使用
  useEffect(() => {
    selectedDashboardRef.current = selectedDashboard;
  }, [selectedDashboard]);


  // 初始化数据加载 - 最终正确版本
  // 统一的数据加载逻辑 - 最终可靠版本
  useEffect(() => {
    if (user) {
      console.log('用户已认证，开始数据加载流程...');
      
      // 等待800ms确保authContext完全初始化
      const timer = setTimeout(() => {
        console.log('800ms后，执行实际数据加载');
        try {
          console.log('加载仪表盘列表...');
          loadDashboards();
          
          console.log('加载图表列表...');
          loadCharts();
          
          console.log('数据加载完成');
        } catch (error) {
          console.error('数据加载失败:', error);
          // 重试机制
          setTimeout(() => {
            loadDashboards();
            loadCharts();
          }, 1000);
        }
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [user]);

  // 渲染可拖拽的图表项
  const renderDraggableChartItem = (chart: Chart) => (
    <div 
      key={chart.id}
      className="draggable-chart-item"
      draggable
      onDragStart={(e) => {
        // react-grid-layout 外部拖拽需要 dataTransfer 有内容（部分浏览器）
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('chartId', chart.id.toString());
        e.dataTransfer.setData('text/plain', chart.id.toString());
      }}
    >
      <Card 
        size="small"
        hoverable
        onClick={() => handleAddChartToDashboard(chart.id)}
      >
        <div className="chart-item-content">
          <h4>{chart.name}</h4>
          <p className="chart-type">{chart.chart_type}</p>
          <div className="chart-actions">
            <Button 
              type="primary" 
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleAddChartToDashboard(chart.id);
              }}
            >
              添加到仪表盘
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );

  const filteredCharts = useMemo(() => {
    const q = chartSearchText.trim().toLowerCase();
    if (!q) return charts;
    return charts.filter(c => {
      const name = (c.name || '').toLowerCase();
      const type = (c.chart_type || '').toLowerCase();
      return name.includes(q) || type.includes(q);
    });
  }, [charts, chartSearchText]);

  // 渲染仪表盘卡片组件 - 使用网格布局的卡片内容
  const DashboardCardComponent: React.FC<{ card: DashboardCard }> = ({ card }) => {
    const [chartData, setChartData] = useState<any[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 使用 ref 跟踪是否已经加载过，避免重复加载
    const hasLoadedRef = useRef<number | null>(null);
    const isLoadingRef = useRef(false);
    
    // 在组件挂载时加载数据 - 优化依赖项
    useEffect(() => {
      const chartId = card.chart?.id;
      
      // 如果图表ID没有变化且已经加载过，则跳过
      if (chartId && hasLoadedRef.current === chartId) {
        console.log(`图表${chartId}已加载过，跳过重复加载`);
        return;
      }
      
      // 如果正在加载中，跳过
      if (isLoadingRef.current) {
        console.log(`图表${chartId}正在加载中，跳过重复请求`);
        return;
      }
      
      const loadData = async () => {
        if (!chartId) {
          setError('图表数据缺失');
          return;
        }
        
        // 标记为正在加载
        isLoadingRef.current = true;
        hasLoadedRef.current = chartId;
        setDataLoading(true);
        setError(null);
        
        try {
          console.log(`加载卡片${card.id}的图表数据，图表ID: ${chartId}`);
          const data = await loadChartData(chartId);
          
          // 验证数据格式和内容
          if (!Array.isArray(data)) {
            throw new Error('返回的数据格式不正确');
          }
          
          // 检查数据是否为空
          if (data.length === 0) {
            setError('没有查询到数据，请检查SQL查询');
            setChartData([]);
            return;
          }
          
          // 验证X轴字段是否存在
          const xField = card.chart.visualization_settings?.x_field || '';
          if (xField && !Object.keys(data[0] || {}).includes(xField)) {
            console.warn(`X轴字段 '${xField}' 在数据中不存在，使用第一个字段`);
            // 使用第一个字段作为X轴
            const firstField = Object.keys(data[0] || {})[0];
            setChartData(data.map(item => ({
              ...item,
              [firstField]: item[firstField] || ''
            })));
          } else {
            setChartData(data);
          }
          console.log(`卡片${card.id}数据加载完成，共${data.length}条记录`);
        } catch (error: any) {
          console.error(`加载卡片${card.id}数据失败:`, error);
          // 如果是字段不存在，忽略错误，保持图表原样
          const errMsg = error?.message || '';
          const isFieldMissing = errMsg.includes('列') || errMsg.includes('column') || errMsg.includes('Column') || errMsg.includes('不存在') || errMsg.includes('not exist');
          if (isFieldMissing) {
            console.warn(`图表字段配置变更中，暂不更新`);
            hasLoadedRef.current = null;
          } else {
            // 友好错误提示
            let friendlyError = '数据加载失败';
            if (errMsg.includes('表') || errMsg.includes('table') || errMsg.includes('Table')) {
              friendlyError = '数据表配置异常';
            } else if (errMsg.includes('连接') || errMsg.includes('connection') || errMsg.includes('timeout')) {
              friendlyError = '数据连接超时，请稍后重试';
            } else if (errMsg.includes('权限') || errMsg.includes('permission') || errMsg.includes('denied')) {
              friendlyError = '暂无数据访问权限';
            }
            setError(friendlyError);
            message.error(`图表"${card.chart?.name || '未知'}"数据加载失败`);
            hasLoadedRef.current = null;
          }
        } finally {
          setDataLoading(false);
          isLoadingRef.current = false;
        }
      };
      
      loadData();
    }, [card.chart?.id, card.id, loadChartData]); // 添加 loadChartData 到依赖数组
    
    if (!card.chart) {
      return (
        <div 
          className="dashboard-card-wrapper"
          style={{
            gridRow: `span ${card.size_y}`,
            gridColumn: `span ${card.size_x}`,
            border: '2px dashed #ff4d4f',
            backgroundColor: '#fff2f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px'
          }}
        >
          <div style={{ textAlign: 'center', color: '#ff4d4f' }}>
            <p>图表数据缺失</p>
            <Button 
              type="link" 
              danger
              onClick={() => handleRemoveChartFromDashboard(card.id)}
            >
              移除卡片
            </Button>
          </div>
        </div>
      );
    }
    
    return (
      <div 
        key={card.id}
        className="dashboard-card-wrapper"
        style={{ height: '100%', position: 'relative' }}
      >
        <div className="drag-handle">
          <DragOutlined />
        </div>
        <Card
          title={
            <div style={{ textAlign: 'center' }}>
              <div>{card.chart.name}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: 4 }}>
                {card.chart.chart_type}
              </div>
            </div>
          }
          extra={
            <Button 
              type="text" 
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveChartFromDashboard(card.id)}
              size="small"
              danger
            />
          }
          className="dashboard-card-inner"
          style={{ height: '100%' }}
          bodyStyle={{ padding: '12px' }}
        >
          {dataLoading ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%' 
            }}>
              <Spin tip="加载数据中..." />
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
                正在执行查询...
              </div>
            </div>
          ) : error ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%',
              color: '#ff4d4f'
            }}>
              <div style={{ marginBottom: '8px' }}>⚠️</div>
              <div style={{ fontSize: '14px', textAlign: 'center' }}>{error}</div>
              <Button 
                type="link" 
                size="small" 
                onClick={() => {
                  setError(null);
                  setChartDataCache(prev => {
                    const newCache = { ...prev };
                    delete newCache[card.chart!.id];
                    return newCache;
                  });
                }}
              >
                重新加载
              </Button>
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%',
              color: '#888'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ marginBottom: '8px' }}>📊</div>
                <div>暂无数据</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  查询返回空结果
                </div>
              </div>
            </div>
          ) : (
            <div className="chart-container">
              {(() => {
                // 兼容历史数据与新数据的可视化配置
                // 同时兼容后端可能返回的 JSON 字符串形式
                let viz: any = card.chart!.visualization_settings || {};
                if (typeof viz === 'string') {
                  try {
                    viz = JSON.parse(viz);
                  } catch (e) {
                    console.warn('解析 visualization_settings 失败，使用空对象:', e, viz);
                    viz = {};
                  }
                }

                console.log('DashboardCard 可视化配置:', {
                  raw: card.chart!.visualization_settings,
                  parsed: viz
                });

                // 统一处理排序配置：优先使用新字段，其次兼容老的 graph.sort_by / graph.sort_order
                const sortBy =
                  viz.sort_by ??
                  viz['graph.sort_by'] ??
                  undefined;
                const sortOrder =
                  viz.sort_order ??
                  viz['graph.sort_order'] ??
                  undefined;

                // 统一字段映射（如果历史数据里有 graph_dimensions / graph_metrics，则作为兜底）
                const xField = viz.x_field ?? (Array.isArray(viz.graph_dimensions) ? viz.graph_dimensions[0] : undefined);
                const yFields =
                  viz.y_fields ??
                  (Array.isArray(viz.graph_metrics) ? viz.graph_metrics : undefined);
                // Y 轴聚合方式：优先使用新字段，其次兼容老的 graph.y_agg_method
                const yAggMethod =
                  viz.y_agg_method ??
                  viz['graph.y_agg_method'] ??
                  undefined;

                return (
                  <ChartFactory
                    config={{
                      type: card.chart!.chart_type,
                      title: '', // 不显示重复标题
                      xAxis: {
                        name: viz.x_axis_title || 'X轴'
                      },
                      yAxis: {
                        name: viz.y_axis_title || 'Y轴'
                      },
                      series:
                        (yFields || []).map((field: string) => ({
                          name: field,
                          field: field
                        })) || [],
                      xField,
                      yFields,
                      colorField: viz.color_field,
                      y_agg_method: yAggMethod,
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
                      // 排序配置（如果没有配置则交给 ChartFactory 自己跳过排序）
                      sort_by: sortBy,
                      sort_order: sortOrder,
                      // 其他配置
                      legend: {
                        show: viz.show_legend !== false,
                        bottom: 10
                      },
                      tooltip: {
                        show: viz.show_tooltip !== false,
                        trigger: 'axis'
                      },
                      // 不再透传 grid_padding，仪表盘视图也统一交给 ChartFactory 控制网格与居中。
                    }}
                    data={chartData}
                    style={{ height: '100%', width: '100%' }}
                  />
                );
              })()}
              <div style={{ 
                position: 'absolute', 
                bottom: '4px', 
                right: '8px', 
                fontSize: '10px', 
                color: '#aaa' 
              }}>
                {chartData.length}条记录
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div
          className="header-content"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h1>仪表盘</h1>
          <Space>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              新建仪表盘
            </Button>
          </Space>
        </div>
      </div>
      
      <div className="dashboard-content">
        <Row gutter={24}>
          {/* 左侧图表列表 - 增强版本 */}
          <Col span={6}>
            <Card 
              title="添加图表"
              className="chart-list-panel"
              extra={
                <Button 
                  type="link" 
                  size="small" 
                  onClick={loadCharts}
                  loading={loading}
                >
                  刷新
                </Button>
              }
            >
              {charts.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '24px', 
                  color: '#888' 
                }}>
                  <div style={{ marginBottom: '8px' }}>📊</div>
                  <div>暂无可用图表</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    请先创建图表
                  </div>
                  <Button 
                    type="primary" 
                    size="small" 
                    style={{ marginTop: '12px' }}
                    onClick={() => window.location.hash = '#/visualization-builder'}
                  >
                    创建图表
                  </Button>
                </div>
              ) : (
                <div className="chart-search-panel">
                  <Select
                    showSearch
                    value={undefined}
                    placeholder="输入搜索图表（可拖拽到右侧画布）"
                    style={{ width: '100%' }}
                    searchValue={chartSearchText}
                    onSearch={(val) => setChartSearchText(val)}
                    open={chartDropdownOpen}
                    onDropdownVisibleChange={(open) => setChartDropdownOpen(open)}
                    filterOption={false}
                    options={[]}
                    notFoundContent={null}
                    dropdownRender={() => (
                      <div className="chart-search-dropdown">
                        <div className="chart-search-dropdown-hint">
                          提示：拖拽图表到右侧画布即可添加
                        </div>

                        {filteredCharts.length === 0 ? (
                          <div style={{ padding: 12 }}>
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配图表" />
                          </div>
                        ) : (
                          <div className="chart-search-results">
                            {filteredCharts.map(chart => (
                              <div
                                key={chart.id}
                                className="chart-search-item"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = 'copy';
                                  e.dataTransfer.setData('chartId', chart.id.toString());
                                  e.dataTransfer.setData('text/plain', chart.id.toString());
                                }}
                                onClick={() => {
                                  handleAddChartToDashboard(chart.id);
                                  setChartDropdownOpen(false);
                                  setChartSearchText('');
                                }}
                              >
                                <div className="chart-search-item-main">
                                  <div className="chart-search-item-title">{chart.name}</div>
                                  <div className="chart-search-item-meta">{chart.chart_type}</div>
                                </div>
                                <Button
                                  type="primary"
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddChartToDashboard(chart.id);
                                    setChartDropdownOpen(false);
                                    setChartSearchText('');
                                  }}
                                >
                                  添加
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  />

                  <div className="chart-search-below">
                    <div className="chart-search-below-title">或从列表拖拽</div>
                    <div className="chart-list">
                      {charts.map(chart => renderDraggableChartItem(chart))}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </Col>
          
          {/* 右侧仪表盘区域 */}
          <Col span={18}>
            {selectedDashboard ? (
              <Card 
                title={selectedDashboard.name}
                extra={
                  <Space>
                    <Button onClick={() => loadDashboards()}>刷新</Button>
                  </Space>
                }
              >
                <div className="dashboard-grid">
                  <AutoWidthGridLayout
                    cols={12}
                    rowHeight={60}
                    margin={[16, 16]}
                    draggableHandle=".drag-handle"
                    isDroppable
                    droppingItem={{ i: '__dropping-elem__', w: 6, h: 5 }}
                    onDrop={(layout: GridLayoutItem[], item: GridLayoutItem, e: DragEvent) => {
                      try {
                        const raw =
                          e.dataTransfer?.getData('chartId') ||
                          e.dataTransfer?.getData('text/plain') ||
                          '';
                        const chartId = Number.parseInt(raw, 10);
                        if (!Number.isFinite(chartId)) return;
                        handleAddChartToDashboardAt(chartId, { x: item.x, y: item.y, w: item.w, h: item.h });
                      } catch {
                        // ignore drop parse error
                      }
                    }}
                    onLayoutChange={(layout: GridLayoutItem[]) => {
                      // 去抖合并：只在用户停止一小段时间后再提交更新
                      pendingLayoutRef.current = layout;
                      if (layoutUpdateTimerRef.current) {
                        window.clearTimeout(layoutUpdateTimerRef.current);
                      }

                      layoutUpdateTimerRef.current = window.setTimeout(async () => {
                        const latestDashboard = selectedDashboardRef.current;
                        const latestLayout = pendingLayoutRef.current;
                        if (!latestDashboard || !latestLayout) return;

                        const cardMap = new Map(
                          latestDashboard.cards.map(card => [card.id.toString(), card])
                        );

                        const changes: Array<{ cardId: number; updates: any }> = [];
                        latestLayout.forEach(item => {
                          const card = cardMap.get(item.i);
                          if (!card) return;

                          const updates: any = {};
                          if (card.card_row !== item.y) updates.card_row = item.y;
                          if (card.card_col !== item.x) updates.card_col = item.x;
                          if (card.size_x !== item.w) updates.size_x = item.w;
                          if (card.size_y !== item.h) updates.size_y = item.h;

                          if (Object.keys(updates).length > 0) {
                            changes.push({ cardId: card.id, updates });
                          }
                        });

                        if (changes.length === 0) return;

                        try {
                          // 先提交到后端（并行）
                          const results = await Promise.allSettled(
                            changes.map(c => DashboardService.updateDashboardCard(c.cardId, c.updates))
                          );

                          const hasRejected = results.some(r => r.status === 'rejected');
                          if (hasRejected) {
                            message.error('部分卡片更新失败，请稍后重试');
                          }

                          // 本地一次性更新，避免多次 setState 导致额外的 onLayoutChange 循环
                          const updatedCards = latestDashboard.cards.map(card => {
                            const change = changes.find(c => c.cardId === card.id);
                            return change ? { ...card, ...change.updates } : card;
                          });

                          const updatedDashboard = {
                            ...latestDashboard,
                            cards: updatedCards
                          };

                          setSelectedDashboard(updatedDashboard);
                          setDashboards(prev =>
                            prev.map(d => (d.id === updatedDashboard.id ? updatedDashboard : d))
                          );
                        } catch (e: any) {
                          message.error(e?.message || '更新卡片失败');
                        }
                      }, 250);
                    }}
                  >
                    {selectedDashboard.cards.map(card => (
                      <div
                        key={card.id.toString()}
                        data-grid={{
                          x: card.card_col ?? 0,
                          y: card.card_row ?? 0,
                          w: card.size_x ?? 6,
                          // Clamp existing cards too: old dashboards may have very small size_y values,
                          // which leads to ECharts being clipped (not just legend overlap).
                          h: Math.max(card.size_y ?? 4, 5),
                          minW: 3,
                          // 60px * 5 = 300px（再减去 card header/padding 后仍有足够绘图区）
                          minH: 5
                        }}
                      >
                        <DashboardCardComponent card={card} />
                      </div>
                    ))}
                  </AutoWidthGridLayout>
                </div>
              </Card>
            ) : (
              <Card>
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p>请选择或创建一个仪表盘</p>
                </div>
              </Card>
            )}
          </Col>
        </Row>
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
        <Form
          form={createForm}
          onFinish={handleCreateDashboard}
          layout="vertical"
        >
          <Form.Item
            name="name"
            label="仪表盘名称"
            rules={[{ required: true, message: '请输入仪表盘名称' }]}
          >
            <Input placeholder="输入仪表盘名称" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="输入仪表盘描述" rows={3} />
          </Form.Item>
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
              <Button onClick={() => setCreateModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};