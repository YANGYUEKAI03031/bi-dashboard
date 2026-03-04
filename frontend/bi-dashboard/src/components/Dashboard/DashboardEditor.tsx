// frontend/bi-dashboard/src/components/dashboard/DashboardEditor.tsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Modal, message, Row, Col, Space, Spin } from 'antd';
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

  /**
   * 单个卡片的图表渲染组件：负责加载真实数据并传给 ChartFactory
   */
  const DashboardChartCard: React.FC<{ card: DashboardCard }> = ({ card }) => {
    const [chartMeta, setChartMeta] = useState<any>(card.chart_data);
    const [chartDataRows, setChartDataRows] = useState<any[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      // 每次进入编辑器时，重新拉取最新图表配置，避免使用旧的 visualization_settings
      let cancelled = false;
      const loadChartMeta = async () => {
        try {
          const latest = await ChartService.getChart(card.chart_id);
          if (!cancelled) setChartMeta(latest);
        } catch (e) {
          // 保持旧值即可，避免影响渲染
        }
      };
      loadChartMeta();
      return () => {
        cancelled = true;
      };
    }, [card.chart_id]);

    useEffect(() => {
      if (!card.chart_id) {
        setError('图表数据缺失');
        return;
      }

      let cancelled = false;

      const loadData = async () => {
        setDataLoading(true);
        setError(null);
        try {
          const data = await ChartService.executeChartQuery(card.chart_id);

          if (cancelled) return;

          if (!Array.isArray(data)) {
            throw new Error('返回的数据格式不正确');
          }

          if (data.length === 0) {
            setError('没有查询到数据');
            setChartDataRows([]);
            return;
          }

          const xField = chartMeta?.visualization_settings?.x_field || '';
          if (xField && data.length > 0 && !Object.keys(data[0] || {}).includes(xField)) {
            console.warn(`X轴字段 '${xField}' 在数据中不存在`);
          }

          setChartDataRows(data);
        } catch (err: any) {
          if (cancelled) return;
          console.error('加载图表数据失败:', err);
          setError(err.message || '数据加载失败');
        } finally {
          if (!cancelled) {
            setDataLoading(false);
          }
        }
      };

      loadData();

      return () => {
        cancelled = true;
      };
    }, [card.chart_id, chartMeta?.visualization_settings]);

    if (!chartMeta) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff4d4f',
            fontSize: 12
          }}
        >
          图表数据缺失
        </div>
      );
    }

    let viz: any = chartMeta.visualization_settings || {};
    if (typeof viz === 'string') {
      try {
        viz = JSON.parse(viz);
      } catch (e) {
        viz = {};
      }
    }

    const sortBy = viz.sort_by ?? viz['graph.sort_by'] ?? undefined;
    const sortOrder = viz.sort_order ?? viz['graph.sort_order'] ?? undefined;
    const xField =
      viz.x_field ??
      (Array.isArray(viz.graph_dimensions) ? viz.graph_dimensions[0] : undefined) ??
      (Array.isArray(viz['graph.dimensions']) ? viz['graph.dimensions'][0] : undefined);
    const yFields =
      viz.y_fields ??
      (Array.isArray(viz.graph_metrics) ? viz.graph_metrics : undefined) ??
      (Array.isArray(viz['graph.metrics']) ? viz['graph.metrics'] : undefined);

    if (dataLoading) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <Spin tip="加载数据中..." />
        </div>
      );
    }

    if (error) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#ff4d4f'
          }}
        >
          <div style={{ marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 12, textAlign: 'center' }}>{error}</div>
        </div>
      );
    }

    if (chartDataRows.length === 0) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#888'
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>📊</div>
            <div>暂无数据</div>
          </div>
        </div>
      );
    }

    // 调试：确认 DashboardEditor 实际传给 ChartFactory 的配置与数据（用于对比 ReportsPage）
    // 注意：这是临时诊断日志，确认问题后可以删掉。
    console.log('[DashboardEditor] ChartFactory input', {
      chart_id: card.chart_id,
      chart_type: chartMeta?.chart_type,
      xField,
      yFields,
      y_agg_method: viz?.y_agg_method ?? viz?.['graph.y_agg_method'],
      x_group_by_enabled: viz?.x_group_by_enabled,
      sortBy,
      sortOrder,
      rowsSample: chartDataRows.slice(0, 5),
      rowsCount: chartDataRows.length,
      viz
    });

    return (
      <ChartFactory
        config={{
          type: chartMeta.chart_type,
          title: '',
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
          yFields: Array.isArray(yFields) ? yFields : [],
          colorField: viz.color_field,
          // 仪表盘编辑视图同样支持 Y 轴聚合方式
          y_agg_method: viz.y_agg_method ?? viz['graph.y_agg_method'] ?? undefined,
          // X 轴聚合开关：优先使用持久化配置，其次按图表类型默认
          x_group_by_enabled:
            typeof (viz as any).x_group_by_enabled === 'boolean'
              ? (viz as any).x_group_by_enabled
              : (chartMeta.chart_type || '').toLowerCase() !== 'scatter',
          sort_by: sortBy,
          sort_order: sortOrder,
          legend: {
            show: viz.show_legend !== false,
            bottom: 10
          },
          tooltip: {
            show: viz.show_tooltip !== false,
            trigger: 'axis'
          }
        }}
        data={chartDataRows}
        style={{ height: '100%', width: '100%' }}
      />
    );
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
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                bodyStyle={{
                  flex: 1,
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'stretch'
                }}
              >
                <DashboardChartCard card={card} />
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