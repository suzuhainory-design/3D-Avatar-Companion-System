# 3D Avatar Companion System

基于对话内容驱动的3D数字人伴侣系统。用户可通过上传单张图片生成带骨骼和纹理的3D数字人，并通过多模态对话与其进行实时交互。系统融合了3D建模、参数化定制、情绪驱动动画、唇同步和智能对话等技术。

---

## 项目概述

本项目是一个 Web 应用（前后端分离），目标用户设备为桌面/移动浏览器，支持跨平台。系统由两大核心模块组成：

**模块一：3D数字人生成与定制** — 从单张图片出发，经过人体分割（META SAM）和参数化建模（SMPL-X），生成可高度自定义的3D数字人。用户可逐步调整骨架、外观、发型、服装，最终渲染导出。

**模块二：对话驱动的实时交互** — 3D数字人基于用户与LLM的多模态对话，结合情绪分析和语音合成，执行匹配的面部表情和肢体动作，实现自然、有情感的交互体验。

---

## 技术架构

### 整体架构

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端框架 | React 19 + TypeScript | 复杂UI交互，Redux式状态管理 |
| 3D渲染引擎 | CSS 3D（当前）→ Babylon.js（规划） | 当前使用CSS模拟预览，后续升级为真实3D引擎 |
| UI组件库 | shadcn/ui + Tailwind CSS 4 | 深色科技风格，统一设计语言 |
| 后端框架 | Express 4 + tRPC 11 | 类型安全的API通信，端到端类型推导 |
| 实时通信 | Socket.io | WebSocket双向通信，支持打断机制 |
| 数据库 | MySQL (TiDB) + Drizzle ORM | 8张核心数据表，schema-first工作流 |
| 文件存储 | AWS S3 | 图片、模型文件、媒体文件持久化存储 |
| LLM集成 | DeepSeek（多模态） | 支持文本、图片、音频、视频等多模态输入 |
| 语音转录 | Whisper API | 实时语音转文字 |
| 认证系统 | Manus OAuth | 安全的用户认证与会话管理 |

### 项目结构

```
avatar-companion-system/
├── client/                     # 前端代码
│   ├── src/
│   │   ├── pages/              # 页面组件（一个模块一个页面）
│   │   │   ├── Home.tsx            # 首页仪表盘
│   │   │   ├── AvatarUpload.tsx    # 模块1: 图片上传与3D预览
│   │   │   ├── AvatarSkeleton.tsx  # 模块2: 骨架调整
│   │   │   ├── AvatarAppearance.tsx# 模块2: 外观定制（肤色/五官/性别特征/妆容）
│   │   │   ├── AvatarHair.tsx      # 模块3: 发型定制
│   │   │   ├── AvatarClothing.tsx  # 模块4: 服装库
│   │   │   ├── AvatarFinalRender.tsx# 模块5: 最终渲染与导出
│   │   │   └── AvatarChat.tsx      # 模块6: 3D数字人对话交互
│   │   ├── components/         # 共享组件
│   │   │   ├── StepNavigation.tsx  # 创建流程步骤导航
│   │   │   └── AvatarPreview3D.tsx # 3D预览器组件
│   │   ├── hooks/              # 自定义Hooks
│   │   │   └── useSocket.ts        # WebSocket连接管理
│   │   ├── lib/trpc.ts         # tRPC客户端绑定
│   │   ├── App.tsx             # 路由配置
│   │   └── index.css           # 全局主题样式
│   └── index.html
├── server/                     # 后端代码
│   ├── routers.ts              # tRPC路由（6个模块）
│   ├── db.ts                   # 数据库查询helpers
│   ├── websocket.ts            # WebSocket服务端
│   ├── storage.ts              # S3存储helpers
│   ├── avatar.test.ts          # 单元测试
│   └── _core/                  # 框架核心（OAuth、LLM、TTS等）
├── drizzle/                    # 数据库Schema与迁移
│   └── schema.ts               # 8张数据表定义
├── shared/                     # 前后端共享常量与类型
├── todo.md                     # 功能开发进度追踪
└── package.json
```

---

## 功能模块详解

### 模块1：图片上传与3D预览

用户上传单张人物照片，系统通过 META SAM 进行人体分割，结合 SMPL-X 参数化模型生成带骨骼和纹理的3D数字人预览版。支持拖拽上传、格式校验（JPG/PNG/WebP）、实时进度展示和错误处理。

### 模块2：参数化调整

提供全面的参数化调整界面，包含五个子面板：

| 调整面板 | 可调参数 |
|---------|---------|
| 骨架调整 | 身高、肩宽、胯骨高度/宽度、臂长、腿长、躯干长度、颈长 |
| 肤色调整 | RGB色盘选择器、亮度、饱和度 |
| 五官调整 | 眼睛（大小/间距/高度）、鼻子（高度/宽度/鼻梁）、嘴巴（宽度/高度/唇厚）、下颌（宽度/高度/下巴长度）、颧骨高度、面部深度 |
| 性别特征 | 女性：胸部大小；男性：喉结大小/明显程度 |
| 妆容编辑 | 眼影（颜色/强度）、腮红、口红、眼线、粉底 |

所有参数调整均支持实时3D预览更新。

### 模块3：发型定制

支持默认秃头或用户自定义发型。可独立调节头发长度、颜色（支持渐变效果），以及发梢、发中、发尾三个区域的独立参数控制。

### 模块4：服装库

提供6大类默认服装模板（上衣、下装、连衣裙、外套、鞋子、配饰），每件支持颜色调节。用户也可上传服装图片，系统自动生成3D模型并适配到数字人体型。

