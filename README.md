# WKU Course Registration Assistant

一个运行在 macOS 本机的课程注册辅助工具，面向 Kean/WKU 使用的 Ellucian Colleague Self-Service。它可以在指定北京时间点击 Schedule 页的 `Register Now`，也可以持续监控指定 Section 的空位，在出现余位后进入注册流程。

> 本项目只操作正常网页流程，不包含验证码绕过、排队绕过、接口伪造或高频请求。使用前请确认学校的相关规定。

## 功能

- 本地中文控制面板，关闭程序后停止运行
- 固定时间抢课：日期与时、分、秒滚轮设置
- 两种模式均可填写目标学期（例如 `Spring 2027 Wenzhou`）；刷新回默认学期时自动点击学期箭头恢复，提交动作再次核对完整学期。无法识别或恢复学期则停止，不提交。
- macOS 关闭窗口后重新打开会复用后台服务与专用浏览器；重复打开 App 会聚焦现有窗口，避免浏览器配置被多个实例争用。
- 空位监控：后台持续刷新并读取 `Seats Available`
- 多个 Section 按输入顺序监控，任意一个成功后停止
- 演练模式：验证识别和通知，不执行最终注册
- 自动识别 `Register Now`、学校处理遮罩和注册结果
- 固定时间模式提前预检 Planned 课程，到点刷新页面，每 50 毫秒检查 Register Now 是否可用，可用后提交一次。刷新和网络耗时会影响实际点击时间，不保证一秒内完成。
- 点击后识别 `Updating schedule...` 与 `Processing complete. Refreshing...`，处理完成前禁止刷新或重复提交
- 提交后不重复点击；最终结果最长等待 60 秒。定时模式逐门汇总成功、满员、受限/冲突与待人工确认，随后结束，不启动候补监控。
- 满员时继续监控；冲突、先修课、权限或学分限制时停止
- macOS 通知、提示音、运行日志和结果截图
- Chrome、Edge 和 Safari 浏览器选择
- `.command` 启动器通过 `caffeinate` 防止 Mac 睡眠；桌面 App 和直接 `npm start` 暂无该保护，请自行保持 Mac 唤醒

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

如果 Safari 在15秒内无法建立自动化会话，助手会停止等待并显示授权提示，不会一直卡在“正在打开”。

## 环境要求

- macOS
- Node.js 22 或更高版本（仅源码运行需要）
- Google Chrome、Microsoft Edge 或 Safari
- 学校网站的有效账号和正常访问权限

## 安装与启动

### 使用 macOS 安装包（推荐）

