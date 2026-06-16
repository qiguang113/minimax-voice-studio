# MiniMax 口播工作室

一个本地运行的 MiniMax 专属语音克隆 + 文本转语音工作室，界面参考 Fish Audio 的三栏编辑器、音色面板和底部时间线。

## 启动

```bash
export MINIMAX_API_KEY="你的 MiniMax Key"
export MINIMAX_GROUP_ID="你的 GroupId，可选"
npm start
```

然后打开：

```text
http://localhost:3000
```

## 功能

- 分章节编写口播脚本
- 按段编辑、拆分、删除文案
- 选择 MiniMax 音色并生成 TTS 音频
- 添加已有 `voice_id`
- 上传参考音频进行 MiniMax 音色克隆
- 试听、下载生成后的音频

## 配置

支持这些环境变量：

- `MINIMAX_API_KEY`：必填，MiniMax API Key
- `MINIMAX_GROUP_ID`：可选，部分 MiniMax 账号会要求 GroupId
- `MINIMAX_BASE_URL`：可选，默认 `https://api.minimaxi.com`，备用可用 `https://api-bj.minimaxi.com`
- `PORT`：可选，默认 `3000`

也可以直接在页面右侧的“密钥”页保存到本地，数据会落到 `.studio-data/config.json`。

## 说明

API Key 只放在本地 Node 服务环境变量里，不会写入浏览器页面。生成的音频和音色列表会保存到 `.studio-data/`。
