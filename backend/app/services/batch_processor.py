import asyncio
import logging
from typing import Dict, Any, List, Callable, Optional
from dataclasses import dataclass
from enum import Enum
from datetime import datetime
import json
import time

logger = logging.getLogger(__name__)

class TaskPriority(Enum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4

class TaskStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class BatchTask:
    """批处理任务"""
    id: str
    name: str
    priority: TaskPriority
    handler: Callable
    args: tuple
    kwargs: dict
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3

class BatchProcessor:
    """批处理处理器 - 类似Metabase的批处理机制"""
    
    def __init__(self, max_workers: int = 4, batch_size: int = 10):
        self.max_workers = max_workers
        self.batch_size = batch_size
        self.task_queue = asyncio.PriorityQueue()
        self.running_tasks = {}
        self.workers = []
        self.is_running = False
        
    async def start(self):
        """启动批处理器"""
        if self.is_running:
            return
            
        self.is_running = True
        # 启动工作协程
        for i in range(self.max_workers):
            worker = asyncio.create_task(self._worker(f"worker-{i}"))
            self.workers.append(worker)
        
        logger.info(f"Batch processor started with {self.max_workers} workers")
    
    async def stop(self):
        """停止批处理器"""
        self.is_running = False
        
        # 等待所有工作协程完成
        for worker in self.workers:
            if not worker.done():
                worker.cancel()
                try:
                    await worker
                except asyncio.CancelledError:
                    pass
        
        self.workers.clear()
        logger.info("Batch processor stopped")
    
    async def submit_task(
        self, 
        task_id: str,
        name: str,
        handler: Callable,
        *args,
        priority: TaskPriority = TaskPriority.NORMAL,
        max_retries: int = 3,
        **kwargs
    ) -> str:
        """提交任务到批处理器"""
        task = BatchTask(
            id=task_id,
            name=name,
            priority=priority,
            handler=handler,
            args=args,
            kwargs=kwargs,
            max_retries=max_retries,
            created_at=datetime.now()
        )
        
        # 使用负优先级值确保高优先级任务先执行
        await self.task_queue.put((-priority.value, task))
        self.running_tasks[task_id] = task
        
        logger.info(f"Task {task_id} submitted with priority {priority}")
        return task_id
    
    async def _worker(self, worker_id: str):
        """工作协程"""
        logger.info(f"Worker {worker_id} started")
        
        while self.is_running:
            try:
                # 从队列获取任务
                priority, task = await self.task_queue.get()
                
                if not self.is_running:
                    break
                
                await self._execute_task(task)
                self.task_queue.task_done()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Worker {worker_id} encountered error: {e}")
                await asyncio.sleep(1)  # 短暂休眠避免忙等待
        
        logger.info(f"Worker {worker_id} stopped")
    
    async def _execute_task(self, task: BatchTask):
        """执行单个任务"""
        task.status = TaskStatus.PROCESSING
        task.started_at = datetime.now()
        
        logger.info(f"Executing task {task.id}: {task.name}")
        
        try:
            # 执行任务处理器
            result = await task.handler(*task.args, **task.kwargs)
            
            task.status = TaskStatus.COMPLETED
            task.result = result
            task.completed_at = datetime.now()
            
            logger.info(f"Task {task.id} completed successfully")
            
        except Exception as e:
            task.retry_count += 1
            task.error = str(e)
            
            if task.retry_count < task.max_retries:
                logger.warning(f"Task {task.id} failed, retrying ({task.retry_count}/{task.max_retries}): {e}")
                # 重新加入队列进行重试
                await asyncio.sleep(2 ** task.retry_count)  # 指数退避
                await self.task_queue.put((-task.priority.value, task))
            else:
                task.status = TaskStatus.FAILED
                task.completed_at = datetime.now()
                logger.error(f"Task {task.id} failed permanently after {task.max_retries} retries: {e}")
    
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        task = self.running_tasks.get(task_id)
        if not task:
            return None
            
        return {
            'id': task.id,
            'name': task.name,
            'status': task.status.value,
            'priority': task.priority.name,
            'created_at': task.created_at.isoformat() if task.created_at else None,
            'started_at': task.started_at.isoformat() if task.started_at else None,
            'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            'retry_count': task.retry_count,
            'max_retries': task.max_retries,
            'error': task.error
        }
    
    async def wait_for_task(self, task_id: str, timeout: float = 30.0) -> Optional[Any]:
        """等待任务完成"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            task_status = self.get_task_status(task_id)
            if not task_status:
                return None
                
            if task_status['status'] == TaskStatus.COMPLETED:
                task = self.running_tasks.get(task_id)
                return task.result if task else None
            elif task_status['status'] == TaskStatus.FAILED:
                task = self.running_tasks.get(task_id)
                raise Exception(f"Task failed: {task.error if task else 'Unknown error'}")
            
            await asyncio.sleep(0.1)
        
        raise TimeoutError(f"Task {task_id} did not complete within {timeout} seconds")

# 全局批处理器实例
batch_processor = BatchProcessor(max_workers=4, batch_size=10)

# 便捷的装饰器用于批处理函数
def batch_process(priority: TaskPriority = TaskPriority.NORMAL, max_retries: int = 3):
    """装饰器：将函数转换为批处理任务"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            task_id = f"{func.__name__}_{int(time.time() * 1000)}"
            
            # 提交任务到批处理器
            await batch_processor.submit_task(
                task_id=task_id,
                name=func.__name__,
                handler=func,
                priority=priority,
                max_retries=max_retries,
                *args,
                **kwargs
            )
            
            return task_id
        return wrapper
    return decorator