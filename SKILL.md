# kais-jimeng — 即梦图片/视频生成

激活条件：用户提到 即梦、jimeng、dreamina、AI图片生成、AI视频生成、Seedance、文生图、图生图 等关键词时激活。

## 服务管理

- **服务位置**：`/tmp/jimeng-free-api-all/`
- **Fork 地址**：`https://github.com/kaiger666888/jimeng-free-api-all`
- **构建**：`cd /tmp/jimeng-free-api-all && npm run build`
- **启动**：`cd /tmp/jimeng-free-api-all && nohup node dist/index.js --port 8000 > /tmp/jimeng-server.log 2>&1 &`
- **健康检查**：`curl -s http://localhost:8000/ping`
- **服务日志**：`tail -20 /tmp/jimeng-server.log`
- **注意**：`/tmp` 被清理后需重新 clone 并构建
- **端口冲突**：启动前先 `kill $(lsof -ti:8000) 2>/dev/null`

## 认证

- 从即梦官网获取 sessionid（F12 → Application → Cookies → sessionid）
- 用 sessionid 作为 Bearer Token：`Authorization: Bearer <sessionid>`
- 支持多账号：逗号分隔多个 sessionid
- **sessionid 存储在 TOOLS.md 中（脱敏存储）**

## 默认模型

- **文生图默认**：jimeng-5.0（已修改源码 DEFAULT_MODEL）
- **文生视频默认**：jimeng-video-seedance-2.0-fast（已修改源码 DEFAULT_MODEL）

## API 端点

服务地址：`http://localhost:8000`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI 兼容对话（文生图返回 markdown 图片链接） |
| `/v1/images/generations` | POST | 文生图/图生图 |
| `/v1/images/compositions` | POST | 图生图（向后兼容） |
| `/v1/videos/generations` | POST | 视频生成（同步，阻塞等待） |
| `/v1/videos/generations/async` | POST | 异步视频生成（立即返回 task_id） |
| `/v1/videos/generations/async/:taskId` | GET | 查询异步视频任务结果（阻塞等待完成） |
| `/v1/models` | GET | 获取模型列表 |
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
- `resolution`: 分辨率（2k, 4k）
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
curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"提示词","ratio":"16:9","resolution":"2k"}'
```

### 图生图（多图融合）

```bash
curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"描述","images":["url1","url2"],"ratio":"1:1","sample_strength":0.5}'
```

### 纯文本生成视频（普通视频模型，~2分钟）

```bash
curl -s --max-time 600 http://localhost:8000/v1/videos/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-video-3.5-pro","prompt":"描述","ratio":"16:9","duration":5}'
```

### Seedance 视频（通过 file_paths 传素材URL，推荐方式）

```bash
# Step 1: 文生图获取素材
IMAGE_URL=$(curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"素材描述","ratio":"16:9","resolution":"2k"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['url'])")

# Step 2: 用素材URL生成Seedance视频（同步，可能需要10-15分钟）
curl -s --max-time 1200 http://localhost:8000/v1/videos/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"jimeng-video-seedance-2.0-fast\",\"prompt\":\"@1 视频描述\",\"ratio\":\"16:9\",\"duration\":4,\"file_paths\":[\"$IMAGE_URL\"]}"
```

### Seedance 视频（异步方式，不怕超时，推荐）

```bash
# Step 1: 提交异步任务
TASK_ID=$(curl -s --max-time 60 http://localhost:8000/v1/videos/generations/async \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"jimeng-video-seedance-2.0-fast\",\"prompt\":\"@1 视频描述\",\"ratio\":\"16:9\",\"duration\":4,\"file_paths\":[\"$IMAGE_URL\"]}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")

# Step 2: 查询结果（阻塞等待直到完成）
curl -s --max-time 1200 "http://localhost:8000/v1/videos/generations/async/$TASK_ID" \
  -H "Authorization: Bearer $SESSION_ID"
```

## 响应格式

**图片接口**：
```json
{"created":1775544138,"data":[{"url":"https://p11-dreamina-sign.byteimg.com/..."}]}
```
- 返回4张图片URL
- 单张约 3-5MB

**Chat 接口**（OpenAI 格式）：
```json
{"choices":[{"message":{"role":"assistant","content":"![image_0](url1)\n![image_1](url2)\n![image_2](url3)\n![image_3](url4)"}}]}
```

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
- 每日免费 66 积分，每次生成消耗 1 积分
- 视频生成消耗更多积分
- 高峰期可能被限流：「该模型当前访问量过大，请您稍后再试」

### Seedance 特殊规则
- **必须有素材文件**（图片/视频/音频），不支持纯文本生成
- **素材传入方式**：推荐用 `file_paths`（JSON 数组传 URL），不要用 `files`（multipart 上传有兼容问题）
- **@1 @2 占位符**：prompt 中用 `@1` 引用第一个素材，`@2` 引用第二个，依此类推
- **生成时间**：普通视频 ~2分钟，Seedance 可能需要 10-15 分钟
- **建议用异步接口**：同步接口可能超时，异步接口可恢复查询

### 认证与安全
- sessionid 会过期，需定期刷新
- 仅限自用，不要对外提供服务
- 无人报告过因 API 调用被封号（截至2026-04-07），但仍需控制频率

## 工作流程（Agent 执行指南）

### 图片生成
1. 检查服务：`curl -s http://localhost:8000/ping`
2. 如未运行：`kill $(lsof -ti:8000) 2>/dev/null; cd /tmp/jimeng-free-api-all && nohup node dist/index.js --port 8000 > /tmp/jimeng-server.log 2>&1 &`
3. 从 TOOLS.md 读取 sessionid
4. 调用 `/v1/images/generations` 或 `/v1/chat/completions`
5. 下载第一张图到 `/tmp/openclaw/`
6. 用 `message` tool 的 `media` 参数发送

### 视频生成（普通模型）
1. 检查服务并获取 sessionid
2. 调用 `/v1/videos/generations`，model 用 jimeng-video-3.5-pro
3. 等待 ~2分钟
4. 下载视频到 `/tmp/openclaw/`
5. 用 `message` tool 发送（视频建议用 `asDocument: true` 避免压缩）

### 视频生成（Seedance）
1. 检查服务并获取 sessionid
2. **Step 1**：文生图获取素材 URL（jimeng-5.0，ratio 匹配目标视频比例）
3. **Step 2**：用 `file_paths` 传素材 URL，调用异步接口 `/v1/videos/generations/async`
4. **Step 3**：拿到 task_id，用 `/v1/videos/generations/async/:taskId` 查询结果
5. 下载视频并发送给用户
6. 如果查询超时，记住 task_id 后续再查

### 交付结果
- 图片：`message` tool → `media: "/tmp/openclaw/xxx.png"`
- 视频：`message` tool → `media: "/tmp/openclaw/xxx.mp4", asDocument: true`（避免 Telegram 压缩）
