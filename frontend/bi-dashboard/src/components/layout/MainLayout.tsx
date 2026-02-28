/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\components\layout\MainLayout.tsx */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
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

  const handleLogout = async () => {
    await logout();
    // 手动导航到登录页面
    navigate('/login', { replace: true });
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const pageTitle = useMemo(() => {
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
  }, [location.pathname]);

  return (
    <div className="main-layout">
      {/* 侧边栏 */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-hidden={sidebarCollapsed}>
        <div className="logo">
          <h2>BI Dashboard</h2>
        </div>
        
        <nav className="nav-menu">
          <Link 
            to="/dashboard" 
            className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          >
            <span className="icon">📊</span>
            <span>仪表盘</span>
          </Link>
          
          <Link 
            to="/reports" 
            className={`nav-item ${isActive('/reports') ? 'active' : ''}`}
          >
            <span className="icon">📈</span>
            <span>报表</span>
          </Link>
          
          {/* 添加可视化构建器导航项 */}
          <Link 
            to="/visualization-builder" 
            className={`nav-item ${isActive('/visualization-builder') ? 'active' : ''}`}
          >
            <span className="icon">🎨</span>
            <span>可视化构建</span>
          </Link>
          
          {/* 添加图表管理导航项 */}
          <Link 
            to="/charts-management" 
            className={`nav-item ${isActive('/charts-management') ? 'active' : ''}`}
          >
            <span className="icon">📊</span>
            <span>图表管理</span>
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
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(v => !v)}
              aria-label={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
              title={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
            >
              {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
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
    </div>
  );
};