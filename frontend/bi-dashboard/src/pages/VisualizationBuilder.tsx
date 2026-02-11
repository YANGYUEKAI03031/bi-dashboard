// frontend/bi-dashboard/src/pages/VisualizationBuilder.tsx
import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Select, Input, Form, Table, Tabs } from 'antd';
import { PlusOutlined, SaveOutlined, DatabaseOutlined, PlayCircleOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined, DotChartOutlined, AreaChartOutlined } from '@ant-design/icons';
import { ChartFactory } from '../components/charts/ChartFactory';
import { ChartConfigPanel } from '../components/charts/ChartConfigPanel';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import { DataSourceService } from '../services/dataSourceService';

const { Option } = Select;
const { TabPane } = Tabs;

interface ChartData {
  id?: number;
  name: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id?: number;
}

interface DataSource {
  id: string;
  name: string;
  type: string;
}

interface TableInfo {
  name: string;
  columns: any[];
}

// 新增：图表类型定义
const CHART_TYPES = [
  { value: 'bar', label: '柱状图', icon: <BarChartOutlined /> },
  { value: 'line', label: '折线图', icon: <LineChartOutlined /> },
  { value: 'area', label: '面积图', icon: <AreaChartOutlined /> },
  { value: 'pie', label: '饼图', icon: <PieChartOutlined /> },
  { value: 'scatter', label: '散点图', icon: <DotChartOutlined /> },
];

