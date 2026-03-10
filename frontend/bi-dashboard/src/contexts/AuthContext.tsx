/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\contexts\AuthContext.tsx */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthService } from '../services/authService';
import { PermissionService } from '../services/permissionService';

interface User {
  id: number;
  username: string;
  email?: string;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  role: 'admin' | 'user';
  isAdmin: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // 检查认证状态的核心函数
  const checkAuthStatus = useCallback(async (): Promise<boolean> => {
    console.log('=== 检查认证状态 ===');
    try {
      const token = AuthService.getAuthToken();
      console.log('Token存在:', !!token);

      if (token) {
        const currentUser = await AuthService.getCurrentUser();
        console.log('获取到的用户信息:', currentUser);

        if (currentUser) {
          setUser({
            id: currentUser.id,
            username: currentUser.username,
            email: currentUser.email,
            full_name: currentUser.full_name
          });

          // 获取用户角色
          try {
            const permissions = await PermissionService.getMyRole();
            setRole(permissions.role);
            setIsAdmin(permissions.is_admin);
            console.log('用户角色:', permissions.role, '是否管理员:', permissions.is_admin);
          } catch (roleError) {
            console.warn('获取角色失败，使用默认角色:', roleError);
            setRole('user');
            setIsAdmin(false);
          }

          console.log('认证状态: 已认证');
          return true;
        } else {
          console.log('用户信息获取失败，清除认证状态');
          AuthService.clearAuth();
          setUser(null);
          setRole('user');
          setIsAdmin(false);
          return false;
        }
      } else {
        console.log('无有效token');
        setUser(null);
        setRole('user');
        setIsAdmin(false);
        return false;
      }
    } catch (error) {
      console.error('检查认证状态失败:', error);
      AuthService.clearAuth();
      setUser(null);
      setRole('user');
      setIsAdmin(false);
      return false;
    }
  }, []);

  // 刷新认证状态
  const refreshAuth = useCallback(async () => {
    setLoading(true);
    await checkAuthStatus();
    setLoading(false);
  }, [checkAuthStatus]);

  // 初始化时检查认证状态
  useEffect(() => {
    const initializeAuth = async () => {
      console.log('=== 初始化认证状态 ===');
      await checkAuthStatus();
      setLoading(false);
    };
    
    initializeAuth();
  }, [checkAuthStatus]);

  // 监听storage事件，处理多标签页认证同步
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'authToken') {
        console.log('检测到认证token变化，重新检查认证状态');
        refreshAuth();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshAuth]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      console.log('=== 执行登录 ===');
      const response = await AuthService.login({ username, password });

      if (response.success && response.user) {
        setUser({
          id: response.user.id,
          username: response.user.username,
          email: response.user.email,
          full_name: response.user.full_name
        });

        // 获取用户角色
        try {
          const permissions = await PermissionService.getMyRole();
          setRole(permissions.role);
          setIsAdmin(permissions.is_admin);
        } catch (roleError) {
          console.warn('获取角色失败:', roleError);
          setRole('user');
          setIsAdmin(false);
        }

        console.log('登录成功，用户状态已更新');
      }

      return { success: response.success, message: response.message };
    } catch (error) {
      console.error('登录失败:', error);
      return { success: false, message: '登录过程中发生错误' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      console.log('=== 执行登出 ===');
      await AuthService.logout();
    } finally {
      setUser(null);
      setRole('user');
      setIsAdmin(false);
      console.log('登出完成，用户状态已清除');
    }
  }, []);

  const value = {
    user,
    role,
    isAdmin,
    isAuthenticated: !!user,
    login,
    logout,
    loading,
    refreshAuth,
    checkAuthStatus
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