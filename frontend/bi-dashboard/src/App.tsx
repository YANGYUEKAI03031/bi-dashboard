/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\App.tsx */
import React from 'react';
import { AdvancedDataAnalyzer } from './components/AdvancedDataAnalyzer/AdvancedDataAnalyzer';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { DatabaseExplorer } from './components/DatabaseExplorer/DatabaseExplorer';
import { AuthProvider } from './contexts/AuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { AuthService } from './services/authService';
import { DataProcessor } from './components/DataProcessor/DataProcessor';
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
  const isAuthenticated = AuthService.isAuthenticated();
  
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
          <Route 
            path="/advanced-analytics" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AdvancedDataAnalyzer />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/analytics" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <AnalyticsPage />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          <Route path="/database" element={<DatabaseExplorer />} />
          {/* 添加数据导入页面路由 */}
          <Route 
            path="/data-processor" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <DataProcessor />
                </MainLayout>
              </ProtectedRoute>
            } 
          />
          
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <MainLayout>
                  <SettingsPage />
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