### 模块5：最终渲染与导出

用户输入期望身高（50-250cm），系统进行最终模型拟合渲染。支持 .glb 格式3D模型文件下载。创建过程每一步均支持回退，通过步骤快照机制实现。

### 模块6：3D数字人对话交互

集成 DeepSeek LLM 实现多模态对话，支持用户上传多种文件格式：

| 文件类别 | 支持格式 |
|---------|---------|
| 文本文件 | .txt, .md, .json, .csv, .xml, .html |
| 文档文件 | .pdf, .doc/.docx, .ppt/.pptx, .xlsx/.xls |
| 图片文件 | .jpg/.jpeg, .png, .webp, .gif |
| 音频文件 | .mp3, .wav, .m4a, .aac, .flac |
| 视频文件 | .mp4, .mov, .mkv, .webm, .avi, .flv, .wmv |

系统基于LLM返回消息进行情绪分析（7种情绪类型 × 情绪强度0.0-1.0），驱动3D数字人执行对应的肢体动作和面部表情。

### 模块7：实时通信与打断

基于 Socket.io 的 WebSocket 实时通信系统。用户可通过文字、语音或文件发送来打断3D数字人的当前对话，系统立即停止当前动作和语音输出，切换到新对话处理。对话总结自动截止到打断时刻。

### 模块8：长期记忆（规划中）

通过向量数据库（Pinecone/ChromaDB）存储对话历史的 embedding 向量，实现长期记忆和个性化回应。数据库表结构已设计完成，待集成向量检索服务。

---

## 数据库设计

系统包含8张核心数据表：

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| users | 用户信息 | openId, name, email, role |
| avatars | 数字人模型 | userId, gender, status, currentStep, 各类参数JSON |
| avatar_step_history | 步骤快照（支持回退） | avatarId, stepName, paramsSnapshot, stepOrder |
| clothing_items | 服装库 | category, isDefault, sourceImageUrl, customColor |
| chat_sessions | 对话会话 | userId, avatarId, title, messageCount |
| chat_messages | 对话消息 | sessionId, role, content, emotionAnalysis, wasInterrupted |
| file_records | 文件记录 | userId, url, fileKey, mimeType, purpose |
| user_preferences | 用户偏好 | userId, preferenceKey, preferenceValue |

---

## 后端API

系统提供6个tRPC路由模块，共计20+个API端点：

| 模块 | 路由前缀 | 主要功能 |
|------|---------|---------|
| avatar | `trpc.avatar.*` | 创建/查询/更新/删除数字人，步骤快照与回退，模型生成，最终渲染 |
| clothing | `trpc.clothing.*` | 服装列表/详情/创建/颜色更新 |
| chat | `trpc.chat.*` | 创建对话/获取消息/发送消息（含LLM+情绪分析）/打断标记 |
| file | `trpc.file.*` | 文件上传至S3/文件列表查询 |
| voice | `trpc.voice.*` | 语音转文字（Whisper API） |
| emotion | `trpc.emotion.*` | 独立情绪分析 |

---

## 快速开始

### 环境要求

- Node.js >= 22.x
- pnpm >= 10.x
- MySQL 数据库（推荐 TiDB）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/suzuhainory-design/3D-Avatar-Companion-System.git
cd 3D-Avatar-Companion-System

# 安装依赖
pnpm install

# 配置环境变量（参考 .env.example）
cp .env.example .env

# 推送数据库Schema
pnpm db:push

# 启动开发服务器
pnpm dev
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| DATABASE_URL | MySQL/TiDB 连接字符串 |
| JWT_SECRET | 会话Cookie签名密钥 |
| VITE_APP_ID | Manus OAuth 应用ID |
| OAUTH_SERVER_URL | Manus OAuth 后端地址 |
| BUILT_IN_FORGE_API_URL | 内置API服务地址（LLM、存储等） |
| BUILT_IN_FORGE_API_KEY | 内置API服务密钥 |

---

## 测试

```bash
# 运行所有单元测试
pnpm test
```

当前测试覆盖：17个测试用例，涵盖数字人CRUD、对话系统、情绪分析、文件上传等核心功能。

---

## 开发路线图

### 已完成 ✅

- 完整的数据库设计与迁移（8张表）
- 6个后端API模块（20+端点）
- 8个前端页面（深色科技风格）
- WebSocket实时通信（Socket.io）
- LLM多模态对话集成
- 情绪分析与动画驱动框架
- 语音转录（Whisper）
- 文件上传与S3存储
- 步骤回退机制
- 单元测试（17个用例）

### 进行中 🔧

- 集成 Babylon.js 真实3D渲染引擎，替换CSS模拟预览
- 接入 TTS 语音合成服务（ElevenLabs/Azure），实现唇同步
- 集成向量数据库（Pinecone/ChromaDB），实现长期记忆

### 规划中 📋

- SMPL-X 模型实际加载与参数化变形
- Wav2Lip 唇同步精确匹配
- 多人交互支持
- 移动端适配优化
- CI/CD 流水线（GitHub Actions）

---

## 技术设计原则

**模块化** — 前端负责渲染和交互，后端负责计算密集任务（模型生成、LLM推理），通过tRPC实现端到端类型安全。

**性能优先** — 采用异步处理、流式传输和WebSocket实时通信，确保交互延迟低于500ms。

**扩展性** — 微服务架构设计，便于未来添加功能（如多人交互、更多AI模型集成）。

**安全性** — JWT认证、文件上传大小限制、沙箱处理，保护用户数据安全。

---

## 许可证

MIT License
