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

        if (sX < 0) {
            sX = 0;
        }

        if (sY < 0) {
            sY = 0;
        }

        if (sX > (origW - cropW)) {
            sX = origW - cropW;
        }

        if (sY > (origH - cropH)) {
            sY = origH - cropH;
        }

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

        if (api.queue.hasOwnProperty(id)) {
            api.$spinner.addClass('is-active');
        } else {
            api.queue[id] = wp.media.attachment(id).get('meta').focalVersion;
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
    api.cursorPos = [0, 0];
    api.queue = {};

    $document.on('mouseup', function () {
        var id;

        if (api.id) {
            id = api.id;
            api.id = 0;

            if (api.saveTimer !== null) {
                clearTimeout(api.saveTimer);
            }

            api.saveTimer = setTimeout(function (id) {
                if (api.$spinner !== null) {
                    api.$spinner.addClass('is-active');
                }

                if (api.$field !== null) {
                    api.$field.val(api.cursorPos.join(',')).change();
                }

                api.queue[id] = wp.media.attachment(id).get('meta').focalVersion;
                wp.heartbeat.interval('fast');
            }.bind(null, id), 800);
        }
    });

    $document.on('heartbeat-send', function (event, data) {
        if (!$.isEmptyObject(api.queue)) {
            data.focal_point = $.extend({}, api.queue);
        }
    });

    $document.on('heartbeat-tick', function (event, data) {
        if (data.focal_processed && $.isArray(data.focal_processed)) {
            $.each(data.focal_processed, function (index, data) {
                var $editorImg;
                var editorImgSrc;

                wp.media.attachment(data.id).set(data);
                delete api.queue[data.id];

                if (typeof tinymce !== 'undefined' && tinymce.activeEditor && data.meta) {
                    $editorImg = tinymce.activeEditor.$('img[src^="' + data.url.replace(/\.[^.]+$/, '') + '"]');

                    if ($editorImg.length) {
                        editorImgSrc = addQueryArg($editorImg.attr('src'), 'ver', data.meta.focalVersion);
                        $editorImg
                            .attr('src', editorImgSrc)
                            .attr('data-mce-src', editorImgSrc);
                    }
                }
            });

            if (api.$spinner !== null) {
                api.$spinner.removeClass('is-active');
            }
        }
    });

    window.wp.media.attachment.focalPoint = api;

})(jQuery);