// frontend/bi-dashboard/src/components/dashboard/DashboardEditor.tsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Modal, message, Row, Col, Space } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ChartFactory } from '../charts/ChartFactory';
import { DashboardService } from '../../services/dashboardService';
import { ChartService } from '../../services/chartService';
import { useAuth } from '../../contexts/AuthContext';

interface DashboardCard {
  id: number;
  chart_id: number;
  card_row: number;
  card_col: number;
  size_x: number;
  size_y: number;
  chart_data?: any;
}

interface DashboardEditorProps {
  dashboardId: number;
  onDashboardUpdate?: () => void;
}

export const DashboardEditor: React.FC<DashboardEditorProps> = ({
  dashboardId,
  onDashboardUpdate
}) => {
  const { user } = useAuth();
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [availableCharts, setAvailableCharts] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
    loadAvailableCharts();
  }, [dashboardId]);

  const loadDashboardData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const dashboard = await DashboardService.getDashboard(dashboardId);
      const cardsWithCharts = await Promise.all(
        dashboard.cards.map(async (card: any) => {
          const chartData = await ChartService.getChart(card.chart_id);
          return {
            ...card,
            chart_data: chartData
          };
        })
      );
      setCards(cardsWithCharts);
    } catch (error) {
      message.error('加载仪表板数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableCharts = async () => {
    if (!user) return;
    
    try {
      const charts = await ChartService.getUserCharts();
      setAvailableCharts(charts);
    } catch (error) {
      message.error('加载图表列表失败');
    }
  };

  const handleAddChart = async (chartId: number) => {
    if (!user) return;
    
    try {
      const newCard = await DashboardService.addChartToDashboard(dashboardId, {
        chart_id: chartId,
        card_row: 0,
        card_col: 0,
        size_x: 6,
        size_y: 4
      });
      
      // 获取新添加的图表数据
      const chartData = await ChartService.getChart(chartId);
      setCards(prev => [...prev, {
        ...newCard,
        chart_data: chartData
      }]);
      
      message.success('图表添加成功');
      setShowAddModal(false);
      onDashboardUpdate?.();
    } catch (error) {
      message.error('添加图表失败');
    }
  };

  const handleRemoveChart = async (cardId: number) => {
    if (!user) return;
    
    try {
      await DashboardService.removeChartFromDashboard(cardId);
      setCards(prev => prev.filter(card => card.id !== cardId));
      message.success('图表移除成功');
      onDashboardUpdate?.();
    } catch (error) {
      message.error('移除图表失败');
    }
  };

  const handleCardMove = async (cardId: number, newPosition: { row: number; col: number }) => {
    if (!user) return;
    
    try {
      await DashboardService.updateDashboardCard(cardId, {
        card_row: newPosition.row,
        card_col: newPosition.col
      });
      
      setCards(prev => prev.map(card => 
        card.id === cardId 
          ? { ...card, card_row: newPosition.row, card_col: newPosition.col }
          : card
      ));
    } catch (error) {
      message.error('更新卡片位置失败');
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <Card 
        title="仪表板编辑器"
        extra={
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={() => setShowAddModal(true)}
          >
            添加图表
          </Button>
        }
      >
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '16px',
          minHeight: '600px'
        }}>
          {cards.map(card => (
            <div
              key={card.id}
              style={{
                gridColumn: `span ${card.size_x}`,
                gridRow: `span ${card.size_y}`,
                position: 'relative'
              }}
            >
              <Card
                size="small"
                title={card.chart_data?.name || '未命名图表'}
                extra={
                  <Space>
                    <Button 
                      icon={<EditOutlined />} 
                      size="small"
                      onClick={() => handleCardMove(card.id, { row: card.card_row, col: card.card_col })}
                    />
                    <Button 
                      icon={<DeleteOutlined />} 
                      size="small" 
                      danger
                      onClick={() => handleRemoveChart(card.id)}
                    />
                  </Space>
                }
              >
                {card.chart_data && (
                  <ChartFactory
                    config={{
                      type: card.chart_data.chart_type,
                      title: card.chart_data.name,
                      ...card.chart_data.visualization_settings
                    }}
                    data={[]} // 实际数据需要从API获取
                    style={{ height: '100%' }}
                  />
                )}
              </Card>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        title="添加图表到仪表板"
        open={showAddModal}
        onCancel={() => setShowAddModal(false)}
        footer={null}
        width={600}
      >
        <Row gutter={[16, 16]}>
          {availableCharts.map(chart => (
            <Col span={12} key={chart.id}>
              <Card
                hoverable
                title={chart.name}
                size="small"
                onClick={() => handleAddChart(chart.id)}
              >
                <p style={{ fontSize: '12px', color: '#666' }}>
                  类型: {chart.chart_type}
                </p>
                <p style={{ fontSize: '12px', color: '#666' }}>
                  创建时间: {new Date(chart.created_at).toLocaleDateString()}
                </p>
              </Card>
            </Col>
          ))}
        </Row>
      </Modal>
    </div>
  );
};