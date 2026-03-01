/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\components\layout\MainLayout.tsx */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, MoreOutlined, DeleteOutlined } from '@ant-design/icons';
import { Modal, Form, Input, message, Popconfirm } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import { ReportPageService, ReportPage } from '../../services/reportPageService';
import './MainLayout.css';

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
  const { user, logout } = useAuth();
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

  const handleDeleteReportPage = async (pageId: number, pageName: string) => {
    try {
      await ReportPageService.deleteReportPage(pageId);
      message.success(`报表页"${pageName}"已删除`);
      
      // 刷新报表页列表
      const pages = await ReportPageService.getUserReportPages();
      setReportPages(pages);
      
      // 如果删除的是当前页面，导航到 /reports
      if (isReportPageActive(pageId)) {
        navigate('/reports');
      }
    } catch (error: any) {
      message.error(error.message || '删除报表页失败');
    }
  };

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
                    <Link
                      to={`/reports/${page.id}`}
                      className={`nav-subitem ${isReportPageActive(page.id) ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <span className="nav-subitem-icon">{page.icon || '📄'}</span>
                      <span className="nav-subitem-text">{page.name}</span>
                    </Link>
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
          </div>
          
          <Link 
            to="/dashboard" 
            className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          >
            <span className="icon">📊</span>
            <span className="nav-text">仪表盘</span>
          </Link>
          
          {/* 添加可视化构建器导航项 */}
          <Link 
            to="/visualization-builder" 
            className={`nav-item ${isActive('/visualization-builder') ? 'active' : ''}`}
          >
            <span className="icon">🎨</span>
            <span className="nav-text">可视化构建</span>
          </Link>
          
          {/* 添加图表管理导航项 */}
          <Link 
            to="/charts-management" 
            className={`nav-item ${isActive('/charts-management') ? 'active' : ''}`}
          >
            <span className="icon">📊</span>
            <span className="nav-text">图表管理</span>
          </Link>
        </nav>
        
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              👤
            </div>
            <div className="user-details">
              <div className="user-name">{user?.full_name || user?.username || '用户'}</div>
              <div className="user-role">管理员</div>
            </div>
          </div>
          
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
    </div>
  );
};