/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\components\layout\MainLayout.tsx */
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './MainLayout.css';

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    // 手动导航到登录页面
    navigate('/login', { replace: true });
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="main-layout">
      {/* 侧边栏 */}
      <aside className="sidebar">
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
          <div className="page-title">
            {location.pathname === '/dashboard' && '仪表盘'}
            {location.pathname === '/reports' && '报表中心'}
            {location.pathname === '/visualization-builder' && '可视化构建器'}
            {location.pathname === '/charts-management' && '图表管理'}
            {location.pathname === '/analytics' && '数据分析'}
            {location.pathname === '/data-chain' && '数据链管理'}
            {location.pathname === '/settings' && '系统设置'}
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