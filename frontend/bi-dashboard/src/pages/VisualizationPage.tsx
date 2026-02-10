import React, { useState, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChartRenderer } from '../components/charts/ChartRenderer';
import { ChartConfigPanel } from '../components/charts/ChartConfigPanel';
import { vizDataSourceService } from '../services/vizDataSourceService'; // Added missing import
import './VisualizationPage.css';
interface VisualizationCard {
  id: number;
  name: string;
  description?: string;
  chartType: string;
  config: any;
  dataSourceId: number;
  querySql: string;
  cacheEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FieldDefinition {
  id: string;
  name: string;
  type: 'dimension' | 'measure';
}

export const VisualizationPage: React.FC = () => {
  const [cards, setCards] = useState<VisualizationCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<VisualizationCard | null>(null);
  const [cardData, setCardData] = useState<any>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // 加载卡片列表
  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    try {
      // 这里可以从后端API加载保存的卡片
      // 暂时使用模拟数据
      const mockCards: VisualizationCard[] = [
        {
          id: 1,
          name: '销售趋势图',
          description: '月度销售数据趋势',
          chartType: 'line',
          config: {
            type: 'line',
            title: '销售趋势',
            xAxis: { field: 'month', title: '月份' },
            yAxis: { field: 'sales', title: '销售额' },
            series: [{ name: '销售额', color: '#3b82f6' }],
            dataBinding: {
              dataSource: 'mysql_db',
              query: 'SELECT month, sales FROM sales_data ORDER BY month'
            },
            styling: {
              colors: ['#3b82f6'],
              theme: 'light',
              showLegend: true,
              showTooltip: true
            }
          },
          dataSourceId: 1,
          querySql: 'SELECT month, sales FROM sales_data ORDER BY month',
          cacheEnabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      
      setCards(mockCards);
      
      // 如果有卡片，默认选择第一个
      if (mockCards.length > 0 && !selectedCard) {
        handleCardSelect(mockCards[0]);
      }
    } catch (error) {
      console.error('加载图表失败:', error);
    }
  };

  const handleCardSelect = async (card: VisualizationCard) => {
    try {
      setSelectedCard(card);
      setLoading(true);
      setError('');
      
      // 使用真实数据查询而不是模拟数据
      const realData = await fetchRealChartData(card);
      setCardData(realData);
    } catch (error) {
      console.error('加载图表数据失败:', error);
      setError(error instanceof Error ? error.message : '数据加载失败');
      // 失败时使用模拟数据作为后备
      const mockData = generateMockData(card.chartType);
      setCardData(mockData);
    } finally {
      setLoading(false);
    }
  };

  // 新增：获取真实图表数据的函数
  const fetchRealChartData = async (card: VisualizationCard): Promise<any> => {
    try {
      // 从卡片配置中获取数据源和查询信息
      const { dataBinding } = card.config;
      
      if (!dataBinding?.dataSource || !dataBinding?.query) {
        throw new Error('缺少数据源或查询配置');
      }

      // 执行真实查询
      const queryResult = await vizDataSourceService.executeQuery({
        sql: dataBinding.query,
        datasource_type: 'mysql' // 或者从配置中获取
      });

      if (!queryResult.success) {
        throw new Error(queryResult.error || '查询失败');
      }

      // 转换查询结果为图表数据格式
      return transformQueryResultToChartData(queryResult, card);
    } catch (error) {
      console.error('获取真实数据失败:', error);
      throw error;
    }
  };

  // 新增：将查询结果转换为图表数据格式
  const transformQueryResultToChartData = (queryResult: any, card: VisualizationCard): any => {
    const { data, columns } = queryResult;
    
    if (!data || data.length === 0) {
      return { labels: [], datasets: [[]] };
    }

    // 根据图表类型进行不同的数据转换
    switch (card.chartType) {
      case 'line':
      case 'bar':
        // 对于线图和柱状图，通常需要一个分类轴和一个数值轴
        const xAxisField = card.config.xAxis?.field || columns[0];
        const yAxisField = card.config.yAxis?.field || columns[1] || columns[0];
        
        const labels = data.map((row: any) => row[xAxisField]);
        const values = data.map((row: any) => parseFloat(row[yAxisField]) || 0);
        
        return {
          labels,
          datasets: [values]
        };

      case 'pie':
      case 'doughnut':
        // 对于饼图，需要标签和对应的数值
        const labelField = card.config.xAxis?.field || columns[0];
        const valueField = card.config.yAxis?.field || columns[1] || columns[0];
        
        const pieLabels = data.map((row: any) => row[labelField]);
        const pieValues = data.map((row: any) => parseFloat(row[valueField]) || 0);
        
        return {
          labels: pieLabels,
          datasets: [pieValues]
        };

      case 'scatter':
        // 散点图需要x,y坐标对
        const xField = card.config.xAxis?.field || columns[0];
        const yField = card.config.yAxis?.field || columns[1] || columns[0];
        
        const points = data.map((row: any) => [
          parseFloat(row[xField]) || 0,
          parseFloat(row[yField]) || 0
        ]);
        
        return {
          points
        };

      default:
        // 默认处理：使用第一列作为标签，第二列作为数据
        const defaultLabels = data.map((row: any) => row[columns[0]]);
        const defaultValues = data.map((row: any) => 
          parseFloat(row[columns[1] || columns[0]]) || 0
        );
        
        return {
          labels: defaultLabels,
          datasets: [defaultValues]
        };
    }
  };

  const handleSaveNewCard = async (config: any) => {
    try {
      // 确保series数组存在
      const chartConfig = {
        ...config,
        series: config.series && config.series.length > 0 
          ? config.series 
          : [{ name: config.title || '数据', color: '#3b82f6' }]
      };

      // 创建新的图表卡片
      const newCard: VisualizationCard = {
        id: Date.now(), // 使用时间戳作为临时ID
        name: config.title || '新图表',
        description: config.description || '',
        chartType: config.type || config.chartType,
        config: chartConfig,
        dataSourceId: config.dataSourceId || 1,
        querySql: config.querySql || config.dataBinding?.query || '',
        cacheEnabled: config.cacheEnabled || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 更新状态
      setCards(prev => [...prev, newCard]);
      setSelectedCard(newCard);
      
      // 使用真实数据而不是模拟数据
      try {
        setLoading(true);
        const realData = await fetchRealChartData(newCard);
        setCardData(realData);
      } catch (error) {
        console.error('获取新图表数据失败:', error);
        // 失败时使用模拟数据作为后备
        const mockData = generateMockData(config.type || config.chartType);
        setCardData(mockData);
      } finally {
        setLoading(false);
      }
      
      // 关闭构建器
      setShowBuilder(false);
      
      console.log('图表保存成功:', newCard);
    } catch (error) {
      console.error('保存图表失败:', error);
    }
  };

  // 保留原有的模拟数据生成函数作为后备
  const generateMockData = (chartType: string) => {
    console.warn('使用模拟数据作为后备');
    switch (chartType) {
      case 'line':
        return {
          labels: ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'],
          datasets: [[1200, 1500, 1800, 1600, 2200, 2100]]
        };
      case 'bar':
        return {
          labels: ['产品A', '产品B', '产品C', '产品D'],
          datasets: [[300, 450, 200, 600]]
        };
      case 'pie':
      case 'doughnut':
        return {
          labels: ['华东', '华南', '华北', '西部'],
          datasets: [[35, 25, 20, 20]]
        };
      default:
        return {
          labels: [],
          datasets: [[]]
        };
    }
  };

  // Handle drag end event for reordering cards
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setCards((items) => {
        const oldIndex = items.findIndex(item => item.id.toString() === active.id);
        const newIndex = items.findIndex(item => item.id.toString() === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <DndContext 
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <div className="visualization-page">
        <div className="page-header">
          <h2>数据可视化</h2>
          <button 
            className="btn-primary"
            onClick={() => setShowBuilder(true)}
          >
            新建图表
          </button>
        </div>

        <div className="page-content">
          {/* Cards sidebar with drag-and-drop */}
          <div className="cards-sidebar">
            <h3>我的图表</h3>
            <SortableContext 
              items={cards.map(card => card.id.toString())}
              strategy={verticalListSortingStrategy}
            >
              {cards.map(card => (
                <SortableCardItem
                  key={card.id}
                  card={card}
                  isSelected={selectedCard?.id === card.id}
                  onSelect={handleCardSelect}
                />
              ))}
            </SortableContext>
          </div>

          {/* Main content area */}
          <div className="main-content">
            {loading && (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>正在加载数据...</p>
              </div>
            )}
            
            {error && (
              <div className="error-state">
                <p>错误: {error}</p>
                <button onClick={() => selectedCard && handleCardSelect(selectedCard)}>
                  重试
                </button>
              </div>
            )}
            
            {!loading && !error && selectedCard && cardData && (
              <div className="card-display">
                <ChartRenderer 
                  config={selectedCard.config}
                  data={cardData}
                  width={800}
                  height={500}
                />
              </div>
            )}
            
            {!loading && !error && (!selectedCard || !cardData) && (
              <div className="empty-state">
                <h3>选择一个图表开始</h3>
                <p>或者点击"新建图表"创建您的第一个可视化</p>
              </div>
            )}
          </div>
        </div>

        {/* Configuration panel modal */}
        {showBuilder && (
          <div className="modal-overlay">
            <div className="modal-content">
              <ChartConfigPanel 
                onSave={handleSaveNewCard}
                onCancel={() => setShowBuilder(false)}
              />
              <button 
                className="modal-close"
                onClick={() => setShowBuilder(false)}
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
};

// Separate component for sortable card items
const SortableCardItem: React.FC<{
  card: VisualizationCard;
  isSelected: boolean;
  onSelect: (card: VisualizationCard) => void;
}> = ({ card, isSelected, onSelect }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: card.id.toString(),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`card-item ${isSelected ? 'active' : ''}`}
      onClick={() => onSelect(card)}
    >
      <h4>{card.name}</h4>
      <p>{card.description}</p>
      <small>{card.chartType}</small>
    </div>
  );
};