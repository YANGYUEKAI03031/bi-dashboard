import React from 'react';
import './MainLayout.css';
import { AuthService } from '../../services/authService';
import { useLocation, useNavigate } from 'react-router-dom';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 判断当前是否在登录页面
  const isLoginPage = location.pathname === '/' || location.pathname === '/login';
  // 或者使用认证状态判断
  const isAuthenticated = AuthService.isAuthenticated();
  
  const handleLogout = () => {
    AuthService.clearAuth();
    window.location.href = '/login';
  };

  return (
    <div className="main-layout">
      <header className="layout-header">
        <h1>BI Dashboard</h1>
        {/* 只有已认证且不在登录页面才显示退出按钮 */}
        {isAuthenticated && !isLoginPage && (
          <div className="header-right">
            <button 
              className="logout-button"
              onClick={handleLogout}
            >
              退出登录
            </button>
          </div>
        )}
      </header>
      <main className="layout-content">
        {children}
      </main>
      <footer className="layout-footer">
        <p>© 2026 BI Dashboard System</p>
      </footer>
    </div>
  );
};