<div align="center">

# 🌟 Starizzi — Multi-Agent Gateway

**Desktop AI Agent Hub for Windows & macOS** · powered by [IzziAPI](https://izziapi.com)

Run, chat with, and orchestrate top open-source AI agents — **OpenClaw, Hermes, AutoGPT, Dify, CrewAI, n8n** — from one beautiful liquid-glass desktop app. One API key, every model.

[![Download](https://img.shields.io/github/v/release/kentzu213/starizzi-app?label=Download&style=for-the-badge&logo=github)](https://github.com/kentzu213/starizzi-app/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=for-the-badge)](https://github.com/kentzu213/starizzi-app/releases/latest)
[![License](https://img.shields.io/badge/license-Proprietary-lightgrey?style=for-the-badge)](#-license--giấy-phép)

[**⬇️ Download / Tải về**](https://github.com/kentzu213/starizzi-app/releases/latest) · [English](#-english) · [Tiếng Việt](#-tiếng-việt)

</div>

---

## 🇬🇧 English

### What is Starizzi?

**Starizzi** (Izzi OpenClaw) is a cross-platform **desktop AI agent gateway**. Install, configure, and chat with multiple autonomous AI agents through a single frameless, glassmorphic interface — no terminal required. It connects to [izziapi.com](https://izziapi.com) so one API key unlocks GPT, Claude, Gemini and 200+ models with smart routing and budget control.

> Keywords: AI agent desktop app, multi-agent gateway, OpenClaw, Hermes agent, AutoGPT desktop, Telegram AI bot, Zalo AI bot, Electron AI app, IzziAPI, LLM router, GPT Claude Gemini one key.

### ✨ Features

- 🤖 **Multi-Agent Gateway** — Chat with several agents in parallel via tabs. Built-in support for **OpenClaw, Hermes (Nous Research), AutoGPT, Dify, CrewAI, n8n**.
- ⚡ **One-Click Setup Wizard** — Express mode (API key + bot token), full Custom mode, and Restore-from-backup. Real Docker pull + run for container agents.
- 🔑 **One API Key, Every Model** — IzziAPI smart router across GPT-5.x, Claude 4, Gemini 2.5, plus OpenAI / Anthropic / Gemini / OpenRouter / Ollama / custom endpoints.
- 💬 **Messaging Channels** — Telegram, Telegram multi-bot, Zalo OA, Zalo personal, or combo.
- 🧠 **Tasks, Memory & Status** — Agents create tasks and persistent memory; live runtime status streamed to the desktop.
- 🏪 **Marketplace & Extensions** — Discover, install (SHA-256 verified), and manage `.ocx` extensions and agent bundles.
- 💰 **Cost Dashboard** — Track spend per day/week/month, per-model breakdown, budget alerts and subscription advice.
- 🎨 **iOS-26 Liquid-Glass UI** — Token-driven glassmorphism design system, dark-only, frameless custom titlebar.
- 🔄 **Auto-Update** — Built-in updater publishes from this repo's [Releases](https://github.com/kentzu213/starizzi-app/releases).

### ⬇️ Installation

1. Go to **[Releases](https://github.com/kentzu213/starizzi-app/releases/latest)**.
2. Download the installer for your OS:
   - **Windows** → `Izzi-OpenClaw-Setup-x.y.z.exe`
   - **macOS** → `Izzi-OpenClaw-x.y.z.dmg` (Intel & Apple Silicon)
3. Run it, sign in with your [IzziAPI](https://izziapi.com) account, and follow the Setup Wizard.

No terminal, no Node, no Docker required for the Express path (Docker only needed for container-based agents like Hermes / AutoGPT).

### 🚀 Quick Start

1. **Open the app** → sign in (or run in demo mode).
2. **Setup Wizard → Express** → pick an agent (OpenClaw / Hermes / AutoGPT), paste your Izzi API key, add a Telegram/Zalo bot token.
3. **Install** → the wizard writes config and starts the agent.
4. **Agent Gateway** → start chatting; create tasks and memory automatically.

### 🛠️ Development

```bash
# Requires Node >= 20 and pnpm >= 9
git clone https://github.com/kentzu213/starizzi-app.git
cd starizzi-app

pnpm install          # install workspace deps
pnpm dev              # run desktop app (Vite renderer + Electron main)
pnpm --filter @openclaw/desktop test   # run renderer test suite (Vitest)
pnpm --filter @openclaw/desktop build  # production build
```

Tech stack: **Electron 34 + React 19 + Vite 6 + TypeScript 5 + Zustand + better-sqlite3**, tested with **Vitest + fast-check**.

### 📦 Releases & Auto-Update

All installers and the auto-update feed are published **only** to this repository:
👉 **https://github.com/kentzu213/starizzi-app/releases**

Releases are produced by the GitHub Actions workflow on every `v*` tag (Windows + macOS) via `electron-builder --publish always`.

---

## 🇻🇳 Tiếng Việt

### Starizzi là gì?

**Starizzi** (Izzi OpenClaw) là **ứng dụng desktop cổng AI agent** đa nền tảng. Cài đặt, cấu hình và trò chuyện với nhiều AI agent tự trị qua một giao diện kính (glassmorphism) liền mạch — **không cần dùng terminal**. App kết nối tới [izziapi.com](https://izziapi.com): chỉ **một API key** là dùng được GPT, Claude, Gemini và hơn 200 model với định tuyến thông minh và kiểm soát chi phí.

> Từ khóa: ứng dụng AI agent desktop, multi-agent gateway, OpenClaw, Hermes agent, AutoGPT, bot AI Telegram, bot AI Zalo, app Electron AI, IzziAPI, định tuyến LLM, một key dùng GPT Claude Gemini.

### ✨ Tính năng

- 🤖 **Cổng đa Agent** — Chat song song nhiều agent qua tab. Hỗ trợ sẵn **OpenClaw, Hermes (Nous Research), AutoGPT, Dify, CrewAI, n8n**.
- ⚡ **Trình cài đặt 1-click** — Chế độ Express (API key + bot token), Tuỳ chỉnh đầy đủ, và Khôi phục từ backup. Tự động `docker pull` + chạy thật cho agent dạng container.
- 🔑 **Một API key, mọi model** — Smart router của IzziAPI cho GPT-5.x, Claude 4, Gemini 2.5, kèm OpenAI / Anthropic / Gemini / OpenRouter / Ollama / endpoint tuỳ chỉnh.
- 💬 **Kênh nhắn tin** — Telegram, Telegram nhiều bot, Zalo OA, Zalo cá nhân, hoặc combo.
- 🧠 **Tasks, Memory & Status** — Agent tự tạo task và bộ nhớ bền vững; trạng thái runtime stream trực tiếp lên desktop.
- 🏪 **Marketplace & Tiện ích** — Khám phá, cài đặt (xác minh SHA-256) và quản lý tiện ích `.ocx` cùng agent bundle.
- 💰 **Bảng chi phí** — Theo dõi chi tiêu theo ngày/tuần/tháng, bóc tách theo model, cảnh báo ngân sách và gợi ý gói.
- 🎨 **Giao diện kính iOS-26** — Hệ design token glassmorphism, dark-only, thanh tiêu đề tuỳ chỉnh không khung.
- 🔄 **Tự động cập nhật** — Updater tích hợp, phát hành từ [Releases](https://github.com/kentzu213/starizzi-app/releases) của chính repo này.

### ⬇️ Cài đặt

1. Vào **[Releases](https://github.com/kentzu213/starizzi-app/releases/latest)**.
2. Tải bộ cài theo hệ điều hành:
   - **Windows** → `Izzi-OpenClaw-Setup-x.y.z.exe`
   - **macOS** → `Izzi-OpenClaw-x.y.z.dmg` (Intel & Apple Silicon)
3. Chạy file, đăng nhập tài khoản [IzziAPI](https://izziapi.com) và làm theo Trình cài đặt.

Không cần terminal, Node hay Docker cho luồng Express (chỉ cần Docker cho agent dạng container như Hermes / AutoGPT).

### 🚀 Bắt đầu nhanh

1. **Mở app** → đăng nhập (hoặc chạy thử ở demo mode).
2. **Setup Wizard → Express** → chọn agent (OpenClaw / Hermes / AutoGPT), dán Izzi API key, thêm bot token Telegram/Zalo.
3. **Cài đặt** → wizard ghi cấu hình và khởi động agent.
4. **Agent Gateway** → bắt đầu chat; task và memory được tạo tự động.

### 🛠️ Phát triển

```bash
# Cần Node >= 20 và pnpm >= 9
git clone https://github.com/kentzu213/starizzi-app.git
cd starizzi-app

pnpm install          # cài dependency cho workspace
pnpm dev              # chạy app desktop (Vite renderer + Electron main)
pnpm --filter @openclaw/desktop test   # chạy bộ test renderer (Vitest)
pnpm --filter @openclaw/desktop build  # build production
```

Công nghệ: **Electron 34 + React 19 + Vite 6 + TypeScript 5 + Zustand + better-sqlite3**, kiểm thử bằng **Vitest + fast-check**.

### 📦 Phát hành & Tự cập nhật

Toàn bộ bộ cài và kênh auto-update **chỉ** phát hành tại repo này:
👉 **https://github.com/kentzu213/starizzi-app/releases**

Bản phát hành được tạo bởi GitHub Actions mỗi khi đẩy tag `v*` (Windows + macOS) qua `electron-builder --publish always`.

---

## 🧩 Supported Agents / Agent hỗ trợ

| Agent | Type | Runtime |
|-------|------|---------|
| 🦞 **OpenClaw** | Local-first autonomous | Native gateway |
| ⚡ **Hermes Agent** | Self-improving (Nous Research) | Docker |
| 🧠 **AutoGPT** | Autonomous goal-driven | Docker |
| 🤖 **Dify** | LLM app platform (RAG/workflow) | Docker |
| 👥 **CrewAI** | Multi-agent orchestration | pip / Docker |
| 🔗 **n8n** | AI-native workflow automation | Docker |

## 📄 License / Giấy phép

Proprietary © Starizzi Technologies / kentzu213. All rights reserved.
Bản quyền thuộc Starizzi Technologies / kentzu213. Mọi quyền được bảo lưu.

## 🔗 Links / Liên kết

- 🌐 Website / API: [izziapi.com](https://izziapi.com)
- ⬇️ Downloads / Tải về: [Releases](https://github.com/kentzu213/starizzi-app/releases)
- 🐛 Issues / Báo lỗi: [GitHub Issues](https://github.com/kentzu213/starizzi-app/issues)
