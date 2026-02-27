// e:\bi-dashboard\frontend\bi-dashboard\src\pages\ChartsManagementPage.tsx
import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Input, Table, Modal, Typography, Select, Checkbox } from 'antd';
import { DataSourceService } from '../services/dataSourceService';
import { SearchOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import './ChartsManagementPage.css';
// 添加ChartFactory导入
import { ChartFactory } from '../components/charts/ChartFactory';
// 添加AuthService导入
import { AuthService } from '../services/authService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

const { Title, Text } = Typography;
const { Option } = Select;
const { Search } = Input;

interface ChartItem {
  id: number;
  name: string;
  chart_type: string;
  database_id: number;
  table_name?: string;  // 新增：表名字段
  created_at: string;
  visualization_settings?: {
    // 前端使用的字段
    x_field?: string;
    y_fields?: string[];
    color_field?: string;
    x_axis_title?: string;
    y_axis_title?: string;
    show_legend?: boolean;
    show_tooltip?: boolean;
    sort_by?: 'x' | 'y';
    sort_order?: 'asc' | 'desc';
    // 后端格式的字段（用于兼容）
    "graph.dimensions"?: string[];
    "graph.metrics"?: string[];
    "graph.x_axis.title"?: string;
    "graph.y_axis.title"?: string;
    "graph.show_legend"?: boolean;
    "graph.show_tooltip"?: boolean;
    "graph.colors"?: string[];
  };
}

export const ChartsManagementPage: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const [charts, setCharts] = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [chartToDelete, setChartToDelete] = useState<number | null>(null);
  const [editingChart, setEditingChart] = useState<ChartItem | null>(null);
  
  // 字段数据状态
  const [xFields, setXFields] = useState<any[]>([]);
  const [yFields, setYFields] = useState<any[]>([]);
  const [colorFields, setColorFields] = useState<any[]>([]);
  
  // 预览数据状态
  const [previewData, setPreviewData] = useState<any[]>([]);
  
  // 加载预览数据
  const loadPreviewData = async (databaseId: number, tableName: string) => {
    try {
      console.log('开始加载预览数据:', { databaseId, tableName });
      
      // 构建查询语句
      const query = `SELECT * FROM \`${tableName}\` LIMIT 10`;
      
      // 调用后端API执行查询
      const response = await fetch(`${API_BASE_URL}/visualization/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AuthService.getAuthToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data_source_id: databaseId.toString(),
          query: query
        }),
      });
      
      if (!response.ok) {
        throw new Error(`查询失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('预览数据结果:', result);
      
      setPreviewData(result.rows || []);
      
    } catch (error) {
      console.error('加载预览数据失败:', error);
      message.error('加载预览数据失败，请检查数据源连接');
      setPreviewData([]);
    }
  };

  // 监听排序配置变化，强制重新渲染图表
  useEffect(() => {
    if (editingChart && previewData.length > 0) {
      // 强制触发重新渲染
      setPreviewData(prev => [...prev]);
    }
  }, [editingChart?.visualization_settings?.sort_by, editingChart?.visualization_settings?.sort_order, editingChart, previewData.length]);

  // 加载字段数据
  const loadFields = async (databaseId: number, tableName?: string) => {
    try {
      console.log('开始加载字段数据:', { databaseId, tableName });
      
      // 根据数据库ID确定表名
      let actualTableName = tableName;
      if (!actualTableName) {
        // 如果没有表名，根据数据库ID推测
        switch(databaseId) {
          case 1: actualTableName = 'sales'; break;
          case 2: actualTableName = 'orders'; break;
          case 3: actualTableName = 'customers'; break;
          default: actualTableName = 'sales'; // 默认表名
        }
      }
      
      console.log('使用的表名:', actualTableName);
      
      // 获取表的列信息
      const columns = await DataSourceService.getTableColumns('mysql', actualTableName);
      console.log('获取到的列信息:', columns);
      
      if (columns && columns.length > 0) {
        // 按类型分类字段
        const categoryFields = columns.filter(col => 
          col.type.toLowerCase().includes('varchar') || 
          col.type.toLowerCase().includes('text') || 
          col.type.toLowerCase().includes('char') ||
          col.type.toLowerCase().includes('enum') || 
          col.type.toLowerCase().includes('string')
        );
        
        const dateFields = columns.filter(col => 
          col.type.toLowerCase().includes('date') || 
          col.type.toLowerCase().includes('datetime') || 
          col.type.toLowerCase().includes('timestamp')
        );
        
        const numericFields = columns.filter(col => 
          col.type.toLowerCase().includes('int') || 
          col.type.toLowerCase().includes('float') || 
          col.type.toLowerCase().includes('double') ||
          col.type.toLowerCase().includes('decimal') || 
          col.type.toLowerCase().includes('numeric')
        );

        console.log('分类后的字段:', { 
          categoryFields: categoryFields.length,
          dateFields: dateFields.length, 
          numericFields: numericFields.length 
        });

        setXFields([...categoryFields, ...dateFields]);
        setYFields(numericFields);
        setColorFields([...categoryFields, ...numericFields]);
        
        // 智能设置默认字段（如果当前没有设置）
        setEditingChart(prev => {
          if (prev) {
            const currentSettings = prev.visualization_settings || {};
            const hasXField = currentSettings.x_field;
            const hasYFields = currentSettings.y_fields && currentSettings.y_fields.length > 0;
            
            // 如果没有设置字段，则自动设置默认值
            if (!hasXField || !hasYFields) {
              const newSettings = { ...currentSettings };
              
              // 设置X轴字段
              if (!hasXField && categoryFields.length > 0) {
                newSettings.x_field = categoryFields[0].name;
                newSettings.x_axis_title = categoryFields[0].name || 'X轴';
              } else if (!hasXField && dateFields.length > 0) {
                newSettings.x_field = dateFields[0].name;
                newSettings.x_axis_title = dateFields[0].name || 'X轴';
              }
              
              // 设置Y轴字段
              if (!hasYFields && numericFields.length > 0) {
                const defaultYFields = numericFields.slice(0, Math.min(3, numericFields.length)).map(f => f.name);
                newSettings.y_fields = defaultYFields;
                newSettings.y_axis_title = defaultYFields.length > 1 ? '汇总' : (defaultYFields[0] || 'Y轴');
              }
              
              return {
                ...prev,
                visualization_settings: newSettings
              };
            }
          }
          return prev;
        });
      } else {
        console.warn('未获取到列信息');
        setXFields([]);
        setYFields([]);
        setColorFields([]);
      }
    } catch (error) {
      console.error('加载字段失败:', error);
      message.error('加载字段数据失败，请检查数据源连接');
      setXFields([]);
      setYFields([]);
      setColorFields([]);
    }
  };

  // 获取图表列表
  const fetchCharts = async () => {
    try {
      setLoading(true);
      const response = await ChartService.getUserCharts();
      setCharts(response || []);
    } catch (error) {
      console.error('获取图表列表失败:', error);
      message.error('获取图表列表失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 删除图表
  const handleDelete = async (chartId: number) => {
    try {
      await ChartService.deleteChart(chartId);
      message.success('图表删除成功');
      fetchCharts();
    } catch (error) {
      console.error('删除图表失败:', error);
      message.error('删除图表失败，请重试');
    } finally {
      setDeleteModalVisible(false);
      setChartToDelete(null);
    }
  };

  // 编辑图表
  const handleEdit = async (chart: ChartItem) => {
    console.log('编辑图表数据:', chart);
    console.log('visualization_settings:', chart.visualization_settings);
    
    // 处理后端格式到前端格式的转换
    let chartWithFrontendSettings = { ...chart };
    
    // 确保visualization_settings存在
    if (!chartWithFrontendSettings.visualization_settings) {
      chartWithFrontendSettings.visualization_settings = {};
    }
    
    const settings = chartWithFrontendSettings.visualization_settings;
    
    // 尝试各种可能的字段名（使用类型断言避免编译错误）
    const graphDimensions = (settings as any)["graph.dimensions"] || 
                           (settings as any)["graph_dimensions"] || 
                           (settings as any).graphDimensions;
    
    const graphMetrics = (settings as any)["graph.metrics"] || 
                        (settings as any)["graph_metrics"] || 
                        (settings as any).graphMetrics;
    
    const xAxisTitle = (settings as any)["graph.x_axis.title"] || 
                      (settings as any)["graph_x_axis_title"] || 
                      (settings as any).xAxisTitle ||
                      (settings as any)["x_axis_title"];
    
    const yAxisTitle = (settings as any)["graph.y_axis.title"] || 
                      (settings as any)["graph_y_axis_title"] || 
                      (settings as any).yAxisTitle ||
                      (settings as any)["y_axis_title"];
    
    // 设置X轴字段
    if (graphDimensions && Array.isArray(graphDimensions) && graphDimensions.length > 0) {
      chartWithFrontendSettings.visualization_settings = {
        ...settings,
        x_field: graphDimensions[0]
      };
    }
    
    // 设置Y轴字段
    if (graphMetrics && Array.isArray(graphMetrics)) {
      chartWithFrontendSettings.visualization_settings = {
        ...(chartWithFrontendSettings.visualization_settings || {}),
        y_fields: graphMetrics
      };
    }
    
    // 设置标题
    if (xAxisTitle) {
      chartWithFrontendSettings.visualization_settings = {
        ...(chartWithFrontendSettings.visualization_settings || {}),
        x_axis_title: xAxisTitle
      };
    }
    
    if (yAxisTitle) {
      chartWithFrontendSettings.visualization_settings = {
        ...(chartWithFrontendSettings.visualization_settings || {}),
        y_axis_title: yAxisTitle
      };
    }
    
    // 设置默认排序配置（如果不存在的话）
    if (!chartWithFrontendSettings.visualization_settings.sort_by) {
      chartWithFrontendSettings.visualization_settings = {
        ...(chartWithFrontendSettings.visualization_settings || {}),
        sort_by: 'x'
      };
    }
    
    if (!chartWithFrontendSettings.visualization_settings.sort_order) {
      chartWithFrontendSettings.visualization_settings = {
        ...(chartWithFrontendSettings.visualization_settings || {}),
        sort_order: 'asc'
      };
    }
    
    console.log('处理后的图表数据:', chartWithFrontendSettings);
    setEditingChart(chartWithFrontendSettings);
    
    // 加载字段数据
    if (chart.database_id) {
      await loadFields(chart.database_id, chart.table_name);
    }
    // 加载预览数据
    if (chart.database_id && chart.table_name) {
      await loadPreviewData(chart.database_id, chart.table_name);
    }
  };

  // 保存编辑
  const handleEditSave = async () => {
    if (editingChart) {
      try {
        // 构建完整的更新数据，包含visualization_settings和dataset_query
        // 根据X轴和Y轴字段生成新的SQL查询
        let selectFields = [];
        if (editingChart.visualization_settings?.x_field) {
          selectFields.push(editingChart.visualization_settings.x_field);
        }
        if (editingChart.visualization_settings?.y_fields && editingChart.visualization_settings.y_fields.length > 0) {
          selectFields.push(...editingChart.visualization_settings.y_fields);
        }
        
        const querySql = `SELECT ${selectFields.join(', ')} FROM ${editingChart.table_name || 'zfcount'} LIMIT 1000`;
        
        const updateData = {
          name: editingChart.name,
          chart_type: editingChart.chart_type,
          database_id: editingChart.database_id,
          visualization_settings: {
            // 使用后端期望的原始字段名
            graph_dimensions: editingChart.visualization_settings?.x_field ? [editingChart.visualization_settings.x_field] : [],
            graph_metrics: editingChart.visualization_settings?.y_fields || [],
            x_axis_title: editingChart.visualization_settings?.x_axis_title || 'X轴',
            y_axis_title: editingChart.visualization_settings?.y_axis_title || 'Y轴',
            show_legend: editingChart.visualization_settings?.show_legend !== false,
            tooltip_enabled: editingChart.visualization_settings?.show_tooltip !== false,
            // 排序配置
            'graph.sort_by': editingChart.visualization_settings?.sort_by || 'x',
            'graph.sort_order': editingChart.visualization_settings?.sort_order || 'asc'
          },
          dataset_query: {
            type: 'native',
            native: {
              query: querySql
            }
          }
        };

        await ChartService.updateChart(editingChart.id, updateData);
        message.success('图表更新成功');
        fetchCharts();
        setEditingChart(null);
      } catch (error) {
        console.error('更新图表失败:', error);
        message.error('更新图表失败，请重试');
      }
    }
  };

  // 取消编辑
  const handleEditCancel = () => {
    setEditingChart(null);
  };

  // 搜索过滤
  const filteredCharts = charts.filter(chart =>
    chart.name.toLowerCase().includes(searchText.toLowerCase()) ||
    chart.chart_type.toLowerCase().includes(searchText.toLowerCase())
  );

  // 表格列定义
  const columns = [
    {
      title: '图表名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ChartItem) => (
        <div>
          <div className="chart-name">{text}</div>
          <div className="chart-type">{record.chart_type}</div>
        </div>
      ),
    },
    {
      title: '数据源',
      dataIndex: 'database_id',
      key: 'database_id',
      render: (databaseId: number) => (
        <span className="chart-datasource">数据库 #{databaseId}</span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: ChartItem) => (
        <div className="chart-actions">
          <Button 
            type="link" 
            icon={<EditOutlined />} 
            className="edit-btn chart-action-btn"
            onClick={() => handleEdit(record)}
            size="small"
          >
            编辑
          </Button>
          <Button 
            type="link" 
            icon={<DeleteOutlined />} 
            className="delete-btn chart-action-btn"
            onClick={() => {
              setChartToDelete(record.id);
              setDeleteModalVisible(true);
            }}
            size="small"
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  // 初始化
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchCharts();
    }
  }, [isAuthenticated, user]);

  return (
    <div className="charts-management-page">
      {/* 页面头部 */}
      <div className="page-header">
        <div className="header-content">
          <div>
            <Title level={2} className="header-title">图表管理</Title>
            <Text type="secondary">管理和维护您的所有可视化图表</Text>
          </div>
          <div className="header-actions">
            <Search
              placeholder="搜索图表名称或类型"
              allowClear
              enterButton="搜索"
              size="middle"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onSearch={(value) => setSearchText(value)}
              className="search-input"
            />
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => window.location.href = '/visualization-builder'}
            >
              创建新图表
            </Button>
          </div>
        </div>
      </div>

      {/* 图表列表区域 */}
      <div className="chart-list-panel">
        <div className="chart-table-container">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size="large" />
            </div>
          ) : filteredCharts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <h3 className="empty-state-title">暂无图表</h3>
              <p className="empty-state-description">您还没有创建任何图表。点击上方的"创建新图表"按钮开始创建。</p>
            </div>
          ) : (
            <Table
              columns={columns}
              dataSource={filteredCharts}
              rowKey="id"
              pagination={{
                pageSize: 10,
                showTotal: (total) => `共 ${total} 个图表`,
              }}
              scroll={{ y: 500 }}
              bordered={false}
            />
          )}
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deleteModalVisible && (
        <Modal
          title="确认删除"
          open={true}
          onOk={() => chartToDelete && handleDelete(chartToDelete)}
          onCancel={() => {
            setDeleteModalVisible(false);
            setChartToDelete(null);
          }}
          okText="确认删除"
          cancelText="取消"
        >
          <p>确定要删除此图表吗？删除后无法恢复。</p>
          <p><strong>注意：</strong>此操作将永久删除图表及其配置。</p>
        </Modal>
      )}

      {/* 编辑模态框 */}
      {editingChart && (
        <Modal
          title="编辑图表"
          open={true}
          onCancel={handleEditCancel}
          footer={[
            <Button key="cancel" onClick={handleEditCancel}>
              取消
            </Button>,
            <Button 
              key="save" 
              type="primary" 
              onClick={handleEditSave}
            >
              保存修改
            </Button>
          ]}
          width={800}
        >
          <div style={{ marginBottom: 16 }}>
            <label>图表名称:</label>
            <Input 
              defaultValue={editingChart.name} 
              onChange={(e) => {
                const newChart = { ...editingChart, name: e.target.value };
                setEditingChart(newChart);
              }}
              style={{ marginTop: 8 }}
            />
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <label>图表类型:</label>
            <Select 
              defaultValue={editingChart.chart_type}
              onChange={(value) => {
                const newChart = { ...editingChart, chart_type: value };
                setEditingChart(newChart);
              }}
              style={{ marginTop: 8 }}
              placeholder="选择图表类型"
            >
              <Option value="bar">柱状图</Option>
              <Option value="line">折线图</Option>
              <Option value="area">面积图</Option>
              <Option value="pie">饼图</Option>
              <Option value="scatter">散点图</Option>
            </Select>
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <label>数据源:</label>
            <div style={{ marginTop: 8, padding: '8px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
              <div><strong>数据库ID:</strong> #{editingChart?.database_id}</div>
              <div><strong>表名:</strong> {editingChart?.table_name || '未指定'}</div>
            </div>
          </div>

          {/* 调试信息区域 */}
          <div style={{ marginBottom: 16, padding: '12px', backgroundColor: '#f0f8ff', border: '1px solid #d0e6ff', borderRadius: '4px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>调试信息</h4>
            <div style={{ fontSize: '12px', color: '#666' }}>
              <div><strong>当前图表ID:</strong> {editingChart?.id}</div>
              <div><strong>X轴字段数量:</strong> {xFields.length}</div>
              <div><strong>Y轴字段数量:</strong> {yFields.length}</div>
              <div><strong>颜色字段数量:</strong> {colorFields.length}</div>
              <div><strong>当前X轴设置:</strong> {editingChart?.visualization_settings?.x_field || '未设置'}</div>
              <div><strong>当前Y轴设置:</strong> {editingChart?.visualization_settings?.y_fields?.join(', ') || '未设置'}</div>
            </div>
          </div>
          <div style={{ marginBottom: 24, padding: '16px', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
            <h3 style={{ marginBottom: 12, fontWeight: 600, color: '#333' }}>坐标轴配置</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label>X轴字段:</label>
                <Select 
                  defaultValue={editingChart.visualization_settings?.x_field || ''}
                  onChange={(value) => {
                    const newSettings = { ...editingChart.visualization_settings, x_field: value };
                    const newChart = { ...editingChart, visualization_settings: newSettings };
                    setEditingChart(newChart);
                  }}
                  style={{ marginTop: 8, width: '100%' }}
                  placeholder="选择X轴字段"
                  notFoundContent={xFields.length === 0 ? "未加载到可用字段" : "无匹配字段"}
                >
                  {xFields.map(field => (
                    <Option key={field.name} value={field.name}>
                      {field.name}
                    </Option>
                  ))}
                </Select>
              </div>
              
              <div>
                <label>Y轴字段 (可多选):</label>
                <Select 
                  mode="multiple"
                  defaultValue={editingChart.visualization_settings?.y_fields || []}
                  onChange={(values) => {
                    const newSettings = { ...editingChart.visualization_settings, y_fields: values };
                    const newChart = { ...editingChart, visualization_settings: newSettings };
                    setEditingChart(newChart);
                  }}
                  style={{ marginTop: 8, width: '100%' }}
                  placeholder="选择一个或多个Y轴字段"
                  notFoundContent={yFields.length === 0 ? "未加载到可用字段" : "无匹配字段"}
                >
                  {yFields.map(field => (
                    <Option key={field.name} value={field.name}>
                      {field.name}
                    </Option>
                  ))}
                </Select>
              </div>
            </div>
            
            <div style={{ marginTop: 16 }}>
              <label>颜色字段:</label>
              <Select 
                defaultValue={editingChart.visualization_settings?.color_field || ''}
                onChange={(value) => {
                  const newSettings = { ...editingChart.visualization_settings, color_field: value };
                  const newChart = { ...editingChart, visualization_settings: newSettings };
                  setEditingChart(newChart);
                }}
                style={{ marginTop: 8, width: '100%' }}
                placeholder="选择颜色字段"
                notFoundContent={colorFields.length === 0 ? "未加载到可用字段" : "无匹配字段"}
              >
                {colorFields.map(field => (
                  <Option key={field.name} value={field.name}>
                    {field.name}
                  </Option>
                ))}
              </Select>
            </div>
          </div>

          {/* 高级设置区域 */}
          <div style={{ marginBottom: 24, padding: '16px', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
            <h3 style={{ marginBottom: 12, fontWeight: 600, color: '#333' }}>高级设置</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label>X轴标题:</label>
                <Input 
                  defaultValue={editingChart.visualization_settings?.x_axis_title || 'X轴'}
                  onChange={(e) => {
                    const newSettings = { ...editingChart.visualization_settings, x_axis_title: e.target.value };
                    const newChart = { ...editingChart, visualization_settings: newSettings };
                    setEditingChart(newChart);
                  }}
                  style={{ marginTop: 8 }}
                />
              </div>
              
              <div>
                <label>Y轴标题:</label>
                <Input 
                  defaultValue={editingChart.visualization_settings?.y_axis_title || 'Y轴'}
                  onChange={(e) => {
                    const newSettings = { ...editingChart.visualization_settings, y_axis_title: e.target.value };
                    const newChart = { ...editingChart, visualization_settings: newSettings };
                    setEditingChart(newChart);
                  }}
                  style={{ marginTop: 8 }}
                />
              </div>
            </div>
            
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Checkbox 
                checked={editingChart.visualization_settings?.show_legend !== false}
                onChange={(e) => {
                  const newSettings = { ...editingChart.visualization_settings, show_legend: e.target.checked };
                  const newChart = { ...editingChart, visualization_settings: newSettings };
                  setEditingChart(newChart);
                }}
              >
                显示图例
              </Checkbox>
              
              <Checkbox 
                checked={editingChart.visualization_settings?.show_tooltip !== false}
                onChange={(e) => {
                  const newSettings = { ...editingChart.visualization_settings, show_tooltip: e.target.checked };
                  const newChart = { ...editingChart, visualization_settings: newSettings };
                  setEditingChart(newChart);
                }}
              >
                显示提示
              </Checkbox>
            </div>
            
            {/* 排序设置区域 */}
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>排序设置</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label>排序方式:</label>
                  <Select 
                    value={(editingChart.visualization_settings as any)?.sort_by || 'x'}
                    onChange={(value) => {
                      const newSettings = { ...(editingChart.visualization_settings as any), sort_by: value };
                      const newChart = { ...editingChart, visualization_settings: newSettings };
                      setEditingChart(newChart);
                    }}
                    style={{ marginTop: 8, width: '100%' }}
                    placeholder="选择排序方式"
                  >
                    <Option value="x">按X轴排序</Option>
                    <Option value="y">按Y轴排序</Option>
                  </Select>
                </div>
                
                <div>
                  <label>排序顺序:</label>
                  <Select 
                    value={(editingChart.visualization_settings as any)?.sort_order || 'asc'}
                    onChange={(value) => {
                      const newSettings = { ...(editingChart.visualization_settings as any), sort_order: value };
                      const newChart = { ...editingChart, visualization_settings: newSettings };
                      setEditingChart(newChart);
                    }}
                    style={{ marginTop: 8, width: '100%' }}
                    placeholder="选择排序顺序"
                  >
                    <Option value="asc">升序</Option>
                    <Option value="desc">降序</Option>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {/* 图表预览区域 */}
          <div style={{ marginBottom: 24, padding: '16px', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
            <h3 style={{ marginBottom: 12, fontWeight: 600, color: '#333' }}>图表预览</h3>
            <div style={{ height: '100%', minHeight: '300px', maxHeight: '600px' }}>
              {editingChart && (
                <div>
                  {previewData.length > 0 ? (
                    <ChartFactory
                      config={
                        {
                          type: editingChart.chart_type,
                          title: editingChart.name,
                          xField: editingChart.visualization_settings?.x_field || '',
                          yFields: editingChart.visualization_settings?.y_fields || [],
                          colorField: editingChart.visualization_settings?.color_field || '',
                          sort_by: (editingChart.visualization_settings as any)?.sort_by,
                          sort_order: (editingChart.visualization_settings as any)?.sort_order,
                          xAxis: {
                            name: editingChart.visualization_settings?.x_axis_title || 'X轴'
                          },
                          yAxis: {
                            name: editingChart.visualization_settings?.y_axis_title || 'Y轴'
                          },
                          series: [] // 添加空的series数组以满足类型要求
                        }
                      }
                      data={previewData}
                      style={{ height: '400px', width: '100%' }}
                    />
                  ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                      <div style={{ textAlign: 'center', padding: '20px' }}>
                        <div style={{ fontSize: '16px', color: '#999', marginBottom: '8px' }}>需要配置字段</div>
                        <div style={{ fontSize: '14px', color: '#666' }}>请先选择X轴和Y轴字段以生成预览</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ChartsManagementPage;