# kais-jimeng — 即梦图片/视频生成

激活条件：用户提到 即梦、jimeng、dreamina、AI图片生成、AI视频生成、Seedance、文生图、图生图 等关键词时激活。

## 服务管理

- **容器名**：`jimeng-free-api`
- **镜像**：`ghcr.io/iptag/jimeng-api:latest`
- **端口映射**：`8003:5100`（外部 8003，内部 5100）
- **Docker 网络**：`kais-net`（已接入，gold-team 可通过容器名访问）
- **健康检查**：`curl -s http://localhost:8003/ping`
- **重启**：`docker restart jimeng-free-api`
- **彻底重建**：`docker stop jimeng-free-api && docker rm jimeng-free-api && docker run -d --name jimeng-free-api -p 8003:5100 --restart unless-stopped ghcr.io/iptag/jimeng-api:latest`
- **日志**：`docker logs --tail 20 jimeng-free-api`

## 认证

- 从即梦官网获取 sessionid（F12 → Application → Cookies → sessionid）
- 用 sessionid 作为 Bearer Token：`Authorization: Bearer <sessionid>`
- **当前 sessionid**：`1c2582ab0be7726dc3a4040e55bd0124`（2026-05-29 更新）
- sessionid 会过期，需定期手动刷新

## 默认模型

- **文生图默认**：jimeng-5.0
- **文生视频默认**：jimeng-video-seedance-2.0-fast

## API 端点

