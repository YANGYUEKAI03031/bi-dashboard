import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthService, LoginCredentials } from '../services/authService';
import './LoginPage.css';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showContactDialog, setShowContactDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [debugInfo, setDebugInfo] = useState(''); // 添加调试信息状态
  const navigate = useNavigate();

  // 检查是否已经登录
  useEffect(() => {
    if (AuthService.isAuthenticated()) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 清除之前的错误消息
    setErrorMessage('');
    setDebugInfo('');
    
    // 基本验证
    if (!username.trim() || !password.trim()) {
      setErrorMessage('请输入用户名和密码');
      return;
    }

    setIsLoading(true);
    
    try {
      const credentials: LoginCredentials = {
        username: username.trim(),
        password: password.trim()
      };

      console.log('发送登录请求:', credentials);
      const response = await AuthService.login(credentials);
      console.log('收到响应:', response);
      
      if (response.success && response.token) {
        // 登录成功
        AuthService.setAuthToken(response.token);
        console.log('登录成功:', { username, userId: response.user?.id });
        
        // 跳转到仪表板页面
        navigate('/dashboard');
      } else {
        // 登录失败
        const errorMsg = response.message || '用户名或密码错误';
        setErrorMessage(errorMsg);
        // 显示更多调试信息
        if (response.message) {
          setDebugInfo(`详细错误: ${response.message}`);
        }
      }
    } catch (error) {
      console.error('登录异常:', error);
      setErrorMessage('登录过程中发生未知错误');
      setDebugInfo(`异常详情: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowContactDialog(true);
  };

  const closeContactDialog = () => {
    setShowContactDialog(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-welcome">
          <h2>欢迎回来</h2>
          <p>请登录您的账户</p>
        </div>
        
        {/* 错误消息显示 */}
        {errorMessage && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {errorMessage}
            {debugInfo && (
              <div className="debug-info" style={{ fontSize: '0.8em', marginTop: '5px', opacity: 0.8 }}>
                {debugInfo}
              </div>
            )}
          </div>
        )}
        
        <form className="login-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              disabled={isLoading}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              disabled={isLoading}
            />
          </div>
          
          <div className="form-actions">
            <button 
              type="submit" 
              className="btn-login"
              disabled={isLoading}
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
          </div>
        </form>
        
        <div className="login-footer">
          <a href="#forgot-password" onClick={handleForgotPassword}>
            忘记密码？
          </a>
        </div>
      </div>

      {/* 联系管理员对话框 */}
      {showContactDialog && (
        <div className="dialog-overlay" onClick={closeContactDialog}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>忘记密码</h3>
            </div>
            <div className="dialog-body">
              <p>请联系系统管理员重置您的密码：</p>
              <div className="contact-info">
                <p><strong>邮箱：</strong> yangyuekai03031@163.com</p>
                <p><strong>电话：</strong> 19884708131</p>
                <p><strong>工作时间：</strong> 周一至周五 9:00-18:00</p>
              </div>
            </div>
            <div className="dialog-footer">
              <button className="btn-close" onClick={closeContactDialog}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};