// SPDX-FileCopyrightText: 2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Sign-in and account.
 *
 * The button of the main menu opens one of two windows:
 *
 *  - signed out: the sign-in window. The person gives an e-mail, receives a
 *    6-digit code there and types it. No password, no redirect: the same flow as
 *    the MOD dashboard, minus Google.
 *  - signed in: the account window, with the plugins of the person and of this
 *    device. The button then shows the person's Gravatar.
 *
 * What it asks of the MOD cloud goes through `options.api` (see js/auth-mock.js for
 * the calls and the error codes). Until the cloud serves them that is a mock, fed
 * by mock/auth.json.
 */

function Auth(options) {
    var self = this

    options = $.extend({
        icon: $('<button>'), // the button of the main menu
        api: new AuthMockApi(),
    }, options)

    var api = options.api

    var SIGN_IN_MESSAGE = "Sign in to access all MOD Cloud functionalities"

    // What the person sees for the error codes of the service
    var ERRORS = {
        invalid_email: "Please enter a valid e-mail address.",
        invalid_code: "Invalid or expired code.",
        rate_limited: "Too many attempts. Please try again later.",
    }

    // Labels for the order numbers of licenses that come with the device
    var INCLUDED_LABELS = {
        marketing: "promotional",
        crowdfunding: "crowdfunding",
    }

    this.user = null

    // The message to show for the error code of a failed call
    this.errorMessage = function (code) {
        return ERRORS[code] || "Something went wrong. Please try again."
    }

    // Button ----------------------------------------------------------------

    this.setUser = function (user) {
        self.user = user
        options.icon.removeClass('mod-hidden').empty()

        if (!user) {
            options.icon.removeClass('auth-signed-in')
            options.icon.append($('<span>').text("Sign-in"))
            options.icon.statusTooltip('message', SIGN_IN_MESSAGE, true)
            return
        }

        // The initial stays under the picture, and shows when there is none (Gravatar answers 404)
        var avatar = $('<span class="auth-avatar">').append($('<span class="auth-initial">').text(user.name.charAt(0)))
        $('<img aria-hidden="true">').appendTo(avatar)
            .on('error', function () { $(this).remove() })
            .attr('src', user.picture)

        options.icon.addClass('auth-signed-in').append(avatar)
        // The tooltip takes HTML
        options.icon.statusTooltip('message', "Signed in as " + $('<div>').text(user.email).html(), true)
    }

    options.icon.click(function () {
        if (self.user) {
            self.openAccount()
        } else {
            self.openLogin()
        }
        return false
    })

    // Windows ---------------------------------------------------------------

    // The elements of a template (trimmed: jQuery takes a string that starts with a blank for a selector)
    this.render = function (template, data) {
        return $($.trim(Mustache.render(TEMPLATES[template], data || {})))
    }

    // Renders a template as a window over everything; closes on its x, on a click outside the card, and on Escape
    this.openWindow = function (template, data) {
        var win = self.render(template, data).appendTo('body')

        var close = function () {
            win.remove()
            $(document).off('keydown.auth')
        }
        win.close = close

        win.find('.js-close').click(function () {
            close()
            return false
        })
        win.click(function (e) {
            if ($(e.target).closest('.auth-card').length === 0) {
                close()
            }
        })
        $(document).on('keydown.auth', function (e) {
            if (e.keyCode == 27) {
                close()
            }
        })

        return win
    }

    // Sign in ---------------------------------------------------------------

    this.openLogin = function () {
        var win = self.openWindow('auth_login')
        var emailForm = win.find('.js-email-form')
        var codeForm = win.find('.js-code-form')
        var email = ''

        // A step is "busy" while its request is on the way
        var send = function (form, request, success) {
            var submit = form.find('.js-submit')
            var error = form.find('.js-error')

            error.text('')
            submit.prop('disabled', true)

            request().done(success).fail(function (code) {
                error.text(self.errorMessage(code))
            }).always(function () {
                submit.prop('disabled', false)
            })
        }

        var showEmailStep = function () {
            codeForm.hide()
            emailForm.show()
            emailForm.find('.js-email').focus()
        }

        var showCodeStep = function () {
            emailForm.hide()
            codeForm.find('.js-sent-to').text(email)
            codeForm.find('.js-code').val('')
            codeForm.find('.js-error').text('')
            codeForm.show()
            codeForm.find('.js-code').focus()
        }

        emailForm.submit(function () {
            email = $.trim(emailForm.find('.js-email').val()).toLowerCase()
            if (!email) {
                return false
            }
            send(emailForm, function () {
                return api.requestCode(email)
            }, showCodeStep)
            return false
        })

        codeForm.find('.js-code').on('input', function () {
            $(this).val($(this).val().replace(/\D/g, ''))
        })

        codeForm.submit(function () {
            var code = codeForm.find('.js-code').val()
            if (!/^[0-9]{6}$/.test(code)) {
                codeForm.find('.js-error').text(ERRORS.invalid_code)
                return false
            }
            send(codeForm, function () {
                return api.verifyCode(email, code)
            }, function () {
                self.load(function () {
                    win.close()
                })
            })
            return false
        })

        codeForm.find('.js-back').click(function () {
            showEmailStep()
            return false
        })

        showEmailStep()
    }

    // Account ---------------------------------------------------------------

    this.openAccount = function () {
        var win = self.openWindow('auth_account')

        win.find('.js-email').text(self.user.email)

        win.find('.js-logout').click(function () {
            api.logout().always(function () {
                self.setUser(null)
                win.close()
            })
            return false
        })

        // The plugins of the device are the point of the window; the licenses only add what is not here
        var plugins = api.plugins()
        var licenses = api.licenses()

        plugins.done(function (items) {
            licenses.done(function (held) {
                self.renderAccount(win, items, held)
            }).fail(function () {
                self.renderAccount(win, items, null)
            })
        }).fail(function (code) {
            win.find('.js-loading').hide()
            win.find('.js-error').text(self.errorMessage(code))
        })
    }

    this.renderAccount = function (win, items, held) {
        var me = self.user.user_id
        var onDevice = {}
        $.each(items, function (i, item) {
            onDevice[item.plugin.uri] = true
        })

        var mine = $.grep(items, function (i) { return i.origin == 'end_customer' && i.owner.end_customer_id == me })
        var others = $.grep(items, function (i) { return i.origin == 'end_customer' && i.owner.end_customer_id != me })
        var included = $.grep(items, function (i) { return i.origin == 'device_only' })
        // What the person has and this device does not (`held` is null when that list could not be read)
        var elsewhere = $.grep(held || [], function (l) { return !onDevice[l.plugin_uri] })

        var sections = [
            {
                kind: 'mine', title: "Yours, and working on this unit",
                items: $.map(mine, function (i) {
                    return self.row(i.plugin, {
                        detail: self.bought(i.purchase) + " · " + self.seats(i.seats),
                        label: i.purchase && i.purchase.evidence,
                    })
                }),
            },
            {
                kind: 'elsewhere', title: "Yours, but not on this unit",
                items: $.map(elsewhere, function (l) {
                    return self.row(l.plugin, {
                        absent: true,
                        detail: self.bought(l.evidences[0]) + " · " + (l.seats_in_use ? self.seats(l) : "not in use"),
                        action: 'install', actionText: "Install here",
                    })
                }),
            },
            {
                kind: 'others', title: "On this unit, but we don't know they're yours",
                note: "These keep working either way. Confirming them lets you reinstall them on another unit later.",
                items: $.map(others, function (i) {
                    return self.row(i.plugin, {
                        detail: self.bought(i.purchase) + (i.license.masked_email ? " with " + i.license.masked_email : ""),
                        action: 'claim', actionText: "This is mine", disabled: true,
                    })
                }),
            },
            {
                kind: 'included', title: "Included with this device · stays with the unit",
                items: $.map(included, function (i) {
                    return self.row(i.plugin, {
                        label: INCLUDED_LABELS[i.license.order_number] || i.license.order_number,
                    })
                }),
            },
        ]

        var container = win.find('.js-sections').empty()
        $.each(sections, function (i, section) {
            if (section.items.length == 0) {
                return
            }
            var box = $('<section class="auth-section auth-section-' + section.kind + '">').appendTo(container)
            box.append($('<h3>').text(section.title))
            if (section.note) {
                box.append($('<p class="auth-section-note">').text(section.note))
            }
            $.each(section.items, function (j, row) {
                box.append(row)
            })
        })

        if (container.children().length == 0) {
            container.append($('<p class="auth-loading">').text("No plugins to show for this unit yet."))
        }

        if (items.length) {
            var device = items[0].device
            win.find('.js-device').text(self.capitalize(device.platform) + " · #" + device.tag.replace(/^\w+-/, ''))
        }
        if (held) {
            win.find('.js-summary').text(mine.length + " of " + held.length + " plugins on this unit")
        } else {
            win.find('.js-summary').hide()
        }
        win.find('.js-loading').hide()

        // "Install here" takes the person to the Plugin Store
        container.find('.js-action[data-action=install]').click(function () {
            win.close()
            $('#mod-cloud-plugins').click()
            return false
        })
    }

    // A plugin row, with its picture on top of the initials: the picture comes from this device (/effect/image),
    // then from the thumbnail the service gave, and the initials stay when neither exists
    this.row = function (plugin, extra) {
        var name = plugin.name || plugin.uri
        var html = self.render('auth_plugin', $.extend({
            name: name,
            uri: plugin.uri,
            initials: self.initials(name),
            color: self.color(name),
        }, extra))

        var src = extra.absent ? plugin.thumbnail_href : "/effect/image/thumbnail.png?uri=" + escape(plugin.uri)
        if (src) {
            $('<img aria-hidden="true">').appendTo(html.find('.auth-thumb'))
                .on('error', function () { $(this).remove() })
                .attr('src', src)
        }
        return html
    }

    // Texts -----------------------------------------------------------------

    this.bought = function (purchase) {
        if (!purchase || !purchase.acquired_at) {
            return "purchase date unknown"
        }
        // The interface is in English whatever the language of the browser
        return "bought " + new Date(purchase.acquired_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
        })
    }

    this.seats = function (seats) {
        return seats ? seats.seats_in_use + " of " + seats.total_seats + " seats in use" : "no seats"
    }

    this.initials = function (name) {
        var words = name.replace(/[^\w\s]/g, '').split(/\s+/)
        return (words[0].charAt(0) + (words.length > 1 ? words[1].charAt(0) : '')).toUpperCase()
    }

    // The same name always gets the same, muted, color
    this.color = function (name) {
        var hash = 0
        for (var i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) % 360
        }
        return 'hsl(' + hash + ', 35%, 32%)'
    }

    this.capitalize = function (text) {
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
    }

    // Starts ----------------------------------------------------------------

    // Reads who is signed in; `done` runs when there is someone
    this.load = function (done) {
        return api.me().done(function (user) {
            self.setUser(user)
            if (done) {
                done()
            }
        }).fail(function (code) {
            // Nobody is signed in: the button offers it. Any other failure: no button.
            if (code == 'not_authenticated') {
                self.setUser(null)
            }
        })
    }

    this.load()
}
