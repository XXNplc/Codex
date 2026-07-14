# LuCI 客户端监控（Argon 适配）

本软件包用于 ImmortalWrt 25.12.1 本地编译。它不使用云端或第三方服务，只读取路由器已有的 ARP 邻居表、DHCP 租约、主机提示和无线关联表。

## 在线判断

- 有线/普通 LAN：存在有效 ARP 邻居记录才显示为在线；
- 无线终端：仍在 AP 关联表中才显示为在线；
- DHCP 租约本身不视作在线，因此不会把已经离线的旧租约误报为在线。

显示主机名、IP、MAC、接口、连接类型；无线终端还会显示信号、连接时长和 TX/RX 速率。页面每 10 秒刷新一次，并以不覆盖 Argon 的中性色变量制作响应式卡片布局。

## 加入固件

将本目录复制到源码树：

```sh
cp -a luci-app-client-monitor /path/to/immortalwrt/package/
make menuconfig
```

在 `LuCI -> 3. Applications -> LuCI client monitor` 选为 `[*]`，再正常编译。只编译此包可运行：

```sh
make package/luci-app-client-monitor/compile V=s
```

安装后的入口为 `状态 -> Client Monitor`。同时会尝试把“Online Clients”卡片加入状态概览（取决于固件中 `luci-mod-status` 的概览扩展加载机制）。
