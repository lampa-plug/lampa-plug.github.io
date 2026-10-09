/* Kino.pub for Lampa — initial port of quarckster/kodi.kino.pub.
 * Copyright (c) 2018, Dmitry Misharov. BSD-3-Clause; see LICENSE.
 * Public upstream OAuth client credentials identify the application, not a user.
 */
(function () {
    'use strict';
    if (window.kinopub_lampa_loaded) return;
    window.kinopub_lampa_loaded = true;
    var L, session, refreshWaiters = null, authRun = 0;
    var base = 'https://api.srvkp.com';
    var client = {client_id: 'xbmc', client_secret: 'cgg3gtifu46urtfp2zp1nqtba0k2ezxh'};

    function copy(a, b) {
        var out = {};
        Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
        Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
        return out;
    }
    function escape(value) {
        return String(value || '').replace(/[&<>"']/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
        });
    }
    function form(data) {
        return Object.keys(data || {}).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
        }).join('&');
    }
    function request(path, data, token, done, fail, method) {
        var xhr = new XMLHttpRequest();
        var oauth = path.indexOf('/oauth2/') === 0;
        // The documented query token avoids Authorization preflight, which the
        // service's wildcard Allow-Headers does not permit in standard browsers.
        var jsonPost = !oauth && method === 'POST';
        var query = jsonPost ? (token ? {access_token: token} : {}) : data;
        if (token && !jsonPost) query = copy(query, {access_token: token});
        xhr.open(oauth || jsonPost ? 'POST' : 'GET', base + path + (!oauth && form(query) ? '?' + form(query) : ''), true);
        xhr.timeout = 25000;
        if (oauth) xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        if (jsonPost) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () {
            var body;
            try { body = JSON.parse(xhr.responseText); }
            catch (e) { fail({message: 'Invalid API response', status: xhr.status}); return; }
            if (xhr.status >= 200 && xhr.status < 300 && !body.error && (!body.status || Number(body.status) === 200)) done(body);
            else fail({status: Number(body.status) || xhr.status, code: body.error, message: 'Kino.pub request failed (' + xhr.status + ')'});
        };
        xhr.onerror = function () { fail({message: 'Cannot reach Kino.pub. Check connection and browser CORS support.'}); };
        xhr.ontimeout = function () { fail({message: 'Kino.pub request timed out. Please retry.'}); };
        xhr.send(oauth ? form(data) : jsonPost ? JSON.stringify(data) : null);
    }
    function save(body) {
        if (!body.access_token || !body.refresh_token) throw new Error('Incomplete authentication response');
        session = {access_token: body.access_token, refresh_token: body.refresh_token,
            expires: Date.now() + Number(body.expires_in || 3600) * 1000};
        L.Storage.set('kinopub_session', session);
    }
    function renew(done, fail) {
        if (refreshWaiters) { refreshWaiters.push([done, fail]); return; }
        if (!session.refresh_token) { fail({message: 'Open Kino.pub and activate this device.'}); return; }
        refreshWaiters = [[done, fail]];
        function finish(err) {
            var waiters = refreshWaiters;
            refreshWaiters = null;
            waiters.forEach(function (w) { if (err) w[1](err); else w[0](); });
        }
        request('/oauth2/token', copy(client, {grant_type: 'refresh_token', refresh_token: session.refresh_token}), null, function (body) {
            try { save(body); } catch (e) { finish({message: e.message}); return; }
            finish();
        }, function (err) {
            if (err.status === 400 || err.status === 401) {
                session = {}; L.Storage.set('kinopub_session', session);
                err.message = 'Session expired. Activate this device again.';
            }
            finish(err);
        });
    }
    function api(path, params, done, fail, method) {
        function send(retried) {
            request('/v1/' + path, params, session.access_token, done, function (err) {
                if (err.status === 401 && !retried) renew(function () { send(true); }, fail);
                else fail(err);
            }, method);
        }
        if (!session.access_token || session.expires < Date.now() + 60000) renew(function () { send(true); }, fail);
        else send(false);
    }

    function menu(title, items, back) {
        L.Select.show({title: title, items: items, onSelect: function (item) { item.run(); }, onBack: back});
    }
    function normalized(value) {
        return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/g, ' ').trim();
    }
    function matchingTitle(value) {
        var numbers = {one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9'};
        return normalized(value).replace(/\s+(one|two|three|four|five|six|seven|eight|nine|ten|ii|iii|iv|vi|vii|viii|ix)$/, function (_, number) { return ' ' + numbers[number]; });
    }
    function titles(card) {
        var alternatives = card.alternative_titles || {};
        return [card.title, card.name, card.original_title, card.original_name].concat((alternatives.results || alternatives.titles || []).map(function (entry) { return entry.title; })).filter(function (v, i, list) {
            return v && list.indexOf(v) === i;
        });
    }
    function isSeries(card) { return !!(card.name || card.first_air_date || card.number_of_seasons || card.media_type === 'tv'); }
    function is3d(item) { return /^3d$/i.test(item.type || '') || /(?:^|[\s[(])3d(?:$|[\s)\]])/i.test(item.title || ''); }
    function matchScore(card, item) {
        if (is3d(item)) return -1000;
        var imdb = String(card.imdb_id || (card.external_ids || {}).imdb_id || '').replace(/^tt/, '').replace(/^0+/, '');
        if (imdb && imdb === String(item.imdb || '').replace(/^tt/, '').replace(/^0+/, '')) return 1000;
        var candidate = String(item.title || '').split(/\s*\/\s*/).map(matchingTitle);
        var exact = titles(card).some(function (title) { return candidate.indexOf(matchingTitle(title)) !== -1; });
        var year = Number(String(card.release_date || card.first_air_date || '').slice(0, 4));
        var sameType = isSeries(card) === /serial|tvshow/.test(item.type || '');
        return (exact ? 100 : 0) + (year && Number(item.year) === year ? 30 : 0) + (sameType ? 10 : -100);
    }
    function urls(file) { return file.url || file.urls || {}; }
    function validUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url); }
    function qualityLabel(file) {
        var label = String(file.quality || '').trim();
        if (/^(4k|uhd|2160p?)$/i.test(label)) return '2160p';
        if (/^(8k|4320p?)$/i.test(label)) return '4320p';
        if (/^\d+p?$/i.test(label)) return parseInt(label, 10) + 'p';
        if (label) return label;
        if (Number(file.w) >= 3840) return Number(file.w) >= 7680 ? '4320p' : '2160p';
        return file.h ? file.h + 'p' : 'Auto';
    }
    function qualityText(label) { return label === '2160p' ? '2160p · 4K' : label; }
    function streamData(video, format, audioIndex) {
        var quality = {}, first;
        (video.files || []).slice().sort(function (a, b) { return (parseInt(qualityLabel(b), 10) || 0) - (parseInt(qualityLabel(a), 10) || 0); }).forEach(function (file) {
            var url = urls(file)[format];
            if (!validUrl(url)) return;
            if (audioIndex) {
                // Same Kino.pub HLS track convention used by online_mod's adapter.
                // Preserve the service-provided host, signature and query string.
                if (format !== 'hls' || !/\/master(?:-v1a\d+)?\.m3u8(?:[?#]|$)/.test(url)) return;
                url = url.replace(/\/master(?:-v1a\d+)?\.m3u8/, '/master-v1a' + audioIndex + '.m3u8');
            }
            if (!first) first = url;
            // hls2/hls4 are adaptive manifests; Lampa discovers their levels itself.
            if (format === 'hls' || format === 'http') quality[qualityLabel(file)] = url;
        });
        return {url: first, quality: quality};
    }
    function formats(video) {
        return ['hls4', 'hls2', 'hls', 'http'].filter(function (format) { return !!streamData(video, format).url; });
    }
    var formatNames = {hls4: 'HLS adaptive · audio / quality in player', hls2: 'HLS2 adaptive · audio / quality in player', hls: 'HLS · fixed qualities', http: 'MP4'};
    function voiceKey(audio) { return [audio.lang, (audio.author || {}).id || (audio.author || {}).title, (audio.type || {}).id || (audio.type || {}).title, audio.codec, audio.channels].join('|'); }
    function voiceTitle(audio) { return [audio.lang, (audio.author || {}).title, (audio.type || {}).title, audio.codec, audio.channels ? audio.channels + ' ch' : ''].filter(Boolean).join(' · '); }
    function Component(object) {
        var self = this, card = object.movie, files = new (L.Explorer || L.Files)({movie: copy(card, {
            title: card.title || card.name, original_title: card.original_title || card.original_name
        })}), scroll = new L.Scroll({mask: true, over: true});
        var dead = false, generation = 0, cancelAuth, last, found = [], item, seasonIndex = 0;
        var query = titles(card)[0] || '', format = L.Storage.get('kinopub_format', 'hls4');
        var sourceKey = (card.source || 'tmdb') + ':' + (isSeries(card) ? 'tv:' : 'movie:') + (card.id || normalized(query));
        var preferences = L.Storage.get('kinopub_matches', {}) || {};
        var filter = new L.Filter(copy(object, {search: query, search_one: titles(card)[0], search_two: card.original_title || card.original_name}));
        var voice = '', forcedQuality = L.Storage.get('kinopub_quality', 'best'), headerFocus = false;
        scroll.body().addClass('torrent-list');
        files.render().addClass('kinopub-explorer');
        if (files.appendHead) { files.appendHead(filter.render()); files.appendFiles(scroll.render()); }
        else { files.append(filter.render()); files.append(scroll.render()); }
        function active() { var current = L.Activity.active(); return !dead && current && current.activity === self.activity; }
        function busy(value) { if (!dead) self.activity.loader(value); }
        function reset() { last = null; scroll.clear(); scroll.reset(); }
        function row(title, subtitle, action, timeline) {
            var node = $('<div class="online selector kinopub-row"><div class="online__body"><div class="online__title kinopub-row__title"></div><div class="online__quality kinopub-row__info"></div></div></div>');
            node.find('.kinopub-row__title').text(title);
            node.find('.kinopub-row__info').text(subtitle || '');
            if (timeline) node.append(L.Timeline.render(timeline));
            node.on('hover:enter', action).on('hover:focus', function () { headerFocus = false; last = node[0]; scroll.update(node); });
            scroll.append(node);
            return node;
        }
        function showError(err, retry) {
            busy(false); reset();
            row(err.message || 'Kino.pub request failed', 'Select to retry', retry || search);
            if (!session.access_token) row('Activate Kino.pub', '', login);
            row('Back to title', '', self.back); self.start();
        }
        function get(path, params, done, retry, fail) {
            var current = generation;
            busy(true);
            api(path, params, function (body) {
                if (dead || current !== generation) return;
                busy(false); done(body);
            }, function (err) { if (!dead && current === generation) { busy(false); if (fail) fail(err); else showError(err, retry); } });
        }
        function login() {
            var run = ++authRun, timer, deadline;
            cancelAuth = function () { if (run === authRun) authRun++; clearTimeout(timer); };
            function cancelled() { cancelAuth(); if (!dead) { reset(); row('Activate Kino.pub', '', login); self.start(); } }
            busy(true);
            request('/oauth2/device', copy(client, {grant_type: 'device_code'}), null, function (body) {
                if (dead || run !== authRun) return;
                busy(false);
                if (!body.code || !body.user_code || !body.verification_uri) { showError({message: 'Invalid activation response'}, login); return; }
                var interval = Math.max(5, Number(body.interval) || 5) * 1000;
                deadline = Date.now() + Math.min(Number(body.expires_in) || 300, 900) * 1000;
                reset();
                row('Open ' + body.verification_uri, 'On your phone or computer', function () {});
                row('Code: ' + body.user_code, 'Waiting for activation…', function () {});
                row('Cancel activation', '', cancelled); self.start();
                function poll() {
                    if (dead || run !== authRun) return;
                    if (Date.now() >= deadline) { showError({message: 'Activation code expired'}, login); return; }
                    request('/oauth2/device', copy(client, {grant_type: 'device_token', code: body.code}), null, function (tokens) {
                        if (dead || run !== authRun) return;
                        try { save(tokens); } catch (e) { showError(e, login); return; }
                        cancelAuth(); search();
                    }, function (err) {
                        if (dead || run !== authRun) return;
                        if (err.code === 'slow_down' || err.status === 429) interval += 5000;
                        else if (err.code !== 'authorization_pending') { showError(err, login); return; }
                        timer = setTimeout(poll, interval);
                    });
                }
                timer = setTimeout(poll, interval);
            }, function (err) { if (!dead && run === authRun) showError(err, login); });
        }
        function editSearch() {
            L.Input.edit({title: 'Search Kino.pub', value: query, free: true, nosave: true}, function (value) {
                if (dead) return;
                if (String(value || '').trim()) { query = String(value).trim(); search(true); }
                else self.start();
            });
        }
        function search(manual) {
            generation++; found = []; item = null; updateFilter();
            if (!session.access_token) { login(); return; }
            if (!manual && preferences[sourceKey]) { loadItem(preferences[sourceKey]); return; }
            var queries = manual ? [query] : titles(card), index = 0, broadened = false;
            function next() {
                if (index >= queries.length) {
                    // A numbered sequel may be listed with a spelled-out numeral.
                    // Broaden retrieval only when exact searches did not find a strong match;
                    // still require the full title/number and year when auto-selecting.
                    if (!broadened && !found.some(function (candidate) { return matchScore(card, candidate) >= 140; })) {
                        broadened = true;
                        queries.slice().forEach(function (term) {
                            var broader = matchingTitle(term).replace(/\s+\d{1,2}$/, '').trim();
                            if (broader.length >= 3 && broader !== matchingTitle(term) && queries.indexOf(broader) === -1) queries.push(broader);
                        });
                        if (index < queries.length) { next(); return; }
                    }
                    found.sort(function (a, b) { return matchScore(card, b) - matchScore(card, a); });
                    // Require an unambiguous exact title + year + media type, or IMDb ID.
                    var score = found.length ? matchScore(card, found[0]) : 0;
                    if (!manual && score >= 140 && (found.length === 1 || score > matchScore(card, found[1]))) loadItem(found[0].id);
                    else results();
                    return;
                }
                var term = queries[index++];
                if (!term) { next(); return; }
                function page(number) { get('items/search', {q: term, field: 'title', perpage: 100, page: number}, function (body) {
                    (body.items || []).forEach(function (candidate) {
                        if (is3d(candidate)) return;
                        if (!found.some(function (entry) { return entry.id === candidate.id; })) found.push(candidate);
                    });
                    if ((body.items || []).length && body.pagination && number < Number(body.pagination.total)) page(number + 1);
                    else next();
                }, function () { search(manual); }); }
                page(1);
            }
            next();
        }
        function results() {
            updateFilter();
            reset(); row('Change search', query, editSearch);
            if (!found.length) row('No matches on Kino.pub', 'Try another title or original name', editSearch);
            found.forEach(function (candidate) {
                var quality = candidate.quality ? qualityText(qualityLabel(candidate)) : '';
                row(candidate.title, [candidate.year, candidate.type, quality].filter(Boolean).join(' · '), function () { loadItem(candidate.id); });
            });
            self.start();
        }
        function loadItem(id) {
            get('items/' + encodeURIComponent(id), {nolinks: 0}, function (body) {
                if (!body.item) { showError({message: 'This Kino.pub item is unavailable'}, function () { search(true); }); return; }
                item = body.item; item.id = item.id || id;
                if (is3d(item)) {
                    delete preferences[sourceKey]; L.Storage.set('kinopub_matches', preferences);
                    search(false); return;
                }
                preferences[sourceKey] = item.id;
                // Keep this small and store IDs only, never signed playback URLs.
                var keys = Object.keys(preferences); if (keys.length > 200) delete preferences[keys[0]];
                L.Storage.set('kinopub_matches', preferences);
                seasonIndex = 0; episodes();
            }, function () { delete preferences[sourceKey]; search(true); });
        }
        function season() { return (item.seasons || [])[seasonIndex]; }
        function videos() { return season() ? season().episodes || [] : item.videos || []; }
        function timeline(video, index) {
            var name = card.original_title || card.original_name || card.title || card.name || sourceKey;
            // Match the timeline convention used by Lampa's online plugins.
            var key = season() ? [season().number || seasonIndex + 1, video.number || index + 1, name].join('') : name;
            if (!season() && videos().length > 1) key += ':part:' + (video.number || index + 1);
            return L.Timeline.view(L.Utils.hash(key));
        }
        function title(video, index) {
            return season() ? 'S' + (season().number || seasonIndex + 1) + ' · E' + (video.number || index + 1) + (video.title ? ' · ' + video.title : '') : video.title || card.title || card.name;
        }
        function availableVoices() {
            var result = [];
            videos().forEach(function (video) { (video.audios || []).forEach(function (audio) {
                if (Number(audio.index) > 0 && !result.some(function (other) { return voiceKey(other) === voiceKey(audio); })) result.push(audio);
            }); });
            return result;
        }
        function selectedAudio(video) { return (video.audios || []).filter(function (audio) { return voiceKey(audio) === voice; })[0]; }
        function updateFilter() {
            var groups = [];
            function group(stype, title, values, value) {
                groups.push({stype: stype, title: title, subtitle: escape((values.filter(function (entry) { return entry.value === value; })[0] || {}).title || ''),
                    items: values.map(function (entry) { return {title: escape(entry.title), value: entry.value, selected: entry.value === value}; })});
            }
            if (item) {
                if (item.seasons && item.seasons.length) group('season', 'Season', item.seasons.map(function (entry, index) { return {title: 'Season ' + (entry.number || index + 1), value: index}; }), seasonIndex);
                group('voice', 'Language / voice', [{title: 'All tracks · choose in player', value: ''}].concat(availableVoices().map(function (audio) { return {title: voiceTitle(audio), value: voiceKey(audio)}; })), voice);
                var qualities = [];
                videos().forEach(function (video) { (video.files || []).forEach(function (file) { var label = qualityLabel(file); if (label !== 'Auto' && qualities.indexOf(label) === -1) qualities.push(label); }); });
                qualities.sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
                group('quality', 'Quality', [{title: 'Highest available · fixed', value: 'best'}, {title: 'Auto · adaptive', value: ''}].concat(qualities.map(function (quality) { return {title: qualityText(quality), value: quality}; })), forcedQuality);
                group('format', 'Stream format', Object.keys(formatNames).map(function (name) { return {title: formatNames[name], value: name}; }), format);
                groups.push({title: 'Change match / find another release', subtitle: 'Search again for other editions, including 4K when available', action: 'match'});
            }
            groups.push({title: 'Account', action: 'account'});
            filter.set('filter', groups);
            filter.set('sort', [{title: 'Kino.pub', source: 'kinopub', selected: true}]);
            filter.chosen('sort', ['Kino.pub']);
            filter.chosen('filter', [item && season() ? 'S' + (season().number || seasonIndex + 1) : '', voice ? escape(voiceTitle(availableVoices().filter(function (audio) { return voiceKey(audio) === voice; })[0] || {})) : '', forcedQuality].filter(Boolean));
        }
        function account() {
            menu('Kino.pub account', [{title: 'Device playback settings · 4K / HEVC', run: deviceSettings}, {title: 'Cancel', run: self.start}, {title: 'Sign out', run: function () {
                generation++; session = {}; L.Storage.set('kinopub_session', session); login();
            }}], self.start);
        }
        function deviceSettings() {
            get('device/info', {}, function (body) {
                var device = body.device || {};
                if (!device.id) { showError({message: 'Kino.pub did not return a device ID'}, deviceSettings); return; }
                var endpoint = 'device/' + encodeURIComponent(device.id) + '/settings';
                function back() { if (item) loadItem(item.id); else self.start(); }
                function read() {
                    get(endpoint, {}, function (result) {
                        var settings = result.settings || {};
                        var labels = {support4k: '4K / UHD', supportHevc: 'HEVC / H.265', mixedPlaylist: 'Mixed AVC + HEVC playlist', supportHdr: 'HDR'};
                        var rows = Object.keys(labels).map(function (key) {
                            var raw = settings[key], value = raw && typeof raw === 'object' ? raw.value : raw;
                            var known = value === true || value === false || value === 1 || value === 0 || value === '1' || value === '0';
                            var enabled = value === true || value === 1 || value === '1';
                            return {title: labels[key] + ': ' + (known ? enabled ? 'On' : 'Off' : 'Unknown'),
                                subtitle: 'Enable only if your playback device supports it', run: function () {
                                    if (!known) { L.Noty.show('Setting was not returned by Kino.pub'); return; }
                                    var change = {}; change[key] = !enabled;
                                    var current = generation; busy(true);
                                    api(endpoint, change, function () {
                                        if (dead || current !== generation) return;
                                        busy(false); read();
                                    }, function (err) { if (!dead && current === generation) showError(err, deviceSettings); }, 'POST');
                                }};
                        });
                        menu('Kino.pub device: ' + (device.title || device.id), rows, back);
                    }, deviceSettings);
                }
                read();
            }, deviceSettings);
        }
        function context(video, index) {
            var view = timeline(video, index);
            menu(title(video, index), [{title: 'Play', run: function () { playVideo(video, index); }},
                {title: 'Refresh links / stream details', run: function () { streamDetails(video, index); }},
                {title: 'Mark as watched', run: function () { L.Timeline.update({hash: view.hash, percent: 100, time: video.duration || 0, duration: video.duration || 0}); episodes(); }},
                {title: 'Reset progress', run: function () { L.Timeline.update({hash: view.hash, percent: 0, time: 0, duration: video.duration || 0}); episodes(); }}], self.start);
        }
        function streamDetails(video, index) {
            function display(note) {
                var rows = [{title: 'Kino.pub 0.3.4 · item ' + item.id + ' · video ' + (video.id || 'unknown'), subtitle: escape(item.title), run: episodes},
                    {title: note, subtitle: 'Selected quality: ' + (forcedQuality || 'Auto') + ' · format: ' + format, run: episodes}];
                (video.files || []).forEach(function (file) {
                    rows.push({title: escape(qualityText(qualityLabel(file)) + ' · ' + (file.codec || 'codec unknown')),
                        subtitle: escape([file.w && file.h ? file.w + '×' + file.h : '', Object.keys(urls(file)).filter(function (key) { return validUrl(urls(file)[key]); }).join(', ')].filter(Boolean).join(' · ')), run: episodes});
                });
                menu('Streams returned by Kino.pub', rows, episodes);
            }
            if (!video.id) { display('Embedded files only: no video ID to refresh'); return; }
            get('items/media-links', {mid: video.id}, function (body) {
                video.files = body.files || []; video.subtitles = body.subtitles || video.subtitles || [];
                updateFilter(); display('Fresh API response · ' + video.files.length + ' files');
            }, function () { streamDetails(video, index); });
        }
        function episodes() {
            reset();
            updateFilter();
            if (!videos().length) row('No episodes available', '', self.back);
            videos().forEach(function (video, index) {
                var languages = (video.audios || []).map(function (audio) { return audio.lang; }).filter(function (value, i, all) { return value && all.indexOf(value) === i; });
                var audio = selectedAudio(video), unavailable = voice && !audio;
                var quality = (video.files || []).map(function (file) { return qualityText(qualityLabel(file)); }).filter(function (value, i, all) { return value && all.indexOf(value) === i; }).join(' / ');
                var info = unavailable ? 'Selected voice unavailable' : audio ? voiceTitle(audio) : languages.join(', ');
                row(title(video, index), [quality, info].filter(Boolean).join(' · '), function () {
                    if (unavailable) { L.Noty.show('Choose another voice in Filters'); return; }
                    playVideo(video, index);
                }, timeline(video, index)).on('hover:long', function () { context(video, index); });
            });
            self.start();
        }
        function ensureLinks(video, done, fail) {
            function failed(err) { if (fail) fail(err); else showError(err, episodes); }
            if (formats(video).length) { done(); return; }
            if (!video.id) { failed({message: 'No playable links for this episode'}); return; }
            get('items/media-links', {mid: video.id}, function (body) {
                video.files = body.files || []; video.subtitles = body.subtitles || video.subtitles || [];
                if (!formats(video).length) { failed({message: 'No playable links for this episode'}); return; }
                done();
            }, episodes, failed);
        }
        function playerEntry(video, index) {
            var available = formats(video), selected = available.indexOf(format) !== -1 ? format : available[0];
            var audio = voice && selectedAudio(video);
            if (audio) selected = 'hls';
            var streams = streamData(video, selected, audio && Number(audio.index));
            if (forcedQuality) {
                // Select by resolution across fixed-quality formats. Never relabel an
                // adaptive manifest or silently downgrade an explicit quality request.
                var candidates = [];
                (audio ? ['hls'] : format === 'http' ? ['http', 'hls'] : ['hls', 'http']).forEach(function (kind) {
                    var fixed = streamData(video, kind, audio && Number(audio.index));
                    Object.keys(fixed.quality).forEach(function (quality) {
                        if (forcedQuality === 'best' || quality === forcedQuality) candidates.push({quality: quality, url: fixed.quality[quality], format: kind});
                    });
                });
                candidates.sort(function (a, b) { return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0); });
                var chosen = candidates[0];
                selected = chosen ? chosen.format : selected;
                streams = {url: chosen && chosen.url, quality: {}};
            }
            var entry = {url: streams.url, title: title(video, index), card: card, timeline: timeline(video, index),
                season: season() ? season().number || seasonIndex + 1 : undefined, episode: video.number || index + 1,
                subtitles: (video.subtitles || []).filter(function (sub) { return validUrl(sub.url); }).map(function (sub) {
                    return {label: sub.lang || 'Subtitles', url: sub.url};
                })};
            if (!forcedQuality && Object.keys(streams.quality).length > 1) entry.quality = streams.quality;
            // Native audio selection uses the actual tracks discovered by the player.
            // Metadata labels are appropriate only for multi-track formats.
            if (selected !== 'hls') entry.translate = (video.audios || []).map(function (audio) {
                return {name: [audio.lang, (audio.author || {}).title, (audio.type || {}).title].filter(Boolean).join(' · '),
                    language: audio.lang, extra: {channels: audio.channels}};
            });
            return entry;
        }
        function playVideo(video, index) {
            ensureLinks(video, function () {
                if (!active()) return;
                var first = playerEntry(video, index);
                if (!first.url || voice && !selectedAudio(video)) { L.Noty.show('Requested quality/voice has no fixed stream. Change Filters or choose Auto for adaptive playback.'); self.start(); return; }
                var playlist = videos().map(function (next, nextIndex) {
                    if (voice && !selectedAudio(next)) return null;
                    if (formats(next).length) return playerEntry(next, nextIndex);
                    var lazy = {title: title(next, nextIndex), season: first.season, episode: next.number || nextIndex + 1};
                    lazy.url = function (ready) {
                        ensureLinks(next, function () {
                            var resolved = playerEntry(next, nextIndex);
                            if (!resolved.url) { if (L.Player.close) L.Player.close(); showError({message: 'Selected voice is unavailable for this episode'}, episodes); return; }
                            Object.keys(resolved).forEach(function (key) { lazy[key] = resolved[key]; });
                            ready();
                        }, function (err) {
                            // Exit the player's pending next-episode state so retry remains possible.
                            if (L.Player.close) L.Player.close();
                            showError(err, episodes);
                        });
                    };
                    return lazy;
                }).filter(function (entry) { return entry && entry.url; });
                if (card.id) L.Favorite.add('history', card, 100);
                first.playlist = playlist;
                L.Player.play(first); L.Player.playlist(playlist);
                if (L.Player.callback) L.Player.callback(function () { if (!dead) episodes(); });
            });
        }
        this.create = function () {
            filter.onSearch = function (value) { query = String(value || '').trim(); search(true); };
            filter.onBack = self.start;
            filter.onSelect = function (type, a, b) {
                if (type === 'sort') { self.start(); return; }
                if (b) {
                    if (a.stype === 'season') seasonIndex = b.value;
                    if (a.stype === 'voice') voice = b.value;
                    if (a.stype === 'quality') { forcedQuality = b.value; L.Storage.set('kinopub_quality', forcedQuality); }
                    if (a.stype === 'format') { format = b.value; L.Storage.set('kinopub_format', format); }
                    episodes();
                    // Filter.show reopens its parent after onSelect; close on the next tick.
                    setTimeout(function () { if (active()) { L.Select.close(); self.start(); } }, 0);
                } else if (a.action === 'match') search(true);
                else if (a.action === 'account') account();
            };
            filter.render().find('.filter--sort span').text('Source');
            filter.render().find('.selector').on('hover:focus', function () { headerFocus = true; });
            updateFilter();
            scroll.minus(files.render().find(files.appendHead ? '.explorer__files-head' : '.files__left'));
            search(); return self.render();
        };
        this.start = function () {
            if (!active()) return;
            L.Controller.add('content', {
                toggle: function () { L.Controller.collectionSet(scroll.render(), files.render()); L.Controller.collectionFocus(last || false, scroll.render()); },
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else if (!headerFocus) { headerFocus = true; L.Controller.collectionSet(filter.render()); L.Controller.collectionFocus(false, filter.render()); } else L.Controller.toggle('head'); },
                down: function () { if (headerFocus) { headerFocus = false; self.start(); } else Navigator.move('down'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else L.Controller.toggle('menu'); },
                right: function () { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show('Filters', 'filter'); }, back: self.back
            });
            L.Controller.toggle('content');
        };
        this.back = function () { L.Activity.backward(); };
        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return files.render(); };
        this.destroy = function () { dead = true; generation++; if (cancelAuth) cancelAuth(); filter.destroy(); scroll.destroy(); files.destroy(); };
    }
    function start() {
        if (L) return;
        L = window.Lampa;
        session = L.Storage.get('kinopub_session', {}) || {};
        L.Component.add('kinopub', Component);
        function launch(card) { L.Activity.push({component: 'kinopub', title: 'Kino.pub', movie: card, search: card.title || card.name, search_one: card.title || card.name, search_two: card.original_title || card.original_name, page: 1}); }
        if (L.Manifest) L.Manifest.plugins = {type: 'video', version: '0.3.4', name: 'Kino.pub', description: 'Watch with your Kino.pub account', component: 'kinopub',
            onContextMenu: function () { return {name: 'Watch on Kino.pub', description: ''}; }, onContextLauch: launch};
        $('body').append('<style id="kinopub-style">.kinopub-explorer .kinopub-row{padding:1em;margin-bottom:.4em;border-radius:.4em;border:1px solid rgba(255,255,255,.12)}.kinopub-explorer .kinopub-row.focus{border-color:#fff;background:rgba(255,255,255,.12)}.kinopub-explorer .kinopub-row__title{font-size:1.2em}.kinopub-explorer .kinopub-row__info{opacity:.65;margin-top:.35em;font-size:.85em}</style>');
        L.Listener.follow('full', function (event) {
            if (event.type !== 'complite' || !event.data || !event.data.movie) return;
            var root = event.object.activity.render();
            if (root.find('.view--kinopub').length) return;
            var button = $('<div class="full-start__button selector view--kinopub" data-subtitle="Kino.pub"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg><span>Kino.pub</span></div>');
            button.on('hover:enter', function () {
                launch(event.data.movie);
            });
            // Current Lampa groups these buttons into its native Play → Source menu.
            var container = root.find('.buttons--container').first();
            if (container.length) container.append(button);
            else {
                var anchor = root.find('.view--torrent').first();
                if (anchor.length) anchor.after(button);
                else root.find('.full-start-new__buttons, .full-start__buttons').first().append(button);
            }
        });
    }
    if (window.appready) start();
    else window.Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); });
}());
