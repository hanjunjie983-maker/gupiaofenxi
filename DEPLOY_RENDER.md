# 免费公网部署（Render）

当前项目已经包含 Dockerfile，可直接用 Render 免费 Web Service 部署。

## 方案选择

- **临时免费公网 URL**：localhost.run 隧道（当前已使用）
  - 优点：无需账号，立刻可用
  - 缺点：本机关机/断网就失效
- **长期免费公网 URL**：Render Free Web Service
  - 优点：HTTPS、自动部署、长期地址
  - 缺点：闲置会休眠，首次访问约 30–60 秒唤醒；内存数据重启会清空

## Render 部署步骤

1. 把 `fanli-quant` 目录推送到 GitHub 仓库。
2. 打开 https://render.com/ 并注册/登录。
3. 选择 **New → Blueprint**。
4. 连接刚创建的 GitHub 仓库。
5. Render 会自动读取 `render.yaml`，创建免费 Web Service。
6. 部署完成后得到：

```text
https://fanli-quant.onrender.com
```

或 Render 分配的实际域名。

## 注意事项

- Render Free 实例会休眠，首次打开可能较慢。
- 当前存储为内存；Render 重启后数据会重置。要持久化需接 PostgreSQL/Redis。
- `EDGAR_USER_AGENT` 建议改为你的真实联系方式。
- 真实数据源接口可能对机房 IP 有访问限制，若失败可切换 `SOURCE_MODE=public_only`。
