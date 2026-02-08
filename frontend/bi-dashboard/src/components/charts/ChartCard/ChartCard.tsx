// src/components/charts/ChartCard/ChartCard.tsx
import React, { useState, useEffect } from 'react';
import { EnhancedChartRenderer } from '../EnhancedChartRenderer';
import { ChartConfigPanel } from '../ChartConfigPanel';
import { ChartToolbar } from './ChartToolbar';
import { DataTransformer } from '../../../services/dataTransformer';
import { DataProcessorService } from '../../../services/dataProcessor';
import { DataCache } from '../../../services/dataCache';

// 临时定义接口避免循环依赖
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

interface ChartCardProps {
  config: ChartConfig;
  onConfigChange?: (newConfig: ChartConfig) => void;
  editable?: boolean;
  width?: number;
  height?: number;
}

// 模拟数据服务
class MockDataService {
  async executeQuery(config: any) {
    // 模拟数据查询
    return {
      columns: ['month', 'sales', 'profit'],
      rows: [
        ['1月', 1000, 200],
        ['2月', 1200, 240],
        ['3月', 800, 160],
        ['4月', 1500, 300],
        ['5月', 1100, 220],
        ['6月', 1300, 260]
      ],
      rowCount: 6,
      executionTime: 50
    };
  }
  
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
}

export const ChartCard: React.FC<ChartCardProps> = ({
  config,
  onConfigChange,
  editable = false,
  width = 600,
  height = 400
}) => {
  const [chartData, setChartData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dataService = new MockDataService();
  const cache = new DataCache();

  useEffect(() => {
    if (config.dataBinding.dataSource && config.dataBinding.query) {
      loadData();
    }
  }, [config]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const cacheKey = JSON.stringify({
        ...config.dataBinding,
        processing: {
          filters: config.dataBinding.filters,
          calculatedColumns: config.dataBinding.calculatedColumns,
          sortBy: config.dataBinding.sortBy
        }
      });

      let processedData = cache.get(cacheKey);
      
      if (!processedData) {
        const rawData = await dataService.executeQuery(config.dataBinding);
        
        const processedResult = await DataProcessor.processRawData(rawData, {
          filters: config.dataBinding.filters || [],
          calculatedColumns: config.dataBinding.calculatedColumns || [],
          sortBy: config.dataBinding.sortBy,
          limit: 1000
        });
        
        processedData = DataTransformer.transformForChart(processedResult, config);
        cache.set(cacheKey, processedData, 5 * 60 * 1000);
      }
      
      setChartData(processedData);
    } catch (err) {
      console.error('加载图表数据失败:', err);
      setError(err instanceof Error ? err.message : '数据加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrillDown = (dataPoint: any) => {
    console.log('钻取数据:', dataPoint);
  };

  const handleConfigSave = (newConfig: ChartConfig) => {
    onConfigChange?.(newConfig);
    setShowConfig(false);
    cache.clear();
  };

  if (showConfig && editable) {
    return (
      <div className="chart-card">
        <ChartConfigPanel
          initialConfig={config}
          onSave={handleConfigSave}
          onCancel={() => setShowConfig(false)}
        />
      </div>
    );
  }

  return (
    <div className="chart-card" style={{ width, height }}>
      <ChartToolbar
        config={config}
        onConfigChange={() => setShowConfig(true)}
        onRefresh={loadData}
        editable={editable}
      />
      
      <div className="chart-content">
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>正在加载数据...</p>
          </div>
        )}
        
        {error && (
          <div className="error-overlay">
            <p>{error}</p>
            <button onClick={loadData} className="btn-primary">
              重试
            </button>
          </div>
        )}
        
        {!isLoading && !error && chartData && (
          <EnhancedChartRenderer
            config={config}
            data={chartData}
            width={width - 32}
            height={height - 80}
            onDrillDown={handleDrillDown}
          />
        )}
        
        {!isLoading && !error && !chartData && (
          <div className="empty-state">
            <p>暂无数据</p>
            <button onClick={loadData} className="btn-secondary">
              加载数据
            </button>
          </div>
        )}
      </div>
    </div>
  );
};