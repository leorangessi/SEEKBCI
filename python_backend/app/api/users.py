from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.schemas.user import UserResponse, UserUpdate
from app.models.user import User
from typing import List

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_current_user(db: Session = Depends(get_db)):
    """获取当前用户信息"""
    # TODO: 实现JWT认证依赖
    # 这里暂时返回示例，后续需要添加认证中间件
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="需要实现JWT认证"
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, db: Session = Depends(get_db)):
    """获取用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    return user


@router.put("/me", response_model=UserResponse)
async def update_user(user_data: UserUpdate, db: Session = Depends(get_db)):
    """更新当前用户信息"""
    # TODO: 实现JWT认证依赖
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="需要实现JWT认证"
    )


@router.get("/", response_model=List[UserResponse])
async def list_users(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    """获取用户列表"""
    users = db.query(User).offset(skip).limit(limit).all()
    return users
