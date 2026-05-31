// src/pages/DashboardListPage.tsx
import React, { useEffect, useState } from 'react';
import { Card, Button, Space, message, Table, Popconfirm, Modal, Form, Input, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthService } from '../services/authService';
import { DashboardService } from '../services/dashboardService';
import './DashboardPage.css';

const { Title } = Typography;

interface Dashboard {
  id: number;
  name: string;
  description: string;
  cards?: any[];
}

export const DashboardListPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();

  useEffect(() => {
    // 确保已经认证
    if (!AuthService.isAuthenticated() || !user) return;

    const timer = setTimeout(() => {
      loadDashboards();
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadDashboards = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const userDashboards = await DashboardService.getUserDashboards();
      setDashboards(userDashboards);
    } catch (error: any) {
      message.error(error?.message || '获取仪表盘列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClick = () => {
    setCreateModalVisible(true);
  };

  // 创建新仪表盘（复用 DashboardPage 的创建逻辑）
  const handleCreateDashboard = async (values: any) => {
    try {
      if (!values.name || !values.name.trim()) {
        message.error('请输入仪表盘名称');
        return;
      }

      const newDashboard = await DashboardService.createDashboard({
        name: values.name.trim(),
        description: values.description ? values.description.trim() : '',
      });

      // 先更新本地列表，避免返回列表时看不到刚创建的项（即便后端列表刷新有延迟）
      setDashboards((prev) => [...prev, newDashboard]);
      setCreateModalVisible(false);
      createForm.resetFields();
      message.success('仪表盘创建成功');

      // 直接进入编辑页
      navigate(`/dashboard/edit/${newDashboard.id}`);
    } catch (error: any) {
      console.error('创建仪表盘失败:', error);
      message.error(error.message || '创建仪表盘失败，请检查网络连接和权限');
    }
  };

  const handleEdit = (record: Dashboard) => {
    navigate(`/dashboard/edit/${record.id}`);
  };

  const handleDelete = async (record: Dashboard) => {
    try {
      await DashboardService.deleteDashboard(record.id);
      message.success('仪表盘删除成功');
      // 从列表中移除已删除的仪表盘
      setDashboards((prev) => prev.filter((d) => d.id !== record.id));
    } catch (error: any) {
      console.error('删除仪表盘失败:', error);
      message.error(error?.message || '删除仪表盘失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '卡片数量',
      dataIndex: 'cards',
      key: 'cards',
      render: (cards: any[] | undefined) => cards?.length ?? 0,
      width: 100,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: Dashboard) => (
        <Space size="small" wrap>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small">
            编辑
          </Button>
          <Popconfirm
            title="确定删除这个仪表盘吗？"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" icon={<DeleteOutlined />} danger size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
          <Title level={3} className="header-title">
            仪表盘
          </Title>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateClick}>
              新建仪表盘
            </Button>
          </Space>
        </div>
      </div>

      <div className="dashboard-content">
        <Card>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={dashboards}
            columns={columns}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </div>

      {/* 创建仪表盘模态框（与 DashboardPage 一致） */}
      <Modal
        title="创建新仪表盘"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
        }}
        footer={null}
      >
        <Form form={createForm} onFinish={handleCreateDashboard} layout="vertical">
          <Form.Item name="name" label="仪表盘名称" rules={[{ required: true, message: '请输入仪表盘名称' }]}>
            <Input placeholder="输入仪表盘名称" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="输入仪表盘描述" rows={3} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
              <Button onClick={() => setCreateModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
