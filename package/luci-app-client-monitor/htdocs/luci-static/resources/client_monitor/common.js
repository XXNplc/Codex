'use strict';
'require baseclass';
'require dom';
'require poll';
'require fs';
'require rpc';

var callWireless = rpc.declare({
	object: 'network.wireless',
	method: 'status',
	expect: { '': {} }
});

var pingCache = {};
var PING_CACHE_TTL = 120000;
var POLL_INTERVAL = 60000;

var style = [
	'.cm-wrap{padding:0 0 18px;display:flex;flex-direction:column;gap:12px}',
	'.cm-panel{border:1px solid rgba(255,255,255,.12);border-radius:2px;overflow:hidden;background:rgba(255,255,255,.03)}',
	'.cm-table{width:100%;border-collapse:collapse;table-layout:fixed}',
	'.cm-table th,.cm-table td{padding:11px 12px;font-size:12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
	'.cm-table th{background:rgba(255,255,255,.05);font-weight:700;color:#c9d1d9}',
	'.cm-table tr:hover td{background:rgba(255,255,255,.02)}',
	'.cm-state-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle;flex:none}',
	'.cm-online{color:#6ee7a2;font-weight:700}',
	'.cm-empty{padding:16px 10px;color:#9aa0a6;text-align:center}',
	'.cm-faint{color:#9aa0a6}',
	'.cm-mono{font-variant-numeric:tabular-nums}'
].join('');

function asList(value) {
	if (Array.isArray(value))
		return value;

	if (value && typeof value === 'object')
		return Object.keys(value).map(function(key) {
			return value[key];
		});

	return [];
}

function normalizeMac(value) {
	return String(value || '').toLowerCase().replace(/-/g, ':').trim();
}

function normalizeIp(value) {
	return String(value || '').trim();
}

function isIp(value) {
	return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || ''));
}

function ipToNum(ip) {
	return String(ip || '0.0.0.0').split('.').reduce(function(acc, part) {
		return ((acc << 8) + (Number(part) || 0)) >>> 0;
	}, 0) >>> 0;
}

function parseArp(text) {
	return String(text || '').trim().split(/\r?\n/).filter(function(line) {
		return line && line.indexOf('IP address') !== 0;
	}).map(function(line) {
		var cols = line.trim().split(/\s+/);
		if (cols.length < 6)
			return null;

		return {
			ipaddr: cols[0],
			macaddr: cols[3],
			device: cols[5],
			flags: cols[2]
		};
	}).filter(Boolean);
}

function parseNeighbor(text) {
	return String(text || '').trim().split(/\r?\n/).filter(Boolean).map(function(line) {
		var cols = line.trim().split(/\s+/);
		var entry = {
			ipaddr: cols[0] || '',
			device: '',
			macaddr: '',
			state: ''
		};

		for (var i = 1; i < cols.length; i++) {
			if (cols[i] === 'dev' && cols[i + 1])
				entry.device = cols[++i];
			else if (cols[i] === 'lladdr' && cols[i + 1])
				entry.macaddr = cols[++i];
		}

		entry.state = String(cols[cols.length - 1] || '').toUpperCase();
		return entry.ipaddr ? entry : null;
	}).filter(Boolean);
}

function neighborScore(state) {
	state = String(state || '').toUpperCase();

	if (state === 'REACHABLE' || state === 'DELAY' || state === 'PROBE' || state === 'PERMANENT')
		return 2;

	if (state === 'STALE' || state === 'NOARP')
		return 1;

	return 0;
}

function arpScore(flags) {
	flags = String(flags || '').toUpperCase();

	if (flags === 'FAILED' || flags === 'INCOMPLETE' || flags === 'NONE' || flags === '0X0')
		return 0;

	return 2;
}

function getClient(map, key) {
	var raw = String(key || '');
	var mac = normalizeMac(raw);
	var ip = isIp(raw) ? raw : '';
	var id = mac && mac !== '00:00:00:00:00:00' ? mac : ip;

	if (!id)
		return null;

	return map[id] || (map[id] = {
		id: id,
		mac: mac || id,
		ips: [],
		interface: '',
		online: false,
		tentative: false,
		confirmed: false,
		arp_state: '',
		arp_score: 0,
		wireless: null,
		ping: '-'
	});
}

function addIp(client, ip) {
	ip = normalizeIp(ip);
	if (ip && client.ips.indexOf(ip) < 0)
		client.ips.push(ip);
}

