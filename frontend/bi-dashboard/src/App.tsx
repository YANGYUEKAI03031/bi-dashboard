/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\App.tsx */
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { LoginPage } from './pages/LoginPage';
import { VisualizationBuilder } from './pages/VisualizationBuilder';
import { ChartsManagementPage } from './pages/ChartsManagementPage'; // 添加图表管理页面导入
import { AuthService } from './services/authService';

// 认证保护组件
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = AuthService.isAuthenticated();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// 未认证用户重定向组件
const RedirectIfAuthenticated: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      // 等待 authContext 初始化
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const token = AuthService.getAuthToken();
      setIsAuthenticated(!!token);
      setIsChecking(false);
    };

    checkAuth();
  }, []);

  if (isChecking) {
    return <div style={{ textAlign: 'center', padding: '20px' }}>正在验证身份...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* 登录页面 - 未认证用户可访问 */}
          <Route 
            path="/login" 
            element={
              <RedirectIfAuthenticated>
                <LoginPage />
              </RedirectIfAuthenticated>
            } 
          />
          
          {/* 默认路由重定向到登录页 */}
          <Route 
            path="/" 
            element={<Navigate to="/login" replace />} 
          />
          
          {/* 受保护的路由使用 MainLayout */}
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DashboardPage />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/reports" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ReportsPage />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
         
          {/* 添加可视化构建器路由 */}
          <Route 
            path="/visualization-builder" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <VisualizationBuilder />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          
          {/* 添加图表管理路由 */}
          <Route 
            path="/charts-management" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <ChartsManagementPage />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;