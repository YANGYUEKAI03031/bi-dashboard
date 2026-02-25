// e:\bi-dashboard\frontend\bi-dashboard\src\pages\ChartsManagementPage.tsx
import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Input, Table, Modal, Typography, Select, Checkbox } from 'antd';
import { DataSourceService } from '../services/dataSourceService';
import { SearchOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import './ChartsManagementPage.css';

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
    x_field?: string;
    y_fields?: string[];
    color_field?: string;
    x_axis_title?: string;
    y_axis_title?: string;
    show_legend?: boolean;
    show_tooltip?: boolean;
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

  // 加载字段数据（简化版，实际需要根据具体数据库结构调整）
  const loadFields = async (databaseId: number) => {
    try {
      // 示例：假设数据库 #1 对应 mysql，表名为 'sales'
      // 实际应用中需要根据数据库类型和表名动态获取
      const tables = await DataSourceService.getTables('mysql');
      if (tables.length > 0) {
        const columns = await DataSourceService.getTableColumns('mysql', tables[0].name);
        
        // 按类型分类字段
        const categoryFields = columns.filter(col => 
          col.type.includes('varchar') || col.type.includes('text') || col.type.includes('char') ||
          col.type.includes('enum') || col.type.includes('string')
        );
        const dateFields = columns.filter(col => 
          col.type.includes('date') || col.type.includes('datetime') || col.type.includes('timestamp')
        );
        const numericFields = columns.filter(col => 
          col.type.includes('int') || col.type.includes('float') || col.type.includes('double') ||
          col.type.includes('decimal') || col.type.includes('numeric')
        );

        setXFields([...categoryFields, ...dateFields]);
        setYFields(numericFields);
        setColorFields([...categoryFields, ...numericFields]);
      }
    } catch (error) {
      console.error('加载字段失败:', error);
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
  const handleEdit = (chart: ChartItem) => {
    setEditingChart(chart);
  };

  // 保存编辑
  const handleEditSave = async () => {
    if (editingChart) {
      try {
        await ChartService.updateChart(editingChart.id, {
          name: editingChart.name,
          chart_type: editingChart.chart_type,
          database_id: editingChart.database_id
        });
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
            <div style={{ marginTop: 8, padding: '4px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              {editingChart?.database_id === 1 ? 'sales' : 
               editingChart?.database_id === 2 ? 'orders' : 
               editingChart?.database_id === 3 ? 'customers' : '未知表'}
            </div>
          </div>

          {/* X轴/Y轴配置区域 */}
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
                  disabled={!xFields.length}
                >
                  {xFields.map(field => (
                    <Option key={field.name} value={field.name}>
                      {field.name} ({field.type})
                    </Option>
                  ))}
                </Select>
              </div>
              
              <div>
                <label>Y轴字段:</label>
                <Select 
                  defaultValue={editingChart.visualization_settings?.y_fields?.[0] || ''}
                  onChange={(value) => {
                    const yFields = [value];
                    const newSettings = { ...editingChart.visualization_settings, y_fields: yFields };
                    const newChart = { ...editingChart, visualization_settings: newSettings };
                    setEditingChart(newChart);
                  }}
                  style={{ marginTop: 8, width: '100%' }}
                  placeholder="选择Y轴字段"
                  disabled={!yFields.length}
                >
                  {yFields.map(field => (
                    <Option key={field.name} value={field.name}>
                      {field.name} ({field.type})
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
                disabled={!colorFields.length}
              >
                {colorFields.map(field => (
                  <Option key={field.name} value={field.name}>
                    {field.name} ({field.type})
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
          </div>

          {/* 图表预览区域 */}
          <div style={{ marginBottom: 24, padding: '16px', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
            <h3 style={{ marginBottom: 12, fontWeight: 600, color: '#333' }}>图表预览</h3>
            <div style={{ height: '300px', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16px', color: '#999', marginBottom: '8px' }}>实时图表预览</div>
                <div style={{ fontSize: '14px', color: '#666' }}>根据当前配置生成预览</div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ChartsManagementPage;