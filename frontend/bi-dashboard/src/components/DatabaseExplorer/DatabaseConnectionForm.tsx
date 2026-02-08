import React, { useState } from 'react';

interface ConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface DatabaseConnectionFormProps {
  onConnect: (connectionInfo: ConnectionInfo) => Promise<boolean>;
  isLoading: boolean;
}

export const DatabaseConnectionForm: React.FC<DatabaseConnectionFormProps> = ({
  onConnect,
  isLoading
}) => {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: '',
    database: ''
  });

  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConnect(connectionInfo);
  };

  const handleChange = (field: keyof ConnectionInfo, value: string | number) => {
    setConnectionInfo(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className="database-connection-form">
      <h3>数据库连接配置</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="host">主机地址:</label>
          <input
            type="text"
            id="host"
            value={connectionInfo.host}
            onChange={(e) => handleChange('host', e.target.value)}
            placeholder="localhost"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="port">端口:</label>
          <input
            type="number"
            id="port"
            value={connectionInfo.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value))}
            placeholder="3306"
            min="1"
            max="65535"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="username">用户名:</label>
          <input
            type="text"
            id="username"
            value={connectionInfo.username}
            onChange={(e) => handleChange('username', e.target.value)}
            placeholder="root"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">密码:</label>
          <div className="password-input">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              value={connectionInfo.password}
              onChange={(e) => handleChange('password', e.target.value)}
              placeholder="请输入密码"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="toggle-password"
            >
              {showPassword ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="database">数据库名称:</label>
          <input
            type="text"
            id="database"
            value={connectionInfo.database}
            onChange={(e) => handleChange('database', e.target.value)}
            placeholder="请选择或输入数据库名"
            required
          />
        </div>

        <button 
          type="submit" 
          disabled={isLoading}
          className="connect-button"
        >
          {isLoading ? '连接中...' : '连接数据库'}
        </button>
      </form>
    </div>
  );
};