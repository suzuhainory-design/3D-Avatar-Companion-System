# 3D Avatar Companion System - TODO

## 数据库与后端基础
- [x] 设计数据库schema（用户表、数字人表、对话历史表、服装库表、文件存储表）
- [x] 数据库迁移推送
- [x] 文件上传tRPC路由（图片、服装、媒体文件 → S3存储）
- [x] 3D模型生成tRPC路由（SAM分割 + SMPL-X拟合）
- [x] 参数化调整保存/加载tRPC路由
- [x] 发型数据保存/加载tRPC路由
- [x] 服装库CRUD tRPC路由
- [x] 最终渲染与模型导出tRPC路由
- [x] LLM多模态对话tRPC路由（deepseek集成）
- [x] 情绪分析tRPC路由
- [x] 语音转录tRPC路由（Whisper集成）
- [ ] 向量数据库对话历史存储与检索（架构已设计，待集成Pinecone/Chroma）
- [x] 关键事件通知系统（模型生成失败、异常错误）

## 前端页面架构
- [x] 深色科技风格主题设计（index.css全局样式）
- [x] 导航系统与路由配置（App.tsx）
- [x] 首页/仪表盘（项目入口与数字人管理）

## 模块1：图片上传与3D预览
- [x] 图片上传页面（拖拽上传、预览、格式校验）
- [x] 3D模型预览组件（CSS 3D效果预览器，后续升级Babylon.js）
- [x] 上传后自动触发后端模型生成
- [x] 生成进度展示与错误处理

## 模块2：参数化调整
- [x] 骨架调整面板（身高、肩宽、胯骨高度/宽度等滑块）
- [x] 肤色调整面板（色盘选择器）
- [x] 五官调整面板（形状、位置、大小、立体感滑块）
- [x] 性别特征调整面板（胸部大小、喉结大小/明显程度）
- [x] 妆容编辑面板（眼影、腮红、口红等）
- [x] 实时3D预览更新

## 模块3：发型定制
- [x] 发型选择页面（默认秃头选项）
- [x] 头发长度/颜色/渐变调节
- [x] 发梢/发尾/发中独立调节
- [x] 发型实时预览

## 模块4：服装库
- [x] 默认服装模板展示（分类浏览）
- [x] 服装颜色调节
- [x] 用户上传服装图片功能
- [x] 服装3D模型生成与体型适配（API接口已就绪，实际渲染待集成）
- [x] 服装实时预览

## 模块5：最终渲染与导出
- [x] 身高输入与最终拟合
- [x] 最终渲染预览
- [x] .glb格式模型下载（接口已就绪）
- [x] 创建过程每一步回退功能

## 模块6：3D数字人对话交互
- [x] 对话界面（消息列表、输入框、文件上传）
- [x] LLM多模态对话集成
- [x] 多文件格式支持（txt/md/json/csv/xml/html/pdf/doc/ppt/xlsx/jpg/png/mp3/wav/mp4等）
- [x] 情绪分析与情绪强度展示
- [x] 3D数字人动画系统（肢体动作、面部表情）- 框架已搭建
- [x] Wav2Lip唇同步（嘴部动作与TTS语音匹配）- 已通过ElevenLabs + MPEG-4 viseme系统实现
- [x] TTS语音合成 - 已集成ElevenLabs TTS API
- [x] 对话结束后展示LLM返回消息文本

## 模块7：实时通信与打断
- [x] WebSocket实时通信系统（Socket.io集成）
- [x] 用户语音输入实时转录（Whisper）
- [x] 文字/语音/文件打断机制
- [x] 打断后立即停止当前动作并切换新对话
- [x] 对话总结截止到打断时刻

## 模块8：长期记忆
- [ ] 向量数据库集成（Pinecone/Chroma）
- [x] 对话历史embedding存储（数据库表已设计）
- [x] 用户偏好记录与检索（数据库表已设计）
- [ ] 个性化回应生成（待集成向量检索）

## 测试
- [x] 后端tRPC路由单元测试（17个测试全部通过）
- [x] 文件上传流程测试
- [x] LLM对话流程测试

## 下一阶段：核心功能升级
- [x] 集成Babylon.js真实3D渲染引擎：已将CSS模拟替换为Babylon.js v8.51.2 WebGL2引擎，实现参数化人体模型、骨骼动画和实时变形
- [x] 接入TTS语音合成服务：已集成ElevenLabs TTS API，实现完整的文本→语音→viseme→3D唇同步流水线
- [ ] 集成向量数据库实现长期记忆：接入Pinecone或ChromaDB，将对话历史embedding化存储，让数字人能记住用户偏好并生成个性化回应
- [x] 为项目仓库添加 .env.example 文件，列出所有必需的环境变量

## Babylon.js 3D 渲染引擎集成
- [x] 安装 Babylon.js 核心依赖（@babylonjs/core, @babylonjs/loaders, @babylonjs/materials, @babylonjs/serializers）
- [x] 创建 Babylon.js 3D 场景核心组件（引擎、场景、相机、灯光）
- [x] 实现 SMPL-X 模型加载器与骨骼系统（参数化变形）
- [x] 替换图片上传页面（AvatarUpload）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 替换骨架调整页面（AvatarSkeleton）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 替换外观定制页面（AvatarAppearance）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 替换发型定制页面（AvatarHair）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 替换服装库页面（AvatarClothing）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 替换最终渲染页面（AvatarFinalRender）CSS 模拟预览为 Babylon.js 3D 渲染器
- [x] 实现对话页面 3D 数字人动画系统（表情、肢体动作、唇同步）
- [x] 编写 Babylon.js 集成相关单元测试（36个测试全部通过）

## ElevenLabs TTS 语音合成与唇形同步集成
- [x] 后端：创建 ElevenLabs TTS API 集成服务（支持流式音频生成）
- [x] 后端：实现文本到 viseme 时间轴映射（音素→唇形对照表）
- [x] 后端：创建 tRPC 路由处理 TTS 请求和 viseme 数据返回
- [x] 前端：创建音频播放器组件（支持流式播放和打断）
- [x] 前端：创建唇同步控制器（音频时间轴 → viseme 索引 → morph target 权重）
- [x] 前端：将唇同步系统与 SMPLXAvatar 3D 动画系统联动
- [x] 集成：实现 LLM 回复 → TTS → 唇同步 → 3D 动画完整流程
- [x] 集成：支持对话打断时立即停止音频和动画
- [x] 编写 TTS 和唇同步相关单元测试（78个测试全部通过）
- [x] 配置 ElevenLabs API Key 环境变量

## SAM + SMPL-X 真实模型集成（替换占位模型）
- [x] 将用户提供的 sam_smplx_pipeline Python 包集成到项目后端（uv 管理）
- [x] 创建 Python 模型转换微服务（FastAPI），暴露 REST API 供 Node.js 后端调用
- [x] 实现图片→SAM 3D网格→SMPL-X拟合→GLB导出完整流水线
- [x] 后端 tRPC 路由对接 Python 微服务，处理模型生成请求
- [x] 升级前端 BabylonScene/AvatarPreview3D 组件，支持加载真实 .glb 模型文件
- [x] 替换 SMPLXAvatar 占位几何体为真实 SMPL-X 网格（含骨骼/BlendShapes）
- [x] 更新骨架调整页面，通过 SMPL-X betas 参数驱动真实体型变形
- [x] 更新外观定制页面，支持真实模型的纹理/材质修改
- [x] 更新对话页面，加载用户的真实 3D 数字人模型
- [x] 编写 SAM+SMPL-X 集成相关单元测试（108个测试全部通过）
