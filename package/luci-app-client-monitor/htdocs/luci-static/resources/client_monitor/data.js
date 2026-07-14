'use strict';
'require baseclass';
'require rpc';

var callARP = rpc.declare({ object: 'luci', method: 'getARPTable', expect: { '': {} } });
var callLeases = rpc.declare({ object: 'luci', method: 'getDHCPLeases', expect: { '': {} } });
var callLeases6 = rpc.declare({ object: 'luci', method: 'getDHCPv6Leases', expect: { '': {} } });
var callHints = rpc.declare({ object: 'luci', method: 'getHostHints', expect: { '': {} } });
var callWireless = rpc.declare({ object: 'network.wireless', method: 'status', expect: { '': {} } });

function list(value) {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object')
		for (var key in value)
			if (Array.isArray(value[key])) return value[key];
	return [];
}

function mac(value) {
	return String(value || '').toLowerCase().replace(/-/g, ':');
}

function ip(value) {
	return value && String(value).replace(/\/\/.*/, '');
}

function addIP(client, value) {
	value = ip(value);
	if (value && client.ips.indexOf(value) < 0) client.ips.push(value);
}

function getClient(clients, value) {
	var key = mac(value);
	if (!key || key === '00:00:00:00:00:00') return null;
	return clients[key] || (clients[key] = { mac: key, ips: [], sources: [], online: false });
}

function addSource(client, value) {
	if (client.sources.indexOf(value) < 0) client.sources.push(value);
}

function collectWireless(clients, status) {
	Object.keys(status || {}).forEach(function(radio) {
		(status[radio].interfaces || []).forEach(function(iface) {
			var stations = iface.assoclist || {};
			Object.keys(stations).forEach(function(address) {
				var station = stations[address] || {}, client = getClient(clients, address);
				if (!client) return;
				client.online = true;
				client.interface = iface.ifname || iface.section || radio;
				client.wireless = {
					signal: station.signal,
					noise: station.noise,
					rx_rate: station.rx_rate,
					tx_rate: station.tx_rate,
					connected_time: station.connected_time,
					inactive: station.inactive
				};
				addSource(client, 'wifi');
			});
		});
	});
}

function collectLeases(clients, leases, isV6) {
	list(leases).forEach(function(lease) {
		var client = getClient(clients, lease.macaddr || lease.mac || lease.duid);
		if (!client) return;
		client.hostname = client.hostname || lease.hostname || lease.host || lease.name;
		client.leaseExpires = lease.expires || lease.expiry || client.leaseExpires;
		addIP(client, lease.ipaddr || lease.ip || lease.address);
		if (isV6 && Array.isArray(lease.ip6addrs)) lease.ip6addrs.forEach(function(v) { addIP(client, v); });
	});
}

function build(data) {
	var clients = {}, arp = list(data[0]), leases = data[1], leases6 = data[2], hints = data[3] || {}, wireless = data[4] || {};
	/* Some LuCI revisions wrap the host map in a `hints` member. */
	if (hints.hints && typeof hints.hints === 'object') hints = hints.hints;
	arp.forEach(function(entry) {
		var client = getClient(clients, entry.macaddr || entry.mac || entry.hwaddr);
		if (!client || String(entry.flags || '').toLowerCase() === '0x0') return;
		client.online = true;
		client.interface = client.interface || entry.device || entry.ifname || entry.interface;
		addIP(client, entry.ipaddr || entry.ip || entry.address);
		addSource(client, 'arp');
	});
	collectLeases(clients, leases, false);
	collectLeases(clients, leases6, true);
	Object.keys(hints).forEach(function(address) {
		var hint = hints[address] || {}, client = getClient(clients, address);
		if (!client) return;
		client.hostname = client.hostname || hint.name || hint.hostname;
		(hint.ipaddrs || []).forEach(function(value) { addIP(client, value); });
	});
	collectWireless(clients, wireless);
	return Object.keys(clients).map(function(key) { return clients[key]; }).filter(function(client) { return client.online; }).sort(function(a, b) {
		return (a.hostname || a.ips[0] || a.mac).localeCompare(b.hostname || b.ips[0] || b.mac);
	});
}

return baseclass.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callARP(), {}),
			L.resolveDefault(callLeases(), {}),
			L.resolveDefault(callLeases6(), {}),
			L.resolveDefault(callHints(), {}),
			L.resolveDefault(callWireless(), {})
		]).then(build);
	},

	rate: function(rate) {
		if (!rate) return '-';
		var value = rate.rate || rate, unit = rate.rate ? ' Mbit/s' : '';
		return String(value) + unit;
	},

	duration: function(seconds) {
		seconds = Number(seconds);
		if (!isFinite(seconds) || seconds < 0) return '-';
		var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
		return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + s + 's';
	}
});
