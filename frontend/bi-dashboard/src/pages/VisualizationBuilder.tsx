// frontend/bi-dashboard/src/pages/VisualizationBuilder.tsx
import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, message, Spin, Select, Input, Form } from 'antd';
import { PlusOutlined, SaveOutlined, DatabaseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { ChartFactory } from '../components/charts/ChartFactory';
import { ChartConfigPanel } from '../components/charts/ChartConfigPanel';
import { useAuth } from '../contexts/AuthContext';
import { ChartService } from '../services/chartService';
import { DataSourceService } from '../services/dataSourceService';

const { Option } = Select;

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
      y_axis_title: "Y轴"
    },
    database_id: 1
  });
  
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [totalRecords, setTotalRecords] = useState<number>(0);

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
    loadTables(value);
  };

  const handleTableChange = (value: string) => {
    setSelectedTable(value);
    loadPreviewData(value);
  };

  const loadPreviewData = async (tableName: string) => {
    setLoading(true);
    try {
      // 执行查询获取前10行数据作为预览
      const result = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT * FROM ${tableName} LIMIT 10`
      });
      
      // 转换数据格式
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      setQueryResult(formattedData);
      
      // 获取总记录数（需要执行另一个查询）
      const countResult = await DataSourceService.executeQuery({
        data_source_id: selectedDataSource,
        query: `SELECT COUNT(*) as total FROM ${tableName}`
      });
      
      setTotalRecords(countResult.rows[0].total);
      
    } catch (error: any) {
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
      
      const formattedData = result.rows.map((row: any) => {
        const obj: any = {};
        result.columns.forEach((col: string, index: number) => {
          obj[col] = Object.values(row)[index];
        });
        return obj;
      });
      
      setQueryResult(formattedData);
      setTotalRecords(result.row_count);
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
          <Row gutter={24}>
            {/* 左侧数据配置面板 */}
            <Col span={8}>
              <Card title="数据配置">
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
                    <p><strong>数据预览:</strong> {totalRecords} 条记录</p>
                    <p><small>当前显示前10条记录</small></p>
                  </div>
                </Space>
              </Card>
            </Col>

            {/* 中间图表预览区域 */}
            <Col span={10}>
              <Card title="图表预览">
                <ChartFactory
                  config={{
                    type: chartData.chart_type,
                    title: chartData.name,
                    xAxis: {
                      name: chartData.visualization_settings.x_axis_title
                    },
                    yAxis: {
                      name: chartData.visualization_settings.y_axis_title
                    },
                    series: [{
                      type: chartData.chart_type,
                      field: chartData.visualization_settings.graph_metrics?.[0] || 'value'
                    }]
                  }}
                  data={queryResult}
                  style={{ height: '500px' }}
                />
              </Card>
            </Col>
            
            {/* 右侧信息面板 */}
            <Col span={6}>
              <Card title="数据信息">
                <p><strong>图表类型:</strong> {chartData.chart_type}</p>
                <p><strong>维度:</strong> {chartData.visualization_settings.graph_dimensions?.join(', ') || '未设置'}</p>
                <p><strong>度量:</strong> {chartData.visualization_settings.graph_metrics?.join(', ') || '未设置'}</p>
                <p><strong>数据点:</strong> {queryResult.length} 个</p>
                <p><strong>数据源:</strong> {dataSources.find(ds => ds.type === selectedDataSource)?.name || '未选择'}</p>
                <p><strong>数据表:</strong> {selectedTable || '未选择'}</p>
                <p><strong>总记录数:</strong> {totalRecords} 条</p>
              </Card>
            </Col>
          </Row>
        </Spin>
      </Card>

      {showConfig && (
        <ChartConfigPanel
          initialSettings={chartData.visualization_settings}
          onSave={handleConfigChange}
          onCancel={() => setShowConfig(false)}
        />
      )}
    </div>
  );
};