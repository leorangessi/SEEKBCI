from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime
import uuid


class ProjectBase(BaseModel):
    """项目基础模式"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    version: str = "1.0.0"
    is_public: bool = False


class ProjectCreate(ProjectBase):
    """项目创建模式"""
    content: Dict[str, Any]  # 项目配置JSON


class ProjectUpdate(BaseModel):
    """项目更新模式"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    version: Optional[str] = None
    content: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None
    thumbnail_url: Optional[str] = None


class ProjectResponse(ProjectBase):
    """项目响应模式"""
    id: uuid.UUID
    user_id: uuid.UUID
    thumbnail_url: Optional[str] = None
    content: Dict[str, Any]
    downloads: int
    likes: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """项目列表响应"""
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    downloads: int
    likes: int
    created_at: datetime
    
    class Config:
        from_attributes = True
