// 数据源管理页面：展示所有可用数据源，并支持一键测试连接
import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  message,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Popconfirm,
} from 'antd';
import { ReloadOutlined, ApiOutlined, DeleteOutlined } from '@ant-design/icons';
import { DataSourceService, CreateDataSourcePayload } from '../services/dataSourceService';
import './DashboardPage.css';

interface DataSource {
  id: string;
  name: string;
  type: string;
}

export const DataSourceManagementPage: React.FC = () => {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<CreateDataSourcePayload>();

  const loadDataSources = async () => {
    setLoading(true);
    try {
      const list = await DataSourceService.getDataSources();
      setDataSources(list);
    } catch (error: any) {
      message.error(error?.message || '获取数据源列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDataSources();
  }, []);

  const handleTestConnection = async (record: DataSource) => {
    setTestingId(record.id);
    try {
      const res = await DataSourceService.testConnection({ data_source_id: record.id });
      if (res.success) {
        message.success(res.message || '连接成功');
      } else {
        message.warning(res.message || '连接测试未通过');
      }
    } catch (error: any) {
      message.error(error?.message || '连接测试失败');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (record: DataSource) => {
    setDeletingId(record.id);
    try {
      await DataSourceService.deleteDataSource(record.id);
      message.success('删除数据源成功');
      loadDataSources();
    } catch (error: any) {
      message.error(error?.message || '删除数据源失败');
    } finally {
      setDeletingId(null);
    }
  };

  const openCreateModal = () => {
    form.resetFields();
    form.setFieldsValue({
      engine: 'mysql',
      port: 3306,
    } as Partial<CreateDataSourcePayload>);
    setCreateModalVisible(true);
  };

  const handleCreateCancel = () => {
    setCreateModalVisible(false);
  };

  const handleCreateSubmit = async () => {
    try {
      const values = await form.validateFields();
      setCreateSubmitting(true);

      await DataSourceService.createDataSource(values);
      message.success('创建数据源成功');
      setCreateModalVisible(false);
      loadDataSources();
    } catch (error: any) {
      if (error?.errorFields) {
        // 表单校验错误，不弹出全局错误
        return;
      }
      message.error(error?.message || '创建数据源失败');
    } finally {
      setCreateSubmitting(false);
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
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (value: string) => <Tag color="blue">{value?.toUpperCase?.() || value}</Tag>,
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 100,
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, record: DataSource, index: number) => {
        const isDefault = dataSources.length <= 1 || index === 0;
        return (
          <Space>
            <Button
              type="primary"
              icon={<ApiOutlined />}
              loading={testingId === record.id}
              onClick={() => handleTestConnection(record)}
              size="small"
            >
              测试连接
            </Button>
            <Popconfirm
              title="确认删除该数据源吗？"
              description={
                isDefault ? '默认数据源不允许删除，请先配置其他数据源并切换。' : '删除后将无法使用该数据源进行查询。'
              }
              okText="删除"
              cancelText="取消"
              onConfirm={() => handleDelete(record)}
              disabled={isDefault}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                size="small"
                loading={deletingId === record.id}
                disabled={isDefault}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
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
          <Typography.Title level={2} style={{ margin: 0 }}>
            数据源管理
          </Typography.Title>
          <Space>
            <Button type="primary" onClick={openCreateModal}>
              新增数据源
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadDataSources}>
              刷新
            </Button>
          </Space>
        </div>
      </div>

      <div className="dashboard-content">
        <Card>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={dataSources}
            columns={columns}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </div>

      <Modal
        title="新增数据源"
        open={createModalVisible}
        onCancel={handleCreateCancel}
        onOk={handleCreateSubmit}
        confirmLoading={createSubmitting}
        destroyOnClose
      >
        <Form<CreateDataSourcePayload> form={form} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入数据源名称' }]}
          >
            <Input placeholder="例如：生产库 / 报表库" />
          </Form.Item>

          <Form.Item
            label="类型"
            name="engine"
            rules={[{ required: true, message: '请选择数据库类型' }]}
          >
            <Select>
              <Select.Option value="mysql">MySQL</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="Host"
            name="host"
            rules={[{ required: true, message: '请输入数据库地址' }]}
          >
            <Input placeholder="例如：127.0.0.1" />
          </Form.Item>

          <Form.Item
            label="端口"
            name="port"
            rules={[{ required: true, message: '请输入端口号' }]}
          >
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Form.Item>

          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入数据库用户名' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入数据库密码' }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            label="数据库名"
            name="database_name"
            rules={[{ required: true, message: '请输入数据库名' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="可选：补充说明该数据源的用途" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

