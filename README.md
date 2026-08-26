# WKU Course Registration Assistant

一个运行在 macOS 本机的课程注册辅助工具，面向 Kean/WKU 使用的 Ellucian Colleague Self-Service。它可以在指定北京时间点击 Schedule 页的 `Register Now`，也可以持续监控指定 Section 的空位，在出现余位后进入注册流程。

> 本项目只操作正常网页流程，不包含验证码绕过、排队绕过、接口伪造或高频请求。使用前请确认学校的相关规定。

## 功能

- 本地中文控制面板，关闭程序后停止运行
- 固定时间抢课：日期与时、分、秒滚轮设置
- 空位监控：持续读取 `Seats Available`
- 多个 Section 按输入顺序监控，任意一个成功后停止
- 演练模式：验证识别和通知，不执行最终注册
- 自动识别 `Register Now`、确认弹窗和注册结果
- 满员时继续监控；冲突、先修课、权限或学分限制时停止
- macOS 通知、提示音、运行日志和结果截图
- Chrome、Edge 和 Safari 浏览器选择
- 运行期间通过 `caffeinate` 防止 Mac 睡眠

## 浏览器支持

| 浏览器 | 状态 | 登录会话 |
| --- | --- | --- |
| Google Chrome | 推荐、完整支持 | 使用独立配置保存 |
| Microsoft Edge | 完整支持，需先安装 | 使用独立配置保存 |
| Safari | 支持，需启用 SafariDriver | 自动化窗口通常需要重新登录 |

Safari 首次使用前运行：

```bash
safaridriver --enable
```

并在 Safari 的开发者设置中允许远程自动化。

## 环境要求

- macOS
- Node.js 20 或更高版本
- Google Chrome、Microsoft Edge 或 Safari
- 学校网站的有效账号和正常访问权限

## 安装与启动

克隆仓库：

```bash
git clone <repository-url>
cd course-registration-assistant
npm install
```

然后在 Finder 中双击：

```text
启动抢课助手.command
```

也可以从终端启动：

```bash
npm start
```

打开本地控制面板：

```text
http://127.0.0.1:43127
```

不要直接打开 `public/index.html`，否则本地服务不会启动，按钮也无法工作。

## 使用流程

### 首次准备

1. 启动控制面板。
2. 选择浏览器并点击“打开学校网站”。
3. 在自动化浏览器窗口中手动完成学校登录。
4. 打开 `Schedule` 页面。
5. 首次使用保持“演练模式”开启。

### 固定时间抢课

1. 提前在学校网站中把目标 Section 点击 `Add` 加入 Plan。
2. 选择“固定时间抢课”。
3. 使用日期和时间滚轮设置北京时间。
4. 点击“开始运行”。
5. 助手到点后操作当前 Schedule 页的全局 `Register Now`。

固定时间模式不要求手动填写 Section，因为 `Register Now` 会处理当前 Plan 中的课程。开始前应确认 Plan 中没有不希望提交的课程。

### 退课空位监控

1. 把候选 Section 提前加入 Plan。
2. 选择“退课空位监控”。
3. 每行输入一个 Section Name，例如：

```text
CPS*2390*W03
CPS*2390*W04
```

4. 设置刷新间隔并点击“开始运行”。
5. 助手持续监控，直到手动停止或真实注册成功。

演练模式发现余位时只截图并通知，不会点击注册，也不会结束监控。

## 安全设计

- 不在源码或配置中保存学校密码
- Chrome 和 Edge 使用项目内的独立浏览器配置
- 登录数据、日志和截图默认通过 `.gitignore` 排除
- 提交前按 Section Name 核对目标课程
- 真实注册成功后自动停止，避免重复提交
- 遇到业务冲突或无法判断的结果时停止并通知用户

## 项目结构

```text
course-registration-assistant/
├── public/                    # 本地中文控制面板
├── src/
│   ├── browser-session.js     # Chrome、Edge、Safari 适配层
│   ├── registration-runner.js # 定时与监控流程
│   ├── section-parser.js      # Section 和余位解析
│   ├── notifier.js            # macOS 通知
│   └── server.js              # 本地 HTTP 服务
├── test/                      # Node.js 自动测试
└── 启动抢课助手.command        # Finder 双击启动入口
```

## 测试

```bash
npm run check
```

该命令执行源码语法检查和 Node.js 自动测试。

## 当前限制

- 最终成功率取决于学校服务器、开放规则、网络状态和同时竞争人数。
- 页面结构发生变化后，可能需要更新元素识别逻辑。
- Safari 自动化会话与日常 Safari 数据隔离。
- Edge 必须安装在标准的 `/Applications` 目录。
- 当前版本要求候选 Section 预先加入 Plan。

## 隐私

项目不会把账号、密码或 Cookie 上传到远程服务。`runtime/` 和 `logs/` 仅保存在本机，并已从 Git 跟踪中排除。提交问题或分享截图前，请自行移除姓名、学号和其他个人信息。
