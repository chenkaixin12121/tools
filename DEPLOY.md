# 部署到 GitHub Pages + 自定义子域名

本项目是纯静态站点（HTML/CSS/JS，无构建步骤），所有本地资源用相对路径引用，
外部库走 CDN，因此不需要为部署修改任何业务代码。

推送到 `main` 分支后由 `.github/workflows/deploy.yml` 自动发布。

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
git add .github/workflows/deploy.yml CNAME .nojekyll DEPLOY.md

git commit -m "chore: 初始化开发者工具箱并配置 Pages 自动部署"

# 默认分支名改成 main，与 workflow 的触发分支一致
git branch -M main

# 换成你自己的用户名
git remote add origin https://github.com/<你的用户名>/tools.git

git push -u origin main
```

如果推送时提示要认证，用 GitHub 的 Personal Access Token 当密码
（Settings → Developer settings → Personal access tokens，勾 `repo` 权限），
账户密码在 2021 年之后已经不能用于 git 推送了。

## 第 3 步：把 Pages 的来源切成 Actions

仓库页面 → Settings → Pages → Build and deployment → Source
选择 **GitHub Actions**（不是 Deploy from a branch）。

这一步必须做，否则 workflow 跑到发布环节会因为 Pages 未启用而失败。

切换后回到 Actions 标签页，应该能看到一次正在跑的 Deploy to GitHub Pages。
首次部署通常 1 分钟内完成。跑完后先用 GitHub 给的默认地址确认站点本身没问题：

```
https://<你的用户名>.github.io/tools/
```

## 第 4 步：在域名服务商配置 DNS

登录你域名所在的服务商（Cloudflare / 阿里云 / 腾讯云 / Namecheap 等），
添加一条 **CNAME 记录**：

| 字段 | 填什么 |
| --- | --- |
| 记录类型 | CNAME |
| 主机记录 / Name | `tools`（只填子域名前缀，不是完整域名） |
| 记录值 / Target | `<你的用户名>.github.io`（结尾没有斜杠，不带仓库名） |
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

返回里出现 `<你的用户名>.github.io` 就说明解析已经生效。
DNS 传播一般几分钟到半小时，个别服务商会更久。

## 第 5 步：在 GitHub 填入自定义域名并开启 HTTPS

Settings → Pages → Custom domain，填入 `tools.yourdomain.com`，点 Save。

GitHub 会做一次 DNS 校验，通过后下面会出现绿色的对勾。
如果提示 "Domain does not resolve to the GitHub Pages server"，
说明 DNS 还没传播完，等一会儿点 Save 重试即可。

校验通过后，等 **Enforce HTTPS** 的复选框变成可勾选状态（证书签发通常几分钟，
偶尔要等上一小时），勾上它，让 http 访问自动跳转到 https。

注意这里和 `CNAME` 文件的关系：网页端保存自定义域名时，GitHub 会往仓库里提交一个
`CNAME` 文件。我们已经预先放好这个文件，所以两边内容必须一致，
否则后续 Actions 部署会用仓库里的旧值把网页端的设置覆盖掉。
如果你在网页端填了一个不同的域名，记得把仓库里的 `CNAME` 同步改掉。

---

## 完成后的日常流程

改完代码推送即可，剩下的自动完成：

```bash
git add -A
git commit -m "描述这次改动"
git push
```

Actions 标签页能看到部署进度，绿勾之后刷新站点就是新版本。
浏览器有缓存时用 Ctrl+F5 强刷。

## 排错对照表

| 现象 | 原因与处理 |
| --- | --- |
| workflow 报 "Pages site not found" 或发布步骤失败 | 第 3 步没做，Source 仍是 Deploy from a branch |
| 站点能开但样式全丢 | 检查 `CNAME` 内容是否写成了带 `https://` 或带路径的形式 |
| 自定义域名一直转圈 / 502 | Cloudflare 代理开着，先切回 DNS only |
| 域名校验过不了 | CNAME 记录值误填成了 `用户名.github.io/tools`，不能带仓库名 |
| Enforce HTTPS 灰着点不动 | 证书还在签发，等待即可，不用反复改设置 |
| 推送后线上没更新 | 看 Actions 是否失败；确认推的是 `main` 分支 |

## 一点补充说明

`.nojekyll` 是保险文件。当前用 Actions 上传产物的方式部署不会经过 Jekyll，
所以它此刻不起作用；但如果哪天改回从分支部署，它能防止 Jekyll 忽略下划线开头的文件。

workflow 里的 action 版本钉在 `checkout@v4` / `configure-pages@v5` /
`upload-pages-artifact@v3` / `deploy-pages@v4`。这套组合稳定可用。
`deploy-pages` 已有更高的大版本，但我没有核实其当前稳定性，
需要升级时请自行到 [actions/deploy-pages](https://github.com/actions/deploy-pages)
的 Releases 页面确认后再改。