function getPrimaryIp(client) {
	for (var i = 0; i < client.ips.length; i++) {
		if (isIp(client.ips[i]))
			return client.ips[i];
	}
	return client.ips[0] || '';
}

function collectArp(map, rows) {
	asList(rows).forEach(function(entry) {
		var client = getClient(map, entry.macaddr || entry.ipaddr);
		if (!client)
			return;

		var state = String(entry.flags || '').toUpperCase();
		client.arp_state = state;
		client.arp_score = arpScore(state);
		client.interface = client.interface || entry.device || '';
		addIp(client, entry.ipaddr);

		if (client.arp_score >= 2) {
			client.online = true;
			client.confirmed = true;
			client.tentative = false;
		}
		else if (client.arp_score === 1 && !client.online) {
			client.tentative = true;
		}
	});
}

function collectNeighbors(map, rows) {
	asList(rows).forEach(function(entry) {
		var client = getClient(map, entry.macaddr || entry.ipaddr || entry.ip || entry.address);
		if (!client)
			return;

		client.arp_state = String(entry.state || '').toUpperCase();
		client.arp_score = neighborScore(client.arp_state);
		client.interface = client.interface || entry.device || '';
		addIp(client, entry.ipaddr || entry.ip || entry.address);

		if (entry.macaddr)
			client.mac = normalizeMac(entry.macaddr);

		if (client.arp_score >= 2) {
			client.online = true;
			client.confirmed = true;
			client.tentative = false;
		}
		else if (client.arp_score === 1 && !client.online) {
			client.tentative = true;
		}
	});
}

function collectWireless(map, status) {
	Object.keys(status || {}).forEach(function(radio) {
		asList(status[radio].interfaces).forEach(function(iface) {
			var stations = iface.assoclist || {};

			Object.keys(stations).forEach(function(mac) {
				var station = stations[mac] || {};
				var client = getClient(map, mac);
				if (!client)
					return;

				client.online = true;
				client.confirmed = true;
				client.tentative = false;
				client.interface = client.interface || iface.ifname || iface.network || '';
				client.wireless = {
					signal: station.signal,
					noise: station.noise,
					rx_rate: station.rx_rate,
					tx_rate: station.tx_rate,
					connected_time: station.connected_time
				};
			});
		});
	});
}

function buildList(neighRows, arpRows, wireless) {
	var map = {};

	if (neighRows && neighRows.length)
		collectNeighbors(map, neighRows);
	else if (arpRows && arpRows.length)
		collectArp(map, arpRows);

	collectWireless(map, wireless);

	return Object.keys(map).map(function(k) {
		return map[k];
	}).filter(function(client) {
		return client.online || client.tentative || client.wireless;
	}).sort(function(a, b) {
		var ai = getPrimaryIp(a);
		var bi = getPrimaryIp(b);
		var na = isIp(ai) ? ipToNum(ai) : 0xffffffff;
		var nb = isIp(bi) ? ipToNum(bi) : 0xffffffff;

		if (na !== nb)
			return na - nb;

		return String(ai || a.mac || '').localeCompare(String(bi || b.mac || ''));
	});
}

function pingCacheKey(client) {
	return getPrimaryIp(client) || normalizeMac(client.mac) || client.id || '';
}

function pingCacheFresh(key) {
	var entry = pingCache[key];
	return entry && (Date.now() - entry.ts) < PING_CACHE_TTL ? entry : null;
}

function shouldProbePing(client) {
	var ip = getPrimaryIp(client);
	if (!ip)
		return false;

	if (client.tentative)
		return true;

	return !pingCacheFresh(pingCacheKey(client));
}

function formatPing(value) {
	value = Number(value);
	if (!isFinite(value) || value < 0)
		return '-';
	return value.toFixed(1) + ' ms';
}

