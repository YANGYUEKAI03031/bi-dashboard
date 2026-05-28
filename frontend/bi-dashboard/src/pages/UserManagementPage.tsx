// src/pages/UserManagementPage.tsx

import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, message, Modal, Select, Space, Typography, Form, Input, Switch } from 'antd';
import { UserOutlined, CrownOutlined, TeamOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { PermissionService, UserInfo, UserRole } from '../services/permissionService';
import { useAuth } from '../contexts/AuthContext';
import './DashboardPage.css';

const { Title, Text } = Typography;

// 报表权限信息
interface ReportPagePermission {
  report_page_id: number;
  report_page_name: string;
  can_view: boolean;
  can_edit: boolean;
}

// 报表信息
interface ReportPageInfo {
  id: number;
  name: string;
}

export const UserManagementPage: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [reportPages, setReportPages] = useState<ReportPageInfo[]>([]);
  const [reportPermissions, setReportPermissions] = useState<ReportPagePermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);

  // 检查当前用户是否为管理员
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const permissions = await PermissionService.getMyRole();
        setIsAdmin(permissions.is_admin);
      } catch (error) {
        console.error('检查权限失败:', error);
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  // 加载用户列表
  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await PermissionService.getAllUsersWithRoles();
      setUsers(data);
    } catch (error: any) {
      message.error(error.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载所有报表
  const loadReportPages = async () => {
    try {
      const data = await PermissionService.getAllReportPages();
      // 兼容不同返回格式：可能是数组或 {results: []}
      const pages = (data as any).results || data;
      const pageList = (pages as any[]).map((p: any) => ({
        id: p.id,
        name: p.name || p.title || `报表 ${p.id}`,
      }));
      setReportPages(pageList);
      return pageList; // 返回报表列表供调用方使用
    } catch (error: any) {
      console.error('加载报表列表失败:', error);
      return []; // 失败时返回空数组
    }
  };

  // 加载指定用户的报表权限（直接接收报表列表参数，避免 state 异步问题）
  const loadUserReportPermissions = async (userId: number, pageList?: { id: number; name: string }[]) => {
    // 使用传入的 pageList，如果没传则使用 state 中的（兼容旧调用）
    const pages = pageList || reportPages;
    try {
      const permissions: ReportPagePermission[] = [];
      for (const page of pages) {
        try {
          const perms = await PermissionService.getReportPagePermissions(page.id);
          const userPerm = perms.find((p: any) => p.user_id === userId);
          if (userPerm) {
            permissions.push({
              report_page_id: page.id,
              report_page_name: page.name,
              can_view: userPerm.can_view || false,
              can_edit: userPerm.can_edit || false,
            });
          }
        } catch (e) {
          // 可能没有权限，直接跳过
        }
      }
      setReportPermissions(permissions);
    } catch (error: any) {
      console.error('加载报表权限失败:', error);
    }
  };

  // 打开报表授权弹窗
  const handleOpenReportModal = async (record: UserInfo) => {
    setSelectedUser(record);
    const pages = await loadReportPages(); // 获取加载后的报表列表
    await loadUserReportPermissions(record.user_id, pages); // 直接传入
    setIsReportModalVisible(true);
  };

  // 批量更新报表权限
  const handleBatchPermissionChange = async (viewIds: number[], editIds: number[]) => {
    if (!selectedUser) return;
    try {
      // 获取当前所有报表的权限状态
      const currentViewIds = reportPermissions.filter((p) => p.can_view).map((p) => p.report_page_id);
      const currentEditIds = reportPermissions.filter((p) => p.can_edit).map((p) => p.report_page_id);

      // 撤销已移除的查看权限
      for (const id of currentViewIds) {
        if (!viewIds.includes(id)) {
          await PermissionService.revokeReportPagePermission(id, selectedUser.user_id);
        }
      }

      // 撤销已移除的编辑权限
      for (const id of currentEditIds) {
        if (!editIds.includes(id)) {
          await PermissionService.revokeReportPagePermission(id, selectedUser.user_id);
        }
      }

      // 添加新的查看权限（已有点击编辑权限的不需要重复添加查看权限）
      const newViewIds = viewIds.filter((id) => !currentViewIds.includes(id));
      for (const id of newViewIds) {
        const reportPage = reportPages.find((p) => p.id === id);
        await PermissionService.grantReportPagePermission(id, selectedUser.user_id, editIds.includes(id));
        message.success(`已授权 "${reportPage?.name}" ${editIds.includes(id) ? '编辑' : '查看'} 权限`);
      }

      // 添加新的编辑权限
      const newEditIds = editIds.filter((id) => !currentEditIds.includes(id) && !newViewIds.includes(id));
      for (const id of newEditIds) {
        const reportPage = reportPages.find((p) => p.id === id);
        await PermissionService.grantReportPagePermission(id, selectedUser.user_id, true);
        message.success(`已授权 "${reportPage?.name}" 编辑权限`);
      }

      await loadUserReportPermissions(selectedUser.user_id);
    } catch (error: any) {
      message.error(error.message || '操作失败');
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  // 打开设置角色弹窗
  const handleOpenRoleModal = (record: UserInfo) => {
    setSelectedUser(record);
    setNewRole(record.role);
    setIsModalVisible(true);
  };

  // 确认设置角色
  const handleSetRole = async () => {
    if (!selectedUser) return;

    try {
      await PermissionService.setUserRole(selectedUser.user_id, newRole);
      message.success(
        `已将用户 "${selectedUser.accountname}" 角色设置为 ${newRole === 'admin' ? '管理员' : '普通用户'}`,
      );
      setIsModalVisible(false);
      loadUsers();
    } catch (error: any) {
      message.error(error.message || '设置角色失败');
    }
  };

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ state: true, role: 'user' });
    setIsCreateModalVisible(true);
  };

  const handleCreateUser = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await PermissionService.createUser({
        accountname: values.accountname,
        password: values.password,
        state: values.state ? 1 : 0,
        role: values.role,
      });
      message.success('用户创建成功');
      setIsCreateModalVisible(false);
      await loadUsers();
    } catch (error: any) {
      if (error?.errorFields) return; // 表单校验错误
      message.error(error.message || '创建用户失败');
    } finally {
      setCreating(false);
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '用户ID',
      dataIndex: 'user_id',
      key: 'user_id',
      width: 100,
    },
    {
      title: '用户名',
      dataIndex: 'accountname',
      key: 'accountname',
      render: (text: string, record: UserInfo) => (
        <Space>
          <UserOutlined />
          <span>{text}</span>
          {record.user_id === user?.id && <Tag color="blue">当前用户</Tag>}
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: UserRole) => (
        <Tag
          color={role === 'admin' ? 'gold' : 'default'}
          icon={role === 'admin' ? <CrownOutlined /> : <TeamOutlined />}
        >
          {role === 'admin' ? '管理员' : '普通用户'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      render: (state: number | string | null) => {
        const enabled = Number(state) === 1;
        return <Tag color={enabled ? 'green' : 'red'}>{enabled ? '启用' : '禁用'}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: UserInfo) => (
        <Space>
          <Button
            type="link"
            onClick={() => handleOpenRoleModal(record)}
            disabled={record.user_id === user?.id} // 不能修改自己的角色
          >
            设置角色
          </Button>
          <Button type="link" onClick={() => handleOpenReportModal(record)} icon={<FileTextOutlined />}>
            授权报表
          </Button>
        </Space>
      ),
    },
  ];

  // 非管理员访问时显示
  if (!isAdmin) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Title level={4}>权限不足</Title>
        <Text type="secondary">只有管理员才能访问用户管理页面</Text>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div className="header-content">
          <Title level={3} className="page-title">
            用户权限管理
          </Title>
          <Space>
            <Button type="primary" onClick={openCreateModal}>
              新增用户
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadUsers} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>
      </div>

      <div className="dashboard-content">
        <Table columns={columns} dataSource={users} rowKey="user_id" loading={loading} pagination={{ pageSize: 10 }} />
      </div>

      {/* 设置角色弹窗 */}
      <Modal
        title="设置用户角色"
        open={isModalVisible}
        onOk={handleSetRole}
        onCancel={() => setIsModalVisible(false)}
        okText="确认"
        cancelText="取消"
      >
        {selectedUser && (
          <div>
            <p>
              当前用户：<strong>{selectedUser.accountname}</strong>
            </p>
            <p>
              当前角色：
              <Tag color={selectedUser.role === 'admin' ? 'gold' : 'default'}>
                {selectedUser.role === 'admin' ? '管理员' : '普通用户'}
              </Tag>
            </p>
            <div style={{ marginTop: 16 }}>
              <span>设置新角色：</span>
              <Select value={newRole} onChange={setNewRole} style={{ width: 200, marginLeft: 8 }}>
                <Select.Option value="user">
                  <Space>
                    <TeamOutlined />
                    普通用户
                  </Space>
                </Select.Option>
                <Select.Option value="admin">
                  <Space>
                    <CrownOutlined />
                    管理员
                  </Space>
                </Select.Option>
              </Select>
            </div>
          </div>
        )}
      </Modal>

      {/* 新增用户弹窗 */}
      <Modal
        title="新增用户"
        open={isCreateModalVisible}
        onOk={handleCreateUser}
        onCancel={() => setIsCreateModalVisible(false)}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="accountname" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user">
            <Select>
              <Select.Option value="user">普通用户</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="state" label="启用状态" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 报表授权弹窗 */}
      <Modal
        title={`授权报表 - ${selectedUser?.accountname}`}
        open={isReportModalVisible}
        onCancel={() => setIsReportModalVisible(false)}
        footer={null}
        width={600}
      >
        {reportPages.length === 0 ? (
          <Text type="secondary">暂无可授权的报表</Text>
        ) : (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>可读权限</div>
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                placeholder="选择可查看的报表"
                value={reportPermissions.filter((p) => p.can_view).map((p) => p.report_page_id)}
                onChange={(ids: number[]) =>
                  handleBatchPermissionChange(
                    ids,
                    reportPermissions.filter((p) => p.can_edit).map((p) => p.report_page_id),
                  )
                }
                options={reportPages.map((p) => ({ label: p.name, value: p.id }))}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>可编辑权限</div>
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                placeholder="选择可编辑的报表"
                value={reportPermissions.filter((p) => p.can_edit).map((p) => p.report_page_id)}
                onChange={(ids: number[]) =>
                  handleBatchPermissionChange(
                    reportPermissions.filter((p) => p.can_view).map((p) => p.report_page_id),
                    ids,
                  )
                }
                options={reportPages.map((p) => ({ label: p.name, value: p.id }))}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
