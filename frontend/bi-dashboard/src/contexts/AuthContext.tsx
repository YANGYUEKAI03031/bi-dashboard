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

  const applyRole = useCallback(async (retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try {
        const permissions = await PermissionService.getMyRole();
        if (permissions && permissions.role) {
          setRole(permissions.role);
          setIsAdmin(Boolean(permissions.is_admin));
          return;
        }
      } catch {
        if (i < retries) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  }, []);

  const checkAuthStatus = useCallback(async (): Promise<boolean> => {
    try {
      const token = AuthService.getAuthToken();

      if (!token) {
        setUser(null);
        setRole('user');
        setIsAdmin(false);
        return false;
      }

      const currentUser = await AuthService.getCurrentUser();

      if (!currentUser) {
        AuthService.clearAuth();
        setUser(null);
        setRole('user');
        setIsAdmin(false);
        return false;
      }

      setUser({
        id: currentUser.id,
        username: currentUser.username,
        email: currentUser.email,
        full_name: currentUser.full_name,
      });
      await applyRole();
      return true;
    } catch {
      AuthService.clearAuth();
      setUser(null);
      setRole('user');
      setIsAdmin(false);
      return false;
    }
  }, [applyRole]);

  const refreshAuth = useCallback(async () => {
    setLoading(true);
    await checkAuthStatus();
    setLoading(false);
  }, [checkAuthStatus]);

  useEffect(() => {
    const initializeAuth = async () => {
      await checkAuthStatus();
      setLoading(false);
    };

    initializeAuth();
  }, [checkAuthStatus]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'authToken') {
        refreshAuth();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshAuth]);

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const response = await AuthService.login({ username, password });

        if (response.success && response.user) {
          const { role, is_admin } = response.user;
          setUser({
            id: response.user.id,
            username: response.user.username,
            email: response.user.email,
            full_name: response.user.full_name,
          });
          // 优先使用登录响应中的角色信息
          if (role) {
            setRole(role);
          }
          if (typeof is_admin === 'boolean') {
            setIsAdmin(is_admin);
          } else {
            // 如果登录响应没有角色信息，调用 API 获取
            await applyRole();
          }
        }

        return { success: response.success, message: response.message };
      } catch {
        return { success: false, message: '登录过程中发生错误' };
      }
    },
    [applyRole],
  );

  const logout = useCallback(async () => {
    try {
      await AuthService.logout();
    } finally {
      setUser(null);
      setRole('user');
      setIsAdmin(false);
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
    checkAuthStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
