# kais-jimeng — 即梦图片/视频生成技能

基于 [jimeng-free-api-all](https://github.com/kaiger666888/jimeng-free-api-all) 的 OpenClaw 技能，提供即梦（Dreamina）AI 图片和视频生成能力。

## 功能

- **文生图**：支持 jimeng-2.0 ~ jimeng-5.0 全系列模型，多种宽高比和分辨率
- **图生图**：多图融合，支持采样强度调节
- **视频生成**：普通模型（纯文本）和 Seedance（多模态，需素材）
- **异步视频**：提交任务后轮询，不怕超时
- **统一客户端**：`lib/jimeng-client.js` 封装所有 API 交互

## 安装

### 1. 部署即梦 API 服务

```bash
git clone https://github.com/kaiger666888/jimeng-free-api-all.git /tmp/jimeng-free-api-all
cd /tmp/jimeng-free-api-all && npm install && npm run build
nohup node dist/index.js --port 8000 > /tmp/jimeng-server.log 2>&1 &
```

### 2. 安装技能

将本目录复制到 OpenClaw workspace：

```bash
cp -r kais-jimeng/ ~/.openclaw/workspace/skills/kais-jimeng/
```

### 3. 配置认证

从即梦官网获取 sessionid（F12 → Application → Cookies → sessionid），写入 TOOLS.md。

## 使用示例

### 文生图

```bash
curl -s http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-5.0","prompt":"一只猫在雪地里","ratio":"16:9","resolution":"2k"}'
```

### Seedance 视频生成

```bash
# 1. 提交异步任务
TASK_ID=$(curl -s http://localhost:8000/v1/videos/generations/async \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"jimeng-video-seedance-2.0-fast","prompt":"@1 飞向天空","file_paths":["IMAGE_URL"]}' \
  | jq -r '.task_id')

# 2. 查询结果
curl -s "http://localhost:8000/v1/videos/generations/async/$TASK_ID" \
  -H "Authorization: Bearer $SESSION_ID"
```

## 支持的模型

- **图片**：jimeng-5.0, jimeng-4.6, jimeng-4.5, jimeng-4.1, jimeng-4.0, jimeng-3.1, jimeng-3.0, jimeng-2.1, jimeng-2.0-pro, jimeng-2.0, jimeng-1.4, jimeng-xl-pro
- **视频**：jimeng-video-3.5-pro, jimeng-video-3.0, jimeng-video-seedance-2.0, jimeng-video-seedance-2.0-fast

## 注意事项

- 每日免费 66 积分，视频消耗更多
- Seedance 必须有素材文件，用 `file_paths` 传 URL
- sessionid 会过期，需定期刷新
- `/tmp` 被清理后需重新 clone 并构建服务

## 许可

MIT
