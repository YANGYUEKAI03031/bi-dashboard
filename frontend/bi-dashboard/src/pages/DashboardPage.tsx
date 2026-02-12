import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Modal, Form, Input } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import { DashboardService } from '../services/dashboardService';
import { ChartFactory } from '../components/charts/ChartFactory';
import './DashboardPage.css';

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
      
      // 更新本地状态
      const updatedDashboard = {
        ...selectedDashboard,
        cards: [...selectedDashboard.cards, newCard]
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

  // 渲染仪表盘卡片
  const renderDashboardCard = (card: DashboardCard) => {
    if (!card.chart) return null;
    
    return (
      <div 
        key={card.id}
        className="dashboard-card"
        style={{
          gridRow: `${card.card_row + 1} / span ${card.size_y}`,
          gridColumn: `${card.card_col + 1} / span ${card.size_x}`
        }}
      >
        <Card 
          title={card.chart.name}
          extra={
            <Button 
              type="text" 
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveChartFromDashboard(card.id)}
            />
          }
          className="dashboard-card-inner"
        >
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
            data={[]} // 这里需要从后端获取实际数据
            style={{ height: '100%' }}
          />
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
        <p>拖拽图表到仪表盘或点击添加按钮</p>
      </div>
      
      <Spin spinning={loading}>
        <div className="dashboard-container">
          {/* 左侧图表列表 */}
          <div className="charts-panel">
            <Card title="可用图表" className="panel-card">
              <div className="charts-list">
                {charts.length > 0 ? (
                  charts.map(renderDraggableChartItem)
                ) : (
                  <div className="no-charts">
                    <p>暂无可用图表</p>
                    <Button 
                      type="link" 
                      href="/visualization-builder"
                    >
                      去创建图表
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>
          
          {/* 右侧仪表盘区域 */}
          <div className="dashboard-panel">
            {dashboards.length > 0 ? (
              <>
                {/* 仪表盘选择器 */}
                <div className="dashboard-selector">
                  <Space>
                    {dashboards.map(dashboard => (
                      <Button
                        key={dashboard.id}
                        type={selectedDashboard?.id === dashboard.id ? "primary" : "default"}
                        onClick={() => setSelectedDashboard(dashboard)}
                      >
                        {dashboard.name}
                      </Button>
                    ))}
                  </Space>
                </div>
                
                {/* 仪表盘内容 */}
                {selectedDashboard ? (
                  <Card className="dashboard-content-card">
                    <div className="dashboard-grid">
                      {selectedDashboard.cards.map(renderDashboardCard)}
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <div className="empty-dashboard">
                      <p>请选择一个仪表盘</p>
                    </div>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <div className="empty-dashboard">
                  <p>暂无仪表盘</p>
                  <Button 
                    type="primary"
                    onClick={() => setCreateModalVisible(true)}
                  >
                    创建第一个仪表盘
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </Spin>
      
      {/* 创建仪表盘模态框 */}
      <Modal
        title="创建新仪表盘"
        open={createModalVisible}
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