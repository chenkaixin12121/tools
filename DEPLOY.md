# 部署到 GitHub Pages + 自定义子域名

本项目是纯静态站点（HTML/CSS/JS，无构建步骤），所有本地资源用相对路径引用，
外部库走 CDN，因此不需要为部署修改任何业务代码。

部署方式采用 **从分支直接发布**：GitHub Pages 直接读取 `main` 分支根目录的文件，
推送即生效，不需要 CI 流程。没有构建步骤的项目用不上 GitHub Actions，
省掉 workflow 也就省掉了 action 版本维护。

---

## 第 0 步：先改掉 CNAME 占位符

仓库根目录的 `CNAME` 现在是占位内容，**必须**换成你的真实子域名，否则域名不会生效：

```
tools.example.com
```

改成例如 `tools.yourdomain.com`。注意三点：

- 只写域名本身，不要写 `https://`，不要写结尾斜杠
- 整个文件只有一行
- 文件名是全大写的 `CNAME`，没有扩展名

## 第 1 步：在 GitHub 上建仓库

在 GitHub 网页端 New repository，填写：

- Repository name：`tools`
- 可见性：Public（免费账户的私有仓库无法启用 Pages，需要 GitHub Pro）
- **不要**勾选 Add a README / .gitignore / license，本地已经有了，勾了会造成首次推送冲突

建完先不要关页面，下一步要用到它给出的仓库地址。

## 第 2 步：本地提交并推送

当前仓库已 `git init`，但还没有任何 commit，也没有配置 remote。在项目目录执行：

```bash
# 文件已在暂存区，确认一下都在
git status --short

# 补充新增的部署文件
git add CNAME .nojekyll DEPLOY.md README.md

git commit -m "chore: 初始化开发者工具箱并配置 Pages 部署"

# Pages 从 main 分支发布，先把默认分支名改过来
git branch -M main

git remote add origin https://github.com/chenkaixin12121/tools.git

git push -u origin main
```

如果推送时提示要认证，用 GitHub 的 Personal Access Token 当密码
（Settings → Developer settings → Personal access tokens，勾 `repo` 权限），
账户密码在 2021 年之后已经不能用于 git 推送了。

## 第 3 步：开启 Pages，来源选分支

仓库页面 → Settings → Pages → Build and deployment：

- Source 选 **Deploy from a branch**
- Branch 选 `main`，目录选 `/ (root)`
- 点 Save

保存后 GitHub 立刻开始发布，首次通常一两分钟。仓库首页右侧的 Deployments，
或 Settings → Pages 顶部的提示条，都能看到进度和最终地址。

先用 GitHub 给的默认地址确认站点本身没问题：

```
https://chenkaixin12121.github.io/tools/
```

## 第 4 步：在域名服务商配置 DNS

登录你域名所在的服务商（Cloudflare / 阿里云 / 腾讯云 / Namecheap 等），
添加一条 **CNAME 记录**：

| 字段 | 填什么 |
| --- | --- |
| 记录类型 | CNAME |
| 主机记录 / Name | `tools`（只填子域名前缀，不是完整域名） |
| 记录值 / Target | `chenkaixin12121.github.io`（结尾没有斜杠，不带仓库名） |
| TTL | 默认值即可，或填 600 |

子域名接入只需要这一条记录。顶级域名（`example.com` 这种）才需要配 4 条 A 记录，
本项目用的是子域名方案，不涉及。

用 Cloudflare 的话，代理状态（那朵橙色云）建议先设成 **DNS only**（灰色）。
开着代理会让 GitHub 无法完成域名验证，证书签发容易卡住；等 HTTPS 正常之后再决定是否开启。

验证 DNS 是否生效：

```bash
dig tools.yourdomain.com +short
# 或
nslookup tools.yourdomain.com
```

返回里出现 `chenkaixin12121.github.io` 就说明解析已经生效。
DNS 传播一般几分钟到半小时，个别服务商会更久。

