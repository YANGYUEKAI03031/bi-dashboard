// src/components/charts/ChartConfigPanel.tsx
import React, { useState, useEffect } from 'react';
import './ChartConfigPanel.css';

// 内联定义接口
interface ChartConfig {
  type: string;
  title: string;
  xAxis?: { field: string; title: string };
  yAxis?: { field: string; title: string };
  series: any[];
  dataBinding: {
    dataSource: string;
    query: string;
    filters?: any[];
    calculatedColumns?: any[];
    sortBy?: { field: string; direction: 'asc' | 'desc' };
  };
  styling: {
    colors: string[];
    theme: 'light' | 'dark';
    showLegend: boolean;
    showTooltip: boolean;
  };
}

interface ChartConfigPanelProps {
  initialConfig?: ChartConfig;
  onSave: (config: ChartConfig) => void;
  onCancel: () => void;
}

// 模拟数据服务
class MockDataService {
  async getDataSources() {
    return [{ id: 'mysql_db', name: 'MySQL数据库' }];
  }
  
  async getTables(sourceId: string) {
    return [{ name: 'sales_data' }, { name: 'user_data' }];
  }
  
  async getTableSchema(sourceId: string, tableName: string) {
    return {
      columns: ['id', 'month', 'sales', 'profit', 'region']
    };
  }
  
  async executeQuery(config: any) {
    return {
      columns: ['month', 'sales', 'profit'],
      rows: [
        ['1月', 1000, 200],
        ['2月', 1200, 240],
        ['3月', 800, 160]
      ],
      rowCount: 3,
      executionTime: 50
    };
  }
}

export const ChartConfigPanel: React.FC<ChartConfigPanelProps> = ({
  initialConfig,
  onSave,
  onCancel
}) => {
  // 先声明默认配置函数
  const getDefaultConfig = (): ChartConfig => ({
    type: 'bar',
    title: '新图表',
    xAxis: { field: '', title: '' },
    yAxis: { field: '', title: '' },
    series: [],
    dataBinding: {
      dataSource: '',
      query: '',
      filters: [],
      calculatedColumns: []
    },
    styling: {
      colors: ['#3b82f6', '#ef4444', '#10b981'],
      theme: 'light',
      showLegend: true,
      showTooltip: true
    }
  });

  const [config, setConfig] = useState<ChartConfig>(initialConfig || getDefaultConfig());
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const dataService = new MockDataService();

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const sources = await dataService.getDataSources();
      setDataSources(sources);
    } catch (error) {
      console.error('加载初始数据失败:', error);
    }
  };

  const handleDataSourceChange = async (sourceId: string) => {
    setConfig(prev => ({
      ...prev,
      dataBinding: {
        ...prev.dataBinding,
        dataSource: sourceId
      }
    }));
  };

  const previewDataHandler = async () => {
    if (!config.dataBinding.dataSource || !config.dataBinding.query) {
      alert('请先选择数据源和表');
      return;
    }

    setIsPreviewLoading(true);
    try {
      const rawData = await dataService.executeQuery(config.dataBinding);
      setPreviewData(rawData);
    } catch (error) {
      console.error('预览数据失败:', error);
      alert('数据预览失败，请检查配置');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  return (
    <div className="chart-config-panel">
      <div className="config-header">
        <h3>图表配置</h3>
        <div className="config-actions">
          <button onClick={onCancel} className="btn-secondary">取消</button>
          <button onClick={() => onSave(config)} className="btn-primary">保存</button>
        </div>
      </div>
      
      <div className="config-content">
        <section className="config-section">
          <h4>基本信息</h4>
          <div className="form-group">
            <label>图表标题</label>
            <input
              type="text"
              value={config.title}
              onChange={(e) => setConfig(prev => ({ ...prev, title: e.target.value }))}
              placeholder="输入图表标题"
            />
          </div>
          
          <div className="form-group">
            <label>图表类型</label>
            <select
              value={config.type}
              onChange={(e) => setConfig(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="bar">柱状图</option>
              <option value="line">折线图</option>
              <option value="area">面积图</option>
              <option value="pie">饼图</option>
              <option value="doughnut">环形图</option>
              <option value="scatter">散点图</option>
            </select>
          </div>
        </section>

        <section className="config-section">
          <h4>数据源</h4>
          <div className="form-row">
            <div className="form-group">
              <label>数据源</label>
              <select
                value={config.dataBinding.dataSource}
                onChange={(e) => handleDataSourceChange(e.target.value)}
              >
                <option value="">请选择数据源</option>
                {dataSources.map(source => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form-group">
            <label>SQL查询</label>
            <textarea
              value={config.dataBinding.query}
              onChange={(e) => setConfig(prev => ({
                ...prev,
                dataBinding: { ...prev.dataBinding, query: e.target.value }
              }))}
              rows={3}
              placeholder="SELECT * FROM table_name"
            />
          </div>
          
          <button 
            onClick={previewDataHandler} 
            disabled={isPreviewLoading}
            className="btn-secondary"
          >
            {isPreviewLoading ? '预览中...' : '预览数据'}
          </button>
        </section>
      </div>

      {previewData && (
        <div className="data-preview">
          <h4>数据预览</h4>
          <div className="preview-table">
            <table>
              <thead>
                <tr>
                  {previewData.columns.map((col: string, index: number) => (
                    <th key={index}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.rows.slice(0, 5).map((row: any[], rowIndex: number) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="preview-info">
              显示前5行，共{previewData.rowCount}行数据
            </div>
          </div>
        </div>
      )}
    </div>
  );
};