// SPDX-FileCopyrightText: 2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * MOCK of what the sign-in and account windows ask the MOD cloud.
 *
 * The browser talks to the cloud (see authenticateDevice in desktop.js), so the
 * mock lives in the browser too: the data is mock/auth.json and the "session" is a
 * localStorage key. Nothing is sent anywhere.
 *
 * It is the one place to replace when js/auth.js gets the real calls. Every method
 * returns a promise, and a failure carries an error code, not an HTTP response:
 *
 *   requestCode(email)        MOD API: POST /users/tokens_magiclink
 *   verifyCode(email, code)   MOD API: POST /users/tokens_magiclink/verify_code
 *   me()                      MOD API: GET /admin/me
 *   logout()                  MOD API: POST /users/tokens/logout
 *   devices()                 MOD API: the EndCustomerDevices of the person (endpoint and shape to confirm)
 *   plugins()                 MOD API: GET /v2/devices/plugins
 *   licenses()                MOD API: not served yet (see mock/auth.json)
 *   pedalboards()             MOD API: GET /v2/pedalboards/, the ones this person shared (no filter by person yet)
 *   unshare(id)               MOD API: nothing removes a pedalboard yet
 *   builds()                  mod-pipeline: GET /bundle/ and /bundle/{id}, the ones this person built (no filter by person yet)
 *   install(uri)              Not the cloud's: the device installing a plugin it has the license of. Simulated
 *                             here; the real one is desktop.installationQueue.installUsingURI(uri, 'auto', ...)
 *   open(pedalboard_id)       Not the cloud's either: loads a shared pedalboard on this device. Simulated here; the
 *                             real one is desktop.loadRemotePedalboard(pedalboard_id)
 *
 * Error codes: invalid_email, invalid_code, rate_limited, not_authenticated.
 *
 * To try it: any e-mail address, then the code in mock/auth.json ("123456").
 */

function AuthMockApi() {
    var self = this

    var STORAGE_KEY = 'modui-auth-mock'
    var MAX_WRONG_CODES = 5

    var wrongCodes = {}
    var installed = {}
    var unshared = {}
    var data = null

    // mock/auth.json, read once
    this.data = function () {
        if (!data) {
            data = $.ajax({
                url: 'mock/auth.json',
                dataType: 'json',
                cache: false,
                global: false,
            }).then(null, function () {
                return 'unavailable'
            })
        }
        return data
    }

    var fail = function (code) {
        return $.Deferred().reject(code).promise()
    }

    var signedInEmail = function () {
        try {
            return localStorage.getItem(STORAGE_KEY)
        } catch (e) {
            return null
        }
    }

    var remember = function (email) {
        try {
            if (email) {
                localStorage.setItem(STORAGE_KEY, email)
            } else {
                localStorage.removeItem(STORAGE_KEY)
            }
        } catch (e) {
            // No storage (private window): the session lasts until the page is closed
            self.email = email
        }
    }

    this.requestCode = function (email) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return fail('invalid_email')
        }
        wrongCodes[email] = 0
        return self.data().then(function (json) {
            console.log("[auth mock] code for " + email + ": " + json.code)
        })
    }

    this.verifyCode = function (email, code) {
        if (!(email in wrongCodes)) {
            return fail('invalid_code')
        }
        return self.data().then(function (json) {
            if (wrongCodes[email] >= MAX_WRONG_CODES) {
                return $.Deferred().reject('rate_limited')
            }
            if (code !== json.code) {
                wrongCodes[email]++
                return $.Deferred().reject('invalid_code')
            }
            delete wrongCodes[email]
            remember(email)
        })
    }

    this.me = function () {
        var email = signedInEmail() || self.email
        if (!email) {
            return fail('not_authenticated')
        }
        return self.data().then(function (json) {
            return {
                user_id: json.user_id,
                email: email,
                name: email.split('@')[0],
                // d=404: no Gravatar, no picture, and the initial shows
                picture: 'https://gravatar.com/avatar/' + CryptoJS.SHA256(email).toString() + '?s=128&d=404',
            }
        })
    }

    this.logout = function () {
        remember(null)
        self.email = null
        return $.Deferred().resolve().promise()
    }

    this.devices = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return json.devices
            })
        })
    }

    // What this device has: the plugins of mock/auth.json, and what was "installed" since (owned, so on the seat)
    this.plugins = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                var items = json.plugins.slice()
                $.each(json.licenses, function (i, held) {
                    if (!installed[held.plugin_uri]) {
                        return
                    }
                    var evidence = held.evidences[0]
                    items.push({
                        device: json.plugins[0].device,
                        plugin: held.plugin,
                        owner: { end_customer_id: json.user_id, device_id: null },
                        origin: 'end_customer',
                        license: { id: 'lic_' + held.plugin.id, order_number: evidence.evidence, created: evidence.acquired_at, masked_email: null },
                        seats: { seat_id: 'seat_' + held.plugin.id, active: true, total_seats: held.total_seats, seats_in_use: held.seats_in_use + 1, seats_available: held.seats_available - 1 },
                        purchase: { evidence_id: evidence.id, source: evidence.source, evidence: evidence.evidence, acquired_at: evidence.acquired_at },
                    })
                })
                return items
            })
        })
    }

    this.pedalboards = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return $.grep(json.pedalboards, function (board) { return !unshared[board.id] })
            })
        })
    }

    this.unshare = function (id) {
        return self.me().then(function () {
            return self.delay().then(function () {
                unshared[id] = true
            })
        })
    }

    this.builds = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return json.builds
            })
        })
    }

    // The device loading a pedalboard: nothing to wait for here but the time it takes
    this.open = function (id) {
        return self.delay()
    }

    this.delay = function () {
        var done = $.Deferred()
        setTimeout(done.resolve, 600 + Math.random() * 800)
        return done.promise()
    }

    this.install = function (uri) {
        var done = $.Deferred()
        setTimeout(function () {
            installed[uri] = true
            done.resolve()
        }, 800 + Math.random() * 1200)
        return done.promise()
    }

    this.licenses = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return json.licenses
            })
        })
    }
}
