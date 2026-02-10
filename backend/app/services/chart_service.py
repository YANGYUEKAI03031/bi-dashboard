from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
from app.models.visualization import VisualizationCard, DataSource
from app.schemas.chart import ChartCreate, ChartUpdate
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class ChartService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_charts(self, skip: int = 0, limit: int = 100) -> List[VisualizationCard]:
        """获取图表列表"""
        try:
            stmt = select(VisualizationCard).offset(skip).limit(limit)
            result = self.db.execute(stmt)
            charts = result.scalars().all()
            
            # 为每个图表添加数据源名称
            for chart in charts:
                if chart.data_source:
                    chart.data_source_name = chart.data_source.name
                    
            return charts
        except Exception as e:
            logger.error(f"获取图表列表失败: {str(e)}")
            raise
    
    def get_chart(self, chart_id: int) -> Optional[VisualizationCard]:
        """根据ID获取图表"""
        try:
            stmt = select(VisualizationCard).where(VisualizationCard.id == chart_id)
            result = self.db.execute(stmt)
            chart = result.scalar_one_or_none()
            
            # 添加数据源名称
            if chart and chart.data_source:
                chart.data_source_name = chart.data_source.name
                
            return chart
        except Exception as e:
            logger.error(f"获取图表失败: {str(e)}")
            raise
    
    def create_chart(self, chart: ChartCreate, user_id: int = 1) -> VisualizationCard:
        """创建新图表"""
        try:
            db_chart = VisualizationCard(
                name=chart.name,
                description=chart.description,
                chart_type=chart.chart_type,
                config=json.loads(chart.config.json()),
                data_source_id=chart.data_source_id,
                query_sql=chart.query_sql,
                created_by=user_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            self.db.add(db_chart)
            self.db.commit()
            self.db.refresh(db_chart)
            
            # 添加数据源名称
            if db_chart.data_source:
                db_chart.data_source_name = db_chart.data_source.name
                
            return db_chart
        except Exception as e:
            self.db.rollback()
            logger.error(f"创建图表失败: {str(e)}")
            raise
    
    def update_chart(self, chart_id: int, chart_update: ChartUpdate) -> Optional[VisualizationCard]:
        """更新图表"""
        try:
            db_chart = self.get_chart(chart_id)
            if not db_chart:
                return None
            
            update_data = chart_update.dict(exclude_unset=True)
            if 'config' in update_data and update_data['config']:
                update_data['config'] = json.loads(update_data['config'].json())
            
            for field, value in update_data.items():
                setattr(db_chart, field, value)
            
            db_chart.updated_at = datetime.utcnow()
            
            self.db.commit()
            self.db.refresh(db_chart)
            
            # 添加数据源名称
            if db_chart.data_source:
                db_chart.data_source_name = db_chart.data_source.name
                
            return db_chart
        except Exception as e:
            self.db.rollback()
            logger.error(f"更新图表失败: {str(e)}")
            raise
    
    def delete_chart(self, chart_id: int) -> bool:
        """删除图表"""
        try:
            db_chart = self.get_chart(chart_id)
            if not db_chart:
                return False
            
            self.db.delete(db_chart)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            logger.error(f"删除图表失败: {str(e)}")
            raise