export const VisualizationBuilder: React.FC = () => {
  const { user } = useAuth();
  const [chartData, setChartData] = useState<ChartData>({
    name: '新图表',
    chart_type: 'bar',
    dataset_query: {
      type: 'native',
      native: {
        query: ''
      }
    },
    visualization_settings: {
      graph_dimensions: [],
      graph_metrics: [],
      x_axis_title: "X轴",
      y_axis_title: "Y轴",
      x_field: "", // 新增：X轴字段
      y_fields: [], // 新增：Y轴字段（支持多字段）
      color_field: "" // 新增：颜色分组字段
    },
    database_id: 1
  });
  
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [previewData, setPreviewData] = useState<any[]>([]); // 新增：预览数据
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  const [availableFields, setAvailableFields] = useState<string[]>([]); // 新增：可用字段列表

  // 当queryResult变化时，更新表格列定义和可用字段
  useEffect(() => {
    if (queryResult.length > 0) {
      console.log('=== Query Result Data ===');
      console.log('Total records:', queryResult.length);
      console.log('First 5 records:', queryResult.slice(0, 5));
      console.log('Last 5 records:', queryResult.slice(-5));
      console.log('All records:', queryResult);

      const columns = Object.keys(queryResult[0]).map(key => ({
        title: key,
        dataIndex: key,
        key: key,
        sorter: (a: any, b: any) => {
          if (typeof a[key] === 'number' && typeof b[key] === 'number') {
            return a[key] - b[key];
          }
          return String(a[key]).localeCompare(String(b[key]));
        }
      }));
      setTableColumns(columns);
      
      // 更新可用字段列表
      setAvailableFields(Object.keys(queryResult[0]));
      
      // 如果还没有设置字段映射，自动设置默认值
      if (!chartData.visualization_settings.x_field && availableFields.length > 0) {
        setChartData(prev => ({
          ...prev,
          visualization_settings: {
            ...prev.visualization_settings,
            x_field: availableFields[0],
            y_fields: availableFields.slice(1, Math.min(3, availableFields.length)) // 默认选择前几个数值字段
          }
        }));
      }
    }
  }, [queryResult]);

  useEffect(() => {
    loadDataSources();
  }, []);

  const loadDataSources = async () => {
    setLoading(true);
    try {
      const sources = await DataSourceService.getDataSources();
      setDataSources(sources);
      if (sources.length > 0) {
        setSelectedDataSource(sources[0].type);
        loadTables(sources[0].type);
      }
    } catch (error: any) {
      message.error(error.message || '获取数据源失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTables = async (dataSourceType: string) => {
    setLoading(true);
    try {
      const tableList = await DataSourceService.getTables(dataSourceType);
      setTables(tableList);
      
      // 如果有表，自动选择第一个并加载预览数据
      if (tableList.length > 0) {
        setSelectedTable(tableList[0].name);
        loadPreviewData(tableList[0].name);
      }
    } catch (error: any) {
      message.error(error.message || '获取表列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDataSourceChange = (value: string) => {
    setSelectedDataSource(value);
    setTables([]);
    setSelectedTable('');
    setQueryResult([]);
    setPreviewData([]); // 清空预览数据
    setAvailableFields([]);
    loadTables(value);
  };

  const handleTableChange = (value: string) => {
    setSelectedTable(value);
    loadPreviewData(value);
  };

  const loadPreviewData = async (tableName: string) => {
    console.log('开始加载预览数据，表名:', tableName);
    console.log('当前数据源:', selectedDataSource);
    
    setLoading(true);
    try {
      // 执行查询获取所有数据（不加LIMIT）
      const result = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT * FROM ${tableName}`
      });
      
      console.log('查询结果:', result);
      
      // 转换数据格式
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      console.log('格式化后的数据:', formattedData);
      
      // 设置完整数据到queryResult用于图表显示
      setQueryResult(formattedData);
      
      // 设置前10条作为预览数据
      setPreviewData(formattedData.slice(0, 10));
      
      // 获取总记录数（需要执行另一个查询）
      const countResult = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT COUNT(*) as total FROM ${tableName}`
      });
      
      console.log('计数结果:', countResult);
      
      setTotalRecords(countResult.rows[0].total);
      
    } catch (error: any) {
      console.error('加载数据预览失败:', error);
      message.error(error.message || '加载数据预览失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteQuery = async () => {
    if (!selectedDataSource || !selectedTable) {
      message.warning('请选择数据源和表');
      return;
    }

    setLoading(true);
    try {
      const result = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT * FROM ${selectedTable}`
      });
      
      console.log('=== Execute Query Result ===');
      console.log('Raw result:', result);
      console.log('Row count:', result.row_count);
      console.log('Rows length:', result.rows.length);
      
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      console.log('=== Formatted Data ===');
      console.log('Formatted data length:', formattedData.length);
      console.log('Formatted data:', formattedData);
      
      // 更新完整数据
      setQueryResult(formattedData);
      setTotalRecords(result.row_count);
      // 更新预览数据为前10条
      setPreviewData(formattedData.slice(0, 10));
      message.success(`查询成功，返回 ${result.row_count} 条记录`);
    } catch (error: any) {
      message.error(error.message || '查询执行失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (newSettings: any) => {
    setChartData(prev => ({
      ...prev,
      visualization_settings: newSettings
    }));
    setShowConfig(false);
    message.success('配置已更新');
  };

  // 新增：处理图表类型变更
  const handleChartTypeChange = (value: string) => {
    setChartData(prev => ({
      ...prev,
      chart_type: value
    }));
  };

  // 新增：处理字段映射变更
  const handleFieldMappingChange = (fieldType: string, value: any) => {
    setChartData(prev => ({
      ...prev,
      visualization_settings: {
        ...prev.visualization_settings,
        [fieldType]: value
      }
    }));
  };

  const handleSaveChart = async () => {
    if (!user) {
      message.error('请先登录');
      return;
    }
    
    if (queryResult.length === 0) {
      message.error('请先执行查询获取数据');
      return;
    }

    setLoading(true);
    try {
      const chartToSave = {
        ...chartData,
        dataset_query: {
          type: 'native',
          native: {
            query: `SELECT * FROM ${selectedTable}`
          }
        },
        creator_id: user.id
      };
      
      await ChartService.createChart(chartToSave);
      message.success('图表保存成功');
    } catch (error: any) {
      message.error(error.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <Card 
        title="图表构建器" 
        extra={
          <Space>
            <Button 
              icon={<PlusOutlined />} 
              onClick={() => setShowConfig(true)}
            >
              配置图表
            </Button>
            <Button 
              type="primary" 
              icon={<SaveOutlined />} 
              onClick={handleSaveChart}
              loading={loading}
            >
              保存图表
            </Button>
          </Space>
        }
      >
        <Spin spinning={loading}>
          <Tabs defaultActiveKey="1">
            <TabPane tab="数据配置" key="1">
              <Row gutter={24}>
                <Col span={8}>
                  <Card title="数据源配置" size="small">
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <div>
                        <label>数据源:</label>
                        <Select
                          value={selectedDataSource}
                          onChange={handleDataSourceChange}
                          style={{ width: '100%' }}
                          placeholder="选择数据源"
                        >
                          {dataSources.map(source => (
                            <Option key={source.type} value={source.type}>
                              <DatabaseOutlined /> {source.name}
                            </Option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <label>数据表:</label>
                        <Select
                          value={selectedTable}
                          onChange={handleTableChange}
                          style={{ width: '100%' }}
                          placeholder="选择数据表"
                          disabled={!selectedDataSource}
                        >
                          {tables.map(table => (
                            <Option key={table.name} value={table.name}>
                              {table.name}
                            </Option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <p><strong>数据统计:</strong></p>
                        <p>总记录数: {totalRecords} 条</p>
                        <p>预览记录: {previewData.length} 条</p> {/* 更新为显示预览数据条数 */}
                      </div>
                    </Space>
                  </Card>
                </Col>

                <Col span={16}>
                  <Card title="字段映射配置" size="small">
                    <Row gutter={16}>
                      <Col span={8}>
                        <div>
                          <label>图表类型:</label>
                          <Select
                            value={chartData.chart_type}
                            onChange={handleChartTypeChange}
                            style={{ width: '100%' }}
                            placeholder="选择图表类型"
                          >
                            {CHART_TYPES.map(type => (
                              <Option key={type.value} value={type.value}>
                                {type.icon} {type.label}
                              </Option>
                            ))}
                          </Select>
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>X轴字段:</label>
                          <Select
                            value={chartData.visualization_settings.x_field}
                            onChange={(value) => handleFieldMappingChange('x_field', value)}
                            style={{ width: '100%' }}
                            placeholder="选择X轴字段"
                            disabled={availableFields.length === 0}
                          >
                            {availableFields.map(field => (
                              <Option key={field} value={field}>
                                {field}
                              </Option>
                            ))}
                          </Select>
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>Y轴字段 (多选):</label>
                          <Select
                            mode="multiple"
                            value={chartData.visualization_settings.y_fields}
                            onChange={(values) => handleFieldMappingChange('y_fields', values)}
                            style={{ width: '100%' }}
                            placeholder="选择Y轴字段"
                            disabled={availableFields.length === 0}
                          >
                            {availableFields.map(field => (
                              <Option key={field} value={field}>
                                {field}
                              </Option>
                            ))}
                          </Select>
                        </div>
                      </Col>
                    </Row>
                    
                    <Row gutter={16} style={{ marginTop: '16px' }}>
                      <Col span={8}>
                        <div>
                          <label>颜色分组字段:</label>
                          <Select
                            value={chartData.visualization_settings.color_field}
                            onChange={(value) => handleFieldMappingChange('color_field', value)}
                            style={{ width: '100%' }}
                            placeholder="选择颜色分组字段"
                            disabled={availableFields.length === 0}
                            allowClear
                          >
                            {availableFields.map(field => (
                              <Option key={field} value={field}>
                                {field}
                              </Option>
                            ))}
                          </Select>
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>X轴标题:</label>
                          <Input
                            value={chartData.visualization_settings.x_axis_title}
                            onChange={(e) => handleFieldMappingChange('x_axis_title', e.target.value)}
                            placeholder="X轴标题"
                          />
                        </div>
                      </Col>
                      
                      <Col span={8}>
                        <div>
                          <label>Y轴标题:</label>
                          <Input
                            value={chartData.visualization_settings.y_axis_title}
                            onChange={(e) => handleFieldMappingChange('y_axis_title', e.target.value)}
                            placeholder="Y轴标题"
                          />
                        </div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            </TabPane>
            
            <TabPane tab="图表预览" key="2">
              <Card title="图表预览">
                {previewData.length > 0 && chartData.visualization_settings.x_field && chartData.visualization_settings.y_fields.length > 0 ? (
                  <ChartFactory
                    config={{
                      type: chartData.chart_type,
                      title: chartData.name,
                      xAxis: {
                        name: chartData.visualization_settings.x_axis_title || 'X轴'
                      },
                      yAxis: {
                        name: chartData.visualization_settings.y_axis_title || 'Y轴'
                      },
                      series: chartData.visualization_settings.y_fields.map((field: string) => ({
                        name: field,
                        field: field
                      })),
                      xField: chartData.visualization_settings.x_field,
                      colorField: chartData.visualization_settings.color_field
                    }}
                    data={queryResult} // 使用完整数据而不是预览数据
                    style={{ height: '500px' }}
                  />
                ) : (
                  <div style={{ 
                    height: '500px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '4px'
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <p>请完成以下配置以查看图表预览：</p>
                      <ul style={{ textAlign: 'left', display: 'inline-block' }}>
                        <li>选择数据表</li>
                        <li>选择图表类型</li>
                        <li>配置X轴字段</li>
                        <li>配置Y轴字段</li>
                      </ul>
                    </div>
                  </div>
                )}
              </Card>
            </TabPane>
          </Tabs>

          {/* 数据预览表格 - 放在下方 */}
          <Row gutter={24} style={{ marginTop: '24px' }}>
            <Col span={24}>
              <Card title="数据预览">
                {queryResult.length > 0 ? (
                  <Table
                    dataSource={queryResult.map((item, index) => ({ ...item, key: index }))}
                    columns={tableColumns}
                    pagination={{ 
                      pageSize: 5,
                      size: 'small',
                      showSizeChanger: false
                    }}
                    size="small"
                    scroll={{ y: 300 }}
                  />
                ) : (
                  <div style={{ 
                    height: '350px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: '#fafafa',
                    borderRadius: '4px'
                  }}>
                    <p>暂无数据预览</p>
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </Spin>
      </Card>

      {showConfig && (
        <ChartConfigPanel
          initialSettings={chartData.visualization_settings}
          availableFields={availableFields}
          onSave={handleConfigChange}
          onCancel={() => setShowConfig(false)}
        />
      )}
    </div>
  );
};