### 如果账户下已经有别的域名指向 github.io

不冲突。只要主机名不同（比如已有的是 `yourdomain.com` 或 `www.yourdomain.com`，
这次新加的是 `tools.yourdomain.com`），DNS 层面是两条独立记录，
GitHub 侧也是各仓库分别配置自定义域名，互不影响。

但要注意一个级联行为：如果那个域名配在 **`chenkaixin12121.github.io` 仓库**（用户主站）的
Pages 设置里，它会作用于该账户下所有没有单独配域名的项目站点。
表现是第 3 步验证用的 `chenkaixin12121.github.io/tools/` 会跳转到 `yourdomain.com/tools/`，
这属于正常现象，不是部署失败。等本仓库配好 `tools.yourdomain.com` 之后，
项目自己的域名优先，站点就从该子域名提供服务。

唯一真正会报错的情况是同一个主机名已被另一个仓库占用 ——
一个域名同时只能绑一个仓库，占用时第 5 步保存会提示域名已被使用。
配置前确认这个子域名没写进其他仓库的 CNAME 文件即可。

## 第 5 步：在 GitHub 填入自定义域名并开启 HTTPS

Settings → Pages → Custom domain，填入 `tools.yourdomain.com`，点 Save。

GitHub 会做一次 DNS 校验，通过后下面会出现绿色的对勾。
如果提示 "Domain does not resolve to the GitHub Pages server"，
说明 DNS 还没传播完，等一会儿点 Save 重试即可。

校验通过后，等 **Enforce HTTPS** 的复选框变成可勾选状态（证书签发通常几分钟，
偶尔要等上一小时），勾上它，让 http 访问自动跳转到 https。

注意这里和 `CNAME` 文件的关系：网页端保存自定义域名时，GitHub 会往仓库里提交一个
`CNAME` 文件。我们已经预先放好这个文件，所以两边内容必须一致，
否则下次推送会用仓库里的旧值把网页端的设置覆盖掉。
如果你在网页端填了一个不同的域名，记得把仓库里的 `CNAME` 同步改掉。

---

## 完成后的日常流程

改完代码推送即可，剩下的自动完成：

```bash
git add -A
git commit -m "描述这次改动"
git push
```

推完等十几秒到一分钟就会生效，仓库首页右侧 Deployments 能看到状态。
浏览器有缓存时用 Ctrl+F5 强刷。

## 排错对照表

| 现象 | 原因与处理 |
| --- | --- |
| 访问返回 404 | Pages 还没开启，或 Branch/目录选错（要 `main` + `/ (root)`） |
| 站点能开但样式全丢 | 检查 `CNAME` 内容是否写成了带 `https://` 或带路径的形式 |
| 自定义域名一直转圈 / 502 | Cloudflare 代理开着，先切回 DNS only |
| 域名校验过不了 | CNAME 记录值误填成了 `用户名.github.io/tools`，不能带仓库名 |
| Enforce HTTPS 灰着点不动 | 证书还在签发，等待即可，不用反复改设置 |
| 推送后线上没更新 | 确认推的是 `main` 分支；看 Deployments 里最新一次的状态 |

## 关于 .nojekyll

从分支部署会经过 Jekyll，`.nojekyll` 的作用是让 Pages 跳过这一步，直接按原样提供文件。
保留它有两个好处：发布更快，以及避免 Jekyll 把 `README.md`、`DEPLOY.md`
这类 markdown 文件额外转换成 HTML 页面。

本项目代码里没有 `{{` 或 `{%` 这类 Liquid 语法（已确认），
所以即使经过 Jekyll 也不会被破坏，但跳过更省事。

## 为什么不用 GitHub Actions

这个项目没有构建步骤，workflow 能做的事情就是把仓库原样搬到 Pages，
而分支部署本身就是这个行为。多一层 CI 只会多出 action 版本维护的负担，
没有换来任何东西。将来如果引入打包、压缩或测试环节，再加 workflow 才有意义。

