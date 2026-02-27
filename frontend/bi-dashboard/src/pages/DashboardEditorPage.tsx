// src/pages/DashboardEditorPage.tsx
import React, { useEffect, useState } from 'react';
import {
  Layout,
  Form,
  Input,
  Button,
  Card,
  Space,
  List,
  message,
  Popconfirm,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardService } from '../services/dashboardService';
import { ChartService } from '../services/chartService';
import { useAuth } from '../contexts/AuthContext';

const { Sider, Content } = Layout;

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
  const [collapsed, setCollapsed] = useState(false);

  const isEditMode = mode === 'edit';

  useEffect(() => {
    if (!user) return;

    const init = async () => {
      try {
        setLoading(true);
        // 加载可用图表列表
        const userCharts = await ChartService.getUserCharts();
        setCharts(userCharts.map(convertChartResponseToChart));

        // 编辑模式下加载当前仪表盘
        if (isEditMode && id) {
          const dashboardId = Number(id);
          if (Number.isNaN(dashboardId)) {
            message.error('无效的仪表盘 ID');
            navigate('/dashboard');
            return;
          }
          const d = await DashboardService.getDashboard(dashboardId);
          setDashboard(d);
          form.setFieldsValue({
            name: d.name,
            description: d.description,
          });
        }
      } catch (error: any) {
        message.error(error?.message || '加载仪表盘编辑数据失败');
      } finally {
        setLoading(false);
      }
    };

    init();
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
        message.success('仪表盘创建成功');
        // 跳转到编辑模式
        navigate(`/dashboard/edit/${created.id}`, { replace: true });
      } else {
        // 更新已有仪表盘（仅本地名称/描述，后端暂未提供更新接口时不发请求）
        const updated: Dashboard = {
          ...dashboard,
          name: values.name.trim(),
          description: values.description ? values.description.trim() : '',
        };
        setDashboard(updated);
        message.success('仪表盘信息已更新');
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
        size_x: 6,
        size_y: 4,
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
      message.success('图表已添加到仪表盘');
    } catch (error: any) {
      message.error(error?.message || '添加图表失败');
    } finally {
      setAddingChart(false);
    }
  };

  const handleRemoveCard = async (cardId: number) => {
    if (!dashboard) return;
    try {
      await DashboardService.removeChartFromDashboard(cardId);
      const updatedDashboard: Dashboard = {
        ...dashboard,
        cards: (dashboard.cards || []).filter(card => card.id !== cardId),
      };
      setDashboard(updatedDashboard);
      message.success('已从仪表盘移除图表');
    } catch (error: any) {
      message.error(error?.message || '移除图表失败');
    }
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
                    setCharts(latest.map(convertChartResponseToChart));
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
              <List
                size="small"
                dataSource={charts}
                style={{ maxHeight: 260, overflow: 'auto' }}
                renderItem={chart => (
                  <List.Item
                    key={chart.id}
                    actions={[
                      <Button
                        key="add"
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        loading={addingChart}
                        onClick={() => handleAddChart(chart.id)}
                      >
                        添加
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={chart.name}
                      description={
                        <span style={{ fontSize: 12, color: '#999' }}>
                          类型：{chart.chart_type}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
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
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Spin tip="加载中..." />
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
          ) : dashboard.cards && dashboard.cards.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(12, 1fr)',
                gridAutoRows: 80,
                gap: 16,
                height: '100%',
                alignContent: 'flex-start',
                overflow: 'auto',
              }}
            >
              {dashboard.cards.map(card => (
                <div
                  key={card.id}
                  style={{
                    gridColumn: `span ${card.size_x || 6}`,
                    gridRow: `span ${card.size_y || 4}`,
                  }}
                >
                  <Card
                    size="small"
                    title={card.chart?.name || `图表 #${card.chart_id}`}
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
                    style={{ height: '100%' }}
                  >
                    <div
                      style={{
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#bbb',
                        fontSize: 12,
                      }}
                    >
                      图表预览稍后可增强，这里先展示布局占位
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          ) : (
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
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ marginBottom: 8 }}>当前仪表盘还没有任何图表</div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>
                在左侧“添加图表”区域选择图表加入画布。
              </div>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  message.info('请在左侧选择要添加的图表');
                }}
              >
                添加第一个图表
              </Button>
            </div>
          )}
        </Card>
      </Content>
    </Layout>
  );
};

