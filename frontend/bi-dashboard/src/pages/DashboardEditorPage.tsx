// src/pages/DashboardEditorPage.tsx
import React, { useEffect, useState, useRef } from 'react';
import {
  Layout,
  Form,
  Input,
  Button,
  Card,
  Space,
  message,
  Popconfirm,
  Spin,
  Modal,
  Select,
  Typography,
  Empty,
} from 'antd';
import {
  DeleteOutlined,
  ArrowLeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FontSizeOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardService } from '../services/dashboardService';
import { ChartService } from '../services/chartService';
import { useAuth } from '../contexts/AuthContext';
import { ChartFactory } from '../components/charts/ChartFactory';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import './DashboardEditorPage.css';

const { Sider, Content } = Layout;

const EDITOR_SIDEBAR_COLLAPSED_STORAGE_KEY = 'bi-dashboard.dashboardEditor.sidebarCollapsed';

const getEditorSidebarCollapsedKey = (userId?: number | null) =>
  userId
    ? `${EDITOR_SIDEBAR_COLLAPSED_STORAGE_KEY}.${userId}`
    : EDITOR_SIDEBAR_COLLAPSED_STORAGE_KEY;

const parseCollapsed = (raw: string | null): boolean | null => {
  if (raw == null) return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return null;
};

const readCollapsedFromStorage = (userId?: number | null): boolean | null => {
  // Prefer per-user key; fallback to global key.
  const raw =
    localStorage.getItem(getEditorSidebarCollapsedKey(userId)) ??
    (userId ? localStorage.getItem(EDITOR_SIDEBAR_COLLAPSED_STORAGE_KEY) : null);
  return parseCollapsed(raw);
};

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
  settings?: any;
  layout?: any;
}

// 统一的仪表盘卡片最小网格尺寸（宽=列数，高=行数）
// 这里约等于「新图表3」在画布上的默认宽高：3 列 x 1.5 行。
const MIN_CARD_COLS = 3;
const MIN_CARD_ROWS = 1.5;

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

interface DashboardEditorPageProps {
  mode: 'create' | 'edit';
}

type TitleWidgetAlign = 'left' | 'center' | 'right';

interface DashboardTitleWidget {
  id: string;
  type: 'title';
  title: string;
  subtitle?: string;
  align: TitleWidgetAlign;
  level: 1 | 2 | 3;
  size_x: number;
  size_y: number;
}

