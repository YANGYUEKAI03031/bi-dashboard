// frontend/bi-dashboard/src/pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Modal, Form, Input } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, DragOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
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

  // 加载图表数据的函数
  const loadChartData = async (chartId: number) => {
    if (chartDataCache[chartId]) {
      return chartDataCache[chartId];
    }
    
    try {
      const data = await ChartService.executeChartQuery(chartId);
      setChartDataCache(prev => ({ ...prev, [chartId]: data }));
      return data;
    } catch (error) {
      console.error('加载图表数据失败:', error);
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
      const newDashboard = await DashboardService.createDashboard({
        name: values.name,
        description: values.description || ''
      });
      
      setDashboards([...dashboards, newDashboard]);
      setSelectedDashboard(newDashboard);
      setCreateModalVisible(false);
      createForm.resetFields();
      message.success('仪表盘创建成功');
    } catch (error: any) {
      message.error(error.message || '创建仪表盘失败');
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

  useEffect(() => {
    loadCharts();
    loadDashboards();
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

  // 渲染仪表盘卡片组件 - 简化版本，不使用Hooks
  const DashboardCardComponent: React.FC<{ card: DashboardCard }> = ({ card }) => {
    const [chartData, setChartData] = useState<any[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    
    // 在组件挂载时加载数据
    useEffect(() => {
      const loadData = async () => {
        if (!card.chart) return;
        
        setDataLoading(true);
        try {
          const data = await loadChartData(card.chart.id);
          setChartData(data);
        } catch (error) {
          message.error('加载图表数据失败');
        } finally {
          setDataLoading(false);
        }
      };
      
      loadData();
    }, [card.chart?.id]); // 只有当chart.id变化时才重新加载
    
    // 添加数据验证和调试信息
    console.log('图表数据:', chartData);
    console.log('图表配置:', card.chart?.visualization_settings);

    if (!card.chart) return null;
    
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
          title={card.chart.name}
          extra={
            <Button 
              type="text" 
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveChartFromDashboard(card.id)}
              size="small"
            />
          }
          className="dashboard-card-inner"
          bodyStyle={{ padding: '12px', height: 'calc(100% - 56px)' }}
        >
          {dataLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Spin />
            </div>
          ) : (
            <div className="chart-container">
              <ChartFactory
                config={{
                  type: card.chart.chart_type,
                  title: card.chart.name,
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
                  yFields: card.chart.visualization_settings?.y_fields
                }}
                data={chartData.length > 0 ? chartData : [{ x: '无数据', y: 0 }]}
                style={{ height: '100%', width: '100%' }}
              />
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
          {/* 左侧图表列表 */}
          <Col span={6}>
            <Card title="可用图表" className="chart-list-panel">
              <div className="chart-list">
                {charts.map(chart => renderDraggableChartItem(chart))}
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
        visible={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
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