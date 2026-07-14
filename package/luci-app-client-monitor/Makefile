include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-client-monitor
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-client-monitor
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI client monitor
  DEPENDS:=+luci-base +luci-mod-status +rpcd-mod-luci
  PKGARCH:=all
endef

define Package/luci-app-client-monitor/description
Accurate local-network client monitor for the LuCI status overview.
endef

LUCI_TITLE:=LuCI client monitor
LUCI_DEPENDS:=+luci-base +luci-mod-status +rpcd-mod-luci
LUCI_PKGARCH:=all

$(eval $(call BuildPackage,luci-app-client-monitor))
