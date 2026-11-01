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

    this.plugins = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return json.plugins
            })
        })
    }

    this.licenses = function () {
        return self.me().then(function () {
            return self.data().then(function (json) {
                return json.licenses
            })
        })
    }
}
