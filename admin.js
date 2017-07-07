(function ($) {

    'use strict';

    var $document = $(document);

    var resizeOffset = function (centerX, centerY, origW, origH, destW, destH) {
        var aspectRatio = 1.0 * origW / origH;
        var newW = Math.min(destW, origW);
        var newH = Math.min(destH, origH);

        if (!newW) {
            newW = Math.round(newH * aspectRatio);
        }

        if (!newH) {
            newH = Math.round(newW / aspectRatio);
        }

        var sizeRatio = Math.max(newW / origW, newH / origH);

        var cropW = Math.round(newW / sizeRatio);
        var cropH = Math.round(newH / sizeRatio);

        var sX = Math.floor(origW * centerX / 100.0 - cropW / 2.0);
        var sY = Math.floor(origH * centerY / 100.0 - cropH / 2.0);

        sX = Math.min(Math.max(sX, 0), origW - cropW);
        sY = Math.min(Math.max(sY, 0), origH - cropH);

        return [sX, sY];
    };

    var addQueryArg = function (uri, key, value) {
        var re = new RegExp('([?&])' + key + '=.*?(&|#|$)', 'i');
        var hash = '';
        var separator;

        if (uri.match(re)) {
            return uri.replace(re, '$1' + key + '=' + value + '$2');
        } else {
            if (uri.indexOf('#') !== -1 ){
                hash = uri.replace(/.*#/, '#');
                uri = uri.replace(/#.*/, '');
            }

            separator = uri.indexOf('?') !== -1 ? '&' : '?';

            return uri + separator + key + '=' + value + hash;
        }
    };

    var api = function (id) {
        var $cursor = $('#focal-cursor-' + id);
        var $selector = $('#focal-selector-' + id);
        var $previews = $('#focal-previews');

        api.$spinner = $('#focal-spinner');
        api.$helpText = $('#focal-help-text');

        if (api.queue.hasOwnProperty(id)) {
            api.loader(true);
        }

        api.$field = $('#attachments-' + id + '-focal-center');
        api.cursorPos = api.$field.val().split(',').map(parseFloat);

        var updateCursorPos = function (x, y) {
            x = Math.min(Math.max(x, 0), 100);
            y = Math.min(Math.max(y, 0), 100);

            api.cursorPos = [x, y];
            $cursor.css({
                left: x + '%',
                top: y + '%'
            });

            $previews.find('li').each(function () {
                var $el = $(this);
                var $img = $el.find('img:first');
                var offset = resizeOffset(x, y, $img.width(), $img.height(), $el.width(), $el.height());

                $img.css({
                    marginLeft: -offset[0],
                    marginTop: -offset[1]
                });
            })
        };

        updateCursorPos(api.cursorPos[0], api.cursorPos[1]);

        $selector.on('mousedown', function (event) {
            event.preventDefault();
            updateCursorPos(100.0 * event.offsetX / $selector.width(), 100.0 * event.offsetY / $selector.height());
            api.id = id;
        });

        $selector.on('mousemove', function (event) {
            event.preventDefault();

            if (api.id) {
                updateCursorPos(100.0 * event.offsetX / $selector.width(), 100.0 * event.offsetY / $selector.height());
            }
        });
    };

    api.id = 0;
    api.saveTimer = null;
    api.$field = null;
    api.$spinner = null;
    api.$helpText = null;
    api.cursorPos = [0, 0];
    api.queue = {};
    api.ticks = 0;
    api.adminNotice = wp.template('wp-updates-admin-notice');
    api.loader = function (isActive) {
        var action = isActive ? 'addClass' : 'removeClass';

        if (this.$spinner !== null) {
            this.$spinner[action]('is-active');
        }

        if (this.$helpText !== null) {
            this.$helpText[action]('is-active');
        }
    };
    api.save = function () {
        if (window.localStorage) {
            window.localStorage.setItem('focal-queue', JSON.stringify(api.queue));
        }
    };
    api.addAdminNotice = function (data) {
        var $notice;
        var $adminNotice;

        if (document.getElementById('tmpl-wp-updates-admin-notice') !== null) {
            $notice = $(data.selector);
            delete data.selector;
            $adminNotice = api.adminNotice(data);

            if (!$notice.length) {
                $notice = $('#' + data.id);
            }

            if ($notice.length) {
                $notice.replaceWith($adminNotice);
            } else {
                $('.wrap')
                    .find('> h1')
                    .nextAll('.wp-header-end')
                    .after($adminNotice);
            }

            $document.trigger('wp-updates-notice-added');
        }
    };

    $(function () {
        var queue;

        if (window.localStorage) {
            queue = window.localStorage.getItem('focal-queue');

            if (queue !== null) {
                api.queue = JSON.parse(queue);
            }
        }

        $document.on('mouseup', function () {
            var id;

            if (api.id) {
                id = api.id;
                api.id = 0;

                if (api.saveTimer !== null) {
                    clearTimeout(api.saveTimer);
                }

                api.saveTimer = setTimeout(function (id) {
                    var attachment = wp.media.attachment(id);
                    var meta = attachment.get('meta');

                    api.loader(true);

                    if (api.$field !== null) {
                        api.$field.val(api.cursorPos.join(',')).change();
                    }

                    api.queue[id] = meta ? meta.focalVersion : 0;
                    api.save();
                    wp.heartbeat.interval(5);
                }.bind(null, id), 800);
            }
        });

        $document.on('heartbeat-send', function (event, data) {
            if (!$.isEmptyObject(api.queue)) {
                data.focal_point = $.extend({}, api.queue);
                api.ticks += 1;

                if (api.ticks > 5) {
                    wp.heartbeat.interval(15);
                }
            }
        });

        $document.on('heartbeat-tick', function (event, data) {
            var names = [];

            if (data.focal_processed && $.isArray(data.focal_processed)) {
                $.each(data.focal_processed, function (index, data) {
                    var attachment;
                    var $editorImg;
                    var editorImgSrc;
                    var t = Date.now();

                    data.url = addQueryArg(data.url, 't', t);
                    $.each(data.sizes, function (size, image) {
                        data.sizes[size].url = addQueryArg(image.url, 't', t);
                    });
                    attachment = wp.media.attachment(data.id);
                    attachment.set(data);
                    names.push('<strong>' + attachment.get('name') + '</strong>');
                    delete api.queue[data.id];
                    api.save();

                    if (typeof tinymce !== 'undefined' && tinymce.activeEditor && data.meta) {
                        $editorImg = tinymce.activeEditor.$('img[src^="' + data.url.replace(/\.[^.]+$/, '') + '"]');

                        if ($editorImg.length) {
                            editorImgSrc = addQueryArg($editorImg.attr('src'), 'ver', data.meta.focalVersion);
                            editorImgSrc = addQueryArg(editorImgSrc, 't', t);
                            $editorImg
                                .attr('src', editorImgSrc)
                                .attr('data-mce-src', editorImgSrc);
                        }
                    }
                });

                api.loader(false);
                api.ticks = 0;

                if (names.length) {
                    api.addAdminNotice({
                        id: 'focal-processed',
                        className: 'notice-success is-dismissible',
                        message: focalPointL10n.processed.replace('%s', names.join(', '))
                    });
                }
            }
        });
    });

    window.wp.media.attachment.focalPoint = api;

})(jQuery);