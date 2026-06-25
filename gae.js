(function () {
    'use strict';

    var STORAGE_KEY = 'lgbt_content_block';
    var TOGGLE_KEY = 'gae_porn_for_alex_enabled';
    var LABEL = 'Gae Porn for Alex';
    var registered = false;
    var attempts = 0;

    function isEnabled(value) {
        return value === true || value === 'true' || value === 1 || value === '1';
    }

    function isLgbtRegionCheck(regions) {
        return regions &&
            regions.length === 2 &&
            regions.indexOf('ru') >= 0 &&
            regions.indexOf('by') >= 0;
    }

    function patchVpnCheck(Lampa, enabled) {
        if (!Lampa.VPN || !Lampa.VPN.is) return;

        if (!Lampa.VPN.__gae_original_is) {
            Lampa.VPN.__gae_original_is = Lampa.VPN.is;
        }

        Lampa.VPN.__gae_lgbt_enabled = enabled;
        Lampa.VPN.is = function (regions) {
            if (Lampa.VPN.__gae_lgbt_enabled && isLgbtRegionCheck(regions)) {
                return false;
            }

            return Lampa.VPN.__gae_original_is.apply(this, arguments);
        };
    }

    function patchStorageField(Lampa, enabled) {
        if (!Lampa.Storage || !Lampa.Storage.field) return;

        if (!Lampa.Storage.__gae_original_field) {
            Lampa.Storage.__gae_original_field = Lampa.Storage.field;
        }

        Lampa.Storage.__gae_lgbt_enabled = enabled;
        Lampa.Storage.field = function (name) {
            if (Lampa.Storage.__gae_lgbt_enabled && name === STORAGE_KEY) {
                return false;
            }

            return Lampa.Storage.__gae_original_field.apply(this, arguments);
        };
    }

    function applyToggleValue(Lampa, value) {
        var enabled = isEnabled(value);

        patchVpnCheck(Lampa, enabled);
        patchStorageField(Lampa, enabled);

        if (Lampa.Storage && Lampa.Storage.set) {
            Lampa.Storage.set(STORAGE_KEY, !enabled);
        }
    }

    function getToggleValue(Lampa) {
        var enabled = defaultToggleValue(Lampa);

        if (Lampa.Storage && Lampa.Storage.get) {
            enabled = Lampa.Storage.get(TOGGLE_KEY, enabled);
        }

        return enabled;
    }

    function defaultBlockValue(Lampa) {
        try {
            return !!(Lampa.VPN && Lampa.VPN.is && Lampa.VPN.is(['ru', 'by']));
        } catch (e) {
            return false;
        }
    }

    function defaultToggleValue(Lampa) {
        var blocked = defaultBlockValue(Lampa);

        if (Lampa.Storage && Lampa.Storage.get) {
            blocked = Lampa.Storage.get(STORAGE_KEY, blocked);
        }

        return !blocked;
    }

    function registerToggle() {
        var Lampa = window.Lampa;

        if (registered || !Lampa || !Lampa.SettingsApi) return;
        if (!Lampa.SettingsApi.addParam) return;

        registered = true;

        applyToggleValue(Lampa, getToggleValue(Lampa));
        setTimeout(function () {
            applyToggleValue(Lampa, getToggleValue(Lampa));
        }, 1000);

        Lampa.SettingsApi.addParam({
            component: 'more',
            param: {
                name: TOGGLE_KEY,
                type: 'trigger',
                default: defaultToggleValue(Lampa)
            },
            field: {
                name: LABEL
            },
            onChange: function (value) {
                applyToggleValue(Lampa, value);
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
