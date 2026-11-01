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
        pablito: {model: "Darkglass Pablito"},
    }

    // The model code that starts a device tag tells the platform (mod-api: business/device_tag.py)
    var TAG_PLATFORMS = {MDS: 'duo', MDX: 'duox', MDW: 'dwarf', DGAN: 'pablito'}

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

        var plugins = self.loadLicenses(win)

        // The menu: one view at a time. The others are asked for when first looked at.
        var devices = null
        var getDevices = function () {
            return devices || (devices = api.devices())
        }
        var asked = {}
        win.find('.auth-nav-item').click(function () {
            var name = $(this).attr('data-view')
            win.find('.auth-nav-item').removeClass('active')
            $(this).addClass('active')
            win.find('.auth-view').removeClass('active').filter('.auth-view-' + name).addClass('active')

            if (!asked[name]) {
                asked[name] = true
                if (name == 'devices') {
                    // Which of the devices is this one is told by the plugins of this device
                    plugins.always(function () {
                        self.loadDevices(win, plugins, getDevices())
                    })
                } else if (name == 'pedalboards') {
                    self.loadPedalboards(win, getDevices())
                } else if (name == 'builds') {
                    self.loadBuilds(win)
                }
            }
            return false
        })
    }

    // The licenses view. The plugins of the device are the point of it; the licenses only add what is not here.
    // Returns the promise of the plugins of the device; `done` runs when the view is drawn.
    this.loadLicenses = function (win, done) {
        var view = win.find('.auth-view-licenses')
        var plugins = api.plugins()
        var licenses = api.licenses()

        view.find('.js-error').text('')
        plugins.done(function (items) {
            licenses.done(function (held) {
                self.renderAccount(win, items, held)
            }).fail(function () {
                self.renderAccount(win, items, null)
            }).always(function () {
                if (done) {
                    done()
                }
            })
        }).fail(function (code) {
            view.find('.js-loading').hide()
            view.find('.js-error').text(self.errorMessage(code))
        })
        return plugins
    }

    // Installs plugins the person owns on this device, one request each, and draws the view again when they are
    // all answered. The ones that failed are still there to try again.
    this.installPlugins = function (win, uris) {
        var view = win.find('.auth-view-licenses')
        var button = view.find('.js-install-all')
        var asked = $.grep(view.find('.js-action[data-action=install]').toArray(), function (b) {
            return $.inArray($(b).attr('data-uri'), uris) >= 0
        })
        var answered = 0
        var failed = 0

        var progress = function () {
            button.text("Installing " + Math.min(answered + 1, uris.length) + " of " + uris.length + "...")
        }

        view.find('.js-error').text('')
        view.find('.js-action[data-action=install]').prop('disabled', true)
        $(asked).text("Installing...")
        button.prop('disabled', true)
        progress()

        $.each(uris, function (i, uri) {
            api.install(uri).fail(function () {
                failed++
            }).always(function () {
                answered++
                if (answered < uris.length) {
                    progress()
                    return
                }
                self.loadLicenses(win, function () {
                    if (failed) {
                        view.find('.js-error').text("Could not install " + failed + (failed == 1 ? " plugin" : " plugins") + ". Please try again.")
                    }
                })
            })
        })
    }

    // The devices of the person, as cards; the one this interface runs on is marked
    this.loadDevices = function (win, plugins, devices) {
        var view = win.find('.auth-view-devices')
        var current = null
        plugins.done(function (items) {
            current = items.length ? items[0].device.id : null
        })

        devices.done(function (devices) {
            var grid = view.find('.js-devices').empty()
            devices = $.grep(devices, function (device) { return !device.revoked })
            // The one in use goes first
            devices.sort(function (a, b) {
                return (b.device_id == current) - (a.device_id == current)
            })

            $.each(devices, function (i, device) {
                var known = self.deviceModel(device.device_tag)
                var card = self.render('auth_device', {
                    model: known.model || "MOD device",
                    image: known.image,
                    tag: device.device_tag,
                    added: device.created_at ? "added " + self.date(device.created_at) : "",
                    current: device.device_id == current,
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
                kind: 'mine', title: "Yours, and installed on this device", filter: "Yours",
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
                kind: 'elsewhere', title: "Yours, but not installed on this device", filter: "Not installed",
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
                kind: 'others', title: "On this device, but we don't know they're yours", filter: "To confirm",
                note: "These keep working either way. Confirming them lets you reinstall them on another device later.",
                items: $.map(others, function (i) {
                    return self.row(i.plugin, {
                        kind: 'others', badge: "To confirm",
                        detail: self.bought(i.purchase) + (i.license.masked_email ? " with " + i.license.masked_email : ""),
                        action: 'claim', actionText: "This is mine", disabled: true,
                    })
                }),
            },
            {
                kind: 'included', title: "Included with this device · stays with it", filter: "Device",
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
            filters.off('click').on('click', '.auth-chip', function () {
                var kind = $(this).attr('data-kind')
                win.filterKind = kind
                filters.find('.auth-chip').removeClass('active').attr('aria-pressed', 'false')
                $(this).addClass('active').attr('aria-pressed', 'true')
                container.find('.auth-section').each(function () {
                    $(this).toggle(kind == 'all' || $(this).hasClass('auth-section-' + kind))
                })
                win.find('.auth-view-licenses .auth-account-body').scrollTop(0)
            })
            filters.find('.auth-chip-' + (win.filterKind && $.grep(shown, function (x) { return x.kind == win.filterKind }).length ? win.filterKind : 'all')).click()
        } else {
            filters.hide()
        }

        if (container.children().length == 0) {
            container.append($('<p class="auth-loading">').text("No plugins to show for this device yet."))
        }

        // Which device this is
        var here = win.find('.js-here')
        if (items.length) {
            var device = items[0].device
            var known = DEVICES[device.platform] || {}
            here.find('.js-device-name').text(known.model || self.capitalize(device.platform))
            here.find('.js-device-tag').text(device.tag)
            here.find('.js-device-image').toggle(!!known.image).off('error').on('error', function () { $(this).hide() }).attr('src', known.image || '')
            here.show()
        } else {
            here.hide()
        }

        // One way to have everything the person owns here: install what the device lacks
        var uris = $.map(elsewhere, function (l) { return l.plugin_uri })
        var installAll = win.find('.js-install-all').prop('disabled', false).off('click').hide()
        win.find('.js-all-installed').hide()
        if (held && uris.length) {
            installAll.text("Install all (" + uris.length + ")").attr('title', "Install the plugins you own that this device does not have").show()
                .click(function () {
                    self.installPlugins(win, uris)
                    return false
                })
        } else if (held) {
            win.find('.js-all-installed').show()
        }
        win.find('.auth-view-licenses .js-loading').hide()

        container.find('.js-action[data-action=install]').click(function () {
            self.installPlugins(win, [$(this).attr('data-uri')])
            return false
        })
    }

    // What the tag of a device tells of it: its model and its picture (empty when the tag is not known)
    this.deviceModel = function (tag) {
        return DEVICES[TAG_PLATFORMS[(tag || '').replace(/\d.*$/, '')]] || {}
    }

    // Asks "sure?" in place of the buttons of a card. `run` does the thing and returns its promise; when it
    // fails the buttons come back.
    this.confirm = function (actions, message, yesText, run) {
        var buttons = actions.children().detach()
        var box = $('<div class="auth-confirm">').appendTo(actions)
        var yes = $('<button type="button" class="auth-button auth-button-small">').text(yesText)
        var no = $('<button type="button" class="auth-button auth-button-small auth-button-light">').text("Cancel")
        var restore = function () {
            box.remove()
            actions.append(buttons)
        }

        box.append($('<span class="auth-confirm-text">').text(message), yes, no)
        no.click(function () {
            restore()
            return false
        })
        yes.click(function () {
            yes.prop('disabled', true).text("Wait...")
            no.prop('disabled', true)
            run().fail(restore)
            return false
        })
    }

    // Filter chips of a view: `chips` is [{kind, label, count}], `apply(kind)` shows what the chosen one says
    this.chips = function (container, chips, apply) {
        container.empty().off('click').show()
        $.each(chips, function (i, chip) {
            $('<button type="button" class="auth-chip auth-chip-' + chip.kind + '">')
                .attr('data-kind', chip.kind)
                .append($('<span>').text(chip.label))
                .append($('<b>').text(chip.count))
                .appendTo(container)
        })
        container.on('click', '.auth-chip', function () {
            container.find('.auth-chip').removeClass('active').attr('aria-pressed', 'false')
            $(this).addClass('active').attr('aria-pressed', 'true')
            apply($(this).attr('data-kind'))
        })
        container.find('.auth-chip:first').click()
    }

    this.count = function (n, noun) {
        return n + " " + noun + (n == 1 ? "" : "s")
    }

    // Pedalboards ------------------------------------------------------------

    // The pedalboards the person shared. The same title shared more than once is one pedalboard with its history.
    this.loadPedalboards = function (win, devices) {
        var view = win.find('.auth-view-pedalboards')
        var byId = {}
        devices.done(function (list) {
            $.each(list, function (i, device) {
                byId[device.device_id] = device
            })
        })

        view.find('.js-error').text('')
        api.pedalboards().done(function (boards) {
            // The devices only tell where each came from: without them the list still shows
            devices.always(function () {
                self.renderPedalboards(win, boards, byId, devices)
            })
        }).fail(function (code) {
            view.find('.js-error').text(self.errorMessage(code))
        }).always(function () {
            view.find('.js-loading').hide()
        })
    }

    this.renderPedalboards = function (win, boards, byId, devices) {
        var view = win.find('.auth-view-pedalboards')
        var grid = view.find('.js-pedalboards').empty()
        win.openHistory = win.openHistory || {}

        var groups = {}
        $.each(boards, function (i, board) {
            var key = $.trim(board.title).toLowerCase()
            ;(groups[key] = groups[key] || []).push(board)
        })
        var list = $.map(groups, function (versions, key) {
            versions.sort(function (a, b) { return b.created < a.created ? -1 : 1 })
            return [{key: key, versions: versions}]
        })
        list.sort(function (a, b) { return b.versions[0].created < a.versions[0].created ? -1 : 1 })

        var originOf = function (board) {
            var device = byId[board.device_id]
            var known = device ? self.deviceModel(device.device_tag) : {}
            return {
                name: device ? (known.model || "MOD device") : "A device no longer in your account",
                tag: device ? device.device_tag : '',
                image: known.image,
            }
        }

        var unshare = function (board, actions) {
            self.confirm(actions, "Stop sharing this pedalboard?", "Unshare", function () {
                return api.unshare(board.id).done(function () {
                    self.loadPedalboards(win, devices)
                }).fail(function () {
                    view.find('.js-error').text("Could not unshare the pedalboard. Please try again.")
                })
            })
        }

        // Replaces what is open on the device, so it is asked first
        var open = function (board, actions) {
            self.confirm(actions, "This replaces the pedalboard open on this device.", "Open", function () {
                return api.open(board.id).done(function () {
                    win.close()
                }).fail(function () {
                    view.find('.js-error').text("Could not open the pedalboard. Please try again.")
                })
            })
        }

        $.each(list, function (i, group) {
            var latest = group.versions[0]
            var older = group.versions.slice(1)
            var origin = originOf(latest)
            var title = latest.title || "Untitled"
            var card = self.render('auth_pedalboard', {
                title: title,
                longName: title.length > 14,
                description: latest.description,
                shared: self.date(latest.created),
                plugins: self.count((latest.data && latest.data.plugins || []).length, "plugin"),
                device: origin.name,
                tag: origin.tag,
                unlisted: latest.hidden,
                versions: older.length ? self.count(group.versions.length, "version") : '',
                older: older.length,
            })

            self.picture(card.find('.auth-thumb'), latest.thumbnail_href, title)
            card.find('.js-origin-image').toggle(!!origin.image).off('error').on('error', function () { $(this).hide() }).attr('src', origin.image || '')

            var actions = card.find('.js-actions')
            actions.find('.js-unshare').click(function () {
                unshare(latest, actions)
                return false
            })
            actions.find('.js-open').click(function () {
                open(latest, actions)
                return false
            })

            // The earlier versions: each can be opened, or unshared, on its own
            if (older.length) {
                var history = card.find('.js-history-list')
                var button = actions.find('.js-history')
                var toggle = function (show) {
                    history.toggle(show)
                    button.text((show ? "Hide history (" : "History (") + older.length + ")")
                    win.openHistory[group.key] = show
                }

                history.append($('<h5>').text("Earlier versions"))
                $.each(older, function (j, board) {
                    var from = originOf(board)
                    var row = $('<div class="auth-history-row">').appendTo(history)
                    row.append($('<div class="auth-history-text">')
                        .append($('<strong>').text(self.date(board.created)))
                        .append($('<span>').text(from.name + (board.description ? " · " + board.description : ""))))
                    var rowActions = $('<div class="auth-history-actions">').appendTo(row)
                    $('<button type="button" class="auth-button auth-button-small auth-button-light">').text("Unshare").appendTo(rowActions)
                        .click(function () {
                            unshare(board, rowActions)
                            return false
                        })
                    $('<button type="button" class="auth-button auth-button-small">').text("Open here").appendTo(rowActions)
                        .click(function () {
                            open(board, rowActions)
                            return false
                        })
                })

                button.click(function () {
                    toggle(!history.is(':visible'))
                    return false
                })
                toggle(!!win.openHistory[group.key])
            }

            grid.append(card)
        })

        if (list.length == 0) {
            grid.append($('<p class="auth-loading">').text("You have not shared any pedalboard yet."))
        }
        view.find('.js-count').text(self.count(list.length, "pedalboard")).toggle(list.length > 0)
    }

    // Builds -----------------------------------------------------------------

    // The plugins the person built with MOD Buildroot
    this.loadBuilds = function (win) {
        var view = win.find('.auth-view-builds')

        view.find('.js-error').text('')
        api.builds().done(function (builds) {
            self.renderBuilds(win, builds)
        }).fail(function (code) {
            view.find('.js-error').text(self.errorMessage(code))
        }).always(function () {
            view.find('.js-loading').hide()
        })
    }

    this.renderBuilds = function (win, builds) {
        var view = win.find('.auth-view-builds')
        var grid = view.find('.js-builds').empty()
        var filters = view.find('.js-filters').hide()

        // The status of the pipeline in the words of the person; `group` is what the chips filter by
        var STATES = {
            finished: {state: 'finished', group: 'finished', text: "Finished"},
            error: {state: 'failed', group: 'failed', text: "Failed"},
            waiting: {state: 'queued', group: 'active', text: "Queued"},
            source_verification: {state: 'building', group: 'active', text: "Checking source"},
            compilation: {state: 'building', group: 'active', text: "Compiling"},
            bundle_verification: {state: 'building', group: 'active', text: "Verifying"},
            finishing: {state: 'building', group: 'active', text: "Finishing"},
        }
        var PLATFORMS = {duo: "Duo", duox: "Duo X", dwarf: "Dwarf", pablito: "Pablito"}
        var platformName = function (id) { return PLATFORMS[id] || self.capitalize(id) }

        builds = builds.slice().sort(function (a, b) { return b.created < a.created ? -1 : 1 })

        var counts = {finished: 0, active: 0, failed: 0}
        $.each(builds, function (i, build) {
            var status = STATES[build.status] || STATES.waiting
            var plugins = []
            var warnings = 0
            $.each(build.bundle_data || [], function (j, bundle) {
                $.each(bundle.plugins, function (k, plugin) {
                    plugins.push(plugin)
                    warnings += (plugin.warnings || []).length
                })
            })
            var platforms = (build.data.supported_platforms || []).map(platformName)
            var contents = []
            if (plugins.length > 1) {
                contents.push(plugins.map(function (plugin) { return plugin.name }).join(", "))
            }
            if (warnings) {
                contents.push(self.count(warnings, "warning"))
            }

            var card = self.render('auth_build', {
                name: plugins.length ? plugins[0].name : build.data.project,
                version: plugins.length && plugins[0].version ? "v" + plugins[0].version : '',
                state: status.state,
                status: status.text,
                created: "started " + self.date(build.created),
                platforms: platforms.join(", "),
                contents: contents.join(" · "),
                reason: build.status == 'error' ? build.reason : '',
                files: build.status == 'finished' ? $.map(build.bundle_files || [], function (file) {
                    return {label: "\u2193 " + platformName(file.platform), href: file.href}
                }) : [],
                logs: build.logs_href,
            })
            card.attr('data-group', status.group)
            counts[status.group]++
            grid.append(card)
        })

        if (builds.length == 0) {
            grid.append($('<p class="auth-loading">').text("You have not built any plugin yet."))
            return
        }

        // The chips filter by outcome; with a single outcome there is nothing to choose
        var chips = $.grep([
            {kind: 'finished', label: "Finished", count: counts.finished},
            {kind: 'active', label: "In progress", count: counts.active},
            {kind: 'failed', label: "Failed", count: counts.failed},
        ], function (chip) { return chip.count > 0 })
        if (chips.length > 1) {
            chips.unshift({kind: 'all', label: "All", count: builds.length})
            self.chips(filters, chips, function (kind) {
                grid.children().each(function () {
                    $(this).toggle(kind == 'all' || $(this).attr('data-group') == kind)
                })
            })
        }
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

        var src = extra.absent ? (plugin.screenshot_href || plugin.thumbnail_href) : "/effect/image/screenshot.png?uri=" + escape(plugin.uri)
        self.picture(html.find('.auth-thumb'), src, name)
        return html
    }

    // The picture of a tile, when there is one, and the color the tile takes from it
    this.picture = function (thumb, src, name) {
        thumb.css('background', self.background(self.hue(name), 0.2))
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
