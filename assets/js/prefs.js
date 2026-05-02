// User preference keys stored in CloudStorage (with localStorage fallback).
// Keys: pref:lastPair, pref:lang, pref:theme, pref:lastFromAmount, pref:notificationsOptOut

(function () {
    var MIGRATION_FLAG = 'pref:migrated';
    var PREF_KEYS = ['pref:lastPair', 'pref:lang', 'pref:theme', 'pref:lastFromAmount', 'pref:notificationsOptOut'];

    function cs() {
        return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.CloudStorage;
    }

    function csSet(key, value) {
        return new Promise(function (resolve, reject) {
            cs().setItem(key, value, function (err) {
                if (err) reject(err); else resolve();
            });
        });
    }

    function csGet(key) {
        return new Promise(function (resolve, reject) {
            cs().getItem(key, function (err, value) {
                if (err) reject(err); else resolve(value || null);
            });
        });
    }

    function csRemove(keys) {
        return new Promise(function (resolve, reject) {
            cs().removeItems(keys, function (err) {
                if (err) reject(err); else resolve();
            });
        });
    }

    function migrate() {
        var cloud = cs();
        if (!cloud) return Promise.resolve();

        return new Promise(function (resolve) {
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
                    cloud.setItem(MIGRATION_FLAG, '1', function () {
                        resolve();
                    });
                    return;
                }

                var remaining = keysToMigrate.length;
                keysToMigrate.forEach(function (key) {
                    cloud.setItem(key, values[key], function () {
                        remaining--;
                        if (remaining === 0) {
                            cloud.setItem(MIGRATION_FLAG, '1', function () {
                                keysToMigrate.forEach(function (k) {
                                    localStorage.removeItem(k);
                                });
                                resolve();
                            });
                        }
                    });
                });
            });
        });
    }

    var initPromise = migrate();

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