服务地址：`http://localhost:8003`（host）或 `http://jimeng-free-api:5100`（Docker 内部）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/images/generations` | POST | 文生图/图生图 |
| `/v1/images/compositions` | POST | 图生图（向后兼容） |
| `/v1/videos/generations` | POST | 视频生成（同步，阻塞等待） |
| `/v1/videos/generations/async` | POST | 异步视频生成（立即返回 task_id） |
| `/v1/videos/generations/async/:taskId` | GET | 查询异步视频任务结果（阻塞等待完成） |
| `/v1/models` | GET | 获取模型列表 |
| `/token/check` | POST | 检查 token 是否有效（`{"token":"<sid>"}`） |
| `/token/points` | POST | 查询积分（Authorization header） |
| `/ping` | GET | 健康检查 |

## 支持的模型

**图片模型**（默认 jimeng-5.0）：
jimeng-5.0、jimeng-4.6、jimeng-4.5、jimeng-4.1、jimeng-4.0、jimeng-3.1、jimeng-3.0、jimeng-2.1、jimeng-2.0-pro、jimeng-2.0、jimeng-1.4、jimeng-xl-pro

**视频模型**（默认 jimeng-video-seedance-2.0-fast）：
- jimeng-video-3.5-pro（纯文本生成视频，~2分钟）
- jimeng-video-3.0 / 3.0-pro
- jimeng-video-seedance-2.0（多模态智能视频，需素材）
- jimeng-video-seedance-2.0-fast（快速版，需素材）
- jimeng-video-seedance-2.0-fast-vip（VIP 极速推理）
- jimeng-video-seedance-2.0-vip（VIP 主模态）

## 参数说明

**图片参数**：
- `model`: 模型名（默认 jimeng-5.0）
- `prompt`: 文本提示词
- `ratio`: 宽高比（1:1, 16:9, 9:16, 3:4, 4:3 等）
- `resolution`: 分辨率（1k, 2k, 4k）
- `sample_strength`: 采样强度（0-1，默认0.5）
- `images`: 参考图片URL数组（图生图时使用）

**视频参数**：
- `model`: 视频模型名（默认 jimeng-video-seedance-2.0-fast）
- `prompt`: 文本提示词
- `ratio`: 宽高比（Seedance 默认 4:3，普通视频默认 1:1）
- `duration`: 时长（秒，Seedance 默认4秒，普通视频默认5秒）
- `file_paths`: 素材文件URL数组（Seedance 必需，支持图片/视频/音频URL）
- `files`: 素材文件（multipart上传，Seedance 使用）

## 使用示例

### 文生图（返回4张图）

```bash
curl -s --max-time 120 http://localhost:8003/v1/images/generations \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"提示词","ratio":"16:9","resolution":"2k"}'
```

### 图生图（多图融合）

```bash
curl -s --max-time 120 http://localhost:8003/v1/images/generations \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"描述","images":["url1","url2"],"ratio":"1:1","sample_strength":0.5}'
```

### 纯文本生成视频（普通视频模型，~2分钟）

```bash
curl -s --max-time 600 http://localhost:8003/v1/videos/generations \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-video-3.5-pro","prompt":"描述","ratio":"16:9","duration":5}'
```

### Seedance 视频（异步方式，推荐）

```bash
# Step 1: 文生图获取素材 URL
IMAGE_URL=$(curl -s --max-time 120 http://localhost:8003/v1/images/generations \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"素材描述","ratio":"16:9","resolution":"2k"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['url'])")

# Step 2: 提交异步 Seedance 任务
TASK_ID=$(curl -s --max-time 60 http://localhost:8003/v1/videos/generations/async \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"jimeng-video-seedance-2.0-fast\",\"prompt\":\"@1 视频描述\",\"ratio\":\"16:9\",\"duration\":4,\"file_paths\":[\"$IMAGE_URL\"]}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")

# Step 3: 查询结果（阻塞等待直到完成）
curl -s --max-time 1200 "http://localhost:8003/v1/videos/generations/async/$TASK_ID" \
  -H "Authorization: Bearer 1c2582ab0be7726dc3a4040e55bd0124"
```

## gold-team 集成

即梦引擎已集成到 kais-gold-team 的 CloudPool 中：
- **引擎类**：`src/v6/engines/cloud_jimeng.JimengEngine`
- **支持类型**：`image_draw`, `image_refine`, `video_final`
- **环境变量**：`JIMENG_API_KEY` 或 `JIMENG_SESSION_ID`（sessionid 值）
- **Docker 内部 URL**：`http://jimeng-free-api:5100`
- **已接入 kais-net 网络**：gold-team 容器可直接通过容器名访问
- **优先级**：jimeng > kling > seedance（在 CloudPool 路由中）

## 响应格式

**图片接口**：
```json
{"created":1775544138,"data":[{"url":"https://p11-dreamina-sign.byteimg.com/..."}]}
```
- 返回4张图片URL

**视频接口**：
```json
{"created":1775545576,"data":[{"url":"https://v3-dreamnia.jimeng.com/...","revised_prompt":"..."}]}
```

**异步提交响应**：
```json
{"task_id":"xxx","message":"任务已提交"}
```

## 重要注意事项

### 积分与限制
- 当前积分：VIP 1080 + 赠送 60 = 1140（2026-05-29）
- 视频生成消耗更多积分
- 高峰期可能被限流

### Seedance 特殊规则
- **必须有素材文件**（图片/视频/音频），不支持纯文本生成
- **素材传入方式**：推荐用 `file_paths`（JSON 数组传 URL）
- **@1 @2 占位符**：prompt 中用 `@1` 引用第一个素材

### 认证与安全
- sessionid 会过期，需定期手动刷新（从浏览器 F12 获取）
- 仅限自用

## 工作流程（Agent 执行指南）

### 图片生成
1. 检查服务：`curl -s http://localhost:8003/ping`
2. 调用 `/v1/images/generations`
3. 下载第一张图到 `/tmp/openclaw/`
4. 用 `message` tool 的 `media` 参数发送

### 视频生成（普通模型）
1. 调用 `/v1/videos/generations`，model 用 jimeng-video-3.5-pro
2. 等待 ~2分钟
3. 下载视频到 `/tmp/openclaw/`
4. 用 `message` tool 发送（视频建议用 `asDocument: true`）

### 视频生成（Seedance）
1. 文生图获取素材 URL
2. 用 `file_paths` 传素材 URL，调用异步接口
3. 拿到 task_id 查询结果
4. 下载视频并发送
