(function () {
    'use strict';

    if (window.korean_dramas_plugin_ready) return;
    window.korean_dramas_plugin_ready = true;

    var PLUGIN_ID = 'korean_dramas_menu_plugin';
    var BUTTON_ACTION = 'korean_dramas';
    var SORTS = [
        { title: 'Newest releases', value: 'first_air_date.desc' },
        { title: 'Popularity', value: 'popularity.desc' },
        { title: 'Highest rated', value: 'vote_average.desc' }
    ];
    var CATEGORIES = [
        { title: 'All dramas', value: 'all', genres: '18' },
        { title: 'Comedy', value: 'comedy', genres: '18,35' },
        { title: 'Romance', value: 'romance', genres: '18', keywords: '9840' },
        { title: 'Crime', value: 'crime', genres: '18,80' },
        { title: 'Mystery', value: 'mystery', genres: '18,9648' },
        { title: 'Action & Adventure', value: 'action', genres: '18,10759' },
        { title: 'Sci-Fi & Fantasy', value: 'fantasy', genres: '18,10765' },
        { title: 'Horror', value: 'horror', genres: '18', keywords: '315058|50009|239680|178647|351957' },
        { title: 'Thriller', value: 'thriller', genres: '18', keywords: '316362|12565|302132|319190|351957|217282' }
    ];

    function selectedOption(key, options) {
        var value = Lampa.Storage.get(key, options[0].value);
        return options.filter(function (option) { return option.value === value; })[0] || options[0];
    }

    function showOptions() {
        var sort = selectedOption('korean_dramas_sort', SORTS);
        var category = selectedOption('korean_dramas_category', CATEGORIES);
        Lampa.Select.show({
            title: translate('korean_dramas_title'),
            items: [
                { title: 'Browse', value: 'browse' },
                { title: 'Sort: ' + sort.title, value: 'sort' },
                { title: 'Category: ' + category.title, value: 'category' }
            ],
            onBack: function () { Lampa.Controller.toggle('menu'); },
            onSelect: function (item) {
                if (item.value === 'browse') {
                    Lampa.Controller.toggle('content');
                    return openKoreanDramas();
                }
                var key = 'korean_dramas_' + item.value;
                var options = item.value === 'sort' ? SORTS : CATEGORIES;
                var selected = selectedOption(key, options);
                Lampa.Select.show({
                    title: item.value === 'sort' ? 'Sort' : 'Category',
                    items: options.map(function (option) {
                        return { title: option.title, value: option.value, selected: option.value === selected.value };
                    }),
                    onBack: showOptions,
                    onSelect: function (option) {
                        Lampa.Storage.set(key, option.value);
                        showOptions();
                    }
                });
            }
        });
    }
    // Generated from Lampa's core/tmdb/keys.js and keyword-aliases.json by sync-keywords.js.
    var BLOCKED_KEYWORDS = '108,571,640,824,1013,3183,4569,9331,9833,10180,12648,15130,15136,33998,34115,41515,156331,157096,158718,163037,165614,168812,173662,173669,186621,190751,194530,195624,208798,224000,229325,231075,234700,236972,238059,238355,239239,240109,240305,241179,243575,245045,247821,250606,250937,252375,258533,259285,262497,264386,264411,265777,267923,272066,272617,275157,280179,282251,289844,290527,300642,308815,313433,314127,315279,315382,315385,315665,323678,323690,324058,325223,327908,328728,330531,332049,333766,337198,337238,337387,337701,338720,346492,346769,347179,347864,355464,363397,367576,384569';

    function blockingEnabled() {
        return Lampa.Storage.field('lgbt_content_block') || (Lampa.VPN && Lampa.VPN.is(['ru', 'by']));
    }

    function translate(key) {
        return Lampa.Lang.translate(key) || key;
    }

    function addTranslations() {
        Lampa.Lang.add({
            korean_dramas_menu: {
                en: 'K-Dramas',
                ru: 'K-Dramas',
                uk: 'K-Dramas',
                be: 'K-Dramas',
                ro: 'K-Dramas',
                bg: 'K-Dramas',
                cs: 'K-Dramas',
                fr: 'K-Dramas',
                he: 'K-Dramas',
                pt: 'K-Dramas',
                zh: 'K-Dramas'
            },
            korean_dramas_title: {
                en: 'Korean Dramas',
                ru: 'Korean Dramas',
                uk: 'Korean Dramas',
                be: 'Korean Dramas',
                ro: 'Korean Dramas',
                bg: 'Korean Dramas',
                cs: 'Korean Dramas',
                fr: 'Korean Dramas',
                he: 'Korean Dramas',
                pt: 'Korean Dramas',
                zh: 'Korean Dramas'
            }
        });
    }

    function createButton() {
        return $(
            '<li class="menu__item selector" data-action="' + BUTTON_ACTION + '">' +
                '<div class="menu__ico">' +
                    '<svg><use xlink:href="#sprite-tv"></use></svg>' +
                '</div>' +
                '<div class="menu__text">' + translate('korean_dramas_menu') + '</div>' +
            '</li>'
        );
    }

    function openKoreanDramas() {
        var sort = selectedOption('korean_dramas_sort', SORTS);
        var category = selectedOption('korean_dramas_category', CATEGORIES);
        var now = new Date();
        var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);

        Lampa.Activity.push({
            title: translate('korean_dramas_title') + ' - ' + category.title + ' - ' + sort.title,
            component: 'category_full',
            source: 'tmdb',
            korean_dramas: true,
            page: 1,
            card_type: true,
            url: 'discover/tv',
            genres: category.genres,
            keywords: category.keywords || '',
            orig_lang: 'ko',
            sort_by: sort.value,
            filter: {
                with_origin_country: 'KR',
                'first_air_date.lte': today,
                'vote_count.gte': 1,
                include_null_first_air_dates: false,
                without_keywords: blockingEnabled() ? BLOCKED_KEYWORDS : ''
            }
        });
    }

    function filterBlockedTitles() {
        var nativeList = Lampa.Api.list;

        Lampa.Api.list = function (params, onComplete, onError) {
            var api = this;
            if (!params || !params.korean_dramas) return nativeList.apply(api, arguments);

            function load() {
                return nativeList.call(api, params, function (data) {
                    var blocked = blockingEnabled();
                    var list = window.lampa_settings && window.lampa_settings.lgbt;
                    if (blocked && list && data && Array.isArray(data.results)) {
                        data = Object.assign({}, data, {
                            results: data.results.filter(function (item) { return !list[item.id + '_tv']; })
                        });
                        // Skip fully blocked pages so native pagination can reach the next visible title.
                        if (!data.results.length && (params.page || 1) < data.total_pages) {
                            params.page = (Number(params.page) || 1) + 1;
                            return load();
                        }
                    }
                    onComplete(data);
                }, onError);
            }

            return load();
        };
    }

    function addButton() {
        if ($('.menu .menu__list [data-action="' + BUTTON_ACTION + '"]').length) return;

        var button = createButton();
        var list = $('.menu .menu__list').eq(0);
        var anchor = list.find('[data-action="tv"]');

        button.on('hover:enter', showOptions);

        if (anchor.length) anchor.after(button);
        else list.append(button);
    }

    function init() {
        addTranslations();
        filterBlockedTitles();

        Lampa.Manifest.plugins = {
            type: 'plugin',
            version: '1.5.0',
            name: 'K-Dramas Menu',
            description: 'Shows released Korean dramas using Lampa native TMDB catalogue.',
            component: PLUGIN_ID
        };

        if (window.appready) addButton();
        else {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') addButton();
            });
        }
    }

    init();
})();
