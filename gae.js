(function () {
    'use strict';

    var STORAGE_KEY = 'lgbt_content_block';
    var LABEL = 'Gae Porn for Alex';
    var registered = false;
    var attempts = 0;

    function defaultValue(Lampa) {
        try {
            return !!(Lampa.VPN && Lampa.VPN.is && Lampa.VPN.is(['ru', 'by']));
        } catch (e) {
            return false;
        }
    }

    function registerToggle() {
        var Lampa = window.Lampa;

        if (registered || !Lampa || !Lampa.SettingsApi) return;
        if (!Lampa.SettingsApi.addParam) return;

        registered = true;

        Lampa.SettingsApi.addParam({
            component: 'more',
            param: {
                name: STORAGE_KEY,
                type: 'trigger',
                default: defaultValue(Lampa)
            },
            field: {
                name: LABEL
            },
            onChange: function (value) {
                if (Lampa.Storage && Lampa.Storage.set) {
                    Lampa.Storage.set(STORAGE_KEY, value === true || value === 'true');
                }
            }
        });
    }

    function waitForReady() {
        var Lampa = window.Lampa;

        if (!Lampa) {
            attempts++;
            if (attempts < 40) setTimeout(waitForReady, 250);
            return;
        }

        if (window.appready) {
            registerToggle();
            return;
        }

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('app', function (event) {
                if (event && event.type === 'ready') registerToggle();
            });
        }
    }

    waitForReady();
})();
