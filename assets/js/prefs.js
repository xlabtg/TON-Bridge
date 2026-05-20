// User preference keys stored in CloudStorage (with localStorage fallback).
// Keys: pref:lastPair, pref:lang, pref:theme, pref:lastFromAmount, pref:notificationsOptOut

(function () {
    var MIGRATION_FLAG = 'pref:migrated';
    var PREF_KEYS = ['pref:lastPair', 'pref:lang', 'pref:theme', 'pref:lastFromAmount', 'pref:notificationsOptOut'];

    function cs() {
        // Telegram WebApp 6.0 exposes the CloudStorage object but its methods
        // throw `WebAppMethodUnsupported` synchronously. Gate behind a version
        // check so callers fall back to localStorage instead of dying.
        var wa = window.Telegram && window.Telegram.WebApp;
        if (!wa || !wa.CloudStorage) return null;
        if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('6.1')) return null;
        return wa.CloudStorage;
    }

    function csSet(key, value) {
        return new Promise(function (resolve, reject) {
            try {
                cs().setItem(key, value, function (err) {
                    if (err) reject(err); else resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function csGet(key) {
        return new Promise(function (resolve, reject) {
            try {
                cs().getItem(key, function (err, value) {
                    if (err) reject(err); else resolve(value || null);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function csRemove(keys) {
        return new Promise(function (resolve, reject) {
            try {
                cs().removeItems(keys, function (err) {
                    if (err) reject(err); else resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function migrate() {
        var cloud = cs();
        if (!cloud) return Promise.resolve();

        return new Promise(function (resolve) {
            try {
                cloud.getItem(MIGRATION_FLAG, function (err, done) {
                    if (err || done === '1') {
                        resolve();
                        return;
                    }

                    var keysToMigrate = [];
                    var values = {};
                    PREF_KEYS.forEach(function (key) {
                        var val = localStorage.getItem(key);
                        if (val !== null) {
                            keysToMigrate.push(key);
                            values[key] = val;
                        }
                    });

                    if (keysToMigrate.length === 0) {
                        try {
                            cloud.setItem(MIGRATION_FLAG, '1', function () {
                                resolve();
                            });
                        } catch (e) { resolve(); }
                        return;
                    }

                    var remaining = keysToMigrate.length;
                    keysToMigrate.forEach(function (key) {
                        try {
                            cloud.setItem(key, values[key], function () {
                                remaining--;
                                if (remaining === 0) {
                                    try {
                                        cloud.setItem(MIGRATION_FLAG, '1', function () {
                                            keysToMigrate.forEach(function (k) {
                                                localStorage.removeItem(k);
                                            });
                                            resolve();
                                        });
                                    } catch (e) { resolve(); }
                                }
                            });
                        } catch (e) {
                            remaining--;
                            if (remaining === 0) resolve();
                        }
                    });
                });
            } catch (e) {
                resolve();
            }
        });
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
            return initPromise.then(function () {
                return new Promise(function (resolve) {
                    if (value === null || value === undefined) {
                        localStorage.removeItem(key);
                        if (cs()) {
                            csRemove([key]).catch(function () {}).then(resolve);
                        } else {
                            resolve();
                        }
                        return;
                    }
                    if (cs()) {
                        localStorage.removeItem(key);
                        csSet(key, value).catch(function () {
                            localStorage.setItem(key, value);
                        }).then(resolve);
                    } else {
                        localStorage.setItem(key, value);
                        resolve();
                    }
                });
            });
        },

        init: function () {
            return initPromise;
        },
    };

    window.prefs = prefs;
})();
