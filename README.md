# opc-xaxy-event

雄安星火科技馆 × OPC × 星猿科技活动报名系统。

## 功能

- 手机申请页：项目、资源需求、来源渠道、授权选项。
- 私密查询链接：查看审核结果、确认出席；数据库仅存查询凭证哈希。
- 管理后台：搜索筛选、通过/候补/拒绝、内部备注、通知记录、签到、CSV导出。
- 活动设置：标题、时间、地点和联系方式、录取名额、报名开关。
- 服务端保护：Cloudflare Access JWT签名/受众/有效期/管理员邮箱校验，Turnstile服务端校验，限流、同源写入、参数化SQL、原子名额检查。

生产环境默认关闭报名，且认证配置缺失时后台拒绝访问。日期、地址和联系渠道确认后再开放。

## 本地体验

需要 Node.js 22.13 或更新版本。不需要安装依赖即可运行本地演示和测试：

```sh
node scripts/preview.mjs
node --test
```

打开 http://127.0.0.1:8787 和 http://127.0.0.1:8787/admin 。演示使用内存SQLite，停止即清空，仅监听本机。仅此演示适配器注入布尔型 `LOCAL_PREVIEW` 绕过本机认证和防刷；不要在生产环境配置这个变量。

Cloudflare本地开发：`npm install`、`npm run db:local`、`npm run dev`。Wrangler开发不会绕过Access或Turnstile。

## Cloudflare部署

详见 [部署指南](docs/DEPLOY.md)。代码已具备真实接口，部署需要你自己的D1数据库、Access应用和Turnstile配置。

## 页面与接口

- `/`：报名；`/status#随机凭证`：查询与出席确认。
- `/admin`：管理。直接访问`/admin.html`被拒绝。
- `/api/admin/*`：所有管理接口均需Access认证。
- 数据表：`events`、`applications`、`audit_log`、`rate_limits`。

首版不自动发送微信、短信、邮件；后台生成文案后由主办方发送。查询链接只在提交成功时返回，后台无法恢复；遗失时联系主办方人工处理。暂不提供付费、文件上传或AI评分。

报名数据清理计划在活动后90天内由主办方执行，当前未启用自动清理。导出名单含联系方式，请限定使用范围。

## 图标

界面图标路径来自 Lucide，见 [图标许可证](LICENSE-ICONS)。
