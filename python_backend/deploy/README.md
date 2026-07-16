# SEEKBCI 云端部署（预留）

本目录为**后续云端备份 / 广场 / 点赞**部署占位，当前迭代仍使用本机 `data/plaza.json`。

## 规划组件

- **API**：与现网 `app.main` 同构，增加 PostgreSQL
- **对象存储**：项目 JSON、缩略图（MinIO / S3）
- **Redis**：验证码、会话、限流
- **SMTP**：邮箱验证

## 环境变量（见 `.env.example`）

- `DATABASE_URL`
- `SMTP_*`
- `SEEKBCi_ADMIN_KEY` — 管理员下架
- `CLOUD_PROJECT_LIMIT_FREE` / `CLOUD_PROJECT_LIMIT_MEMBER`

## 本地开发

当前无需启动本目录服务。广场 API 见 `/api/plaza/*`。

## Docker（待实现）

```bash
# 未来示例
docker compose -f deploy/docker-compose.yml up -d
```
