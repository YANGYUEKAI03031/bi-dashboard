import React, { useEffect, useState } from 'react';
import { Tabs, Card, Spin, Empty, message, Typography, Button, Space } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { DashboardService } from '../services/dashboardService';
import { ChartService } from '../services/chartService';
import { ChartFactory } from '../components/charts/ChartFactory';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import './ReportsPage.css';
import { useNavigate } from 'react-router-dom';
import { EditOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

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
  settings?: any;
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

// 图表卡片组件（只读模式）
const ChartCardComponent: React.FC<{ card: DashboardCard }> = ({ card }) => {
  const [chartData, setChartData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!card.chart?.id) {
      setError('图表数据缺失');
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setDataLoading(true);
      setError(null);
      try {
        const data = await ChartService.executeChartQuery(card.chart!.id);

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
  }, [card.chart?.id]);

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

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {dataLoading ? (
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
      ) : error ? (
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
          <div style={{ fontSize: 12, textAlign: 'center' }}>{error}</div>
        </div>
      ) : chartData.length === 0 ? (
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
            sort_by: sortBy,
            sort_order: sortOrder,
            legend: {
              show: viz.show_legend !== false,
              bottom: 10,
            },
            tooltip: {
              show: viz.show_tooltip !== false,
              trigger: 'axis',
            },
            grid:
              viz.grid_padding || {
                left: '3%',
                right: '4%',
                bottom: '15%',
                containLabel: true,
              },
          }}
          data={chartData}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
};

// 仪表盘视图组件
const DashboardView: React.FC<{ dashboard: Dashboard }> = ({ dashboard }) => {
  const widgets = (dashboard?.settings as any)?.widgets || [];

  return (
    <div className="reports-dashboard-view">
      {/* 标题组件 */}
      {widgets
        .filter((w: any) => w && w.type === 'title')
        .map((w: any) => (
          <div key={w.id} style={{ marginBottom: 16 }}>
            <Card size="small" style={{ height: '100%' }}>
              <div style={{ textAlign: w.align || 'left' }}>
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

      {/* 图表网格布局 */}
      {dashboard.cards && dashboard.cards.length > 0 ? (
        <AutoWidthGridLayout
          cols={12}
          rowHeight={80}
          margin={[16, 16]}
          isDraggable={false}
          isResizable={false}
          compactType={null}
          preventCollision={true}
          layout={(dashboard.cards || []).map(card => ({
            i: card.id.toString(),
            x: Number.isFinite(card.card_col) ? card.card_col : 0,
            y: Number.isFinite(card.card_row) ? card.card_row : 0,
            w: Number.isFinite(card.size_x) ? card.size_x : 6,
            h: Number.isFinite(card.size_y) ? card.size_y : 4,
            static: true,
          }))}
        >
          {(dashboard.cards || []).map(card => (
            <div key={card.id.toString()}>
              <Card
                size="small"
                title={card.chart?.name || `图表 #${card.chart_id}`}
                style={{ height: '100%' }}
                bodyStyle={{ height: 'calc(100% - 57px)', padding: '12px' }}
              >
                <ChartCardComponent card={card} />
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
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [dashboardDetails, setDashboardDetails] = useState<Map<number, Dashboard>>(new Map());
  const [loadingDashboard, setLoadingDashboard] = useState<Set<number>>(new Set());
  const [charts, setCharts] = useState<Chart[]>([]);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setLoading(true);
      try {
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
      } catch (error: any) {
        message.error(error?.message || '加载数据失败');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  const loadDashboardDetails = async (dashboardId: number, availableCharts: Chart[]) => {
    // 如果已经加载过，直接返回
    if (dashboardDetails.has(dashboardId)) {
      return;
    }

    // 标记为正在加载
    setLoadingDashboard(prev => new Set(prev).add(dashboardId));

    try {
      const dashboard = await DashboardService.getDashboard(dashboardId);
      const hydratedDashboard = hydrateDashboardCards(dashboard, availableCharts);
      setDashboardDetails(prev => new Map(prev).set(dashboardId, hydratedDashboard));
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
    
    // 如果还没有加载过这个仪表盘的详情，则加载
    if (!dashboardDetails.has(id)) {
      await loadDashboardDetails(id, charts);
    }
  };

  const currentDashboard = activeDashboardId ? dashboardDetails.get(activeDashboardId) : null;

  const handleEditCurrentDashboard = () => {
    if (!activeDashboardId) return;
    navigate(`/dashboard/edit/${activeDashboardId}`);
  };

  return (
    <div className="reports-page">
      <div className="page-header">
        <div className="page-header-left">
          <Title level={2} style={{ margin: 0 }}>
            报表中心
          </Title>
          <Paragraph style={{ margin: '8px 0 0 0', color: '#666' }}>
            查看和管理您的仪表盘报表
          </Paragraph>
        </div>
        <div className="page-header-right">
          <Space>
            <Button
              type="primary"
              icon={<EditOutlined />}
              disabled={!activeDashboardId}
              onClick={handleEditCurrentDashboard}
            >
              编辑当前仪表盘
            </Button>
          </Space>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : dashboards.length === 0 ? (
        <Card>
          <Empty
            description="暂无仪表盘，请先在仪表盘页面创建"
            style={{ padding: '40px 0' }}
          />
        </Card>
      ) : (
        <Card>
          <Tabs
            activeKey={activeDashboardId?.toString() || undefined}
            onChange={handleTabChange}
            type="card"
            items={dashboards.map(dashboard => ({
              key: dashboard.id.toString(),
              label: dashboard.name,
              children: currentDashboard ? (
                <DashboardView dashboard={currentDashboard} />
              ) : loadingDashboard.has(dashboard.id) ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <Spin tip="加载仪表盘内容..." />
                </div>
              ) : (
                <Empty description="加载失败，请刷新重试" />
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
};
