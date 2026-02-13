// frontend/bi-dashboard/src/pages/DashboardPage.tsx
// frontend/bi-dashboard/src/pages/DashboardPage.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Modal, Form, Input } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, DragOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { AuthService } from '../services/authService';
import { ChartService } from '../services/chartService';
import { DashboardService } from '../services/dashboardService';
import { ChartFactory } from '../components/charts/ChartFactory';
import './DashboardPage.css';

// 添加拖拽相关的CSS类
const gridStyles = `
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 60px;
  gap: 16px;
  padding: 16px;
  min-height: 600px;
}

.dashboard-card-wrapper {
  position: relative;
  border-radius: 8px;
  transition: all 0.3s ease;
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
`;

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
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [draggedCard, setDraggedCard] = useState<DashboardCard | null>(null);
  const [chartDataCache, setChartDataCache] = useState<Record<number, any[]>>({});
  
  // 全局请求状态管理
  const globalRequestStatus = useRef<Record<number, 'pending' | 'completed'>>({});

  // 请求去重Map，用于防止同一时间的重复请求
  const requestPendingMap = useRef<Record<number, Promise<any[]>>>({});
  
  // 加载图表数据的函数 - 增加请求去重机制
  const loadChartData = async (chartId: number) => {
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
  };

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
        size_y: 4
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
      const updatedCard = await DashboardService.updateDashboardCard(cardId, updates);
      
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
      
      message.success('卡片更新成功');
    } catch (error: any) {
      message.error(error.message || '更新卡片失败');
    }
  };


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
        e.dataTransfer.setData('chartId', chart.id.toString());
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

  // 渲染仪表盘卡片组件 - 增强版本
  const DashboardCardComponent: React.FC<{ card: DashboardCard }> = ({ card }) => {
    const [chartData, setChartData] = useState<any[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // 在组件挂载时加载数据 - 优化依赖项
    useEffect(() => {
      const loadData = async () => {
        if (!card.chart?.id) {
          setError('图表数据缺失');
          return;
        }
        
        setDataLoading(true);
        setError(null);
        try {
          console.log(`加载卡片${card.id}的图表数据，图表ID: ${card.chart.id}`);
          const data = await loadChartData(card.chart.id);
          
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
          setError(error.message || '数据加载失败');
          message.error(`图表"${card.chart?.name || '未知'}"数据加载失败`);
        } finally {
          setDataLoading(false);
        }
      };
      
      loadData();
    }, [card.chart?.id]); // 只依赖chart.id，避免因其他属性变化导致的重复请求
    
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
        style={{
          gridRow: `span ${card.size_y}`,
          gridColumn: `span ${card.size_x}`,
          zIndex: draggedCard?.id === card.id ? 1000 : 1
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          setDraggedCard(card);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={async (e) => {
          e.preventDefault();
          if (draggedCard && draggedCard.id !== card.id) {
            // 计算新的位置
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / (rect.width / card.size_x));
            const y = Math.floor((e.clientY - rect.top) / (rect.height / card.size_y));
            
            // 更新位置
            await handleCardResizeOrMove(draggedCard.id, {
              card_row: Math.max(0, card.card_row + y),
              card_col: Math.max(0, card.card_col + x)
            });
            setDraggedCard(null);
          }
        }}
      >
        <div className="drag-handle">
          <DragOutlined />
        </div>
        <Card 
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{card.chart.name}</span>
              <span style={{ fontSize: '12px', color: '#888' }}>
                {card.chart.chart_type}
              </span>
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
          bodyStyle={{ padding: '12px', height: 'calc(100% - 56px)' }}
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
              <ChartFactory
                config={{
                  type: card.chart.chart_type,
                  title: '', // 不显示重复标题
                  xAxis: {
                    name: card.chart.visualization_settings?.x_axis_title || 'X轴'
                  },
                  yAxis: {
                    name: card.chart.visualization_settings?.y_axis_title || 'Y轴'
                  },
                  series: card.chart.visualization_settings?.y_fields?.map((field: string) => ({
                    name: field,
                    field: field
                  })) || [],
                  xField: card.chart.visualization_settings?.x_field,
                  yFields: card.chart.visualization_settings?.y_fields,
                  colorField: card.chart.visualization_settings?.color_field,
                  // 添加更多配置
                  legend: {
                    show: card.chart.visualization_settings?.show_legend !== false,
                    bottom: 10
                  },
                  tooltip: {
                    show: card.chart.visualization_settings?.show_tooltip !== false,
                    trigger: 'axis'
                  },
                  grid: card.chart.visualization_settings?.grid_padding || {
                    left: '3%',
                    right: '4%',
                    bottom: '15%',
                    containLabel: true
                  }
                }}
                data={chartData}
                style={{ height: '100%', width: '100%' }}
              />
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
        <div className="header-content">
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
              title="可用图表" 
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
              <div className="chart-list">
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
                  charts.map(chart => renderDraggableChartItem(chart))
                )}
              </div>
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
                  {selectedDashboard.cards.map(card => (
                    <DashboardCardComponent key={card.id} card={card} />
                  ))}
                  
                  {/* 空白占位符用于放置新卡片 */}
                  <div 
                    className="grid-placeholder"
                    style={{
                      gridRow: 'span 4',
                      gridColumn: 'span 6',
                      border: '2px dashed #ddd',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#999'
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (draggedCard) {
                        // 添加到仪表盘的新位置
                        await handleAddChartToDashboard(draggedCard.chart_id);
                        setDraggedCard(null);
                      }
                    }}
                  >
                    拖拽图表到这里
                  </div>
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