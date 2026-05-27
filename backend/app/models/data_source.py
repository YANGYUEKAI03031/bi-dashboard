# app/models/data_source.py
from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.db.base import Base


class ProcessedDataset(Base):
    __tablename__ = "processed_datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    data_source_id = Column(Integer, nullable=False)
    processing_steps = Column(JSON, nullable=True)
    result_schema = Column(JSON, nullable=True)
    row_count = Column(Integer, default=0)
    storage_path = Column(String(500), nullable=True)
    is_cached = Column(Boolean, default=False)
    cache_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<ProcessedDataset(id={self.id}, name='{self.name}', rows={self.row_count})>"
