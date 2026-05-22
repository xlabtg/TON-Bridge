// User preference keys stored in CloudStorage (with localStorage fallback).
// Keys: pref:lastPair, pref:lang, pref:theme, pref:lastFromAmount, pref:notificationsOptOut

(function () {
    var MIGRATION_FLAG = 'pref:migrated';
    var PREF_KEYS = ['pref:lastPair', 'pref:lang', 'pref:theme', 'pref:lastFromAmount', 'pref:notificationsOptOut'];
    var DEFAULT_CLOUD_STORAGE_TIMEOUT_MS = 1500;

    function cloudStorageTimeoutMs() {
        var configured = Number(window.__prefsCloudStorageTimeoutMs);
        return configured > 0 ? configured : DEFAULT_CLOUD_STORAGE_TIMEOUT_MS;
    }

    function cs() {
        // Telegram WebApp 6.0 exposes the CloudStorage object but its methods
        // throw `WebAppMethodUnsupported` synchronously. Gate behind a version
        // check so callers fall back to localStorage instead of dying.
        var wa = window.Telegram && window.Telegram.WebApp;
        if (!wa || !wa.CloudStorage) return null;
        if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('6.1')) return null;
        return wa.CloudStorage;
    }

    function finishable(resolve, reject) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            reject(new Error('cloud_storage_timeout'));
        }, cloudStorageTimeoutMs());

        return function (err, value) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (err) reject(err); else resolve(value);
        };
    }

    function csSet(key, value) {
        return new Promise(function (resolve, reject) {
            var done = finishable(resolve, reject);
            try {
                var cloud = cs();
                if (!cloud || typeof cloud.setItem !== 'function') throw new Error('cloud_storage_unavailable');
                cloud.setItem(key, value, done);
            } catch (e) {
                done(e);
            }
        });
    }

    function csGet(key) {
        return new Promise(function (resolve, reject) {
            var done = finishable(resolve, reject);
            try {
                var cloud = cs();
                if (!cloud || typeof cloud.getItem !== 'function') throw new Error('cloud_storage_unavailable');
                cloud.getItem(key, function (err, value) {
                    done(err, value || null);
                });
            } catch (e) {
                done(e);
            }
        });
    }

    function csRemove(keys) {
        return new Promise(function (resolve, reject) {
            var done = finishable(resolve, reject);
            try {
                var cloud = cs();
                if (!cloud || typeof cloud.removeItems !== 'function') throw new Error('cloud_storage_unavailable');
                cloud.removeItems(keys, done);
            } catch (e) {
                done(e);
            }
        });
    }

    function migrate() {
        var cloud = cs();
        if (!cloud) return Promise.resolve();

        return csGet(MIGRATION_FLAG).then(function (done) {
            if (done === '1') return;

            var keysToMigrate = [];
            var values = {};
            PREF_KEYS.forEach(function (key) {
                var val = null;
                try { val = localStorage.getItem(key); } catch (e) {}
                if (val !== null) {
                    keysToMigrate.push(key);
                    values[key] = val;
                }
            });

            if (keysToMigrate.length === 0) {
                return csSet(MIGRATION_FLAG, '1').catch(function () {});
            }

            return Promise.all(keysToMigrate.map(function (key) {
                return csSet(key, values[key]);
            })).then(function () {
                return csSet(MIGRATION_FLAG, '1');
            }).then(function () {
                keysToMigrate.forEach(function (key) {
                    try { localStorage.removeItem(key); } catch (e) {}
                });
            }).catch(function () {});
        }).catch(function () {});
    }

    // telegram-web-app.js is loaded with `defer`, so it executes after parsing
    // finishes but before DOMContentLoaded. Wait for that event so CloudStorage
    // is available; otherwise migrate() would always fall back to localStorage.
    var initPromise = new Promise(function (resolve) {
        function start() { migrate().then(resolve, resolve); }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    });

    var prefs = {
        get: function (key) {
            return initPromise.then(function () {
                return new Promise(function (resolve) {
                    if (cs()) {
                        csGet(key).then(function (val) {
                            if (val !== null && val !== '') {
                                resolve(val);
                            } else {
                                resolve(localStorage.getItem(key));
                            }
                        }).catch(function () {
                            resolve(localStorage.getItem(key));
                        });
                    } else {
                        resolve(localStorage.getItem(key));
                    }
                });
            });
        },

        set: function (key, value) {
            var shouldRemove = value === null || value === undefined;
            if (shouldRemove) {
                try { localStorage.removeItem(key); } catch (e) {}
            } else {
                try { localStorage.setItem(key, value); } catch (e) {}
            }

            return initPromise.then(function () {
                if (shouldRemove) {
                    if (cs()) return csRemove([key]).catch(function () {});
                    return;
                }

                if (!cs()) {
                    try { localStorage.setItem(key, value); } catch (e) {}
                    return;
                }

                return csSet(key, value).then(function () {
                    try { localStorage.removeItem(key); } catch (e) {}
                }).catch(function () {
                    try { localStorage.setItem(key, value); } catch (e) {}
                });
            });
        },

        init: function () {
            return initPromise;
        },
    };

    window.prefs = prefs;
})();