从 [v0.1.12 发布页](https://github.com/17-chen/course-registration-assistant/releases/tag/v0.1.12) 下载，或直接下载 [Apple Silicon 安装包](https://github.com/17-chen/course-registration-assistant/releases/download/v0.1.12/WKU-Course-Assistant-0.1.12-arm64.dmg)。当前仅提供 Apple Silicon Mac（M 系列芯片）版本，不适用于 Intel Mac 或 Windows：

```text
WKU-Course-Assistant-0.1.12-arm64.dmg
```

1. 双击打开 DMG。
2. 把 `WKU Course Assistant` 拖入 `Applications`。
3. 从“应用程序”启动。更新旧版前先停止任务，并用 ⌘Q 完全退出旧 App。
4. 使用者在自己电脑的专用浏览器中登录自己的学校账号。首次保持演练开启，确认目标学期与余位读取正常后再运行真实任务。

当前安装包使用本机临时签名，但没有 Apple Developer 公证。首次打开如果 macOS 阻止运行，请在 Finder 中右键应用、选择“打开”，然后在确认窗口中再次选择“打开”。不要在无法确认下载来源时绕过系统安全提示。

安装版不需要另外安装 Node.js。浏览器登录数据、运行日志和截图存放在：

```text
~/Library/Application Support/wku-course-registration-assistant/
```

### 从源码运行

克隆仓库：

```bash
git clone https://github.com/17-chen/course-registration-assistant.git
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
3. 填写与学校页面一致的目标学期，使用日期和时间滚轮设置北京时间。
4. 点击“开始运行”。
5. 助手到点刷新 Schedule 页，自动恢复并确认目标学期，等待全局 `Register Now` 可用后提交一次，逐门汇总结果并结束。不会点击 `Remove Planned Courses` 或课程删除按钮。

更新后先打开演练模式，把时间设为一分钟后，检查刷新后能自动回到目标学期。演练不会注册课程。之后设置真实开放时间并关闭演练模式。学校页面结构变化导致识别失败时，助手会停止，需人工核对；请勿跳过这次演练。

固定时间模式不要求手动填写 Section，因为 `Register Now` 会处理当前 Plan 中的课程。开始前应确认 Plan 中没有不希望提交的课程。

### 退课空位监控

1. 把候选 Section 提前加入 Plan。
2. 选择“退课空位监控”。
3. 每行输入一个 Section Name，例如：

```text
CPS*2390*W03
CPS*2390*W04
```

4. 填写完整目标学期，例如 `Spring 2027 Wenzhou`，设置刷新间隔并点击“开始运行”。
5. 助手每次刷新后先恢复并确认目标学期，再读取余位；例如 Fall → Winter → Spring 会逐次识别并导航。无法确认学期或登录失效时停止，提交前再次校验学期。
6. 首次先保持演练模式，确认连续刷新后都能回到目标学期；确认后再停止并关闭演练模式重新启动真实监控。

每轮刷新后先恢复完整目标学期，再打开每个目标班次的 `Section Details` 读取最新的 `余位 / 容量 / 候补人数`，关闭详情后继续判断。无法确认学期、详情未加载、登录失效时不提交。不能假定静止页面会自动推送余位变化，因此保留刷新。

- `0/30/0`：等待；`1/30/0`：无候补排队且有余位，尝试注册。
- `0/30/5`：候补满员，等待；`1/30/5`：余位可能属于队首，不直接抢占，转为每 30 秒交替检查：仅重点班次 → 全部目标班次。重点约每 30 秒、其他班次约每 60 秒检查一次（另加学校加载与读取耗时）；若多个目标符合条件，按列表优先级选第一个重点。
- `0/30/4`：在启用“允许加入候补”且候补上限设为 5 时，尝试加入候补。上限是用户提供的规则，可调整，不是自动读取学校公布的容量。
- 已在候补中的班次不会重复加入；有余位且学校显示该班次可用的 Register 按钮时，才尝试注册。
- 加入候补只点击目标班次卡片里的 `Waitlist`，找不到、隐藏或禁用时不使用 `Register Now` 兜底，继续监控并在按钮可用后尝试。普通注册使用全局 `Register Now`，它可能处理 Plan 中其他课程，请开始前核对整个 Plan。已有候补但没有可用 Register 时不使用全局入口抢队首余位。
- 每个持续存在的机会只提交一次；再次观察到无机会后才重新布防。未知人数不会重新布防。提交后最多观察 60 秒，未确认则停止，请人工检查。
- 任一班次注册成功或确认加入候补后停止任务。`已加入候补` 与 `注册成功` 分开显示，加入候补不保证最终注册。

普通模式每轮检查全部课程后，等待用户设定的间隔，再刷新整页。发现队首余位后，重点关注模式每 30 秒刷新，交替读取重点一节与全部课程。全量轮发现重点时仍会继续检查剩余课程，避免遗漏机会；重点状态消失后恢复普通间隔，候补机会出现时立即尝试加入，演练期间也保持交替。详情弹窗逐个开关不是整页刷新。面板显示下一次刷新倒计时及本轮检查范围，运行中锁定间隔和演练开关，修改需先停止再启动。

普通点击、滚动网页不会触发停止；手动切换学期或关闭助手正在读取的详情弹窗，可能使学期或详情校验失败而停止。

面板逐门显示完整人数与判断原因。演练模式执行刷新、学期恢复、详情读取和判断，只截图并通知机会，绝不点击注册或候补按钮。发布前的 Chrome 本地模拟页测试不能替代更新后在学校实际页面的演练。

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

生成 Apple Silicon DMG：

```bash
npm run build:mac
```

输出位于 `dist/`，构建产物不会提交进 Git。

## 当前限制

- 最终成功率取决于学校服务器、开放规则、网络状态和同时竞争人数。
- 页面结构发生变化后，可能需要更新元素识别逻辑。
- Safari 自动化会话与日常 Safari 数据隔离。
- Edge 必须安装在标准的 `/Applications` 目录。
- 当前版本要求候选 Section 预先加入 Plan。

## 隐私

项目不会把账号、密码或 Cookie 上传到远程服务。`runtime/` 和 `logs/` 仅保存在本机，并已从 Git 跟踪中排除。提交问题或分享截图前，请自行移除姓名、学号和其他个人信息。
