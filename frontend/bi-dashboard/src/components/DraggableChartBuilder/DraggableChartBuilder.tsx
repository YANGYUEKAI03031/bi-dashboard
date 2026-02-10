// 新建文件：src/components/DraggableChartBuilder/DraggableChartBuilder.tsx
import React, { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './DraggableChartBuilder.css';

interface FieldItem {
  id: string;
  name: string;
  type: 'dimension' | 'measure';
}

interface SortableFieldProps {
  field: FieldItem;
  onRemove?: () => void;
}

// 可排序的字段组件
const SortableField: React.FC<SortableFieldProps> = ({ field, onRemove }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`selected-field ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      {field.name}
      {onRemove && (
        <button className="remove-btn" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
};

interface DraggableChartBuilderProps {
  fields: FieldItem[];
  onSave: (config: any) => void;
}

export const DraggableChartBuilder: React.FC<DraggableChartBuilderProps> = ({ 
  fields, 
  onSave 
}) => {
  const [chartConfig, setChartConfig] = useState({
    xAxis: null as FieldItem | null,
    yAxis: [] as FieldItem[],
    groupBy: null as FieldItem | null,
    chartType: 'bar' as 'bar' | 'line' | 'area' | 'pie'
  });

  const [activeField, setActiveField] = useState<FieldItem | null>(null);

  // 设置传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // 拖拽开始
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const field = fields.find(f => f.id === active.id) || 
                  chartConfig.yAxis.find(f => f.id === active.id);
    if (field) {
      setActiveField(field);
    }
  }, [fields, chartConfig.yAxis]);

  // 拖拽结束
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveField(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // 从字段面板拖拽到配置区域
    if (overId.startsWith('drop-zone-')) {
      const field = fields.find(f => f.id === activeId);
      if (!field) return;

      const zone = overId.split('-')[2] as 'xAxis' | 'yAxis' | 'groupBy';
      
      setChartConfig(prev => {
        const newConfig = { ...prev };
        
        switch (zone) {
          case 'xAxis':
            newConfig.xAxis = field;
            break;
          case 'yAxis':
            if (!newConfig.yAxis.some(f => f.id === field.id)) {
              newConfig.yAxis = [...newConfig.yAxis, field];
            }
            break;
          case 'groupBy':
            newConfig.groupBy = field;
            break;
        }
        
        return newConfig;
      });
    }
    // 在Y轴内部重新排序
    else if (overId.startsWith('y-axis-item-') && activeId.startsWith('y-axis-item-')) {
      const activeIndex = chartConfig.yAxis.findIndex(f => f.id === activeId.replace('y-axis-item-', ''));
      const overIndex = chartConfig.yAxis.findIndex(f => f.id === overId.replace('y-axis-item-', ''));
      
      if (activeIndex !== -1 && overIndex !== -1) {
        setChartConfig(prev => ({
          ...prev,
          yAxis: arrayMove(prev.yAxis, activeIndex, overIndex)
        }));
      }
    }

  }, [fields, chartConfig.yAxis]);

  // 移除字段
  const removeField = useCallback((zone: 'xAxis' | 'yAxis' | 'groupBy', index?: number) => {
    setChartConfig(prev => {
      const newConfig = { ...prev };
      
      switch (zone) {
        case 'xAxis':
          newConfig.xAxis = null;
          break;
        case 'yAxis':
          if (index !== undefined) {
            newConfig.yAxis = newConfig.yAxis.filter((_, i) => i !== index);
          }
          break;
        case 'groupBy':
          newConfig.groupBy = null;
          break;
      }
      
      return newConfig;
    });
  }, []);

  // 生成SQL
  const generateSQL = useCallback(() => {
    if (!chartConfig.xAxis || chartConfig.yAxis.length === 0) return '';
    
    const selectFields = [
      chartConfig.xAxis.name,
      ...chartConfig.yAxis.map(field => `SUM(${field.name}) as ${field.name}`)
    ];
    
    let groupBy = chartConfig.xAxis.name;
    if (chartConfig.groupBy) {
      selectFields.push(chartConfig.groupBy.name);
      groupBy += `, ${chartConfig.groupBy.name}`;
    }
    
    return `SELECT ${selectFields.join(', ')} 
            FROM your_table 
            GROUP BY ${groupBy}
            ORDER BY ${chartConfig.xAxis.name}`;
  }, [chartConfig]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="draggable-chart-builder">
        <div className="builder-header">
          <h3>拖拽字段生成图表</h3>
          <div className="chart-type-selector">
            <select 
              value={chartConfig.chartType}
              onChange={(e) => setChartConfig(prev => ({ ...prev, chartType: e.target.value as any }))}
            >
              <option value="bar">柱状图</option>
              <option value="line">折线图</option>
              <option value="area">面积图</option>
              <option value="pie">饼图</option>
            </select>
          </div>
        </div>

        <div className="builder-content">
          {/* 字段列表区域 */}
          <div className="fields-panel">
            <h4>可用字段</h4>
            {fields.map(field => (
              <div 
                key={field.id}
                className={`field-item ${field.type}`}
                draggable
              >
                {field.name}
                <span className="field-type">{field.type}</span>
              </div>
            ))}
          </div>

          {/* 配置区域 */}
          <div className="config-panel">
            <div className="axis-config">
              {/* X轴配置 */}
              <div className="axis x-axis">
                <h5>X轴</h5>
                <div 
                  className={`drop-zone ${!chartConfig.xAxis ? 'empty' : ''}`}
                  id="drop-zone-xAxis"
                >
                  {chartConfig.xAxis ? (
                    <SortableField 
                      field={chartConfig.xAxis} 
                      onRemove={() => removeField('xAxis')}
                    />
                  ) : (
                    <div className="drop-placeholder">拖拽维度字段到这里</div>
                  )}
                </div>
              </div>
              
              {/* Y轴配置 */}
              <div className="axis y-axis">
                <h5>Y轴（数值）</h5>
                <div 
                  className="drop-zone multi-drop"
                  id="drop-zone-yAxis"
                >
                  <SortableContext 
                    items={chartConfig.yAxis.map(f => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {chartConfig.yAxis.map((field, index) => (
                      <SortableField 
                        key={field.id}
                        field={field}
                        onRemove={() => removeField('yAxis', index)}
                      />
                    ))}
                  </SortableContext>
                  {chartConfig.yAxis.length === 0 && (
                    <div className="drop-placeholder">拖拽度量字段到这里</div>
                  )}
                </div>
              </div>
              
              {/* 分组配置 */}
              <div className="axis group-axis">
                <h5>分组</h5>
                <div 
                  className={`drop-zone ${!chartConfig.groupBy ? 'empty' : ''}`}
                  id="drop-zone-groupBy"
                >
                  {chartConfig.groupBy ? (
                    <SortableField 
                      field={chartConfig.groupBy} 
                      onRemove={() => removeField('groupBy')}
                    />
                  ) : (
                    <div className="drop-placeholder">拖拽维度字段到这里进行分组</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="builder-footer">
          <div className="generated-sql">
            <h5>生成的SQL:</h5>
            <pre>{generateSQL()}</pre>
          </div>
          <div className="actions">
            <button 
              className="btn-primary"
              onClick={() => onSave({
                ...chartConfig,
                generatedSQL: generateSQL()
              })}
              disabled={!chartConfig.xAxis || chartConfig.yAxis.length === 0}
            >
              保存图表
            </button>
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeField ? (
          <div className="selected-field dragging-overlay">
            {activeField.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};