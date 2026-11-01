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

    // What each platform of the service is called, and its picture (img/devices, WebP)
    var DEVICES = {
        duo: {model: "MOD Duo", image: "img/devices/duo.webp"},
        duox: {model: "MOD Duo X", image: "img/devices/duox.webp"},
        dwarf: {model: "MOD Dwarf", image: "img/devices/dwarf.webp"},
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
            var view = win.find('.auth-view-licenses')
            view.find('.js-loading').hide()
            view.find('.js-error').text(self.errorMessage(code))
        })

        // The menu: one view at a time. The devices are asked for when first looked at.
        var devicesAsked = false
        win.find('.auth-nav-item').click(function () {
            var name = $(this).attr('data-view')
            win.find('.auth-nav-item').removeClass('active')
            $(this).addClass('active')
            win.find('.auth-view').removeClass('active').filter('.auth-view-' + name).addClass('active')

            if (name == 'devices' && !devicesAsked) {
                devicesAsked = true
                // Which of the devices is this one is told by the plugins of this unit
                plugins.always(function () {
                    self.loadDevices(win, plugins)
                })
            }
            return false
        })
    }

    // The devices of the person, as cards; the one this interface runs on is marked
    this.loadDevices = function (win, plugins) {
        var view = win.find('.auth-view-devices')
        var current = null
        plugins.done(function (items) {
            current = items.length ? items[0].device.id : null
        })

        api.devices().done(function (devices) {
            var grid = view.find('.js-devices').empty()
            $.each(devices, function (i, device) {
                var known = DEVICES[device.platform] || {}
                var card = self.render('auth_device', {
                    model: known.model || self.capitalize(device.platform),
                    image: known.image,
                    tag: device.tag,
                    added: device.registered_at ? "added " + self.date(device.registered_at) : "",
                    current: device.id == current,
                })
                // Without the picture, the name stays
                card.find('img').on('error', function () {
                    $(this).replaceWith($('<span class="auth-device-fallback">').text(known.model))
                })
                grid.append(card)
            })

            if (devices.length == 0) {
                grid.append($('<p class="auth-loading">').text("No devices linked to your account yet."))
            }
            view.find('.js-count').text(devices.length + (devices.length == 1 ? " device" : " devices"))
        }).fail(function (code) {
            view.find('.js-error').text(self.errorMessage(code))
        }).always(function () {
            view.find('.js-loading').hide()
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

        // `title` explains the group in the list; `filter` is the short name on its chip; `badge` tags each card
        var sections = [
            {
                kind: 'mine', title: "Yours, and working on this unit", filter: "Yours",
                items: $.map(mine, function (i) {
                    return self.row(i.plugin, {
                        kind: 'mine', badge: "Installed",
                        detail: self.bought(i.purchase),
                        meta: self.seats(i.seats),
                        label: i.purchase && i.purchase.evidence,
                    })
                }),
            },
            {
                kind: 'elsewhere', title: "Yours, but not on this unit", filter: "Not installed",
                items: $.map(elsewhere, function (l) {
                    return self.row(l.plugin, {
                        kind: 'elsewhere', badge: "Not installed", absent: true,
                        detail: self.bought(l.evidences[0]),
                        meta: l.seats_in_use ? self.seats(l) : "not in use",
                        action: 'install', actionText: "Install here",
                    })
                }),
            },
            {
                kind: 'others', title: "On this unit, but we don't know they're yours", filter: "To confirm",
                note: "These keep working either way. Confirming them lets you reinstall them on another unit later.",
                items: $.map(others, function (i) {
                    return self.row(i.plugin, {
                        kind: 'others', badge: "To confirm",
                        detail: self.bought(i.purchase) + (i.license.masked_email ? " with " + i.license.masked_email : ""),
                        action: 'claim', actionText: "This is mine", disabled: true,
                    })
                }),
            },
            {
                kind: 'included', title: "Included with this device · stays with the unit", filter: "Device",
                items: $.map(included, function (i) {
                    return self.row(i.plugin, {
                        kind: 'included', badge: "Device",
                        label: INCLUDED_LABELS[i.license.order_number] || i.license.order_number,
                    })
                }),
            },
        ]

        var container = win.find('.js-sections').empty()
        var filters = win.find('.js-filters').empty()
        var shown = $.grep(sections, function (section) { return section.items.length > 0 })

        $.each(shown, function (i, section) {
            var box = $('<section class="auth-section auth-section-' + section.kind + '">').appendTo(container)
            box.append($('<h3>').text(section.title))
            if (section.note) {
                box.append($('<p class="auth-section-note">').text(section.note))
            }
            var grid = $('<div class="auth-grid">').appendTo(box)
            $.each(section.items, function (j, row) {
                grid.append(row)
            })
        })

        // The chips filter by group; with a single group there is nothing to choose
        if (shown.length > 1) {
            var total = 0
            var chips = []
            $.each(shown, function (i, section) {
                total += section.items.length
                chips.push({kind: section.kind, filter: section.filter, count: section.items.length})
            })
            chips.unshift({kind: 'all', filter: "All", count: total})
            $.each(chips, function (i, chip) {
                $('<button type="button" class="auth-chip auth-chip-' + chip.kind + '">')
                    .attr('data-kind', chip.kind)
                    .append($('<span>').text(chip.filter))
                    .append($('<b>').text(chip.count))
                    .appendTo(filters)
            })
            filters.on('click', '.auth-chip', function () {
                var kind = $(this).attr('data-kind')
                filters.find('.auth-chip').removeClass('active').attr('aria-pressed', 'false')
                $(this).addClass('active').attr('aria-pressed', 'true')
                container.find('.auth-section').each(function () {
                    $(this).toggle(kind == 'all' || $(this).hasClass('auth-section-' + kind))
                })
                win.find('.auth-view-licenses .auth-account-body').scrollTop(0)
            })
            filters.find('.auth-chip-all').click()
        } else {
            filters.hide()
        }

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
        win.find('.auth-view-licenses .js-loading').hide()

        // "Install here" takes the person to the Plugin Store
        container.find('.js-action[data-action=install]').click(function () {
            win.close()
            $('#mod-cloud-plugins').click()
            return false
        })
    }

    // A plugin card. The picture is the plugin's screenshot (the thumbnail is too small for a card): from this
    // device (/effect/image), or from what the service gave for a plugin that is not here. The name is written on
    // the tile and the picture stands over it, so the name is what shows when there is no picture.
    this.row = function (plugin, extra) {
        var name = plugin.name || plugin.uri
        var html = self.render('auth_plugin', $.extend({
            name: name,
            longName: name.length > 14,
            brand: plugin.brand,
            uri: plugin.uri,
        }, extra))

        var thumb = html.find('.auth-thumb')
        thumb.css('background', self.background(self.hue(name), 0.2))

        var src = extra.absent ? (plugin.screenshot_href || plugin.thumbnail_href) : "/effect/image/screenshot.png?uri=" + escape(plugin.uri)
        if (src) {
            $('<img aria-hidden="true">').appendTo(thumb)
                .on('error', function () { $(this).remove() })
                .on('load', function () {
                    var tint = self.dominantColor(this)
                    if (tint) {
                        thumb.css('background', self.background(tint.hue, tint.saturation))
                    }
                })
                .attr('src', src)
        }
        return html
    }

    // The color of a plugin, as its picture says: the hue its colored pixels lean to and how colored they are.
    // Null when the browser does not let the picture be read.
    this.dominantColor = function (img) {
        var size = 24
        try {
            var canvas = document.createElement('canvas')
            canvas.width = canvas.height = size
            var context = canvas.getContext('2d')
            context.drawImage(img, 0, 0, size, size)
            var pixels = context.getImageData(0, 0, size, size).data
        } catch (e) {
            return null
        }

        var x = 0, y = 0, chroma = 0, count = 0
        for (var i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 200) {
                continue // the empty corners of the picture
            }
            var r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255
            var max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
            var hue = 0
            if (delta > 0) {
                if (max == r) {
                    hue = ((g - b) / delta) % 6
                } else if (max == g) {
                    hue = (b - r) / delta + 2
                } else {
                    hue = (r - g) / delta + 4
                }
            }
            // The more colored a pixel, the more it counts for the hue
            x += delta * Math.cos(hue * Math.PI / 3)
            y += delta * Math.sin(hue * Math.PI / 3)
            chroma += delta
            count++
        }
        if (count == 0) {
            return null
        }
        return {
            hue: Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360),
            saturation: Math.min(0.55, chroma / count * 1.6),
        }
    }

    // A light tile of the color, so the plugin stands out of it whatever its own colors
    this.background = function (hue, saturation) {
        var color = function (lightness) {
            return 'hsl(' + hue + ', ' + Math.round(saturation * 100) + '%, ' + lightness + '%)'
        }
        return 'linear-gradient(135deg, ' + color(95) + ', ' + color(85) + ')'
    }

    // Texts -----------------------------------------------------------------

    // The interface is in English whatever the language of the browser
    this.date = function (iso) {
        return new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})
    }

    this.bought = function (purchase) {
        if (!purchase || !purchase.acquired_at) {
            return "purchase date unknown"
        }
        return "bought " + self.date(purchase.acquired_at)
    }

    this.seats = function (seats) {
        return seats ? seats.seats_in_use + " of " + seats.total_seats + " seats in use" : "no seats"
    }

    // The same name always gets the same hue
    this.hue = function (name) {
        var hash = 0
        for (var i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) % 360
        }
        return hash
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