function probePing(client) {
	var ip = getPrimaryIp(client);
	if (!ip || (!client.online && !client.tentative))
		return Promise.resolve(client);

	var key = pingCacheKey(client);
	var cached = pingCacheFresh(key);

	if (cached && !client.tentative) {
		client.ping = cached.value;
		return Promise.resolve(client);
	}

	var args = ['-c', '1', '-W', '1', ip];
	if (ip.indexOf(':') >= 0)
		args.unshift('-6');

	return Promise.resolve(fs.exec('/bin/ping', args)).then(function(res) {
		var out = String((res && res.stdout) || '');
		var rtt = out.match(/= [^\/]+\/([\d.]+)\//);
		client.ping = rtt ? formatPing(rtt[1]) : '-';
		pingCache[key] = {
			value: client.ping,
			ts: Date.now()
		};

		if (!client.online && client.tentative) {
			client.online = true;
			client.confirmed = true;
			client.tentative = false;
		}

		return client;
	}, function() {
		client.ping = '-';
		pingCache[key] = {
			value: client.ping,
			ts: Date.now()
		};
		return client;
	});
}

function loadSources() {
	return Promise.all([
		L.resolveDefault(fs.exec('/sbin/ip', ['-o', 'neigh', 'show']), null),
		L.resolveDefault(fs.read('/proc/net/arp'), ''),
		L.resolveDefault(callWireless(), {})
	]).then(function(data) {
		return {
			neigh: parseNeighbor(data[0] && data[0].stdout ? data[0].stdout : ''),
			arp: parseArp(data[1]),
			wireless: data[2]
		};
	});
}

function loadPageData() {
	return loadSources();
}

function isEditing(root) {
	var ae = document.activeElement;
	return !!(ae && root && root.contains(ae) && /^(INPUT|TEXTAREA)$/i.test(ae.tagName));
}

function createRow(client) {
	return E('tr', {}, [
		E('td', {}, [
			E('span', {
				'class': 'cm-state-dot',
				'style': 'background:#1f8f4e;box-shadow:0 0 0 4px rgba(31,143,78,.18)'
			}),
			E('span', { 'class': 'cm-mono' }, getPrimaryIp(client) || '-')
		]),
		E('td', { 'class': 'cm-mono' }, client.mac || '-'),
		E('td', {}, client.interface || '-'),
		E('td', {}, E('span', { 'class': 'cm-online' }, '\u5728\u7ebf')),
		E('td', { 'class': 'cm-mono' }, client.ping || '-')
	]);
}

function renderTable(list) {
	return E('table', { 'class': 'cm-table' }, [
		E('thead', {}, E('tr', {}, [
			E('th', {}, 'IPv4 \u5730\u5740'),
			E('th', {}, 'MAC \u5730\u5740'),
			E('th', {}, '\u63a5\u53e3'),
			E('th', {}, '\u72b6\u6001'),
			E('th', {}, 'Ping')
		])),
		E('tbody', {}, list.length ? list.map(createRow) : E('tr', {}, E('td', { colspan: '5', 'class': 'cm-empty' }, '\u5f53\u524d\u6ca1\u6709\u5728\u7ebf\u8bbe\u5907')))
	]);
}

function createPage(options) {
	options = options || {};
	var refreshSeq = 0;

	return {
		title: options.title || '\u5728\u7ebf\u8bbe\u5907',

		load: function() {
			return loadPageData();
		},

		render: function(data) {
			var sources = data && (data.neigh || data.arp) ? data : { neigh: [], arp: [], wireless: {} };
			var root = E('div', { 'class': 'cm-wrap' }, [
				E('style', {}, style),
				E('div', { 'class': 'cm-faint' }, '\u6b63\u5728\u52a0\u8f7d...')
			]);

			function paint(list) {
				hydratePingCache(list);

				var onlineList = list.filter(function(client) {
					return client.online;
				});

				dom.content(root, E('div', { 'class': 'cm-wrap' }, [
					E('style', {}, style),
					E('div', { 'class': 'cm-panel' }, [
						renderTable(onlineList)
					])
				]));
			}

			function refresh() {
				if (isEditing(root))
					return Promise.resolve();

				var seq = ++refreshSeq;

				return loadSources().then(function(nextSources) {
					if (seq !== refreshSeq)
						return;

					sources = nextSources;

					var list = buildList(sources.neigh, sources.arp, sources.wireless);
					paint(list);

					return Promise.all(list.filter(shouldProbePing).map(probePing)).then(function() {
						if (seq === refreshSeq)
							paint(list);
					});
				});
			}

			var initial = buildList(sources.neigh, sources.arp, sources.wireless);
			paint(initial);
			refresh();
			poll.add(refresh, POLL_INTERVAL);

			return root;
		}
	};
}

return baseclass.extend({
	loadData: loadPageData,
	createPage: createPage
});
