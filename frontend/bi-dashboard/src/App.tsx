/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\App.tsx */
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { DashboardListPage } from './pages/DashboardListPage';
import { ReportsPage } from './pages/ReportsPage';
import { LoginPage } from './pages/LoginPage';
import { VisualizationBuilder } from './pages/VisualizationBuilder';
import { ChartsManagementPage } from './pages/ChartsManagementPage'; // 图表管理页面
import { DataSourceManagementPage } from './pages/DataSourceManagementPage'; // 数据源管理页面
import { DashboardEditorPage } from './pages/DashboardEditorPage';
import { AuthService } from './services/authService';
import { UserManagementPage } from './pages/UserManagementPage';
import { PipelineTestPage } from './pages/PipelineTestPage';

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
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    setIsChecking(true);
    const token = AuthService.getAuthToken();
    setIsAuthenticated(!!token);
    setIsChecking(false);
  }, [location.pathname]);

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
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* 仪表盘列表页 */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DashboardListPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* 新建仪表盘 - 全画布编辑页 */}
          <Route
            path="/dashboard/new"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DashboardEditorPage mode="create" />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* 编辑仪表盘 - 全画布编辑页 */}
          <Route
            path="/dashboard/edit/:id"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DashboardEditorPage mode="edit" />
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

          <Route
            path="/reports/:pageId"
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

          {/* 数据源管理路由 */}
          <Route
            path="/datasources"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DataSourceManagementPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* 用户管理路由 - 仅管理员 */}
          <Route
            path="/user-management"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <UserManagementPage />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* 管道测试路由 - 仅管理员 */}
          <Route
            path="/pipeline-test"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <PipelineTestPage />
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
