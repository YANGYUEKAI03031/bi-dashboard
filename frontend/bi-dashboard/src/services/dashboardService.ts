// src/services/dashboardService.ts

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

interface DashboardCreateRequest {
  name: string;
  description?: string;
  layout?: any;
  settings?: any;
  is_public?: boolean;
}

interface DashboardUpdateRequest {
  name?: string;
  description?: string;
  layout?: any;
  settings?: any;
  is_public?: boolean;
}

interface DashboardCardCreateRequest {
  chart_id: number;
  card_row: number;
  card_col: number;
  size_x: number;
  size_y: number;
  visualization_settings?: any;
  parameter_mappings?: any;
}

interface DashboardCardUpdateRequest {
  card_row?: number;
  card_col?: number;
  size_x?: number;
  size_y?: number;
  visualization_settings?: any;
  parameter_mappings?: any;
}

export class DashboardService {
  static async getUserDashboards(): Promise<any[]> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('获取仪表盘列表失败:', error);
      throw error;
    }
  }

  static async createDashboard(dashboardData: DashboardCreateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dashboardData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('创建仪表盘失败:', error);
      throw error;
    }
  }

  static async getDashboard(dashboardId: number): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('获取仪表盘失败:', error);
      throw error;
    }
  }

  static async updateDashboard(dashboardId: number, dashboardData: DashboardUpdateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dashboardData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('更新仪表盘失败:', error);
      throw error;
    }
  }

  static async addChartToDashboard(dashboardId: number, cardData: DashboardCardCreateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}/cards`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cardData),
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          // 克隆响应以便可以多次读取
          const clonedResponse = response.clone();
          const errorData = await clonedResponse.json();
          
          // 调试：记录原始错误数据
          console.error('[DashboardService] 错误响应数据:', errorData);
          console.error('[DashboardService] 错误数据类型:', typeof errorData);
          console.error('[DashboardService] 错误数据键:', errorData && typeof errorData === 'object' ? Object.keys(errorData) : 'N/A');
          
          // 确保 errorMessage 始终是字符串
          if (errorData && typeof errorData === 'object') {
            // 优先使用 detail，然后是 message，最后尝试其他常见字段
            const extractedMsg = errorData.detail || 
                                errorData.message || 
                                errorData.error || 
                                errorData.msg;
            
            console.error('[DashboardService] 提取的消息:', extractedMsg);
            console.error('[DashboardService] 提取的消息类型:', typeof extractedMsg);
            
            if (extractedMsg && typeof extractedMsg === 'string') {
              errorMessage = extractedMsg;
            } else if (extractedMsg && typeof extractedMsg === 'object') {
              // 如果提取的消息本身是对象，尝试序列化
              try {
                errorMessage = JSON.stringify(extractedMsg);
                console.error('[DashboardService] 序列化后的消息:', errorMessage);
              } catch (e) {
                console.error('[DashboardService] 序列化失败:', e);
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
              }
            } else {
              // 如果没有任何常见字段，尝试序列化整个对象
              try {
                const jsonStr = JSON.stringify(errorData);
                console.error('[DashboardService] 完整对象序列化:', jsonStr);
                if (jsonStr && jsonStr !== '{}' && jsonStr !== 'null') {
                  errorMessage = jsonStr.length > 200 ? jsonStr.substring(0, 200) + '...' : jsonStr;
                }
              } catch (e) {
                // JSON 序列化失败，使用默认消息
                console.error('[DashboardService] 无法序列化错误数据:', e);
              }
            }
          } else if (typeof errorData === 'string') {
            errorMessage = errorData;
          } else if (errorData !== null && errorData !== undefined) {
            // 其他类型，转换为字符串
            errorMessage = String(errorData);
          }
        } catch (e) {
          // 如果响应不是 JSON，尝试读取文本
          console.error('[DashboardService] JSON 解析失败，尝试读取文本:', e);
          try {
            const clonedResponse = response.clone();
            const text = await clonedResponse.text();
            console.error('[DashboardService] 响应文本:', text);
            if (text && text.trim()) {
              errorMessage = text;
            }
          } catch (textError) {
            // 如果读取文本也失败，使用默认错误消息
            console.error('[DashboardService] 无法读取错误响应:', textError);
          }
        }
        
        // 确保 errorMessage 是字符串类型
        const finalErrorMessage = typeof errorMessage === 'string' ? errorMessage : String(errorMessage);
        console.error('[DashboardService] 最终错误消息:', finalErrorMessage);
        throw new Error(finalErrorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('添加图表到仪表盘失败:', error);
      // 确保抛出的是 Error 对象，并且有 message 属性
      if (error instanceof Error) {
        throw error;
      } else if (error && typeof error === 'object' && error.message) {
        throw new Error(String(error.message));
      } else {
        throw new Error(String(error) || '添加图表到仪表盘失败');
      }
    }
  }

  static async updateDashboardCard(cardId: number, updateData: DashboardCardUpdateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/cards/${cardId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('更新仪表盘卡片失败:', error);
      throw error;
    }
  }

  static async removeChartFromDashboard(cardId: number): Promise<void> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/cards/${cardId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('从仪表盘移除图表失败:', error);
      throw error;
    }
  }

  static async deleteDashboard(dashboardId: number): Promise<void> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('删除仪表盘失败:', error);
      throw error;
    }
  }
}