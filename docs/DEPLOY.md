# Cloudflare部署：一步一步

## 1. 创建D1数据库

Cloudflare控制台搜索 D1，创建数据库 `opc-xaxy-event`。复制 Database ID，在仓库 `wrangler.jsonc` 中替换 `REPLACE_WITH_D1_DATABASE_ID`。

在数据库控制台执行 `migrations/0001_initial.sql` 的全部SQL；或在已登录Wrangler的本机运行：

```sh
npm install
npx wrangler login
npm run db:remote
```

初始化只运行一次；后续提交代码不会重建数据库。

## 2. 从GitHub部署Worker

进入 Workers & Pages，创建/导入Git仓库，选择 `liubindxy/opc-xaxy-event`，生产分支 `main`，根目录为仓库根目录。

- Build command: `npm test`
- Deploy command: `npx wrangler deploy`
- Node version: 24（测试使用Node内置SQLite，至少22.13）

确认Worker名称与配置均为 `opc-xaxy-event`，数据库ID正确。成功后检查D1 binding名称为 `DB`。使用Git集成自带的构建授权；不要把API Token写入仓库。

## 3. 配置后台Cloudflare Access

优先绑定你控制的域名。创建 Access 的 Self-hosted应用，仅保护两个路径：

- `你的域名/admin*`
- `你的域名/api/admin*`

同一应用可添加这两个路径，使用同一Application AUD。Allow策略只允许实际管理员邮箱，推荐邮箱一次性验证码或已有身份提供方。不要保护整个报名站点，访客需要公开报名。

将以下非密钥配置填入 `wrangler.jsonc` 的vars并提交（不希望公开邮箱时，可用Wrangler secret设置ADMIN_EMAILS，并从vars移除同名字段）：

- `ACCESS_TEAM_DOMAIN`: 如 `your-team.cloudflareaccess.com`，不带 https:// 或尾部斜杠。
- `ACCESS_AUD`: Access应用的Application Audience值。
- `ADMIN_EMAILS`: 允许的管理员邮箱，多个用逗号分隔。

若使用 `workers.dev`，需确认你的账号支持相应路径保护；推荐自定义域名。禁用无需使用的默认域名/预览入口。即使其他入口仍可访问，Worker本身也会校验管理JWT，未授权无法读取数据。

## 4. 配置Turnstile

在Turnstile创建Managed widget，加入实际报名域名。Site Key写入 `TURNSTILE_SITE_KEY` 并提交；Secret Key必须通过Worker secret配置，不能写入代码。

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY
```

也可在Worker设置中添加同名Secret。Git部署时不要用空值覆盖此Secret。添加备用域名时同步更新widget允许的hostname。

## 5. 正式开放

登录 `/admin`，进入活动设置，补全时间、地址和可用主办方联系方式，检查名额20。全部配置完成后勾选开放报名。

先用测试信息走通：申请→保存查询链接→后台审核→查询通过→确认出席→后台签到→导出CSV。

用未登录/非管理员浏览器确认 `/admin` 和管理接口不能访问。用微信内置浏览器及移动网络验证报名与Turnstile可用。未完成此测试前，不印刷海报二维码。

二维码应编码固定活动网址，如 `https://你的域名/?source=poster`，不要编码后台地址或私密查询链接。确保长期控制域名，再生成海报二维码。

## 数据维护

活动后关闭报名，导出必要记录。处理数据删除请求时，通过D1控制台按申请编号删除对应申请及日志。需备份/更改数据库前先确认操作范围。当前首版无自动消息发送、无找回凭证、无自动90天清理。

## 官方文档

- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
