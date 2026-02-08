/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\contexts\AuthContext.tsx */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthService } from '../services/authService';

interface User {
  id: number;
  username: string;
  email?: string;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 页面加载时检查认证状态
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const currentUser = await AuthService.getCurrentUser();
      if (currentUser) {
        setUser({
          id: currentUser.id,
          username: currentUser.username,
          email: currentUser.email,
          full_name: currentUser.full_name
        });
      }
    } catch (error) {
      console.error('检查认证状态失败:', error);
      // 如果检查失败，清除认证信息
      AuthService.clearAuth();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    try {
      const response = await AuthService.login({ username, password });
      
      if (response.success && response.user) {
        setUser({
          id: response.user.id,
          username: response.user.username,
          email: response.user.email,
          full_name: response.user.full_name
        });
      }
      
      return { success: response.success, message: response.message };
    } catch (error) {
      console.error('登录失败:', error);
      return { success: false, message: '登录过程中发生错误' };
    }
  };

  const logout = async () => {
    try {
      await AuthService.logout();
    } finally {
      setUser(null);
    }
  };

  const value = {
    user,
    isAuthenticated: !!user,
    login,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};