export const DashboardEditorPage: React.FC<DashboardEditorPageProps> = ({ mode }) => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form] = Form.useForm();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingChart, setAddingChart] = useState(false);
  const [chartSearchText, setChartSearchText] = useState('');
  const [widgets, setWidgets] = useState<DashboardTitleWidget[]>([]);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [widgetSaving, setWidgetSaving] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [widgetForm] = Form.useForm();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return readCollapsedFromStorage(null) ?? false;
    } catch {
      return false;
    }
  });

  // 用于防抖保存布局变化
  const layoutUpdateTimerRef = useRef<number | null>(null);
  const pendingLayoutRef = useRef<any[] | null>(null);
  const dashboardRef = useRef<Dashboard | null>(null);

  const isEditMode = mode === 'edit';

  /**
   * Refreshing the "available charts list" should NEVER reset existing canvas cards.
   * We only "hydrate" missing card.chart (name/type/settings) from latest charts.
   * If card.chart already exists, we keep it to preserve any in-canvas state.
   */
  const hydrateDashboardCards = (d: Dashboard, latestCharts: Chart[]): Dashboard => {
    if (!d?.cards || d.cards.length === 0) return d;
    const chartMap = new Map<number, Chart>(latestCharts.map(c => [c.id, c]));

    const nextCards = d.cards.map(card => {
      // Keep existing chart object to avoid resetting canvas rendering/state.
      if (card.chart) return card;
      const hydrated = chartMap.get(card.chart_id);
      return hydrated ? { ...card, chart: hydrated } : card;
    });

    // Avoid unnecessary state updates if nothing changed.
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

  // When user info arrives, restore user-scoped preference (or fallback to global preference).
  useEffect(() => {
    if (!user?.id) return;
    try {
      const v = readCollapsedFromStorage(user.id);
      if (v !== null) setCollapsed(v);
    } catch {
      // ignore
    }
  }, [user?.id]);

  // Persist preference so refresh doesn't reset the editor sidebar.
  useEffect(() => {
    try {
      const value = collapsed ? '1' : '0';
      localStorage.setItem(EDITOR_SIDEBAR_COLLAPSED_STORAGE_KEY, value);
      if (user?.id) {
        localStorage.setItem(getEditorSidebarCollapsedKey(user.id), value);
      }
    } catch {
      // ignore
    }
  }, [collapsed, user?.id]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (layoutUpdateTimerRef.current) {
        window.clearTimeout(layoutUpdateTimerRef.current);
      }
    };
  }, []);


  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const init = async () => {
      try {
        setLoading(true);
        // 加载可用图表列表
        const userCharts = await ChartService.getUserCharts();
        if (cancelled) return;

        const convertedCharts = userCharts.map(convertChartResponseToChart);
        setCharts(convertedCharts);

        // 编辑模式下加载当前仪表盘
        if (isEditMode && id) {
          const dashboardId = Number(id);
          if (Number.isNaN(dashboardId)) {
            message.error('无效的仪表盘 ID');
            navigate('/dashboard');
            return;
          }
          const d = await DashboardService.getDashboard(dashboardId);
          if (cancelled) return;

          // If backend doesn't embed card.chart, hydrate from latest charts.
          const hydratedDashboard = hydrateDashboardCards(d, convertedCharts);
          setDashboard(hydratedDashboard);
          dashboardRef.current = hydratedDashboard;
          // 从 settings 中恢复 widgets
          const rawWidgets = (d?.settings as any)?.widgets;
          if (Array.isArray(rawWidgets)) {
            setWidgets(
              rawWidgets
                .filter((w: any) => w && w.type === 'title')
                .map((w: any) => ({
                  id: String(w.id),
                  type: 'title',
                  title: String(w.title ?? ''),
                  subtitle: w.subtitle ? String(w.subtitle) : undefined,
                  align: (w.align === 'center' || w.align === 'right') ? w.align : 'left',
                  level: (w.level === 2 || w.level === 3) ? w.level : 1,
                  size_x: Number.isFinite(w.size_x) ? w.size_x : 12,
                  size_y: Number.isFinite(w.size_y) ? w.size_y : 2,
                }))
            );
          } else {
            setWidgets([]);
          }
          form.setFieldsValue({
            name: d.name,
            description: d.description,
          });
        }
      } catch (error: any) {
        if (!cancelled) message.error(error?.message || '加载仪表盘编辑数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [user, id, isEditMode, form, navigate]);

  const handleBack = () => {
    navigate('/dashboard');
  };

  const handleSaveBasicInfo = async () => {
    try {
      const values = await form.validateFields();
      if (!values.name || !values.name.trim()) {
        message.error('请输入仪表盘名称');
        return;
      }

      setSaving(true);

      if (!isEditMode || !dashboard) {
        // 创建新仪表盘
        const created = await DashboardService.createDashboard({
          name: values.name.trim(),
          description: values.description ? values.description.trim() : '',
        });
        setDashboard(created);
        dashboardRef.current = created;
        message.success('仪表盘创建成功');
        // 跳转到编辑模式
        navigate(`/dashboard/edit/${created.id}`, { replace: true });
      } else {
        // 更新已有仪表盘（后端已提供 PUT /dashboards/{id}）
        const updated = await DashboardService.updateDashboard(dashboard.id, {
          name: values.name.trim(),
          description: values.description ? values.description.trim() : '',
        });
        setDashboard(updated);
        dashboardRef.current = updated;
        message.success('仪表盘信息已保存');
      }
    } catch (error: any) {
      if (error?.errorFields) {
        // 表单校验错误，不提示
        return;
      }
      message.error(error?.message || '保存仪表盘信息失败');
    } finally {
      setSaving(false);
    }
  };

  const persistWidgets = async (nextWidgets: DashboardTitleWidget[]) => {
    if (!dashboard) return;
    const nextSettings = {
      ...(dashboard.settings || {}),
      widgets: nextWidgets,
    };
    const updated = await DashboardService.updateDashboard(dashboard.id, {
      settings: nextSettings,
    });
    setDashboard(updated);
    return updated;
  };

  const openAddTitleWidget = () => {
    setEditingWidgetId(null);
    widgetForm.setFieldsValue({
      title: '',
      subtitle: '',
      align: 'left',
      level: 1,
    });
    setWidgetModalOpen(true);
  };

  const openEditTitleWidget = (w: DashboardTitleWidget) => {
    setEditingWidgetId(w.id);
    widgetForm.setFieldsValue({
      title: w.title,
      subtitle: w.subtitle || '',
      align: w.align,
      level: w.level,
    });
    setWidgetModalOpen(true);
  };

  const handleSaveWidget = async () => {
    if (!dashboard) {
      message.warning('请先保存仪表盘基本信息');
      return;
    }
    try {
      const values = await widgetForm.validateFields();
      const title = String(values.title || '').trim();
      if (!title) {
        message.error('请输入标题内容');
        return;
      }
      const subtitle = String(values.subtitle || '').trim();
      const align: TitleWidgetAlign =
        values.align === 'center' || values.align === 'right' ? values.align : 'left';
      const level: 1 | 2 | 3 = values.level === 2 || values.level === 3 ? values.level : 1;

      setWidgetSaving(true);
      let nextWidgets: DashboardTitleWidget[];
      if (editingWidgetId) {
        nextWidgets = widgets.map(w =>
          w.id === editingWidgetId
            ? { ...w, title, subtitle: subtitle || undefined, align, level }
            : w
        );
      } else {
        const id = `title_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        nextWidgets = [
          ...widgets,
          {
            id,
            type: 'title',
            title,
            subtitle: subtitle || undefined,
            align,
            level,
            size_x: 12,
            size_y: subtitle ? 3 : 2,
          },
        ];
      }

      setWidgets(nextWidgets);
      const updated = await persistWidgets(nextWidgets);
      if (updated) {
        dashboardRef.current = updated;
      }
      message.success('标题组件已保存');
      setWidgetModalOpen(false);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '保存标题组件失败');
    } finally {
      setWidgetSaving(false);
    }
  };

  const handleRemoveWidget = async (widgetId: string) => {
    if (!dashboard) return;
    try {
      const nextWidgets = widgets.filter(w => w.id !== widgetId);
      setWidgets(nextWidgets);
      const updated = await persistWidgets(nextWidgets);
      if (updated) {
        dashboardRef.current = updated;
      }
      message.success('标题组件已移除');
    } catch (error: any) {
      message.error(error?.message || '移除标题组件失败');
    }
  };

  const handleAddChart = async (chartId: number) => {
    if (!dashboard) {
      message.warning('请先在左侧保存仪表盘基本信息');
      return;
    }

    try {
      setAddingChart(true);
      const newCard = await DashboardService.addChartToDashboard(dashboard.id, {
        chart_id: chartId,
        card_row: 0,
        card_col: 0,
        size_x: MIN_CARD_COLS,
        size_y: MIN_CARD_ROWS,
      });

      const chartData = charts.find(c => c.id === chartId);
      const cardWithChart: DashboardCard = {
        ...newCard,
        chart: chartData,
      };

      const updatedDashboard: Dashboard = {
        ...dashboard,
        cards: [...(dashboard.cards || []), cardWithChart],
      };

      setDashboard(updatedDashboard);
      dashboardRef.current = updatedDashboard;
      message.success('图表已添加到仪表盘');
    } catch (error: any) {
      message.error(error?.message || '添加图表失败');
    } finally {
      setAddingChart(false);
    }
  };

  const handleAddChartAt = async (
    chartId: number,
    pos: { x: number; y: number; w?: number; h?: number }
  ) => {
    if (!dashboard) {
      message.warning('请先在左侧保存仪表盘基本信息');
      return;
    }

    try {
      setAddingChart(true);
      const newCard = await DashboardService.addChartToDashboard(dashboard.id, {
        chart_id: chartId,
        card_row: Math.max(0, pos.y),
        card_col: Math.max(0, pos.x),
        size_x: Math.max(pos.w ?? MIN_CARD_COLS, MIN_CARD_COLS),
        size_y: Math.max(pos.h ?? MIN_CARD_ROWS, MIN_CARD_ROWS),
      });

      const chartData = charts.find(c => c.id === chartId);
      const cardWithChart: DashboardCard = {
        ...newCard,
        chart: chartData,
      };

      const updatedDashboard: Dashboard = {
        ...dashboard,
        cards: [...(dashboard.cards || []), cardWithChart],
      };

      setDashboard(updatedDashboard);
      dashboardRef.current = updatedDashboard;
      message.success('图表已添加到仪表盘');
    } catch (error: any) {
      message.error(error?.message || '添加图表失败');
    } finally {
      setAddingChart(false);
    }
  };

  const filteredCharts = charts.filter(c => {
    const q = chartSearchText.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.chart_type.toLowerCase().includes(q)
    );
  });

  const renderDraggableChartItem = (chart: Chart) => (
    <div
      key={chart.id}
      className="dashboard-editor-chart-search-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('chartId', chart.id.toString());
        e.dataTransfer.setData('text/plain', chart.id.toString());
      }}
      onClick={() => {
        handleAddChart(chart.id);
      }}
    >
      <div className="dashboard-editor-chart-search-item-main">
        <div className="dashboard-editor-chart-search-item-title">{chart.name}</div>
        <div className="dashboard-editor-chart-search-item-meta">{chart.chart_type}</div>
      </div>
      <Button
        type="primary"
        size="small"
        loading={addingChart}
        onClick={(e) => {
          e.stopPropagation();
          handleAddChart(chart.id);
        }}
      >
        添加
      </Button>
    </div>
  );

  const handleRemoveCard = async (cardId: number) => {
    if (!dashboard) return;
    try {
      await DashboardService.removeChartFromDashboard(cardId);
      const updatedDashboard: Dashboard = {
        ...dashboard,
        cards: (dashboard.cards || []).filter(card => card.id !== cardId),
      };
      setDashboard(updatedDashboard);
      dashboardRef.current = updatedDashboard;
      message.success('已从仪表盘移除图表');
    } catch (error: any) {
      message.error(error?.message || '移除图表失败');
    }
  };

  // 图表卡片组件 - 加载并显示图表数据
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
            setError('没有查询到数据，请检查SQL查询');
            setChartData([]);
            return;
          }

          // 验证X轴字段是否存在
          const xField = card.chart!.visualization_settings?.x_field || '';
          if (xField && data.length > 0 && !Object.keys(data[0] || {}).includes(xField)) {
            console.warn(`X轴字段 '${xField}' 在数据中不存在，使用第一个字段`);
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

    // 处理可视化配置
    let viz: any = card.chart.visualization_settings || {};
    if (typeof viz === 'string') {
      try {
        viz = JSON.parse(viz);
      } catch (e) {
        console.warn('解析 visualization_settings 失败，使用空对象:', e);
        viz = {};
      }
    }

    // 统一处理排序配置
    const sortBy = viz.sort_by ?? viz['graph.sort_by'] ?? undefined;
    const sortOrder = viz.sort_order ?? viz['graph.sort_order'] ?? undefined;

    // 统一字段映射
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
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              正在执行查询...
            </div>
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
              // 不再从可视化配置里透传 grid_padding，完全交给 ChartFactory 统一处理网格与居中布局。
            }}
            data={chartData}
            style={{ height: '100%', width: '100%' }}
          />
        )}
      </div>
    );
  };

  const handleDeleteDashboard = async () => {
    if (!dashboard) return;
    try {
      // 如果后端支持删除仪表盘，这里可以调用 DELETE /dashboards/{id}
      message.success('仪表盘删除成功（请在后端实现实际删除接口）');
      navigate('/dashboard');
    } catch (error: any) {
      message.error(error?.message || '删除仪表盘失败');
    }
  };

  return (
    <Layout style={{ height: '100%', background: '#f5f7fa' }}>
      <Sider
        collapsed={collapsed}
        collapsedWidth={0}
        width={320}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          padding: collapsed ? 0 : '16px',
          overflow: 'hidden',
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
            style={{ width: '100%' }}
          >
            返回仪表盘列表
          </Button>

          {!isEditMode && (
            <Card title="基本信息" size="small">
            <Form
              layout="vertical"
              form={form}
              initialValues={{
                name: dashboard?.name,
                description: dashboard?.description,
              }}
            >
              <Form.Item
                label="仪表盘标题"
                name="name"
                rules={[{ required: true, message: '请输入仪表盘标题' }]}
              >
                <Input placeholder="例如：销售分析仪表盘" />
              </Form.Item>
              <Form.Item label="描述" name="description">
                <Input.TextArea
                  rows={3}
                  placeholder="简单描述这个仪表盘的用途"
                />
              </Form.Item>
              <Form.Item>
                <Button
                  type="primary"
                  block
                  loading={saving}
                  onClick={handleSaveBasicInfo}
                >
                  {isEditMode ? '保存修改' : '创建仪表盘'}
                </Button>
              </Form.Item>
            </Form>
            </Card>
          )}

          <Card
            title="添加组件"
            size="small"
            extra={
              <Button type="link" size="small" icon={<FontSizeOutlined />} onClick={openAddTitleWidget}>
                标题
              </Button>
            }
          >
            <div style={{ fontSize: 12, color: '#999' }}>
              用于添加章节标题/说明文字（无需绑定图表）。
            </div>
          </Card>

          <Card
            title="添加图表"
            size="small"
            extra={
              <Button
                type="link"
                size="small"
                onClick={async () => {
                  try {
                    const latest = await ChartService.getUserCharts();
                    const converted = latest.map(convertChartResponseToChart);
                    setCharts(converted);
                    // Important: do NOT reset canvas cards; only hydrate missing card.chart.
                    setDashboard(prev => (prev ? hydrateDashboardCards(prev, converted) : prev));
                    message.success('图表列表已刷新');
                  } catch (e: any) {
                    message.error(e?.message || '刷新图表列表失败');
                  }
                }}
              >
                刷新
              </Button>
            }
          >
            {charts.length === 0 ? (
              <div style={{ fontSize: 12, color: '#999' }}>
                暂无可用图表，请先在“图表管理”中创建图表。
              </div>
            ) : (
              <div className="dashboard-editor-chart-search-panel">
                <Input
                  allowClear
                  value={chartSearchText}
                  placeholder="搜索图表（可拖拽到右侧画布）"
                  style={{ width: '100%' }}
                  onChange={(e) => setChartSearchText(e.target.value)}
                />

                <div className="dashboard-editor-chart-search-hint">
                  提示：拖拽图表到右侧画布即可添加（也可点击“添加”）。
                </div>

                {filteredCharts.length === 0 ? (
                  <div style={{ padding: 12 }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配图表" />
                  </div>
                ) : (
                  <div className="dashboard-editor-chart-list">
                    {filteredCharts.map(renderDraggableChartItem)}
                  </div>
                )}
              </div>
            )}
          </Card>

          {dashboard && (
            <Card title="危险操作" size="small">
              <Popconfirm
                title="确定删除这个仪表盘吗？"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={handleDeleteDashboard}
              >
                <Button danger icon={<DeleteOutlined />} block>
                  删除仪表盘
                </Button>
              </Popconfirm>
            </Card>
          )}
        </Space>
      </Sider>

      <Content style={{ padding: '16px' }}>
        <Card
          title={dashboard ? dashboard.name : '仪表盘画布'}
          extra={
            <Button
              type="text"
              onClick={() => setCollapsed(v => !v)}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            >
              {collapsed ? '展开侧栏' : '收起侧栏'}
            </Button>
          }
          style={{ height: '100%' }}
          bodyStyle={{ height: 'calc(100% - 56px)' }}
        >
          {loading ? (
            <div
              className="dashboard-editor-canvas-loading"
              style={{
                height: '100%',
                minHeight: 400,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
              }}
            >
              <Spin size="large" tip="加载仪表盘画布中..." />
              <div style={{ fontSize: 13, color: '#999' }}>
                正在加载图表列表与仪表盘配置…
              </div>
            </div>
          ) : !dashboard ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#999',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>🖼️</div>
              <div style={{ marginBottom: 8 }}>请先在左侧填写并保存仪表盘信息</div>
              <div style={{ fontSize: 12 }}>
                创建完成后，可以在这里添加并排布图表。
              </div>
            </div>
          ) : (
            <div className="dashboard-editor-grid">
              {/* 标题组件（从 dashboard.settings.widgets 渲染） */}
              {widgets.map(w => (
                <div
                  key={w.id}
                  style={{
                    marginBottom: 16,
                  }}
                >
                  <Card
                    size="small"
                    style={{ height: '100%' }}
                    bodyStyle={{ height: '100%' }}
                    extra={
                      <Space>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => openEditTitleWidget(w)}
                        />
                        <Popconfirm
                          title="移除这个标题组件？"
                          okText="移除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => handleRemoveWidget(w.id)}
                        >
                          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                        </Popconfirm>
                      </Space>
                    }
                  >
                    <div style={{ textAlign: w.align }}>
                      <Typography.Title level={w.level} style={{ margin: 0 }}>
                        {w.title}
                      </Typography.Title>
                      {w.subtitle ? (
                        <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0, color: '#666' }}>
                          {w.subtitle}
                        </Typography.Paragraph>
                      ) : null}
                    </div>
                  </Card>
                </div>
              ))}

              <AutoWidthGridLayout
                cols={12}
                rowHeight={80}
                margin={[16, 16]}
                isDroppable
                droppingItem={{ i: '__dropping-elem__', w: MIN_CARD_COLS, h: MIN_CARD_ROWS }}
                isDraggable={true}
                isResizable={true}
                layout={(dashboard.cards || []).map(card => ({
                  i: card.id.toString(),
                  x: Number.isFinite(card.card_col) ? card.card_col : 0,
                  y: Number.isFinite(card.card_row) ? card.card_row : 0,
                  // 强制保证已有卡片在布局层面的宽高不会小于我们期望的最小值
                  w: Math.max(Number.isFinite(card.size_x) ? card.size_x : MIN_CARD_COLS, MIN_CARD_COLS),
                  h: Math.max(Number.isFinite(card.size_y) ? card.size_y : MIN_CARD_ROWS, MIN_CARD_ROWS),
                  minW: MIN_CARD_COLS,
                  minH: MIN_CARD_ROWS,
                }))}
                onLayoutChange={(layout: any[]) => {
                  // 防抖保存：只在用户停止操作一小段时间后再提交更新
                  pendingLayoutRef.current = layout;
                  if (layoutUpdateTimerRef.current) {
                    window.clearTimeout(layoutUpdateTimerRef.current);
                  }

                  layoutUpdateTimerRef.current = window.setTimeout(async () => {
                    const latestDashboard = dashboardRef.current;
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
                      // 并行提交所有更新到后端
                      const results = await Promise.allSettled(
                        changes.map(c => DashboardService.updateDashboardCard(c.cardId, c.updates))
                      );

                      const hasRejected = results.some(r => r.status === 'rejected');
                      if (hasRejected) {
                        message.error('部分卡片更新失败，请稍后重试');
                      }

                      // 本地更新状态，避免多次 setState 导致额外的 onLayoutChange 循环
                      const updatedCards = latestDashboard.cards.map(card => {
                        const change = changes.find(c => c.cardId === card.id);
                        return change ? { ...card, ...change.updates } : card;
                      });

                      const updatedDashboard = {
                        ...latestDashboard,
                        cards: updatedCards
                      };

                      setDashboard(updatedDashboard);
                      dashboardRef.current = updatedDashboard;
                    } catch (e: any) {
                      console.error('保存布局失败:', e);
                      message.error(e?.message || '保存布局失败');
                    }
                  }, 250);
                }}
                onDrop={(layout: any, item: any, e: DragEvent) => {
                  try {
                    const raw =
                      e.dataTransfer?.getData('chartId') ||
                      e.dataTransfer?.getData('text/plain') ||
                      '';
                    const chartId = Number.parseInt(raw, 10);
                    if (!Number.isFinite(chartId)) return;
                    handleAddChartAt(chartId, { x: item.x, y: item.y, w: item.w, h: item.h });
                  } catch {
                    // ignore
                  }
                }}
              >
                {(dashboard.cards || []).map(card => (
                  <div key={card.id.toString()}>
                    <Card
                      size="small"
                      title={
                        <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                          <span>{card.chart?.name || `图表 #${card.chart_id}`}</span>
                        </div>
                      }
                      extra={
                        <Popconfirm
                          title="移除这个图表？"
                          okText="移除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => handleRemoveCard(card.id)}
                        >
                          <Button
                            type="text"
                            icon={<DeleteOutlined />}
                            size="small"
                            danger
                          />
                        </Popconfirm>
                      }
                      // 让卡片本身充满网格单元，并使用 flex 布局让图表区域垂直拉满
                      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                      bodyStyle={{
                        flex: 1,
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'stretch',
                      }}
                    >
                      {/* ChartCardComponent 会占满 body，高度 100%，从而让图表垂直填充整个卡片 */}
                      <ChartCardComponent card={card} />
                    </Card>
                  </div>
                ))}
              </AutoWidthGridLayout>

              {(!dashboard.cards || dashboard.cards.length === 0) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    color: '#999',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                >
                  当前仪表盘还没有任何图表：请从左侧拖拽图表到上方画布区域。
                </div>
              )}
            </div>
          )}
        </Card>
      </Content>

      <Modal
        title={editingWidgetId ? '编辑标题组件' : '添加标题组件'}
        open={widgetModalOpen}
        onCancel={() => setWidgetModalOpen(false)}
        onOk={handleSaveWidget}
        confirmLoading={widgetSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={widgetForm} layout="vertical">
          <Form.Item
            label="标题"
            name="title"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="例如：销售概览" />
          </Form.Item>
          <Form.Item label="副标题（可选）" name="subtitle">
            <Input placeholder="例如：本页数据更新于每日 08:00" />
          </Form.Item>
          <Form.Item label="对齐" name="align" initialValue="left">
            <Select
              options={[
                { label: '左对齐', value: 'left' },
                { label: '居中', value: 'center' },
                { label: '右对齐', value: 'right' },
              ]}
            />
          </Form.Item>
          <Form.Item label="标题级别" name="level" initialValue={1}>
            <Select
              options={[
                { label: '大（H1）', value: 1 },
                { label: '中（H2）', value: 2 },
                { label: '小（H3）', value: 3 },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

