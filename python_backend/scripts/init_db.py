"""初始化数据库脚本"""
from app.db.database import engine, Base
from app.models.user import User
from app.models.project import Project

def init_db():
    """创建所有表"""
    print("正在创建数据库表...")
    Base.metadata.create_all(bind=engine)
    print("数据库表创建完成！")

if __name__ == "__main__":
    init_db()
