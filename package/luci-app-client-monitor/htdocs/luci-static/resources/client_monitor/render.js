'use strict';

var style = '.client-monitor{--cm-accent:#5e72e4;--cm-good:#2dce89;--cm-muted:#8898aa}.client-monitor .cm-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px}.client-monitor .cm-count{background:var(--cm-accent);color:#fff;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:700}.client-monitor .cm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.client-monitor .cm-card{background:var(--background-color-high,#fff);border:1px solid var(--border-color-medium,#e9ecef);border-radius:10px;padding:15px;box-shadow:0 3px 10px rgba(50,50,93,.06)}.client-monitor .cm-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;overflow:hidden}.client-monitor .cm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.client-monitor .cm-dot{width:8px;height:8px;border-radius:50%;background:var(--cm-good);box-shadow:0 0 0 4px rgba(45,206,137,.15);flex:none}.client-monitor .cm-meta{display:grid;grid-template-columns:76px 1fr;gap:5px 8px;margin-top:12px;font-size:12px;line-height:1.45}.client-monitor .cm-label{color:var(--cm-muted)}.client-monitor .cm-value{overflow-wrap:anywhere}.client-monitor .cm-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.client-monitor .cm-tag{font-size:11px;padding:3px 7px;border-radius:99px;background:rgba(94,114,228,.12);color:var(--cm-accent)}.client-monitor .cm-empty{color:var(--cm-muted);padding:20px;text-align:center}';

function value(v) { return (v == null || v === '') ? '-' : String(v); }

function rate(rate) {
	if (!rate) return '-';
	var value = rate.rate || rate, unit = rate.rate ? ' Mbit/s' : '';
	return String(value) + unit;
}

function duration(seconds) {
	seconds = Number(seconds);
	if (!isFinite(seconds) || seconds < 0) return '-';
	var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
	return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + s + 's';
}

function label(name, content) {
	return [E('span', { 'class': 'cm-label' }, name), E('span', { 'class': 'cm-value' }, value(content))];
}

function quality(client) {
	if (!client.wireless) return null;
	var signal = client.wireless.signal, noise = client.wireless.noise;
	return signal != null ? '%d dBm%s'.format(signal, noise != null ? ' / ' + noise + ' dBm' : '') : '-';
}

function card(client) {
	var type = client.wireless ? _('Wi-Fi') : _('Wired / ARP');
	var fields = [].concat(label(_('Address'), client.ips.join(', ')), label(_('MAC'), client.mac), label(_('Interface'), client.interface), label(_('Type'), type));
	if (client.wireless) fields = fields.concat(label(_('Signal'), quality(client)), label(_('Connected'), duration(client.wireless.connected_time)), label(_('TX / RX'), rate(client.wireless.tx_rate) + ' / ' + rate(client.wireless.rx_rate)));
	return E('div', { 'class': 'cm-card' }, [
		E('div', { 'class': 'cm-title' }, [E('i', { 'class': 'cm-dot' }), E('span', { 'class': 'cm-name' }, value(client.hostname || _('Unknown device')))]),
		E('div', { 'class': 'cm-meta' }, fields),
		E('div', { 'class': 'cm-tags' }, client.sources.map(function(source) { return E('span', { 'class': 'cm-tag' }, source.toUpperCase()); }))
	]);
}

function render(clients, detail) {
	return E('div', { 'class': 'client-monitor' }, [
		E('style', {}, style),
		E('div', { 'class': 'cm-head' }, [E('div', {}, detail ? _('Live local-network clients') : _('Online clients')), E('span', { 'class': 'cm-count' }, _('Online: %d').format(clients.length))]),
		clients.length ? E('div', { 'class': 'cm-grid' }, clients.map(card)) : E('div', { 'class': 'cm-empty' }, _('No confirmed online clients were found.'))
	]);
}

return { render: render, rate: rate, duration: duration };
