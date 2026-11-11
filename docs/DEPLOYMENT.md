# HTTPS / OAuth 部署说明（尚未执行）

本次只交付模板，**没有购买主机、开通收费服务或把服务暴露到公网**。
先人工审核 PR，再由用户确认目标主机、域名、IdP 和费用后执行本节。

建议单主机 Node.js 24 + 本地持久 SQLite + Caddy TLS 终止。外部 URL 为 `https://mcp.example.com/mcp`，
后端只监听 `127.0.0.1:3000`。本服务使用标准 Streamable HTTP JSON 响应，无需保留长期 SSE 链接。
也提供 Dockerfile 和 Compose 模板；镜像构建/容器/TLS 实际部署均尚未验收。

## 认证接入

使用已有、支持 MCP OAuth 2.1 的身份提供方，不在本服务自制登录或授权码服务器。
[OpenAI 官方认证说明](https://developers.openai.com/plugins/build/auth)要求资源发现、授权码 + PKCE S256、
正确的 resource/audience 及客户端注册机制；ChatGPT 不支持为此手填自定义 API Key 请求头。

在所选 IdP 中完成这些配置：

1. 注册 API 资源 **精确** `https://mcp.example.com/mcp`，定义 `deepseek:invoke` scope。
2. 确认 OIDC/OAuth discovery、HTTPS JWKS、授权码及 PKCE S256 可用，支持刷新令牌的配置按 IdP 指引。
3. 使用预注册 OAuth client，或 IdP 支持的 CIMD/DCR；在 ChatGPT 管理页读取实际 redirect URI 并精确加入白名单。
   不预设某条历史 callback 地址必然适用于当前连接。
4. 授权和换 Token 必须处理 `resource`；签发的 JWT 含精确 `aud`、`iss`、未来的 `exp`、owner `sub` 与 scope。
   JWT 使用 RS256/ES256/EdDSA；opaque Token/introspection 尚未实现，不能直接填入使用这种 Token 的 IdP。
5. 记录 owner 的准确 subject，配置允许列表。即使另一个用户取得同一 IdP 签发的令牌，服务仍拒绝其调用。

服务公开 `/.well-known/oauth-protected-resource/mcp`（同时兼容根资源路径），未经认证访问 `/mcp` 返回带资源发现 URL 的 401。
`authorization_servers` 指向 IdP，IdP 自己托管 authorization-server 元数据、授权/Token/注册端点。
OAuth 客户端的 ID/secret 属于 IdP 配置，**不是 DeepSeek API Key**，不要混用。
目前验收了本地签名令牌/JWKS 和发现流程，未验收任何真实 IdP 与 ChatGPT 的完整登录/刷新过程。

## 原生 Node 部署

在获准的服务器上检出审核后的提交，运行 `npm ci` 和 `npm run build`，以非 root 专用用户运行。
使用密钥管理器或权限为 `0600` 的环境文件。先配置以下状态，保留两个开关关闭：

```dotenv
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://mcp.example.com/mcp
AUTH_MODE=oauth
OAUTH_ISSUER=https://identity.example.com/
OAUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
OAUTH_ALLOWED_SUBJECTS=replace-with-owner-subject
ALLOWED_HOSTS=127.0.0.1:3000
ALLOWED_ORIGINS=https://chatgpt.com
DEEPSEEK_MODE=mock
ROUTING_ENABLED=false
ALLOW_PAID_REQUESTS=false
LEDGER_PATH=data/budget.sqlite
```

`example.com`、subject 和 IdP URL 必须换成已确认的真实配置。issuer 尾斜杠也必须与 Token 完全一致。
通过 `npm start` 启动，或配置宿主的进程管理器，工作目录设为仓库根目录。
保留 SIGTERM 至少 `REQUEST_TIMEOUT_MS + 1 秒` 的退出宽限。
需要完整远程 Mock 演练时，在同一主机单独运行 `npm run mock`；只在明确许可后启用 Mock 路由。
仅使用 health_check/dry-run 不需要 Mock 上游进程。

将 `deploy/Caddyfile.example` 中域名替换后用于已有 Caddy；证书由标准 ACME 流程管理。
DNS、证书、端口放行和 IdP 配置都属于后续正式部署步骤，本次未操作。
只对外开放反向代理 443（证书签发若使用 HTTP challenge 还需要 80），后端 3000 不直接暴露。
Caddy 保留公共 Host，使应用精确校验；不要启用记录 Authorization 或请求/响应正文的调试日志。
反向代理上游超时必须长于应用期限；本模板为 130 秒。可在代理增加每源连接/速率限制，避免未认证请求消耗 IdP/JWKS 资源。

## Docker 模板

在获准部署后复制 `deploy/compose.yaml.example` 到仓库根目录的 `compose.yaml`，配置上述 OAuth `.env` 后：

```bash
docker compose build
docker compose up -d
```

Compose 在容器内绑定 `0.0.0.0`，宿主仅映射 `127.0.0.1:3000`，因此强制 OAuth。
容器通过环境注入凭据，构建上下文由 `.dockerignore` 排除 `.env`、`.git`、账本与日志。
命名卷 `/app/data` 保存账本，**不可使用删除卷来清零预算**。正式构建前把基础镜像 tag 换成审核过的 digest。
此模板没有 Mock 上游容器；初次只验证关闭路由、健康检查及 dry-run。需要完整 Mock 往返优先采用上面的原生 Node 流程。

## 启用真实请求的条件

后续需用户单独同意付费测试及限额，再设置 `DEEPSEEK_MODE=live`、有效 Key、
`ROUTING_ENABLED=true` 和 `ALLOW_PAID_REQUESTS=true`，核对价格表日期及预算，重启并回读 health_check。
正式测试完成后恢复两开关关闭并回读。不要修改现有 Mac/iPhone/DSH/Fish Pocket 的模型配置。
`health_check` 不验证 Key/余额；一次本地 MCP 的真实推理已通过，见 [验收记录](TESTING.md#一次真实-deepseek-调用验收)。
此结果不代替部署后在目标环境的验收，新的真实请求仍需对应授权。

回退：先关闭路由并重启，确认 health_check；切换到已审核的旧代码镜像，保留同一个账本/持久卷。
JWT/JWKS 轮换由 IdP 管理；Key 泄露时由用户在 DeepSeek 控制台撤销并用安全渠道更新环境，不能把 Key 贴入 issue 或日志。
