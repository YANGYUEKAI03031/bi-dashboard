/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\components\layout\MainLayout.tsx */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, MoreOutlined, DeleteOutlined, CrownOutlined, TeamOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import { Modal, Form, Input, message, Popconfirm, Popover, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import { ReportPageService, ReportPage } from '../../services/reportPageService';
import { AuthService } from '../../services/authService';
import './MainLayout.css';

const AVATAR_STORAGE_KEY = 'bi-dashboard.userAvatar';
const getAvatarKey = (userId?: number | null) => (userId ? `${AVATAR_STORAGE_KEY}.${userId}` : AVATAR_STORAGE_KEY);
const AVATAR_PRESETS = ['👤', '🧑', '👩', '🦊', '🐱', '🌟', '💼', '🎯'];

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'bi-dashboard.sidebarCollapsed';

const getSidebarCollapsedKey = (userId?: number | null) =>
  userId ? `${SIDEBAR_COLLAPSED_STORAGE_KEY}.${userId}` : SIDEBAR_COLLAPSED_STORAGE_KEY;

const parseCollapsed = (raw: string | null): boolean | null => {
  if (raw == null) return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return null;
};

const readCollapsedFromStorage = (userId?: number | null): boolean | null => {
  // Prefer per-user key; fallback to global key.
  const raw =
    localStorage.getItem(getSidebarCollapsedKey(userId)) ??
    (userId ? localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) : null);
  return parseCollapsed(raw);
};

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return readCollapsedFromStorage(null) ?? false;
    } catch {
      return false;
    }
  });
  const [reportPages, setReportPages] = useState<ReportPage[]>([]);
  const [reportPagesExpanded, setReportPagesExpanded] = useState<boolean>(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState<boolean>(false);
  const [form] = Form.useForm();
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [avatarOption, setAvatarOption] = useState<string | null>(() => {
    try {
      return localStorage.getItem(getAvatarKey(user?.id)) || null;
    } catch { return null; }
  });
  const [passwordForm] = Form.useForm();

  // When user info arrives, restore user-scoped preference (or fallback to global preference).
  useEffect(() => {
    if (!user?.id) return;
    try {
      const v = readCollapsedFromStorage(user.id);
      if (v !== null) setSidebarCollapsed(v);
    } catch {
      // ignore
    }
  }, [user?.id]);

  // 从本地恢复当前用户头像偏好
  useEffect(() => {
    try {
      setAvatarOption(localStorage.getItem(getAvatarKey(user?.id)) || null);
    } catch {
      setAvatarOption(null);
    }
  }, [user?.id]);

  // Persist preference so refresh doesn't reset the sidebar.
  useEffect(() => {
    try {
      const value = sidebarCollapsed ? '1' : '0';
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value);
      if (user?.id) {
        localStorage.setItem(getSidebarCollapsedKey(user.id), value);
      }
    } catch {
      // ignore (e.g. storage disabled)
    }
  }, [sidebarCollapsed, user?.id]);

  // 加载报表页列表
  useEffect(() => {
    if (!user?.id) return;
    
    const loadReportPages = async () => {
      try {
        const pages = await ReportPageService.getUserReportPages();
        setReportPages(pages);
        // 如果当前路径是 /reports 或 /reports/:pageId，展开报表页
        if (location.pathname.startsWith('/reports')) {
          setReportPagesExpanded(true);
        }
      } catch (error) {
        console.error('加载报表页列表失败:', error);
      }
    };
    
    loadReportPages();
  }, [user?.id, location.pathname]);

  const handleLogout = async () => {
    await logout();
    // 手动导航到登录页面
    navigate('/login', { replace: true });
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const isReportPageActive = (pageId: number) => {
    return location.pathname === `/reports/${pageId}`;
  };

  const handleReportToggle = () => {
    setReportPagesExpanded(!reportPagesExpanded);
  };

  const handleAddReportPage = (e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发展开/收起
    setIsAddModalVisible(true);
  };

  const handleAddModalOk = async () => {
    try {
      const values = await form.validateFields();
      const newPage = await ReportPageService.createReportPage({
        name: values.name,
        description: values.description,
        icon: values.icon || '📄',
      });
      message.success('报表页创建成功');
      setIsAddModalVisible(false);
      form.resetFields();
      // 刷新报表页列表
      const pages = await ReportPageService.getUserReportPages();
      setReportPages(pages);
      // 自动导航到新创建的报表页
      navigate(`/reports/${newPage.id}`);
    } catch (error: any) {
      if (error.errorFields) {
        // 表单验证错误
        return;
      }
      message.error(error.message || '创建报表页失败');
    }
  };

  const handleAddModalCancel = () => {
    setIsAddModalVisible(false);
    form.resetFields();
  };

  const handlePasswordSubmit = async () => {
    try {
      const values = await passwordForm.validateFields();
      if (values.new_password !== values.new_password_confirm) {
        message.error('两次输入的新密码不一致');
        return;
      }
      const res = await AuthService.changePassword(values.old_password, values.new_password);
      if (res.success) {
        message.success('密码已修改，请使用新密码重新登录');
        setPasswordModalVisible(false);
        passwordForm.resetFields();
        logout();
        navigate('/login');
      } else {
        message.error(res.message || '修改失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '修改失败');
    }
  };

  const handleAvatarSelect = (preset: string) => {
    if (!user?.id) return;
    try {
      localStorage.setItem(getAvatarKey(user.id), preset);
      setAvatarOption(preset);
      setAvatarModalVisible(false);
      message.success('头像已更新');
    } catch {
      message.error('保存失败');
    }
  };

  const userMenuItems: MenuProps['items'] = user
    ? [
        { key: 'avatar', icon: <UserOutlined />, label: '换头像', onClick: () => setAvatarModalVisible(true) },
        { key: 'password', icon: <LockOutlined />, label: '改密码', onClick: () => setPasswordModalVisible(true) },
      ]
    : [];

  const handleDeleteReportPage = async (pageId: number, pageName: string) => {
    try {
      await ReportPageService.deleteReportPage(pageId);
      message.success(`报表页"${pageName}"已删除`);
      
      // 刷新报表页列表
      const pages = await ReportPageService.getUserReportPages();
      setReportPages(pages);
      
      // 如果删除的是当前页面，优先导航到剩余报表页中的第一个；如果没有报表页则回到仪表盘
      if (isReportPageActive(pageId)) {
        if (pages.length > 0) {
          navigate(`/reports/${pages[0].id}`);
        } else {
          navigate('/dashboard');
        }
      }
    } catch (error: any) {
      message.error(error.message || '删除报表页失败');
    }
  };

  // 当路径为 /reports 时，自动重定向到第一个报表页 /reports/:id（如果存在）
  useEffect(() => {
    if (location.pathname === '/reports' && reportPages.length > 0) {
      navigate(`/reports/${reportPages[0].id}`, { replace: true });
    }
  }, [location.pathname, reportPages, navigate]);

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith('/reports/')) {
      const pageId = location.pathname.split('/')[2];
      const page = reportPages.find(p => p.id.toString() === pageId);
      return page ? page.name : '报表中心';
    }
    
    switch (location.pathname) {
      case '/dashboard':
        return '仪表盘';
      case '/reports':
        return '报表中心';
      case '/visualization-builder':
        return '可视化构建器';
      case '/charts-management':
        return '图表管理';
      case '/datasources':
        return '数据源管理';
      case '/analytics':
        return '数据分析';
      case '/data-chain':
        return '数据链管理';
      case '/settings':
        return '系统设置';
      default:
        return '';
    }
  }, [location.pathname, reportPages]);

  return (
    <div className="main-layout">
      {/* 侧边栏 */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-hidden={sidebarCollapsed}>
        <div className="logo">
          <h2>BI Dashboard</h2>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(v => !v)}
            aria-label={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
            title={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
          >
            {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>
        
        <nav className="nav-menu">
          <div className="nav-item-group">
            {sidebarCollapsed ? (
              // 折叠状态：使用 Popover 显示子导航
              <Popover
                content={
                  <div className="nav-popover-content">
                    <div className="nav-popover-header">
                      <span>报表页</span>
                      <button
                        className="nav-popover-add-btn"
                        onClick={handleAddReportPage}
                        title="添加报表页"
                      >
                        <PlusOutlined style={{ fontSize: '12px' }} />
                      </button>
                    </div>
                    <div className="nav-popover-list">
                      {reportPages.length === 0 ? (
                        <div className="nav-popover-empty">暂无报表页</div>
                      ) : (
                        reportPages.map(page => (
                          <div
                            key={page.id}
                            className={`nav-popover-item ${isReportPageActive(page.id) ? 'active' : ''}`}
                          >
                            <span
                              className={`nav-popover-item-link ${isReportPageActive(page.id) ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isReportPageActive(page.id)) {
                                  navigate(`/reports/${page.id}`, { state: { reportRefresh: Date.now() } });
                                }
                              }}
                            >
                              <span className="nav-popover-item-icon">{page.icon || '📄'}</span>
                              <span className="nav-popover-item-text">{page.name}</span>
                            </span>
                            <Popconfirm
                              title={`确定要删除报表页"${page.name}"吗？`}
                              description="此操作不可恢复"
                              onConfirm={() => handleDeleteReportPage(page.id, page.name)}
                              okText="删除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                            >
                              <button
                                className="nav-popover-item-menu-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                                title="删除报表页"
                              >
                                <MoreOutlined />
                              </button>
                            </Popconfirm>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                }
                trigger={['hover']}
                placement="rightTop"
                overlayClassName="nav-popover"
                mouseEnterDelay={0.1}
                mouseLeaveDelay={0.1}
              >
                <div 
                  className={`nav-item ${(isActive('/reports') || location.pathname.match(/^\/reports\/\d+$/)) ? 'active' : ''}`}
                >
                  <span className="icon">📈</span>
                  <span className="nav-text">报表</span>
                </div>
              </Popover>
            ) : (
              // 展开状态：保持原有行为
              <>
                <div 
                  className={`nav-item ${(isActive('/reports') || location.pathname.match(/^\/reports\/\d+$/)) ? 'active' : ''}`}
                  onClick={handleReportToggle}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="icon">📈</span>
                  <span className="nav-text">报表</span>
                  <span 
                    className="nav-add-btn" 
                    onClick={handleAddReportPage}
                    title="添加报表页"
                  >
                    <PlusOutlined style={{ fontSize: '12px' }} />
                  </span>
                </div>
                {reportPagesExpanded && (
                  <div className="nav-submenu">
                    {reportPages.map(page => (
                      <div
                        key={page.id}
                        className={`nav-subitem-wrapper ${isReportPageActive(page.id) ? 'active' : ''}`}
                      >
                        <span
                          role="link"
                          tabIndex={0}
                          className={`nav-subitem ${isReportPageActive(page.id) ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isReportPageActive(page.id)) {
                              navigate(`/reports/${page.id}`, { state: { reportRefresh: Date.now() } });
                            }
                          }}
                        >
                          <span className="nav-subitem-icon">{page.icon || '📄'}</span>
                          <span className="nav-subitem-text">{page.name}</span>
                        </span>
                        <Popconfirm
                          title={`确定要删除报表页"${page.name}"吗？`}
                          description="此操作不可恢复"
                          onConfirm={() => handleDeleteReportPage(page.id, page.name)}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                        >
                          <button
                            className="nav-subitem-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            title="删除报表页"
                          >
                            <MoreOutlined />
                          </button>
                        </Popconfirm>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          
          <Link 
            to="/dashboard" 
            className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          >
            <span className="icon">📊</span>
            <span className="nav-text">仪表盘</span>
          </Link>
          
          {/* 添加图表管理导航项（位置提前） */}
          <Link 
            to="/charts-management" 
            className={`nav-item ${isActive('/charts-management') ? 'active' : ''}`}
          >
            <span className="icon">📉</span>
            <span className="nav-text">图表管理</span>
          </Link>
          
          {/* 添加可视化构建器导航项（位置靠后） */}
          <Link 
            to="/visualization-builder" 
            className={`nav-item ${isActive('/visualization-builder') ? 'active' : ''}`}
          >
            <span className="icon">🎨</span>
            <span className="nav-text">可视化构建</span>
          </Link>

          {/* 数据源管理 - 仅管理员可见 */}
          {isAdmin && (
            <Link
              to="/datasources"
              className={`nav-item nav-item-bottom ${isActive('/datasources') ? 'active' : ''}`}
            >
              <span className="icon">🗄</span>
              <span className="nav-text">数据源管理</span>
            </Link>
          )}
        </nav>
        
        <div className="sidebar-footer">
          <div className="user-info">
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="topRight" disabled={!user}>
              <div className="user-avatar user-avatar-clickable" role="button" tabIndex={0} aria-label="用户菜单">
                {avatarOption ? (
                  <span className="user-avatar-emoji">{avatarOption}</span>
                ) : isAdmin ? (
                  <CrownOutlined style={{ fontSize: 24, color: '#faad14' }} />
                ) : (
                  <TeamOutlined style={{ fontSize: 24 }} />
                )}
              </div>
            </Dropdown>
            <div className="user-details">
              <div className="user-name">{user?.full_name || user?.username || '用户'}</div>
              <div className="user-role">{isAdmin ? '管理员' : '普通用户'}</div>
            </div>
          </div>

          {/* 管理员显示用户管理入口 */}
          {isAdmin && (
            <Link
              to="/user-management"
              className={`nav-item nav-item-bottom ${isActive('/user-management') ? 'active' : ''}`}
              style={{ marginBottom: 8 }}
            >
              <span className="icon">👥</span>
              <span className="nav-text">用户管理</span>
            </Link>
          )}

          <button onClick={handleLogout} className="logout-btn">
            <span className="icon">🚪</span>
            <span className="logout-text">退出登录</span>
          </button>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            <div className="page-title">{pageTitle}</div>
          </div>
          <div className="user-actions">
            <button className="notification-btn">
              🔔
            </button>
          </div>
        </header>
        
        <div className="content-wrapper">
          {children}
        </div>
      </main>

      {/* 添加报表页对话框 */}
      <Modal
        title="创建报表页"
        open={isAddModalVisible}
        onOk={handleAddModalOk}
        onCancel={handleAddModalCancel}
        okText="创建"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
        >
          <Form.Item
            name="name"
            label="报表页名称"
            rules={[{ required: true, message: '请输入报表页名称' }]}
          >
            <Input placeholder="请输入报表页名称" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea 
              placeholder="请输入描述（可选）" 
              rows={3}
            />
          </Form.Item>
          <Form.Item
            name="icon"
            label="图标"
          >
            <Input placeholder="请输入图标（可选，例如：📄）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 改密码弹窗 - 仅登录后可用 */}
      <Modal
        title="修改密码"
        open={passwordModalVisible}
        onOk={handlePasswordSubmit}
        onCancel={() => { setPasswordModalVisible(false); passwordForm.resetFields(); }}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item name="old_password" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password placeholder="请输入原密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]}>
            <Input.Password placeholder="请输入新密码" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="new_password_confirm" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}>
            <Input.Password placeholder="请再次输入新密码" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 换头像弹窗 - 仅登录后可用 */}
      <Modal
        title="换头像"
        open={avatarModalVisible}
        onCancel={() => setAvatarModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 0' }}>
          {AVATAR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`user-avatar-emoji-option ${avatarOption === preset ? 'selected' : ''}`}
              onClick={() => handleAvatarSelect(preset)}
              style={{ fontSize: 28, padding: 8, border: avatarOption === preset ? '2px solid #1890ff' : '1px solid #d9d9d9', borderRadius: 8, background: 'var(--theme-background)', cursor: 'pointer' }}
              aria-label={`选择头像 ${preset}`}
            >
              {preset}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
};