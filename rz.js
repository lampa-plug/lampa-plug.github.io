(function () {
    'use strict';

    if (window.hdrezka_lampa_plugin) return;
    window.hdrezka_lampa_plugin = true;

    var PLUGIN_VERSION = '2026-04-10.1';
    var SOURCE_NAME = 'HDRezka';
    var COMPONENT_NAME = 'hdrezka';
    var MIRROR_STORAGE_KEY = 'hdrezka_mirror';
    var CHOICE_STORAGE_KEY = 'hdrezka_choice';
    var VIEWED_STORAGE_KEY = 'hdrezka_viewed';
    var DEFAULT_MIRROR = 'https://hdrezka.ag';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[hdrezka]');
        console.log.apply(console, args);
    }

    function normalizeSpaces(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function cleanTitle(text) {
        return normalizeSpaces(String(text || '').replace(/[\s.,:;'"`!?]+/g, ' '));
    }

    function normalizeTitle(text) {
        return cleanTitle(
            String(text || '')
                .toLowerCase()
                .replace(/[ё]/g, 'е')
                .replace(/[\-\u2010-\u2015\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g, '-')
        );
    }

    function equalTitle(left, right) {
        return !!left && !!right && normalizeTitle(left) === normalizeTitle(right);
    }

    function containsTitle(left, right) {
        left = normalizeTitle(left);
        right = normalizeTitle(right);
        return !!left && !!right && (left.indexOf(right) !== -1 || right.indexOf(left) !== -1);
    }

    function decodeHtml(html) {
        var area = document.createElement('textarea');
        area.innerHTML = html || '';
        return area.value;
    }

    function translate(key, fallback) {
        try {
            if (Lampa.Lang && Lampa.Lang.translate) {
                var value = Lampa.Lang.translate(key);
                if (value && value !== key) return value;
            }
        }
        catch (error) {}

        return fallback || key;
    }

    function getMirror() {
        var url = '';

        if (typeof Lampa !== 'undefined' && Lampa.Storage && Lampa.Storage.get) {
            url = Lampa.Storage.get(MIRROR_STORAGE_KEY, '');
        }

        url = normalizeSpaces(url);
        if (!url) return DEFAULT_MIRROR;
        if (url.indexOf('://') === -1) url = 'https://' + url;
        return url.replace(/\/+$/, '');
    }

    function absoluteUrl(url) {
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;
        if (url.charAt(0) === '/') return getMirror() + url;
        return getMirror() + '/' + String(url).replace(/^\.?\//, '');
    }

    function getMovieTitle(movie) {
        return normalizeSpaces(movie && (movie.title || movie.name || movie.original_title || movie.original_name) || '');
    }

    function getOriginalTitle(movie) {
        return normalizeSpaces(movie && (movie.original_title || movie.original_name || movie.title || movie.name) || '');
    }

    function getSearchYear(movie, fallbackDate) {
        var value = fallbackDate || movie && (movie.release_date || movie.first_air_date || movie.last_air_date) || '';
        var year = parseInt(String(value).slice(0, 4), 10);
        return isNaN(year) ? 0 : year;
    }

    function getRequestHeaders(host) {
        if (Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('android')) {
            return {
                Origin: host,
                Referer: host + '/'
            };
        }

        return {};
    }

    function parsePlaylist(str) {
        var list = [];

        try {
            if (String(str || '').charAt(0) === '[') {
                String(str).substring(1).split(',[').forEach(function (item) {
                    var labelEnd;

                    if (item.endsWith(',')) item = item.slice(0, -1);
                    labelEnd = item.indexOf(']');

                    if (labelEnd < 0) return;

                    if (item.charAt(labelEnd + 1) === '{') {
                        item.substring(labelEnd + 2).split(';{').forEach(function (voiceItem) {
                            var voiceEnd;

                            if (voiceItem.endsWith(';')) voiceItem = voiceItem.slice(0, -1);
                            voiceEnd = voiceItem.indexOf('}');
                            if (voiceEnd < 0) return;

                            list.push({
                                label: item.substring(0, labelEnd),
                                voice: voiceItem.substring(0, voiceEnd),
                                links: voiceItem.substring(voiceEnd + 1).split(' or ').filter(Boolean)
                            });
                        });
                    }
                    else {
                        list.push({
                            label: item.substring(0, labelEnd),
                            links: item.substring(labelEnd + 1).split(' or ').filter(Boolean)
                        });
                    }
                });
            }
        }
        catch (error) {
            log('parsePlaylist failed', error);
        }

        return list.filter(function (item) {
            return item.links && item.links.length;
        });
    }

    function decodeStreamData(value) {
        if (!value || value.charAt(0) !== '#') return value || '';

        function enc(str) {
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, hex) {
                return String.fromCharCode('0x' + hex);
            }));
        }

        function dec(str) {
            return decodeURIComponent(atob(str).split('').map(function (char) {
                return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        }

        var trashList = ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'];
        var result = value.substring(2);

        trashList.forEach(function (trash) {
            result = result.replace('//_//' + enc(trash), '');
        });

        try {
            result = dec(result);
        }
        catch (error) {
            result = '';
        }

        return result;
    }

    function parseSubtitles(str) {
        var subtitles = [];

        if (!str) return false;

        subtitles = parsePlaylist(str).map(function (item) {
            return {
                label: item.label,
                url: item.links[0] || ''
            };
        }).filter(function (item) {
            return !!item.url;
        });

        return subtitles.length ? subtitles : false;
    }

    function extractItems(str) {
        var items = [];

        try {
            items = parsePlaylist(str).map(function (item) {
                var pLabel = String(item.label || '');
                var quality = pLabel.match(/(\d{3,4})p/i);
                var kQuality = pLabel.match(/(\d+)K/i);
                var intQuality = NaN;

                if (quality) intQuality = parseInt(quality[1], 10);
                else if (kQuality) intQuality = parseInt(kQuality[1], 10) * 1000;

                return {
                    label: item.label,
                    quality: intQuality,
                    file: item.links[0] || ''
                };
            }).filter(function (item) {
                return !!item.file;
            });
        }
        catch (error) {
            log('extractItems failed', error);
        }

        items.sort(function (a, b) {
            if (b.quality > a.quality) return 1;
            if (b.quality < a.quality) return -1;
            if (b.label > a.label) return 1;
            if (b.label < a.label) return -1;
            return 0;
        });

        return items;
    }

    function chooseStream(items) {
        var qualityMap = false;
        var file = '';
        var preferred = Lampa.Storage.get('video_quality_default', '1080') + 'p';

        if (!items || !items.length) {
            return {
                file: '',
                quality: false
            };
        }

        qualityMap = {};
        items.forEach(function (item) {
            qualityMap[item.label] = item.file;
        });

        if (qualityMap[preferred]) file = qualityMap[preferred];
        else if (preferred === '1440p' && qualityMap['2K']) file = qualityMap['2K'];
        else if (preferred === '2160p' && qualityMap['4K']) file = qualityMap['4K'];
        else file = items[0].file;

        return {
            file: file,
            quality: qualityMap
        };
    }

    function resetTemplates() {
        Lampa.Template.add('hdrezka_item', '' +
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"></circle>' +
                            '<path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"></path>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('hdrezka_folder', '' +
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect y="20" width="128" height="92" rx="13" fill="white"></rect>' +
                            '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>' +
                            '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('settings_hdrezka', '' +
            '<div>' +
                '<div class="settings-param selector" data-name="' + MIRROR_STORAGE_KEY + '" data-type="input" data-string="true" placeholder="hdrezka.ag">' +
                    '<div class="settings-param__name">HDRezka mirror</div>' +
                    '<div class="settings-param__value"></div>' +
                    '<div class="settings-param__descr">Optional custom mirror or domain. Leave empty to use ' + DEFAULT_MIRROR + '.</div>' +
                '</div>' +
            '</div>'
        );
    }

    function loadHdRezka(movie) {
        resetTemplates();

        Lampa.Activity.push({
            url: '',
            title: SOURCE_NAME,
            component: COMPONENT_NAME,
            search: getMovieTitle(movie),
            search_one: getMovieTitle(movie),
            search_two: getOriginalTitle(movie),
            movie: movie,
            page: 1
        });
    }

    function hdrezkaComponent(object) {
        var self = this;
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({
            mask: true,
            over: true
        });
        var files = new Lampa.Files(object);
        var panelFilter = new Lampa.Filter(object);
        var host = getMirror();
        var searchTitle = object.search || getMovieTitle(object.movie);
        var filterItems = {
            season: [],
            voice: []
        };
        var choice = defaultChoice();
        var extract = {};
        var selectedKey = '';
        var last = false;
        var lastFilter = false;
        var contextmenuAll = [];

        scroll.body().addClass('torrent-list');

        function defaultChoice() {
            return {
                season: 0,
                voice: 0,
                voice_name: ''
            };
        }

        function getChoiceKey() {
            return selectedKey || object.movie && object.movie.id || searchTitle || SOURCE_NAME;
        }

        function getSavedChoice() {
            var data = Lampa.Storage.cache(CHOICE_STORAGE_KEY, 500, {});
            return data[getChoiceKey()] || {};
        }

        function saveChoice() {
            var data = Lampa.Storage.cache(CHOICE_STORAGE_KEY, 500, {});
            data[getChoiceKey()] = choice;
            Lampa.Storage.set(CHOICE_STORAGE_KEY, data);
        }

        function extendChoice() {
            Lampa.Arrays.extend(choice, getSavedChoice(), true);
        }

        function minus() {
            scroll.minus(window.innerWidth > 580 ? false : files.render().find('.files__left'));
        }

        function componentLoading(status) {
            if (status) {
                if (self.activity && self.activity.loader) self.activity.loader(true);
            }
            else {
                if (self.activity && self.activity.loader) self.activity.loader(false);
                if (Lampa.Controller.enabled && Lampa.Controller.enabled().name === 'content') self.activity.toggle();
            }
        }

        function componentReset() {
            contextmenuAll = [];
            last = false;
            scroll.render().find('.empty').remove();
            panelFilter.render().detach();
            scroll.clear();
            scroll.append(panelFilter.render());
        }

        function componentAppend(item) {
            item.on('hover:focus', function (event) {
                last = event.target;
                scroll.update($(event.target), true);
            });

            scroll.append(item);
        }

        function componentEmpty(message) {
            var empty = Lampa.Template.get('list_empty');
            if (message) empty.find('.empty__descr').text(message);
            scroll.append(empty);
            componentLoading(false);
        }

        function componentEmptyForQuery(query) {
            componentEmpty('No results for: ' + query);
        }

        function getViewed() {
            return Lampa.Storage.cache(VIEWED_STORAGE_KEY, 5000, []);
        }

        function markViewed(hashFile, item, viewed) {
            if (viewed.indexOf(hashFile) !== -1) return;
            viewed.push(hashFile);
            item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
            Lampa.Storage.set(VIEWED_STORAGE_KEY, viewed);
        }

        function getLastEpisode(items) {
            var lastEpisode = 0;

            items.forEach(function (item) {
                if (typeof item.episode !== 'undefined') {
                    lastEpisode = Math.max(lastEpisode, parseInt(item.episode, 10) || 0);
                }
            });

            return lastEpisode;
        }

        function panelFilterSelected() {
            var chosen = [];

            if (filterItems.voice && filterItems.voice.length && filterItems.voice[choice.voice]) {
                chosen.push(translate('torrent_parser_voice', 'Voice') + ': ' + filterItems.voice[choice.voice]);
            }

            if (filterItems.season && filterItems.season.length && filterItems.season[choice.season]) {
                chosen.push(translate('torrent_serial_season', 'Season') + ': ' + filterItems.season[choice.season]);
            }

            panelFilter.chosen('filter', chosen);
        }

        function panelFilterView() {
            var select = [{
                title: translate('torrent_parser_reset', 'Reset'),
                reset: true
            }];

            function addFilter(type, title) {
                var items = filterItems[type] || [];
                var subitems = [];

                if (!items.length) return;

                items.forEach(function (name, index) {
                    subitems.push({
                        title: name,
                        selected: choice[type] === index,
                        index: index
                    });
                });

                select.push({
                    title: title,
                    subtitle: items[choice[type]],
                    items: subitems,
                    stype: type
                });
            }

            addFilter('voice', translate('torrent_parser_voice', 'Voice'));
            addFilter('season', translate('torrent_serial_season', 'Season'));

            panelFilter.set('filter', select);
            panelFilterSelected();
        }

        function getChoiceVoice() {
            var result = extract.voice && extract.voice[0];

            if (!extract.voice || !extract.voice.length) return null;

            if (choice.voice_name) {
                extract.voice.forEach(function (voice, index) {
                    if (voice.name === choice.voice_name) {
                        choice.voice = index;
                        result = voice;
                    }
                });
            }

            if (extract.voice[choice.voice]) result = extract.voice[choice.voice];
            return result;
        }

        function filterVoice() {
            var voices = extract.is_series ? extract.voice.map(function (voice) {
                return voice.name;
            }) : [];
            var index = voices.indexOf(choice.voice_name);

            if (!voices[choice.voice]) choice.voice = 0;
            if (choice.voice_name && index >= 0) choice.voice = index;
        }

        function extractPageData(str) {
            var translation;
            var cdnSeries;
            var cdnMovie;
            var defaultVoice;
            var defaultSeason;
            var defaultEpisode;
            var voices;
            var seasons;
            var episodes;
            var favs;
            var blocked;

            extract = {
                voice: [],
                season: [],
                episode: [],
                voice_data: {},
                is_series: false,
                film_id: '',
                favs: '',
                blocked: false,
                page_url: ''
            };

            str = String(str || '').replace(/\n/g, '');
            translation = str.match(/<h2>В переводе<\/h2>:<\/td>\s*(<td>.*?<\/td>)/);
            cdnSeries = str.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
            cdnMovie = str.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);

            if (cdnSeries) {
                extract.is_series = true;
                extract.film_id = cdnSeries[1];
                defaultVoice = {
                    name: translation ? $(translation[1]).text().trim() : 'Original',
                    id: cdnSeries[2]
                };
                defaultSeason = {
                    name: 'Season ' + cdnSeries[3],
                    id: cdnSeries[3]
                };
                defaultEpisode = {
                    name: 'Episode ' + cdnSeries[4],
                    season_id: cdnSeries[3],
                    episode_id: cdnSeries[4]
                };
            }
            else if (cdnMovie) {
                extract.film_id = cdnMovie[1];
                defaultVoice = {
                    name: translation ? $(translation[1]).text().trim() : 'Original',
                    id: cdnMovie[2],
                    is_camrip: cdnMovie[3],
                    is_ads: cdnMovie[4],
                    is_director: cdnMovie[5]
                };
            }

            voices = str.match(/(<ul id="translators-list".*?<\/ul>)/);
            if (voices) {
                $('.b-translator__item', $(voices[1])).each(function () {
                    var title = normalizeSpaces($(this).attr('title') || $(this).text());

                    $('img', this).each(function () {
                        var lang = normalizeSpaces($(this).attr('title') || $(this).attr('alt'));
                        if (lang && title.indexOf(lang) === -1) title += ' (' + lang + ')';
                    });

                    extract.voice.push({
                        name: title,
                        id: $(this).attr('data-translator_id'),
                        is_camrip: $(this).attr('data-camrip'),
                        is_ads: $(this).attr('data-ads'),
                        is_director: $(this).attr('data-director')
                    });
                });
            }

            if (!extract.voice.length && defaultVoice) extract.voice.push(defaultVoice);

            if (extract.is_series) {
                seasons = str.match(/(<ul id="simple-seasons-tabs".*?<\/ul>)/);
                episodes = str.match(/(<div id="simple-episodes-tabs".*?<\/div>)/);

                if (seasons) {
                    $('.b-simple_season__item', $(seasons[1])).each(function () {
                        extract.season.push({
                            name: $(this).text(),
                            id: $(this).attr('data-tab_id')
                        });
                    });
                }

                if (!extract.season.length && defaultSeason) extract.season.push(defaultSeason);

                if (episodes) {
                    $('.b-simple_episode__item', $('<div>' + episodes[1] + '</div>')).each(function () {
                        extract.episode.push({
                            name: $(this).text(),
                            season_id: $(this).attr('data-season_id'),
                            episode_id: $(this).attr('data-episode_id')
                        });
                    });
                }

                if (!extract.episode.length && defaultEpisode) extract.episode.push(defaultEpisode);
            }

            favs = str.match(/<input type="hidden" id="ctrl_favs" value="([^"]*)"/);
            if (favs) extract.favs = favs[1];

            blocked = str.match(/class="b-player__restricted__block_message"/);
            if (blocked) extract.blocked = true;
        }

        function extractEpisodes(json, translatorId) {
            var data = {
                season: [],
                episode: []
            };

            if (json.seasons) {
                $('.b-simple_season__item', $('<ul>' + json.seasons + '</ul>')).each(function () {
                    data.season.push({
                        name: $(this).text(),
                        id: $(this).attr('data-tab_id')
                    });
                });
            }

            if (json.episodes) {
                $('.b-simple_episode__item', $('<div>' + json.episodes + '</div>')).each(function () {
                    data.episode.push({
                        name: $(this).text(),
                        translator_id: translatorId,
                        season_id: $(this).attr('data-season_id'),
                        episode_id: $(this).attr('data-episode_id')
                    });
                });
            }

            extract.voice_data[translatorId] = data;
            extract.season = data.season;
            extract.episode = data.episode;
        }

        function getEpisodes(callback) {
            var voice;
            var translatorId;
            var postdata;

            if (!extract.is_series) {
                callback();
                return;
            }

            filterVoice();
            voice = getChoiceVoice();
            if (!voice) {
                callback();
                return;
            }

            translatorId = voice.id;
            if (extract.voice_data[translatorId]) {
                extract.season = extract.voice_data[translatorId].season;
                extract.episode = extract.voice_data[translatorId].episode;
                callback();
                return;
            }

            postdata = 'id=' + encodeURIComponent(extract.film_id);
            postdata += '&translator_id=' + encodeURIComponent(translatorId);
            postdata += '&favs=' + encodeURIComponent(extract.favs);
            postdata += '&action=get_episodes';

            network.clear();
            network.timeout(10000);
            network.native(host + '/ajax/get_cdn_series/?t=' + Date.now(), function (json) {
                extractEpisodes(json || {}, translatorId);
                callback();
            }, function (a, c) {
                componentEmpty(network.errorDecode(a, c));
            }, postdata, {
                headers: getRequestHeaders(host)
            });
        }

        function buildFilters() {
            filterItems = {
                season: extract.season.map(function (season) {
                    return season.name;
                }),
                voice: extract.is_series ? extract.voice.map(function (voice) {
                    return voice.name;
                }) : []
            };

            if (!filterItems.season[choice.season]) choice.season = 0;
            if (!filterItems.voice[choice.voice]) choice.voice = 0;

            if (choice.voice_name && filterItems.voice.length) {
                var index = filterItems.voice.indexOf(choice.voice_name);
                if (index >= 0) choice.voice = index;
            }

            panelFilterView();
        }

        function buildItems() {
            var items = [];

            if (extract.is_series) {
                var seasonName = filterItems.season[choice.season];
                var seasonId = '';
                var voiceName = filterItems.voice[choice.voice] || '';

                extract.season.forEach(function (season) {
                    if (season.name === seasonName) seasonId = season.id;
                });

                extract.episode.forEach(function (episode) {
                    if (episode.season_id == seasonId) {
                        items.push({
                            title: 'S' + episode.season_id + ' / ' + episode.name,
                            quality: '360p ~ 1080p',
                            info: voiceName ? ' / ' + voiceName : '',
                            season: parseInt(episode.season_id, 10),
                            episode: parseInt(episode.episode_id, 10),
                            media: episode
                        });
                    }
                });
            }
            else {
                extract.voice.forEach(function (voice) {
                    items.push({
                        title: voice.name || searchTitle,
                        quality: '360p ~ 1080p',
                        info: '',
                        media: voice
                    });
                });
            }

            return items;
        }

        function renderExtract() {
            buildFilters();
            renderItems(buildItems());
            saveChoice();
        }

        function openPage(url) {
            var pageUrl = absoluteUrl(url);

            network.clear();
            network.timeout(10000);
            network.native(pageUrl, function (str) {
                extractPageData(str);
                extract.page_url = pageUrl;

                if (!extract.film_id) {
                    componentEmptyForQuery(searchTitle);
                    return;
                }

                getEpisodes(function () {
                    componentLoading(false);
                    renderExtract();
                });
            }, function (a, c) {
                componentEmpty(network.errorDecode(a, c));
            }, false, {
                dataType: 'text',
                headers: getRequestHeaders(host)
            });
        }

        function parseSearchResults(str) {
            var items = [];
            var links;

            str = String(str || '').replace(/\n/g, '');
            links = str.match(/<li><a href=.*?<\/li>/g) || [];

            items = links.map(function (html) {
                var node = $(html);
                var link = $('a', node);
                var enty = $('.enty', link);
                var rating = $('.rating', link);
                var title = normalizeSpaces(enty.text());
                var alt = '';
                var origTitle = '';
                var year = 0;
                var found;

                enty.remove();
                rating.remove();
                alt = normalizeSpaces(link.text());
                found = alt.match(/\((.*,\s*)?\b(\d{4})(\s*-\s*[\d.]*)?\)$/);

                if (found) {
                    year = parseInt(found[2], 10) || 0;

                    if (found[1]) {
                        var altMatch = found[1].match(/^([^а-яА-ЯёЁ]+),/);
                        if (altMatch) origTitle = normalizeSpaces(altMatch[1]);
                    }
                }

                return {
                    title: title || alt,
                    orig_title: origTitle,
                    quality: year ? String(year) : '----',
                    info: origTitle ? ' / ' + origTitle : '',
                    year: year,
                    link: absoluteUrl(link.attr('href') || '')
                };
            }).filter(function (item) {
                return !!item.link;
            });

            return items;
        }

        function pickSearchResults(items, byId) {
            var cards = items.slice();
            var originalTitle = getOriginalTitle(object.movie);
            var year = getSearchYear(object.movie, object.search_date);
            var sure = !!byId;
            var match;

            if (cards.length > 1 && originalTitle) {
                match = cards.filter(function (card) {
                    return containsTitle(card.orig_title, originalTitle) || containsTitle(card.title, originalTitle);
                });

                if (match.length) cards = match;
            }

            if (cards.length > 1 && searchTitle) {
                match = cards.filter(function (card) {
                    return containsTitle(card.title, searchTitle) || containsTitle(card.orig_title, searchTitle);
                });

                if (match.length) cards = match;
            }

            if (cards.length > 1 && year) {
                match = cards.filter(function (card) {
                    return card.year === year;
                });

                if (!match.length) {
                    match = cards.filter(function (card) {
                        return card.year && Math.abs(card.year - year) <= 2;
                    });
                }

                if (match.length) cards = match;
            }

            if (cards.length === 1 && !byId) {
                sure = false;

                if (searchTitle) {
                    sure = sure || equalTitle(cards[0].title, searchTitle) || equalTitle(cards[0].orig_title, searchTitle);
                }

                if (originalTitle) {
                    sure = sure || equalTitle(cards[0].orig_title, originalTitle) || equalTitle(cards[0].title, originalTitle);
                }

                if (sure && year && cards[0].year) sure = Math.abs(cards[0].year - year) <= 2;
            }

            return {
                auto: cards.length === 1 && sure,
                items: cards.length ? cards : items
            };
        }

        function querySearch(query, callback, error) {
            network.clear();
            network.timeout(10000);
            network.native(host + '/engine/ajax/search.php', function (str) {
                callback(parseSearchResults(str));
            }, function (a, c) {
                if (error) error(network.errorDecode(a, c));
            }, 'q=' + encodeURIComponent(query), {
                dataType: 'text',
                headers: getRequestHeaders(host)
            });
        }

        function showSearchResults(items) {
            componentReset();
            panelFilterView();

            items.forEach(function (item) {
                var folder = Lampa.Template.get('hdrezka_folder', item);

                folder.on('hover:enter', function () {
                    selectedKey = item.link;
                    choice = defaultChoice();
                    extendChoice();
                    componentLoading(true);
                    componentReset();
                    openPage(item.link);
                });

                componentAppend(folder);
            });

            componentLoading(false);
            componentStart(true);
        }

        function search() {
            var kpId = parseInt(object.movie && object.movie.kinopoisk_id, 10) || 0;
            var imdbId = object.movie && object.movie.imdb_id || '';

            searchTitle = object.search || getMovieTitle(object.movie);
            host = getMirror();
            selectedKey = '';
            choice = defaultChoice();
            extendChoice();
            componentLoading(true);
            componentReset();
            panelFilterView();

            function handle(items, byId) {
                var picked = pickSearchResults(items, byId);

                if (picked.auto && picked.items[0]) {
                    selectedKey = picked.items[0].link;
                    openPage(picked.items[0].link);
                }
                else if (picked.items && picked.items.length) {
                    showSearchResults(picked.items);
                }
                else {
                    componentEmptyForQuery(searchTitle);
                }
            }

            function searchByTitle() {
                querySearch(searchTitle, function (items) {
                    handle.call(self, items, false);
                }, function (message) {
                    componentEmpty(message);
                });
            }

            if (!object.clarification && imdbId) {
                querySearch('+' + imdbId, function (items) {
                    if (items && items.length) handle.call(self, items, true);
                    else if (kpId) {
                        querySearch('+' + kpId, function (nextItems) {
                            if (nextItems && nextItems.length) handle.call(self, nextItems, true);
                            else searchByTitle.call(self);
                        }, function () {
                            searchByTitle.call(self);
                        });
                    }
                    else searchByTitle.call(self);
                }, function () {
                    if (kpId) {
                        querySearch('+' + kpId, function (items) {
                            if (items && items.length) handle.call(self, items, true);
                            else searchByTitle.call(self);
                        }, function () {
                            searchByTitle.call(self);
                        });
                    }
                    else searchByTitle.call(self);
                });
            }
            else if (!object.clarification && kpId) {
                querySearch('+' + kpId, function (items) {
                    if (items && items.length) handle.call(self, items, true);
                    else searchByTitle.call(self);
                }, function () {
                    searchByTitle.call(self);
                });
            }
            else {
                searchByTitle.call(self);
            }
        }

        function getStream(element, callback, error) {
            var postdata = 'id=' + encodeURIComponent(extract.film_id);

            if (element.stream) {
                callback(element);
                return;
            }

            if (extract.is_series) {
                postdata += '&translator_id=' + encodeURIComponent(element.media.translator_id || getChoiceVoice() && getChoiceVoice().id || '');
                postdata += '&season=' + encodeURIComponent(element.media.season_id);
                postdata += '&episode=' + encodeURIComponent(element.media.episode_id);
                postdata += '&favs=' + encodeURIComponent(extract.favs);
                postdata += '&action=get_stream';
            }
            else {
                postdata += '&translator_id=' + encodeURIComponent(element.media.id);
                postdata += '&is_camrip=' + encodeURIComponent(element.media.is_camrip || '');
                postdata += '&is_ads=' + encodeURIComponent(element.media.is_ads || '');
                postdata += '&is_director=' + encodeURIComponent(element.media.is_director || '');
                postdata += '&favs=' + encodeURIComponent(extract.favs);
                postdata += '&action=get_movie';
            }

            network.clear();
            network.timeout(10000);
            network.native(host + '/ajax/get_cdn_series/?t=' + Date.now(), function (json) {
                var picked;
                var decoded = json && json.url ? decodeStreamData(json.url) : '';

                picked = chooseStream(extractItems(decoded));

                if (!picked.file) {
                    error(extract.blocked ? translate('online_mod_blockedlink', 'This video is not available in your region') : translate('online_mod_nolink', 'Failed to fetch link'));
                    return;
                }

                element.stream = picked.file;
                element.qualitys = picked.quality;
                element.subtitles = parseSubtitles(json.subtitle);
                callback(element);
            }, function (a, c) {
                error(network.errorDecode(a, c));
            }, postdata, {
                headers: getRequestHeaders(host)
            });
        }

        function componentContextmenu(params) {
            contextmenuAll.push(params);

            params.item.on('hover:long', function () {
                var enabled = Lampa.Controller.enabled().name;
                var menu = [{
                    title: translate('torrent_parser_label_title', 'Mark as watched'),
                    mark: true
                }, {
                    title: translate('torrent_parser_label_cancel_title', 'Remove watched mark'),
                    clearmark: true
                }, {
                    title: translate('time_reset', 'Reset timecode'),
                    timeclear: true
                }];

                if (params.file) {
                    menu.push({
                        title: translate('copy_link', 'Copy link'),
                        copylink: true
                    });
                }

                menu.push({
                    title: translate('player_lauch', 'Play with') + ' - Lampa',
                    player: 'lampa'
                });

                if (Lampa.Platform.is('webos')) {
                    menu.push({
                        title: translate('player_lauch', 'Play with') + ' - WebOS',
                        player: 'webos'
                    });
                }

                if (Lampa.Platform.is('android')) {
                    menu.push({
                        title: translate('player_lauch', 'Play with') + ' - Android',
                        player: 'android'
                    });
                }

                Lampa.Select.show({
                    title: translate('title_action', 'Action'),
                    items: menu,
                    onBack: function () {
                        Lampa.Controller.toggle(enabled);
                    },
                    onSelect: function (item) {
                        if (item.mark) {
                            markViewed(params.hash_file, params.item, params.viewed);
                        }

                        if (item.clearmark) {
                            Lampa.Arrays.remove(params.viewed, params.hash_file);
                            Lampa.Storage.set(VIEWED_STORAGE_KEY, params.viewed);
                            params.item.find('.torrent-item__viewed').remove();
                        }

                        if (item.timeclear) {
                            params.view.percent = 0;
                            params.view.time = 0;
                            params.view.duration = 0;
                            Lampa.Timeline.update(params.view);
                        }

                        if (item.player) {
                            Lampa.Controller.toggle(enabled);
                            Lampa.Player.runas(item.player);
                            params.item.trigger('hover:enter');
                            return;
                        }

                        if (item.copylink && params.file) {
                            params.file(function (extra) {
                                var url = extra && extra.quality ? extra.quality[Lampa.Storage.get('video_quality_default', '1080') + 'p'] || extra.file : extra && extra.file;

                                Lampa.Utils.copyTextToClipboard(url, function () {
                                    Lampa.Noty.show(translate('copy_secuses', 'Copied'));
                                }, function () {
                                    Lampa.Noty.show(translate('copy_error', 'Copy error'));
                                });
                            });
                        }
                    }
                });
            }).on('hover:focus', function () {
                if (Lampa.Helper) {
                    Lampa.Helper.show('hdrezka_item', 'Hold OK to open actions', params.item);
                }
            });
        }

        function renderItems(items) {
            var viewed = getViewed();
            var lastEpisode = getLastEpisode(items);

            componentReset();
            buildFilters();

            items.forEach(function (element) {
                var baseTitle = getOriginalTitle(object.movie);
                var hash = Lampa.Utils.hash(element.season ? [element.season, element.episode, baseTitle].join(':') : baseTitle);
                var hashFile = Lampa.Utils.hash(element.season ? [element.season, element.episode, baseTitle, filterItems.voice[choice.voice] || element.title].join(':') : baseTitle + ':' + element.title);
                var view = Lampa.Timeline.view(hash);
                var item = Lampa.Template.get('hdrezka_item', element);

                if (element.season) {
                    element.translate_episode_end = lastEpisode;
                    element.translate_voice = filterItems.voice[choice.voice];
                }

                element.timeline = view;
                item.append(Lampa.Timeline.render(view));

                if (Lampa.Timeline.details) {
                    item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
                }

                if (viewed.indexOf(hashFile) !== -1) {
                    item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                }

                item.on('hover:enter', function () {
                    if (element.loading) return;

                    if (object.movie.id) {
                        Lampa.Favorite.add('history', object.movie, 100);
                    }

                    element.loading = true;
                    getStream(element, function (loaded) {
                        var first;
                        var playlist = [];

                        element.loading = false;

                        first = {
                            url: loaded.stream,
                            quality: loaded.qualitys,
                            subtitles: loaded.subtitles,
                            timeline: loaded.timeline,
                            title: loaded.season ? loaded.title : searchTitle + (loaded.title === searchTitle ? '' : ' / ' + loaded.title)
                        };

                        if (loaded.season && Lampa.Platform.version) {
                            items.forEach(function (entry) {
                                if (entry === loaded) {
                                    playlist.push(first);
                                }
                                else {
                                    var cell = {
                                        url: function (next) {
                                            getStream(entry, function (result) {
                                                cell.url = result.stream;
                                                cell.quality = result.qualitys;
                                                cell.subtitles = result.subtitles;
                                                next();
                                            }, function () {
                                                cell.url = '';
                                                next();
                                            });
                                        },
                                        timeline: entry.timeline,
                                        title: entry.title
                                    };

                                    playlist.push(cell);
                                }
                            });
                        }
                        else {
                            playlist.push(first);
                        }

                        Lampa.Player.play(first);
                        Lampa.Player.playlist(playlist);
                        markViewed(hashFile, item, viewed);
                    }, function (message) {
                        element.loading = false;
                        Lampa.Noty.show(message || translate('online_mod_nolink', 'Failed to fetch link'));
                    });
                });

                componentAppend(item);
                componentContextmenu({
                    item: item,
                    view: view,
                    viewed: viewed,
                    hash_file: hashFile,
                    file: function (call) {
                        getStream(element, function (loaded) {
                            call({
                                file: loaded.stream,
                                quality: loaded.qualitys
                            });
                        }, function () {
                            call({
                                file: '',
                                quality: false
                            });
                        });
                    }
                });
            });

            componentStart(true);
        }

        function componentStart(firstSelect) {
            var selectors;
            var firstItemIndex;

            if (Lampa.Activity.active().activity !== self.activity) return;

            selectors = scroll.render().find('.selector');
            firstItemIndex = panelFilter.render().find('.selector').length;

            if (firstSelect) {
                last = selectors.eq(firstItemIndex)[0] || selectors.eq(0)[0] || false;
            }

            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) {
                        if (scroll.render().find('.selector').slice(firstItemIndex).index(last) === 0 && lastFilter) {
                            Lampa.Controller.collectionFocus(lastFilter, scroll.render());
                        }
                        else Navigator.move('up');
                    }
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else panelFilter.show(translate('title_filter', 'Filter'), 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: self.back
            });
            Lampa.Controller.toggle('content');
        }

        window.addEventListener('resize', minus, false);
        minus();

        this.create = function () {
            this.activity.loader(true);

            panelFilter.onSearch = function (value) {
                Lampa.Activity.replace({
                    search: value,
                    search_date: '',
                    clarification: true
                });
            };

            panelFilter.onBack = function () {
                componentStart();
            };

            panelFilter.render().find('.selector').on('hover:focus', function (event) {
                lastFilter = event.target;
                scroll.update($(event.target), true);
            });

            panelFilter.onSelect = function (type, a, b) {
                if (type !== 'filter') return;

                if (a.reset) {
                    choice = defaultChoice();
                    saveChoice();

                    if (extract.film_id) renderExtract();
                    else {
                        componentReset();
                        panelFilterView();
                        search.call(self);
                    }

                    return;
                }

                choice[a.stype] = b.index;
                if (a.stype === 'voice') choice.voice_name = filterItems.voice[b.index] || '';

                renderExtract();
                setTimeout(Lampa.Select.close, 10);
            };

            files.append(scroll.render());
            scroll.append(panelFilter.render());
            panelFilterView();
            search.call(self);
            return this.render();
        };

        this.render = function () {
            return files.render();
        };

        this.start = function (firstSelect) {
            componentStart(firstSelect);
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            network.clear();
            files.destroy();
            scroll.destroy();
            if (panelFilter.destroy) panelFilter.destroy();
            window.removeEventListener('resize', minus, false);
        };
    }

    function registerManifest() {
        Lampa.Manifest.plugins = {
            type: 'video',
            version: PLUGIN_VERSION,
            name: SOURCE_NAME + ' - ' + PLUGIN_VERSION,
            description: 'Watch on ' + SOURCE_NAME,
            component: COMPONENT_NAME,
            onContextMenu: function () {
                return {
                    name: SOURCE_NAME,
                    description: ''
                };
            },
            onContextLauch: function (object) {
                loadHdRezka(object);
            }
        };
    }

    function addButton() {
        Lampa.Listener.follow('full', function (event) {
            var button;
            var target;
            var movie;

            if (event.type !== 'complite') return;
            if (!event || !event.object || !event.object.activity || !event.object.activity.render) return;

            movie = event.data && event.data.movie;
            if (!movie) return;

            target = event.object.activity.render().find('.view--hdrezka');
            if (target.length) return;

            button = $(
                '<div class="full-start__button selector view--hdrezka" data-subtitle="hdrezka ' + PLUGIN_VERSION + '">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 244 260">' +
                        '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z M228.9,2l8,37.7l0,0 L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88 L2,50.2L47.8,80L10,88z" fill="currentColor"></path>' +
                    '</svg>' +
                    '<span>' + SOURCE_NAME + '</span>' +
                '</div>'
            );

            button.on('hover:enter', function () {
                loadHdRezka(movie);
            });

            target = event.object.activity.render().find('.view--torrent').last();
            if (target.length) target.after(button);
            else event.object.activity.render().find('.full-start-new__buttons,.full-start__buttons,.buttons').first().append(button);
        });
    }

    function addSettings() {
        if (!(Lampa.Settings.main && Lampa.Settings.main())) return;
        if (Lampa.Settings.main().render().find('[data-component="hdrezka"]').length) return;

        var folder = $(
            '<div class="settings-folder selector" data-component="hdrezka">' +
                '<div class="settings-folder__icon">' +
                    '<svg height="260" viewBox="0 0 244 260" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z M228.9,2l8,37.7l0,0 L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88 L2,50.2L47.8,80L10,88z" fill="white"></path>' +
                    '</svg>' +
                '</div>' +
                '<div class="settings-folder__name">' + SOURCE_NAME + '</div>' +
            '</div>'
        );

        Lampa.Settings.main().render().find('[data-component="more"]').after(folder);
        Lampa.Settings.main().update();
    }

    function startPlugin() {
        if (window.hdrezka_lampa_registered) return;

        Lampa.Params.select(MIRROR_STORAGE_KEY, '', '');
        resetTemplates();
        Lampa.Component.add(COMPONENT_NAME, hdrezkaComponent);
        registerManifest();
        addButton();
        addSettings();

        window.hdrezka_lampa_registered = true;
        log('Plugin loaded');
    }

    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') startPlugin();
        });
    }
})();
