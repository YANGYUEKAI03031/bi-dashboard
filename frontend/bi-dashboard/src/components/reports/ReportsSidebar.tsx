import React, { useState, useMemo } from 'react';
import { Button, List, Input, Modal, Form, message } from 'antd';
import { PlusOutlined, FolderOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { DashboardService } from '../../services/dashboardService';
import './ReportsSidebar.css';

interface Dashboard {
  id: number;
  name: string;
  description: string;
  tags?: string[] | string; // 支持数组或字符串格式
  settings?: any; // 支持从 settings.tags 获取标签
  cards?: any[];
}

interface ReportsSidebarProps {
  dashboards: Dashboard[];
  selectedTag: string | null;
  onTagSelect: (tag: string | null) => void;
  onDashboardCreate: (dashboard: Dashboard) => void | Promise<void>;
  onDashboardSelect?: (dashboardId: number) => void;
  activeDashboardId?: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const ReportsSidebar: React.FC<ReportsSidebarProps> = ({
  dashboards,
  selectedTag,
  onTagSelect,
  onDashboardCreate,
  onDashboardSelect,
  activeDashboardId,
  collapsed,
  onToggleCollapse,
}) => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [selectedTagForCreate, setSelectedTagForCreate] = useState<string | null>(null);

  // 从 settings 或 tags 字段提取标签
  const getDashboardTags = (dashboard: Dashboard): string[] => {
    // 优先从 settings.tags 获取
    if (dashboard.settings?.tags) {
      if (Array.isArray(dashboard.settings.tags)) {
        return dashboard.settings.tags;
      } else if (typeof dashboard.settings.tags === 'string') {
        return (dashboard.settings.tags as string)
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean);
      }
    }
    // 兼容直接使用 tags 字段的情况
    if (dashboard.tags) {
      if (Array.isArray(dashboard.tags)) {
        return dashboard.tags;
      } else if (typeof dashboard.tags === 'string') {
        return dashboard.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }
    return [];
  };

  // 提取所有唯一的标签
  const tags = useMemo(() => {
    const tagSet = new Set<string>();
    dashboards.forEach((dashboard) => {
      const dashboardTags = getDashboardTags(dashboard);
      dashboardTags.forEach((tag) => tag && tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [dashboards]);

  const handleCreateClick = (tag: string | null) => {
    setSelectedTagForCreate(tag);
    setCreateModalVisible(true);
  };

  const handleCreateDashboard = async (values: any) => {
    try {
      if (!values.name || !values.name.trim()) {
        message.error('请输入仪表盘名称');
        return;
      }

      const dashboardData: any = {
        name: values.name.trim(),
        description: values.description ? values.description.trim() : '',
      };

      // 如果有选中的标签，添加到 settings.tags 字段
      if (selectedTagForCreate) {
        dashboardData.settings = {
          tags: [selectedTagForCreate],
        };
      }

      const newDashboard = await DashboardService.createDashboard(dashboardData);
      message.success('仪表盘创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      onDashboardCreate(newDashboard);
    } catch (error: any) {
      console.error('创建仪表盘失败:', error);
      message.error(error.message || '创建仪表盘失败，请检查网络连接和权限');
    }
  };

  return (
    <>
      <div className={`reports-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <h3>目录</h3>
          <Button
            type="text"
            icon={collapsed ? <FolderOutlined /> : <FolderOpenOutlined />}
            onClick={onToggleCollapse}
            className="collapse-btn"
            title={collapsed ? '展开' : '收起'}
          />
        </div>

        {!collapsed && (
          <div className="sidebar-content">
            {/* 全部仪表盘 */}
            <div className="tag-section">
              <div className="tag-header">
                <span className="tag-name">全部</span>
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={() => handleCreateClick(null)}
                  className="add-btn"
                  title="添加仪表盘"
                />
              </div>
              {selectedTag === null && (
                <List
                  size="small"
                  dataSource={dashboards}
                  renderItem={(dashboard) => (
                    <List.Item
                      className={`dashboard-item ${activeDashboardId === dashboard.id ? 'active' : ''}`}
                      onClick={() => onDashboardSelect?.(dashboard.id)}
                    >
                      <span>{dashboard.name}</span>
                    </List.Item>
                  )}
                />
              )}
            </div>

            {/* 按标签分组的目录 */}
            {tags.map((tag) => {
              const tagDashboards = dashboards.filter((dashboard) => {
                const dashboardTags = getDashboardTags(dashboard);
                return dashboardTags.includes(tag);
              });

              return (
                <div key={tag} className="tag-section">
                  <div className="tag-header">
                    <span
                      className={`tag-name ${selectedTag === tag ? 'active' : ''}`}
                      onClick={() => onTagSelect(tag)}
                      style={{ cursor: 'pointer', flex: 1 }}
                    >
                      {tag}
                    </span>
                    <Button
                      type="text"
                      icon={<PlusOutlined />}
                      size="small"
                      onClick={() => handleCreateClick(tag)}
                      className="add-btn"
                      title={`在 ${tag} 目录下添加仪表盘`}
                    />
                  </div>
                  {selectedTag === tag && (
                    <List
                      size="small"
                      dataSource={tagDashboards}
                      renderItem={(dashboard) => (
                        <List.Item
                          className={`dashboard-item ${activeDashboardId === dashboard.id ? 'active' : ''}`}
                          onClick={() => onDashboardSelect?.(dashboard.id)}
                        >
                          <span>{dashboard.name}</span>
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 创建仪表盘模态框 */}
      <Modal
        title={`创建新仪表盘${selectedTagForCreate ? ` - ${selectedTagForCreate}` : ''}`}
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
          setSelectedTagForCreate(null);
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                onClick={() => {
                  setCreateModalVisible(false);
                  createForm.resetFields();
                  setSelectedTagForCreate(null);
                }}
              >
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
