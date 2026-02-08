// src/services/chartService.ts
export interface ChartConfig {
  type: ChartType;
  title: string;
  xAxis?: AxisConfig;
  yAxis?: AxisConfig;
  series: SeriesConfig[];
  dataBinding: DataBindingConfig;
  styling: StylingConfig;
}

export interface AxisConfig {
  field: string;
  title?: string;
  type?: 'category' | 'value' | 'time';
}

export interface SeriesConfig {
  name: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area';
  dataField: string;
  color?: string;
}

export interface DataBindingConfig {
  dataSource: string;  // 数据源ID
  query?: string;      // 自定义查询
  filters?: FilterConfig[];
}

export interface FilterConfig {
  field: string;
  operator: string;
  value: any;
}

export interface StylingConfig {
  colors: string[];
  theme: 'light' | 'dark';
  showLegend: boolean;
  showTooltip: boolean;
}

export enum ChartType {
  BAR = 'bar',
  LINE = 'line',
  PIE = 'pie',
  SCATTER = 'scatter',
  AREA = 'area',
  COMBO = 'combo'
}

export const CHART_TYPES = [
  { 
    id: ChartType.BAR, 
    name: '柱状图', 
    icon: '📊',
    description: '比较不同类别的数值大小'
  },
  { 
    id: ChartType.LINE, 
    name: '折线图', 
    icon: '📈',
    description: '显示数据随时间的变化趋势'
  },
  { 
    id: ChartType.PIE, 
    name: '饼图', 
    icon: '🥧',
    description: '展示各部分占整体的比例'
  },
  { 
    id: ChartType.SCATTER, 
    name: '散点图', 
    icon: '⚪',
    description: '分析两个变量之间的相关性'
  },
  { 
    id: ChartType.AREA, 
    name: '面积图', 
    icon: '⛰️',
    description: '强调数量随时间变化的程度'
  }
];

export class ChartService {
  static async getChartData(chartConfig: ChartConfig): Promise<any> {
    // 调用后端API获取图表数据
    const response = await fetch('/api/v1/charts/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chartConfig)
    });
    return response.json();
  }

  static async saveChartConfig(chartConfig: ChartConfig): Promise<string> {
    // 保存图表配置
    const response = await fetch('/api/v1/charts/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chartConfig)
    });
    const result = await response.json();
    return result.chartId;
  }
}