from fastapi import APIRouter

from app.api.v1 import auth, data_processing, data_chain, node_analytics, database_explorer
from app.api.v1.enhanced_data_processing import router as enhanced_processing_router

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(data_processing.router)
api_router.include_router(data_chain.router, prefix="/data-chain", tags=["data-chain"])
api_router.include_router(node_analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(database_explorer.router)
api_router.include_router(enhanced_processing_router)